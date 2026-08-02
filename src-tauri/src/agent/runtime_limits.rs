pub const MIN_TURNS: u32 = 4;
pub const MAX_VALIDATION_TURNS: u32 = 512;
pub const DEFAULT_VALIDATION_MAX_TURNS: u32 = 128;
pub const MAX_AGENT_TURNS: u32 = 256;
pub const DEFAULT_AGENT_MAX_TURNS: u32 = 64;

/// 0 = unlimited session token budget for AI validation.
pub const DEFAULT_VALIDATION_MAX_TOKENS: u64 = 0;
pub const MIN_VALIDATION_MAX_TOKENS: u64 = 1_000;
pub const MAX_VALIDATION_MAX_TOKENS: u64 = 2_000_000;

pub fn default_validation_max_turns() -> u32 {
    DEFAULT_VALIDATION_MAX_TURNS
}

pub fn default_agent_max_turns() -> u32 {
    DEFAULT_AGENT_MAX_TURNS
}

pub fn default_validation_max_tokens() -> u64 {
    DEFAULT_VALIDATION_MAX_TOKENS
}

pub fn clamp_validation_turns(value: u32) -> u32 {
    if value == 0 {
        return DEFAULT_VALIDATION_MAX_TURNS;
    }
    value.clamp(MIN_TURNS, MAX_VALIDATION_TURNS)
}

pub fn clamp_agent_turns(value: u32) -> u32 {
    if value == 0 {
        return DEFAULT_AGENT_MAX_TURNS;
    }
    value.clamp(MIN_TURNS, MAX_AGENT_TURNS)
}

/// `0` means unlimited. Non-zero values are clamped into the allowed range.
pub fn clamp_validation_tokens(value: u64) -> u64 {
    if value == 0 {
        return 0;
    }
    value.clamp(MIN_VALIDATION_MAX_TOKENS, MAX_VALIDATION_MAX_TOKENS)
}

pub fn turns_as_usize(value: u32) -> usize {
    value.max(MIN_TURNS) as usize
}

/// Prefer provider `total_tokens`; fall back to input+output when total is unset.
pub fn usage_total_tokens(total: u64, input: u64, output: u64) -> u64 {
    if total > 0 {
        total
    } else {
        input.saturating_add(output)
    }
}

pub fn token_budget_exceeded(used: u64, max_tokens: u64) -> bool {
    max_tokens > 0 && used >= max_tokens
}

pub fn format_token_budget(used: u64, max_tokens: u64) -> String {
    if max_tokens == 0 {
        format!("Tokens {}", format_token_count(used))
    } else {
        format!(
            "Tokens {} / {}",
            format_token_count(used),
            format_token_count(max_tokens)
        )
    }
}

fn format_token_count(n: u64) -> String {
    if n >= 10_000 {
        format!("{:.1}k", n as f64 / 1000.0)
    } else if n >= 1_000 {
        format!("{:.2}k", n as f64 / 1000.0)
    } else {
        n.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_validation_and_agent_turns() {
        assert_eq!(clamp_validation_turns(0), DEFAULT_VALIDATION_MAX_TURNS);
        assert_eq!(clamp_agent_turns(9999), MAX_AGENT_TURNS);
        assert_eq!(turns_as_usize(2), MIN_TURNS as usize);
    }

    #[test]
    fn clamps_validation_tokens() {
        assert_eq!(clamp_validation_tokens(0), 0);
        assert_eq!(clamp_validation_tokens(50), MIN_VALIDATION_MAX_TOKENS);
        assert_eq!(
            clamp_validation_tokens(9_999_999),
            MAX_VALIDATION_MAX_TOKENS
        );
    }

    #[test]
    fn usage_and_budget_helpers() {
        assert_eq!(usage_total_tokens(100, 1, 2), 100);
        assert_eq!(usage_total_tokens(0, 10, 5), 15);
        assert!(!token_budget_exceeded(99, 100));
        assert!(token_budget_exceeded(100, 100));
        assert!(!token_budget_exceeded(999_999, 0));
        assert!(format_token_budget(1500, 50_000).contains('/'));
    }
}
