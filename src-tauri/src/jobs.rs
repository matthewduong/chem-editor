//! App-wide FIFO admission and window-owned cancellation. Blocking work never runs on IPC threads.
use std::collections::{HashMap, VecDeque};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex,
};
use tauri::{Emitter, Manager};

#[derive(Clone, Copy, serde::Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Status {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}
impl Status {
    fn terminal(self) -> bool {
        !matches!(self, Self::Queued | Self::Running)
    }
}
struct Entry {
    owner: String,
    expensive: bool,
    status: Status,
    cancel: Arc<AtomicBool>,
}
#[derive(Default)]
struct State {
    entries: HashMap<String, Entry>,
    queue: VecDeque<String>,
    expensive: usize,
    routine: usize,
}
#[derive(Default)]
pub(crate) struct Jobs {
    state: Mutex<State>,
    changed: Condvar,
}
/// Where the running job on this thread reports progress: its app, owning window and ID.
type ProgressTarget = (tauri::AppHandle, String, String);
thread_local! {
    static CANCEL: std::cell::RefCell<Option<Arc<AtomicBool>>> = const { std::cell::RefCell::new(None) };
    static PROGRESS: std::cell::RefCell<Option<ProgressTarget>> = const { std::cell::RefCell::new(None) };
}
/// A sink that forwards a sidecar's `{"stage", "label"}` reports as this job's progress events.
pub(crate) fn progress_sink() -> Option<crate::process_support::ProgressSink> {
    let (app, owner, id) = PROGRESS.with(|v| v.borrow().clone())?;
    Some(Box::new(move |line: &str| {
        let Ok(report) = serde_json::from_str::<serde_json::Value>(line) else {
            return;
        };
        let text = |key: &str| report.get(key).and_then(|v| v.as_str()).map(str::to_owned);
        let _ = app.emit_to(
            owner.as_str(),
            "scientific-job-progress",
            Progress {
                job_id: id.clone(),
                status: Status::Running,
                stage: text("stage"),
                label: text("label"),
            },
        );
    }))
}
pub(crate) fn cancelled() -> bool {
    CANCEL.with(|v| {
        v.borrow()
            .as_ref()
            .is_some_and(|v| v.load(Ordering::Acquire))
    })
}
pub(crate) fn check_cancelled() -> Result<(), String> {
    if cancelled() {
        Err("Job cancelled".into())
    } else {
        Ok(())
    }
}
impl Jobs {
    fn register(&self, id: &str, owner: &str, expensive: bool) -> Result<(), String> {
        let mut s = self.state.lock().map_err(|e| e.to_string())?;
        if s.entries.contains_key(id) {
            return Err("Job ID already used or cancelled".into());
        }
        // Retain terminal acknowledgements, with a bounded history.
        if s.entries.len() >= 512 {
            s.entries.retain(|_, e| !e.status.terminal());
        }
        s.entries.insert(
            id.into(),
            Entry {
                owner: owner.into(),
                expensive,
                status: Status::Queued,
                cancel: Arc::new(AtomicBool::new(false)),
            },
        );
        s.queue.push_back(id.into());
        Ok(())
    }
    fn acquire(&self, id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut s = self.state.lock().map_err(|e| e.to_string())?;
        loop {
            let entry = s.entries.get(id).ok_or("Unknown job")?;
            if entry.cancel.load(Ordering::Acquire) {
                return Err("Job cancelled".into());
            }
            let expensive = entry.expensive;
            let first = s
                .queue
                .iter()
                .find(|key| s.entries[*key].expensive == expensive);
            if first.is_some_and(|key| key == id)
                && if expensive {
                    s.expensive == 0
                } else {
                    s.routine < 2
                }
            {
                s.queue.retain(|key| key != id);
                if expensive {
                    s.expensive += 1;
                } else {
                    s.routine += 1;
                }
                let entry = s.entries.get_mut(id).ok_or("Unknown job")?;
                entry.status = Status::Running;
                let token = entry.cancel.clone();
                self.changed.notify_all();
                return Ok(token);
            }
            s = self.changed.wait(s).map_err(|e| e.to_string())?;
        }
    }
    fn finish(&self, id: &str, success: bool) -> Status {
        let Ok(mut s) = self.state.lock() else {
            return Status::Failed;
        };
        let Some(entry) = s.entries.get_mut(id) else {
            return Status::Failed;
        };
        let running = entry.status == Status::Running;
        let expensive = entry.expensive;
        let status = if entry.cancel.load(Ordering::Acquire) {
            Status::Cancelled
        } else if success {
            Status::Completed
        } else {
            Status::Failed
        };
        entry.status = status;
        if running {
            if expensive {
                s.expensive -= 1;
            } else {
                s.routine -= 1;
            }
        }
        s.queue.retain(|key| key != id);
        self.changed.notify_all();
        status
    }
    pub(crate) fn cancel(&self, id: &str, owner: &str) -> Result<(), String> {
        let mut s = self.state.lock().map_err(|e| e.to_string())?;
        let Some(entry) = s.entries.get_mut(id) else {
            // Cancellation may arrive before its request reaches IPC registration.
            s.entries.insert(
                id.into(),
                Entry {
                    owner: owner.into(),
                    expensive: false,
                    status: Status::Cancelled,
                    cancel: Arc::new(AtomicBool::new(true)),
                },
            );
            return Ok(());
        };
        if entry.owner != owner {
            return Err("Job belongs to another window".into());
        }
        if !entry.status.terminal() {
            entry.cancel.store(true, Ordering::Release);
            if entry.status == Status::Queued {
                entry.status = Status::Cancelled;
                s.queue.retain(|key| key != id);
            }
        }
        self.changed.notify_all();
        Ok(())
    }
    pub(crate) fn cancel_window(&self, owner: &str) {
        let ids: Vec<_> = self
            .state
            .lock()
            .map(|s| {
                s.entries
                    .iter()
                    .filter(|(_, e)| e.owner == owner)
                    .map(|(id, _)| id.clone())
                    .collect()
            })
            .unwrap_or_default();
        for id in ids {
            let _ = self.cancel(&id, owner);
        }
    }
    fn wait_terminal(&self, id: &str) -> Result<Status, String> {
        let mut s = self.state.lock().map_err(|e| e.to_string())?;
        loop {
            let status = s.entries.get(id).ok_or("Unknown job")?.status;
            if status.terminal() {
                return Ok(status);
            }
            s = self.changed.wait(s).map_err(|e| e.to_string())?;
        }
    }
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    job_id: String,
    status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<String>,
}
fn emit(app: &tauri::AppHandle, owner: &str, id: &str, status: Status) {
    let _ = app.emit_to(
        owner,
        "scientific-job-progress",
        Progress {
            job_id: id.into(),
            status,
            stage: None,
            label: None,
        },
    );
}
/// Releases the job's slot exactly once: through [`Completion::complete`], or as a failure when
/// dropped without it (including during unwinding).
struct Completion {
    jobs: Arc<Jobs>,
    id: String,
    done: bool,
}
impl Completion {
    fn complete(mut self, success: bool) -> Status {
        self.done = true;
        self.jobs.finish(&self.id, success)
    }
}
impl Drop for Completion {
    fn drop(&mut self) {
        if !self.done {
            self.jobs.finish(&self.id, false);
        }
        CANCEL.with(|v| *v.borrow_mut() = None);
        PROGRESS.with(|v| *v.borrow_mut() = None);
    }
}
pub(crate) async fn run<T: Send + 'static>(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: Option<String>,
    expensive: bool,
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let owner = window.label().to_string();
    let jobs = app.state::<Arc<Jobs>>().inner().clone();
    jobs.register(&id, &owner, expensive)?;
    emit(&app, &owner, &id, Status::Queued);
    tauri::async_runtime::spawn_blocking(move || {
        let token = jobs.acquire(&id)?;
        let completion = Completion {
            jobs: jobs.clone(),
            id: id.clone(),
            done: false,
        };
        CANCEL.with(|v| *v.borrow_mut() = Some(token));
        PROGRESS.with(|v| *v.borrow_mut() = Some((app.clone(), owner.clone(), id.clone())));
        emit(&app, &owner, &id, Status::Running);
        let result = check_cancelled().and_then(|()| task());
        let was_cancelled = cancelled();
        let status = completion.complete(result.is_ok());
        emit(&app, &owner, &id, status);
        if was_cancelled {
            Err("Job cancelled".into())
        } else {
            result
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn cancel_scientific_job(
    app: tauri::AppHandle,
    window: tauri::Window,
    job_id: String,
) -> Result<Status, String> {
    let jobs = app.state::<Arc<Jobs>>().inner().clone();
    jobs.cancel(&job_id, window.label())?;
    tauri::async_runtime::spawn_blocking(move || jobs.wait_terminal(&job_id))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_is_owned_and_queued_jobs_are_removed() {
        let jobs = Jobs::default();
        jobs.register("a", "one", true).unwrap();
        jobs.register("b", "two", true).unwrap();
        jobs.acquire("a").unwrap();
        assert!(jobs.cancel("a", "two").is_err());
        jobs.cancel("b", "two").unwrap();
        assert_eq!(jobs.wait_terminal("b").unwrap(), Status::Cancelled);
        assert!(jobs.acquire("b").is_err());
        jobs.cancel("a", "one").unwrap();
        jobs.finish("a", true);
        assert_eq!(jobs.wait_terminal("a").unwrap(), Status::Cancelled);
        assert_eq!(jobs.state.lock().unwrap().expensive, 0);
    }
    #[test]
    fn a_job_finishes_exactly_once_with_its_real_outcome() {
        let jobs = Arc::new(Jobs::default());
        for (id, success) in [("ok", Some(true)), ("err", Some(false)), ("dropped", None)] {
            jobs.register(id, "one", true).unwrap();
            jobs.acquire(id).unwrap();
            let completion = Completion {
                jobs: jobs.clone(),
                id: id.into(),
                done: false,
            };
            match success {
                Some(success) => {
                    completion.complete(success);
                }
                None => drop(completion),
            }
            assert_eq!(jobs.state.lock().unwrap().expensive, 0);
        }
        assert_eq!(jobs.wait_terminal("ok").unwrap(), Status::Completed);
        assert_eq!(jobs.wait_terminal("err").unwrap(), Status::Failed);
        assert_eq!(jobs.wait_terminal("dropped").unwrap(), Status::Failed);
    }
    #[test]
    fn a_cancel_that_arrives_before_registration_prevents_the_job() {
        let jobs = Jobs::default();
        jobs.cancel("early", "one").unwrap();
        assert!(jobs.register("early", "one", true).is_err());
    }
    #[test]
    fn routine_pool_is_independent_and_window_close_cancels() {
        let jobs = Jobs::default();
        for (id, expensive) in [("e", true), ("a", false), ("b", false)] {
            jobs.register(id, "one", expensive).unwrap();
            jobs.acquire(id).unwrap();
        }
        let s = jobs.state.lock().unwrap();
        assert_eq!((s.expensive, s.routine), (1, 2));
        drop(s);
        jobs.cancel_window("one");
        for id in ["e", "a", "b"] {
            jobs.finish(id, false);
            assert_eq!(jobs.wait_terminal(id).unwrap(), Status::Cancelled);
        }
    }
}
