use super::workspace::{ProjectWorkspace, WorkspaceToolError};
use rig_agent::agent::{AgentBuilder, NoToolConfig, WithBuilderTools};
use rig_agent::completion::CompletionModel;
use rig_agent::tool::{Tool, ToolContext};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::timeout;

/// Optional Progress sink so long-running tools (shell) can stream output live.
#[derive(Clone)]
pub struct ToolOutputReporter {
    emit: Arc<dyn Fn(String) + Send + Sync>,
}

impl ToolOutputReporter {
    pub fn new(emit: Arc<dyn Fn(String) + Send + Sync>) -> Self {
        Self { emit }
    }

    pub fn emit(&self, chunk: impl Into<String>) {
        (self.emit)(chunk.into());
    }
}

fn tool_output_reporter(ctx: &ToolContext) -> Option<ToolOutputReporter> {
    ctx.get::<ToolOutputReporter>().cloned()
}

#[derive(Clone)]
struct WorkspaceCtx {
    workspace: ProjectWorkspace,
}

fn workspace_from_context(ctx: &ToolContext) -> Result<WorkspaceCtx, WorkspaceToolError> {
    let workspace = ctx
        .require::<ProjectWorkspace>()
        .map_err(|_| WorkspaceToolError("Missing project workspace context".into()))?
        .clone();
    Ok(WorkspaceCtx { workspace })
}

#[derive(Deserialize)]
struct ReadFilesArgs {
    paths: Vec<String>,
}

#[derive(Serialize)]
struct ReadFilesOutput {
    files: Vec<ReadFileEntry>,
}

#[derive(Serialize)]
struct ReadFileEntry {
    path: String,
    content: Option<String>,
    error: Option<String>,
}

struct ReadFilesTool;

impl Tool for ReadFilesTool {
    const NAME: &'static str = "read_files";
    type Args = ReadFilesArgs;
    type Output = ReadFilesOutput;
    type Error = WorkspaceToolError;

    fn description(&self) -> String {
        "Read one or more text files relative to the project root. \
Paths may include editor location suffixes (`file.py:60`, `file.py:60-68`, `file.py:60:1`); \
those open the file and optionally return only the requested lines."
            .into()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "paths": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Project-relative file paths (optional :line or :start-end suffix)"
                }
            },
            "required": ["paths"]
        })
    }

    async fn call(
        &self,
        context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let ws = workspace_from_context(context)?;
        let mut files = Vec::new();
        for path in args.paths {
            match ws.workspace.resolve_relative_with_location(&path) {
                Ok((full, range)) => {
                    if !full.is_file() {
                        let (clean, _) = super::workspace::split_path_and_location(&path);
                        files.push(ReadFileEntry {
                            path,
                            content: None,
                            error: Some(format!("Not a file: {clean}")),
                        });
                        continue;
                    }
                    match fs::read_to_string(&full) {
                        Ok(content) => {
                            let content = if let Some(range) = range {
                                let sliced = super::workspace::slice_line_range(&content, range);
                                format!(
                                    "[lines {}-{} of {}]\n{}",
                                    range.start, range.end, clean_path_label(&path), sliced
                                )
                            } else {
                                content
                            };
                            files.push(ReadFileEntry {
                                path,
                                content: Some(content),
                                error: None,
                            });
                        }
                        Err(err) => files.push(ReadFileEntry {
                            path,
                            content: None,
                            error: Some(err.to_string()),
                        }),
                    }
                }
                Err(err) => files.push(ReadFileEntry {
                    path,
                    content: None,
                    error: Some(err.to_string()),
                }),
            }
        }
        Ok(ReadFilesOutput { files })
    }
}

fn clean_path_label(path: &str) -> String {
    super::workspace::split_path_and_location(path).0
}

#[derive(Deserialize)]
struct EditFilesArgs {
    path: String,
    content: String,
}

