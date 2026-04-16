use std::path::PathBuf;
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

enum TrackedProcess {
    Pid(u32),
}

impl TrackedProcess {
    fn pid(&self) -> u32 {
        match self {
            Self::Pid(pid) => *pid,
        }
    }

    fn kill(self) {
        match self {
            Self::Pid(pid) => kill_pid(pid),
        }
    }
}

pub(crate) struct SidecarTracker(Mutex<Vec<TrackedProcess>>);

impl SidecarTracker {
    pub(crate) fn new() -> Self {
        Self(Mutex::new(Vec::new()))
    }

    pub(crate) fn add_pid(&self, pid: u32) {
        if let Ok(mut guard) = self.0.lock() {
            guard.push(TrackedProcess::Pid(pid));
        }
    }

    pub(crate) fn remove(&self, pid: u32) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(index) = guard.iter().position(|process| process.pid() == pid) {
                guard.remove(index);
            }
        }
    }

    pub(crate) fn kill_all(&self) {
        if let Ok(mut guard) = self.0.lock() {
            for process in guard.drain(..) {
                process.kill();
            }
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.0.lock().map_or(0, |guard| guard.len())
    }
}

pub(crate) fn kill_pid(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }

    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}

pub(crate) struct DftJobState(Arc<AtomicBool>);

impl DftJobState {
    pub(crate) fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub(crate) fn try_acquire(&self) -> Result<DftJobGuard, String> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "A DFT NMR calculation is already running.".to_string())?;
        Ok(DftJobGuard(self.0.clone()))
    }
}

pub(crate) struct DftJobGuard(Arc<AtomicBool>);

impl Drop for DftJobGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn crash_log_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("USERPROFILE")
                    .map(PathBuf::from)
                    .map(|home| home.join("AppData").join("Local"))
            })?;
        return Some(base.join("chem-editor").join("crash.log"));
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").map(PathBuf::from)?;
        return Some(
            home.join("Library")
                .join("Caches")
                .join("chem-editor")
                .join("crash.log"),
        );
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let base = std::env::var_os("XDG_CACHE_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(PathBuf::from)
                    .map(|home| home.join(".cache"))
            })?;
        return Some(base.join("chem-editor").join("crash.log"));
    }

    #[allow(unreachable_code)]
    None
}

pub(crate) fn write_crash_log(info: &str) {
    let Some(log_path) = crash_log_path() else {
        return;
    };
    let Some(cache_dir) = log_path.parent() else {
        return;
    };
    if std::fs::create_dir_all(cache_dir).is_err() {
        return;
    }
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    else {
        return;
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs());
    let _ = std::io::Write::write_fmt(&mut file, format_args!("[{ts}] {info}\n"));
}

#[cfg(test)]
mod tests {
    use super::{DftJobState, SidecarTracker};

    #[test]
    fn dft_job_state_blocks_concurrent_acquire() {
        let state = DftJobState::new();
        let first_guard = state
            .try_acquire()
            .expect("first DFT guard should be acquired");
        assert!(state.try_acquire().is_err());
        drop(first_guard);
        assert!(state.try_acquire().is_ok());
    }

    #[test]
    fn sidecar_tracker_adds_and_removes_pids() {
        let tracker = SidecarTracker::new();
        tracker.add_pid(11);
        tracker.add_pid(42);
        assert_eq!(tracker.len(), 2);
        tracker.remove(11);
        assert_eq!(tracker.len(), 1);
        tracker.remove(999);
        assert_eq!(tracker.len(), 1);
    }
}
