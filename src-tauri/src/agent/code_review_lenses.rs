use crate::analysis::RuleSettingDef;

pub struct CodeReviewLens {
    pub key: &'static str,
    pub label: &'static str,
    /// Full markdown body from `src/ai_validation/skills/ai-code-reviewer/rules/`.
    pub checklist: &'static str,
}

/// Cross-cutting review lenses loaded from DevTree skill rules.
pub const CODE_REVIEW_LENSES: &[CodeReviewLens] = &[
    CodeReviewLens {
        key: "review_performance",
        label: "Performance",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-code-reviewer/rules/review-performance.md"
        ),
    },
    CodeReviewLens {
        key: "review_security",
        label: "Security",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-code-reviewer/rules/review-security.md"
        ),
    },
    CodeReviewLens {
        key: "review_universal_quality",
        label: "Universal quality",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-code-reviewer/rules/review-universal-quality.md"
        ),
    },
    CodeReviewLens {
        key: "review_common_bugs",
        label: "Common bugs",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-code-reviewer/rules/review-common-bugs.md"
        ),
    },
    CodeReviewLens {
        key: "review_sql_injection",
        label: "SQL injection",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-code-reviewer/rules/review-sql-injection.md"
        ),
    },
    CodeReviewLens {
        key: "review_xss",
        label: "XSS prevention",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-code-reviewer/rules/review-xss.md"
        ),
    },
    CodeReviewLens {
        key: "review_n_plus_one",
        label: "N+1 queries",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-code-reviewer/rules/review-n-plus-one.md"
        ),
    },
    CodeReviewLens {
        key: "review_error_handling",
        label: "Error handling",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-code-reviewer/rules/review-error-handling.md"
        ),
    },
    CodeReviewLens {
        key: "review_async_concurrency",
        label: "Async & concurrency",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-code-reviewer/rules/review-async-concurrency.md"
        ),
    },
    CodeReviewLens {
        key: "review_anti_patterns",
        label: "Anti-patterns",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-code-reviewer/rules/review-anti-patterns.md"
        ),
    },
    CodeReviewLens {
        key: "review_logging",
        label: "Logging strategy",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-code-reviewer/rules/review-logging.md"
        ),
    },
];

pub const CODE_REVIEW_SKILL_INSTRUCTIONS: &str =
    include_str!("../../../src/ai_validation/skills/ai-code-reviewer/SKILL.md");

pub fn code_review_rule_settings(llm_settings: Vec<RuleSettingDef>) -> Vec<RuleSettingDef> {
    let mut settings = llm_settings;
    for lens in CODE_REVIEW_LENSES {
        settings.push(RuleSettingDef {
            key: lens.key.into(),
            label: format!("Review: {}", lens.label),
            kind: "boolean".into(),
            default: serde_json::json!(true),
            min: None,
            max: None,
            options: None,
        });
    }
    settings
}

pub fn selected_code_review_lenses(
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Vec<&'static CodeReviewLens> {
    CODE_REVIEW_LENSES
        .iter()
        .filter(|lens| cfg_bool(cfg, lens.key, true))
        .collect()
}

pub fn build_code_review_lens_prompt(
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> String {
    let selected = selected_code_review_lenses(cfg);
    if selected.is_empty() {
        return "Selected review lenses: (none enabled — enable at least one lens in rule settings)"
            .into();
    }

    let mut section = String::from("## Selected review lenses\n\n");
    section.push_str(
        "Apply ONLY the lenses below. For each lens, follow its checklist and ground findings in repo evidence.\n\
Use severity labels in findings: blocking (fail), important (warn), nit (optional note).\n\n",
    );

    for (index, lens) in selected.iter().enumerate() {
        section.push_str(&format!(
            "### {}. {} (`{}`)\n\n{}\n\n",
            index + 1,
            lens.label,
            lens.key,
            lens.checklist.trim()
        ));
    }

    section
}

fn cfg_bool(cfg: Option<&serde_json::Map<String, serde_json::Value>>, key: &str, default: bool) -> bool {
    cfg.and_then(|m| m.get(key))
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_enabled_code_review_lenses() {
        assert_eq!(CODE_REVIEW_LENSES.len(), 11);
        let selected = selected_code_review_lenses(None);
        assert_eq!(selected.len(), 11);
        let prompt = build_code_review_lens_prompt(None);
        assert!(prompt.contains("Selected review lenses"));
        assert!(prompt.contains("review_security"));
        assert!(prompt.contains("Security Review"));
        assert!(CODE_REVIEW_SKILL_INSTRUCTIONS.contains("AI Code Reviewer"));
    }

    #[test]
    fn respects_disabled_lenses() {
        let mut map = serde_json::Map::new();
        for lens in CODE_REVIEW_LENSES {
            map.insert(lens.key.into(), serde_json::json!(false));
        }
        map.insert("review_security".into(), serde_json::json!(true));
        let selected = selected_code_review_lenses(Some(&map));
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].key, "review_security");
    }
}
