use super::providers::ProviderRunConfig;
use super::types::{AgentEvent, AgentEventKind};
use super::workspace::ProjectWorkspace;
use futures::StreamExt;
use rig_agent::agent::MultiTurnStreamItem;
use rig_agent::completion::{CompletionModel, GetTokenUsage};
use rig_agent::streaming::{StreamedAssistantContent, StreamedUserContent, StreamingPrompt};
use rig_agent::tool::ToolContext;
use rig_agent::Agent;
use rig_core::message::{Reasoning, ReasoningContent, ToolResultContent};
use std::sync::atomic::Ordering;

const BASE_AGENT_PREAMBLE: &str = "\
You are DevTree's project agent. Work only inside the opened project workspace. \
Use only these workspace tools: `read_files`, `edit_files`, `grep`, and `shell`. \
All file paths must be project-relative and all shell commands run with the project root as the working directory. \
Prefer small, verifiable steps. Use `grep` to narrow scope before `read_files`, and pass multiple paths in a single `read_files` call when possible to conserve tool rounds. When you reason, separate internal analysis from the final user-facing answer.\n\n";

use super::runtime_limits::{
    format_token_budget, token_budget_exceeded, turns_as_usize, usage_total_tokens,
};

pub async fn run_streaming_agent<M>(
    agent: Agent<M>,
    config: ProviderRunConfig<'_>,
) -> Result<String, String>
where
    M: CompletionModel + 'static,
    M::StreamingResponse: GetTokenUsage + Send,
{
    let mut tool_context = ToolContext::new();
    tool_context.insert(config.workspace.clone());

    let mut stream = agent
        .stream_prompt(config.prompt)
        .max_turns(turns_as_usize(config.max_turns))
        .tool_context(tool_context)
        .await;

    let mut thinking_buffer = String::new();
    let mut text_buffer = String::new();
    let mut final_text = String::new();

    while let Some(item) = stream.next().await {
        if config.cancel.load(Ordering::SeqCst) {
            emit(&config, AgentEventKind::Cancelled);
            return Err("Agent run cancelled".into());
        }

        let item = item.map_err(|err| err.to_string())?;
        match item {
            MultiTurnStreamItem::StreamAssistantItem(content) => match content {
                StreamedAssistantContent::Reasoning(reasoning) => {
                    push_reasoning(&reasoning, &mut thinking_buffer, &config);
                }
                StreamedAssistantContent::ReasoningDelta { reasoning, .. } => {
                    if !reasoning.is_empty() {
                        thinking_buffer.push_str(&reasoning);
                        emit(
                            &config,
                            AgentEventKind::ThinkingDelta {
                                delta: reasoning,
                            },
                        );
                    }
                }
                StreamedAssistantContent::Text(text) => {
                    if !text.text.is_empty() {
                        flush_thinking(&config, &mut thinking_buffer);
                        text_buffer.push_str(&text.text);
                        emit(
                            &config,
                            AgentEventKind::TextDelta {
                                delta: text.text,
                            },
                        );
                    }
                }
                StreamedAssistantContent::ToolCall { tool_call, .. } => {
                    flush_thinking(&config, &mut thinking_buffer);
                    emit(
                        &config,
                        AgentEventKind::ToolCall {
                            name: tool_call.function.name,
                            arguments: tool_call.function.arguments.to_string(),
                        },
                    );
                }
                StreamedAssistantContent::ToolCallDelta { .. } => {}
                StreamedAssistantContent::Final(_) => {}
                StreamedAssistantContent::Unknown(_) => {}
            },
            MultiTurnStreamItem::ToolExecutionCommitted { tool_call, .. } => {
                emit(
                    &config,
                    AgentEventKind::ToolCall {
                        name: tool_call.function.name,
                        arguments: tool_call.function.arguments.to_string(),
                    },
                );
            }
            MultiTurnStreamItem::StreamUserItem(content) => match content {
                StreamedUserContent::ToolResult {
                    tool_result,
                    internal_call_id,
                } => {
                    let output = tool_result
                        .content
                        .iter()
                        .filter_map(tool_result_text)
                        .collect::<Vec<_>>()
                        .join("\n");
                    emit(
                        &config,
                        AgentEventKind::ToolResult {
                            name: internal_call_id,
                            output,
                            is_error: false,
                        },
                    );
                }
            },
            MultiTurnStreamItem::CompletionCall(_) => {}
            MultiTurnStreamItem::ModelTurnRetried { .. } => {
                flush_thinking(&config, &mut thinking_buffer);
                flush_text(&config, &mut text_buffer);
            }
            MultiTurnStreamItem::FinalResponse(response) => {
                flush_thinking(&config, &mut thinking_buffer);
                if !response.output.trim().is_empty() {
                    final_text = response.output;
                } else if !text_buffer.is_empty() {
                    final_text = std::mem::take(&mut text_buffer);
                }
            }
            _ => {}
        }
    }

    flush_thinking(&config, &mut thinking_buffer);
    flush_text(&config, &mut text_buffer);

    if final_text.is_empty() && !text_buffer.is_empty() {
        final_text = text_buffer;
    }

    emit(
        &config,
        AgentEventKind::Done {
            final_text: final_text.clone(),
        },
    );
    Ok(final_text)
}

