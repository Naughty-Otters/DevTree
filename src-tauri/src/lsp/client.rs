use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::lsp::status::build_enriched_path;

pub type DiagHandler = Box<dyn FnMut(String, Vec<lsp_types::Diagnostic>) + Send>;

pub struct FlatSymbol {
    pub name: String,
    pub kind: String,
    pub line: u32,
}

pub struct RefLocation {
    pub uri: String,
    pub range: lsp_types::Range,
}

struct Pending {
    tx: Sender<Result<Value, String>>,
}

pub struct LspClient {
    child: Child,
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<u64, Pending>>>,
    next_id: AtomicU64,
}

impl LspClient {
    pub fn spawn(
        command: &str,
        args: &[String],
        cwd: &Path,
        mut on_diag: DiagHandler,
    ) -> Result<Self, String> {
        let path_env = build_enriched_path();
        let mut child = Command::new(command)
            .args(args)
            .current_dir(cwd)
            .env("PATH", &path_env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn {command} {:?}: {e}", args))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "missing stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "missing stdout".to_string())?;

        if let Some(stderr) = child.stderr.take() {
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().flatten() {
                    if !line.trim().is_empty() {
                        eprintln!("[lsp stderr] {line}");
                    }
                }
            });
        }

        let pending: Arc<Mutex<HashMap<u64, Pending>>> = Arc::new(Mutex::new(HashMap::new()));
        let pending_reader = Arc::clone(&pending);

        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_message(&mut reader) {
                    Ok(msg) => handle_incoming(msg, &pending_reader, &mut on_diag),
                    Err(_) => break,
                }
            }
        });

        Ok(Self {
            child,
            stdin: Mutex::new(stdin),
            pending,
            next_id: AtomicU64::new(1),
        })
    }

    pub fn initialize(&self, root_uri: &str, init_options: Value) -> Result<(), String> {
        let params = json!({
            "processId": std::process::id(),
            "rootUri": root_uri,
            "capabilities": {
                "textDocument": {
                    "synchronization": { "didOpen": true, "didChange": false },
                    "documentSymbol": {
                        "hierarchicalDocumentSymbolSupport": true
                    },
                    "references": {},
                    "publishDiagnostics": {}
                },
                "workspace": {
                    "workspaceFolders": true
                }
            },
            "initializationOptions": init_options,
            "workspaceFolders": [{
                "uri": root_uri,
                "name": "root"
            }]
        });
        let _ = self.request("initialize", params)?;
        Ok(())
    }

    pub fn initialized(&self) -> Result<(), String> {
        self.notify("initialized", json!({}))
    }

    pub fn did_open(&self, uri: &str, language_id: &str, text: &str) -> Result<(), String> {
        self.notify(
            "textDocument/didOpen",
            json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": language_id,
                    "version": 1,
                    "text": text
                }
            }),
        )
    }

    pub fn document_symbols(&self, uri: &str) -> Result<Vec<FlatSymbol>, String> {
        let result = self.request(
            "textDocument/documentSymbol",
            json!({ "textDocument": { "uri": uri } }),
        )?;
        Ok(parse_document_symbols(&result))
    }

    pub fn references(
        &self,
        uri: &str,
        line: u32,
        character: u32,
    ) -> Result<Vec<RefLocation>, String> {
        let result = self.request(
            "textDocument/references",
            json!({
                "textDocument": { "uri": uri },
                "position": { "line": line, "character": character },
                "context": { "includeDeclaration": false }
            }),
        )?;
        Ok(parse_locations(&result))
    }

    pub fn shutdown(&mut self) -> Result<(), String> {
        let _ = self.request("shutdown", json!(null));
        let _ = self.notify("exit", json!(null));
        let _ = self.child.wait();
        Ok(())
    }

    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = channel();
        self.pending
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, Pending { tx });

        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        {
            let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
            write_message(&mut *stdin, &msg)?;
        }
        wait_response(rx, Duration::from_secs(45))
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let msg = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });
        let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
        write_message(&mut *stdin, &msg)
    }
}

