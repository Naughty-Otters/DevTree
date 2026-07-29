use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LlmProvider {
    Deepseek,
    Kimi,
    Glm,
    Openai,
    Anthropic,
    Grok,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderInfo {
    pub id: LlmProvider,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRequest {
    pub run_id: String,
    pub project_path: String,
    pub skill_id: String,
    pub provider: LlmProvider,
    pub model: String,
    pub api_key: String,
    pub prompt: String,
    #[serde(default = "default_agent_max_turns")]
    pub max_turns: u32,
}

pub use crate::agent::runtime_limits::default_agent_max_turns;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunResult {
    pub run_id: String,
    pub final_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub run_id: String,
    pub kind: AgentEventKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum AgentEventKind {
    Started {
        skill_id: String,
        provider: LlmProvider,
        model: String,
    },
    ThinkingDelta {
        delta: String,
    },
    ThinkingDone {
        text: String,
    },
    TextDelta {
        delta: String,
    },
    TextDone {
        text: String,
    },
    ToolCall {
        name: String,
        arguments: String,
    },
    ToolResult {
        name: String,
        output: String,
        is_error: bool,
    },
    Error {
        message: String,
    },
    Done {
        final_text: String,
    },
    Cancelled,
}
