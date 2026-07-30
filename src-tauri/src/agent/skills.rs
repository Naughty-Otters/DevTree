use super::types::AgentSkillInfo;

pub struct AgentSkill {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub instructions: &'static str,
}

const SKILLS: &[AgentSkill] = &[
    AgentSkill {
        id: "explain_module",
        name: "Explain Module",
        description: "Explain what a module or file does and how it fits in the project.",
        instructions: include_str!("../../../src/agent/skills/explain_module.md"),
    },
    AgentSkill {
        id: "review_validation",
        name: "Review Validation",
        description: "Investigate validation issues and suggest concrete fixes in the workspace.",
        instructions: include_str!("../../../src/agent/skills/review_validation.md"),
    },
    AgentSkill {
        id: "refactor_plan",
        name: "Refactor Plan",
        description: "Propose a safe refactor plan with file-level steps grounded in the repo.",
        instructions: include_str!("../../../src/agent/skills/refactor_plan.md"),
    },
];

pub fn list_skills() -> Vec<AgentSkillInfo> {
    SKILLS
        .iter()
        .map(|skill| AgentSkillInfo {
            id: skill.id.to_string(),
            name: skill.name.to_string(),
            description: skill.description.to_string(),
        })
        .collect()
}

pub fn skill_by_id(id: &str) -> Option<&'static AgentSkill> {
    SKILLS.iter().find(|skill| skill.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_and_resolves_skills() {
        let skills = list_skills();
        assert!(!skills.is_empty());
        assert!(skill_by_id(&skills[0].id).is_some());
    }
}
