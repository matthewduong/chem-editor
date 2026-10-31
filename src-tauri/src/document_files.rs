use std::fs;
use std::io::{self, Write};
use std::path::Path;
use tauri::Manager;

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn finish_document_quit(app: tauri::AppHandle) {
    app.exit(0);
}

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

/// Each window keeps its own recovery snapshot: the main window the original `recovery.json`,
/// a document window `recovery-<label>.json`, its label reduced to `[a-z0-9-]`.
pub(crate) fn recovery_file_name(window_label: &str) -> String {
    if window_label == "main" {
        return "recovery.json".to_string();
    }
    let safe: String = window_label
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    format!("recovery-{safe}.json")
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn load_document_recovery(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<Option<String>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(recovery_file_name(window.label()));
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn save_document_recovery(
    app: tauri::AppHandle,
    window: tauri::Window,
    contents: Option<String>,
) -> Result<(), String> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join(recovery_file_name(window.label()));
    if let Some(contents) = contents {
        atomic_write(&path, contents.as_bytes()).map_err(|e| e.to_string())
    } else {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
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
    fn each_window_has_its_own_recovery_file() {
        assert_eq!(recovery_file_name("main"), "recovery.json");
        assert_eq!(recovery_file_name("document-2"), "recovery-document-2.json");
        assert_eq!(recovery_file_name("../Evil/x"), "recovery----evil-x.json");
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
