//! Per-language linter discovery, installation, and validation runs.

mod discover;
mod run;
mod status;

pub use discover::LanguageKind;
pub use run::run_language_linter_checks;
pub use status::{
    default_linter_settings, enrich_path, install_linter, list_language_linters, linter_cfg,
    merge_linter_settings, LinterInstallResult, LinterLevelDef, LinterOption,
    LinterSettingsMap, LanguageLinterGroup,
};
