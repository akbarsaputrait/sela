use crate::{
    domain::{Document, Reminder, ReminderStatus},
    storage::{AppStorage, unix_timestamp},
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, RwLock},
};
use tokio::sync::{Mutex, Notify};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub document_revision: u64,
    pub reminders: Vec<Reminder>,
    pub settings: crate::domain::Settings,
    pub active_id: Option<String>,
    pub alert_token: u64,
    pub preview: bool,
    pub storage_error: Option<String>,
    pub shortcut_error: Option<String>,
    pub delivery_error: Option<String>,
    pub app_version: &'static str,
    pub launch_at_login: bool,
}

#[derive(Debug, Default)]
pub struct DeliveryState {
    pub active_id: Option<String>,
    pub alert_token: u64,
    pub preview: bool,
    pub suppressed: HashSet<String>,
    pub failed_deliveries: HashSet<String>,
    pub next_delivery_at: u64,
    pub notified_token: u64,
    pub presented_token: u64,
    #[cfg(debug_assertions)]
    pub entrances: u32,
}

#[derive(Debug)]
pub struct RuntimeState {
    pub document: Document,
    pub document_revision: u64,
    pub revision: u64,
    pub delivery: DeliveryState,
    pub storage_error: Option<String>,
    pub shortcut_error: Option<String>,
    pub delivery_error: Option<String>,
    pub launch_at_login: bool,
    pub ready_windows: HashSet<String>,
    pub capture_requested: bool,
}

enum MutationGuard {
    Occurrence {
        id: String,
        occurrence_revision: u64,
    },
    Alert {
        id: String,
        token: u64,
    },
    Notification {
        id: String,
        due_at: u64,
        occurrence_revision: u64,
    },
}

pub struct AppRuntime {
    state: RwLock<RuntimeState>,
    /// Serializes every durable and alert-state transition. Never hold the RwLock across I/O.
    mutation_gate: Mutex<()>,
    scheduler_notify: Notify,
    storage: Arc<AppStorage>,
}

impl AppRuntime {
    pub fn new(
        document: Document,
        storage: AppStorage,
        storage_error: Option<String>,
        launch_at_login: bool,
    ) -> Self {
        Self {
            state: RwLock::new(RuntimeState {
                document,
                document_revision: 0,
                revision: 0,
                delivery: DeliveryState::default(),
                storage_error,
                shortcut_error: None,
                delivery_error: None,
                launch_at_login,
                ready_windows: HashSet::new(),
                capture_requested: false,
            }),
            mutation_gate: Mutex::new(()),
            scheduler_notify: Notify::new(),
            storage: Arc::new(storage),
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        self.snapshot_for("main")
    }

    /// Auxiliary webviews receive only the reminder rows their surface needs.
    pub fn snapshot_for(&self, window: &str) -> Snapshot {
        let state = self
            .state
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let reminders = match window {
            "main" => state.document.reminders.clone(),
            "alert" => state
                .delivery
                .active_id
                .as_ref()
                .and_then(|id| {
                    state
                        .document
                        .reminders
                        .iter()
                        .find(|reminder| &reminder.id == id)
                })
                .cloned()
                .into_iter()
                .collect(),
            _ => Vec::new(),
        };
        Snapshot {
            revision: state.revision,
            document_revision: state.document_revision,
            reminders,
            settings: state.document.settings.clone(),
            active_id: state.delivery.active_id.clone(),
            alert_token: state.delivery.alert_token,
            preview: state.delivery.preview,
            storage_error: state.storage_error.clone(),
            shortcut_error: state.shortcut_error.clone(),
            delivery_error: state.delivery_error.clone(),
            app_version: env!("CARGO_PKG_VERSION"),
            launch_at_login: state.launch_at_login,
        }
    }

    pub async fn mutate_document<T, F>(&self, transition: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&mut Document) -> Result<T, String> + Send + 'static,
    {
        self.mutate_with_guard(None, transition).await
    }

    pub async fn mutate_occurrence_reminder<T, F>(
        &self,
        id: String,
        occurrence_revision: u64,
        transition: F,
    ) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&mut Document) -> Result<T, String> + Send + 'static,
    {
        self.mutate_with_guard(
            Some(MutationGuard::Occurrence {
                id,
                occurrence_revision,
            }),
            transition,
        )
        .await
    }

