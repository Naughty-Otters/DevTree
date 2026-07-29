use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub struct AnalysisSessionRegistry {
    sessions: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AnalysisSessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, id: String) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.sessions
            .lock()
            .expect("analysis session registry lock")
            .insert(id, flag.clone());
        flag
    }

    pub fn cancel(&self, id: &str) -> bool {
        let sessions = self.sessions.lock().expect("analysis session registry lock");
        if let Some(flag) = sessions.get(id) {
            flag.store(true, Ordering::SeqCst);
            true
        } else {
            false
        }
    }

    pub fn unregister(&self, id: &str) {
        self.sessions
            .lock()
            .expect("analysis session registry lock")
            .remove(id);
    }
}

impl Default for AnalysisSessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

pub fn is_cancelled(cancel: &AtomicBool) -> bool {
    cancel.load(Ordering::SeqCst)
}

pub fn check_cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if is_cancelled(cancel) {
        Err("Analysis cancelled".into())
    } else {
        Ok(())
    }
}
