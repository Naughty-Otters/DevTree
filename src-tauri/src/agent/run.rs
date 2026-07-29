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

use super::runtime_limits::turns_as_usize;

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
}

pub struct ValidationStreamConfig<'a> {
    pub prompt: &'a str,
    pub workspace: ProjectWorkspace,
    pub max_turns: u32,
    pub cancel: &'a std::sync::atomic::AtomicBool,
    pub on_event: &'a (dyn Fn(ValidationStreamEvent) + Send + Sync),
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
    let mut tool_context = ToolContext::new();
    tool_context.insert(config.workspace);

    let mut stream = agent
        .stream_prompt(config.prompt)
        .max_turns(turns_as_usize(config.max_turns))
        .tool_context(tool_context)
        .await;

    let mut thinking_buffer = String::new();
    let mut text_buffer = String::new();
    let mut final_text = String::new();

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
                    (on_event)(ValidationStreamEvent::ToolActivity(format!(
                        "Tool: {}",
                        tool_call.function.name
                    )));
                }
                StreamedAssistantContent::ToolCallDelta { .. } => {}
                StreamedAssistantContent::Final(_) => {}
                StreamedAssistantContent::Unknown(_) => {}
            },
            MultiTurnStreamItem::ToolExecutionCommitted { tool_call, .. } => {
                (on_event)(ValidationStreamEvent::ToolActivity(format!(
                    "Tool: {}",
                    tool_call.function.name
                )));
            }
            MultiTurnStreamItem::StreamUserItem(_) => {}
            MultiTurnStreamItem::CompletionCall(_) => {}
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
