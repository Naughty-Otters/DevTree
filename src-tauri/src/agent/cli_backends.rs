//! Headless Claude Code / Codex / Gemini CLI backends for AI validation.
//!
//! Spawns a new process per run (reuses machine-local CLI auth). The CLI owns
//! its own tools; DevTree maps stream events into `ValidationStreamEvent`.

use crate::agent::run::ValidationStreamEvent;
use crate::agent::types::LlmProvider;
use crate::agent::workspace::ProjectWorkspace;
use crate::linter::{enrich_path, resolve_which};
use crate::lsp::build_enriched_path;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const FINDINGS_SCHEMA_JSON: &str = r#"{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "rule_id": { "type": "string" },
          "status": { "type": "string" },
          "message": { "type": "string" },
          "affected": {
            "type": "array",
            "items": { "type": "string" }
          }
        },
        "required": ["status", "message"]
      }
    }
  },
  "required": ["items"]
}"#;

/// Per-item text already emitted for Codex `item.updated` / `item.completed` streams.
#[derive(Default)]
struct CliStreamState {
    codex_item_text: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliBackendProbe {
    pub provider: LlmProvider,
    pub binary_name: String,
    pub found: bool,
    pub path: Option<String>,
    pub hint: String,
}

pub struct CliValidationConfig<'a> {
    pub provider: LlmProvider,
    pub preamble: &'a str,
    pub prompt: &'a str,
    pub workspace: &'a ProjectWorkspace,
    pub max_turns: u32,
    pub cancel: &'a AtomicBool,
    pub on_event: &'a (dyn Fn(ValidationStreamEvent) + Send + Sync),
}

pub fn binary_name(provider: &LlmProvider) -> Option<&'static str> {
    match provider {
        LlmProvider::ClaudeCode => Some("claude"),
        LlmProvider::Codex => Some("codex"),
        LlmProvider::GeminiCli => Some("gemini"),
        _ => None,
    }
}

pub fn install_hint(provider: &LlmProvider) -> String {
    match provider {
        LlmProvider::ClaudeCode => {
            "Install Claude Code and ensure `claude` is on PATH, then run `claude` once to log in."
                .into()
        }
        LlmProvider::Codex => {
            "Install the OpenAI Codex CLI and ensure `codex` is on PATH, then run `codex login`."
                .into()
        }
        LlmProvider::GeminiCli => {
            "Install Gemini CLI and ensure `gemini` is on PATH, then sign in (Google login or GEMINI_API_KEY)."
                .into()
        }
        _ => "Not a CLI LLM backend.".into(),
    }
}

pub fn resolve_cli_binary(provider: &LlmProvider) -> Result<PathBuf, String> {
    enrich_path();
    let name = binary_name(provider).ok_or_else(|| format!("{provider:?} is not a CLI backend"))?;
    resolve_which(name)
        .map(PathBuf::from)
        .ok_or_else(|| format!("`{name}` not found on PATH. {}", install_hint(provider)))
}

pub fn probe_cli_backend(provider: LlmProvider) -> Result<CliBackendProbe, String> {
    let Some(name) = binary_name(&provider) else {
        return Err("Provider is not a CLI coding-agent backend".into());
    };
    let path = resolve_which(name);
    let found = path.is_some();
    let hint = if found {
        format!(
            "Found `{name}` — DevTree will spawn a headless session using your local CLI login (does not attach to an open TUI)."
        )
    } else {
        install_hint(&provider)
    };
    Ok(CliBackendProbe {
        provider,
        binary_name: name.into(),
        found,
        path,
        hint,
    })
}

/// Preamble for CLI-owned tools (no Rig workspace tool names).
pub fn cli_validation_preamble_base() -> &'static str {
    "You are DevTree's automated AI validation engine. Work only inside the opened project workspace. \
Use your built-in tools to inspect the codebase. Do not modify project files. Prefer read-only exploration \
(read, grep, limited shell). Stay within the current project root. Do NOT run full test suites or long installs.\n\n"
}

