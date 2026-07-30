use crate::analysis::{AiValidationStream, AnalysisProgress, AnalysisRule, RuleSettingDef, RuleSettingsMap, ValidationItem};
use crate::agent::ai_output_parse::parse_ai_findings;
use crate::agent::providers::{run_validation_provider_stream, ValidationProviderStreamConfig};
use crate::agent::runtime_limits::{
    clamp_agent_turns, clamp_validation_turns, default_agent_max_turns,
    default_validation_max_turns,
};
use crate::agent::architecture_assessments::{
    architecture_rule_settings, build_architecture_assessment_prompt,
    selected_architecture_assessments,
};
use crate::agent::clean_code_lenses::{
    build_clean_code_principle_prompt, clean_code_rule_settings, selected_clean_code_principles,
    CLEAN_CODE_SKILL_INSTRUCTIONS,
};
use crate::agent::code_review_lenses::{
    build_code_review_lens_prompt, code_review_rule_settings, selected_code_review_lenses,
    CODE_REVIEW_SKILL_INSTRUCTIONS,
};
use crate::agent::providers::default_model;
use crate::agent::run::ValidationStreamEvent;
use crate::agent::types::LlmProvider;
use crate::agent::workspace::ProjectWorkspace;
use crate::hierarchy::HierarchyIndex;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfiguration {
    pub id: String,
    pub name: String,
    pub provider: LlmProvider,
    pub api_key: String,
    pub model: String,
    pub is_global: bool,
}

pub type LlmConfigurations = Vec<LlmConfiguration>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiValidationRuntimeSettings {
    #[serde(default = "default_validation_max_turns")]
    pub max_turns: u32,
    #[serde(default = "default_agent_max_turns")]
    pub agent_max_turns: u32,
}

impl Default for AiValidationRuntimeSettings {
    fn default() -> Self {
        Self {
            max_turns: default_validation_max_turns(),
            agent_max_turns: default_agent_max_turns(),
        }
    }
}

