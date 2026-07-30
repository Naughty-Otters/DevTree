use crate::analysis::RuleSettingDef;

pub struct ArchitectureAssessment {
    pub key: &'static str,
    pub label: &'static str,
    pub checklist: &'static str,
}

pub const ARCHITECTURE_ASSESSMENTS: &[ArchitectureAssessment] = &[
    ArchitectureAssessment {
        key: "arch_patterns",
        label: "Architecture patterns",
        checklist: "Evaluate visible patterns: layered vs hexagonal boundaries, domain-driven module boundaries, event-driven design signals, monolith vs microservice/service boundaries, CQRS/event sourcing usage, separation of concerns.",
    },
    ArchitectureAssessment {
        key: "arch_system_design",
        label: "System design",
        checklist: "Component boundaries, data flow between modules, API/route design quality, service contracts, dependency direction, coupling vs cohesion, modularity and navigability of the codebase.",
    },
    ArchitectureAssessment {
        key: "arch_scalability",
        label: "Scalability",
        checklist: "Horizontal/vertical scaling hooks, data partitioning/sharding signals, load distribution, caching strategies, database scaling patterns, message queuing, async workers, performance limits visible in design.",
    },
    ArchitectureAssessment {
        key: "arch_technology",
        label: "Technology stack",
        checklist: "Stack appropriateness for the problem, technology consistency across the repo, dependency maturity, duplication of competing libraries, licensing/cost implications in manifests, migration complexity if stack is mixed.",
    },
    ArchitectureAssessment {
        key: "arch_integration",
        label: "Integration patterns",
        checklist: "API design (REST/GraphQL/RPC), messaging/event patterns, service discovery/config, circuit breakers/retries/timeouts, data synchronization, transaction boundaries across services.",
    },
    ArchitectureAssessment {
        key: "arch_security",
        label: "Security architecture",
        checklist: "Authentication/authorization model, data encryption (at rest/in transit), network/security boundaries, secret/credential handling, audit logging, compliance-related controls visible in code/config.",
    },
    ArchitectureAssessment {
        key: "arch_performance",
        label: "Performance architecture",
        checklist: "Caching layers, CDN/static asset strategy, DB query/index patterns, async vs sync processing, batch operations, resource pooling, hot paths and bottlenecks suggested by structure.",
    },
    ArchitectureAssessment {
        key: "arch_data",
        label: "Data architecture",
        checklist: "Data models and schema design, storage strategy (SQL/NoSQL/files), consistency requirements, migrations, backup/archive signals, data governance/privacy patterns in code.",
    },
    ArchitectureAssessment {
        key: "arch_technical_debt",
        label: "Technical debt",
        checklist: "Architecture smells, outdated patterns, technology obsolescence, complexity hotspots, maintenance burden, risk areas, pragmatic modernization priorities.",
    },
];


pub fn architecture_rule_settings(llm_settings: Vec<RuleSettingDef>) -> Vec<RuleSettingDef> {
    let mut settings = llm_settings;
    for assessment in ARCHITECTURE_ASSESSMENTS {
        settings.push(RuleSettingDef {
            key: assessment.key.into(),
            label: format!("Assess: {}", assessment.label),
            kind: "boolean".into(),
            default: serde_json::json!(true),
            min: None,
            max: None,
            options: None,
        });
    }
    settings
}

pub fn selected_architecture_assessments(
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Vec<&'static ArchitectureAssessment> {
    ARCHITECTURE_ASSESSMENTS
        .iter()
        .filter(|assessment| cfg_bool(cfg, assessment.key, true))
        .collect()
}

pub fn build_architecture_assessment_prompt(
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> String {
    let selected = selected_architecture_assessments(cfg);
    if selected.is_empty() {
        return "Selected assessments: (none enabled — enable at least one assessment in rule settings)".into();
    }

    let mut section = String::from("## Selected assessments\n\n");
    section.push_str(
        "Evaluate ONLY the areas below. For each area, apply its checklist using evidence from the repo.\n\n",
    );

    for (index, assessment) in selected.iter().enumerate() {
        section.push_str(&format!(
            "### {}. {} (`{}`)\n{}\n\n",
            index + 1,
            assessment.label,
            assessment.key,
            assessment.checklist
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
    fn selects_enabled_architecture_assessments() {
        assert!(!ARCHITECTURE_ASSESSMENTS.is_empty());
        let selected = selected_architecture_assessments(None);
        assert!(!selected.is_empty());
        let prompt = build_architecture_assessment_prompt(None);
        assert!(prompt.contains("Selected assessments"));
    }
}