/// Run a headless CLI validation session and map stream events into `on_event`.
pub async fn run_cli_validation(config: CliValidationConfig<'_>) -> Result<String, String> {
    let provider = config.provider.clone();
    let preamble = config.preamble.to_string();
    let prompt = config.prompt.to_string();
    let root = config.workspace.root.clone();
    let max_turns = config.max_turns;
    let cancel_flag = std::sync::Arc::new(AtomicBool::new(false));
    let cancel_for_child = std::sync::Arc::clone(&cancel_flag);
    let source_cancel = config.cancel;

    let (tx, rx) = mpsc::channel::<ValidationStreamEvent>();

    let worker = thread::spawn(move || {
        run_cli_validation_blocking(
            provider,
            &preamble,
            &prompt,
            &root,
            max_turns,
            &cancel_for_child,
            |event| {
                let _ = tx.send(event);
            },
        )
    });

    let on_event = config.on_event;
    loop {
        if source_cancel.load(Ordering::Relaxed) {
            cancel_flag.store(true, Ordering::Relaxed);
        }

        match rx.recv_timeout(Duration::from_millis(40)) {
            Ok(event) => on_event(event),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if worker.is_finished() {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        if worker.is_finished() {
            while let Ok(event) = rx.try_recv() {
                on_event(event);
            }
            break;
        }

        tokio::task::yield_now().await;
    }

    worker
        .join()
        .map_err(|_| "CLI validation worker panicked".to_string())?
}

fn run_cli_validation_blocking(
    provider: LlmProvider,
    preamble: &str,
    prompt: &str,
    root: &Path,
    max_turns: u32,
    cancel: &AtomicBool,
    mut on_event: impl FnMut(ValidationStreamEvent),
) -> Result<String, String> {
    let binary = resolve_cli_binary(&provider)?;
    let combined = format!("{preamble}\n\n{prompt}\n");
    let schema_path = if provider == LlmProvider::Codex {
        Some(write_temp_schema()?)
    } else {
        None
    };

    let mut command = match provider {
        LlmProvider::ClaudeCode => build_claude_command(&binary, root, max_turns),
        LlmProvider::Codex => build_codex_command(
            &binary,
            root,
            schema_path.as_ref().expect("codex schema"),
        ),
        LlmProvider::GeminiCli => build_gemini_command(&binary, root),
        _ => return Err("Not a CLI backend".into()),
    };

    command.env("PATH", build_enriched_path());

    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start {}: {e}", binary.display()))?;

    let provider_label = match provider {
        LlmProvider::ClaudeCode => "claude",
        LlmProvider::Codex => "codex",
        LlmProvider::GeminiCli => "gemini",
        _ => "cli",
    };
    on_event(ValidationStreamEvent::ToolActivity(format!(
        "{provider_label}:session started"
    )));

    if let Some(mut stdin) = child.stdin.take() {
        if let Err(err) = stdin.write_all(combined.as_bytes()) {
            kill_child(&mut child);
            if let Some(path) = &schema_path {
                let _ = std::fs::remove_file(path);
            }
            return Err(format!("Failed to write prompt to CLI stdin: {err}"));
        }
        drop(stdin);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "CLI process missing stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "CLI process missing stderr".to_string())?;

    let (line_tx, line_rx) = mpsc::channel::<String>();
    let stdout_thread = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            let _ = line_tx.send(line);
        }
    });

    let (stderr_tx, stderr_rx) = mpsc::channel::<String>();
    let stderr_thread = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            let _ = stderr_tx.send(line);
        }
    });

    let mut final_text = String::new();
    let mut accumulated_text = String::new();
    let mut stream_state = CliStreamState::default();

    loop {
        if cancel.load(Ordering::Relaxed) {
            kill_child(&mut child);
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();
            if let Some(path) = &schema_path {
                let _ = std::fs::remove_file(path);
            }
            return Err("AI validation cancelled".into());
        }

        while let Ok(line) = stderr_rx.try_recv() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            on_event(ValidationStreamEvent::ToolOutputDelta(format!(
                "{trimmed}\n"
            )));
        }

        while let Ok(line) = line_rx.try_recv() {
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            apply_stream_line(
                &provider,
                &line,
                &mut stream_state,
                &mut on_event,
                &mut final_text,
                &mut accumulated_text,
            );
        }

        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => thread::sleep(Duration::from_millis(30)),
            Err(err) => {
                kill_child(&mut child);
                if let Some(path) = &schema_path {
                    let _ = std::fs::remove_file(path);
                }
                return Err(format!("Failed waiting for CLI: {err}"));
            }
        }
    }

    // Drain remaining stdout after the process exits.
    let _ = child.wait();
    let _ = stdout_thread.join();
    while let Ok(line) = stderr_rx.try_recv() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        on_event(ValidationStreamEvent::ToolOutputDelta(format!(
            "{trimmed}\n"
        )));
    }
    while let Ok(line) = line_rx.try_recv() {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        apply_stream_line(
            &provider,
            &line,
            &mut stream_state,
            &mut on_event,
            &mut final_text,
            &mut accumulated_text,
        );
    }

    let mut stderr_text = String::new();
    let _ = stderr_thread.join();
    while let Ok(line) = stderr_rx.try_recv() {
        if !stderr_text.is_empty() {
            stderr_text.push('\n');
        }
        stderr_text.push_str(line.trim());
        if stderr_text.len() > 32_000 {
            break;
        }
    }
    if let Some(path) = &schema_path {
        let _ = std::fs::remove_file(path);
    }

    if cancel.load(Ordering::Relaxed) {
        return Err("AI validation cancelled".into());
    }

    if final_text.trim().is_empty() && !accumulated_text.trim().is_empty() {
        final_text = accumulated_text;
    }

    if final_text.trim().is_empty() {
        if let Some(last) = stderr_text
            .lines()
            .rev()
            .find(|l| l.trim().starts_with('{'))
        {
            final_text = last.to_string();
        }
    }

    if final_text.trim().is_empty() {
        let detail = if stderr_text.trim().is_empty() {
            install_hint(&provider)
        } else {
            stderr_text.trim().to_string()
        };
        return Err(format!("CLI produced no final text. {detail}"));
    }

    Ok(final_text)
}

