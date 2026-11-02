use crate::{
    domain::{AlertStyle, Appearance, ColorTheme, ReminderStatus, SoundChoice},
    notifications,
    runtime::{AppRuntime, Snapshot},
    storage::unix_timestamp,
    windows,
};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt as _;

pub const STATE_EVENT: &str = "sela://state";

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertContext {
    alert_token: u64,
}

#[tauri::command]
pub fn mark_window_ready(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    runtime: State<'_, Arc<AppRuntime>>,
) {
    let label = window.label().to_owned();
    if runtime.mark_window_ready(&label) {
        windows::open_capture(&app);
    }
    if label == "alert" {
        let snapshot = runtime.snapshot_for(&label);
        if snapshot.active_id.is_some() || snapshot.preview {
            publish_and_present(&app);
        }
    }
}

#[tauri::command]
pub fn get_snapshot(window: tauri::WebviewWindow, runtime: State<'_, Arc<AppRuntime>>) -> Snapshot {
    let label = window.label().to_owned();
    if label == "main" {
        runtime.mark_window_ready(&label);
    }
    runtime.snapshot_for(&label)
}

#[tauri::command]
pub async fn create_reminder(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
    title: String,
    duration_ms: Option<u64>,
) -> Result<(), String> {
    runtime
        .mutate_document(move |document| {
            document
                .create(&title, duration_ms, unix_timestamp())
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .await?;
    publish_and_present(&app);
    Ok(())
}

#[tauri::command]
pub async fn create_scheduled_reminder(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
    title: String,
    schedule: crate::scheduling::Schedule,
) -> Result<(), String> {
    runtime
        .mutate_document(move |document| {
            document
                .create_scheduled(&title, schedule, unix_timestamp())
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .await?;
    publish_and_present(&app);
    Ok(())
}

#[tauri::command]
pub async fn rename_reminder(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
    id: String,
    title: String,
    expected_occurrence_revision: u64,
) -> Result<(), String> {
    let transition_id = id.clone();
    runtime
        .mutate_occurrence_reminder(id, expected_occurrence_revision, move |document| {
            document
                .rename(&transition_id, &title)
                .map_err(|error| error.to_string())
        })
        .await?;
    publish_and_present(&app);
    Ok(())
}

#[tauri::command]
pub async fn edit_scheduled_reminder(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
    id: String,
    title: String,
    schedule: crate::scheduling::Schedule,
    expected_occurrence_revision: u64,
) -> Result<(), String> {
    runtime
        .mutate_document(move |document| {
            if !document.reminders.iter().any(|reminder| {
                reminder.id == id && reminder.occurrence_revision == expected_occurrence_revision
            }) {
                return Err("That reminder just changed. Here’s the latest.".into());
            }
            document
                .edit_scheduled(&id, &title, schedule, unix_timestamp())
                .map_err(|error| error.to_string())
        })
        .await?;
    publish_and_present(&app);
    Ok(())
}

#[tauri::command]
pub async fn change_reminder(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
    id: String,
    action: String,
    duration_ms: Option<u64>,
    alert: Option<AlertContext>,
    expected_occurrence_revision: Option<u64>,
) -> Result<(), String> {
    let transition = reminder_transition(id.clone(), action, duration_ms);
    if let Some(alert) = alert {
        runtime
            .mutate_alert_reminder(id, alert.alert_token, transition)
            .await?;
    } else {
        let revision = expected_occurrence_revision
            .ok_or_else(|| "That reminder just changed. Here’s the latest.".to_owned())?;
        runtime
            .mutate_occurrence_reminder(id, revision, transition)
            .await?;
    }
    publish_and_present(&app);
    Ok(())
}

fn reminder_transition(
    id: String,
    action: String,
    duration_ms: Option<u64>,
) -> impl FnOnce(&mut crate::domain::Document) -> Result<(), String> + Send + 'static {
    move |document| {
        let now = unix_timestamp();
        match action.as_str() {
            "done" => document.resolve(&id, ReminderStatus::Completed, now),
            "remove" => document.resolve(&id, ReminderStatus::Cancelled, now),
            "snooze" => document.snooze(
                &id,
                duration_ms.ok_or_else(|| "Pick how long first.".to_owned())?,
                now,
            ),
            "reschedule" => document.reschedule(
                &id,
                duration_ms.ok_or_else(|| "Pick how long first.".to_owned())?,
                now,
            ),
            other => {
                log::error!("unknown reminder action: {other}");
                return Err("Something went wrong. Please try again.".into());
            }
        }
        .map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub async fn dismiss_alert(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
    alert_token: u64,
) -> Result<(), String> {
    runtime.dismiss_alert(alert_token).await?;
    publish_and_present(&app);
    Ok(())
}

#[tauri::command]
pub async fn preview_alert(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
) -> Result<(), String> {
    runtime.start_preview().await?;
    publish_and_present(&app);
    Ok(())
}

#[tauri::command]
pub async fn set_alert_style(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
    style: AlertStyle,
) -> Result<(), String> {
    runtime
        .mutate_document(move |document| {
            document.settings.alert_style = style;
            Ok(())
        })
        .await?;
    runtime.retry_failed_deliveries(unix_timestamp()).await;
    publish_and_present(&app);
    Ok(())
}

#[tauri::command]
pub async fn retry_failed_deliveries(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
) -> Result<(), String> {
    runtime.retry_failed_deliveries(unix_timestamp()).await;
    publish_and_present(&app);
    Ok(())
}

const MAX_CUSTOM_SOUND_BYTES: usize = 8 * 1024 * 1024;

fn valid_wav(bytes: &[u8]) -> bool {
    if bytes.len() < 12
        || bytes.len() > MAX_CUSTOM_SOUND_BYTES
        || &bytes[0..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
    {
        return false;
    }
    let total = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize + 8;
    if total != bytes.len() {
        return false;
    }
    let (mut offset, mut format, mut data) = (12usize, false, false);
    while offset + 8 <= total {
        let size = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        let Some(end) = offset
            .checked_add(8)
            .and_then(|value| value.checked_add(size))
        else {
            return false;
        };
        if end > total {
            return false;
        }
        if &bytes[offset..offset + 4] == b"fmt " && size >= 16 {
            format = true;
        }
        if &bytes[offset..offset + 4] == b"data" && size > 0 {
            data = true;
        }
        offset = end + (size % 2);
    }
    format && data && offset == total
}

fn custom_sound_path(app: &tauri::AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    let id = uuid::Uuid::parse_str(id)
        .map_err(|_| "That sound is unavailable. Upload it again.".to_string())?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "The sound folder is unavailable.".to_string())?
        .join("sounds");
    Ok(root.join(format!("{id}.wav")))
}

#[tauri::command]
pub async fn set_sound_choice(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
    choice: SoundChoice,
) -> Result<(), String> {
    runtime
        .mutate_document(move |document| {
            if choice == SoundChoice::Custom && document.settings.custom_sound_id.is_none() {
                return Err("Upload a WAV file first.".into());
            }
            document.settings.sound_choice = choice;
            Ok(())
        })
        .await?;
    publish(&app);
    Ok(())
}

fn write_custom_sound(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    if !valid_wav(bytes) {
        return Err("Choose a valid WAV file no larger than 8 MB.".into());
    }
    let parent = path.parent().ok_or("The sound folder is unavailable.")?;
    std::fs::create_dir_all(parent)
        .map_err(|_| "The sound couldn't be saved. Check available disk space.".to_string())?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "The sound couldn't be saved. Check available disk space.".to_string())?;
    let write_result = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    if write_result.is_err() {
        let _ = std::fs::remove_file(path);
        return Err("The sound couldn't be saved. Check available disk space.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn upload_custom_sound(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let path = custom_sound_path(&app, &id)?;
    write_custom_sound(&path, &bytes)?;
    let sound_id = id.clone();
    let result = runtime
        .mutate_document(move |document| {
            document.settings.custom_sound_id = Some(id);
            document.settings.sound_choice = SoundChoice::Custom;
            Ok(())
        })
        .await;
    if result.is_err() {
        let _ = std::fs::remove_file(path);
    }
    result?;
    publish(&app);
    Ok(sound_id)
}

#[tauri::command]
pub fn get_custom_sound(app: tauri::AppHandle, id: String) -> Result<Vec<u8>, String> {
    let path = custom_sound_path(&app, &id)?;
    let metadata = std::fs::metadata(&path)
        .map_err(|_| "That sound is unavailable. Upload it again.".to_string())?;
    if metadata.len() > MAX_CUSTOM_SOUND_BYTES as u64 {
        return Err("That sound is too large. Upload it again.".into());
    }
    std::fs::read(path).map_err(|_| "That sound is unavailable. Upload it again.".into())
}

#[tauri::command]
pub async fn set_sound_enabled(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
    enabled: bool,
) -> Result<(), String> {
    runtime
        .mutate_document(move |document| {
            document.settings.sound_enabled = enabled;
            Ok(())
        })
        .await?;
    publish(&app);
    Ok(())
}

#[tauri::command]
pub async fn set_default_snooze_minutes(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
    minutes: u8,
) -> Result<(), String> {
    if !matches!(minutes, 5 | 10 | 15 | 30) {
        return Err("Choose 5, 10, 15, or 30 minutes.".into());
    }
    runtime
        .mutate_document(move |document| {
            document.settings.default_snooze_minutes = minutes;
            Ok(())
        })
        .await?;
    publish(&app);
    Ok(())
}

fn update_appearance(
    settings: &mut crate::domain::Settings,
    appearance: Option<Appearance>,
    color_theme: Option<ColorTheme>,
) {
    if let Some(appearance) = appearance {
        settings.appearance = appearance;
    }
    if let Some(color_theme) = color_theme {
        settings.color_theme = color_theme;
    }
}

#[tauri::command]
pub async fn set_appearance(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
    appearance: Option<Appearance>,
    color_theme: Option<ColorTheme>,
) -> Result<(), String> {
    runtime
        .mutate_document(move |document| {
            update_appearance(&mut document.settings, appearance, color_theme);
            Ok(())
        })
        .await?;
    if let Some(appearance) = appearance {
        windows::apply_appearance(&app, appearance);
    }
    publish(&app);
    Ok(())
}

#[tauri::command]
pub async fn complete_onboarding(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
) -> Result<(), String> {
    runtime
        .mutate_document(|document| {
            document.settings.onboarding_completed = true;
            Ok(())
        })
        .await?;
    publish(&app);
    Ok(())
}

#[tauri::command]
pub async fn get_launch_at_login(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
) -> Result<bool, String> {
    let enabled = app.autolaunch().is_enabled().map_err(|error| {
        log::error!("could not read Launch at Login state: {error}");
        "Couldn't check Launch at Login. Please try again.".to_owned()
    })?;
    runtime.set_launch_at_login(enabled).await;
    publish(&app);
    Ok(enabled)
}

#[tauri::command]
pub async fn set_launch_at_login(
    app: tauri::AppHandle,
    runtime: State<'_, Arc<AppRuntime>>,
    enabled: bool,
) -> Result<bool, String> {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|error| {
        log::error!("could not change autostart state: {error}");
        if enabled {
            "Couldn't turn on Launch at Login. Move Sela to Applications, then try again."
                .to_owned()
        } else {
            "Couldn't turn off Launch at Login. Remove Sela in System Settings → General → Login Items."
                .to_owned()
        }
    })?;
    let state = manager.is_enabled().map_err(|error| {
        log::error!("could not confirm autostart state: {error}");
        "Couldn't confirm the change. Check System Settings → General → Login Items.".to_owned()
    })?;
    runtime.set_launch_at_login(state).await;
    publish(&app);
    Ok(state)
}

#[tauri::command]
pub fn show_capture(app: tauri::AppHandle) {
    windows::open_capture(&app);
}

#[tauri::command]
pub fn hide_capture(app: tauri::AppHandle) {
    windows::hide_capture(&app);
}

#[tauri::command]
pub fn show_dashboard(app: tauri::AppHandle) {
    windows::hide_capture(&app);
    windows::open_dashboard(&app);
}

#[tauri::command]
pub fn hide_dashboard(app: tauri::AppHandle) {
    windows::hide_dashboard(&app);
}

pub async fn handle_notification_action(
    app: &tauri::AppHandle,
    action: &str,
    id: &str,
    due_at: Option<u64>,
    occurrence_revision: Option<u64>,
) {
    let (Some(expected_due_at), Some(expected_occurrence_revision)) = (due_at, occurrence_revision)
    else {
        windows::open_dashboard(app);
        return;
    };
    if id.is_empty() {
        windows::open_dashboard(app);
        return;
    }
    let runtime = app.state::<Arc<AppRuntime>>();
    let id = id.to_owned();
    let result = match action {
        "done" => {
            runtime
                .mutate_notification_reminder(
                    id.clone(),
                    expected_due_at,
                    expected_occurrence_revision,
                    reminder_transition(id.clone(), "done".into(), None),
                )
                .await
        }
        "snooze" => {
            runtime
                .mutate_notification_reminder(
                    id.clone(),
                    expected_due_at,
                    expected_occurrence_revision,
                    reminder_transition(id.clone(), "snooze".into(), Some(5 * 60_000)),
                )
                .await
        }
        _ => {
            windows::open_dashboard(app);
            return;
        }
    };
    if let Err(error) = result {
        log::warn!("notification action ignored: {error}");
        windows::open_dashboard(app);
        return;
    }
    publish_and_present(app);
}

pub fn publish(app: &tauri::AppHandle) {
    let runtime = app.state::<Arc<AppRuntime>>();
    for label in ["main", "capture", "alert"] {
        if let Err(error) = app.emit_to(label, STATE_EVENT, runtime.snapshot_for(label)) {
            log::error!("could not publish state to {label}: {error}");
        }
    }
}

pub fn publish_and_present(app: &tauri::AppHandle) {
    publish(app);
    let app = app.clone();
    if let Err(error) = app.clone().run_on_main_thread(move || present(&app)) {
        log::error!("could not schedule presentation: {error}");
    }
}

fn present(app: &tauri::AppHandle) {
    let runtime = app.state::<Arc<AppRuntime>>();
    let snapshot = runtime.snapshot_for("alert");
    let Some(alert_window) = app.get_webview_window("alert") else {
        return;
    };
    if snapshot.settings.alert_style != AlertStyle::Native && !runtime.is_window_ready("alert") {
        return;
    }
    let showing = snapshot.active_id.is_some() || snapshot.preview;
    if !showing || snapshot.settings.alert_style == AlertStyle::Native {
        let _ = alert_window.hide();
    }
    if !showing {
        return;
    }

    if snapshot.settings.alert_style == AlertStyle::Native {
        if runtime.reserve_notification(snapshot.alert_token) {
            #[cfg(debug_assertions)]
            if std::env::args().any(|argument| argument == "--smoke-test") {
                // Never post a real macOS banner from the automated smoke test. In dev mode
                // notify-rust attributes the banner to Terminal, not to Sela's bundle.
                let app = app.clone();
                let runtime = Arc::clone(&runtime);
                let token = snapshot.alert_token;
                tauri::async_runtime::spawn(async move {
                    runtime
                        .handoff_native_notification(token, unix_timestamp())
                        .await;
                    publish(&app);
                });
                return;
            }
            match notifications::send(app, &snapshot) {
                Ok(()) => {
                    let app = app.clone();
                    let runtime = Arc::clone(&runtime);
                    let token = snapshot.alert_token;
                    tauri::async_runtime::spawn(async move {
                        runtime
                            .handoff_native_notification(token, unix_timestamp())
                            .await;
                        runtime.set_delivery_error(None);
                        publish(&app);
                    });
                }
                Err(message) => {
                    let app = app.clone();
                    let runtime = Arc::clone(&runtime);
                    let token = snapshot.alert_token;
                    tauri::async_runtime::spawn(async move {
                        runtime
                            .fail_active_delivery(token, message, unix_timestamp())
                            .await;
                        publish(&app);
                        windows::open_dashboard(&app);
                    });
                }
            }
        }
        return;
    }

    let result = match snapshot.settings.alert_style {
        AlertStyle::Notch => windows::position_notch_alert(app),
        AlertStyle::Fullscreen => windows::position_fullscreen_alert(app),
        AlertStyle::Native => unreachable!(),
    };
    let result = result.and_then(|()| {
        if !alert_window.is_visible().unwrap_or(false) {
            alert_window.show()?;
            let _ = alert_window.set_focus();
        }
        Ok(())
    });
    if let Err(error) = result {
        log::error!("could not present alert: {error}");
        let app = app.clone();
        let runtime = Arc::clone(&runtime);
        let token = snapshot.alert_token;
        tauri::async_runtime::spawn(async move {
            runtime
                .fail_active_delivery(
                    token,
                    "Your reminder couldn't appear, so it is waiting in Activities. Try another alert style."
                        .into(),
                    unix_timestamp(),
                )
                .await;
            publish(&app);
            windows::open_dashboard(&app);
        });
        return;
    }

    let _ = alert_window.emit("sela://alert-style", snapshot.settings.alert_style);
    // Replay the entrance when a new alert token replaces the visible reminder.
    if runtime.needs_alert_entrance(snapshot.alert_token) {
        let _ = alert_window.emit("sela://alert-open", ());
        runtime.record_alert_presented(snapshot.alert_token);
    }
    if runtime.set_delivery_error(None) {
        publish(app);
    }
}

#[cfg(test)]
mod sound_tests {
    use super::{update_appearance, valid_wav, write_custom_sound};
    use crate::domain::{Appearance, ColorTheme, Settings};

    #[test]
    fn independent_appearance_updates_preserve_other_preferences() {
        let mut settings = Settings::default();
        update_appearance(&mut settings, Some(Appearance::Dark), None);
        update_appearance(&mut settings, None, Some(ColorTheme::Cobalt));
        assert_eq!(settings.appearance, Appearance::Dark);
        assert_eq!(settings.color_theme, ColorTheme::Cobalt);
    }

    #[test]
    fn persists_custom_wav_without_overwriting_existing_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sounds/custom.wav");
        let bytes = &include_bytes!("../../public/sounds/back.wav")[..];
        write_custom_sound(&path, bytes).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert!(write_custom_sound(&path, bytes).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn validates_bundled_and_rejects_invalid_wav_files() {
        for bytes in [
            &include_bytes!("../../public/sounds/remove.wav")[..],
            &include_bytes!("../../public/sounds/announce.wav")[..],
            &include_bytes!("../../public/sounds/back.wav")[..],
        ] {
            assert!(valid_wav(bytes));
            assert!(!valid_wav(&bytes[..bytes.len() - 1]));
        }
        assert!(!valid_wav(b"RIFFxxxxWAVE"));
        assert!(!valid_wav(b"not a wav"));
    }
}
