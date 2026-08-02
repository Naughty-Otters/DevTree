use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeEntry>>,
    /// True when this directory has listable children that were not loaded yet.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub has_children: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectScan {
    pub root: String,
    pub tree: TreeEntry,
    pub modules: Vec<ModuleEntry>,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".cache",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    ".idea",
    ".vscode",
    "pkg",
];

fn should_skip(name: &str) -> bool {
    SKIP_DIRS.contains(&name) || name.starts_with('.')
}

fn sort_children(children: &mut [TreeEntry]) {
    // Folders first, then files; alphabetical within each group.
    children.sort_by(|a, b| {
        let a_dir = a.kind == "directory";
        let b_dir = b.kind == "directory";
        match (a_dir, b_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()),
        }
    });
}

fn rel_path_for(path: &Path, root: &Path, fallback: &str) -> String {
    path.strip_prefix(root)
        .map(|p| {
            if p.as_os_str().is_empty() {
                ".".to_string()
            } else {
                p.to_string_lossy().to_string()
            }
        })
        .unwrap_or_else(|_| fallback.to_string())
}

fn dir_has_listable_children(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.path().is_dir() {
            if !should_skip(&name) {
                return true;
            }
        } else if !name.starts_with('.') {
            return true;
        }
    }
    false
}

/// List immediate children of `dir` (one level only). Directories are stubs
/// with `has_children` set when they contain further listable entries.
fn list_dir_children(dir: &Path, root: &Path) -> Result<Vec<TreeEntry>, String> {
    let mut children = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {e}", dir.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if should_skip(&name) {
                continue;
            }
            let rel = rel_path_for(&path, root, &name);
            let has_children = dir_has_listable_children(&path);
            children.push(TreeEntry {
                name,
                path: rel,
                kind: "directory".into(),
                children: None,
                has_children,
            });
        } else if !name.starts_with('.') {
            let rel = rel_path_for(&path, root, &name);
            children.push(TreeEntry {
                name,
                path: rel,
                kind: "file".into(),
                children: None,
                has_children: false,
            });
        }
    }
    sort_children(&mut children);
    Ok(children)
}

/// Shallow project open: root folder + immediate children only.
/// Nested folders and module indexes are not scanned (lazy-loaded later).
pub fn scan_project(root_path: &str) -> Result<ProjectScan, String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {root_path}"));
    }

    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| root_path.to_string());

    let children = list_dir_children(&root, &root)?;
    let has_children = !children.is_empty();

    Ok(ProjectScan {
        root: root_path.to_string(),
        tree: TreeEntry {
            name,
            path: ".".into(),
            kind: "directory".into(),
            children: if has_children { Some(children) } else { None },
            has_children,
        },
        // Modules come from analysis/graph — never preload via full-tree walk.
        modules: vec![],
    })
}

/// Expand one folder: list immediate children under `relative_path`.
pub fn list_project_children(
    root_path: &str,
    relative_path: &str,
) -> Result<Vec<TreeEntry>, String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {root_path}"));
    }

    let dir = if relative_path.is_empty() || relative_path == "." {
        root.clone()
    } else {
        let joined = root.join(relative_path);
        let canon_root = root
            .canonicalize()
            .map_err(|e| format!("Failed to resolve project root: {e}"))?;
        let canon_dir = joined
            .canonicalize()
            .map_err(|e| format!("Failed to resolve path {relative_path}: {e}"))?;
        if !canon_dir.starts_with(&canon_root) {
            return Err("Path escapes project root".into());
        }
        if !canon_dir.is_dir() {
            return Err(format!("Not a directory: {relative_path}"));
        }
        joined
    };

    list_dir_children(&dir, &root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn scans_current_crate_shallowly() {
        let root = env!("CARGO_MANIFEST_DIR");
        let scan = scan_project(root).expect("scan");
        assert_eq!(scan.root, root);
        assert!(scan.modules.is_empty());
        let children = scan.tree.children.as_ref().expect("root children");
        assert!(!children.is_empty());
        // Nested trees are not preloaded — directories are stubs.
        for child in children {
            if child.kind == "directory" {
                assert!(child.children.is_none());
            }
        }
    }

    #[test]
    fn tree_lists_directories_before_files() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("devtree-tree-sort-{nanos}"));
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::create_dir_all(dir.join("docs")).unwrap();
        fs::write(dir.join("README.md"), "hi").unwrap();
        fs::write(dir.join("LICENSE"), "mit").unwrap();

        let scan = scan_project(dir.to_str().unwrap()).expect("scan");
        let names: Vec<&str> = scan
            .tree
            .children
            .as_ref()
            .unwrap()
            .iter()
            .map(|c| c.name.as_str())
            .collect();
        assert_eq!(names, vec!["docs", "src", "LICENSE", "README.md"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_children_loads_one_level() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("devtree-tree-lazy-{nanos}"));
        fs::create_dir_all(dir.join("src").join("nested")).unwrap();
        fs::write(dir.join("src").join("main.rs"), "fn main() {}").unwrap();
        fs::write(dir.join("src").join("nested").join("deep.rs"), "").unwrap();

        let root = dir.to_str().unwrap();
        let kids = list_project_children(root, "src").expect("list");
        let names: Vec<&str> = kids.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["nested", "main.rs"]);
        let nested = kids.iter().find(|c| c.name == "nested").unwrap();
        assert!(nested.has_children);
        assert!(nested.children.is_none());

        let nested_kids = list_project_children(root, "src/nested").expect("nested");
        assert_eq!(nested_kids.len(), 1);
        assert_eq!(nested_kids[0].name, "deep.rs");

        let _ = fs::remove_dir_all(&dir);
    }
}
