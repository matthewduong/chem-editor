mod process_support;

use crate::process_support::{kill_pid, write_crash_log, DftJobState, SidecarTracker};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc, Mutex, OnceLock,
};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
static PANIC_CLEANUP: OnceLock<Arc<PersistentNmrEngine>> = OnceLock::new();
static SIDECAR_EXECUTABLE: OnceLock<Result<PathBuf, String>> = OnceLock::new();

#[cfg(windows)]
const SIDECAR_EXE_NAME: &str = "chem-engine.exe";
#[cfg(not(windows))]
const SIDECAR_EXE_NAME: &str = "chem-engine";

struct PersistentNmrProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    stderr_log: Arc<Mutex<String>>,
    stderr_thread: Option<thread::JoinHandle<()>>,
}

#[derive(Clone, Deserialize)]
struct NmrProgressLine {
    request_id: String,
    stage: String,
    label: String,
}

#[derive(Clone, Serialize)]
struct NmrProgressEvent {
    request_id: String,
    stage: String,
    label: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OrbitalAtomInput {
    element: String,
    x: f64,
    y: f64,
    z: f64,
    atom_map_num: Option<i32>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OrbitalBondInput {
    a1: usize,
    a2: usize,
    order: f64,
}

impl PersistentNmrProcess {
    fn spawn(app_handle: &tauri::AppHandle) -> Result<Self, String> {
        let executable = resolve_sidecar_executable(app_handle)?;
        let mut cmd = Command::new(executable);
        cmd.arg("--server");

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn persistent NMR engine: {e}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or("Failed to open NMR engine stdin")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to open NMR engine stdout")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("Failed to open NMR engine stderr")?;
        let stderr_log = Arc::new(Mutex::new(String::new()));
        let stderr_thread = Some(spawn_stderr_reader(stderr, Arc::clone(&stderr_log)));

        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            stderr_log,
            stderr_thread,
        })
    }

    fn send_request(
        &mut self,
        app_handle: &tauri::AppHandle,
        request: &Value,
    ) -> Result<Value, String> {
        let line = serde_json::to_string(request)
            .map_err(|e| format!("Failed to encode NMR request: {e}"))?;
        self.stdin
            .write_all(line.as_bytes())
            .and_then(|()| self.stdin.write_all(b"\n"))
            .and_then(|()| self.stdin.flush())
            .map_err(|e| format!("Failed to write to persistent NMR engine: {e}"))?;

        loop {
            let mut response_line = String::new();
            let bytes_read = self
                .stdout
                .read_line(&mut response_line)
                .map_err(|e| format!("Failed to read from persistent NMR engine: {e}"))?;
            if bytes_read == 0 {
                return Err(self.child_exit_error("Persistent NMR engine exited unexpectedly"));
            }

            let parsed: Value = serde_json::from_str(response_line.trim_end())
                .map_err(|e| format!("Persistent NMR engine returned invalid JSON: {e}"))?;
            match parsed.get("type").and_then(Value::as_str) {
                Some("progress") => {
                    let progress: NmrProgressLine =
                        serde_json::from_value(parsed).map_err(|e| {
                            format!("Persistent NMR engine returned invalid progress JSON: {e}")
                        })?;
                    let _ = app_handle.emit(
                        "nmr-progress",
                        NmrProgressEvent {
                            request_id: progress.request_id,
                            stage: progress.stage,
                            label: progress.label,
                        },
                    );
                }
                Some("result") => {
                    return Ok(parsed.get("payload").cloned().unwrap_or(Value::Null));
                }
                _ => {
                    return Ok(parsed);
                }
            }
        }
    }