#[derive(Serialize)]
struct EditFilesOutput {
    path: String,
    bytes_written: usize,
}

struct EditFilesTool;

impl Tool for EditFilesTool {
    const NAME: &'static str = "edit_files";
    type Args = EditFilesArgs;
    type Output = EditFilesOutput;
    type Error = WorkspaceToolError;

    fn description(&self) -> String {
        "Write or overwrite a text file relative to the project root.".into()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "content": { "type": "string" }
            },
            "required": ["path", "content"]
        })
    }

    async fn call(
        &self,
        context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let ws = workspace_from_context(context)?;
        let full = ws.workspace.resolve_relative(&args.path)?;
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| WorkspaceToolError(format!("Failed to create parent dirs: {err}")))?;
        }
        fs::write(&full, &args.content)
            .map_err(|err| WorkspaceToolError(format!("Failed to write file: {err}")))?;
        Ok(EditFilesOutput {
            path: args.path,
            bytes_written: args.content.len(),
        })
    }
}

#[derive(Deserialize)]
struct GrepArgs {
    pattern: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default = "default_grep_limit")]
    limit: usize,
}

fn default_grep_limit() -> usize {
    50
}

#[derive(Serialize)]
struct GrepMatch {
    path: String,
    line: usize,
    text: String,
}

#[derive(Serialize)]
struct GrepOutput {
    matches: Vec<GrepMatch>,
    truncated: bool,
}

struct GrepTool;

impl Tool for GrepTool {
    const NAME: &'static str = "grep";
    type Args = GrepArgs;
    type Output = GrepOutput;
    type Error = WorkspaceToolError;

    fn description(&self) -> String {
        "Search for a regex pattern in project files.".into()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string" },
                "path": {
                    "type": "string",
                    "description": "Optional project-relative directory or file to search"
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of matches to return"
                }
            },
            "required": ["pattern"]
        })
    }

    async fn call(
        &self,
        context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let ws = workspace_from_context(context)?;
        let regex = regex::Regex::new(&args.pattern)
            .map_err(|err| WorkspaceToolError(format!("Invalid regex: {err}")))?;
        let limit = args.limit.clamp(1, 200);
        let start = match args.path.as_deref() {
            Some(path) => ws.workspace.resolve_relative(path)?,
            None => ws.workspace.root.clone(),
        };

        let mut matches = Vec::new();
        let mut truncated = false;
        collect_grep_matches(&start, &ws.workspace.root, &regex, limit, &mut matches, &mut truncated)?;
        Ok(GrepOutput { matches, truncated })
    }
}

fn collect_grep_matches(
    start: &PathBuf,
    root: &PathBuf,
    regex: &regex::Regex,
    limit: usize,
    matches: &mut Vec<GrepMatch>,
    truncated: &mut bool,
) -> Result<(), WorkspaceToolError> {
    if start.is_file() {
        scan_file(start, root, regex, limit, matches, truncated)?;
        return Ok(());
    }

    if !start.is_dir() {
        return Err(WorkspaceToolError(format!(
            "Search path does not exist: {}",
            start.display()
        )));
    }

    let mut stack = vec![start.clone()];
    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir)
            .map_err(|err| WorkspaceToolError(format!("Failed to read directory: {err}")))?;
        for entry in entries {
            if *truncated || matches.len() >= limit {
                *truncated = true;
                return Ok(());
            }
            let entry = entry
                .map_err(|err| WorkspaceToolError(format!("Failed to read directory entry: {err}")))?;
            let path = entry.path();
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();
            if path.is_dir() {
                if should_skip_search_dir(&name) {
                    continue;
                }
                stack.push(path);
            } else if path.is_file() {
                scan_file(&path, root, regex, limit, matches, truncated)?;
            }
        }
    }
    Ok(())
}

fn should_skip_search_dir(name: &str) -> bool {
    super::workspace::should_skip_dir(name) || name.starts_with('.')
}

