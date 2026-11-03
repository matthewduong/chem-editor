//! Two-phase quit: no window may commit a discard until every participant agrees.
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Default)]
pub(crate) struct QuitState(pub Mutex<Option<Attempt>>);
pub(crate) struct Attempt {
    pub token: String,
    pending: HashSet<String>,
    participants: HashSet<String>,
    /// Windows that have answered at all. Only silence aborts the quit on a timer: a window that
    /// has received the request may legitimately wait on a person in its save dialog.
    received: HashSet<String>,
}
impl Attempt {
    fn new(labels: HashSet<String>) -> Self {
        Self {
            token: uuid::Uuid::new_v4().to_string(),
            pending: labels.clone(),
            participants: labels,
            received: HashSet::new(),
        }
    }
    fn unresponsive(&self) -> bool {
        !self.participants.is_subset(&self.received)
    }
    fn acknowledge(&mut self, label: &str) -> bool {
        self.pending.remove(label);
        self.pending.is_empty()
    }
}
pub(crate) fn abort(app: &tauri::AppHandle, token: &str) {
    let state = app.state::<QuitState>();
    let Ok(mut current) = state.0.lock() else {
        return;
    };
    if current.as_ref().is_some_and(|a| a.token == token) {
        *current = None;
        let _ = app.emit("document-quit-cancelled", token);
    }
}
/// A participant that disappears before voting can never vote, so the attempt is abandoned.
pub(crate) fn window_destroyed(app: &tauri::AppHandle, label: &str) {
    let token = app.state::<QuitState>().0.lock().ok().and_then(|current| {
        current
            .as_ref()
            .filter(|a| a.pending.contains(label))
            .map(|a| a.token.clone())
    });
    if let Some(token) = token {
        abort(app, &token);
    }
}
pub(crate) fn request(app: &tauri::AppHandle) {
    let state = app.state::<QuitState>();
    let Ok(mut current) = state.0.lock() else {
        return;
    };
    if let Some(attempt) = current.as_ref() {
        // A repeated request re-sends the pending attempt, so a window that reloaded mid-vote
        // (and lost its token) can still answer. Windows that hold the token ignore it.
        let token = attempt.token.clone();
        drop(current);
        let _ = app.emit("document-quit-requested", &token);
        return;
    }
    let windows = app.webview_windows();
    if windows.is_empty() {
        app.exit(0);
        return;
    }
    let attempt = Attempt::new(windows.keys().cloned().collect());
    let token = attempt.token.clone();
    *current = Some(attempt);
    drop(current);
    for window in windows.values() {
        if window.emit("document-quit-requested", &token).is_err() {
            abort(app, &token);
            return;
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(RECEIPT_TIMEOUT);
        let state = app.state::<QuitState>();
        let silent = state.0.lock().is_ok_and(|current| {
            current
                .as_ref()
                .is_some_and(|a| a.token == token && a.unresponsive())
        });
        if silent {
            abort(&app, &token);
        }
    });
}

/// How long a window may take to confirm it received a quit request before the quit is abandoned.
const RECEIPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// A window confirms it received the quit request and is deciding (perhaps asking the user).
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn receive_document_quit(
    app: tauri::AppHandle,
    window: tauri::Window,
    token: String,
) -> Result<(), String> {
    let state = app.state::<QuitState>();
    let mut current = state.0.lock().map_err(|e| e.to_string())?;
    let attempt = current
        .as_mut()
        .filter(|a| a.token == token)
        .ok_or("Quit attempt expired")?;
    if attempt.participants.contains(window.label()) {
        attempt.received.insert(window.label().into());
    }
    Ok(())
}
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn acknowledge_document_quit(
    app: tauri::AppHandle,
    window: tauri::Window,
    token: String,
    ready: bool,
) -> Result<(), String> {
    if !ready {
        abort(&app, &token);
        return Ok(());
    }
    let state = app.state::<QuitState>();
    let mut current = state.0.lock().map_err(|e| e.to_string())?;
    let Some(attempt) = current.as_mut().filter(|a| a.token == token) else {
        return Err("Quit attempt expired".into());
    };
    if !attempt.participants.contains(window.label()) {
        return Err("Unknown quit participant".into());
    }
    attempt.received.insert(window.label().into());
    if attempt.acknowledge(window.label()) {
        // A newly opened or closed window invalidates the entire vote.
        if attempt.participants != app.webview_windows().keys().cloned().collect() {
            drop(current);
            abort(&app, &token);
            return Err("Document windows changed".into());
        }
        if let Err(error) = super::document_files::clear_quit_recovery(&app, &attempt.participants)
        {
            drop(current);
            abort(&app, &token);
            return Err(error);
        }
        app.exit(0);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_windows_must_vote_and_duplicates_do_not_count() {
        let mut a = Attempt::new(["main".into(), "document-2".into()].into());
        assert!(!a.acknowledge("main"));
        assert!(!a.acknowledge("main"));
        assert!(a.acknowledge("document-2"));
    }
    #[test]
    fn only_a_silent_window_counts_as_unresponsive() {
        let mut a = Attempt::new(["main".into(), "document-2".into()].into());
        assert!(a.unresponsive());
        a.received.insert("main".into());
        assert!(a.unresponsive());
        a.received.insert("document-2".into());
        assert!(!a.unresponsive());
    }
    #[test]
    fn works_without_main_and_attempts_are_unique() {
        let mut a = Attempt::new(["document-2".into()].into());
        let b = Attempt::new(["document-2".into()].into());
        assert_ne!(a.token, b.token);
        assert!(a.acknowledge("document-2"));
    }
}