    fn shutdown(&mut self) {
        let line = serde_json::to_string(&json!({ "command": "shutdown" })).unwrap_or_default();
        let _ = self
            .stdin
            .write_all(line.as_bytes())
            .and_then(|()| self.stdin.write_all(b"\n"))
            .and_then(|()| self.stdin.flush());
        let mut response_line = String::new();
        let _ = self.stdout.read_line(&mut response_line);
        let deadline = Instant::now() + Duration::from_millis(750);
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Ok(Some(_)) | Err(_) => break,
            }
        }
        if matches!(self.child.try_wait(), Ok(None)) {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
        if let Some(handle) = self.stderr_thread.take() {
            let _ = handle.join();
        }
    }

    fn terminate_immediately(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(handle) = self.stderr_thread.take() {
            let _ = handle.join();
        }
    }

    fn child_exit_error(&mut self, prefix: &str) -> String {
        let stderr = drain_stderr_log(&self.stderr_log);
        let status = self.child.try_wait().ok().flatten();
        match (status, stderr.is_empty()) {
            (Some(status), false) => format!("{prefix} (status {status}): {stderr}"),
            (Some(status), true) => format!("{prefix} (status {status})"),
            (None, false) => format!("{prefix}: {stderr}"),
            (None, true) => prefix.to_string(),
        }
    }
}

struct PersistentNmrEngine {
    process: Mutex<Option<PersistentNmrProcess>>,
    active_pid: AtomicU32,
}

impl PersistentNmrEngine {
    fn new() -> Self {
        Self {
            process: Mutex::new(None),
            active_pid: AtomicU32::new(0),
        }
    }

    fn invoke(&self, app_handle: &tauri::AppHandle, request: &Value) -> Result<Value, String> {
        let mut guard = self
            .process
            .lock()
            .map_err(|_| "Persistent NMR engine lock poisoned".to_string())?;

        for attempt in 0..2 {
            if guard.is_none() {
                let process = PersistentNmrProcess::spawn(app_handle)?;
                self.active_pid.store(process.child.id(), Ordering::Release);
                *guard = Some(process);
            }

            let result = guard
                .as_mut()
                .expect("persistent NMR process initialized")
                .send_request(app_handle, request);
            match result {
                Ok(value) => return Ok(value),
                Err(error) if attempt == 0 => {
                    self.active_pid.store(0, Ordering::Release);
                    if let Some(mut process) = guard.take() {
                        process.shutdown();
                    }
                    if error.contains("invalid JSON") {
                        return Err(error);
                    }
                }
                Err(error) => return Err(error),
            }
        }

        Err("Persistent NMR engine request failed".to_string())
    }

    fn warmup(&self, app_handle: &tauri::AppHandle) -> Result<(), String> {
        let request = json!({ "command": "warmup_nmr" });
        let _ = self.invoke(app_handle, &request)?;
        Ok(())
    }

    fn cancel_active_request(&self) {
        let pid = self.active_pid.swap(0, Ordering::AcqRel);
        if pid != 0 {
            kill_pid(pid);
        }
    }

    fn shutdown(&self) {
        self.cancel_active_request();
        if let Ok(mut guard) = self.process.lock() {
            if let Some(mut process) = guard.take() {
                process.shutdown();
            }
        }
    }

    fn fast_shutdown(&self) {
        self.cancel_active_request();
        if let Ok(mut guard) = self.process.lock() {
            if let Some(mut process) = guard.take() {
                process.terminate_immediately();
            }
        }
    }
}

fn spawn_stderr_reader(
    mut stderr: ChildStderr,
    stderr_log: Arc<Mutex<String>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match stderr.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    let text = String::from_utf8_lossy(&buffer[..count]);
                    if let Ok(mut log) = stderr_log.lock() {
                        log.push_str(&text);
                        if log.len() > 32_768 {
                            let trim = log.len() - 32_768;
                            log.drain(..trim);
                        }
                    }
                }
            }
        }
    })
}

fn drain_stderr_log(stderr_log: &Arc<Mutex<String>>) -> String {
    stderr_log
        .lock()
        .map(|log| log.trim().to_string())
        .unwrap_or_default()
}

fn resolve_sidecar_executable(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    SIDECAR_EXECUTABLE
        .get_or_init(|| resolve_sidecar_executable_uncached(app_handle))
        .clone()
}

