use std::{fs, path::Path, sync::Mutex};
use tauri::Manager;
static LIBRARY_LOCK: Mutex<()> = Mutex::new(());

fn read(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
fn validate(text: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if value["version"] != 1 || !value["templates"].is_array() {
        return Err("Malformed or unsupported template library; original file retained.".into());
    }
    Ok(())
}
fn write(path: &Path, contents: &str, expected: Option<&str>) -> Result<(), String> {
    let previous = read(path)?;
    if previous.as_deref() != expected {
        return Err("Template library changed; reload it before saving.".into());
    }
    if let Some(previous) = &previous {
        validate(previous)?;
    }
    validate(contents)?;
    crate::document_files::atomic_write(path, contents.as_bytes()).map_err(|e| e.to_string())
}
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn load_template_library(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let _guard = LIBRARY_LOCK.lock().map_err(|e| e.to_string())?;
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("templates.json");
    read(&path)
}
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn save_template_library(
    app: tauri::AppHandle,
    contents: String,
    expected: Option<String>,
) -> Result<(), String> {
    let _guard = LIBRARY_LOCK.lock().map_err(|e| e.to_string())?;
    let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    write(
        &directory.join("templates.json"),
        &contents,
        expected.as_deref(),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restart_and_compare_before_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("templates.json");
        let first = r#"{"version":1,"templates":[]}"#;
        write(&path, first, None).unwrap();
        assert_eq!(read(&path).unwrap().as_deref(), Some(first));
        assert!(write(&path, first, None).is_err());
        assert_eq!(read(&path).unwrap().as_deref(), Some(first));
        assert!(write(&path, "invalid", Some(first)).is_err());
        assert_eq!(read(&path).unwrap().as_deref(), Some(first));
    }
    #[test]
    fn malformed_and_future_files_are_retained() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("templates.json");
        for text in ["invalid", r#"{"version":2,"templates":[]}"#] {
            fs::write(&path, text).unwrap();
            assert!(write(&path, r#"{"version":1,"templates":[]}"#, Some(text)).is_err());
            assert_eq!(read(&path).unwrap().as_deref(), Some(text));
        }
    }
}