fn scan_file(
    path: &PathBuf,
    root: &PathBuf,
    regex: &regex::Regex,
    limit: usize,
    matches: &mut Vec<GrepMatch>,
    truncated: &mut bool,
) -> Result<(), WorkspaceToolError> {
    if matches.len() >= limit {
        *truncated = true;
        return Ok(());
    }

    let rel = path
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.display().to_string());

    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(_) => return Ok(()),
    };

    for (idx, line) in content.lines().enumerate() {
        if matches.len() >= limit {
            *truncated = true;
            return Ok(());
        }
        if regex.is_match(line) {
            matches.push(GrepMatch {
                path: rel.clone(),
                line: idx + 1,
                text: line.to_string(),
            });
        }
    }
    Ok(())
}

#[derive(Deserialize)]
struct ShellArgs {
    command: String,
}

#[derive(Serialize)]
struct ShellOutput {
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
}

struct ShellTool;

/// Hard cap so AI validation cannot hang forever on pytest/import loops.
const SHELL_TIMEOUT_SECS: u64 = 90;
/// Keep model context and Progress UI readable.
const SHELL_OUTPUT_MAX_CHARS: usize = 12_000;

fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let truncated: String = text.chars().take(max).collect();
    format!("{truncated}\n…(truncated)")
}

impl Tool for ShellTool {
    const NAME: &'static str = "shell";
    type Args = ShellArgs;
    type Output = ShellOutput;
    type Error = WorkspaceToolError;

    fn description(&self) -> String {
        format!(
            "Run a short shell command with the project root as the working directory \
(timeout {SHELL_TIMEOUT_SECS}s). Prefer targeted reads/greps over full test suites."
        )
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Shell command to execute in the project workspace"
                }
            },
            "required": ["command"]
        })
    }

    async fn call(
        &self,
        context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let ws = workspace_from_context(context)?;
        let command = args.command.trim();
        if command.is_empty() {
            return Err(WorkspaceToolError("Command must not be empty".into()));
        }
        if is_blocked_shell_command(command) {
            return Err(WorkspaceToolError(
                "Command blocked by workspace safety policy".into(),
            ));
        }

        let reporter = tool_output_reporter(context);
        if let Some(ref reporter) = reporter {
            reporter.emit(format!("$ {command}\n"));
        }

        let mut cmd = Command::new("sh");
        cmd.arg("-c")
            .arg(command)
            .current_dir(&ws.workspace.root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        // Own process group so timeout can kill pytest/cargo children, not just `sh`.
        #[cfg(unix)]
        cmd.process_group(0);

        let mut child = cmd
            .spawn()
            .map_err(|err| WorkspaceToolError(format!("Failed to start command: {err}")))?;

        let mut stdout = child.stdout.take().ok_or_else(|| {
            WorkspaceToolError("Failed to capture command stdout".into())
        })?;
        let mut stderr = child.stderr.take().ok_or_else(|| {
            WorkspaceToolError("Failed to capture command stderr".into())
        })?;

        let stdout_reporter = reporter.clone();
        let stderr_reporter = reporter.clone();
        let stdout_task = tokio::spawn(async move {
            pump_command_pipe(&mut stdout, stdout_reporter).await
        });
        let stderr_task = tokio::spawn(async move {
            pump_command_pipe(&mut stderr, stderr_reporter).await
        });

        let status = match timeout(Duration::from_secs(SHELL_TIMEOUT_SECS), child.wait()).await {
            Ok(Ok(status)) => status,
            Ok(Err(err)) => {
                return Err(WorkspaceToolError(format!("Failed to run command: {err}")));
            }
            Err(_) => {
                if let Some(ref reporter) = reporter {
                    reporter.emit(format!(
                        "\n… timed out after {SHELL_TIMEOUT_SECS}s, killing process tree…\n"
                    ));
                }
                force_kill_shell(&mut child);
                // Don't hang forever if a grandchild still holds the pipes open.
                let _ = timeout(Duration::from_secs(2), child.wait()).await;
                stdout_task.abort();
                stderr_task.abort();
                let _ = timeout(Duration::from_secs(1), async {
                    let _ = stdout_task.await;
                    let _ = stderr_task.await;
                })
                .await;
                let msg = format!(
                    "Command timed out after {SHELL_TIMEOUT_SECS}s and was killed. \
Prefer reading files / grepping over long test runs during AI validation."
                );
                if let Some(ref reporter) = reporter {
                    reporter.emit(format!("{msg}\n"));
                }
                return Ok(ShellOutput {
                    exit_code: None,
                    stdout: String::new(),
                    stderr: msg,
                });
            }
        };

        let stdout_buf = stdout_task.await.unwrap_or_default();
        let stderr_buf = stderr_task.await.unwrap_or_default();
        let exit_code = status.code();
        if let Some(ref reporter) = reporter {
            match exit_code {
                Some(code) => reporter.emit(format!("\n[exit {code}]\n")),
                None => reporter.emit("\n[exit ?]\n"),
            }
        }

        Ok(ShellOutput {
            exit_code,
            stdout: truncate_chars(&String::from_utf8_lossy(&stdout_buf), SHELL_OUTPUT_MAX_CHARS),
            stderr: truncate_chars(&String::from_utf8_lossy(&stderr_buf), SHELL_OUTPUT_MAX_CHARS),
        })
    }
}

