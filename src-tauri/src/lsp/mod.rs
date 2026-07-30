//! Multi-language LSP clients for analysis (symbols, references, diagnostics).
//! Spawns system language servers when present; callers fall back to heuristics.

mod client;
mod discover;
mod status;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::hierarchy::{SymbolEdge, SymbolInfo};

pub use discover::LanguageKind;
pub use status::{
    build_enriched_path, cfg_bool, cfg_u32, enrich_path, install_lsp_server, list_lsp_servers,
    lsp_cfg, LspInstallResult, LspServerStatus, LspSettingsMap,
};

use client::LspClient;
use discover::{discover_servers, file_language, ServerSpec};

#[derive(Debug, Clone)]
pub struct LspDiagnostic {
    pub path: String,
    pub severity: String,
    pub message: String,
    pub line: u32,
    pub source: String,
}

struct LangRuntime {
    max_open_files: usize,
    max_refs_per_symbol: usize,
    collect_symbols: bool,
    collect_references: bool,
    collect_diagnostics: bool,
    include_javascript: bool,
}

impl LangRuntime {
    fn from_settings(lang: LanguageKind, settings: &LspSettingsMap) -> Self {
        let cfg = lsp_cfg(settings, lang.label());
        Self {
            max_open_files: cfg_u32(cfg, "max_open_files", 200) as usize,
            max_refs_per_symbol: cfg_u32(cfg, "max_refs_per_symbol", 24) as usize,
            collect_symbols: cfg_bool(cfg, "collect_symbols", true),
            collect_references: cfg_bool(cfg, "collect_references", false),
            collect_diagnostics: cfg_bool(cfg, "collect_diagnostics", true),
            include_javascript: cfg_bool(cfg, "include_javascript", true),
        }
    }
}

struct ManagedServer {
    language: LanguageKind,
    root: PathBuf,
    client: LspClient,
    /// relative path -> absolute URI used for LSP
    opened: HashMap<String, String>,
    runtime: LangRuntime,
}

/// Pool of language-server processes covering TS/JS, Rust, Python, and Go.
pub struct LspPool {
    project_root: PathBuf,
    servers: Vec<ManagedServer>,
    diagnostics: Arc<Mutex<Vec<LspDiagnostic>>>,
    settings: LspSettingsMap,
}

impl LspPool {
    pub fn start(
        project_root: &Path,
        files: &[(String, u32)],
        contents: &HashMap<String, String>,
        settings: &LspSettingsMap,
        mut on_progress: impl FnMut(&str, u32, u32),
    ) -> Self {
        enrich_path();
        let project_root = project_root.to_path_buf();
        let diagnostics = Arc::new(Mutex::new(Vec::new()));
        let specs = discover_servers(&project_root, files);

        let mut enabled_specs = Vec::new();
        let mut wait_ms = 0u32;
        for spec in specs {
            let cfg = lsp_cfg(settings, spec.language.label());
            if !cfg_bool(cfg, "enabled", true) {
                continue;
            }
            wait_ms = wait_ms.max(cfg_u32(cfg, "diagnostic_wait_ms", 800));
            enabled_specs.push(spec);
        }

        on_progress(
            &format!("Starting {} language server(s)…", enabled_specs.len()),
            0,
            enabled_specs.len() as u32,
        );

        let mut servers = Vec::new();
        for (i, spec) in enabled_specs.into_iter().enumerate() {
            on_progress(
                &format!("Starting {} ({})", spec.language.label(), spec.command),
                (i + 1) as u32,
                0,
            );
            let lang_label = spec.language.label().to_string();
            let runtime = LangRuntime::from_settings(spec.language, settings);
            let cfg = lsp_cfg(settings, spec.language.label());
            match spawn_server(
                &project_root,
                spec,
                Arc::clone(&diagnostics),
                cfg,
                runtime,
            ) {
                Ok(server) => servers.push(server),
                Err(err) => {
                    eprintln!(
                        "[devtree lsp] failed to start {lang_label}: {err}"
                    );
                }
            }
        }

        let mut pool = Self {
            project_root,
            servers,
            diagnostics,
            settings: settings.clone(),
        };

        pool.open_files(files, contents, &mut on_progress);
        if wait_ms > 0 {
            std::thread::sleep(Duration::from_millis(wait_ms as u64));
        }
        pool
    }