fn write_message(stdin: &mut ChildStdin, msg: &Value) -> Result<(), String> {
    let body = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    stdin
        .write_all(header.as_bytes())
        .map_err(|e| e.to_string())?;
    stdin
        .write_all(body.as_bytes())
        .map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

fn read_message(reader: &mut impl BufRead) -> Result<Value, String> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("EOF".into());
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
            content_length = Some(
                rest.trim()
                    .parse()
                    .map_err(|e: std::num::ParseIntError| e.to_string())?,
            );
        }
    }
    let len = content_length.ok_or_else(|| "missing Content-Length".to_string())?;
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).map_err(|e| e.to_string())?;
    serde_json::from_slice(&buf).map_err(|e| e.to_string())
}

fn handle_incoming(
    msg: Value,
    pending: &Arc<Mutex<HashMap<u64, Pending>>>,
    on_diag: &mut DiagHandler,
) {
    if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
        if let Ok(mut map) = pending.lock() {
            if let Some(p) = map.remove(&id) {
                if let Some(err) = msg.get("error") {
                    let _ = p.tx.send(Err(err.to_string()));
                } else {
                    let result = msg.get("result").cloned().unwrap_or(Value::Null);
                    let _ = p.tx.send(Ok(result));
                }
            }
        }
        return;
    }

    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
    if method == "textDocument/publishDiagnostics" {
        if let Some(params) = msg.get("params") {
            let uri = params
                .get("uri")
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string();
            let diags: Vec<lsp_types::Diagnostic> = params
                .get("diagnostics")
                .cloned()
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            on_diag(uri, diags);
        }
    }
}

fn wait_response(rx: Receiver<Result<Value, String>>, timeout: Duration) -> Result<Value, String> {
    let start = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(result) => return result,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if start.elapsed() > timeout {
                    return Err("LSP request timed out".into());
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err("LSP channel disconnected".into());
            }
        }
    }
}

fn symbol_kind_name(kind: u64) -> &'static str {
    match kind {
        5 => "class",
        6 => "method",
        10 => "enum",
        11 => "interface",
        12 => "function",
        13 => "variable",
        14 => "constant",
        23 => "struct",
        26 => "type",
        _ => "symbol",
    }
}

fn parse_document_symbols(value: &Value) -> Vec<FlatSymbol> {
    let mut out = Vec::new();
    flatten_symbols(value, &mut out);
    out
}

fn flatten_symbols(value: &Value, out: &mut Vec<FlatSymbol>) {
    let Some(arr) = value.as_array() else {
        return;
    };
    for item in arr {
        // DocumentSymbol has selectionRange / range / name / kind / children
        if let Some(name) = item.get("name").and_then(|n| n.as_str()) {
            let kind = item
                .get("kind")
                .and_then(|k| k.as_u64())
                .map(symbol_kind_name)
                .unwrap_or("symbol");
            let line = item
                .get("selectionRange")
                .or_else(|| item.get("range"))
                .or_else(|| item.get("location").and_then(|l| l.get("range")))
                .and_then(|r| r.get("start"))
                .and_then(|s| s.get("line"))
                .and_then(|l| l.as_u64())
                .map(|l| (l as u32) + 1)
                .unwrap_or(1);
            out.push(FlatSymbol {
                name: name.to_string(),
                kind: kind.to_string(),
                line,
            });
            if let Some(children) = item.get("children") {
                flatten_symbols(children, out);
            }
        }
    }
}

fn parse_locations(value: &Value) -> Vec<RefLocation> {
    let Some(arr) = value.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in arr {
        let Some(uri) = item.get("uri").and_then(|u| u.as_str()) else {
            continue;
        };
        let Ok(range) = serde_json::from_value::<lsp_types::Range>(
            item.get("range").cloned().unwrap_or(Value::Null),
        ) else {
            continue;
        };
        out.push(RefLocation {
            uri: uri.to_string(),
            range,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::parse_locations;
    use serde_json::json;

    #[test]
    fn parses_reference_locations() {
        let value = json!([{
            "uri": "file:///tmp/a.ts",
            "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 1 } }
        }]);
        assert_eq!(parse_locations(&value).len(), 1);
    }
}