fn push_reasoning(
    reasoning: &Reasoning,
    thinking_buffer: &mut String,
    config: &ProviderRunConfig<'_>,
) {
    for block in &reasoning.content {
        let text = match block {
            ReasoningContent::Text { text, .. } => text.clone(),
            ReasoningContent::Summary(text) => text.clone(),
            ReasoningContent::Encrypted(value) => value.clone(),
            ReasoningContent::Redacted { data } => data.clone(),
            _ => String::new(),
        };
        if text.is_empty() {
            continue;
        }
        thinking_buffer.push_str(&text);
        emit(
            config,
            AgentEventKind::ThinkingDelta {
                delta: text,
            },
        );
    }
}

fn tool_result_text(block: &ToolResultContent) -> Option<String> {
    match block {
        ToolResultContent::Text(text) => Some(text.text.clone()),
        ToolResultContent::Json { value } => Some(value.to_string()),
        _ => None,
    }
}

fn flush_thinking(config: &ProviderRunConfig<'_>, thinking_buffer: &mut String) {
    if thinking_buffer.is_empty() {
        return;
    }
    emit(
        config,
        AgentEventKind::ThinkingDone {
            text: std::mem::take(thinking_buffer),
        },
    );
}

fn flush_text(config: &ProviderRunConfig<'_>, text_buffer: &mut String) {
    if text_buffer.is_empty() {
        return;
    }
    emit(
        config,
        AgentEventKind::TextDone {
            text: std::mem::take(text_buffer),
        },
    );
}

fn emit(config: &ProviderRunConfig<'_>, kind: AgentEventKind) {
    let _ = config.on_event.send(AgentEvent {
        run_id: config.run_id.to_string(),
        kind,
    });
}

pub fn build_preamble(skill_instructions: &str) -> String {
    format!("{BASE_AGENT_PREAMBLE}{skill_instructions}")
}

pub fn build_workspace(project_path: &str) -> Result<ProjectWorkspace, String> {
    ProjectWorkspace::new(std::path::PathBuf::from(project_path)).map_err(|err| err.to_string())
}

#[derive(Debug, Clone)]
pub enum ValidationStreamEvent {
    ThinkingDelta(String),
    TextDelta(String),
    ToolActivity(String),
    /// Live or completed tool stdout/stderr (and short summaries for other tools).
    ToolOutputDelta(String),
    /// Cumulative token usage for the validation session.
    BudgetStatus(String),
}

pub struct ValidationStreamConfig<'a> {
    pub prompt: &'a str,
    pub workspace: ProjectWorkspace,
    pub max_turns: u32,
    /// Session token budget; `0` = unlimited.
    pub max_tokens: u64,
    pub cancel: &'a std::sync::atomic::AtomicBool,
    pub on_event: &'a (dyn Fn(ValidationStreamEvent) + Send + Sync),
    /// When set, shell (and other tools that opt in) stream output while running.
    pub tool_output: Option<super::tools::ToolOutputReporter>,
}