    fn open_files(
        &mut self,
        files: &[(String, u32)],
        contents: &HashMap<String, String>,
        on_progress: &mut impl FnMut(&str, u32, u32),
    ) {
        let max_cap = self
            .servers
            .iter()
            .map(|s| s.runtime.max_open_files)
            .max()
            .unwrap_or(200)
            .saturating_mul(self.servers.len().max(1));
        let total = files.len().min(max_cap);
        let mut opened = 0u32;

        for (rel, _) in files.iter().take(max_cap.saturating_mul(2).max(1)) {
            let Some(lang) = file_language(rel) else {
                continue;
            };
            let abs = self.project_root.join(rel);
            let Ok(uri) = path_to_uri(&abs) else {
                continue;
            };
            let content = contents.get(rel).cloned().unwrap_or_default();
            let language_id = lang.language_id();

            for server in &mut self.servers {
                if server.language != lang {
                    continue;
                }
                if lang == LanguageKind::TypeScript
                    && !server.runtime.include_javascript
                    && matches!(
                        Path::new(rel).extension().and_then(|e| e.to_str()),
                        Some("js" | "jsx" | "mjs" | "cjs")
                    )
                {
                    continue;
                }
                if !abs.starts_with(&server.root) {
                    continue;
                }
                if server.opened.len() >= server.runtime.max_open_files {
                    continue;
                }
                if server.opened.contains_key(rel) {
                    continue;
                }
                if let Err(err) = server.client.did_open(&uri, language_id, &content) {
                    eprintln!("[devtree lsp] didOpen {rel}: {err}");
                    continue;
                }
                server.opened.insert(rel.clone(), uri.clone());
                opened += 1;
                if opened == 1 || opened % 16 == 0 {
                    on_progress(
                        &format!("LSP indexing ({opened}/{total})"),
                        opened,
                        total as u32,
                    );
                }
            }
        }

        on_progress(
            &format!("Opened {opened} files in language servers"),
            opened,
            total as u32,
        );
    }

    pub fn document_symbols(&self, rel_path: &str) -> Option<Vec<SymbolInfo>> {
        let lang = file_language(rel_path)?;
        let abs = self.project_root.join(rel_path);
        let uri = path_to_uri(&abs).ok()?;

        for server in &self.servers {
            if server.language != lang {
                continue;
            }
            if !server.runtime.collect_symbols {
                continue;
            }
            if !server.opened.contains_key(rel_path) && !abs.starts_with(&server.root) {
                continue;
            }
            match server.client.document_symbols(&uri) {
                Ok(symbols) if !symbols.is_empty() => {
                    return Some(map_document_symbols(rel_path, &symbols));
                }
                Ok(_) => {}
                Err(err) => {
                    eprintln!("[devtree lsp] documentSymbol {rel_path}: {err}");
                }
            }
        }
        None
    }

    /// Resolve reference edges among known symbols in a file.
    pub fn symbol_edges_for_file(
        &self,
        rel_path: &str,
        symbols: &[SymbolInfo],
    ) -> Vec<SymbolEdge> {
        if symbols.is_empty() {
            return Vec::new();
        }
        let lang = match file_language(rel_path) {
            Some(l) => l,
            None => return Vec::new(),
        };
        let abs = self.project_root.join(rel_path);
        let Ok(uri) = path_to_uri(&abs) else {
            return Vec::new();
        };

        let by_line: HashMap<u32, &SymbolInfo> =
            symbols.iter().map(|s| (s.line, s)).collect();

        let mut edges = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for server in &self.servers {
            if server.language != lang {
                continue;
            }
            if !server.runtime.collect_references {
                continue;
            }
            let max_refs = server.runtime.max_refs_per_symbol;
            for sym in symbols.iter().take(40) {
                let line = sym.line.saturating_sub(1);
                let character = estimate_name_character(sym);
                let Ok(locs) = server.client.references(&uri, line, character) else {
                    continue;
                };
                for loc in locs.into_iter().take(max_refs) {
                    let Some(target_rel) = uri_to_rel(&self.project_root, &loc.uri) else {
                        continue;
                    };
                    if target_rel != rel_path {
                        continue;
                    }
                    let target_line = loc.range.start.line + 1;
                    if target_line == sym.line {
                        continue;
                    }
                    let target = by_line
                        .get(&target_line)
                        .copied()
                        .or_else(|| {
                            symbols
                                .iter()
                                .filter(|s| s.line <= target_line)
                                .max_by_key(|s| s.line)
                        });
                    let Some(target) = target else {
                        continue;
                    };
                    if target.id == sym.id {
                        continue;
                    }
                    let key = (sym.id.clone(), target.id.clone());
                    if !seen.insert(key) {
                        continue;
                    }
                    edges.push(SymbolEdge {
                        source: sym.id.clone(),
                        target: target.id.clone(),
                        kind: "reference".into(),
                    });
                }
            }
            break;
        }

        edges
    }

