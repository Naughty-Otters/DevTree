// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    devtree_lib::run()
}

#[cfg(test)]
mod tests {
    #[test]
    fn binary_links_library() {
        assert!(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src").exists());
    }
}
