//! Analysis triggers: file-watch and cron schedule.
//! Emits `analysis-trigger` events to the frontend so runs reuse AnalysisManager.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::Local;
use cron::Schedule;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use tauri::{AppHandle, Emitter, State};

const SKIP_DIR_NAMES: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".git",
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
    "wasm",
];

const SOURCE_EXTS: &[&str] = &["ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "go"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisTriggerEvent {
    pub source: String,
    pub project_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisTriggerStatus {
    pub watch_active: bool,
    pub watch_path: Option<String>,
    pub watch_debounce_ms: u32,
    pub schedule_active: bool,
    pub cron: Option<String>,
    pub next_run_at: Option<String>,
}

struct WatchRuntime {
    stop: Arc<AtomicBool>,
    path: String,
    debounce_ms: u32,
    _watcher: RecommendedWatcher,
}

struct CronRuntime {
    stop: Arc<AtomicBool>,
    cron: String,
    next_run_at: Arc<Mutex<Option<String>>>,
}

pub struct AnalysisTriggerState {
    inner: Mutex<TriggerInner>,
}

struct TriggerInner {
    watch: Option<WatchRuntime>,
    cron: Option<CronRuntime>,
}

impl AnalysisTriggerState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(TriggerInner {
                watch: None,
                cron: None,
            }),
        }
    }
}

fn should_skip_path(path: &Path) -> bool {
    for comp in path.components() {
        if let std::path::Component::Normal(name) = comp {
            let s = name.to_string_lossy();
            if SKIP_DIR_NAMES.contains(&s.as_ref()) || s.starts_with('.') {
                return true;
            }
        }
    }
    false
}

fn is_source_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| SOURCE_EXTS.contains(&ext))
        .unwrap_or(false)
}

fn stop_watch_locked(inner: &mut TriggerInner) {
    if let Some(watch) = inner.watch.take() {
        watch.stop.store(true, Ordering::SeqCst);
    }
}

fn stop_cron_locked(inner: &mut TriggerInner) {
    if let Some(cron) = inner.cron.take() {
        cron.stop.store(true, Ordering::SeqCst);
    }
}

/// Accept standard 5-field cron (`min hour dom month dow`) by prepending seconds.
/// The `cron` crate requires 6 fields (`sec min hour dom month dow`).
fn normalize_cron_expression(expr: &str) -> String {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() == 5 {
        format!("0 {}", fields.join(" "))
    } else {
        expr.trim().to_string()
    }
}

#[tauri::command]
pub fn get_analysis_triggers(
    state: State<'_, AnalysisTriggerState>,
) -> AnalysisTriggerStatus {
    status_from_state(&state)
}

#[tauri::command]
pub fn stop_analysis_watch(state: State<'_, AnalysisTriggerState>) -> bool {
    let mut guard = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let was = guard.watch.is_some();
    stop_watch_locked(&mut guard);
    was
}

#[tauri::command]
pub fn stop_analysis_schedule(state: State<'_, AnalysisTriggerState>) -> bool {
    let mut guard = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let was = guard.cron.is_some();
    stop_cron_locked(&mut guard);
    was
}

#[tauri::command]
pub fn start_analysis_watch(
    app: AppHandle,
    state: State<'_, AnalysisTriggerState>,
    path: String,
    debounce_ms: u32,
) -> Result<AnalysisTriggerStatus, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let debounce = Duration::from_millis(debounce_ms.max(250) as u64);
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = Arc::clone(&stop);
    let project_path = path.clone();
    let (tx, rx) = std::sync::mpsc::channel();

    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch {path}: {e}"))?;

    {
        let mut guard = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        stop_watch_locked(&mut guard);
        guard.watch = Some(WatchRuntime {
            stop: Arc::clone(&stop),
            path: path.clone(),
            debounce_ms: debounce_ms.max(250),
            _watcher: watcher,
        });
    }

    std::thread::Builder::new()
        .name("devtree-analysis-watch".into())
        .spawn(move || {
            let mut last_emit = Instant::now()
                .checked_sub(Duration::from_secs(60))
                .unwrap_or_else(Instant::now);
            let mut pending: HashSet<String> = HashSet::new();

            while !stop_thread.load(Ordering::SeqCst) {
                match rx.recv_timeout(Duration::from_millis(200)) {
                    Ok(Ok(event)) => {
                        if matches!(
                            event.kind,
                            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                        ) {
                            for p in event.paths {
                                if should_skip_path(&p) {
                                    continue;
                                }
                                if p.is_dir() || is_source_file(&p) {
                                    pending.insert(p.to_string_lossy().into());
                                }
                            }
                        }
                    }
                    Ok(Err(err)) => {
                        eprintln!("[devtree watch] {err}");
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }

                if pending.is_empty() {
                    continue;
                }
                if last_emit.elapsed() < debounce {
                    continue;
                }

                let sample = pending.iter().next().cloned();
                pending.clear();
                last_emit = Instant::now();
                let payload = AnalysisTriggerEvent {
                    source: "watch".into(),
                    project_path: project_path.clone(),
                    path: sample,
                    message: "Project files changed".into(),
                };
                let _ = app.emit("analysis-trigger", payload);
            }
        })
        .map_err(|e| format!("Failed to spawn watch thread: {e}"))?;

    Ok(status_from_state(&state))
}

