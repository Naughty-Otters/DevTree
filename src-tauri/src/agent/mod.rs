pub mod ai_output_parse;
pub mod ai_validation;
pub mod architecture_assessments;
pub mod clean_code_lenses;
pub mod code_review_lenses;
pub mod model_listing;
pub mod providers;
pub mod run;
pub mod runtime_limits;
pub mod skills;
pub mod tools;
pub mod types;
pub mod workspace;

use crate::analysis_session::AnalysisSessionRegistry;
use providers::{list_providers, ProviderRunConfig};
use runtime_limits::clamp_agent_turns;
use run::{build_preamble, build_workspace};
use skills::{list_skills, skill_by_id};
use tauri::ipc::Channel;
use types::{AgentEvent, AgentEventKind, AgentRunRequest, AgentRunResult, AgentSkillInfo, LlmProviderInfo};

pub fn list_agent_skills() -> Vec<AgentSkillInfo> {
    list_skills()
}

pub fn list_llm_providers() -> Vec<LlmProviderInfo> {
    list_providers()
}

pub async fn list_llm_provider_models(
    provider: types::LlmProvider,
    api_key: String,
) -> Result<Vec<String>, String> {
    model_listing::list_provider_models(provider, &api_key).await
}

pub async fn run_agent_skill(
    request: AgentRunRequest,
    on_event: Channel<AgentEvent>,
    registry: tauri::State<'_, AnalysisSessionRegistry>,
) -> Result<AgentRunResult, String> {
    let skill = skill_by_id(&request.skill_id)
        .ok_or_else(|| format!("Unknown skill: {}", request.skill_id))?;
    let workspace = build_workspace(&request.project_path)?;
    let cancel = registry.register(request.run_id.clone());
    let preamble = build_preamble(skill.instructions);

    let run_id = request.run_id.clone();
    let skill_id = request.skill_id.clone();
    let provider = request.provider.clone();
    let model = request.model.clone();

    let _ = on_event.send(AgentEvent {
        run_id: run_id.clone(),
        kind: AgentEventKind::Started {
            skill_id: skill_id.clone(),
            provider: provider.clone(),
            model: model.clone(),
        },
    });

    let emit_run_id = run_id.clone();

    let config = ProviderRunConfig {
        run_id: &run_id,
        provider,
        model: &model,
        api_key: &request.api_key,
        preamble: &preamble,
        prompt: &request.prompt,
        workspace,
        max_turns: clamp_agent_turns(request.max_turns),
        cancel: cancel.clone(),
        on_event: &on_event,
    };

    let result = providers::run_provider(config).await;
    registry.unregister(&run_id);

    match result {
        Ok(final_text) => Ok(AgentRunResult { run_id, final_text }),
        Err(err) => {
            if err.to_lowercase().contains("cancel") {
                Err(err)
            } else {
                let _ = on_event.send(AgentEvent {
                    run_id: emit_run_id,
                    kind: AgentEventKind::Error {
                        message: err.clone(),
                    },
                });
                Err(err)
            }
        }
    }
}

pub fn cancel_agent_run(run_id: String, registry: tauri::State<'_, AnalysisSessionRegistry>) -> bool {
    registry.cancel(&run_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_agent_skills_and_providers() {
        assert!(!list_agent_skills().is_empty());
        assert!(!list_llm_providers().is_empty());
    }
}
