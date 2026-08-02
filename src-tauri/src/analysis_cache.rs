use std::fs;
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Serializes tests that mutate `DEVTREE_CACHE_DIR` (env is process-global).
pub(crate) static CACHE_ENV_LOCK: Mutex<()> = Mutex::new(());

/// `~/.devtree/cache/<projectHash>/` (or `$DEVTREE_CACHE_DIR/<hash>/` in tests).
pub fn cache_dir_for_project(project_root: &str) -> Result<PathBuf, String> {
    let base = if let Ok(override_dir) = std::env::var("DEVTREE_CACHE_DIR") {
        PathBuf::from(override_dir)
    } else {
        let home = dirs::home_dir().ok_or("Could not resolve home directory")?;
        home.join(".devtree").join("cache")
    };
    let mut hasher = DefaultHasher::new();
    project_root.hash(&mut hasher);
    let hash = format!("{:016x}", hasher.finish());
    let dir = base.join(hash);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create cache dir: {e}"))?;
    // Human-readable pointer for debugging.
    let _ = fs::write(dir.join("project-root.txt"), project_root);
    Ok(dir)
}

pub fn write_json_file<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, json).map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

pub fn read_json_file<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Failed to parse {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    struct SampleBlob {
        name: String,
        count: u32,
    }

    fn temp_cache_root() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("devtree-analysis-cache-{nanos}"))
    }

    #[test]
    fn cache_dir_uses_devtree_cache_dir_override() {
        let _guard = CACHE_ENV_LOCK.lock().unwrap();
        let root = temp_cache_root();
        std::fs::create_dir_all(&root).unwrap();
        // SAFETY: exclusive via CACHE_ENV_LOCK; restored before unlock.
        unsafe {
            std::env::set_var("DEVTREE_CACHE_DIR", &root);
        }

        let project = "/tmp/some-project";
        let dir = cache_dir_for_project(project).expect("cache dir");
        assert!(dir.starts_with(&root));
        assert!(dir.join("project-root.txt").is_file());
        let written = std::fs::read_to_string(dir.join("project-root.txt")).unwrap();
        assert_eq!(written, project);

        // Same project root maps to the same hash directory.
        let again = cache_dir_for_project(project).expect("cache dir again");
        assert_eq!(dir, again);

        let _ = std::fs::remove_dir_all(&root);
        unsafe {
            std::env::remove_var("DEVTREE_CACHE_DIR");
        }
    }

    #[test]
    fn write_and_read_json_round_trip() {
        let root = temp_cache_root();
        let path = root.join("nested").join("blob.json");
        let blob = SampleBlob {
            name: "lite".into(),
            count: 3,
        };
        write_json_file(&path, &blob).expect("write");
        let loaded: SampleBlob = read_json_file(&path).expect("read");
        assert_eq!(loaded, blob);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn read_json_file_errors_on_missing_path() {
        let path = temp_cache_root().join("missing.json");
        let err = read_json_file::<SampleBlob>(&path).unwrap_err();
        assert!(err.contains("Failed to read"), "{err}");
    }
}