impl AiValidationRuntimeSettings {
    pub fn normalized(self) -> Self {
        Self {
            max_turns: clamp_validation_turns(self.max_turns),
            agent_max_turns: clamp_agent_turns(self.agent_max_turns),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiValidationLlmSettings {
    pub provider: LlmProvider,
    pub model: String,
    #[serde(default)]
    pub api_key: String,
}

impl Default for AiValidationLlmSettings {
    fn default() -> Self {
        Self {
            provider: LlmProvider::Openai,
            model: String::new(),
            api_key: String::new(),
        }
    }
}

struct AiValidationRuleDef {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    category: &'static str,
    instructions: &'static str,
}

const AI_RULES: &[AiValidationRuleDef] = &[
    AiValidationRuleDef {
        id: "ai_architecture",
        name: "AI Architecture Review",
        description: "Map project architecture from source, then evaluate selected assessment areas (patterns, design, security, debt, etc.).",
        category: "ai",
        instructions: include_str!("../../../src/ai_validation/rules/architecture.md"),
    },
    AiValidationRuleDef {
        id: "ai_code_review",
        name: "AI Code Reviewer",
        description: "Cross-cutting code review with selectable lenses (performance, security, quality, XSS, N+1, error handling, concurrency, logging, etc.).",
        category: "ai",
        instructions: CODE_REVIEW_SKILL_INSTRUCTIONS,
    },
    AiValidationRuleDef {
        id: "ai_clean_code",
        name: "AI Clean Code Reviewer",
        description: "Review current workspace git changes against selectable Clean Code principles (names, functions, SRP, DRY, tests, smells, etc.).",
        category: "ai",
        instructions: CLEAN_CODE_SKILL_INSTRUCTIONS,
    },
    AiValidationRuleDef {
        id: "ai_maintainability",
        name: "AI Maintainability Review",
        description: "LLM review of naming, duplication, and navigability issues.",
        category: "ai",
        instructions: include_str!("../../../src/ai_validation/rules/maintainability.md"),
    },
    AiValidationRuleDef {
        id: "ai_test_gaps",
        name: "AI Test Gap Review",
        description: "LLM review of missing or weak test coverage in critical modules.",
        category: "ai",
        instructions: include_str!("../../../src/ai_validation/rules/test_gaps.md"),
    },
];

pub fn is_ai_validation_rule(rule_id: &str) -> bool {
    rule_id.starts_with("ai_")
}

pub fn rule_definitions() -> Vec<AnalysisRule> {
    AI_RULES
        .iter()
        .map(|rule| AnalysisRule {
            id: rule.id.into(),
            name: rule.name.into(),
            description: rule.description.into(),
            category: rule.category.into(),
            settings: rule_settings_for(rule.id),
        })
        .collect()
}

fn rule_settings_for(rule_id: &str) -> Vec<RuleSettingDef> {
    let llm = ai_llm_rule_settings();
    match rule_id {
        "ai_architecture" => architecture_rule_settings(llm),
        "ai_code_review" => code_review_rule_settings(llm),
        "ai_clean_code" => clean_code_rule_settings(llm),
        _ => llm,
    }
}

fn ai_llm_rule_settings() -> Vec<RuleSettingDef> {
    vec![RuleSettingDef {
        key: "llm_override".into(),
        label: "Override global LLM settings".into(),
        kind: "boolean".into(),
        default: serde_json::json!(false),
        min: None,
        max: None,
        options: None,
    }]
}

fn cfg_bool(cfg: Option<&serde_json::Map<String, serde_json::Value>>, key: &str, default: bool) -> bool {
    cfg.and_then(|m| m.get(key))
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

fn cfg_str(cfg: Option<&serde_json::Map<String, serde_json::Value>>, key: &str) -> String {
    cfg.and_then(|m| m.get(key))
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default()
}

fn global_configuration(configs: &[LlmConfiguration]) -> Option<&LlmConfiguration> {
    configs.iter().find(|config| config.is_global)
}

fn configuration_by_id<'a>(
    configs: &'a [LlmConfiguration],
    id: &str,
) -> Option<&'a LlmConfiguration> {
    if id.trim().is_empty() {
        return None;
    }
    configs.iter().find(|config| config.id == id)
}

fn llm_from_configuration(config: &LlmConfiguration) -> AiValidationLlmSettings {
    AiValidationLlmSettings {
        provider: config.provider.clone(),
        model: config.model.clone(),
        api_key: config.api_key.clone(),
    }
}

fn resolve_llm_for_rule(
    configurations: &[LlmConfiguration],
    rule_id: &str,
    rule_settings: &RuleSettingsMap,
) -> AiValidationLlmSettings {
    let cfg = rule_settings.get(rule_id);
    if !cfg_bool(cfg, "llm_override", false) {
        return global_configuration(configurations)
            .map(llm_from_configuration)
            .unwrap_or_default();
    }

    let config_id = cfg_str(cfg, "llm_config_id");
    if let Some(found) = configuration_by_id(configurations, &config_id) {
        return llm_from_configuration(found);
    }

    let global = global_configuration(configurations);
    let provider_raw = cfg_str(cfg, "llm_provider");
    let provider = if provider_raw.trim().is_empty() {
        global
            .map(|config| config.provider.clone())
            .unwrap_or(LlmProvider::Openai)
    } else {
        serde_json::from_value(serde_json::json!(provider_raw))
            .unwrap_or_else(|_| {
                global
                    .map(|config| config.provider.clone())
                    .unwrap_or(LlmProvider::Openai)
            })
    };

    let model = {
        let model = cfg_str(cfg, "llm_model");
        if model.trim().is_empty() {
            global.map(|config| config.model.clone()).unwrap_or_default()
        } else {
            model
        }
    };

    let api_key = configurations
        .iter()
        .find(|config| config.provider == provider && !config.api_key.trim().is_empty())
        .map(|config| config.api_key.clone())
        .unwrap_or_default();

    AiValidationLlmSettings {
        provider,
        model,
        api_key,
    }
}

fn rule_def(rule_id: &str) -> Option<&'static AiValidationRuleDef> {
    AI_RULES.iter().find(|rule| rule.id == rule_id)
}

const OUTPUT_CONTRACT: &str = r#"Respond with ONLY valid JSON (no markdown fences):
{"items":[{"status":"pass|warn|fail","message":"summary","affected":["relative/path — detail"]}]}

Use pass when no issues are found. Each affected entry should use project-relative paths."#;

fn build_validation_prompt(
    root: &Path,
    hierarchy: &HierarchyIndex,
    prior_validation: &[ValidationItem],
) -> String {
    let mut packages: Vec<&str> = hierarchy.packages.iter().map(String::as_str).collect();
    packages.sort_unstable();
    packages.truncate(40);

    let mut large_files = hierarchy.files.clone();
    large_files.sort_by(|a, b| b.loc.cmp(&a.loc));
    let file_lines: Vec<String> = large_files
        .iter()
        .take(25)
        .map(|file| format!("{} ({} lines)", file.path, file.loc))
        .collect();

    let prior_summary: Vec<String> = prior_validation
        .iter()
        .filter(|item| !is_ai_validation_rule(&item.rule_id))
        .take(20)
        .map(|item| format!("{}: {} — {}", item.rule_name, item.status, item.message))
        .collect();

    format!(
        "Project root: {}\nPackages ({}): {}\nLargest source files:\n{}\n\nDeterministic validation summary:\n{}\n\n{}\n",
        root.display(),
        hierarchy.packages.len(),
        packages.join(", "),
        if file_lines.is_empty() {
            "(none)".into()
        } else {
            file_lines.join("\n")
        },
        if prior_summary.is_empty() {
            "(none)".into()
        } else {
            prior_summary.join("\n")
        },
        OUTPUT_CONTRACT,
    )
}

fn parse_ai_output(rule: &AiValidationRuleDef, raw: &str) -> Vec<ValidationItem> {
    let trimmed = raw.trim();

    match parse_ai_findings(trimmed) {
        Ok(findings) if findings.is_empty() => vec![ValidationItem {
            rule_id: rule.id.into(),
            rule_name: rule.name.into(),
            status: "pass".into(),
            message: "AI validation found no issues".into(),
            affected: vec![],
            cycle_groups: None,
        }],
        Ok(findings) => findings
            .into_iter()
            .map(|finding| {
                let status = match finding.status.as_str() {
                    "fail" | "failed" | "error" => "fail",
                    "warn" | "warning" => "warn",
                    _ => "pass",
                };
                ValidationItem {
                    rule_id: rule.id.into(),
                    rule_name: rule.name.into(),
                    status: status.into(),
                    message: finding.message,
                    affected: finding.affected,
                    cycle_groups: None,
                }
            })
            .collect(),
        Err(_) => vec![ValidationItem {
            rule_id: rule.id.into(),
            rule_name: rule.name.into(),
            status: "warn".into(),
            message: format!(
                "AI validation returned unstructured output: {}",
                trimmed.chars().take(400).collect::<String>()
            ),
            affected: vec![],
            cycle_groups: None,
        }],
    }
}

fn missing_llm_item(rule: &AiValidationRuleDef, override_enabled: bool) -> ValidationItem {
    ValidationItem {
        rule_id: rule.id.into(),
        rule_name: rule.name.into(),
        status: "warn".into(),
        message: if override_enabled {
            "Skipped — configure an API key for this provider in LLM Configurations".into()
        } else {
            "Skipped — configure LLM providers in Settings → LLM Configurations".into()
        },
        affected: vec![],
        cycle_groups: None,
    }
}

fn error_item(rule: &AiValidationRuleDef, message: String) -> ValidationItem {
    ValidationItem {
        rule_id: rule.id.into(),
        rule_name: rule.name.into(),
        status: "fail".into(),
        message,
        affected: vec![],
        cycle_groups: None,
    }
}

pub fn run_ai_validation_rules(
    rule_ids: &[String],
    root: &Path,
    hierarchy: &HierarchyIndex,
    prior_validation: &[ValidationItem],
    llm_configurations: &[LlmConfiguration],
    llm_runtime: &AiValidationRuntimeSettings,
    rule_settings: &RuleSettingsMap,
    cancel: &AtomicBool,
    analysis_id: &str,
    emit: Arc<dyn Fn(AnalysisProgress) + Send + Sync>,
) -> Vec<ValidationItem> {
    let llm_runtime = llm_runtime.clone().normalized();
    let selected: Vec<&AiValidationRuleDef> = rule_ids
        .iter()
        .filter_map(|id| rule_def(id))
        .collect();

    if selected.is_empty() {
        return Vec::new();
    }

    let workspace = match ProjectWorkspace::new(root.to_path_buf()) {
        Ok(ws) => ws,
        Err(err) => {
            return selected
                .iter()
                .map(|rule| error_item(rule, err.0.clone()))
                .collect();
        }
    };

    let base_prompt = build_validation_prompt(root, hierarchy, prior_validation);
    let preamble_base = "You are DevTree's automated AI validation engine. Work only inside the opened project workspace. \
Use only these workspace tools: `read_files`, `edit_files`, `grep`, and `shell`. \
All paths and commands must stay within the current project root.\n\n";

    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(err) => {
            return selected
                .iter()
                .map(|rule| error_item(rule, format!("Failed to start AI runtime: {err}")))
                .collect();
        }
    };

