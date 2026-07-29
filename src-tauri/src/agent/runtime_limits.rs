pub const MIN_TURNS: u32 = 4;
pub const MAX_VALIDATION_TURNS: u32 = 512;
pub const DEFAULT_VALIDATION_MAX_TURNS: u32 = 128;
pub const MAX_AGENT_TURNS: u32 = 256;
pub const DEFAULT_AGENT_MAX_TURNS: u32 = 64;

pub fn default_validation_max_turns() -> u32 {
    DEFAULT_VALIDATION_MAX_TURNS
}

pub fn default_agent_max_turns() -> u32 {
    DEFAULT_AGENT_MAX_TURNS
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

pub fn turns_as_usize(value: u32) -> usize {
    value.max(MIN_TURNS) as usize
}
