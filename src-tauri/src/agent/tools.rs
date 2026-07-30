use super::workspace::{ProjectWorkspace, WorkspaceToolError};
use rig_agent::agent::{AgentBuilder, NoToolConfig, WithBuilderTools};
use rig_agent::completion::CompletionModel;
use rig_agent::tool::{Tool, ToolContext};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

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
        "Read one or more text files relative to the project root.".into()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "paths": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Project-relative file paths"
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
            match ws.workspace.resolve_relative(&path) {
                Ok(full) => {
                    if !full.is_file() {
                        files.push(ReadFileEntry {
                            path,
                            content: None,
                            error: Some("Not a file".into()),
                        });
                        continue;
                    }
                    match fs::read_to_string(&full) {
                        Ok(content) => files.push(ReadFileEntry {
                            path,
                            content: Some(content),
                            error: None,
                        }),
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

impl Tool for ShellTool {
    const NAME: &'static str = "shell";
    type Args = ShellArgs;
    type Output = ShellOutput;
    type Error = WorkspaceToolError;

    fn description(&self) -> String {
        "Run a shell command with the project root as the working directory.".into()
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

        let output = Command::new("sh")
            .arg("-c")
            .arg(command)
            .current_dir(&ws.workspace.root)
            .output()
            .map_err(|err| WorkspaceToolError(format!("Failed to run command: {err}")))?;

        Ok(ShellOutput {
            exit_code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
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
