use std::io::{BufRead, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Output};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

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
            .args(["-TERM", "--", &format!("-{pid}")])
            .status();
        thread::sleep(Duration::from_millis(200));
        let _ = Command::new("kill")
            .args(["-KILL", "--", &format!("-{pid}")])
            .status();
    }

    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}

pub(crate) fn configure_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0000_0200);
    }
}

/// How long a one-shot sidecar call may run before it is killed. Long scientific jobs (DFT, NMR,
/// orbitals) are cancellable by the user and pass `None` instead.
pub(crate) const ONE_SHOT_TIMEOUT: Duration = Duration::from_mins(2);

/// Feed `stdin_content` to `child`, collect its output, and kill it if it outlives `timeout`.
///
/// Stdin is written and the pipes are drained on helper threads, so neither a child that stops
/// reading nor one that never exits can block the caller. After a kill the pipe readers are
/// abandoned rather than joined: a `PyInstaller` bootloader can leave a grandchild holding them.
pub(crate) fn wait_with_timeout(
    child: Child,
    stdin_content: Option<Vec<u8>>,
    timeout: Option<Duration>,
) -> Result<Output, String> {
    wait_with_progress(child, stdin_content, timeout, None)
}

/// Stderr lines starting with this marker are progress reports, not diagnostics.
pub(crate) const PROGRESS_MARKER: &[u8] = b"@progress ";
pub(crate) type ProgressSink = Box<dyn FnMut(&str) + Send>;

/// [`wait_with_timeout`], forwarding each marked stderr line to `progress` as it arrives.
pub(crate) fn wait_with_progress(
    mut child: Child,
    stdin_content: Option<Vec<u8>>,
    timeout: Option<Duration>,
    mut progress: Option<ProgressSink>,
) -> Result<Output, String> {
    if let Some(input) = stdin_content {
        let mut stdin = child.stdin.take().ok_or("Failed to open sidecar stdin")?;
        thread::spawn(move || {
            let _ = stdin.write_all(&input);
        });
    }
    let mut stdout = child.stdout.take().ok_or("Failed to open sidecar stdout")?;
    let mut stderr = child.stderr.take().ok_or("Failed to open sidecar stderr")?;
    let (out_tx, out_rx) = mpsc::channel();
    let (err_tx, err_rx) = mpsc::channel();
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout.read_to_end(&mut buffer);
        let _ = out_tx.send(buffer);
    });
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let mut reader = std::io::BufReader::new(&mut stderr);
        let mut line = Vec::new();
        while matches!(reader.read_until(b'\n', &mut line), Ok(n) if n > 0) {
            match (line.strip_prefix(PROGRESS_MARKER), progress.as_mut()) {
                (Some(report), Some(sink)) => sink(String::from_utf8_lossy(report).trim_end()),
                (Some(_), None) => {}
                _ => buffer.extend_from_slice(&line),
            }
            line.clear();
        }
        let _ = err_tx.send(buffer);
    });

    let deadline = timeout.map(|limit| Instant::now() + limit);
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("Sidecar wait error: {e}"))?
        {
            break status;
        }
        if crate::jobs::cancelled() || deadline.is_some_and(|d| Instant::now() >= d) {
            kill_pid(child.id());
            let _ = child.kill();
            let _ = child.wait();
            if crate::jobs::cancelled() {
                return Err("Job cancelled".into());
            }
            return Err(format!(
                "Sidecar call timed out after {} s and was stopped",
                timeout.map_or(0, |t| t.as_secs())
            ));
        }
        thread::sleep(Duration::from_millis(20));
    };
    let grace = Duration::from_secs(5);
    Ok(Output {
        status,
        stdout: out_rx.recv_timeout(grace).unwrap_or_default(),
        stderr: err_rx.recv_timeout(grace).unwrap_or_default(),
    })
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
    use super::*;

    #[cfg(unix)]
    fn shell(script: &str) -> Child {
        use std::process::Stdio;
        let mut command = Command::new("sh");
        configure_process_group(&mut command);
        command
            .args(["-c", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn wait_with_timeout_returns_output_and_feeds_stdin() {
        let output = wait_with_timeout(
            shell("cat; echo err >&2"),
            Some(b"hello".to_vec()),
            Some(Duration::from_secs(10)),
        )
        .unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"hello");
        assert_eq!(output.stderr, b"err\n");
    }

    #[cfg(unix)]
    #[test]
    fn marked_stderr_lines_are_forwarded_as_progress_not_diagnostics() {
        let seen = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = seen.clone();
        let output = wait_with_progress(
            shell(r#"echo '@progress {"stage":"a"}' >&2; echo diag >&2; echo '{}'"#),
            None,
            Some(Duration::from_secs(10)),
            Some(Box::new(move |line| {
                sink.lock().unwrap().push(line.to_owned());
            })),
        )
        .unwrap();
        assert_eq!(output.stderr, b"diag\n");
        assert_eq!(*seen.lock().unwrap(), [r#"{"stage":"a"}"#]);
    }

    #[cfg(unix)]
    #[test]
    fn a_timeout_kills_the_whole_process_tree() {
        let dir = tempfile::tempdir().unwrap();
        let pid_file = dir.path().join("grandchild");
        let script = format!("sleep 30 & echo $! > '{}'; wait", pid_file.display());
        let error =
            wait_with_timeout(shell(&script), None, Some(Duration::from_millis(300))).unwrap_err();
        assert!(error.contains("timed out"), "{error}");
        let pid = fs_pid(&pid_file);
        let alive = || {
            Command::new("kill")
                .args(["-0", &pid.to_string()])
                .status()
                .is_ok_and(|s| s.success())
        };
        let deadline = Instant::now() + Duration::from_secs(5);
        while alive() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(!alive(), "grandchild {pid} survived its parent's kill");
    }

    #[cfg(unix)]
    fn fs_pid(path: &std::path::Path) -> u32 {
        std::fs::read_to_string(path)
            .unwrap()
            .trim()
            .parse()
            .unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn wait_with_timeout_kills_a_hung_child() {
        let started = Instant::now();
        let error = wait_with_timeout(shell("sleep 30"), None, Some(Duration::from_millis(200)))
            .unwrap_err();
        assert!(error.contains("timed out"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[cfg(unix)]
    #[test]
    fn wait_with_timeout_survives_a_child_that_never_reads_stdin() {
        let big = vec![b'x'; 4 * 1024 * 1024];
        let error = wait_with_timeout(
            shell("sleep 30"),
            Some(big),
            Some(Duration::from_millis(200)),
        )
        .unwrap_err();
        assert!(error.contains("timed out"), "{error}");
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
