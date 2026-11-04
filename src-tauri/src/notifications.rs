use crate::runtime::{AppRuntime, Snapshot};
use std::future::Future;

const DONE: &str = "sela.done";
const SNOOZE: &str = "sela.snooze";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReminderAction {
    Done,
    Snooze,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResponseAction {
    Reminder(ReminderAction),
    Open,
    Ignore,
}

fn response_action(identifier: &str) -> ResponseAction {
    match identifier {
        DONE => ResponseAction::Reminder(ReminderAction::Done),
        SNOOZE => ResponseAction::Reminder(ReminderAction::Snooze),
        // Dismissal and unknown identifiers are never evidence that the user
        // chose a mutating action. System actions are mapped by the crate.
        _ => ResponseAction::Ignore,
    }
}

#[derive(Debug)]
struct Request<'a> {
    title: &'a str,
    body: &'static str,
    sound_enabled: bool,
    occurrence: Option<(&'a str, u64, u64)>,
}

impl<'a> Request<'a> {
    fn from_snapshot(snapshot: &'a Snapshot) -> Result<Self, String> {
        if snapshot.preview {
            return Ok(Self {
                title: "Preview",
                body: "Your reminders can show up like this.",
                sound_enabled: snapshot.settings.sound_enabled,
                occurrence: None,
            });
        }
        let reminder = snapshot
            .reminders
            .iter()
            .find(|reminder| Some(&reminder.id) == snapshot.active_id.as_ref())
            .ok_or_else(|| "The reminder changed before the notification was ready.".to_owned())?;
        let due_at = reminder
            .snoozed_until
            .or(reminder.due_at)
            .ok_or_else(|| "The reminder no longer has a notification time.".to_owned())?;
        Ok(Self {
            title: &reminder.title,
            body: "You asked to be reminded.",
            sound_enabled: snapshot.settings.sound_enabled,
            occurrence: Some((&reminder.id, due_at, reminder.occurrence_revision)),
        })
    }
}

/// Advance the queue only after the submission future has acknowledged acceptance.
/// Acceptance is not proof of a visible banner: macOS still applies Focus and its
/// notification settings. Keeping this boundary independent of AppHandle also
/// lets the smoke harness simulate submission without contacting macOS.
pub async fn deliver(
    runtime: &AppRuntime,
    token: u64,
    submission: impl Future<Output = Result<(), String>>,
) -> bool {
    match submission.await {
        Ok(()) => {
            runtime.handoff_native_notification(token).await;
            true
        }
        Err(message) => {
            runtime.fail_active_delivery(token, message).await;
            false
        }
    }
}
/// Inspect authorization without prompting; the user may grant it when testing an alert.
#[cfg(target_os = "macos")]
pub async fn authorization_status() -> Result<&'static str, String> {
    use mac_usernotifications::{AuthorizationStatus, get_notification_settings};
    let settings = get_notification_settings().await.map_err(native_error)?;
    Ok(match settings.authorization_status {
        AuthorizationStatus::NotDetermined => "notDetermined",
        AuthorizationStatus::Authorized
        | AuthorizationStatus::Provisional
        | AuthorizationStatus::Ephemeral => "authorized",
        AuthorizationStatus::Denied => "denied",
        AuthorizationStatus::Unknown => "unknown",
    })
}

#[cfg(not(target_os = "macos"))]
pub async fn authorization_status() -> Result<&'static str, String> {
    Ok("unavailable")
}

