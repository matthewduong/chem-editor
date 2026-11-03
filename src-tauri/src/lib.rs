mod document_files;
mod jobs;
mod process_support;
mod quit;
mod templates;

use crate::process_support::{
    wait_with_progress, wait_with_timeout, write_crash_log, SidecarTracker, ONE_SHOT_TIMEOUT,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};
use std::time::Duration;
use tauri::Manager;
static SIDECAR_EXECUTABLE: OnceLock<Result<PathBuf, String>> = OnceLock::new();

#[cfg(windows)]
const SIDECAR_EXE_NAME: &str = "chem-engine.exe";
#[cfg(not(windows))]
const SIDECAR_EXE_NAME: &str = "chem-engine";

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

/// xtb minimisation of many conformers is slow but bounded.
const CONFORMER_TIMEOUT: Duration = Duration::from_mins(10);

#[tauri::command]
async fn generate_conformers(
    window: tauri::Window,
    job_id: Option<String>,

    app: tauri::AppHandle,
    smiles: Option<String>,
    molblock: Option<String>,
    force_field: Option<String>,
    max_conformers: Option<i32>,
) -> Result<Value, String> {
    let worker_app = app.clone();
    jobs::run(app, window, job_id, false, move || {
        let app = worker_app;
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
            run_bundled_engine(&app, &args, Some(molblock), Some(CONFORMER_TIMEOUT))
        } else if let Some(smiles) = smiles.filter(|value| !value.trim().is_empty()) {
            args.push(smiles);
            run_bundled_engine(&app, &args, None, Some(CONFORMER_TIMEOUT))
        } else {
            Err("generate_conformers requires smiles or molblock".to_string())
        }
    })
    .await
}

#[tauri::command]
async fn parse_chemical_file(
    window: tauri::Window,
    job_id: Option<String>,

    app: tauri::AppHandle,
    content: String,
    format: String,
) -> Result<Value, String> {
    let worker_app = app.clone();
    jobs::run(app, window, job_id, false, move || {
        let app = worker_app;
        run_engine(app, vec!["parse".to_string(), format], Some(content))
    })
    .await
}

#[tauri::command]
async fn export_chemical_file(
    window: tauri::Window,
    job_id: Option<String>,

    app: tauri::AppHandle,
    molblock: String,
    format: String,
    arrows_json: Option<String>,
) -> Result<Value, String> {
    let worker_app = app.clone();
    jobs::run(app, window, job_id, false, move || {
        let app = worker_app;
        let mut args = vec!["export".to_string(), format];
        if let Some(aj) = arrows_json {
            args.push("--arrows".to_string());
            args.push(aj);
        }
        run_engine(app, args, Some(molblock))
    })
    .await
}

#[tauri::command]
async fn xyz_to_conformer(
    window: tauri::Window,
    job_id: Option<String>,
    app: tauri::AppHandle,
    xyz_text: String,
) -> Result<Value, String> {
    let worker_app = app.clone();
    jobs::run(app, window, job_id, false, move || {
        let app = worker_app;
        run_engine(app, vec!["xyz-conformer".to_string()], Some(xyz_text))
    })
    .await
}

