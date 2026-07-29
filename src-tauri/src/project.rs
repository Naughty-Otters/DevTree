use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectScan {
    pub root: String,
    pub tree: TreeEntry,
    pub modules: Vec<ModuleEntry>,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".cache",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    ".idea",
    ".vscode",
    "pkg",
];

const SOURCE_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "go", "java", "kt",
    "swift", "c", "cpp", "h", "hpp", "cs", "rb", "php", "vue", "svelte",
];

fn should_skip(name: &str) -> bool {
    SKIP_DIRS.contains(&name) || name.starts_with('.')
}

fn is_source_file(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|ext| SOURCE_EXTENSIONS.contains(&ext))
        .unwrap_or(false)
}

fn count_source_files(dir: &Path) -> usize {
    let mut count = 0;
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if !should_skip(&name) {
                count += count_source_files(&path);
            }
        } else if is_source_file(&name) {
            count += 1;
        }
    }
    count
}

fn build_tree(dir: &Path, root: &Path) -> Option<TreeEntry> {
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());

    if dir != root && should_skip(&name) {
        return None;
    }

    let rel_path = dir
        .strip_prefix(root)
        .map(|p| {
            if p.as_os_str().is_empty() {
                ".".to_string()
            } else {
                p.to_string_lossy().to_string()
            }
        })
        .unwrap_or_else(|_| name.clone());

    if dir.is_file() {
        return Some(TreeEntry {
            name,
            path: rel_path,
            kind: "file".into(),
            children: None,
        });
    }

    let mut children = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let child_name = entry.file_name().to_string_lossy().to_string();
            if entry.path().is_dir() && should_skip(&child_name) {
                continue;
            }
            if let Some(child) = build_tree(&entry.path(), root) {
                children.push(child);
            }
        }
    }

    Some(TreeEntry {
        name,
        path: rel_path,
        kind: "directory".into(),
        children: if children.is_empty() {
            None
        } else {
            Some(children)
        },
    })
}

fn collect_modules(dir: &Path, root: &Path, modules: &mut Vec<ModuleEntry>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    let rel_path = dir
        .strip_prefix(root)
        .map(|p| {
            if p.as_os_str().is_empty() {
                ".".to_string()
            } else {
                p.to_string_lossy().to_string()
            }
        })
        .unwrap_or_else(|_| ".".to_string());

    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());

    if dir != root {
        let file_count = count_source_files(dir);
        if file_count > 0 {
            modules.push(ModuleEntry {
                name: name.clone(),
                path: rel_path,
                kind: "folder".into(),
                file_count,
            });
        }
    }

    for entry in entries.flatten() {
        let child_name = entry.file_name().to_string_lossy().to_string();
        if entry.path().is_dir() {
            if !should_skip(&child_name) {
                collect_modules(&entry.path(), root, modules);
            }
        } else if is_source_file(&child_name) {
            let file_rel = entry
                .path()
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or(child_name.clone());
            modules.push(ModuleEntry {
                name: child_name,
                path: file_rel,
                kind: "file".into(),
                file_count: 1,
            });
        }
    }
}

pub fn scan_project(root_path: &str) -> Result<ProjectScan, String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {root_path}"));
    }

    let tree = build_tree(&root, &root).ok_or_else(|| "Failed to build tree".to_string())?;

    let mut modules = Vec::new();
    collect_modules(&root, &root, &mut modules);
    modules.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(ProjectScan {
        root: root_path.to_string(),
        tree,
        modules,
    })
}