#[cfg(target_os = "macos")]
pub async fn send(app: &tauri::AppHandle, snapshot: &Snapshot) -> Result<(), String> {
    use mac_usernotifications::{
        Action, AuthorizationStatus, Notification, get_notification_settings, request_auth,
    };

    let request = Request::from_snapshot(snapshot)?;
    // This is intentionally lazy: startup, unit tests and --smoke-test must not
    // initialize the OS notification center or ask for authorization.
    let settings = get_notification_settings().await.map_err(native_error)?;
    match settings.authorization_status {
        AuthorizationStatus::NotDetermined => {
            if !request_auth().await.map_err(native_error)? {
                return Err(permission_error());
            }
        }
        AuthorizationStatus::Authorized
        | AuthorizationStatus::Provisional
        | AuthorizationStatus::Ephemeral => {}
        AuthorizationStatus::Denied | AuthorizationStatus::Unknown => {
            return Err(permission_error());
        }
    }

    let mut notification = Notification::new()
        .title(request.title)
        .message(request.body)
        .action(Action::button(DONE, "Done"))
        .action(Action::button(SNOOZE, "5 more min"));
    if request.sound_enabled {
        notification = notification.default_sound();
    }
    let occurrence = request
        .occurrence
        .map(|(id, due_at, revision)| (id.to_owned(), due_at, revision));
    // mac-usernotifications 0.3.1 resolves send() from
    // addNotificationRequest:withCompletionHandler:, propagating rejection.
    // Its worker installs and retains one process-lifetime UN center delegate;
    // the returned handle retains response observation, not a blocking thread.
    let handle = notification.send().await.map_err(native_error)?;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match handle.response().await {
            Ok(response) => match if response.is_default_action() {
                ResponseAction::Open
            } else if response.is_dismiss_action() || response.is_timed_out() {
                ResponseAction::Ignore
            } else {
                response_action(&response.action_identifier)
            } {
                ResponseAction::Reminder(action) => {
                    if let Some((id, due_at, revision)) = occurrence {
                        crate::commands::handle_notification_action(
                            &app,
                            action,
                            &id,
                            Some(due_at),
                            Some(revision),
                        )
                        .await;
                    } else {
                        crate::windows::open_dashboard(&app);
                    }
                }
                ResponseAction::Open => crate::windows::open_dashboard(&app),
                ResponseAction::Ignore => {}
            },
            Err(error) => {
                log::error!("could not receive native notification response: {error}");
                use tauri::Manager;
                let runtime = app.state::<std::sync::Arc<AppRuntime>>();
                runtime.set_delivery_error(Some(
                    "macOS accepted the notification, but Sela couldn't receive its action. Open Activities to manage the reminder."
                        .to_owned(),
                ));
                crate::commands::publish(&app);
            }
        }
    });
    Ok(())
}

#[cfg(target_os = "macos")]
fn permission_error() -> String {
    "macOS notification permission is not granted. Allow Sela in System Settings → Notifications, or choose another alert style."
        .to_owned()
}

#[cfg(target_os = "macos")]
fn native_error(error: mac_usernotifications::Error) -> String {
    log::error!("native notification request failed: {error}");
    format!(
        "macOS couldn't accept the notification request: {error}. Check System Settings → Notifications, or choose another alert style."
    )
}