#[tauri::command]
async fn compute_properties(
    window: tauri::Window,
    job_id: Option<String>,
    app: tauri::AppHandle,
    smiles: String,
) -> Result<Value, String> {
    let worker_app = app.clone();
    jobs::run(app, window, job_id, false, move || {
        let app = worker_app;
        run_engine(app, vec!["properties".to_string(), smiles], None)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn calculate_orbitals(
    window: tauri::Window,
    job_id: Option<String>,

    app: tauri::AppHandle,
    smiles: Option<String>,
    molblock: Option<String>,
    atoms: Vec<OrbitalAtomInput>,
    basis: Option<String>,
    isovalue: Option<f64>,
    charge: Option<i32>,
) -> Result<Value, String> {
    let worker_app = app.clone();
    jobs::run(app, window, job_id, true, move || {
        let app = worker_app;
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
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn optimize_hartree_fock_geometry(
    window: tauri::Window,
    job_id: Option<String>,

    app: tauri::AppHandle,
    smiles: Option<String>,
    molblock: Option<String>,
    atoms: Vec<OrbitalAtomInput>,
    basis: Option<String>,
    bonds: Option<Vec<OrbitalBondInput>>,
    charge: Option<i32>,
) -> Result<Value, String> {
    let worker_app = app.clone();
    jobs::run(app, window, job_id, true, move || {
        let app = worker_app;
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
    })
    .await
}

#[tauri::command]
async fn predict_ir(
    window: tauri::Window,
    job_id: Option<String>,
    app: tauri::AppHandle,
    smiles: String,
) -> Result<Value, String> {
    let worker_app = app.clone();
    jobs::run(app, window, job_id, true, move || {
        let app = worker_app;
        run_engine(app, vec!["ir".to_string(), smiles], None)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn predict_nmr(
    window: tauri::Window,
    job_id: Option<String>,

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

    let mut args = vec![
        "nmr".into(),
        "--method".into(),
        method.clone(),
        "--solvent".into(),
        request["solvent"].as_str().unwrap_or("CDCl3").into(),
    ];
    if include_j.unwrap_or(false) {
        args.push("--include-j".into());
    }
    let input = if let Some(block) = molblock {
        args.extend(["--molblock".into(), "-".into()]);
        Some(block)
    } else {
        if let Some(smiles) = smiles {
            args.push(smiles);
        }
        None
    };
    let worker_app = app.clone();
    jobs::run(
        app,
        window,
        job_id.or(request_id),
        method == "dft",
        move || {
            run_bundled_engine(
                &worker_app,
                &args,
                input,
                if method == "dft" {
                    None
                } else {
                    Some(ONE_SHOT_TIMEOUT)
                },
            )
        },
    )
    .await
}

#[tauri::command]
async fn predict_ms(
    window: tauri::Window,
    job_id: Option<String>,
    app: tauri::AppHandle,
    smiles: String,
) -> Result<Value, String> {
    let worker_app = app.clone();
    jobs::run(app, window, job_id, false, move || {
        let app = worker_app;
        run_engine(app, vec!["ms".to_string(), smiles], None)
    })
    .await
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
    run_bundled_engine(&app, &args, stdin_content, Some(ONE_SHOT_TIMEOUT))
}

#[allow(clippy::needless_pass_by_value)]
fn run_orbital_engine(
    app: tauri::AppHandle,
    args: Vec<String>,
    stdin_content: Option<String>,
) -> Result<Value, String> {
    let bundled = run_bundled_engine(&app, &args, stdin_content.clone(), None);
    match bundled {
        Ok(value) if cfg!(debug_assertions) && orbital_engine_needs_workspace_fallback(&value) => {
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
        Err(error)
            if cfg!(debug_assertions) && orbital_engine_error_needs_workspace_fallback(&error) =>
        {
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

/// Version of the argument/reply contract with `chem-engine.py` (`PROTOCOL_VERSION` there).
const EXPECTED_SIDECAR_PROTOCOL: i64 = 1;
static SIDECAR_PROTOCOL_VERIFIED: AtomicBool = AtomicBool::new(false);

/// Confirm once per run that the bundled sidecar speaks the protocol this shell expects, so a
/// stale binary fails with an actionable message rather than an argparse error or misparsed JSON.
fn verify_sidecar_protocol(app: &tauri::AppHandle) -> Result<(), String> {
    if SIDECAR_PROTOCOL_VERIFIED.load(Ordering::Acquire) {
        return Ok(());
    }
    let reply =
        run_bundled_engine_unchecked(app, &["protocol".to_string()], None, Some(ONE_SHOT_TIMEOUT))
            .map_err(|error| {
                format!(
            "The bundled sidecar did not answer the protocol check and is probably out of date \
             (rebuild it with `pnpm sync:sidecar`): {error}"
        )
            })?;
    match reply.get("protocol").and_then(Value::as_i64) {
        Some(EXPECTED_SIDECAR_PROTOCOL) => {
            SIDECAR_PROTOCOL_VERIFIED.store(true, Ordering::Release);
            Ok(())
        }
        other => Err(format!(
            "The bundled sidecar speaks protocol {} but this app expects {EXPECTED_SIDECAR_PROTOCOL}; \
             rebuild it with `pnpm sync:sidecar`.",
            other.map_or_else(|| "unknown".to_string(), |v| v.to_string())
        )),
    }
}

fn run_bundled_engine(
    app: &tauri::AppHandle,
    args: &[String],
    stdin_content: Option<String>,
    timeout: Option<Duration>,
) -> Result<Value, String> {
    jobs::check_cancelled()?;
    verify_sidecar_protocol(app)?;
    run_bundled_engine_unchecked(app, args, stdin_content, timeout)
}

fn run_bundled_engine_unchecked(
    app: &tauri::AppHandle,
    args: &[String],
    stdin_content: Option<String>,
    timeout: Option<Duration>,
) -> Result<Value, String> {
    let executable = resolve_sidecar_executable(app)?;
    let mut cmd = Command::new(&executable);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if stdin_content.is_some() {
        cmd.stdin(Stdio::piped());
    }

    jobs::check_cancelled()?;
    crate::process_support::configure_process_group(&mut cmd);
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar {}: {e}", executable.display()))?;
    let pid = child.id();
    app.state::<SidecarTracker>().add_pid(pid);
    let output = wait_with_progress(
        child,
        stdin_content.map(String::into_bytes),
        timeout,
        jobs::progress_sink(),
    );
    app.state::<SidecarTracker>().remove(pid);
    let output = output?;

    handle_output(output.status.success(), &output.stdout, &output.stderr)
}

fn run_workspace_python_engine(
    app: &tauri::AppHandle,
    args: &[String],
    stdin_content: Option<String>,
) -> Result<Value, String> {
    jobs::check_cancelled()?;
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

    jobs::check_cancelled()?;
    crate::process_support::configure_process_group(&mut cmd);
    let child = cmd.spawn().map_err(|e| {
        format!(
            "Failed to spawn workspace orbital engine {}: {e}",
            python_executable.display()
        )
    })?;
    let pid = child.id();
    app.state::<SidecarTracker>().add_pid(pid);

    let output = wait_with_timeout(child, stdin_content.map(String::into_bytes), None);
    app.state::<SidecarTracker>().remove(pid);
    let output = output?;

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
    app_handle.state::<SidecarTracker>().kill_all();
}

/// # Panics
/// Panics if the Tauri application fails to initialize or run.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|info| {
        eprintln!("chem-editor crash: {info}");
        write_crash_log(&format!("{info}"));
    }));

    let app = tauri::Builder::default()
        .manage(SidecarTracker::new())
        .manage(quit::QuitState::default())
        .manage(document_files::RecoveryState::default())
        .manage(Arc::new(jobs::Jobs::default()))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            templates::load_template_library,
            templates::save_template_library,
            document_files::atomic_write_file,
            quit::acknowledge_document_quit,
            quit::receive_document_quit,
            document_files::list_document_recovery,
            document_files::claim_document_recovery,
            document_files::open_recovered_document,
            document_files::discard_document_recovery,
            document_files::save_document_recovery,
            document_files::startup_document,
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
            jobs::cancel_scientific_job,
            sync_macos_window_theme,
            toggle_native_fullscreen,
            copy_image_to_clipboard,
            load_app_settings,
            save_app_settings
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("chem-editor: error while building tauri application: {error}");
            std::process::exit(1);
        });

    app.run(|app_handle, event| {
        if let tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } = &event
        {
            app_handle.state::<Arc<jobs::Jobs>>().cancel_window(label);
            quit::window_destroyed(app_handle, label);
        }
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = &event
        {
            api.prevent_exit();
            quit::request(app_handle);
            return;
        }
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            shutdown_app_sidecars(app_handle);
        }
    });
}