    pub fn diagnostics(&self) -> Vec<LspDiagnostic> {
        let all = self
            .diagnostics
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default();
        all.into_iter()
            .filter(|d| {
                let lang = file_language(&d.path);
                let Some(lang) = lang else {
                    return true;
                };
                let cfg = lsp_cfg(&self.settings, lang.label());
                cfg_bool(cfg, "collect_diagnostics", true)
                    && cfg_bool(cfg, "enabled", true)
            })
            .collect()
    }

    pub fn server_count(&self) -> usize {
        self.servers.len()
    }
}

impl Drop for LspPool {
    fn drop(&mut self) {
        for server in &mut self.servers {
            let _ = server.client.shutdown();
        }
    }
}

fn spawn_server(
    project_root: &Path,
    spec: ServerSpec,
    diagnostics: Arc<Mutex<Vec<LspDiagnostic>>>,
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
    runtime: LangRuntime,
) -> Result<ManagedServer, String> {
    let root = spec.root.clone();
    let root_uri = path_to_uri(&root)?;
    let project_root = project_root.to_path_buf();
    let language = spec.language;
    let collect_diagnostics = runtime.collect_diagnostics;

    let on_diag = move |uri: String, diags: Vec<lsp_types::Diagnostic>| {
        if !collect_diagnostics {
            return;
        }
        let Some(rel) = uri_to_rel(&project_root, &uri) else {
            return;
        };
        let Ok(mut guard) = diagnostics.lock() else {
            return;
        };
        guard.retain(|d| d.path != rel);
        for d in diags {
            let severity = match d.severity {
                Some(lsp_types::DiagnosticSeverity::ERROR) => "error",
                Some(lsp_types::DiagnosticSeverity::WARNING) => "warning",
                Some(lsp_types::DiagnosticSeverity::INFORMATION) => "info",
                Some(lsp_types::DiagnosticSeverity::HINT) => "hint",
                _ => "warning",
            };
            guard.push(LspDiagnostic {
                path: rel.clone(),
                severity: severity.into(),
                message: d.message,
                line: d.range.start.line + 1,
                source: d
                    .source
                    .unwrap_or_else(|| language.label().into()),
            });
        }
    };

    let client = LspClient::spawn(&spec.command, &spec.args, &root, Box::new(on_diag))?;
    client.initialize(&root_uri, language.init_options_with_settings(cfg))?;
    client.initialized()?;

    Ok(ManagedServer {
        language: spec.language,
        root,
        client,
        opened: HashMap::new(),
        runtime,
    })
}

fn path_to_uri(path: &Path) -> Result<String, String> {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(path)
    };
    let url = url::Url::from_file_path(&abs)
        .map_err(|_| format!("invalid path for URI: {}", abs.display()))?;
    Ok(url.to_string())
}

fn uri_to_rel(project_root: &Path, uri: &str) -> Option<String> {
    let url = url::Url::parse(uri).ok()?;
    let path = url.to_file_path().ok()?;
    path.strip_prefix(project_root)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

fn map_document_symbols(
    file_path: &str,
    symbols: &[client::FlatSymbol],
) -> Vec<SymbolInfo> {
    symbols
        .iter()
        .map(|s| SymbolInfo {
            id: format!("{}::{}", file_path, s.name),
            label: s.name.clone(),
            kind: s.kind.clone(),
            file: file_path.to_string(),
            line: s.line,
        })
        .collect()
}

fn estimate_name_character(sym: &SymbolInfo) -> u32 {
    // Rough indent-agnostic position; servers usually resolve from nearby token.
    sym.label.len().min(40) as u32
}

#[cfg(test)]
mod tests {
    #[test]
    fn lsp_module_is_available() {
        assert!(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lsp").exists());
    }
}