#[cfg(not(target_os = "macos"))]
pub async fn send(_app: &tauri::AppHandle, _snapshot: &Snapshot) -> Result<(), String> {
    Err("Native notifications are supported only on macOS. Choose another alert style.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{domain::Document, storage::AppStorage};

    fn runtime() -> (tempfile::TempDir, AppRuntime, String) {
        let directory = tempfile::tempdir().unwrap();
        let mut document = Document::default();
        let id = document.create("Take a break", Some(1_000), 100).unwrap();
        let runtime = AppRuntime::new(
            document,
            AppStorage::new(directory.path().join("sela.sqlite3")),
            None,
            false,
        );
        (directory, runtime, id)
    }

    #[test]
    fn only_explicit_native_action_identifiers_mutate_reminders() {
        assert_eq!(
            response_action(DONE),
            ResponseAction::Reminder(ReminderAction::Done)
        );
        assert_eq!(
            response_action(SNOOZE),
            ResponseAction::Reminder(ReminderAction::Snooze)
        );
        for neutral in [
            "Options",
            "Done",
            "done",
            "snooze",
            "",
            "default",
            "com.apple.UNNotificationDismissActionIdentifier",
            "unknown",
        ] {
            assert_eq!(
                response_action(neutral),
                ResponseAction::Ignore,
                "{neutral}"
            );
        }
    }

    #[tokio::test]
    async fn preview_has_no_mutating_occurrence_and_sound_tracks_settings() {
        let (_directory, runtime, _) = runtime();
        runtime.start_preview().await.unwrap();
        let mut snapshot = runtime.snapshot();
        snapshot.settings.sound_enabled = false;
        let request = Request::from_snapshot(&snapshot).unwrap();
        assert_eq!(request.title, "Preview");
        assert!(request.occurrence.is_none());
        assert!(!request.sound_enabled);
        snapshot.settings.sound_enabled = true;
        assert!(Request::from_snapshot(&snapshot).unwrap().sound_enabled);
    }

    #[tokio::test]
    async fn request_uses_snoozed_deadline_and_recorded_occurrence_not_original_due_time() {
        let (_directory, runtime, id) = runtime();
        runtime.reconcile_due(1_100).await;
        let mut snapshot = runtime.snapshot();
        snapshot.reminders[0].snoozed_until = Some(9_000);
        snapshot.reminders[0].occurrence_revision = 7;
        let request = Request::from_snapshot(&snapshot).unwrap();
        assert_eq!(request.occurrence, Some((id.as_str(), 9_000, 7)));
        snapshot.active_id = Some("no-longer-present".into());
        assert!(Request::from_snapshot(&snapshot).is_err());
    }

    #[tokio::test]
    async fn queue_waits_for_acknowledgment_and_rejection_remains_visible_and_pending() {
        let (_directory, runtime, id) = runtime();
        runtime.reconcile_due(1_100).await;
        let token = runtime.snapshot().alert_token;
        assert!(runtime.reserve_notification(token));
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let delivery = deliver(&runtime, token, async { receiver.await.unwrap() });
        tokio::pin!(delivery);
        // Poll the real queue boundary while the OS completion is still pending.
        let pending =
            std::future::poll_fn(|cx| std::task::Poll::Ready(delivery.as_mut().poll(cx))).await;
        assert!(matches!(pending, std::task::Poll::Pending));
        assert_eq!(runtime.snapshot().active_id.as_deref(), Some(id.as_str()));
        assert!(runtime.snapshot().delivery_error.is_none());
        sender
            .send(Err("The OS rejected this request".to_owned()))
            .unwrap();
        assert!(!delivery.await);
        let snapshot = runtime.snapshot();
        assert_eq!(
            snapshot.delivery_error.as_deref(),
            Some("The OS rejected this request")
        );
        assert_eq!(
            snapshot.reminders[0].status,
            crate::domain::ReminderStatus::Pending
        );
        assert!(snapshot.reminders[0].occurrence_history.is_empty());
    }

    #[tokio::test]
    async fn acknowledged_submission_hands_off_without_resolving_the_reminder() {
        let (_directory, runtime, _) = runtime();
        runtime.reconcile_due(1_100).await;
        let token = runtime.snapshot().alert_token;
        assert!(runtime.reserve_notification(token));
        assert!(deliver(&runtime, token, std::future::ready(Ok(()))).await);
        let snapshot = runtime.snapshot();
        assert!(snapshot.active_id.is_none());
        assert!(snapshot.delivery_error.is_none());
        assert_eq!(
            snapshot.reminders[0].status,
            crate::domain::ReminderStatus::Pending
        );
        assert!(snapshot.reminders[0].occurrence_history.is_empty());
    }

    #[tokio::test]
    async fn stale_submission_acknowledgment_cannot_clear_a_newer_preview_failure() {
        let (_directory, runtime, _) = runtime();
        runtime.start_preview().await.unwrap();
        let stale_token = runtime.snapshot().alert_token;
        assert!(runtime.reserve_notification(stale_token));
        runtime.start_preview().await.unwrap();
        let current_token = runtime.snapshot().alert_token;
        runtime
            .fail_active_delivery(current_token, "New preview was rejected".to_owned())
            .await;
        assert!(deliver(&runtime, stale_token, std::future::ready(Ok(()))).await);
        assert_eq!(
            runtime.snapshot().delivery_error.as_deref(),
            Some("New preview was rejected")
        );
    }
}
