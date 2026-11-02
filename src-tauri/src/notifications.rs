use crate::runtime::Snapshot;
use tauri::Emitter;
use tauri_plugin_notification::{Action, ActionType, NotificationExt};

const ACTION_TYPE: &str = "sela-reminder";

pub fn configure(app: &tauri::App) {
    let notifications = app.notification();
    if let Err(error) = notifications.register_action_types(vec![
        ActionType::builder(ACTION_TYPE)
            .actions(vec![
                Action::builder("done", "Done").build(),
                Action::builder("snooze", "5 more min").build(),
            ])
            .build(),
    ]) {
        log::error!("could not register notification actions: {error}");
    }

    let handle = app.handle().clone();
    if let Err(error) = notifications.on_action(move |performed| {
        let id = performed
            .notification()
            .and_then(|notification| notification.extra().get("id"))
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_owned();
        let due_at = performed
            .notification()
            .and_then(|notification| notification.extra().get("dueAt"))
            .and_then(|value| value.as_u64());
        let occurrence_revision = performed
            .notification()
            .and_then(|notification| notification.extra().get("occurrenceRevision"))
            .and_then(|value| value.as_u64());
        let action = performed.action_id().to_owned();
        let app = handle.clone();
        tauri::async_runtime::spawn(async move {
            crate::commands::handle_notification_action(
                &app,
                &action,
                &id,
                due_at,
                occurrence_revision,
            )
            .await;
        });
    }) {
        log::error!("could not register notification action handler: {error}");
    }
}

pub fn send(app: &tauri::AppHandle, snapshot: &Snapshot) -> Result<(), String> {
    let (title, body, id, due_at, occurrence_revision) = if snapshot.preview {
        (
            "Preview".to_owned(),
            "Your reminders can show up like this.".to_owned(),
            String::new(),
            None,
            None,
        )
    } else {
        let reminder = snapshot
            .reminders
            .iter()
            .find(|reminder| Some(&reminder.id) == snapshot.active_id.as_ref())
            .ok_or_else(|| "The reminder changed before the notification was ready.".to_owned())?;
        (
            reminder.title.clone(),
            "You asked to be reminded.".to_owned(),
            reminder.id.clone(),
            reminder.snoozed_until.or(reminder.due_at),
            Some(reminder.occurrence_revision),
        )
    };

    let mut notification = app.notification().builder().title(title).body(body);
    if snapshot.settings.sound_enabled {
        notification = notification.sound("default");
    }
    notification
        .action_type_id(ACTION_TYPE)
        .extra("id", id)
        .extra("dueAt", due_at)
        .extra("occurrenceRevision", occurrence_revision)
        .show()
        .map_err(|error| {
            log::error!("native notification failed: {error}");
            "macOS didn't show the notification. Check System Settings → Notifications, or choose another alert style."
                .to_owned()
        })?;
    let _ = app.emit("sela://notification-delivered", ());
    Ok(())
}