fn apply_stream_line(
    provider: &LlmProvider,
    line: &str,
    state: &mut CliStreamState,
    on_event: &mut impl FnMut(ValidationStreamEvent),
    final_text: &mut String,
    accumulated_text: &mut String,
) {
    let parsed = match provider {
        LlmProvider::ClaudeCode => parse_claude_stream_line(line),
        LlmProvider::Codex => parse_codex_stream_line(line, &mut state.codex_item_text),
        LlmProvider::GeminiCli => {
            let parsed = parse_gemini_stream_line(line);
            if matches!(parsed, StreamLine::Ignore) && !line.trim().is_empty() {
                StreamLine::TextDelta(format!("{line}\n"))
            } else {
                parsed
            }
        }
        _ => StreamLine::Ignore,
    };
    match parsed {
        StreamLine::Events(events) => {
            for event in events {
                on_event(event);
            }
        }
        StreamLine::TextDelta(delta) => {
            accumulated_text.push_str(&delta);
            on_event(ValidationStreamEvent::TextDelta(delta));
        }
        StreamLine::Final(text) => {
            if text.trim().is_empty() {
                return;
            }
            *final_text = text.clone();
            if *accumulated_text == text {
                return;
            }
            if text.starts_with(accumulated_text.as_str()) {
                let delta = text[accumulated_text.len()..].to_string();
                if !delta.is_empty() {
                    accumulated_text.push_str(&delta);
                    on_event(ValidationStreamEvent::TextDelta(delta));
                }
            } else {
                *accumulated_text = text.clone();
                on_event(ValidationStreamEvent::TextDelta(text));
            }
        }
        StreamLine::Ignore => {}
    }
}

fn write_temp_schema() -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!(
        "devtree-ai-findings-schema-{}.json",
        std::process::id()
    ));
    std::fs::write(&path, FINDINGS_SCHEMA_JSON)
        .map_err(|e| format!("Failed to write output schema: {e}"))?;
    Ok(path)
}

fn build_claude_command(binary: &Path, root: &Path, max_turns: u32) -> Command {
    let mut cmd = Command::new(binary);
    // Do not pass --json-schema: it hangs with piped stdout (no stream-json for minutes).
    // JSON output is enforced via the validation prompt contract instead.
    cmd.current_dir(root)
        .arg("-p")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .arg("--include-partial-messages")
        .arg("--permission-mode")
        .arg("bypassPermissions")
        .arg("--max-turns")
        .arg(max_turns.max(1).to_string());
    cmd
}

