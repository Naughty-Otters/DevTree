use crate::analysis::RuleSettingDef;

pub struct CleanCodePrinciple {
    pub key: &'static str,
    pub label: &'static str,
    /// Full markdown body from `src/ai_validation/skills/ai-clean-code/rules/`.
    pub checklist: &'static str,
}

pub const CLEAN_CODE_SKILL_INSTRUCTIONS: &str =
    include_str!("../../../src/ai_validation/skills/ai-clean-code/SKILL.md");

/// Clean Code principles loaded from DevTree skill rules.
pub const CLEAN_CODE_PRINCIPLES: &[CleanCodePrinciple] = &[
    CleanCodePrinciple {
        key: "clean_meaningful_names",
        label: "Meaningful names",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-clean-code/rules/meaningful-names.md"
        ),
    },
    CleanCodePrinciple {
        key: "clean_functions",
        label: "Functions",
        checklist: include_str!("../../../src/ai_validation/skills/ai-clean-code/rules/functions.md"),
    },
    CleanCodePrinciple {
        key: "clean_single_responsibility",
        label: "Single responsibility",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-clean-code/rules/single-responsibility.md"
        ),
    },
    CleanCodePrinciple {
        key: "clean_dry",
        label: "DRY",
        checklist: include_str!("../../../src/ai_validation/skills/ai-clean-code/rules/dry.md"),
    },
    CleanCodePrinciple {
        key: "clean_comments",
        label: "Comments",
        checklist: include_str!("../../../src/ai_validation/skills/ai-clean-code/rules/comments.md"),
    },
    CleanCodePrinciple {
        key: "clean_error_handling",
        label: "Error handling",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-clean-code/rules/error-handling.md"
        ),
    },
    CleanCodePrinciple {
        key: "clean_boundaries",
        label: "Boundaries",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-clean-code/rules/boundaries.md"
        ),
    },
    CleanCodePrinciple {
        key: "clean_unit_tests",
        label: "Unit tests",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-clean-code/rules/unit-tests.md"
        ),
    },
    CleanCodePrinciple {
        key: "clean_classes_and_data",
        label: "Classes & data",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-clean-code/rules/classes-and-data.md"
        ),
    },
    CleanCodePrinciple {
        key: "clean_code_smells",
        label: "Code smells",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-clean-code/rules/code-smells.md"
        ),
    },
    CleanCodePrinciple {
        key: "clean_boy_scout",
        label: "Boy Scout rule",
        checklist: include_str!(
            "../../../src/ai_validation/skills/ai-clean-code/rules/boy-scout.md"
        ),
    },
];

pub fn clean_code_rule_settings(llm_settings: Vec<RuleSettingDef>) -> Vec<RuleSettingDef> {
    let mut settings = llm_settings;
    for principle in CLEAN_CODE_PRINCIPLES {
        settings.push(RuleSettingDef {
            key: principle.key.into(),
            label: format!("Principle: {}", principle.label),
            kind: "boolean".into(),
            default: serde_json::json!(true),
            min: None,
            max: None,
            options: None,
        });
    }
    settings
}

pub fn selected_clean_code_principles(
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Vec<&'static CleanCodePrinciple> {
    CLEAN_CODE_PRINCIPLES
        .iter()
        .filter(|p| cfg_bool(cfg, p.key, true))
        .collect()
}

pub fn build_clean_code_principle_prompt(
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> String {
    let selected = selected_clean_code_principles(cfg);
    if selected.is_empty() {
        return "Selected Clean Code principles: (none enabled — enable at least one principle in rule settings)"
            .into();
    }

    let mut section = String::from("## Selected Clean Code principles\n\n");
    section.push_str(
        "Apply ONLY the principles below to the **current workspace change set** (git status/diff).\n\
For each principle, follow its checklist and ground findings in changed files.\n\
Use severity labels: blocking (fail), important (warn), nit (optional note).\n\n",
    );

    for (index, principle) in selected.iter().enumerate() {
        section.push_str(&format!(
            "### {}. {} (`{}`)\n\n{}\n\n",
            index + 1,
            principle.label,
            principle.key,
            principle.checklist.trim()
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
    fn selects_enabled_clean_code_principles() {
        assert_eq!(CLEAN_CODE_PRINCIPLES.len(), 11);
        let selected = selected_clean_code_principles(None);
        assert_eq!(selected.len(), 11);
        let prompt = build_clean_code_principle_prompt(None);
        assert!(prompt.contains("Selected Clean Code principles"));
        assert!(prompt.contains("clean_meaningful_names"));
        assert!(CLEAN_CODE_SKILL_INSTRUCTIONS.contains("workspace code changes"));
    }

    #[test]
    fn respects_disabled_principles() {
        let mut map = serde_json::Map::new();
        for p in CLEAN_CODE_PRINCIPLES {
            map.insert(p.key.into(), serde_json::json!(false));
        }
        map.insert("clean_dry".into(), serde_json::json!(true));
        let selected = selected_clean_code_principles(Some(&map));
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].key, "clean_dry");
    }
}
