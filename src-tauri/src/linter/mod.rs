//! Per-language linter discovery, installation, and validation runs.

mod discover;
mod run;
mod status;

pub use discover::{languages_in_files, LanguageKind};
pub use run::run_language_linter_for_lang;
pub use status::{
    install_linter, list_language_linters, LanguageLinterGroup, LinterInstallResult,
    LinterSettingsMap,
};