fn build_codex_command(binary: &Path, root: &Path, schema_path: &Path) -> Command {
    let mut cmd = Command::new(binary);
    cmd.current_dir(root)
        .arg("exec")
        .arg("--json")
        .arg("--skip-git-repo-check")
        .arg("--full-auto")
        .arg("--output-schema")
        .arg(schema_path)
        .arg("-");
    cmd
}

fn build_gemini_command(binary: &Path, root: &Path) -> Command {
    let mut cmd = Command::new(binary);
    // Gemini CLI 0.5.x has no --output-format stream-json; use YOLO + stdin prompt.
    cmd.current_dir(root).arg("-y");
    cmd
}

#[cfg(unix)]
fn kill_child(child: &mut Child) {
    let pid = child.id();
    let _ = Command::new("kill")
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

#[cfg(windows)]
fn kill_child(child: &mut Child) {
    let pid = child.id();
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

#[derive(Debug)]
enum StreamLine {
    Ignore,
    Events(Vec<ValidationStreamEvent>),
    TextDelta(String),
    Final(String),
}

fn parse_claude_stream_line(line: &str) -> StreamLine {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        if line.trim_start().starts_with('{') {
            return StreamLine::TextDelta(line.to_string());
        }
        return StreamLine::Ignore;
    };

    let type_str = value.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match type_str {
        "system" => {
            let subtype = value.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
            if subtype == "init" {
                let model = value
                    .get("model")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown");
                let api_key = value
                    .get("apiKeySource")
                    .and_then(|s| s.as_str())
                    .unwrap_or("unknown");
                return StreamLine::Events(vec![ValidationStreamEvent::ToolActivity(
                    format!("claude:connected ({model}, auth={api_key})"),
                )]);
            }
            StreamLine::Ignore
        }
        "assistant" => {
            let mut events = Vec::new();
            if let Some(err) = value.get("error").and_then(|e| e.as_str()) {
                events.push(ValidationStreamEvent::ToolOutputDelta(format!(
                    "Claude error: {err}\n"
                )));
            }
            if let Some(content) = value
                .pointer("/message/content")
                .and_then(|c| c.as_array())
            {
                for block in content {
                    let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    match block_type {
                        "text" => {
                            if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                                events.push(ValidationStreamEvent::TextDelta(t.to_string()));
                            }
                        }
                        "tool_use" => {
                            let name = block
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("tool");
                            events.push(ValidationStreamEvent::ToolActivity(format!(
                                "claude:{name}"
                            )));
                        }
                        "thinking" => {
                            if let Some(t) = block.get("thinking").and_then(|t| t.as_str()) {
                                events.push(ValidationStreamEvent::ThinkingDelta(t.to_string()));
                            }
                        }
                        _ => {}
                    }
                }
            }
            if events.is_empty() {
                StreamLine::Ignore
            } else {
                StreamLine::Events(events)
            }
        }
        "content_block_delta" => {
            if let Some(delta) = value.get("delta") {
                let dtype = delta.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if dtype == "text_delta" || dtype.is_empty() {
                    if let Some(t) = delta.get("text").and_then(|t| t.as_str()) {
                        return StreamLine::TextDelta(t.to_string());
                    }
                }
                if dtype == "thinking_delta" {
                    if let Some(t) = delta.get("thinking").and_then(|t| t.as_str()) {
                        return StreamLine::Events(vec![ValidationStreamEvent::ThinkingDelta(
                            t.to_string(),
                        )]);
                    }
                }
            }
            StreamLine::Ignore
        }
        "stream_event" => {
            if let Some(event) = value.get("event") {
                let event_type = event.get("type").and_then(|t| t.as_str()).unwrap_or("");
                match event_type {
                    "content_block_delta" => {
                        if let Some(delta) = event.get("delta") {
                            let dtype = delta.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            if dtype == "text_delta" {
                                if let Some(t) = delta.get("text").and_then(|t| t.as_str()) {
                                    return StreamLine::TextDelta(t.to_string());
                                }
                            }
                            if dtype == "thinking_delta" {
                                if let Some(t) = delta.get("thinking").and_then(|t| t.as_str()) {
                                    return StreamLine::Events(vec![
                                        ValidationStreamEvent::ThinkingDelta(t.to_string()),
                                    ]);
                                }
                            }
                        }
                    }
                    "content_block_start" => {
                        if let Some(block) = event.get("content_block") {
                            if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                let name = block
                                    .get("name")
                                    .and_then(|n| n.as_str())
                                    .unwrap_or("tool");
                                return StreamLine::Events(vec![
                                    ValidationStreamEvent::ToolActivity(format!("claude:{name}")),
                                ]);
                            }
                        }
                    }
                    _ => {}
                }
            }
            StreamLine::Ignore
        }
        "result" => {
            if let Some(result) = value.get("result").and_then(|r| r.as_str()) {
                StreamLine::Final(result.to_string())
            } else if let Some(result) = value.get("result") {
                StreamLine::Final(result.to_string())
            } else {
                StreamLine::Ignore
            }
        }
        "tool_use" | "tool_call" => {
            let name = value
                .get("name")
                .or_else(|| value.pointer("/tool_use/name"))
                .and_then(|n| n.as_str())
                .unwrap_or("tool");
            StreamLine::Events(vec![ValidationStreamEvent::ToolActivity(format!(
                "claude:{name}"
            ))])
        }
        _ => {
            if let Some(text) = value.get("result").and_then(|r| r.as_str()) {
                StreamLine::Final(text.to_string())
            } else {
                StreamLine::Ignore
            }
        }
    }
}

