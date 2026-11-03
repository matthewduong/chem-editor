use std::fs;
use std::io::{self, Write};
use std::path::Path;
use tauri::Manager;

/// Keep the original destination intact until the complete replacement is durable.
pub(crate) fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    if let Ok(metadata) = fs::metadata(path) {
        temporary
            .as_file()
            .set_permissions(metadata.permissions())?;
    }
    temporary.write_all(contents)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    #[cfg(unix)]
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn atomic_write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    atomic_write(Path::new(&path), &contents).map_err(|error| error.to_string())
}

/// The CDXML file the app was started on (`ChemEditor.exe drawing.cdxml`, "Open with", or the
/// OLE server's open editing): the first argument that is not a flag and names a `.cdxml` file.
pub(crate) fn document_path_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().skip(1).find(|arg| {
        !arg.starts_with('-')
            && Path::new(arg)
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("cdxml"))
    })
}

#[derive(serde::Serialize)]
pub(crate) struct StartupDocument {
    path: String,
    content: String,
}

/// The startup document's path and contents, for the main window to open; read here so a path
/// outside the file-system plugin's scopes still opens. Later windows start empty.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn startup_document(window: tauri::Window) -> Result<Option<StartupDocument>, String> {
    if window.label() != "main" {
        return Ok(None);
    }
    let Some(path) = document_path_from_args(std::env::args()) else {
        return Ok(None);
    };
    let content = fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    Ok(Some(StartupDocument { path, content }))
}