fn resolve_sidecar_executable_uncached(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    let sidecar_dir_name = bundled_sidecar_dir_name()?;

    let exe_path = tauri::utils::platform::current_exe()
        .map_err(|e| format!("Failed to resolve current executable: {e}"))?;
    if let Some(exe_dir) = exe_path.parent() {
        let base_dir = if exe_dir.ends_with("deps") {
            exe_dir.parent().unwrap_or(exe_dir).to_path_buf()
        } else {
            exe_dir.to_path_buf()
        };
        candidates.push(base_dir.join("bin"));
        candidates.push(base_dir.clone());
        candidates.push(base_dir.join("../Resources"));
    }

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir);
    }

    for candidate in candidates {
        let exact_match = candidate.join(&sidecar_dir_name).join(SIDECAR_EXE_NAME);
        if exact_match.is_file() {
            return Ok(exact_match);
        }
        if let Some(path) = find_sidecar_binary(&candidate) {
            return Ok(path);
        }
    }

    Err("Failed to locate bundled chem-engine sidecar".to_string())
}

fn find_sidecar_binary(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(nested) = find_sidecar_binary(&path) {
                return Some(nested);
            }
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let is_sidecar = file_name == "chem-engine" || file_name == "chem-engine.exe";
        if is_sidecar {
            #[cfg(windows)]
            if !file_name.ends_with(".exe") {
                continue;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if std::fs::metadata(&path).ok()?.permissions().mode() & 0o111 == 0 {
                    continue;
                }
            }
            return Some(path);
        }
    }
    None
}

fn bundled_sidecar_dir_name() -> Result<String, String> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        other => {
            return Err(format!(
                "Unsupported architecture for bundled sidecar selection: {other}"
            ))
        }
    };

    let triple = match std::env::consts::OS {
        "macos" => format!("{arch}-apple-darwin"),
        "linux" => format!("{arch}-unknown-linux-gnu"),
        "windows" => format!("{arch}-pc-windows-msvc"),
        other => {
            return Err(format!(
                "Unsupported OS for bundled sidecar selection: {other}"
            ))
        }
    };

    Ok(format!("chem-engine-{triple}"))
}

#[tauri::command]
async fn generate_conformers(
    app: tauri::AppHandle,
    smiles: Option<String>,
    molblock: Option<String>,
    force_field: Option<String>,
    max_conformers: Option<i32>,
) -> Result<Value, String> {
    let ff = force_field.unwrap_or_else(|| "MMFF94s".to_string());
    let max = max_conformers.unwrap_or(10).to_string();
    let mut args = vec![
        "conformer".to_string(),
        "--ff".to_string(),
        ff,
        "--max".to_string(),
        max,
    ];
    if let Some(molblock) = molblock {
        args.push("--molblock".to_string());
        args.push("-".to_string());
        run_engine(app, args, Some(molblock))
    } else if let Some(smiles) = smiles.filter(|value| !value.trim().is_empty()) {
        args.push(smiles);
        run_engine(app, args, None)
    } else {
        Err("generate_conformers requires smiles or molblock".to_string())
    }
}

#[tauri::command]
async fn parse_chemical_file(
    app: tauri::AppHandle,
    content: String,
    format: String,
) -> Result<Value, String> {
    run_engine(app, vec!["parse".to_string(), format], Some(content))
}

#[tauri::command]
async fn export_chemical_file(
    app: tauri::AppHandle,
    molblock: String,
    format: String,
    arrows_json: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["export".to_string(), format];
    if let Some(aj) = arrows_json {
        args.push("--arrows".to_string());
        args.push(aj);
    }
    run_engine(app, args, Some(molblock))
}

#[tauri::command]
async fn xyz_to_conformer(app: tauri::AppHandle, xyz_text: String) -> Result<Value, String> {
    run_engine(app, vec!["xyz-conformer".to_string()], Some(xyz_text))
}

#[tauri::command]
async fn compute_properties(app: tauri::AppHandle, smiles: String) -> Result<Value, String> {
    run_engine(app, vec!["properties".to_string(), smiles], None)
}