pub async fn run_streaming_validation<M>(
    agent: Agent<M>,
    config: ValidationStreamConfig<'_>,
) -> Result<String, String>
where
    M: CompletionModel + 'static,
    M::StreamingResponse: GetTokenUsage + Send,
{
    let cancel = config.cancel;
    let on_event = config.on_event;
    let max_tokens = config.max_tokens;
    let mut tool_context = ToolContext::new();
    tool_context.insert(config.workspace);
    if let Some(reporter) = config.tool_output {
        tool_context.insert(reporter);
    }

    let mut stream = agent
        .stream_prompt(config.prompt)
        .max_turns(turns_as_usize(config.max_turns))
        .tool_context(tool_context)
        .await;

    let mut thinking_buffer = String::new();
    let mut text_buffer = String::new();
    let mut final_text = String::new();
    let mut tokens_used: u64 = 0;

    while let Some(item) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            return Err("AI validation cancelled".into());
        }

        let item = item.map_err(|err| err.to_string())?;
        match item {
            MultiTurnStreamItem::StreamAssistantItem(content) => match content {
                StreamedAssistantContent::Reasoning(reasoning) => {
                    push_validation_reasoning(&reasoning, &mut thinking_buffer, on_event);
                }
                StreamedAssistantContent::ReasoningDelta { reasoning, .. } => {
                    if !reasoning.is_empty() {
                        thinking_buffer.push_str(&reasoning);
                        (on_event)(ValidationStreamEvent::ThinkingDelta(reasoning));
                    }
                }
                StreamedAssistantContent::Text(text) => {
                    if !text.text.is_empty() {
                        flush_validation_thinking(&mut thinking_buffer);
                        text_buffer.push_str(&text.text);
                        (on_event)(ValidationStreamEvent::TextDelta(text.text));
                    }
                }
                StreamedAssistantContent::ToolCall { tool_call, .. } => {
                    flush_validation_thinking(&mut thinking_buffer);
                    (on_event)(ValidationStreamEvent::ToolActivity(format_tool_label(
                        &tool_call.function.name,
                        &tool_call.function.arguments,
                        "Calling",
                    )));
                }
                StreamedAssistantContent::ToolCallDelta { .. } => {}
                StreamedAssistantContent::Final(_) => {}
                StreamedAssistantContent::Unknown(_) => {}
            },
            MultiTurnStreamItem::ToolExecutionCommitted { tool_call, .. } => {
                let label = format_tool_label(
                    &tool_call.function.name,
                    &tool_call.function.arguments,
                    "Running",
                );
                (on_event)(ValidationStreamEvent::ToolActivity(label));
                // Shell streams live via ToolOutputReporter; other tools log a header here.
                if tool_call.function.name != "shell" {
                    let header = format_tool_output_header(
                        &tool_call.function.name,
                        &tool_call.function.arguments,
                    );
                    (on_event)(ValidationStreamEvent::ToolOutputDelta(header));
                }
            }
            MultiTurnStreamItem::StreamUserItem(content) => match content {
                StreamedUserContent::ToolResult {
                    tool_result,
                    internal_call_id,
                } => {
                    let output = tool_result
                        .content
                        .iter()
                        .filter_map(tool_result_text)
                        .collect::<Vec<_>>()
                        .join("\n");
                    let preview = truncate_for_ui(&output, 2_500);
                    let name = internal_call_id;
                    (on_event)(ValidationStreamEvent::ToolActivity(format!(
                        "Finished {name}"
                    )));
                    // Shell already streamed stdout/stderr; skip JSON dump for that tool.
                    if !is_shell_tool_result(&output) && !preview.trim().is_empty() {
                        let note = format!("{preview}\n\n");
                        (on_event)(ValidationStreamEvent::ToolOutputDelta(note));
                    }
                }
            },
            MultiTurnStreamItem::CompletionCall(call) => {
                let turn_tokens = usage_total_tokens(
                    call.usage.total_tokens,
                    call.usage.input_tokens,
                    call.usage.output_tokens,
                );
                tokens_used = tokens_used.saturating_add(turn_tokens);
                (on_event)(ValidationStreamEvent::BudgetStatus(format_token_budget(
                    tokens_used,
                    max_tokens,
                )));
                if token_budget_exceeded(tokens_used, max_tokens) {
                    flush_validation_thinking(&mut thinking_buffer);
                    flush_validation_text(&mut text_buffer);
                    return Err(format!(
                        "AI validation stopped: token budget exceeded ({})",
                        format_token_budget(tokens_used, max_tokens)
                    ));
                }
            }
            MultiTurnStreamItem::ModelTurnRetried { .. } => {
                flush_validation_thinking(&mut thinking_buffer);
                flush_validation_text(&mut text_buffer);
            }
            MultiTurnStreamItem::FinalResponse(response) => {
                flush_validation_thinking(&mut thinking_buffer);
                if !response.output.trim().is_empty() {
                    final_text = response.output;
                } else if !text_buffer.is_empty() {
                    final_text = std::mem::take(&mut text_buffer);
                }
            }
            _ => {}
        }
    }

    flush_validation_thinking(&mut thinking_buffer);
    flush_validation_text(&mut text_buffer);

    if final_text.is_empty() && !text_buffer.is_empty() {
        final_text = text_buffer;
    }

    Ok(final_text)
}

