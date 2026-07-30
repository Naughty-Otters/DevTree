use super::types::{LlmProvider, LlmProviderInfo};
use super::types::LlmProvider as LP;

pub fn list_providers() -> Vec<LlmProviderInfo> {
    vec![
        provider(LP::Deepseek, "DeepSeek"),
        provider(LP::Kimi, "Kimi (Moonshot)"),
        provider(LP::Glm, "GLM (Z.AI)"),
        provider(LP::Openai, "OpenAI"),
        provider(LP::Anthropic, "Anthropic"),
        provider(LP::Grok, "Grok (xAI)"),
    ]
}

fn provider(id: LlmProvider, label: &str) -> LlmProviderInfo {
    LlmProviderInfo {
        id,
        label: label.into(),
    }
}

fn default_model_for_provider(provider: &LlmProvider) -> String {
    match provider {
        LlmProvider::Deepseek => "deepseek-chat".into(),
        LlmProvider::Kimi => "kimi-k2.5".into(),
        LlmProvider::Glm => "glm-4.6".into(),
        LlmProvider::Openai => "gpt-4o-mini".into(),
        LlmProvider::Anthropic => "claude-sonnet-4-6".into(),
        LlmProvider::Grok => "grok-3".into(),
    }
}

pub fn default_model(provider: &LlmProvider) -> String {
    default_model_for_provider(provider)
}

use super::runtime_limits::turns_as_usize;
use super::tools::add_workspace_tools;
use super::types::AgentEvent;
use tauri::ipc::Channel;

pub struct ProviderRunConfig<'a> {
    pub run_id: &'a str,
    pub provider: LlmProvider,
    pub model: &'a str,
    pub api_key: &'a str,
    pub preamble: &'a str,
    pub prompt: &'a str,
    pub workspace: super::workspace::ProjectWorkspace,
    pub max_turns: u32,
    pub cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub on_event: &'a Channel<AgentEvent>,
}

macro_rules! run_with_client {
    ($client:expr, $config:expr) => {{
        use rig_agent::client::AgentClientExt;
        let agent = add_workspace_tools(
            $client
                .agent($config.model)
                .preamble($config.preamble)
                .default_max_turns(turns_as_usize($config.max_turns)),
        )
        .build();
        super::run::run_streaming_agent(agent, $config).await
    }};
}

pub async fn run_provider(config: ProviderRunConfig<'_>) -> Result<String, String> {
    if config.api_key.trim().is_empty() {
        return Err("API key is required".into());
    }

    match config.provider {
        LlmProvider::Deepseek => {
            use rig_core::providers::deepseek;
            let client = deepseek::Client::new(config.api_key).map_err(|e| e.to_string())?;
            run_with_client!(client, config)
        }
        LlmProvider::Kimi => {
            use rig_core::providers::moonshot;
            let client = moonshot::Client::new(config.api_key).map_err(|e| e.to_string())?;
            run_with_client!(client, config)
        }
        LlmProvider::Glm => {
            use rig_core::providers::zai;
            let client = zai::Client::new(config.api_key).map_err(|e| e.to_string())?;
            run_with_client!(client, config)
        }
        LlmProvider::Openai => {
            use rig_core::providers::openai;
            let client = openai::Client::new(config.api_key).map_err(|e| e.to_string())?;
            run_with_client!(client, config)
        }
        LlmProvider::Anthropic => {
            use rig_core::providers::anthropic;
            let client = anthropic::Client::new(config.api_key).map_err(|e| e.to_string())?;
            run_with_client!(client, config)
        }
        LlmProvider::Grok => {
            use rig_core::providers::xai;
            let client = xai::Client::new(config.api_key).map_err(|e| e.to_string())?;
            run_with_client!(client, config)
        }
    }
}

macro_rules! run_validation_stream_with_client {
    ($client:expr, $model:expr, $preamble:expr, $prompt:expr, $workspace:expr, $max_turns:expr, $config:expr) => {{
        use rig_agent::client::AgentClientExt;
        let agent = add_workspace_tools(
            $client
                .agent($model)
                .preamble($preamble)
                .default_max_turns(turns_as_usize($max_turns)),
        )
        .build();
        super::run::run_streaming_validation(
            agent,
            super::run::ValidationStreamConfig {
                prompt: $prompt,
                workspace: $workspace,
                max_turns: $max_turns,
                cancel: $config.cancel,
                on_event: $config.on_event,
            },
        )
        .await
    }};
}

pub struct ValidationProviderStreamConfig<'a> {
    pub provider: LlmProvider,
    pub model: &'a str,
    pub api_key: &'a str,
    pub preamble: &'a str,
    pub prompt: &'a str,
    pub workspace: super::workspace::ProjectWorkspace,
    pub max_turns: u32,
    pub cancel: &'a std::sync::atomic::AtomicBool,
    pub on_event: &'a (dyn Fn(super::run::ValidationStreamEvent) + Send + Sync),
}

pub async fn run_validation_provider_stream(
    config: ValidationProviderStreamConfig<'_>,
) -> Result<String, String> {
    if config.api_key.trim().is_empty() {
        return Err("API key is required".into());
    }

    match config.provider {
        LlmProvider::Deepseek => {
            use rig_core::providers::deepseek;
            let client = deepseek::Client::new(config.api_key).map_err(|e| e.to_string())?;
            run_validation_stream_with_client!(
                client,
                config.model,
                config.preamble,
                config.prompt,
                config.workspace,
                config.max_turns,
                config
            )
        }
        LlmProvider::Kimi => {
            use rig_core::providers::moonshot;
            let client = moonshot::Client::new(config.api_key).map_err(|e| e.to_string())?;
            run_validation_stream_with_client!(
                client,
                config.model,
                config.preamble,
                config.prompt,
                config.workspace,
                config.max_turns,
                config
            )
        }
        LlmProvider::Glm => {
            use rig_core::providers::zai;
            let client = zai::Client::new(config.api_key).map_err(|e| e.to_string())?;
            run_validation_stream_with_client!(
                client,
                config.model,
                config.preamble,
                config.prompt,
                config.workspace,
                config.max_turns,
                config
            )
        }
        LlmProvider::Openai => {
            use rig_core::providers::openai;
            let client = openai::Client::new(config.api_key).map_err(|e| e.to_string())?;
            run_validation_stream_with_client!(
                client,
                config.model,
                config.preamble,
                config.prompt,
                config.workspace,
                config.max_turns,
                config
            )
        }
        LlmProvider::Anthropic => {
            use rig_core::providers::anthropic;
            let client = anthropic::Client::new(config.api_key).map_err(|e| e.to_string())?;
            run_validation_stream_with_client!(
                client,
                config.model,
                config.preamble,
                config.prompt,
                config.workspace,
                config.max_turns,
                config
            )
        }
        LlmProvider::Grok => {
            use rig_core::providers::xai;
            let client = xai::Client::new(config.api_key).map_err(|e| e.to_string())?;
            run_validation_stream_with_client!(
                client,
                config.model,
                config.preamble,
                config.prompt,
                config.workspace,
                config.max_turns,
                config
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::list_providers;

    #[test]
    fn lists_llm_providers() {
        assert!(!list_providers().is_empty());
    }
}