#[tauri::command]
async fn calculate_orbitals(
    app: tauri::AppHandle,
    smiles: Option<String>,
    molblock: Option<String>,
    atoms: Vec<OrbitalAtomInput>,
    basis: Option<String>,
    isovalue: Option<f64>,
    charge: Option<i32>,
) -> Result<Value, String> {
    let request = json!({
        "smiles": smiles,
        "molblock": molblock,
        "atoms": atoms,
        "basis": basis.unwrap_or_else(|| "3-21G".to_string()),
        "isovalue": isovalue.unwrap_or(0.045),
        "charge": charge,
    });
    let stdin_content = serde_json::to_string(&request)
        .map_err(|e| format!("Failed to encode orbital request: {e}"))?;
    run_orbital_engine(app, vec!["orbitals".to_string()], Some(stdin_content))
}

#[tauri::command]
async fn optimize_hartree_fock_geometry(
    app: tauri::AppHandle,
    smiles: Option<String>,
    molblock: Option<String>,
    atoms: Vec<OrbitalAtomInput>,
    basis: Option<String>,
    bonds: Option<Vec<OrbitalBondInput>>,
    charge: Option<i32>,
) -> Result<Value, String> {
    let request = json!({
        "smiles": smiles,
        "molblock": molblock,
        "atoms": atoms,
        "basis": basis.unwrap_or_else(|| "3-21G".to_string()),
        "bonds": bonds,
        "charge": charge,
    });
    let stdin_content = serde_json::to_string(&request)
        .map_err(|e| format!("Failed to encode HF optimization request: {e}"))?;
    run_orbital_engine(app, vec!["optimize-hf".to_string()], Some(stdin_content))
}

#[tauri::command]
async fn predict_ir(app: tauri::AppHandle, smiles: String) -> Result<Value, String> {
    run_engine(app, vec!["ir".to_string(), smiles], None)
}

#[tauri::command]
async fn predict_nmr(
    app: tauri::AppHandle,
    smiles: Option<String>,
    molblock: Option<String>,
    method: Option<String>,
    solvent: Option<String>,
    include_j: Option<bool>,
    request_id: Option<String>,
) -> Result<Value, String> {
    let method = method.unwrap_or_else(|| "hose".to_string());
    let request = json!({
        "command": "predict_nmr",
        "request_id": request_id,
        "smiles": smiles,
        "molblock": molblock,
        "method": method,
        "solvent": solvent.unwrap_or_else(|| "CDCl3".to_string()),
        "include_j": include_j.unwrap_or(false),
    });

    let _dft_guard = if request["method"] == "dft" {
        Some(app.state::<DftJobState>().try_acquire()?)
    } else {
        None
    };

    let engine = Arc::clone(app.state::<Arc<PersistentNmrEngine>>().inner());
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || engine.invoke(&app_handle, &request))
        .await
        .map_err(|e| format!("Persistent NMR task failed: {e}"))?
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn cancel_nmr_prediction(app: tauri::AppHandle) {
    app.state::<Arc<PersistentNmrEngine>>()
        .cancel_active_request();
}

#[tauri::command]
async fn predict_ms(app: tauri::AppHandle, smiles: String) -> Result<Value, String> {
    run_engine(app, vec!["ms".to_string(), smiles], None)
}

fn app_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve app config dir: {e}"))?;
    Ok(config_dir.join("settings.json"))
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn load_app_settings(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app_settings_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Failed to read settings file {}: {e}", path.display()))
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn save_app_settings(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let path = app_settings_path(&app)?;
    let Some(parent) = path.parent() else {
        return Err("Resolved settings path has no parent directory".to_string());
    };
    fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create settings dir {}: {e}", parent.display()))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write settings file {}: {e}", path.display()))
}

#[allow(clippy::needless_pass_by_value)]
fn run_engine(
    app: tauri::AppHandle,
    args: Vec<String>,
    stdin_content: Option<String>,
) -> Result<Value, String> {
    run_bundled_engine(&app, &args, stdin_content)
}