    pub async fn mutate_alert_reminder<T, F>(
        &self,
        id: String,
        expected_token: u64,
        transition: F,
    ) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&mut Document) -> Result<T, String> + Send + 'static,
    {
        self.mutate_with_guard(
            Some(MutationGuard::Alert {
                id,
                token: expected_token,
            }),
            transition,
        )
        .await
    }

    pub async fn mutate_notification_reminder<T, F>(
        &self,
        id: String,
        expected_due_at: u64,
        expected_occurrence_revision: u64,
        transition: F,
    ) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&mut Document) -> Result<T, String> + Send + 'static,
    {
        self.mutate_with_guard(
            Some(MutationGuard::Notification {
                id,
                due_at: expected_due_at,
                occurrence_revision: expected_occurrence_revision,
            }),
            transition,
        )
        .await
    }

    async fn mutate_with_guard<T, F>(
        &self,
        guard: Option<MutationGuard>,
        transition: F,
    ) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&mut Document) -> Result<T, String> + Send + 'static,
    {
        let _gate = self.mutation_gate.lock().await;
        let (before, mut next, base_revision, blocked) = {
            let state = self
                .state
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            validate_mutation_guard(&state, guard.as_ref())?;
            let before = state.document.clone();
            (
                before.clone(),
                before,
                state.document_revision,
                state.storage_error.clone(),
            )
        };
        if let Some(error) = blocked {
            return Err(error);
        }
        let result = transition(&mut next)?;
        next = next
            .normalize_and_validate()
            .map_err(|error| error.to_string())?;
        let changed_ids = changed_reminder_ids(&before, &next);
        let storage = Arc::clone(&self.storage);
        let persisted = next.clone();
        tauri::async_runtime::spawn_blocking(move || storage.save_transition(&before, &persisted))
            .await
            .map_err(|error| {
                log::error!("storage worker failed: {error}");
                "That didn't save. Your reminders are unchanged. Please try again.".to_string()
            })?
            .map_err(|error| error.to_string())?;

        let mut state = self
            .state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.document_revision != base_revision
            || validate_mutation_guard(&state, guard.as_ref()).is_err()
        {
            log::error!("state changed during a serialized document transition");
            return Err("Something changed while saving. Please try again.".into());
        }
        state.document = next;
        state.document_revision += 1;
        let had_failed_deliveries = !state.delivery.failed_deliveries.is_empty();
        for id in changed_ids {
            state.delivery.suppressed.remove(&id);
            state.delivery.failed_deliveries.remove(&id);
            if state.delivery.active_id.as_deref() == Some(&id) {
                state.delivery.active_id = None;
                state.delivery.alert_token += 1;
            }
        }
        if had_failed_deliveries && state.delivery.failed_deliveries.is_empty() {
            state.delivery_error = None;
        }
        state.revision += 1;
        drop(state);
        self.scheduler_notify.notify_one();
        Ok(result)
    }

    pub async fn reconcile_due(&self, now: u64) -> bool {
        let _gate = self.mutation_gate.lock().await;
        let mut state = self
            .state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.storage_error.is_some()
            || state.delivery.active_id.is_some()
            || state.delivery.next_delivery_at > now
        {
            return false;
        }
        let excluded = state
            .delivery
            .suppressed
            .union(&state.delivery.failed_deliveries)
            .cloned()
            .collect::<HashSet<_>>();
        let Some(id) = state
            .document
            .pending_due_ids(now, &excluded)
            .into_iter()
            .next()
        else {
            return false;
        };
        // A real reminder must not be held behind an unattended preview.
        state.delivery.preview = false;
        state.delivery.active_id = Some(id);
        state.delivery.alert_token += 1;
        state.revision += 1;
        true
    }

    pub async fn dismiss_alert(&self, expected_token: u64) -> Result<(), String> {
        let _gate = self.mutation_gate.lock().await;
        let mut state = self
            .state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.delivery.alert_token != expected_token {
            return Err("That reminder just changed. Here’s the latest.".into());
        }
        state.delivery.preview = false;
        if let Some(id) = state.delivery.active_id.take() {
            state.delivery.suppressed.insert(id);
        }
        state.delivery.alert_token += 1;
        state.revision += 1;
        drop(state);
        self.scheduler_notify.notify_one();
        Ok(())
    }

    pub async fn start_preview(&self) -> Result<(), String> {
        let _gate = self.mutation_gate.lock().await;
        let mut state = self
            .state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.delivery.active_id.is_some() {
            return Err("Handle the reminder on screen first, then try the preview.".into());
        }
        state.delivery.preview = true;
        state.delivery.alert_token += 1;
        state.revision += 1;
        drop(state);
        self.scheduler_notify.notify_one();
        Ok(())
    }

    /// Reserve before calling Notification Center so repeated presentation requests cannot duplicate a banner.
    pub fn reserve_notification(&self, token: u64) -> bool {
        let mut state = self
            .state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.delivery.notified_token == token {
            return false;
        }
        state.delivery.notified_token = token;
        true
    }

    pub async fn handoff_native_notification(&self, token: u64, now: u64) {
        let _gate = self.mutation_gate.lock().await;
        let mut state = self
            .state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.delivery.alert_token != token {
            return;
        }
        state.delivery.preview = false;
        if let Some(id) = state.delivery.active_id.take() {
            state.delivery.suppressed.insert(id);
        }
        state.delivery.next_delivery_at = now.saturating_add(5_000);
        state.delivery.alert_token += 1;
        state.revision += 1;
        drop(state);
        self.scheduler_notify.notify_one();
    }

    /// Failed delivery never pins the queue forever: keep the item due and continue after a brief pause.
    pub async fn fail_active_delivery(&self, token: u64, message: String, now: u64) {
        let _gate = self.mutation_gate.lock().await;
        let mut state = self
            .state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.delivery.alert_token != token {
            return;
        }
        state.delivery_error = Some(message);
        state.delivery.preview = false;
        if let Some(id) = state.delivery.active_id.take() {
            state.delivery.suppressed.insert(id.clone());
            state.delivery.failed_deliveries.insert(id);
        }
        state.delivery.next_delivery_at = now.saturating_add(3_000);
        state.delivery.alert_token += 1;
        state.revision += 1;
        drop(state);
        self.scheduler_notify.notify_one();
    }

    pub async fn retry_failed_deliveries(&self, now: u64) {
        let _gate = self.mutation_gate.lock().await;
        let mut state = self
            .state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for id in std::mem::take(&mut state.delivery.failed_deliveries) {
            state.delivery.suppressed.remove(&id);
        }
        state.delivery.next_delivery_at = now;
        state.delivery_error = None;
        state.revision += 1;
        drop(state);
        self.scheduler_notify.notify_one();
    }

    pub async fn set_launch_at_login(&self, enabled: bool) {
        let _gate = self.mutation_gate.lock().await;
        let mut state = self
            .state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.launch_at_login = enabled;
        state.revision += 1;
    }

    pub fn set_shortcut_error(&self, error: Option<String>) {
        let mut state = self
            .state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.shortcut_error = error;
        state.revision += 1;
    }

    pub fn set_delivery_error(&self, error: Option<String>) -> bool {
        let mut state = self
            .state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if error.is_none() && !state.delivery.failed_deliveries.is_empty() {
            return false;
        }
        if state.delivery_error != error {
            state.delivery_error = error;
            state.revision += 1;
            true
        } else {
            false
        }
    }

    /// Recheck at least every 30 seconds for wall-clock changes while sleeping between deadlines.
    pub fn next_scheduler_delay(&self, now: u64) -> std::time::Duration {
        const MAX_RECHECK_MS: u64 = 30_000;
        let state = self
            .state
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.delivery.active_id.is_some() {
            return std::time::Duration::from_millis(MAX_RECHECK_MS);
        }
        if state.delivery.next_delivery_at > now {
            return std::time::Duration::from_millis(
                (state.delivery.next_delivery_at - now).min(MAX_RECHECK_MS),
            );
        }
        let next_due = state
            .document
            .reminders
            .iter()
            .filter(|reminder| reminder.status == crate::domain::ReminderStatus::Pending)
            .filter_map(|reminder| {
                reminder
                    .snoozed_until
                    .or(reminder.due_at)
                    .map(|due| (reminder, due))
            })
            .filter(|(reminder, due)| {
                *due > now
                    && !state.delivery.suppressed.contains(&reminder.id)
                    && !state.delivery.failed_deliveries.contains(&reminder.id)
            })
            .map(|(_, due)| due)
            .min();
        std::time::Duration::from_millis(
            next_due
                .map_or(MAX_RECHECK_MS, |due| (due - now).min(MAX_RECHECK_MS))
                .max(1),
        )
    }

    pub async fn wait_for_scheduler_or_timeout(&self, delay: std::time::Duration) {
        tokio::select! {
            _ = self.scheduler_notify.notified() => {},
            _ = tokio::time::sleep(delay) => {},
        }
    }

    #[cfg(debug_assertions)]
    pub fn document(&self) -> Document {
        self.state
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .document
            .clone()
    }

    #[cfg(debug_assertions)]
    #[cfg(debug_assertions)]
    pub fn database_path(&self) -> std::path::PathBuf {
        self.storage.path().to_path_buf()
    }

    pub fn mark_window_ready(&self, label: &str) -> bool {
        let mut state = self
            .state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.ready_windows.insert(label.to_owned());
        if label == "capture" {
            std::mem::take(&mut state.capture_requested)
        } else {
            false
        }
    }

    pub fn is_window_ready(&self, label: &str) -> bool {
        self.state
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .ready_windows
            .contains(label)
    }

    pub fn request_capture(&self) -> bool {
        let mut state = self
            .state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.ready_windows.contains("capture") {
            true
        } else {
            state.capture_requested = true;
            false
        }
    }

    #[cfg(debug_assertions)]
    pub fn ready_window_count(&self) -> usize {
        self.state
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .ready_windows
            .len()
    }

    pub fn needs_alert_entrance(&self, token: u64) -> bool {
        self.state
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .delivery
            .presented_token
            != token
    }

    pub fn record_alert_presented(&self, token: u64) {
        let mut state = self
            .state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.delivery.presented_token != token {
            state.delivery.presented_token = token;
            #[cfg(debug_assertions)]
            {
                state.delivery.entrances += 1;
            }
        }
    }

    #[cfg(debug_assertions)]
    pub fn entrances(&self) -> u32 {
        self.state
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .delivery
            .entrances
    }
}

