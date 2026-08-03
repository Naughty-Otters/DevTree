use crate::analysis::{AiValidationStream, AnalysisProgress, AnalysisRule, RuleSettingDef, RuleSettingsMap, ValidationItem};
use crate::agent::ai_output_parse::parse_ai_findings;
use crate::agent::providers::{run_validation_provider_stream, ValidationProviderStreamConfig};
use crate::agent::runtime_limits::{
    clamp_agent_turns, clamp_validation_tokens, clamp_validation_turns, default_agent_max_turns,
    default_validation_max_tokens, default_validation_max_turns,
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
use std::collections::{HashMap, HashSet};
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
    /// Session token budget for AI validation. `0` = unlimited.
    #[serde(default = "default_validation_max_tokens")]
    pub max_tokens: u64,
}

impl Default for AiValidationRuntimeSettings {
    fn default() -> Self {
        Self {
            max_turns: default_validation_max_turns(),
            agent_max_turns: default_agent_max_turns(),
            max_tokens: default_validation_max_tokens(),
        }
    }
}

impl AiValidationRuntimeSettings {
    pub fn normalized(self) -> Self {
        Self {
            max_turns: clamp_validation_turns(self.max_turns),
            agent_max_turns: clamp_agent_turns(self.agent_max_turns),
            max_tokens: clamp_validation_tokens(self.max_tokens),
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

/// Fixed workflow order for the unified AI validation session.
const WORKFLOW_ORDER: &[&str] = &[
    "ai_architecture",
    "ai_code_review",
    "ai_clean_code",
    "ai_maintainability",
    "ai_test_gaps",
];

const SESSION_STREAM_ID: &str = "ai_validation";
const SESSION_STREAM_NAME: &str = "AI validation";

const OUTPUT_CONTRACT: &str = r#"Respond with ONLY valid JSON (no markdown fences) after finishing ALL workflow phases:
{"items":[{"rule_id":"ai_architecture|ai_code_review|ai_clean_code|ai_maintainability|ai_test_gaps","status":"pass|warn|fail","message":"summary","affected":["relative/path:line — detail"]}]}

Rules:
- Every item MUST include rule_id matching the phase that produced it.
- Emit one final JSON covering every phase you ran (not intermediate JSON per phase).
- Use pass when a phase finds no issues (one pass item per clean phase is enough).
- Each affected entry MUST be `relative/path:line — detail` or `relative/path:start-end — detail` (em dash between location and detail). Use a single line when possible; use start-end only for multi-line spans."#;

const WORKFLOW_HEADER: &str = r#"You run ONE multi-phase AI validation session for DevTree.
Complete phases in order. Finish each phase before starting the next.
Reuse tool results and project context across phases.
Do not modify project files. Prefer evidence from read_files / grep / shell.
`read_files` accepts bare paths or editor locations (`path:line`, `path:start-end`); do not invent OS `timeout` — the shell tool already enforces a ~90s limit.
Do NOT run full test suites or long installs (pytest/cargo test/npm test of the whole repo). Prefer reading failing test files and sampling small commands; shell times out after ~90s.
When all phases are done, output the final JSON only (see contract below).
"#;

struct PlannedPhase {
    rule: &'static AiValidationRuleDef,
    /// Extra lens/assessment prompt appended after skill instructions.
    lens_prompt: String,
}

struct PhaseSkip {
    rule: &'static AiValidationRuleDef,
    message: String,
}

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

fn global_configuration(configs: &[LlmConfiguration]) -> Option<&LlmConfiguration> {
    configs.iter().find(|config| config.is_global)
}

fn llm_from_configuration(config: &LlmConfiguration) -> AiValidationLlmSettings {
    AiValidationLlmSettings {
        provider: config.provider.clone(),
        model: config.model.clone(),
        api_key: config.api_key.clone(),
    }
}

/// Unified session uses the global LLM (or first configured key). Per-rule overrides are ignored.
fn resolve_session_llm(configurations: &[LlmConfiguration]) -> AiValidationLlmSettings {
    if let Some(global) = global_configuration(configurations) {
        let llm = llm_from_configuration(global);
        if !llm.api_key.trim().is_empty() {
            return llm;
        }
    }
    configurations
        .iter()
        .find(|config| !config.api_key.trim().is_empty())
        .map(llm_from_configuration)
        .unwrap_or_default()
}

fn rule_def(rule_id: &str) -> Option<&'static AiValidationRuleDef> {
    AI_RULES.iter().find(|rule| rule.id == rule_id)
}

/// Decide which AI rules become session phases vs skip-warn items.
fn plan_ai_phases(
    selected: &[&'static AiValidationRuleDef],
    rule_settings: &RuleSettingsMap,
) -> (Vec<PlannedPhase>, Vec<PhaseSkip>) {
    let selected_ids: HashSet<&str> = selected.iter().map(|rule| rule.id).collect();
    let mut phases = Vec::new();
    let mut skips = Vec::new();

    for &rule_id in WORKFLOW_ORDER {
        if !selected_ids.contains(rule_id) {
            continue;
        }
        let Some(rule) = rule_def(rule_id) else {
            continue;
        };
        let rule_cfg = rule_settings.get(rule.id);

        if rule.id == "ai_architecture" && selected_architecture_assessments(rule_cfg).is_empty() {
            skips.push(PhaseSkip {
                rule,
                message: "Skipped — enable at least one architecture assessment area in rule settings"
                    .into(),
            });
            continue;
        }
        if rule.id == "ai_code_review" && selected_code_review_lenses(rule_cfg).is_empty() {
            skips.push(PhaseSkip {
                rule,
                message: "Skipped — enable at least one code review lens in rule settings".into(),
            });
            continue;
        }
        if rule.id == "ai_clean_code" && selected_clean_code_principles(rule_cfg).is_empty() {
            skips.push(PhaseSkip {
                rule,
                message: "Skipped — enable at least one Clean Code principle in rule settings"
                    .into(),
            });
            continue;
        }

        let lens_prompt = match rule.id {
            "ai_architecture" => build_architecture_assessment_prompt(rule_cfg),
            "ai_code_review" => build_code_review_lens_prompt(rule_cfg),
            "ai_clean_code" => build_clean_code_principle_prompt(rule_cfg),
            _ => String::new(),
        };
        phases.push(PlannedPhase { rule, lens_prompt });
    }

    (phases, skips)
}

fn build_workflow_preamble(phases: &[PlannedPhase]) -> String {
    let mut out = String::from(WORKFLOW_HEADER);
    out.push_str("\n## Workflow phases\n");
    for (index, phase) in phases.iter().enumerate() {
        out.push_str(&format!(
            "\n### Phase {} — {} (`{}`)\n{}\n",
            index + 1,
            phase.rule.name,
            phase.rule.id,
            phase.rule.instructions.trim()
        ));
        if !phase.lens_prompt.trim().is_empty() {
            out.push('\n');
            out.push_str(phase.lens_prompt.trim());
            out.push('\n');
        }
        out.push_str(&format!(
            "\nTag every finding from this phase with rule_id=\"{}\".\n",
            phase.rule.id
        ));
    }
    out
}

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

fn finding_status(raw: &str) -> &'static str {
    match raw {
        "fail" | "failed" | "error" => "fail",
        "warn" | "warning" => "warn",
        _ => "pass",
    }
}

/// Attribute multi-phase session findings to the planned rules.
fn parse_session_output(phases: &[PlannedPhase], raw: &str) -> Vec<ValidationItem> {
    let fallback_rule = phases.first().map(|phase| phase.rule);
    let by_id: HashMap<&str, &AiValidationRuleDef> = phases
        .iter()
        .map(|phase| (phase.rule.id, phase.rule))
        .collect();

    let trimmed = raw.trim();
    let findings = match parse_ai_findings(trimmed) {
        Ok(findings) => findings,
        Err(_) => {
            return phases
                .iter()
                .map(|phase| ValidationItem {
                    rule_id: phase.rule.id.into(),
                    rule_name: phase.rule.name.into(),
                    status: "warn".into(),
                    message: format!(
                        "AI validation returned unstructured output: {}",
                        trimmed.chars().take(400).collect::<String>()
                    ),
                    affected: vec![],
                    cycle_groups: None,
                })
                .collect();
        }
    };

    let mut results = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    if findings.is_empty() {
        for phase in phases {
            results.push(ValidationItem {
                rule_id: phase.rule.id.into(),
                rule_name: phase.rule.name.into(),
                status: "pass".into(),
                message: "AI validation found no issues".into(),
                affected: vec![],
                cycle_groups: None,
            });
        }
        return results;
    }

    for finding in findings {
        let rule = if !finding.rule_id.is_empty() {
            by_id
                .get(finding.rule_id.as_str())
                .copied()
                .or(fallback_rule)
        } else {
            fallback_rule
        };

        let Some(rule) = rule else {
            continue;
        };
        seen.insert(rule.id.to_string());
        results.push(ValidationItem {
            rule_id: rule.id.into(),
            rule_name: rule.name.into(),
            status: finding_status(&finding.status).into(),
            message: finding.message,
            affected: finding.affected,
            cycle_groups: None,
        });
    }

    for phase in phases {
        if seen.contains(phase.rule.id) {
            continue;
        }
        results.push(ValidationItem {
            rule_id: phase.rule.id.into(),
            rule_name: phase.rule.name.into(),
            status: "pass".into(),
            message: "AI validation found no issues".into(),
            affected: vec![],
            cycle_groups: None,
        });
    }

    results
}

fn missing_llm_item(rule: &AiValidationRuleDef) -> ValidationItem {
    ValidationItem {
        rule_id: rule.id.into(),
        rule_name: rule.name.into(),
        status: "warn".into(),
        message: "Skipped — configure LLM providers in Settings → LLM Configurations".into(),
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

fn session_turns(base: u32, phase_count: usize) -> u32 {
    let scale = (phase_count as u32).max(1);
    clamp_validation_turns(base.saturating_mul(scale))
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
    let selected: Vec<&'static AiValidationRuleDef> =
        rule_ids.iter().filter_map(|id| rule_def(id)).collect();

    if selected.is_empty() {
        return Vec::new();
    }

    let (phases, skips) = plan_ai_phases(&selected, rule_settings);
    let mut results: Vec<ValidationItem> = skips
        .into_iter()
        .map(|skip| ValidationItem {
            rule_id: skip.rule.id.into(),
            rule_name: skip.rule.name.into(),
            status: "warn".into(),
            message: skip.message,
            affected: vec![],
            cycle_groups: None,
        })
        .collect();

    if phases.is_empty() {
        return results;
    }

    let workspace = match ProjectWorkspace::new(root.to_path_buf()) {
        Ok(ws) => ws,
        Err(err) => {
            results.extend(
                phases
                    .iter()
                    .map(|phase| error_item(phase.rule, err.0.clone())),
            );
            return results;
        }
    };

    let llm = resolve_session_llm(llm_configurations);
    if llm.api_key.trim().is_empty() {
        results.extend(phases.iter().map(|phase| missing_llm_item(phase.rule)));
        return results;
    }

    let model = if llm.model.trim().is_empty() {
        default_model(&llm.provider)
    } else {
        llm.model.clone()
    };

    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(err) => {
            results.extend(phases.iter().map(|phase| {
                error_item(phase.rule, format!("Failed to start AI runtime: {err}"))
            }));
            return results;
        }
    };

    if crate::analysis_session::is_cancelled(cancel) {
        results.extend(
            phases
                .iter()
                .map(|phase| error_item(phase.rule, "AI validation cancelled".into())),
        );
        return results;
    }

    let preamble_base = "You are DevTree's automated AI validation engine. Work only inside the opened project workspace. \
Use only these workspace tools: `read_files`, `edit_files`, `grep`, and `shell`. \
All paths and commands must stay within the current project root.\n\n";
    let preamble = format!("{preamble_base}{}", build_workflow_preamble(&phases));
    let prompt = build_validation_prompt(root, hierarchy, prior_validation);
    let max_turns = session_turns(llm_runtime.max_turns, phases.len());
    let phase_count = phases.len() as u32;

    let thinking = Arc::new(Mutex::new(String::new()));
    let text = Arc::new(Mutex::new(String::new()));
    let activity = Arc::new(Mutex::new(None::<String>));
    let tool_log = Arc::new(Mutex::new(String::new()));
    let budget = Arc::new(Mutex::new(None::<String>));
    let analysis_id = analysis_id.to_string();

    let emit_stream: Arc<dyn Fn(&str) + Send + Sync> = Arc::new({
        let thinking = Arc::clone(&thinking);
        let text = Arc::clone(&text);
        let activity = Arc::clone(&activity);
        let tool_log = Arc::clone(&tool_log);
        let budget = Arc::clone(&budget);
        let emit = Arc::clone(&emit);
        let analysis_id = analysis_id.clone();
        move |status: &str| {
            let stream = AiValidationStream {
                rule_id: SESSION_STREAM_ID.into(),
                rule_name: SESSION_STREAM_NAME.into(),
                thinking: thinking.lock().unwrap().clone(),
                text: text.lock().unwrap().clone(),
                activity: activity.lock().unwrap().clone(),
                tool_log: tool_log.lock().unwrap().clone(),
                budget: budget.lock().unwrap().clone(),
                status: status.into(),
            };
            emit(AnalysisProgress {
                analysis_id: analysis_id.clone(),
                stage: "validating".into(),
                message: format!("AI validation ({phase_count} phases)"),
                current: 1,
                total: 1,
                percent: if status == "done" { 98 } else { 94 },
                rule_tasks: None,
                ai_stream: Some(stream),
            });
        }
    });

    thinking.lock().unwrap().clear();
    text.lock().unwrap().clear();
    *activity.lock().unwrap() = None;
    tool_log.lock().unwrap().clear();
    *budget.lock().unwrap() = None;
    emit_stream("running");

    let stream_thinking = Arc::clone(&thinking);
    let stream_text = Arc::clone(&text);
    let stream_activity = Arc::clone(&activity);
    let stream_tool_log = Arc::clone(&tool_log);
    let stream_budget = Arc::clone(&budget);
    let emit_stream_for_event = Arc::clone(&emit_stream);
    let append_tool_log: Arc<dyn Fn(String) + Send + Sync> = Arc::new({
        let stream_tool_log = Arc::clone(&stream_tool_log);
        move |chunk: String| {
            append_capped_log(&mut stream_tool_log.lock().unwrap(), &chunk, TOOL_LOG_MAX_CHARS);
        }
    });
    let tool_output = crate::agent::tools::ToolOutputReporter::new(Arc::new({
        let append_tool_log = Arc::clone(&append_tool_log);
        let emit_stream_for_event = Arc::clone(&emit_stream_for_event);
        move |chunk: String| {
            append_tool_log(chunk);
            emit_stream_for_event("running");
        }
    }));
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
            ValidationStreamEvent::ToolOutputDelta(delta) => {
                append_tool_log(delta);
            }
            ValidationStreamEvent::BudgetStatus(label) => {
                *stream_budget.lock().unwrap() = Some(label);
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
            max_turns,
            max_tokens: llm_runtime.max_tokens,
            cancel,
            on_event: &emit_on_event,
            tool_output: Some(tool_output),
        },
    ));

    match outcome {
        Ok(raw) => {
            emit_stream("done");
            results.extend(parse_session_output(&phases, &raw));
        }
        Err(err) => {
            emit_stream("failed");
            results.extend(phases.iter().map(|phase| error_item(phase.rule, err.clone())));
        }
    }

    results
}

const TOOL_LOG_MAX_CHARS: usize = 48_000;

fn append_capped_log(buf: &mut String, chunk: &str, max: usize) {
    buf.push_str(chunk);
    let len = buf.chars().count();
    if len <= max {
        return;
    }
    let skip = len - max;
    *buf = buf.chars().skip(skip).collect();
    if !buf.starts_with('…') {
        buf.insert_str(0, "…\n");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::code_review_lenses::CODE_REVIEW_LENSES;
    use crate::agent::runtime_limits::MAX_VALIDATION_TURNS;
    use crate::analysis::RuleSettingsMap;
    use serde_json::json;

    #[test]
    fn detects_ai_validation_rules() {
        assert!(is_ai_validation_rule("ai_architecture"));
        assert!(!rule_definitions().is_empty());
    }

    #[test]
    fn plans_phases_in_workflow_order_and_skips_empty_lenses() {
        let selected: Vec<&AiValidationRuleDef> = [
            "ai_test_gaps",
            "ai_code_review",
            "ai_architecture",
            "ai_clean_code",
        ]
        .into_iter()
        .filter_map(rule_def)
        .collect();

        let mut arch = serde_json::Map::new();
        arch.insert("arch_patterns".into(), json!(true));

        let mut review = serde_json::Map::new();
        for lens in CODE_REVIEW_LENSES {
            review.insert(lens.key.into(), json!(false));
        }

        let mut clean = serde_json::Map::new();
        clean.insert("clean_dry".into(), json!(true));
        // disable other principles so only dry is selected (defaults are true)
        for principle in [
            "clean_meaningful_names",
            "clean_functions",
            "clean_single_responsibility",
            "clean_comments",
            "clean_error_handling",
            "clean_boundaries",
            "clean_unit_tests",
            "clean_classes_and_data",
            "clean_code_smells",
            "clean_boy_scout",
        ] {
            clean.insert(principle.into(), json!(false));
        }

        let mut settings = RuleSettingsMap::new();
        settings.insert("ai_architecture".into(), arch);
        settings.insert("ai_code_review".into(), review);
        settings.insert("ai_clean_code".into(), clean);

        let (phases, skips) = plan_ai_phases(&selected, &settings);
        assert_eq!(
            phases.iter().map(|p| p.rule.id).collect::<Vec<_>>(),
            vec!["ai_architecture", "ai_clean_code", "ai_test_gaps"]
        );
        assert_eq!(skips.len(), 1);
        assert_eq!(skips[0].rule.id, "ai_code_review");
        assert!(phases[0].lens_prompt.contains("Selected assessments"));
        assert!(phases[1].lens_prompt.contains("clean_dry"));
    }

    #[test]
    fn workflow_preamble_includes_selected_phase_ids() {
        let rule = rule_def("ai_maintainability").expect("rule");
        let preamble = build_workflow_preamble(&[PlannedPhase {
            rule,
            lens_prompt: String::new(),
        }]);
        assert!(preamble.contains("ai_maintainability"));
        assert!(preamble.contains("Phase 1"));
        assert!(preamble.contains("ONE multi-phase"));
    }

    #[test]
    fn session_output_attributes_by_rule_id_and_fills_missing_passes() {
        let arch = rule_def("ai_architecture").expect("arch");
        let review = rule_def("ai_code_review").expect("review");
        let phases = vec![
            PlannedPhase {
                rule: arch,
                lens_prompt: String::new(),
            },
            PlannedPhase {
                rule: review,
                lens_prompt: String::new(),
            },
        ];
        let raw = r#"{"items":[{"rule_id":"ai_code_review","status":"warn","message":"hot path","affected":["src/a.ts — loop"]}]}"#;
        let items = parse_session_output(&phases, raw);
        assert!(items
            .iter()
            .any(|i| i.rule_id == "ai_architecture" && i.status == "pass"));
        assert!(items
            .iter()
            .any(|i| i.rule_id == "ai_code_review" && i.status == "warn"));
    }

    #[test]
    fn session_turns_scale_with_phase_count() {
        assert!(session_turns(128, 3) >= session_turns(128, 1));
        assert!(session_turns(128, 5) <= MAX_VALIDATION_TURNS);
    }

    #[test]
    fn resolve_session_llm_prefers_global_with_key() {
        let configs = vec![
            LlmConfiguration {
                id: "other".into(),
                name: "Other".into(),
                provider: LlmProvider::Openai,
                api_key: "sk-other".into(),
                model: "gpt-other".into(),
                is_global: false,
            },
            LlmConfiguration {
                id: "global".into(),
                name: "Global".into(),
                provider: LlmProvider::Anthropic,
                api_key: "sk-global".into(),
                model: "claude".into(),
                is_global: true,
            },
        ];
        let llm = resolve_session_llm(&configs);
        assert_eq!(llm.api_key, "sk-global");
        assert_eq!(llm.model, "claude");
    }
}