    let mut results = Vec::new();
    let total = selected.len() as u32;
    for (index, rule) in selected.into_iter().enumerate() {
        if crate::analysis_session::is_cancelled(cancel) {
            results.push(error_item(rule, "AI validation cancelled".into()));
            continue;
        }

        let rule_cfg = rule_settings.get(rule.id);

        if rule.id == "ai_architecture" && selected_architecture_assessments(rule_cfg).is_empty() {
            results.push(ValidationItem {
                rule_id: rule.id.into(),
                rule_name: rule.name.into(),
                status: "warn".into(),
                message: "Skipped — enable at least one architecture assessment area in rule settings"
                    .into(),
                affected: vec![],
                cycle_groups: None,
            });
            continue;
        }

        if rule.id == "ai_code_review" && selected_code_review_lenses(rule_cfg).is_empty() {
            results.push(ValidationItem {
                rule_id: rule.id.into(),
                rule_name: rule.name.into(),
                status: "warn".into(),
                message: "Skipped — enable at least one code review lens in rule settings".into(),
                affected: vec![],
                cycle_groups: None,
            });
            continue;
        }

        if rule.id == "ai_clean_code" && selected_clean_code_principles(rule_cfg).is_empty() {
            results.push(ValidationItem {
                rule_id: rule.id.into(),
                rule_name: rule.name.into(),
                status: "warn".into(),
                message: "Skipped — enable at least one Clean Code principle in rule settings"
                    .into(),
                affected: vec![],
                cycle_groups: None,
            });
            continue;
        }

        let prompt = {
            let mut prompt = base_prompt.clone();
            if rule.id == "ai_architecture" {
                prompt.push_str("\n\n");
                prompt.push_str(&build_architecture_assessment_prompt(rule_cfg));
            } else if rule.id == "ai_code_review" {
                prompt.push_str("\n\n");
                prompt.push_str(&build_code_review_lens_prompt(rule_cfg));
            } else if rule.id == "ai_clean_code" {
                prompt.push_str("\n\n");
                prompt.push_str(&build_clean_code_principle_prompt(rule_cfg));
            }
            prompt
        };

        let override_enabled = cfg_bool(rule_cfg, "llm_override", false);
        let llm = resolve_llm_for_rule(llm_configurations, rule.id, rule_settings);

        if llm.api_key.trim().is_empty() {
            results.push(missing_llm_item(rule, override_enabled));
            continue;
        }

        let model = if llm.model.trim().is_empty() {
            default_model(&llm.provider)
        } else {
            llm.model.clone()
        };

        let preamble = format!("{preamble_base}{}", rule.instructions);
        let thinking = Arc::new(Mutex::new(String::new()));
        let text = Arc::new(Mutex::new(String::new()));
        let activity = Arc::new(Mutex::new(None::<String>));

        let emit_stream: Arc<dyn Fn(&str) + Send + Sync> = Arc::new({
            let thinking = Arc::clone(&thinking);
            let text = Arc::clone(&text);
            let activity = Arc::clone(&activity);
            let emit = Arc::clone(&emit);
            let rule_id = rule.id.to_string();
            let rule_name = rule.name.to_string();
            move |status: &str| {
                let stream = AiValidationStream {
                    rule_id: rule_id.clone(),
                    rule_name: rule_name.clone(),
                    thinking: thinking.lock().unwrap().clone(),
                    text: text.lock().unwrap().clone(),
                    activity: activity.lock().unwrap().clone(),
                    status: status.into(),
                };
                let current = index as u32 + 1;
                let pct = (92 + ((current as f32 / total.max(1) as f32) * 6.0) as u8).min(98);
                emit(AnalysisProgress {
                    analysis_id: analysis_id.into(),
                    stage: "validating".into(),
                    message: format!("AI validation: {}", rule_name),
                    current,
                    total,
                    percent: pct,
                    rule_tasks: None,
                    ai_stream: Some(stream),
                });
            }
        });

        thinking.lock().unwrap().clear();
        text.lock().unwrap().clear();
        *activity.lock().unwrap() = None;
        emit_stream("running");

        let stream_thinking = Arc::clone(&thinking);
        let stream_text = Arc::clone(&text);
        let stream_activity = Arc::clone(&activity);
        let emit_stream_for_event = Arc::clone(&emit_stream);
        let emit_on_event = move |event: ValidationStreamEvent| {
            match event {
                ValidationStreamEvent::ThinkingDelta(delta) => {
                    stream_thinking.lock().unwrap().push_str(&delta);
                }
                ValidationStreamEvent::TextDelta(delta) => {
                    stream_text.lock().unwrap().push_str(&delta);
                }
                ValidationStreamEvent::ToolActivity(label) => {
                    *stream_activity.lock().unwrap() = Some(label);
                }
            }
            emit_stream_for_event("running");
        };

        let outcome = runtime.block_on(run_validation_provider_stream(
            ValidationProviderStreamConfig {
                provider: llm.provider.clone(),
                model: &model,
                api_key: &llm.api_key,
                preamble: &preamble,
                prompt: &prompt,
                workspace: workspace.clone(),
                max_turns: llm_runtime.max_turns,
                cancel,
                on_event: &emit_on_event,
            },
        ));

        match outcome {
            Ok(raw) => {
                emit_stream("done");
                results.extend(parse_ai_output(rule, &raw));
            }
            Err(err) => {
                emit_stream("failed");
                results.push(error_item(rule, err));
            }
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_ai_validation_rules() {
        assert!(is_ai_validation_rule("ai_architecture"));
        assert!(!rule_definitions().is_empty());
    }
}