/// Read a pipe, accumulate bytes, and optionally stream chunks to Progress.
async fn pump_command_pipe(
    reader: &mut (impl AsyncReadExt + Unpin),
    reporter: Option<ToolOutputReporter>,
) -> Vec<u8> {
    let mut acc = Vec::new();
    let mut buf = [0u8; 1024];
    let mut pending = String::new();
    let mut last_emit = Instant::now();
    loop {
        let n = match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        acc.extend_from_slice(&buf[..n]);
        let Some(ref reporter) = reporter else {
            continue;
        };
        pending.push_str(&String::from_utf8_lossy(&buf[..n]));
        let due = pending.len() >= 120 || last_emit.elapsed() >= Duration::from_millis(150);
        if due && !pending.is_empty() {
            reporter.emit(std::mem::take(&mut pending));
            last_emit = Instant::now();
        }
    }
    if let Some(ref reporter) = reporter {
        if !pending.is_empty() {
            reporter.emit(pending);
        }
    }
    acc
}

/// Kill `sh -c …` and any children (pytest, cargo, …) started in its process group.
fn force_kill_shell(child: &mut tokio::process::Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        // Negative PID => entire process group (requires process_group(0) at spawn).
        let _ = std::process::Command::new("kill")
            .args(["-KILL", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.start_kill();
}

fn is_blocked_shell_command(command: &str) -> bool {
    let lower = command.to_lowercase();
    const BLOCKED: &[&str] = &[
        "rm -rf /",
        "rm -rf /*",
        "mkfs",
        ":(){ :|:& };:",
        "dd if=/dev/zero",
        "> /dev/sd",
        "curl ",
        "wget ",
        "chmod -r /",
        "chown -r /",
    ];
    BLOCKED.iter().any(|needle| lower.contains(needle))
}

pub(crate) fn add_workspace_tools<M>(
    builder: AgentBuilder<M, NoToolConfig>,
) -> AgentBuilder<M, WithBuilderTools>
where
    M: CompletionModel,
{
    builder
        .tool(ReadFilesTool)
        .tool(EditFilesTool)
        .tool(GrepTool)
        .tool(ShellTool)
}

#[cfg(test)]
mod tests {
    use super::is_blocked_shell_command;

    #[test]
    fn blocks_destructive_shell_commands() {
        assert!(is_blocked_shell_command("rm -rf /"));
        assert!(!is_blocked_shell_command("cargo test"));
    }
}