#[allow(clippy::needless_pass_by_value)]
fn run_orbital_engine(
    app: tauri::AppHandle,
    args: Vec<String>,
    stdin_content: Option<String>,
) -> Result<Value, String> {
    let bundled = run_bundled_engine(&app, &args, stdin_content.clone());
    match bundled {
        Ok(value) if orbital_engine_needs_workspace_fallback(&value) => {
            eprintln!(
                "chem-editor: bundled orbital engine lacks PySCF, retrying with workspace Python"
            );
            run_workspace_python_engine(&app, &args, stdin_content).map_err(|fallback_error| {
                format!(
                    "{}. Workspace fallback also failed: {}",
                    value
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("Bundled orbital engine could not load PySCF"),
                    fallback_error
                )
            })
        }
        Ok(value) => Ok(value),
        Err(error) if orbital_engine_error_needs_workspace_fallback(&error) => {
            eprintln!(
                "chem-editor: bundled orbital engine failed with PySCF import error, retrying with workspace Python"
            );
            run_workspace_python_engine(&app, &args, stdin_content).map_err(|fallback_error| {
                format!("{error}. Workspace fallback also failed: {fallback_error}")
            })
        }
        Err(error) => Err(error),
    }
}

fn run_bundled_engine(
    app: &tauri::AppHandle,
    args: &[String],
    stdin_content: Option<String>,
) -> Result<Value, String> {
    let executable = resolve_sidecar_executable(app)?;
    let mut cmd = Command::new(&executable);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if stdin_content.is_some() {
        cmd.stdin(Stdio::piped());
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar {}: {e}", executable.display()))?;
    let pid = child.id();
    app.state::<SidecarTracker>().add_pid(pid);

    if let Some(input) = stdin_content {
        let mut stdin = child.stdin.take().ok_or("Failed to open sidecar stdin")?;
        stdin
            .write_all(input.as_bytes())
            .map_err(|e| format!("Failed to write to sidecar: {e}"))?;
        drop(stdin);
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Sidecar wait error: {e}"))?;
    app.state::<SidecarTracker>().remove(pid);

    handle_output(output.status.success(), &output.stdout, &output.stderr)
}

fn run_workspace_python_engine(
    app: &tauri::AppHandle,
    args: &[String],
    stdin_content: Option<String>,
) -> Result<Value, String> {
    let src_tauri_dir = resolve_workspace_src_tauri_dir().ok_or_else(|| {
        "Workspace PySCF fallback is unavailable because src-tauri/bin/chem-engine.py could not be found"
            .to_string()
    })?;
    let python_executable = resolve_workspace_python_executable(&src_tauri_dir)?;
    let script_path = src_tauri_dir.join("bin").join("chem-engine.py");

    let mut cmd = Command::new(&python_executable);
    cmd.current_dir(&src_tauri_dir)
        .arg(&script_path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if stdin_content.is_some() {
        cmd.stdin(Stdio::piped());
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "Failed to spawn workspace orbital engine {}: {e}",
            python_executable.display()
        )
    })?;
    let pid = child.id();
    app.state::<SidecarTracker>().add_pid(pid);

    if let Some(input) = stdin_content {
        let mut stdin = child
            .stdin
            .take()
            .ok_or("Failed to open workspace orbital engine stdin")?;
        stdin
            .write_all(input.as_bytes())
            .map_err(|e| format!("Failed to write to workspace orbital engine: {e}"))?;
        drop(stdin);
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Workspace orbital engine wait error: {e}"))?;
    app.state::<SidecarTracker>().remove(pid);

    handle_output(output.status.success(), &output.stdout, &output.stderr)
}

fn resolve_workspace_src_tauri_dir() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    push_unique_path(&mut candidates, PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    if let Ok(cwd) = env::current_dir() {
        collect_workspace_src_tauri_candidates(&cwd, &mut candidates);
    }
    if let Ok(exe_path) = tauri::utils::platform::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            collect_workspace_src_tauri_candidates(exe_dir, &mut candidates);
        }
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.join("bin").join("chem-engine.py").is_file())
}

fn collect_workspace_src_tauri_candidates(start: &Path, candidates: &mut Vec<PathBuf>) {
    for ancestor in start.ancestors() {
        push_unique_path(candidates, ancestor.to_path_buf());
        push_unique_path(candidates, ancestor.join("src-tauri"));
    }
}

fn push_unique_path(candidates: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !candidates.iter().any(|existing| existing == &candidate) {
        candidates.push(candidate);
    }
}