fn push_validation_reasoning(
    reasoning: &Reasoning,
    thinking_buffer: &mut String,
    on_event: &(dyn Fn(ValidationStreamEvent) + Send + Sync),
) {
    for block in &reasoning.content {
        let text = match block {
            ReasoningContent::Text { text, .. } => text.clone(),
            ReasoningContent::Summary(text) => text.clone(),
            ReasoningContent::Encrypted(value) => value.clone(),
            ReasoningContent::Redacted { data } => data.clone(),
            _ => String::new(),
        };
        if text.is_empty() {
            continue;
        }
        thinking_buffer.push_str(&text);
        (on_event)(ValidationStreamEvent::ThinkingDelta(text));
    }
}

fn flush_validation_thinking(thinking_buffer: &mut String) {
    if !thinking_buffer.is_empty() {
        let _ = std::mem::take(thinking_buffer);
    }
}

fn flush_validation_text(text_buffer: &mut String) {
    if !text_buffer.is_empty() {
        let _ = std::mem::take(text_buffer);
    }
}

fn truncate_for_ui(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let truncated: String = text.chars().take(max).collect();
    format!("{truncated}\n…(truncated)")
}

fn is_shell_tool_result(output: &str) -> bool {
    let trimmed = output.trim();
    trimmed.contains("\"stdout\"") && trimmed.contains("\"stderr\"") && trimmed.contains("exit_code")
}

fn format_tool_output_header(name: &str, args: &serde_json::Value) -> String {
    match name {
        "grep" => {
            let pattern = args
                .get("pattern")
                .and_then(|v| v.as_str())
                .unwrap_or("?");
            format!("▸ grep {pattern}\n")
        }
        "read_files" => {
            let paths = args
                .get("paths")
                .and_then(|v| v.as_array())
                .map(|paths| {
                    paths
                        .iter()
                        .filter_map(|p| p.as_str())
                        .take(4)
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            format!("▸ read_files {paths}\n")
        }
        "edit_files" => "▸ edit_files\n".into(),
        _ => format!("▸ {name}\n"),
    }
}

fn format_tool_label(name: &str, args: &serde_json::Value, verb: &str) -> String {
    let detail = match name {
        "shell" => args
            .get("command")
            .and_then(|v| v.as_str())
            .map(|cmd| truncate_for_ui(cmd, 160))
            .unwrap_or_default(),
        "grep" => args
            .get("pattern")
            .and_then(|v| v.as_str())
            .map(|p| format!("pattern={p}"))
            .unwrap_or_default(),
        "read_files" => args
            .get("paths")
            .and_then(|v| v.as_array())
            .map(|paths| {
                let joined = paths
                    .iter()
                    .filter_map(|p| p.as_str())
                    .take(4)
                    .collect::<Vec<_>>()
                    .join(", ");
                truncate_for_ui(&joined, 160)
            })
            .unwrap_or_default(),
        _ => String::new(),
    };
    if detail.is_empty() {
        format!("{verb} {name}")
    } else {
        format!("{verb} {name}: {detail}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_preamble_includes_skill_instructions() {
        let preamble = build_preamble("Do the thing.");
        assert!(preamble.contains("Do the thing."));
    }

    #[test]
    fn format_tool_label_includes_shell_command() {
        let args = serde_json::json!({"command": "pytest tests/foo.py -q"});
        assert_eq!(
            format_tool_label("shell", &args, "Running"),
            "Running shell: pytest tests/foo.py -q"
        );
    }
}