fn changed_reminder_ids(before: &Document, after: &Document) -> HashSet<String> {
    let after_by_id = after
        .reminders
        .iter()
        .map(|reminder| (reminder.id.as_str(), reminder))
        .collect::<HashMap<_, _>>();

    before
        .reminders
        .iter()
        .filter(|reminder| after_by_id.get(reminder.id.as_str()).copied() != Some(*reminder))
        .map(|reminder| reminder.id.clone())
        .collect()
}

fn validate_mutation_guard(
    state: &RuntimeState,
    guard: Option<&MutationGuard>,
) -> Result<(), String> {
    match guard {
        None => Ok(()),
        Some(MutationGuard::Occurrence {
            id,
            occurrence_revision,
        }) if state.document.reminders.iter().any(|reminder| {
            reminder.id == *id
                && reminder.status == ReminderStatus::Pending
                && reminder.occurrence_revision == *occurrence_revision
        }) =>
        {
            Ok(())
        }
        Some(MutationGuard::Alert { id, token })
            if state.delivery.alert_token == *token
                && state.delivery.active_id.as_deref() == Some(id.as_str()) =>
        {
            Ok(())
        }
        Some(MutationGuard::Notification {
            id,
            due_at,
            occurrence_revision,
        }) if *due_at <= unix_timestamp()
            && state.document.reminders.iter().any(|reminder| {
                reminder.id == *id
                    && reminder.status == ReminderStatus::Pending
                    && reminder.snoozed_until.or(reminder.due_at) == Some(*due_at)
                    && reminder.occurrence_revision == *occurrence_revision
            }) =>
        {
            Ok(())
        }
        _ => Err("That reminder just changed. Here’s the latest.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{domain::ReminderStatus, storage::unix_timestamp};

    #[test]
    fn changed_reminder_ids_include_modified_and_removed_rows_only() {
        let mut before = Document::default();
        let first = before.create("first", None, 100).unwrap();
        let second = before.create("second", None, 100).unwrap();
        let mut after = before.clone();
        after.reminders[0].title = "updated".into();
        after.reminders.retain(|reminder| reminder.id != second);
        after.create("new", None, 100).unwrap();

        assert_eq!(
            changed_reminder_ids(&before, &after),
            HashSet::from([first, second])
        );
    }

    #[tokio::test]
    async fn auxiliary_snapshots_do_not_copy_the_dashboard_activity_list() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        let mut document = Document::default();
        let id = document.create("active", Some(1_000), 100).unwrap();
        document.create("untimed", None, 100).unwrap();
        let runtime = AppRuntime::new(document, storage, None, false);
        assert!(runtime.snapshot_for("capture").reminders.is_empty());
        assert!(runtime.reconcile_due(1_100).await);
        let alert = runtime.snapshot_for("alert");
        assert_eq!(alert.reminders.len(), 1);
        assert_eq!(alert.reminders[0].id, id);
        assert_eq!(runtime.snapshot_for("main").reminders.len(), 2);
    }

    #[tokio::test]
    async fn scheduler_sleeps_until_the_next_deadline_and_caps_clock_change_rechecks() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        let mut document = Document::default();
        document.create("soon", Some(5_000), 100).unwrap();
        document.create("later", Some(3_600_000), 100).unwrap();
        let runtime = AppRuntime::new(document, storage, None, false);
        assert_eq!(
            runtime.next_scheduler_delay(100),
            std::time::Duration::from_secs(5)
        );
        runtime.start_preview().await.unwrap();
        assert_eq!(
            runtime.next_scheduler_delay(100),
            std::time::Duration::from_secs(5)
        );
        runtime
            .dismiss_alert(runtime.snapshot().alert_token)
            .await
            .unwrap();
        assert_eq!(
            runtime.next_scheduler_delay(100),
            std::time::Duration::from_secs(5)
        );
        assert_eq!(
            runtime.next_scheduler_delay(5_000),
            std::time::Duration::from_millis(100)
        );
        assert_eq!(
            runtime.next_scheduler_delay(5_100),
            std::time::Duration::from_secs(30)
        );
    }

    #[tokio::test]
    async fn due_reminder_preempts_preview_and_rejects_stale_preview_action() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        let mut document = Document::default();
        let id = document.create("important", Some(1_000), 100).unwrap();
        let runtime = AppRuntime::new(document, storage, None, false);
        runtime.start_preview().await.unwrap();
        let preview_token = runtime.snapshot().alert_token;
        assert!(runtime.reconcile_due(1_100).await);
        let current = runtime.snapshot();
        assert!(!current.preview);
        assert_eq!(current.active_id.as_deref(), Some(id.as_str()));
        assert!(runtime.dismiss_alert(preview_token).await.is_err());
        assert_eq!(runtime.snapshot().active_id.as_deref(), Some(id.as_str()));
    }

    #[tokio::test]
    async fn simultaneous_overdue_reminders_remain_actionable_after_restart() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sela.sqlite3");
        let storage = AppStorage::new(path.clone());
        let empty = storage.load_or_migrate(&[], 100).unwrap();
        let mut document = empty.clone();
        let first = document.create("first", Some(1_000), 100).unwrap();
        let second = document.create("second", Some(1_000), 200).unwrap();
        storage.save_transition(&empty, &document).unwrap();
        let runtime = AppRuntime::new(document, storage, None, false);
        assert!(runtime.reconcile_due(2_000).await);
        assert_eq!(
            runtime.snapshot().active_id.as_deref(),
            Some(first.as_str())
        );
        drop(runtime);

        let storage = AppStorage::new(path);
        let loaded = storage.load_or_migrate(&[], 2_000).unwrap();
        let runtime = AppRuntime::new(loaded, storage, None, false);
        assert!(runtime.reconcile_due(2_000).await);
        let token = runtime.snapshot().alert_token;
        let first_for_transition = first.clone();
        runtime
            .mutate_alert_reminder(first, token, move |document| {
                document
                    .resolve(&first_for_transition, ReminderStatus::Completed, 2_000)
                    .map_err(|error| error.to_string())
            })
            .await
            .unwrap();
        assert!(runtime.reconcile_due(2_000).await);
        assert_eq!(
            runtime.snapshot().active_id.as_deref(),
            Some(second.as_str())
        );
        assert_eq!(
            runtime
                .snapshot()
                .reminders
                .iter()
                .find(|item| item.id == second)
                .unwrap()
                .status,
            ReminderStatus::Pending
        );
    }

    #[tokio::test]
    async fn failed_persistence_never_commits_memory() {
        let directory = tempfile::tempdir().unwrap();
        let blocked_parent = directory.path().join("not-a-directory");
        std::fs::write(&blocked_parent, "blocked").unwrap();
        let storage = AppStorage::new(blocked_parent.join("sela.sqlite3"));
        let runtime = AppRuntime::new(Document::default(), storage, None, false);
        assert!(
            runtime
                .mutate_document(|document| document
                    .create("not saved", None, unix_timestamp())
                    .map(|_| ())
                    .map_err(|error| error.to_string()))
                .await
                .is_err()
        );
        assert!(runtime.snapshot().reminders.is_empty());
    }

    #[tokio::test]
    async fn failed_delivery_does_not_stall_queue_and_can_retry_after_style_change() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        let mut document = Document::default();
        let first = document.create("first", Some(1_000), 100).unwrap();
        let second = document.create("second", Some(2_000), 100).unwrap();
        let runtime = AppRuntime::new(document, storage, None, false);
        assert!(runtime.reconcile_due(2_100).await);
        assert_eq!(
            runtime.snapshot().active_id.as_deref(),
            Some(first.as_str())
        );
        let token = runtime.snapshot().alert_token;
        runtime
            .fail_active_delivery(token, "banner unavailable".into(), 2_100)
            .await;
        assert!(!runtime.reconcile_due(2_101).await);
        assert!(runtime.reconcile_due(5_101).await);
        assert_eq!(
            runtime.snapshot().active_id.as_deref(),
            Some(second.as_str())
        );
        assert!(!runtime.set_delivery_error(None));
        assert_eq!(
            runtime.snapshot().delivery_error.as_deref(),
            Some("banner unavailable")
        );
        let snapshot = runtime.snapshot();
        runtime.dismiss_alert(snapshot.alert_token).await.unwrap();
        runtime.retry_failed_deliveries(5_102).await;
        assert!(runtime.snapshot().delivery_error.is_none());
        assert!(runtime.reconcile_due(5_102).await);
        assert_eq!(
            runtime.snapshot().active_id.as_deref(),
            Some(first.as_str())
        );
    }

    #[tokio::test]
    async fn stale_alert_action_cannot_resolve_a_replacement_reminder() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        let mut document = Document::default();
        let first = document.create("first", Some(1_000), 100).unwrap();
        let second = document.create("second", Some(2_000), 100).unwrap();
        let runtime = AppRuntime::new(document, storage, None, false);
        assert!(runtime.reconcile_due(2_100).await);
        let token = runtime.snapshot().alert_token;
        runtime.dismiss_alert(token).await.unwrap();
        assert!(runtime.reconcile_due(2_100).await);
        assert_eq!(
            runtime.snapshot().active_id.as_deref(),
            Some(second.as_str())
        );
        let transition_id = first.clone();
        let stale = runtime
            .mutate_alert_reminder(first.clone(), token, move |document| {
                document
                    .resolve(&transition_id, ReminderStatus::Completed, 2_200)
                    .map_err(|error| error.to_string())
            })
            .await;
        assert!(stale.is_err());
        assert_eq!(
            runtime.snapshot().active_id.as_deref(),
            Some(second.as_str())
        );
        assert!(
            runtime
                .snapshot()
                .reminders
                .iter()
                .all(|reminder| reminder.id != first || reminder.status == ReminderStatus::Pending)
        );
    }

    #[tokio::test]
    async fn delayed_native_notification_actions_cannot_change_a_rescheduled_reminder() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        let mut document = Document::default();
        let id = document.create("Call Sam", Some(1_000), 100).unwrap();
        let runtime = AppRuntime::new(document, storage, None, false);
        runtime
            .mutate_document({
                let id = id.clone();
                move |document| {
                    document
                        .reschedule(&id, 5_000, 1_100)
                        .map_err(|error| error.to_string())
                }
            })
            .await
            .unwrap();
        let id_for_old_notification = id.clone();
        let stale = runtime
            .mutate_notification_reminder(id, 1_100, 0, move |document| {
                document
                    .resolve(&id_for_old_notification, ReminderStatus::Completed, 2_000)
                    .map_err(|error| error.to_string())
            })
            .await;
        assert!(stale.is_err());
        let reminder = &runtime.snapshot().reminders[0];
        assert_eq!(reminder.status, ReminderStatus::Pending);
        assert_eq!(reminder.due_at, Some(6_100));
    }

    #[tokio::test]
    async fn native_action_rejects_old_revision_even_when_deadline_is_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        let mut document = Document::default();
        let id = document.create("Call Sam", Some(1_000), 100).unwrap();
        let runtime = AppRuntime::new(document, storage, None, false);
        let snoozed_id = id.clone();
        runtime
            .mutate_document(move |document| {
                document
                    .snooze(&snoozed_id, 1_000, 100)
                    .map_err(|error| error.to_string())
            })
            .await
            .unwrap();
        let action_id = id.clone();
        let stale = runtime
            .mutate_notification_reminder(id, 1_100, 0, move |document| {
                document
                    .resolve(&action_id, ReminderStatus::Completed, 2_000)
                    .map_err(|error| error.to_string())
            })
            .await;
        assert!(stale.is_err());
        assert_eq!(
            runtime.snapshot().reminders[0].status,
            ReminderStatus::Pending
        );
    }

    #[tokio::test]
    async fn an_old_native_notification_cannot_mutate_a_rescheduled_reminder() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        let mut document = Document::default();
        let id = document.create("Call Sam", Some(1_000), 100).unwrap();
        let runtime = AppRuntime::new(document, storage, None, false);
        let transition_id = id.clone();
        runtime
            .mutate_document(move |document| {
                document
                    .reschedule(&transition_id, 5_000, 2_000)
                    .map_err(|error| error.to_string())
            })
            .await
            .unwrap();
        let action_id = id.clone();
        let stale = runtime
            .mutate_notification_reminder(id, 1_100, 0, move |document| {
                document
                    .resolve(&action_id, ReminderStatus::Completed, 3_000)
                    .map_err(|error| error.to_string())
            })
            .await;
        assert!(stale.is_err());
        let reminder = &runtime.snapshot().reminders[0];
        assert_eq!(reminder.status, ReminderStatus::Pending);
        assert_eq!(reminder.due_at, Some(7_000));
    }

    #[tokio::test]
    async fn dashboard_duplicate_and_same_deadline_stale_actions_are_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        let schedule = serde_json::from_str(r#"{"kind":"daily","date":"2025-01-01","time":"09:00","weekdays":[],"dates":[],"endDate":null,"timeZone":"UTC"}"#).unwrap();
        let mut document = Document::default();
        let id = document
            .create_scheduled("daily", schedule, 1_735_689_600_000)
            .unwrap();
        let due = document.reminders[0].due_at.unwrap();
        let runtime = AppRuntime::new(document, storage, None, false);
        let action = |id: String, now| {
            move |document: &mut Document| {
                document
                    .resolve(&id, ReminderStatus::Completed, now)
                    .map_err(|error| error.to_string())
            }
        };
        runtime
            .mutate_occurrence_reminder(id.clone(), 0, action(id.clone(), due))
            .await
            .unwrap();
        let advanced = runtime.snapshot().reminders[0].clone();
        assert_eq!(advanced.occurrence_revision, 1);
        assert!(
            runtime
                .mutate_occurrence_reminder(id.clone(), 0, action(id.clone(), due))
                .await
                .is_err()
        );
        assert_eq!(runtime.snapshot().reminders[0], advanced);

        // Change the current occurrence without changing its effective deadline.
        let next_due = advanced.due_at.unwrap();
        let snoozed_id = id.clone();
        runtime
            .mutate_document(move |document| {
                document
                    .snooze(&snoozed_id, 1_000, next_due - 1_000)
                    .map_err(|error| error.to_string())
            })
            .await
            .unwrap();
        let same_due = runtime.snapshot().reminders[0].clone();
        assert_eq!(same_due.snoozed_until.or(same_due.due_at), Some(next_due));
        assert_ne!(same_due.occurrence_revision, advanced.occurrence_revision);
        assert!(
            runtime
                .mutate_occurrence_reminder(
                    id.clone(),
                    advanced.occurrence_revision,
                    action(id, next_due)
                )
                .await
                .is_err()
        );
        assert_eq!(runtime.snapshot().reminders[0], same_due);
    }

    #[tokio::test]
    async fn document_mutations_increment_revision_and_persist() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sela.sqlite3");
        let storage = AppStorage::new(path.clone());
        let runtime = AppRuntime::new(Document::default(), storage, None, false);
        let id = runtime
            .mutate_document(|document| {
                document
                    .create("persist", None, 100)
                    .map_err(|error| error.to_string())
            })
            .await
            .unwrap();
        runtime
            .mutate_document({
                let id = id.clone();
                move |document| {
                    document
                        .resolve(&id, ReminderStatus::Completed, 200)
                        .map_err(|error| error.to_string())
                }
            })
            .await
            .unwrap();
        let loaded = AppStorage::new(path).load_or_migrate(&[], 300).unwrap();
        assert_eq!(loaded.reminders[0].resolved_at, Some(200));
        assert!(runtime.snapshot().revision >= 2);
    }
}