fn status_from_state(state: &State<'_, AnalysisTriggerState>) -> AnalysisTriggerStatus {
    let guard = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    AnalysisTriggerStatus {
        watch_active: guard.watch.is_some(),
        watch_path: guard.watch.as_ref().map(|w| w.path.clone()),
        watch_debounce_ms: guard.watch.as_ref().map(|w| w.debounce_ms).unwrap_or(0),
        schedule_active: guard.cron.is_some(),
        cron: guard.cron.as_ref().map(|c| c.cron.clone()),
        next_run_at: guard
            .cron
            .as_ref()
            .and_then(|c| c.next_run_at.lock().ok().and_then(|g| g.clone())),
    }
}

#[tauri::command]
pub fn start_analysis_schedule(
    app: AppHandle,
    state: State<'_, AnalysisTriggerState>,
    path: String,
    cron: String,
) -> Result<AnalysisTriggerStatus, String> {
    let normalized = normalize_cron_expression(&cron);
    let schedule = Schedule::from_str(&normalized)
        .map_err(|e| format!("Invalid cron expression `{cron}`: {e}"))?;

    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = Arc::clone(&stop);
    let next_run_at = Arc::new(Mutex::new(None));
    let next_slot = Arc::clone(&next_run_at);
    let project_path = path.clone();
    let cron_owned = cron.clone();

    {
        let mut guard = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        stop_cron_locked(&mut guard);
        guard.cron = Some(CronRuntime {
            stop: Arc::clone(&stop),
            cron: cron.clone(),
            next_run_at: Arc::clone(&next_run_at),
        });
    }

    std::thread::Builder::new()
        .name("devtree-analysis-cron".into())
        .spawn(move || {
            while !stop_thread.load(Ordering::SeqCst) {
                let now = Local::now();
                let Some(next) = schedule.upcoming(Local).next() else {
                    break;
                };
                if let Ok(mut slot) = next_slot.lock() {
                    *slot = Some(next.to_rfc3339());
                }

                let wait = (next - now).to_std().unwrap_or(Duration::from_secs(1));
                let slice = Duration::from_millis(250);
                let mut remaining = wait;
                while remaining > Duration::ZERO && !stop_thread.load(Ordering::SeqCst) {
                    let step = remaining.min(slice);
                    std::thread::sleep(step);
                    remaining = remaining.saturating_sub(step);
                }
                if stop_thread.load(Ordering::SeqCst) {
                    break;
                }

                let payload = AnalysisTriggerEvent {
                    source: "cron".into(),
                    project_path: project_path.clone(),
                    path: None,
                    message: format!("Scheduled run ({cron_owned})"),
                };
                let _ = app.emit("analysis-trigger", payload);
            }
        })
        .map_err(|e| format!("Failed to spawn schedule thread: {e}"))?;

    Ok(status_from_state(&state))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_vendor_paths() {
        assert!(should_skip_path(Path::new("/proj/node_modules/x.ts")));
        assert!(should_skip_path(Path::new("/proj/target/debug/foo.rs")));
        assert!(!should_skip_path(Path::new("/proj/src/main.rs")));
    }

    #[test]
    fn detects_source_exts() {
        assert!(is_source_file(Path::new("a.ts")));
        assert!(is_source_file(Path::new("a.rs")));
        assert!(!is_source_file(Path::new("a.md")));
    }

    #[test]
    fn parses_hourly_cron() {
        let normalized = normalize_cron_expression("0 * * * *");
        assert_eq!(normalized, "0 0 * * * *");
        assert!(Schedule::from_str(&normalized).is_ok());
        assert!(Schedule::from_str("0 0 * * * *").is_ok());
    }

    #[test]
    fn leaves_six_field_cron_unchanged() {
        assert_eq!(
            normalize_cron_expression("0 */30 * * * *"),
            "0 */30 * * * *"
        );
    }
}