fn parse_codex_stream_line(line: &str, item_text: &mut HashMap<String, String>) -> StreamLine {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return StreamLine::Ignore;
    };

    let type_str = value.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match type_str {
        "thread.started" => StreamLine::Events(vec![ValidationStreamEvent::ToolActivity(
            "codex:thread started".into(),
        )]),
        "turn.started" => StreamLine::Events(vec![ValidationStreamEvent::ToolActivity(
            "codex:turn started".into(),
        )]),
        "item.started" | "item.updated" | "item.completed" => {
            let item = value.get("item").cloned().unwrap_or(serde_json::json!({}));
            let item_id = item
                .get("id")
                .and_then(|id| id.as_str())
                .unwrap_or("")
                .to_string();
            let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
            match item_type {
                "agent_message" | "message" | "assistant_message" => {
                    if let Some(text) = item
                        .get("text")
                        .or_else(|| item.get("content"))
                        .and_then(|t| t.as_str())
                    {
                        if type_str == "item.completed" {
                            item_text.insert(item_id, text.to_string());
                            return StreamLine::Final(text.to_string());
                        }
                        let previous = item_text.get(&item_id).map(String::as_str).unwrap_or("");
                        if text.len() > previous.len() && text.starts_with(previous) {
                            let delta = text[previous.len()..].to_string();
                            if !delta.is_empty() {
                                item_text.insert(item_id, text.to_string());
                                return StreamLine::TextDelta(delta);
                            }
                        } else if text != previous {
                            item_text.insert(item_id, text.to_string());
                            return StreamLine::TextDelta(text.to_string());
                        }
                    }
                }
                "reasoning" => {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        return StreamLine::Events(vec![ValidationStreamEvent::ThinkingDelta(
                            text.to_string(),
                        )]);
                    }
                }
                "command_execution" => {
                    let name = item
                        .get("command")
                        .or_else(|| item.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("command");
                    let mut events = vec![ValidationStreamEvent::ToolActivity(format!(
                        "codex:{name}"
                    ))];
                    if let Some(output) = item.get("aggregated_output").and_then(|o| o.as_str()) {
                        let previous = item_text
                            .get(&format!("{item_id}:output"))
                            .map(String::as_str)
                            .unwrap_or("");
                        if output.len() > previous.len() && output.starts_with(previous) {
                            let delta = output[previous.len()..].to_string();
                            if !delta.is_empty() {
                                item_text.insert(format!("{item_id}:output"), output.to_string());
                                events.push(ValidationStreamEvent::ToolOutputDelta(delta));
                            }
                        }
                    }
                    return StreamLine::Events(events);
                }
                "mcp_tool_call" => {
                    let server = item.get("server").and_then(|s| s.as_str()).unwrap_or("mcp");
                    let tool = item.get("tool").and_then(|t| t.as_str()).unwrap_or("tool");
                    return StreamLine::Events(vec![ValidationStreamEvent::ToolActivity(
                        format!("codex:{server}/{tool}"),
                    )]);
                }
                "file_change" => {
                    let count = item
                        .get("changes")
                        .and_then(|c| c.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    return StreamLine::Events(vec![ValidationStreamEvent::ToolActivity(
                        format!("codex:file_change ({count})"),
                    )]);
                }
                "web_search" => {
                    let query = item.get("query").and_then(|q| q.as_str()).unwrap_or("search");
                    return StreamLine::Events(vec![ValidationStreamEvent::ToolActivity(
                        format!("codex:web_search:{query}"),
                    )]);
                }
                "tool_call" | "function_call" => {
                    let name = item
                        .get("command")
                        .or_else(|| item.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("tool");
                    return StreamLine::Events(vec![ValidationStreamEvent::ToolActivity(
                        format!("codex:{name}"),
                    )]);
                }
                _ => {}
            }
            StreamLine::Ignore
        }
        "thread.completed" | "turn.completed" => {
            if let Some(text) = value
                .pointer("/last_agent_message")
                .and_then(|t| t.as_str())
                .or_else(|| value.get("message").and_then(|t| t.as_str()))
            {
                StreamLine::Final(text.to_string())
            } else {
                StreamLine::Ignore
            }
        }
        "agent_message" => {
            if let Some(text) = value.get("text").and_then(|t| t.as_str()) {
                StreamLine::Final(text.to_string())
            } else {
                StreamLine::Ignore
            }
        }
        "error" | "turn.failed" => {
            let msg = value
                .get("message")
                .or_else(|| value.pointer("/error/message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Codex error");
            StreamLine::Events(vec![ValidationStreamEvent::ToolOutputDelta(format!(
                "{msg}\n"
            ))])
        }
        _ => StreamLine::Ignore,
    }
}

fn parse_gemini_stream_line(line: &str) -> StreamLine {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return StreamLine::Ignore;
    };

    let type_str = value.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match type_str {
        "message" => {
            let role = value.get("role").and_then(|r| r.as_str()).unwrap_or("");
            let content = value
                .get("content")
                .or_else(|| value.get("delta"))
                .and_then(|c| {
                    if c.is_string() {
                        c.as_str().map(|s| s.to_string())
                    } else {
                        None
                    }
                })
                .unwrap_or_default();
            if (role == "assistant" || role.is_empty()) && !content.is_empty() {
                let is_delta = value
                    .get("delta")
                    .and_then(|d| d.as_bool())
                    .unwrap_or(true);
                if is_delta {
                    return StreamLine::TextDelta(content);
                }
                return StreamLine::Final(content);
            }
            StreamLine::Ignore
        }
        "tool_use" | "tool_call" => {
            let name = value
                .get("tool_name")
                .or_else(|| value.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("tool");
            StreamLine::Events(vec![ValidationStreamEvent::ToolActivity(format!(
                "gemini:{name}"
            ))])
        }
        "tool_result" => {
            let snippet = value
                .get("output")
                .or_else(|| value.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("");
            if snippet.is_empty() {
                StreamLine::Ignore
            } else {
                let clipped: String = snippet.chars().take(500).collect();
                StreamLine::Events(vec![ValidationStreamEvent::ToolOutputDelta(format!(
                    "{clipped}\n"
                ))])
            }
        }
        "result" => {
            if let Some(output) = value
                .get("response")
                .or_else(|| value.get("output"))
                .or_else(|| value.get("result"))
                .and_then(|o| o.as_str())
            {
                StreamLine::Final(output.to_string())
            } else if let Some(output) = value.get("response").or_else(|| value.get("output")) {
                StreamLine::Final(output.to_string())
            } else {
                StreamLine::Ignore
            }
        }
        "error" => {
            let msg = value
                .get("error")
                .or_else(|| value.get("message"))
                .map(|e| e.to_string())
                .unwrap_or_else(|| "Gemini CLI error".into());
            StreamLine::Events(vec![ValidationStreamEvent::ToolOutputDelta(format!(
                "{msg}\n"
            ))])
        }
        _ => StreamLine::Ignore,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_names_for_cli_providers() {
        assert_eq!(binary_name(&LlmProvider::ClaudeCode), Some("claude"));
        assert_eq!(binary_name(&LlmProvider::Codex), Some("codex"));
        assert_eq!(binary_name(&LlmProvider::GeminiCli), Some("gemini"));
        assert_eq!(binary_name(&LlmProvider::Openai), None);
    }

    #[test]
    fn parses_claude_result_and_text_delta() {
        let result = parse_claude_stream_line(
            r#"{"type":"result","result":"{\"items\":[{\"rule_id\":\"ai_architecture\",\"status\":\"pass\",\"message\":\"ok\",\"affected\":[]}]}"}"#,
        );
        match result {
            StreamLine::Final(text) => assert!(text.contains("items")),
            other => panic!("expected Final, got {other:?}"),
        }

        let delta = parse_claude_stream_line(
            r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}"#,
        );
        match delta {
            StreamLine::TextDelta(t) => assert_eq!(t, "hello"),
            other => panic!("expected TextDelta, got {other:?}"),
        }
    }

    #[test]
    fn parses_claude_tool_activity() {
        let line =
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}"#;
        match parse_claude_stream_line(line) {
            StreamLine::Events(events) => {
                assert!(matches!(
                    &events[0],
                    ValidationStreamEvent::ToolActivity(s) if s.contains("Read")
                ));
            }
            other => panic!("expected Events, got {other:?}"),
        }
    }

    #[test]
    fn parses_claude_system_init() {
        let line = r#"{"type":"system","subtype":"init","model":"claude-sonnet-4-6","apiKeySource":"none"}"#;
        match parse_claude_stream_line(line) {
            StreamLine::Events(events) => {
                assert!(matches!(
                    &events[0],
                    ValidationStreamEvent::ToolActivity(s) if s.contains("connected")
                ));
            }
            other => panic!("expected Events, got {other:?}"),
        }
    }

    #[test]
    fn parses_codex_agent_message() {
        let line =
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"{\"items\":[]}"}}"#;
        let mut item_text = HashMap::new();
        match parse_codex_stream_line(line, &mut item_text) {
            StreamLine::Final(text) => assert!(text.contains("items")),
            other => panic!("expected Final, got {other:?}"),
        }
    }

    #[test]
    fn parses_codex_incremental_agent_message() {
        let mut item_text = HashMap::new();
        let started = r#"{"type":"item.updated","item":{"id":"m1","type":"agent_message","text":"hel"}}"#;
        match parse_codex_stream_line(started, &mut item_text) {
            StreamLine::TextDelta(delta) => assert_eq!(delta, "hel"),
            other => panic!("expected TextDelta, got {other:?}"),
        }
        let updated = r#"{"type":"item.updated","item":{"id":"m1","type":"agent_message","text":"hello"}}"#;
        match parse_codex_stream_line(updated, &mut item_text) {
            StreamLine::TextDelta(delta) => assert_eq!(delta, "lo"),
            other => panic!("expected TextDelta, got {other:?}"),
        }
    }

    #[test]
    fn parses_claude_stream_event_text_delta() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}}"#;
        match parse_claude_stream_line(line) {
            StreamLine::TextDelta(delta) => assert_eq!(delta, "hi"),
            other => panic!("expected TextDelta, got {other:?}"),
        }
    }

    #[test]
    fn parses_gemini_result_and_tool() {
        let result = parse_gemini_stream_line(
            r#"{"type":"result","response":"{\"items\":[{\"status\":\"pass\",\"message\":\"ok\"}]}"}"#,
        );
        match result {
            StreamLine::Final(text) => assert!(text.contains("pass")),
            other => panic!("expected Final, got {other:?}"),
        }

        let tool = parse_gemini_stream_line(r#"{"type":"tool_use","tool_name":"read_file"}"#);
        match tool {
            StreamLine::Events(events) => {
                assert!(matches!(
                    &events[0],
                    ValidationStreamEvent::ToolActivity(s) if s.contains("read_file")
                ));
            }
            other => panic!("expected Events, got {other:?}"),
        }
    }

    #[test]
    fn probe_unknown_provider_errors() {
        assert!(probe_cli_backend(LlmProvider::Openai).is_err());
    }

    #[test]
    fn probe_cli_provider_reports_binary_name() {
        let probe = probe_cli_backend(LlmProvider::ClaudeCode).unwrap();
        assert_eq!(probe.binary_name, "claude");
    }
}