fn resolve_workspace_python_executable(src_tauri_dir: &Path) -> Result<PathBuf, String> {
    let candidates = [
        src_tauri_dir.join(".venv").join("bin").join("python3"),
        src_tauri_dir.join(".venv").join("bin").join("python"),
        src_tauri_dir
            .join(".venv")
            .join("Scripts")
            .join("python.exe"),
    ];
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            format!(
                "Workspace PySCF fallback could not find a Python executable in {}",
                src_tauri_dir.join(".venv").display()
            )
        })
}

fn orbital_engine_needs_workspace_fallback(value: &Value) -> bool {
    value
        .get("error")
        .and_then(Value::as_str)
        .is_some_and(orbital_engine_error_needs_workspace_fallback)
}

fn orbital_engine_error_needs_workspace_fallback(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    (normalized.contains("pyscf")
        && (normalized.contains("unavailable") || normalized.contains("not installed")))
        || (normalized.contains("scipy")
            && (normalized.contains("unavailable") || normalized.contains("not installed")))
}

fn handle_output(success: bool, stdout: &[u8], stderr: &[u8]) -> Result<Value, String> {
    if !success {
        return Err(String::from_utf8_lossy(stderr).to_string());
    }
    serde_json::from_slice(stdout).map_err(|e| format!("JSON Error: {e}"))
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(not(target_os = "macos"), allow(clippy::unnecessary_wraps))]
fn sync_macos_window_theme(window: tauri::Window, is_dark_mode: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::window::Color;

        let theme = if is_dark_mode {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        };
        let background = if is_dark_mode {
            Color(0x33, 0x33, 0x33, 0xff)
        } else {
            Color(0xff, 0xff, 0xff, 0xff)
        };

        window
            .set_theme(Some(theme))
            .map_err(|e| format!("Failed to set macOS window theme: {e}"))?;
        window
            .set_background_color(Some(background))
            .map_err(|e| format!("Failed to set macOS window background color: {e}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, is_dark_mode);
    }

    Ok(())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn toggle_native_fullscreen(window: tauri::Window) -> Result<(), String> {
    let is_fullscreen = window
        .is_fullscreen()
        .map_err(|e| format!("Failed to read fullscreen state: {e}"))?;
    window
        .set_fullscreen(!is_fullscreen)
        .map_err(|e| format!("Failed to toggle fullscreen: {e}"))
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn copy_image_to_clipboard(rgba_b64: String, width: usize, height: usize) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let rgba = STANDARD.decode(&rgba_b64).map_err(|e| e.to_string())?;
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width,
            height,
            bytes: std::borrow::Cow::Owned(rgba),
        })
        .map_err(|e| e.to_string())
}

fn shutdown_app_sidecars(app_handle: &tauri::AppHandle) {
    app_handle
        .state::<Arc<PersistentNmrEngine>>()
        .fast_shutdown();
    app_handle.state::<SidecarTracker>().kill_all();
}

/// # Panics
/// Panics if the Tauri application fails to initialize or run.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|info| {
        eprintln!("chem-editor crash: {info}");
        write_crash_log(&format!("{info}"));
        if let Some(engine) = PANIC_CLEANUP.get() {
            engine.shutdown();
        }
    }));

    let persistent_nmr_engine = Arc::new(PersistentNmrEngine::new());
    let _ = PANIC_CLEANUP.set(Arc::clone(&persistent_nmr_engine));

    let app = tauri::Builder::default()
        .manage(SidecarTracker::new())
        .manage(DftJobState::new())
        .manage(persistent_nmr_engine)
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_handle = app.app_handle().clone();
            let engine = Arc::clone(app.state::<Arc<PersistentNmrEngine>>().inner());
            tauri::async_runtime::spawn_blocking(move || {
                let _ = engine.warmup(&app_handle);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            generate_conformers,
            parse_chemical_file,
            export_chemical_file,
            xyz_to_conformer,
            compute_properties,
            calculate_orbitals,
            optimize_hartree_fock_geometry,
            predict_ir,
            predict_ms,
            predict_nmr,
            cancel_nmr_prediction,
            sync_macos_window_theme,
            toggle_native_fullscreen,
            copy_image_to_clipboard,
            load_app_settings,
            save_app_settings
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            shutdown_app_sidecars(app_handle);
        }
    });
}