#[derive(Default)]
pub(crate) struct RecoveryState(pub std::sync::Mutex<RecoverySession>);
#[derive(Default)]
pub(crate) struct RecoverySession {
    owners: std::collections::HashMap<String, String>,
    chooser: Option<String>,
}
fn recovery_path(directory: &Path, id: &str) -> Result<std::path::PathBuf, String> {
    let id = uuid::Uuid::parse_str(id).map_err(|e| e.to_string())?;
    Ok(directory.join(format!("recovery-{id}.json")))
}
fn validate_snapshot(value: &serde_json::Value) -> bool {
    matches!(value["version"].as_u64(), Some(1 | 2))
        && value["savedAt"].is_string()
        && (value["path"].is_null() || value["path"].is_string())
        && value["document"]["schemaVersion"] == 1
        && value["document"]["pages"].as_array().is_some_and(|pages| {
            !pages.is_empty()
                && pages
                    .iter()
                    .all(|p| p["id"].is_string() && p["objects"].is_array())
        })
}
#[derive(serde::Serialize)]
pub(crate) struct RecoveryList {
    snapshots: Vec<serde_json::Value>,
    errors: Vec<String>,
}
fn enumerate(directory: &Path) -> Result<RecoveryList, String> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let mut result = RecoveryList {
        snapshots: vec![],
        errors: vec![],
    };
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !(name == "recovery.json"
            || (name.starts_with("recovery-")
                && Path::new(&name)
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("json"))))
        {
            continue;
        }
        let read = || -> Result<serde_json::Value, String> {
            let mut value: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(entry.path()).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            if !validate_snapshot(&value) {
                return Err("Invalid recovery envelope".into());
            }
            if value["version"] == 1 {
                // Write the durable replacement before removing the legacy source.
                let id = uuid::Uuid::new_v4().to_string();
                value["version"] = 2.into();
                value["id"] = id.clone().into();
                atomic_write(
                    &entry.path(),
                    &serde_json::to_vec(&value).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
                fs::rename(entry.path(), recovery_path(directory, &id)?)
                    .map_err(|e| e.to_string())?;
            } else {
                let path = recovery_path(
                    directory,
                    value["id"].as_str().ok_or("Missing recovery ID")?,
                )?;
                if path != entry.path() {
                    if name == "recovery.json" || name.starts_with("recovery-document-") {
                        fs::rename(entry.path(), path).map_err(|e| e.to_string())?;
                    } else {
                        return Err("Recovery identity does not match filename".into());
                    }
                }
            }
            Ok(value)
        };
        match read() {
            Ok(value) => result.snapshots.push(value),
            Err(e) => result.errors.push(format!("{name}: {e}")),
        }
    }
    Ok(result)
}
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn list_document_recovery(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<RecoveryList, String> {
    let state = app.state::<RecoveryState>();
    let mut session = state.0.lock().map_err(|e| e.to_string())?;
    if session
        .chooser
        .as_ref()
        .is_some_and(|label| label != window.label())
    {
        return Ok(RecoveryList {
            snapshots: vec![],
            errors: vec![],
        });
    }
    session.chooser = Some(window.label().into());
    let mut list = enumerate(&app.path().app_data_dir().map_err(|e| e.to_string())?)?;
    list.snapshots.retain(|s| {
        !session
            .owners
            .contains_key(s["id"].as_str().unwrap_or_default())
    });
    Ok(list)
}
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn open_recovered_document(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let label = format!("document-{}", uuid::Uuid::new_v4());
    let state = app.state::<RecoveryState>();
    {
        let mut session = state.0.lock().map_err(|e| e.to_string())?;
        if session.owners.contains_key(&id) {
            return Err("Recovery already claimed".into());
        }
        let path = recovery_path(&app.path().app_data_dir().map_err(|e| e.to_string())?, &id)?;
        if !path.is_file() {
            return Err("Recovery file missing".into());
        }
        session.owners.insert(id.clone(), label.clone());
    }
    let result = tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(format!("index.html?recovery={id}").into()),
    )
    .title("ChemEditor — Recovered drawing")
    .inner_size(1000.0, 700.0)
    .decorations(false)
    .build();
    if let Err(error) = result {
        state
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .owners
            .remove(&id);
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn claim_document_recovery(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
) -> Result<String, String> {
    let state = app.state::<RecoveryState>();
    let mut session = state.0.lock().map_err(|e| e.to_string())?;
    if session
        .owners
        .get(&id)
        .is_some_and(|owner| owner != window.label())
    {
        return Err("Recovery already claimed".into());
    }
    let contents = fs::read_to_string(recovery_path(
        &app.path().app_data_dir().map_err(|e| e.to_string())?,
        &id,
    )?)
    .map_err(|e| e.to_string())?;
    session.owners.insert(id, window.label().into());
    Ok(contents)
}
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn discard_document_recovery(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
) -> Result<(), String> {
    let state = app.state::<RecoveryState>();
    let mut session = state.0.lock().map_err(|e| e.to_string())?;
    if session
        .owners
        .get(&id)
        .is_some_and(|owner| owner != window.label())
    {
        return Err("Recovery belongs to another window".into());
    }
    remove_snapshot(&app.path().app_data_dir().map_err(|e| e.to_string())?, &id)?;
    session.owners.remove(&id);
    Ok(())
}
fn remove_snapshot(directory: &Path, id: &str) -> Result<(), String> {
    match fs::remove_file(recovery_path(directory, id)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
pub(crate) fn clear_quit_recovery(
    app: &tauri::AppHandle,
    labels: &std::collections::HashSet<String>,
) -> Result<(), String> {
    let state = app.state::<RecoveryState>();
    let session = state.0.lock().map_err(|e| e.to_string())?;
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    for (id, owner) in &session.owners {
        if labels.contains(owner) {
            remove_snapshot(&directory, id)?;
        }
    }
    Ok(())
}
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn save_document_recovery(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
    contents: Option<String>,
) -> Result<(), String> {
    let state = app.state::<RecoveryState>();
    let mut session = state.0.lock().map_err(|e| e.to_string())?;
    if session
        .owners
        .get(&id)
        .is_some_and(|owner| owner != window.label())
    {
        return Err("Recovery belongs to another window".into());
    }
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = recovery_path(&directory, &id)?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    if let Some(contents) = contents {
        let value: serde_json::Value =
            serde_json::from_str(&contents).map_err(|e| e.to_string())?;
        if !validate_snapshot(&value) || value["id"] != id || value["version"] != 2 {
            return Err("Invalid recovery snapshot".into());
        }
        atomic_write(&path, contents.as_bytes()).map_err(|e| e.to_string())?;
        session.owners.insert(id, window.label().into());
    } else {
        let ids: Vec<_> = session
            .owners
            .iter()
            .filter(|(_, owner)| *owner == window.label())
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            remove_snapshot(&directory, &id)?;
            session.owners.remove(&id);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_startup_document_is_the_first_cdxml_argument() {
        let args = |list: &[&str]| list.iter().map(ToString::to_string).collect::<Vec<_>>();
        assert_eq!(
            document_path_from_args(args(&[
                "ChemEditor",
                "-Embedding",
                "C:/t/a.CDXML",
                "b.cdxml"
            ])),
            Some("C:/t/a.CDXML".to_string())
        );
        assert_eq!(
            document_path_from_args(args(&["ChemEditor", "notes.txt"])),
            None
        );
        assert_eq!(document_path_from_args(args(&["ChemEditor"])), None);
    }

    #[test]
    fn legacy_migration_keeps_corrupt_files_and_persistent_identity() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("recovery.json"), r#"{"version":1,"savedAt":"now","path":null,"document":{"schemaVersion":1,"pages":[{"id":"p","objects":[]}]}}"#).unwrap();
        fs::write(
            directory.path().join("recovery-document-old.json"),
            b"broken",
        )
        .unwrap();
        let first = enumerate(directory.path()).unwrap();
        assert_eq!(first.snapshots.len(), 1);
        assert_eq!(first.errors.len(), 1);
        assert_eq!(first.snapshots[0]["version"], 2);
        assert!(directory.path().join("recovery-document-old.json").exists());
        let second = enumerate(directory.path()).unwrap();
        assert_eq!(first.snapshots, second.snapshots);
    }

    #[test]
    fn replaces_existing_file_and_creates_new_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("drawing.cdxml");
        atomic_write(&path, b"first").unwrap();
        atomic_write(&path, b"second").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_replacement_keeps_destination_and_cleans_temporary_file() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("existing");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("sentinel"), b"keep").unwrap();
        assert!(atomic_write(&destination, b"replacement").is_err());
        assert_eq!(fs::read(destination.join("sentinel")).unwrap(), b"keep");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
