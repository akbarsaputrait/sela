use crate::scheduling::Schedule;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

pub const SCHEMA_VERSION: u32 = 3;
pub const MAX_DURATION_MS: u64 = 30 * 24 * 60 * 60 * 1000;
pub const MAX_TITLE_CHARS: usize = 240;
pub const MAX_REMINDERS: usize = 10_000;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReminderStatus {
    Pending,
    Completed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    pub title: String,
    pub created_at: u64,
    pub due_at: Option<u64>,
    pub status: ReminderStatus,
    #[serde(default)]
    pub resolved_at: Option<u64>,
    /// Stable mapping slot reserved for the optional Apple Reminders integration.
    #[serde(default)]
    pub apple_reminder_id: Option<String>,
    #[serde(default)]
    pub schedule: Option<Schedule>,
    #[serde(default)]
    pub snoozed_until: Option<u64>,
    #[serde(default)]
    pub occurrence_revision: u64,
    #[serde(default)]
    pub occurrence_history: Vec<u64>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AlertStyle {
    #[default]
    Fullscreen,
    Notch,
    Native,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ColorTheme {
    #[default]
    Monochrome,
    Vermilion,
    Cobalt,
    Brass,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SoundChoice {
    #[default]
    Tone,
    Remove,
    Announce,
    Back,
    Custom,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub alert_style: AlertStyle,
    #[serde(default)]
    pub appearance: Appearance,
    #[serde(default)]
    pub color_theme: ColorTheme,
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default = "default_sound_enabled")]
    pub sound_enabled: bool,
    #[serde(default)]
    pub sound_choice: SoundChoice,
    #[serde(default)]
    pub custom_sound_id: Option<String>,
    #[serde(default = "default_snooze_minutes")]
    pub default_snooze_minutes: u8,
}

fn default_sound_enabled() -> bool {
    true
}
fn default_snooze_minutes() -> u8 {
    5
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            alert_style: AlertStyle::default(),
            appearance: Appearance::default(),
            color_theme: ColorTheme::default(),
            onboarding_completed: false,
            sound_enabled: true,
            sound_choice: SoundChoice::default(),
            custom_sound_id: None,
            default_snooze_minutes: 5,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MigrationMetadata {
    pub source: String,
    pub completed_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub version: u32,
    #[serde(default)]
    pub reminders: Vec<Reminder>,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub migration: Option<MigrationMetadata>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            reminders: Vec::new(),
            settings: Settings::default(),
            migration: None,
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DomainError {
    #[error("Type something to remember, or pick a timer.")]
    EmptyReminder,
    #[error("Keep your reminder within {MAX_TITLE_CHARS} characters.")]
    TitleTooLong,
    #[error("Choose a timer between 1 second and 30 days.")]
    InvalidDuration,
    #[error("That reminder is already finished.")]
    ReminderUnavailable,
    #[error("Too many reminders are stored. Remove some old reminders before adding another.")]
    CapacityReached,
    #[error("Your saved reminders contain invalid data. Nothing was changed.")]
    InvalidDocument,
    #[error("This data was created by a newer version of Sela.")]
    UnsupportedVersion,
    #[error("Please check the schedule: {0}.")]
    InvalidSchedule(String),
}

impl Document {
    pub fn normalize_and_validate(mut self) -> Result<Self, DomainError> {
        if self.version > SCHEMA_VERSION {
            return Err(DomainError::UnsupportedVersion);
        }
        if self
            .settings
            .custom_sound_id
            .as_ref()
            .is_some_and(|id| Uuid::parse_str(id).is_err())
            || (self.settings.sound_choice == SoundChoice::Custom
                && self.settings.custom_sound_id.is_none())
        {
            return Err(DomainError::InvalidDocument);
        }
        if !matches!(self.settings.default_snooze_minutes, 5 | 10 | 15 | 30) {
            return Err(DomainError::InvalidDocument);
        }
        if self.reminders.len() > MAX_REMINDERS {
            return Err(DomainError::InvalidDocument);
        }

        let mut ids = HashSet::with_capacity(self.reminders.len());
        let mut apple_ids = HashSet::new();
        for reminder in &mut self.reminders {
            reminder.title = reminder.title.trim().to_owned();
            if reminder.id.is_empty()
                || !ids.insert(reminder.id.clone())
                || reminder.title.is_empty()
                || reminder.title.chars().count() > MAX_TITLE_CHARS
                || reminder.created_at == 0
                || reminder.created_at > i64::MAX as u64
                || reminder
                    .due_at
                    .is_some_and(|timestamp| timestamp > i64::MAX as u64)
                || reminder
                    .snoozed_until
                    .is_some_and(|timestamp| timestamp > i64::MAX as u64)
                || reminder.occurrence_revision > i64::MAX as u64
                || reminder
                    .occurrence_history
                    .iter()
                    .any(|timestamp| *timestamp > i64::MAX as u64)
                || reminder
                    .resolved_at
                    .is_some_and(|timestamp| timestamp > i64::MAX as u64)
                || reminder
                    .apple_reminder_id
                    .as_ref()
                    .is_some_and(|id| id.is_empty() || !apple_ids.insert(id.clone()))
            {
                return Err(DomainError::InvalidDocument);
            }
            if let Some(schedule) = reminder.schedule.take() {
                reminder.schedule = Some(
                    schedule
                        .normalize_and_validate(0)
                        .map_err(|_| DomainError::InvalidDocument)?,
                );
            }
            if reminder.status == ReminderStatus::Pending {
                reminder.resolved_at = None;
            } else if reminder.resolved_at.is_none() {
                // Legacy data had no resolution timestamp. Creation time is explicit and stable.
                reminder.resolved_at = Some(reminder.created_at);
            }
        }
        self.version = SCHEMA_VERSION;
        Ok(self)
    }

    pub fn create(
        &mut self,
        title: &str,
        duration_ms: Option<u64>,
        now: u64,
    ) -> Result<String, DomainError> {
        if self.reminders.len() >= MAX_REMINDERS {
            return Err(DomainError::CapacityReached);
        }
        let due_at = duration_ms
            .map(|duration| deadline(now, duration))
            .transpose()?;
        let title = title.trim();
        if title.is_empty() && due_at.is_none() {
            return Err(DomainError::EmptyReminder);
        }
        if title.chars().count() > MAX_TITLE_CHARS {
            return Err(DomainError::TitleTooLong);
        }
        let id = Uuid::new_v4().to_string();
        self.reminders.push(Reminder {
            id: id.clone(),
            title: if title.is_empty() {
                "Timer".into()
            } else {
                title.into()
            },
            created_at: now,
            due_at,
            status: ReminderStatus::Pending,
            resolved_at: None,
            apple_reminder_id: None,
            schedule: None,
            snoozed_until: None,
            occurrence_revision: 0,
            occurrence_history: Vec::new(),
        });
        Ok(id)
    }

    pub fn create_scheduled(
        &mut self,
        title: &str,
        schedule: Schedule,
        now: u64,
    ) -> Result<String, DomainError> {
        let schedule = schedule
            .normalize_and_validate(now)
            .map_err(DomainError::InvalidSchedule)?;
        let due_at = schedule
            .next_after(now)
            .map_err(DomainError::InvalidSchedule)?
            .ok_or_else(|| {
                DomainError::InvalidSchedule("Schedule has no future occurrence.".into())
            })?;
        if due_at > i64::MAX as u64 {
            return Err(DomainError::InvalidDocument);
        }
        let id = self.create(title, None, now)?;
        let reminder = self.pending_mut(&id)?;
        reminder.schedule = Some(schedule);
        reminder.due_at = Some(due_at);
        Ok(id)
    }

    pub fn rename(&mut self, id: &str, title: &str) -> Result<(), DomainError> {
        let title = title.trim();
        if title.is_empty() {
            return Err(DomainError::EmptyReminder);
        }
        if title.chars().count() > MAX_TITLE_CHARS {
            return Err(DomainError::TitleTooLong);
        }
        let reminder = self.pending_mut(id)?;
        let revision = next_revision(reminder)?;
        reminder.title = title.into();
        reminder.occurrence_revision = revision;
        Ok(())
    }

    /// Replace timing atomically without discarding recorded calendar occurrences.
    pub fn edit_timer(
        &mut self,
        id: &str,
        title: &str,
        duration_ms: Option<u64>,
        now: u64,
    ) -> Result<(), DomainError> {
        let title = title.trim();
        if title.is_empty() {
            return Err(DomainError::EmptyReminder);
        }
        if title.chars().count() > MAX_TITLE_CHARS {
            return Err(DomainError::TitleTooLong);
        }
        let due_at = duration_ms
            .map(|duration| deadline(now, duration))
            .transpose()?;
        if due_at.is_some_and(|due| due > i64::MAX as u64) {
            return Err(DomainError::InvalidDuration);
        }
        let reminder = self.pending_mut(id)?;
        let revision = next_revision(reminder)?;
        reminder.title = title.into();
        reminder.due_at = due_at;
        reminder.schedule = None;
        reminder.snoozed_until = None;
        reminder.occurrence_revision = revision;
        Ok(())
    }

    /// Explicitly discard resolved rows only; pending occurrence history is retained.
    pub fn clear_resolved_history(&mut self) -> usize {
        let before = self.reminders.len();
        self.reminders
            .retain(|reminder| reminder.status == ReminderStatus::Pending);
        before - self.reminders.len()
    }

    /// Reopen a resolved reminder or detach one completed occurrence without
    /// replacing a recurring reminder's current occurrence.
    pub fn reopen(
        &mut self,
        id: &str,
        expected_revision: u64,
        occurrence: Option<(usize, u64)>,
        now: u64,
    ) -> Result<(), DomainError> {
        let index = self
            .reminders
            .iter()
            .position(|r| r.id == id)
            .ok_or(DomainError::ReminderUnavailable)?;
        let reminder = &self.reminders[index];
        if reminder.occurrence_revision != expected_revision {
            return Err(DomainError::ReminderUnavailable);
        }
        let revision = next_revision(reminder)?;
        if let Some((history_index, timestamp)) = occurrence {
            if reminder.occurrence_history.get(history_index) != Some(&timestamp) {
                return Err(DomainError::ReminderUnavailable);
            }
            if self.reminders.len() >= MAX_REMINDERS {
                return Err(DomainError::CapacityReached);
            }
            let title = reminder.title.clone();
            self.reminders[index]
                .occurrence_history
                .remove(history_index);
            self.reminders[index].occurrence_revision = revision;
            self.reminders.push(Reminder {
                id: Uuid::new_v4().to_string(),
                title,
                created_at: now,
                due_at: Some(timestamp),
                status: ReminderStatus::Pending,
                resolved_at: None,
                apple_reminder_id: None,
                schedule: None,
                snoozed_until: None,
                occurrence_revision: 0,
                occurrence_history: Vec::new(),
            });
        } else {
            let reminder = &mut self.reminders[index];
            if reminder.status == ReminderStatus::Pending {
                return Err(DomainError::ReminderUnavailable);
            }
            if reminder.status == ReminderStatus::Completed
                && reminder.schedule.is_some()
                && reminder.occurrence_history.last().copied() == reminder.due_at
            {
                reminder.occurrence_history.pop();
            }
            reminder.status = ReminderStatus::Pending;
            reminder.resolved_at = None;
            reminder.occurrence_revision = revision;
        }
        Ok(())
    }

    pub fn edit_scheduled(
        &mut self,
        id: &str,
        title: &str,
        schedule: Schedule,
        now: u64,
    ) -> Result<(), DomainError> {
        let title = title.trim();
        if title.is_empty() {
            return Err(DomainError::EmptyReminder);
        }
        if title.chars().count() > MAX_TITLE_CHARS {
            return Err(DomainError::TitleTooLong);
        }
        let schedule = schedule
            .normalize_and_validate(now)
            .map_err(DomainError::InvalidSchedule)?;
        let due_at = schedule
            .next_after(now)
            .map_err(DomainError::InvalidSchedule)?
            .ok_or_else(|| {
                DomainError::InvalidSchedule("Schedule has no future occurrence.".into())
            })?;
        if due_at > i64::MAX as u64 {
            return Err(DomainError::InvalidDocument);
        }
        let reminder = self.pending_mut(id)?;
        let revision = next_revision(reminder)?;
        reminder.title = title.into();
        reminder.schedule = Some(schedule);
        reminder.due_at = Some(due_at);
        reminder.snoozed_until = None;
        reminder.occurrence_revision = revision;
        Ok(())
    }

    pub fn snooze(&mut self, id: &str, duration_ms: u64, now: u64) -> Result<(), DomainError> {
        let until = deadline(now, duration_ms)?;
        if until > i64::MAX as u64 {
            return Err(DomainError::InvalidDuration);
        }
        let reminder = self.pending_mut(id)?;
        let revision = next_revision(reminder)?;
        reminder.snoozed_until = Some(until);
        reminder.occurrence_revision = revision;
        Ok(())
    }

    pub fn resolve(
        &mut self,
        id: &str,
        status: ReminderStatus,
        now: u64,
    ) -> Result<(), DomainError> {
        if status == ReminderStatus::Pending {
            return Err(DomainError::ReminderUnavailable);
        }
        let reminder = self.pending_mut(id)?;
        let revision = next_revision(reminder)?;
        let next = if status == ReminderStatus::Completed {
            reminder
                .schedule
                .as_ref()
                .map(|schedule| schedule.next_after(now.max(reminder.due_at.unwrap_or(now))))
                .transpose()
                .map_err(DomainError::InvalidSchedule)?
                .flatten()
        } else {
            None
        };
        if next.is_some_and(|timestamp| timestamp > i64::MAX as u64) || now > i64::MAX as u64 {
            return Err(DomainError::InvalidDocument);
        }
        if status == ReminderStatus::Completed
            && reminder.schedule.is_some()
            && let Some(due_at) = reminder.due_at
        {
            reminder.occurrence_history.push(due_at);
        }
        reminder.snoozed_until = None;
        reminder.occurrence_revision = revision;
        if let Some(next) = next {
            reminder.due_at = Some(next);
        } else {
            reminder.status = status;
            reminder.resolved_at = Some(now);
        }
        Ok(())
    }

    pub fn reschedule(&mut self, id: &str, duration_ms: u64, now: u64) -> Result<(), DomainError> {
        let reminder = self.pending_mut(id)?;
        if reminder.schedule.is_some() || reminder.snoozed_until.is_some() {
            let base = reminder
                .snoozed_until
                .or(reminder.due_at)
                .unwrap_or(now)
                .max(now);
            return self.snooze(id, duration_ms, base);
        }
        let base = reminder.due_at.unwrap_or(now).max(now);
        let due_at = deadline(base, duration_ms)?;
        let revision = next_revision(reminder)?;
        reminder.due_at = Some(due_at);
        reminder.snoozed_until = None;
        reminder.occurrence_revision = revision;
        Ok(())
    }

    pub fn pending_due_ids(&self, now: u64, excluded: &HashSet<String>) -> Vec<String> {
        let mut due = self
            .reminders
            .iter()
            .filter(|reminder| {
                reminder.status == ReminderStatus::Pending
                    && reminder
                        .snoozed_until
                        .or(reminder.due_at)
                        .is_some_and(|deadline| deadline <= now)
                    && !excluded.contains(&reminder.id)
            })
            .collect::<Vec<_>>();
        due.sort_by_key(|reminder| {
            (
                reminder.snoozed_until.or(reminder.due_at),
                reminder.created_at,
                &reminder.id,
            )
        });
        due.into_iter()
            .map(|reminder| reminder.id.clone())
            .collect()
    }

    fn pending_mut(&mut self, id: &str) -> Result<&mut Reminder, DomainError> {
        self.reminders
            .iter_mut()
            .find(|reminder| reminder.id == id && reminder.status == ReminderStatus::Pending)
            .ok_or(DomainError::ReminderUnavailable)
    }
}

fn next_revision(reminder: &Reminder) -> Result<u64, DomainError> {
    reminder
        .occurrence_revision
        .checked_add(1)
        .filter(|revision| *revision <= i64::MAX as u64)
        .ok_or(DomainError::InvalidDocument)
}

fn deadline(base: u64, duration_ms: u64) -> Result<u64, DomainError> {
    if !(1_000..=MAX_DURATION_MS).contains(&duration_ms) {
        return Err(DomainError::InvalidDuration);
    }
    base.checked_add(duration_ms)
        .ok_or(DomainError::InvalidDuration)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reopening_resolved_reminders_preserves_timing_and_rejects_stale_actions() {
        let mut document = Document::default();
        let id = document.create("timer", Some(60_000), 1_000).unwrap();
        document
            .resolve(&id, ReminderStatus::Cancelled, 2_000)
            .unwrap();
        let revision = document.reminders[0].occurrence_revision;
        document.reopen(&id, revision, None, 3_000).unwrap();
        assert_eq!(document.reminders[0].due_at, Some(61_000));
        assert_eq!(document.reminders[0].status, ReminderStatus::Pending);
        assert_eq!(document.reminders[0].resolved_at, None);
        assert!(document.reopen(&id, revision, None, 3_000).is_err());
    }

    #[test]
    fn reopening_occurrence_consumes_history_without_overwriting_series() {
        let schedule: Schedule = serde_json::from_str(r#"{"kind":"daily","date":"2025-01-01","time":"09:00","weekdays":[],"dates":[],"endDate":null,"timeZone":"UTC"}"#).unwrap();
        let mut document = Document::default();
        let now = 1_735_689_600_000;
        let id = document
            .create_scheduled("daily", schedule.clone(), now)
            .unwrap();
        let due = document.reminders[0].due_at.unwrap();
        document
            .resolve(&id, ReminderStatus::Completed, due)
            .unwrap();
        let revision = document.reminders[0].occurrence_revision;
        let next = document.reminders[0].due_at;
        assert!(
            document
                .reopen(&id, revision, Some((0, due + 1)), due)
                .is_err()
        );
        document
            .reopen(&id, revision, Some((0, due)), due + 1)
            .unwrap();
        assert_eq!(document.reminders[0].due_at, next);
        assert_eq!(document.reminders[0].schedule, Some(schedule));
        assert!(document.reminders[0].occurrence_history.is_empty());
        assert_eq!(document.reminders[1].due_at, Some(due));
        assert_eq!(document.reminders[1].schedule, None);
        assert!(
            document
                .reopen(&id, revision, Some((0, due)), due + 1)
                .is_err()
        );
        assert_eq!(document.reminders.len(), 2);
    }

    #[test]
    fn reopening_terminal_scheduled_reminder_unrecords_its_last_completion() {
        let schedule: Schedule = serde_json::from_str(r#"{"kind":"daily","date":"2025-01-01","time":"09:00","weekdays":[],"dates":[],"endDate":"2025-01-01","timeZone":"UTC"}"#).unwrap();
        let mut document = Document::default();
        let now = 1_735_689_600_000;
        let id = document
            .create_scheduled("last", schedule.clone(), now)
            .unwrap();
        let due = document.reminders[0].due_at.unwrap();
        document
            .resolve(&id, ReminderStatus::Completed, due)
            .unwrap();
        let revision = document.reminders[0].occurrence_revision;
        document.reopen(&id, revision, None, due + 1).unwrap();
        assert_eq!(document.reminders[0].schedule, Some(schedule));
        assert_eq!(document.reminders[0].due_at, Some(due));
        assert!(document.reminders[0].occurrence_history.is_empty());
        assert_eq!(document.reminders[0].status, ReminderStatus::Pending);
    }

    #[test]
    fn recurring_completion_and_snooze_preserve_occurrence() {
        let schedule: Schedule = serde_json::from_str(r#"{"kind":"daily","date":"2025-01-01","time":"09:00","weekdays":[],"dates":[],"endDate":null,"timeZone":"UTC"}"#).unwrap();
        let now = 1_735_689_600_000;
        let mut document = Document::default();
        let id = document.create_scheduled("daily", schedule, now).unwrap();
        let due = document.reminders[0].due_at.unwrap();
        document.snooze(&id, 60_000, due).unwrap();
        assert_eq!(document.reminders[0].due_at, Some(due));
        assert!(document.pending_due_ids(due, &HashSet::new()).is_empty());
        assert_eq!(
            document.pending_due_ids(due + 60_000, &HashSet::new()),
            vec![id.clone()]
        );
        document
            .resolve(&id, ReminderStatus::Completed, due + 3 * 86_400_000)
            .unwrap();
        let reminder = &document.reminders[0];
        assert_eq!(reminder.occurrence_history, vec![due]);
        assert_eq!(reminder.due_at, Some(due + 4 * 86_400_000));
        assert_eq!(reminder.occurrence_revision, 2);
        assert_eq!(reminder.status, ReminderStatus::Pending);
        document
            .resolve(&id, ReminderStatus::Cancelled, due + 4 * 86_400_000)
            .unwrap();
        assert_eq!(document.reminders[0].status, ReminderStatus::Cancelled);
    }

    #[test]
    fn completing_a_future_occurrence_advances_past_that_occurrence() {
        let schedule: Schedule = serde_json::from_str(r#"{"kind":"daily","date":"2025-01-01","time":"09:00","weekdays":[],"dates":[],"endDate":null,"timeZone":"UTC"}"#).unwrap();
        let mut document = Document::default();
        let now = 1_735_689_600_000;
        let id = document.create_scheduled("daily", schedule, now).unwrap();
        let due = document.reminders[0].due_at.unwrap();
        document
            .resolve(&id, ReminderStatus::Completed, now)
            .unwrap();
        assert_eq!(document.reminders[0].due_at, Some(due + 86_400_000));
        assert_eq!(document.reminders[0].occurrence_history, vec![due]);
    }

    #[test]
    fn extending_a_scheduled_reminder_preserves_its_original_occurrence() {
        let schedule: Schedule = serde_json::from_str(r#"{"kind":"daily","date":"2025-01-01","time":"09:00","weekdays":[],"dates":[],"endDate":null,"timeZone":"UTC"}"#).unwrap();
        let mut document = Document::default();
        let now = 1_735_689_600_000;
        let id = document.create_scheduled("daily", schedule, now).unwrap();
        let due = document.reminders[0].due_at.unwrap();
        document.reschedule(&id, 300_000, now).unwrap();
        assert_eq!(document.reminders[0].due_at, Some(due));
        assert_eq!(document.reminders[0].snoozed_until, Some(due + 300_000));
        document.reschedule(&id, 300_000, now).unwrap();
        assert_eq!(document.reminders[0].snoozed_until, Some(due + 600_000));
        assert_eq!(document.reminders[0].due_at, Some(due));
        document
            .resolve(&id, ReminderStatus::Completed, due + 600_000)
            .unwrap();
        assert_eq!(document.reminders[0].due_at, Some(due + 86_400_000));
        assert_eq!(document.reminders[0].occurrence_history, vec![due]);
    }

    #[test]
    fn extending_a_snoozed_timer_does_not_shorten_the_snooze() {
        let mut document = Document::default();
        let id = document.create("timer", Some(1_000), 100).unwrap();
        document.snooze(&id, 1_800_000, 1_100).unwrap();
        document.reschedule(&id, 300_000, 1_100).unwrap();
        assert_eq!(document.reminders[0].due_at, Some(1_100));
        assert_eq!(document.reminders[0].snoozed_until, Some(2_101_100));
    }

    #[test]
    fn rename_preserves_schedule_and_snooze_but_invalidates_old_actions() {
        let schedule: Schedule = serde_json::from_str(r#"{"kind":"daily","date":"2025-01-01","time":"09:00","weekdays":[],"dates":[],"endDate":null,"timeZone":"UTC"}"#).unwrap();
        let mut document = Document::default();
        let id = document
            .create_scheduled("old", schedule.clone(), 1_735_689_600_000)
            .unwrap();
        let due = document.reminders[0].due_at;
        document.snooze(&id, 60_000, due.unwrap()).unwrap();
        let snooze = document.reminders[0].snoozed_until;
        document.rename(&id, "new").unwrap();
        let reminder = &document.reminders[0];
        assert_eq!(reminder.title, "new");
        assert_eq!(reminder.schedule.as_ref(), Some(&schedule));
        assert_eq!(reminder.due_at, due);
        assert_eq!(reminder.snoozed_until, snooze);
        assert_eq!(reminder.occurrence_revision, 2);
    }

    #[test]
    fn one_model_supports_text_and_timer_only_reminders() {
        let mut document = Document::default();
        document.create(" Call Sam ", None, 100).unwrap();
        document.create("", Some(1_000), 100).unwrap();
        assert_eq!(document.reminders[0].title, "Call Sam");
        assert_eq!(document.reminders[0].due_at, None);
        assert_eq!(document.reminders[1].title, "Timer");
        assert_eq!(document.reminders[1].due_at, Some(1_100));
    }

    #[test]
    fn transitions_preserve_clear_status_semantics() {
        let mut document = Document::default();
        let id = document.create("one", Some(1_000), 100).unwrap();
        document.reschedule(&id, 2_000, 200).unwrap();
        assert_eq!(document.reminders[0].due_at, Some(3_100));
        document
            .resolve(&id, ReminderStatus::Completed, 500)
            .unwrap();
        assert_eq!(document.reminders[0].resolved_at, Some(500));
        assert!(document.reschedule(&id, 1_000, 600).is_err());
    }

    #[test]
    fn replacing_calendar_timing_keeps_history_and_clears_snooze() {
        let schedule: Schedule = serde_json::from_str(r#"{"kind":"daily","date":"2025-01-01","time":"09:00","weekdays":[],"dates":[],"endDate":null,"timeZone":"UTC"}"#).unwrap();
        let mut document = Document::default();
        let now = 1_735_689_600_000;
        let id = document
            .create_scheduled("calendar", schedule, now)
            .unwrap();
        let due = document.reminders[0].due_at.unwrap();
        document
            .resolve(&id, ReminderStatus::Completed, due)
            .unwrap();
        document.snooze(&id, 60_000, due).unwrap();
        document
            .edit_timer(&id, " replacement ", Some(5_000), due)
            .unwrap();
        let reminder = &document.reminders[0];
        assert_eq!(reminder.title, "replacement");
        assert_eq!(reminder.due_at, Some(due + 5_000));
        assert_eq!(reminder.schedule, None);
        assert_eq!(reminder.snoozed_until, None);
        assert_eq!(reminder.occurrence_revision, 3);
        assert_eq!(reminder.occurrence_history, vec![due]);
        document.edit_timer(&id, "untimed", None, due).unwrap();
        assert_eq!(document.reminders[0].due_at, None);
        assert_eq!(document.reminders[0].occurrence_history, vec![due]);
        assert_eq!(document.reminders[0].occurrence_revision, 4);
        document
            .edit_timer(&id, "timer again", Some(1_000), due)
            .unwrap();
        assert_eq!(document.reminders[0].due_at, Some(due + 1_000));
    }

    #[test]
    fn timer_edit_validation_is_atomic_and_rejects_finished_rows() {
        let mut document = Document::default();
        let id = document.create("original", Some(1_000), 100).unwrap();
        for (title, duration, now) in [
            ("", None, 100),
            ("changed", Some(999), 100),
            ("changed", Some(MAX_DURATION_MS + 1), 100),
            ("changed", Some(1_000), i64::MAX as u64),
        ] {
            let before = document.clone();
            assert!(document.edit_timer(&id, title, duration, now).is_err());
            assert_eq!(document, before);
        }
        let before = document.clone();
        assert_eq!(
            document.edit_timer(&id, &"a".repeat(MAX_TITLE_CHARS + 1), None, 100),
            Err(DomainError::TitleTooLong)
        );
        assert_eq!(document, before);
        document.reminders[0].occurrence_revision = i64::MAX as u64;
        let before = document.clone();
        assert_eq!(
            document.edit_timer(&id, "overflow", None, 100),
            Err(DomainError::InvalidDocument)
        );
        assert_eq!(document, before);
        document.reminders[0].occurrence_revision = 0;
        document
            .resolve(&id, ReminderStatus::Completed, 200)
            .unwrap();
        assert_eq!(
            document.edit_timer(&id, "finished", None, 300),
            Err(DomainError::ReminderUnavailable)
        );
    }

    #[test]
    fn explicit_history_deletion_recovers_capacity_without_changing_pending_rows() {
        let mut document = Document::default();
        let pending = document.create("keep history", None, 100).unwrap();
        document.reminders[0].occurrence_history = vec![50];
        let retained = document.reminders[0].clone();
        for index in 1..MAX_REMINDERS {
            let id = document.create("resolved", None, 100).unwrap();
            let status = if index % 2 == 0 {
                ReminderStatus::Completed
            } else {
                ReminderStatus::Cancelled
            };
            document.resolve(&id, status, 200).unwrap();
        }
        assert_eq!(
            document.create("full", None, 300),
            Err(DomainError::CapacityReached)
        );
        assert_eq!(document.reminders.len(), MAX_REMINDERS);
        assert_eq!(document.clear_resolved_history(), MAX_REMINDERS - 1);
        assert_eq!(document.reminders, vec![retained]);
        assert_eq!(document.reminders[0].id, pending);
        assert_eq!(document.clear_resolved_history(), 0);
        document.create("new capacity", Some(1_000), 300).unwrap();
        assert_eq!(document.reminders.len(), 2);
        assert_eq!(document.reminders[0].occurrence_history, vec![50]);
    }

    #[test]
    fn legacy_resolution_times_are_normalized() {
        let document: Document = serde_json::from_str(
            r#"{"version":1,"reminders":[{"id":"old","title":"done","createdAt":100,"dueAt":200,"status":"completed"}],"settings":{"alertStyle":"notch"}}"#,
        )
        .unwrap();
        let document = document.normalize_and_validate().unwrap();
        assert_eq!(document.version, SCHEMA_VERSION);
        assert_eq!(document.reminders[0].resolved_at, Some(100));
        assert_eq!(document.settings.alert_style, AlertStyle::Notch);
    }
}
