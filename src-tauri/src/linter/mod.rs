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

#[cfg(test)]
mod tests {
    #[test]
    fn linter_module_exports_are_linked() {
        assert!(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/linter").exists());
    }
}
