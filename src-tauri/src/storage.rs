use crate::domain::{
    AlertStyle, Appearance, ColorTheme, Document, MigrationMetadata, Reminder, ReminderStatus,
    SCHEMA_VERSION,
};
use crate::sounds;
use rusqlite::{
    Connection, MAIN_DB, OptionalExtension, Transaction, TransactionBehavior, backup::Progress,
    params,
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

const DB_SCHEMA_VERSION: u32 = 4;
const MAX_DOCUMENT_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, thiserror::Error, Clone)]
pub enum StorageError {
    #[error(
        "Your saved reminders couldn't be opened. A recovery copy was preserved at {recovery_path}."
    )]
    Corrupt { recovery_path: String },
    #[error("Your saved reminders were created by a newer Sela version.")]
    NewerVersion,
    #[error(
        "That didn't save. Your reminders are unchanged. Check your Mac has free space and try again."
    )]
    WriteFailed,
    #[error("The old prototype data couldn't be migrated. The original file is still untouched.")]
    MigrationFailed,
    #[error(
        "The database upgrade failed. A recovery copy is available at {recovery_path}. Quit Sela and preserve both files before retrying."
    )]
    UpgradeFailed { recovery_path: String },
    #[error("{0}")]
    SoundFailed(String),
}

pub struct AppStorage {
    path: PathBuf,
    backup_path: PathBuf,
    connection: Mutex<Option<Connection>>,
    initialization_error: Option<StorageError>,
    // Lock ordering is always sound_access, then connection. Upload leases span write,
    // commit, and cleanup; reads hold the same lease until all bytes are loaded.
    sound_access: Mutex<()>,
}

impl AppStorage {
    /// Opens/migrates the local SQLite database. Failure returns a read-only storage object,
    /// allowing the UI to explain the problem without silently creating a replacement database.
    pub fn new(path: PathBuf) -> Self {
        let backup_path = path.with_file_name("sela.backup.sqlite3");
        let (connection, initialization_error) = match Self::open_connection(&path) {
            Ok(connection) => (Some(connection), None),
            Err(error) => (None, Some(error)),
        };
        Self {
            path,
            backup_path,
            connection: Mutex::new(connection),
            initialization_error,
            sound_access: Mutex::new(()),
        }
    }

    #[cfg(debug_assertions)]
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn open_connection(path: &Path) -> Result<Connection, StorageError> {
        let parent = path.parent().ok_or(StorageError::WriteFailed)?;
        fs::create_dir_all(parent).map_err(|error| {
            log::error!("could not create database directory: {error}");
            StorageError::WriteFailed
        })?;
        let existed = path.exists() && fs::metadata(path).map_err(write_error)?.len() > 0;
        // Inspect existing databases read-only before changing permissions or opening for writes.
        if existed {
            let probe =
                Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .map_err(write_error)?;
            let version = probe
                .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
                .map_err(|error| {
                    log::error!("could not inspect database schema: {error}");
                    preserve_database(path)
                })?;
            if version > DB_SCHEMA_VERSION {
                return Err(StorageError::NewerVersion);
            }
        }
        secure_permissions(parent, 0o700).map_err(write_error)?;
        let mut connection = Connection::open(path).map_err(|error| {
            log::error!("could not open SQLite database: {error}");
            StorageError::WriteFailed
        })?;
        secure_permissions(path, 0o600).map_err(write_error)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(write_error)?;

        let integrity: String =
            match connection.query_row("PRAGMA quick_check", [], |row| row.get(0)) {
                Ok(result) => result,
                Err(error) => {
                    log::error!("SQLite integrity check failed: {error}");
                    drop(connection);
                    return Err(preserve_database(path));
                }
            };
        if integrity != "ok" {
            drop(connection);
            return Err(preserve_database(path));
        }

        let user_version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(write_error)?;
        if user_version > DB_SCHEMA_VERSION {
            return Err(StorageError::NewerVersion);
        }
        if user_version < DB_SCHEMA_VERSION {
            // The online backup API includes committed WAL contents. Never overwrite an older
            // pre-upgrade snapshot: a failed migration must leave a recoverable original.
            let backup = if existed {
                let backup = path.with_file_name(format!(
                    "sela.pre-upgrade-v{user_version}-{}.sqlite3",
                    uuid::Uuid::new_v4()
                ));
                create_private_backup(&connection, &backup).map_err(write_error)?;
                Some(backup)
            } else {
                None
            };
            let migration = (|| -> Result<(), StorageError> {
                let transaction = connection.transaction().map_err(write_error)?;
                if user_version < 1 {
                    migrate_schema(&transaction)?;
                }
                if user_version < 2 {
                    transaction.execute_batch(
                    "ALTER TABLE settings ADD COLUMN sound_enabled INTEGER NOT NULL DEFAULT 1 CHECK(sound_enabled IN (0, 1));
                     ALTER TABLE settings ADD COLUMN default_snooze_minutes INTEGER NOT NULL DEFAULT 5 CHECK(default_snooze_minutes IN (5, 10, 15, 30));"
                ).map_err(write_error)?;
                }
                if user_version < 3 {
                    transaction.execute_batch(
                    "ALTER TABLE reminders ADD COLUMN schedule TEXT;
                     ALTER TABLE reminders ADD COLUMN snoozed_until INTEGER;
                     ALTER TABLE reminders ADD COLUMN occurrence_revision INTEGER NOT NULL DEFAULT 0 CHECK(occurrence_revision >= 0);
                     ALTER TABLE reminders ADD COLUMN occurrence_history TEXT NOT NULL DEFAULT '[]';"
                ).map_err(write_error)?;
                }
                if user_version < 4 {
                    transaction.execute_batch(
                        "ALTER TABLE settings ADD COLUMN sound_choice TEXT NOT NULL DEFAULT 'tone';
                         ALTER TABLE settings ADD COLUMN custom_sound_id TEXT;"
                    ).map_err(write_error)?;
                }
                transaction
                    .pragma_update(None, "user_version", DB_SCHEMA_VERSION)
                    .map_err(write_error)?;
                transaction.commit().map_err(write_error)?;
                Ok(())
            })();
            migration.map_err(|error| match backup {
                Some(backup) => StorageError::UpgradeFailed {
                    recovery_path: backup.display().to_string(),
                },
                None => error,
            })?;
        }

        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = FULL;",
            )
            .map_err(write_error)?;
        Ok(connection)
    }

    pub fn load_or_migrate(
        &self,
        legacy_paths: &[PathBuf],
        now: u64,
    ) -> Result<Document, StorageError> {
        let _sounds = self.lock_sounds();
        let mut guard = self.lock_connection()?;
        let connection = guard.as_mut().ok_or(StorageError::WriteFailed)?;
        ensure_default_settings(connection)?;

        if metadata(connection, "legacy_import")?.is_none() {
            let has_records: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM reminders LIMIT 1)",
                    [],
                    |row| row.get(0),
                )
                .map_err(write_error)?;
            if has_records {
                set_metadata(connection, "legacy_import", "skipped-existing-data")?;
            } else if let Some(legacy_path) = legacy_paths.iter().find(|path| path.exists()) {
                self.import_legacy(connection, legacy_path, now)?;
            } else {
                set_metadata(connection, "legacy_import", "none-found")?;
            }
        }

        let document = load_document(connection).map_err(|error| {
            log::error!("could not load local reminders: {error}");
            preserve_database(&self.path)
        })?;
        self.reconcile_sounds(connection);
        Ok(document)
    }

    fn import_legacy(
        &self,
        connection: &mut Connection,
        legacy_path: &Path,
        now: u64,
    ) -> Result<(), StorageError> {
        let bytes = fs::read(legacy_path).map_err(|error| {
            log::error!("could not read legacy reminder file: {error}");
            StorageError::MigrationFailed
        })?;
        if bytes.is_empty() || bytes.len() as u64 > MAX_DOCUMENT_BYTES {
            return Err(StorageError::MigrationFailed);
        }
        let mut document: Document = serde_json::from_slice(&bytes).map_err(|error| {
            log::error!("legacy reminder JSON is invalid: {error}");
            StorageError::MigrationFailed
        })?;
        document = document.normalize_and_validate().map_err(|error| {
            log::error!("legacy reminder records are invalid: {error}");
            StorageError::MigrationFailed
        })?;
        document.migration = Some(MigrationMetadata {
            source: "reminder-prototype-json-v1".into(),
            completed_at: now,
        });

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(write_error)?;
        write_document(&transaction, &Document::default(), &document)?;
        set_metadata_tx(&transaction, "legacy_import", "prototype-json-v1")?;
        transaction.commit().map_err(write_error)
    }

    /// Apply only changed rows in one transaction. SQLite owns atomicity and indexed queries;
    /// no JSON document is rewritten for every reminder action.
    pub fn save_transition(&self, before: &Document, after: &Document) -> Result<(), StorageError> {
        let _sounds = self.lock_sounds();
        let mut guard = self.lock_connection()?;
        let connection = guard.as_mut().ok_or(StorageError::WriteFailed)?;
        let backup_rotated = self.save_transition_locked(connection, before, after)?;
        if backup_rotated || before.settings.custom_sound_id != after.settings.custom_sound_id {
            self.reconcile_sounds(connection);
        }
        Ok(())
    }

    pub fn save_sound_transition(
        &self,
        before: &Document,
        after: &Document,
        bytes: &[u8],
    ) -> Result<(), StorageError> {
        let _sounds = self.lock_sounds();
        let mut guard = self.lock_connection()?;
        let connection = guard.as_mut().ok_or(StorageError::WriteFailed)?;
        let id =
            after.settings.custom_sound_id.as_deref().ok_or_else(|| {
                StorageError::SoundFailed("The sound could not be selected.".into())
            })?;
        if before.settings.custom_sound_id.as_deref() == Some(id) {
            return Err(StorageError::SoundFailed(
                "Upload a new sound before replacing it.".into(),
            ));
        }
        if let Err(error) = sounds::write(&self.sound_root(), id, bytes) {
            if error.kind() == std::io::ErrorKind::InvalidInput {
                return Err(StorageError::SoundFailed(error.to_string()));
            }
            log::error!("could not save custom sound: {error}");
            self.reconcile_sounds(connection);
            return Err(StorageError::SoundFailed(
                "The sound couldn't be saved. Check available disk space and try again.".into(),
            ));
        }
        let result = self.save_transition_locked(connection, before, after);
        // On rollback this reclaims the rejected upload; on commit it preserves the
        // newly selected sound and every snapshot's former selection.
        self.reconcile_sounds(connection);
        result.map(|_| ())
    }

    pub fn read_custom_sound(&self, id: &str) -> Result<Vec<u8>, String> {
        let _sounds = self.lock_sounds();
        sounds::read(&self.sound_root(), id).map_err(|error| {
            log::error!("could not read custom sound: {error}");
            "That sound is unavailable. Upload it again.".into()
        })
    }

    fn lock_sounds(&self) -> std::sync::MutexGuard<'_, ()> {
        self.sound_access
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn sound_root(&self) -> PathBuf {
        self.path.with_file_name("sounds")
    }

    fn reconcile_sounds(&self, connection: &Connection) {
        // A failed scan must never mean \"no references\". Keep all files until a
        // later successful commit/startup can prove they are unreferenced.
        let result = self.retained_sound_ids(connection).and_then(|retained| {
            sounds::reconcile(&self.sound_root(), &retained).map_err(write_error)
        });
        if let Err(error) = result {
            // This is post-commit maintenance: do not report a committed document
            // as rolled back. Log the failure and retry at the next safe point.
            log::warn!("custom sound reconciliation deferred: {error}");
        }
    }

    fn retained_sound_ids(&self, connection: &Connection) -> Result<HashSet<String>, StorageError> {
        let mut retained = HashSet::new();
        collect_sound_reference(connection, &mut retained)?;
        let parent = self.path.parent().ok_or(StorageError::WriteFailed)?;
        for entry in fs::read_dir(parent).map_err(write_error)? {
            let entry = entry.map_err(write_error)?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if !sound_backup_name(name) {
                continue;
            }
            let file_type = entry.file_type().map_err(write_error)?;
            if !file_type.is_file() || file_type.is_symlink() {
                return Err(StorageError::WriteFailed);
            }
            let backup = Connection::open_with_flags(
                entry.path(),
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .map_err(write_error)?;
            collect_sound_reference(&backup, &mut retained)?;
        }
        Ok(retained)
    }

    fn save_transition_locked(
        &self,
        connection: &mut Connection,
        before: &Document,
        after: &Document,
    ) -> Result<bool, StorageError> {
        let before_backup = self.backup_if_due(connection);
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(write_error)?;
        write_document(&transaction, before, after)?;
        transaction.commit().map_err(write_error)?;
        // The first saved reminder has no old data to back up; create its initial snapshot after commit.
        let after_backup = self.backup_if_due(connection);
        Ok(before_backup || after_backup)
    }

    fn backup_if_due(&self, connection: &Connection) -> bool {
        let day = unix_timestamp() / 86_400_000;
        if metadata(connection, "last_backup_day")
            .ok()
            .flatten()
            .as_deref()
            == Some(&day.to_string())
        {
            return false;
        }
        let has_data = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM reminders LIMIT 1)",
                [],
                |row| row.get::<_, bool>(0),
            )
            .unwrap_or(false);
        if !has_data {
            return false;
        }
        let temporary = self.backup_path.with_extension("sqlite3.tmp");
        let _ = fs::remove_file(&temporary);
        match create_private_backup(connection, &temporary) {
            Ok(()) => {
                if let Err(error) = fs::rename(&temporary, &self.backup_path) {
                    log::warn!("could not rotate SQLite backup: {error}");
                    let _ = fs::remove_file(&temporary);
                    return false;
                }
                let _ = connection.execute(
                    "INSERT INTO metadata(key, value) VALUES ('last_backup_day', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    params![day.to_string()],
                );
                true
            }
            Err(error) => {
                log::warn!("could not create daily SQLite backup: {error}");
                false
            }
        }
    }

    fn lock_connection(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Option<Connection>>, StorageError> {
        let guard = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.is_none() {
            return Err(self
                .initialization_error
                .clone()
                .unwrap_or(StorageError::WriteFailed));
        }
        Ok(guard)
    }
}

fn sound_backup_name(name: &str) -> bool {
    if matches!(name, "sela.backup.sqlite3" | "sela.backup.sqlite3.tmp") {
        return true;
    }
    let Some(stem) = name.strip_suffix(".sqlite3") else {
        return false;
    };
    let suffix = stem
        .strip_prefix("sela.pre-upgrade-v")
        .or_else(|| stem.strip_prefix("sela.corrupt-"));
    let Some((version_or_time, id)) = suffix.and_then(|value| value.split_once('-')) else {
        return false;
    };
    !version_or_time.is_empty()
        && version_or_time.bytes().all(|byte| byte.is_ascii_digit())
        && uuid::Uuid::parse_str(id).is_ok()
}

fn collect_sound_reference(
    connection: &Connection,
    retained: &mut HashSet<String>,
) -> Result<(), StorageError> {
    let version: u32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(write_error)?;
    if version > DB_SCHEMA_VERSION {
        return Err(StorageError::NewerVersion);
    }
    let mut statement = connection
        .prepare("PRAGMA table_info(settings)")
        .map_err(write_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(write_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(write_error)?;
    if !columns.iter().any(|column| column == "custom_sound_id") {
        return if version < 4 {
            Ok(())
        } else {
            Err(StorageError::WriteFailed)
        };
    }
    let id: Option<String> = connection
        .query_row(
            "SELECT custom_sound_id FROM settings WHERE id=1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(write_error)?
        .flatten();
    if let Some(id) = id {
        let id = uuid::Uuid::parse_str(&id).map_err(write_error)?;
        retained.insert(id.to_string());
    }
    Ok(())
}

fn migrate_schema(transaction: &Transaction<'_>) -> Result<(), StorageError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS reminders (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 240),
                created_at INTEGER NOT NULL CHECK(created_at > 0),
                due_at INTEGER,
                status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'cancelled')),
                resolved_at INTEGER,
                apple_reminder_id TEXT UNIQUE
            );
            CREATE INDEX IF NOT EXISTS reminders_due_idx
                ON reminders(due_at, created_at, id)
                WHERE status = 'pending' AND due_at IS NOT NULL;
            CREATE INDEX IF NOT EXISTS reminders_previous_idx
                ON reminders(resolved_at DESC, created_at DESC)
                WHERE status != 'pending';
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                alert_style TEXT NOT NULL CHECK(alert_style IN ('fullscreen', 'notch', 'native')),
                appearance TEXT NOT NULL CHECK(appearance IN ('system', 'light', 'dark')),
                color_theme TEXT NOT NULL CHECK(color_theme IN ('monochrome', 'vermilion', 'cobalt', 'brass')),
                onboarding_completed INTEGER NOT NULL CHECK(onboarding_completed IN (0, 1))
            );
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );",
        )
        .map_err(write_error)
}

fn ensure_default_settings(connection: &Connection) -> Result<(), StorageError> {
    connection
        .execute(
            "INSERT OR IGNORE INTO settings(id, alert_style, appearance, color_theme, onboarding_completed) VALUES (1, 'fullscreen', 'system', 'monochrome', 0)",
            [],
        )
        .map_err(write_error)?;
    Ok(())
}

fn write_document(
    transaction: &Transaction<'_>,
    before: &Document,
    after: &Document,
) -> Result<(), StorageError> {
    let old = before
        .reminders
        .iter()
        .map(|item| (item.id.as_str(), item))
        .collect::<HashMap<_, _>>();
    let new_ids = after
        .reminders
        .iter()
        .map(|item| item.id.as_str())
        .collect::<HashSet<_>>();

    for removed in before
        .reminders
        .iter()
        .filter(|item| !new_ids.contains(item.id.as_str()))
    {
        transaction
            .execute("DELETE FROM reminders WHERE id = ?1", params![removed.id])
            .map_err(write_error)?;
    }
    for reminder in &after.reminders {
        if old
            .get(reminder.id.as_str())
            .is_some_and(|previous| **previous == *reminder)
        {
            continue;
        }
        let schedule = reminder
            .schedule
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(write_error)?;
        let history = serde_json::to_string(&reminder.occurrence_history).map_err(write_error)?;
        let revision = i64::try_from(reminder.occurrence_revision).map_err(write_error)?;
        let snoozed_until = reminder
            .snoozed_until
            .map(i64::try_from)
            .transpose()
            .map_err(write_error)?;
        transaction.execute(
            "INSERT INTO reminders(id, title, created_at, due_at, status, resolved_at, apple_reminder_id, schedule, snoozed_until, occurrence_revision, occurrence_history)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET title=excluded.title, created_at=excluded.created_at,
               due_at=excluded.due_at, status=excluded.status, resolved_at=excluded.resolved_at,
               apple_reminder_id=excluded.apple_reminder_id, schedule=excluded.schedule,
               snoozed_until=excluded.snoozed_until, occurrence_revision=excluded.occurrence_revision,
               occurrence_history=excluded.occurrence_history",
            params![reminder.id, reminder.title, reminder.created_at as i64, reminder.due_at.map(|value| value as i64), status_text(reminder.status), reminder.resolved_at.map(|value| value as i64), reminder.apple_reminder_id, schedule, snoozed_until, revision, history],
        ).map_err(write_error)?;
    }
    transaction.execute(
        "UPDATE settings SET alert_style=?1, appearance=?2, color_theme=?3, onboarding_completed=?4, sound_enabled=?5, default_snooze_minutes=?6, sound_choice=?7, custom_sound_id=?8 WHERE id=1",
        params![alert_style_text(after.settings.alert_style), appearance_text(after.settings.appearance), color_theme_text(after.settings.color_theme), after.settings.onboarding_completed, after.settings.sound_enabled, after.settings.default_snooze_minutes, serde_json::to_value(after.settings.sound_choice).map_err(write_error)?.as_str().ok_or(StorageError::WriteFailed)?, after.settings.custom_sound_id],
    ).map_err(write_error)?;
    if let Some(migration) = &after.migration {
        set_metadata_tx(transaction, "migration_source", &migration.source)?;
        set_metadata_tx(
            transaction,
            "migration_completed_at",
            &migration.completed_at.to_string(),
        )?;
    }
    Ok(())
}

fn load_document(connection: &Connection) -> Result<Document, String> {
    let (alert_style, appearance, color_theme, onboarding_completed, sound_enabled, default_snooze_minutes, sound_choice, custom_sound_id) = connection.query_row(
        "SELECT alert_style, appearance, color_theme, onboarding_completed, sound_enabled, default_snooze_minutes, sound_choice, custom_sound_id FROM settings WHERE id=1",
        [],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, bool>(3)?, row.get::<_, bool>(4)?, row.get::<_, u8>(5)?, row.get::<_, String>(6)?, row.get::<_, Option<String>>(7)?)),
    ).map_err(|error| error.to_string())?;
    let settings = crate::domain::Settings {
        alert_style: serde_json::from_str(&format!("\"{alert_style}\""))
            .map_err(|error| error.to_string())?,
        appearance: serde_json::from_str(&format!("\"{appearance}\""))
            .map_err(|error| error.to_string())?,
        color_theme: serde_json::from_str(&format!("\"{color_theme}\""))
            .map_err(|error| error.to_string())?,
        onboarding_completed,
        sound_enabled,
        sound_choice: serde_json::from_value(serde_json::Value::String(sound_choice))
            .map_err(|error| error.to_string())?,
        custom_sound_id,
        default_snooze_minutes,
    };
    let mut statement = connection.prepare(
        "SELECT id, title, created_at, due_at, status, resolved_at, apple_reminder_id, schedule, snoozed_until, occurrence_revision, occurrence_history FROM reminders ORDER BY created_at, id",
    ).map_err(|error| error.to_string())?;
    let reminders = statement
        .query_map([], |row| {
            let status: String = row.get(4)?;
            Ok(Reminder {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get::<_, i64>(2)? as u64,
                due_at: row.get::<_, Option<i64>>(3)?.map(|value| value as u64),
                status: serde_json::from_str(&format!("\"{status}\"")).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        4,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                resolved_at: row.get::<_, Option<i64>>(5)?.map(|value| value as u64),
                apple_reminder_id: row.get(6)?,
                schedule: row
                    .get::<_, Option<String>>(7)?
                    .map(|json| {
                        serde_json::from_str(&json).map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                7,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        })
                    })
                    .transpose()?,
                snoozed_until: row.get::<_, Option<i64>>(8)?.map(|value| value as u64),
                occurrence_revision: row.get::<_, i64>(9)? as u64,
                occurrence_history: serde_json::from_str(&row.get::<_, String>(10)?).map_err(
                    |error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            10,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    },
                )?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let migration_source =
        metadata(connection, "migration_source").map_err(|error| error.to_string())?;
    let migration_completed_at = metadata(connection, "migration_completed_at")
        .map_err(|error| error.to_string())?
        .and_then(|value| value.parse().ok());
    let migration = migration_source
        .zip(migration_completed_at)
        .map(|(source, completed_at)| MigrationMetadata {
            source,
            completed_at,
        });
    Document {
        version: SCHEMA_VERSION,
        reminders,
        settings,
        migration,
    }
    .normalize_and_validate()
    .map_err(|error| error.to_string())
}

fn status_text(status: ReminderStatus) -> &'static str {
    match status {
        ReminderStatus::Pending => "pending",
        ReminderStatus::Completed => "completed",
        ReminderStatus::Cancelled => "cancelled",
    }
}
fn alert_style_text(style: AlertStyle) -> &'static str {
    match style {
        AlertStyle::Fullscreen => "fullscreen",
        AlertStyle::Notch => "notch",
        AlertStyle::Native => "native",
    }
}
fn appearance_text(appearance: Appearance) -> &'static str {
    match appearance {
        Appearance::System => "system",
        Appearance::Light => "light",
        Appearance::Dark => "dark",
    }
}
fn color_theme_text(theme: ColorTheme) -> &'static str {
    match theme {
        ColorTheme::Monochrome => "monochrome",
        ColorTheme::Vermilion => "vermilion",
        ColorTheme::Cobalt => "cobalt",
        ColorTheme::Brass => "brass",
    }
}

fn metadata(connection: &Connection, key: &str) -> Result<Option<String>, StorageError> {
    connection
        .query_row(
            "SELECT value FROM metadata WHERE key=?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(write_error)
}
fn set_metadata(connection: &Connection, key: &str, value: &str) -> Result<(), StorageError> {
    connection.execute(
        "INSERT INTO metadata(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    ).map_err(write_error)?;
    Ok(())
}

fn set_metadata_tx(
    transaction: &Transaction<'_>,
    key: &str,
    value: &str,
) -> Result<(), StorageError> {
    transaction.execute("INSERT INTO metadata(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,value]).map_err(write_error)?;
    Ok(())
}
fn write_error(error: impl std::fmt::Display) -> StorageError {
    log::error!("SQLite error: {error}");
    StorageError::WriteFailed
}
fn create_private_backup(
    connection: &Connection,
    path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    drop(options.open(path)?);
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        connection.backup(MAIN_DB, path, None::<fn(Progress)>)?;
        let backup = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let integrity: String = backup.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        if integrity != "ok" {
            return Err(format!("backup integrity check failed: {integrity}").into());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

fn secure_permissions(path: &Path, mode: u32) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    let _ = (path, mode);
    Ok(())
}

fn preserve_database(path: &Path) -> StorageError {
    let recovery = path.with_file_name(format!(
        "sela.corrupt-{}-{}.sqlite3",
        unix_timestamp(),
        uuid::Uuid::new_v4()
    ));
    let mut copied = false;
    for source in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        if source.exists() {
            let suffix = if source == path {
                ""
            } else if source.to_string_lossy().ends_with("-wal") {
                "-wal"
            } else {
                "-shm"
            };
            let destination = PathBuf::from(format!("{}{}", recovery.display(), suffix));
            if let Err(error) = fs::copy(&source, &destination) {
                log::error!("database recovery copy failed: {error}");
            } else {
                let _ = secure_permissions(&destination, 0o600);
                copied = true;
            }
        }
    }
    StorageError::Corrupt {
        recovery_path: if copied {
            recovery.display().to_string()
        } else {
            path.display().to_string()
        },
    }
}
pub fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOUND_WAV: &[u8] = include_bytes!("../../public/sounds/back.wav");

    fn selecting_sound(document: &Document) -> Document {
        let mut next = document.clone();
        next.settings.custom_sound_id = Some(uuid::Uuid::new_v4().to_string());
        next.settings.sound_choice = crate::domain::SoundChoice::Custom;
        next
    }

    #[test]
    fn replacement_reclaims_unreferenced_wavs_and_startup_crash_leftovers() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sela.sqlite3");
        let storage = AppStorage::new(path.clone());
        let empty = storage.load_or_migrate(&[], 100).unwrap();
        let first = selecting_sound(&empty);
        storage
            .save_sound_transition(&empty, &first, SOUND_WAV)
            .unwrap();
        let second = selecting_sound(&first);
        storage
            .save_sound_transition(&first, &second, SOUND_WAV)
            .unwrap();
        assert!(
            !sounds::sound_path(
                &storage.sound_root(),
                first.settings.custom_sound_id.as_deref().unwrap()
            )
            .unwrap()
            .exists()
        );
        assert_eq!(
            storage
                .read_custom_sound(second.settings.custom_sound_id.as_deref().unwrap())
                .unwrap(),
            SOUND_WAV
        );
        let orphan = uuid::Uuid::new_v4().to_string();
        sounds::write(&storage.sound_root(), &orphan, SOUND_WAV).unwrap();
        drop(storage);
        let reopened = AppStorage::new(path);
        let loaded = reopened.load_or_migrate(&[], 200).unwrap();
        assert_eq!(
            loaded.settings.custom_sound_id,
            second.settings.custom_sound_id
        );
        assert!(
            !sounds::sound_path(&reopened.sound_root(), &orphan)
                .unwrap()
                .exists()
        );
        assert_eq!(
            reopened
                .read_custom_sound(loaded.settings.custom_sound_id.as_deref().unwrap())
                .unwrap(),
            SOUND_WAV
        );
    }

    #[test]
    fn failed_sound_persistence_preserves_prior_selection_and_reclaims_rejected_upload() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        let empty = storage.load_or_migrate(&[], 100).unwrap();
        let first = selecting_sound(&empty);
        storage
            .save_sound_transition(&empty, &first, SOUND_WAV)
            .unwrap();
        storage.connection.lock().unwrap().as_ref().unwrap().execute_batch(
            "CREATE TRIGGER reject_sound BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'simulated sound persistence failure'); END;"
        ).unwrap();
        let rejected = selecting_sound(&first);
        assert!(
            storage
                .save_sound_transition(&first, &rejected, SOUND_WAV)
                .is_err()
        );
        assert!(
            !sounds::sound_path(
                &storage.sound_root(),
                rejected.settings.custom_sound_id.as_deref().unwrap()
            )
            .unwrap()
            .exists()
        );
        let loaded = storage.load_or_migrate(&[], 200).unwrap();
        assert_eq!(
            loaded.settings.custom_sound_id,
            first.settings.custom_sound_id
        );
        assert_eq!(
            storage
                .read_custom_sound(first.settings.custom_sound_id.as_deref().unwrap())
                .unwrap(),
            SOUND_WAV
        );
    }

    #[test]
    fn sound_write_failure_never_changes_the_database_selection() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        let empty = storage.load_or_migrate(&[], 100).unwrap();
        fs::write(storage.sound_root(), b"not a sound directory").unwrap();
        assert!(
            storage
                .save_sound_transition(&empty, &selecting_sound(&empty), SOUND_WAV)
                .is_err()
        );
        assert_eq!(
            storage
                .load_or_migrate(&[], 200)
                .unwrap()
                .settings
                .custom_sound_id,
            None
        );
        assert_eq!(
            fs::read(storage.sound_root()).unwrap(),
            b"not a sound directory"
        );
    }

    #[test]
    fn daily_and_preupgrade_backups_keep_their_selected_sound() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        let empty = storage.load_or_migrate(&[], 100).unwrap();
        let mut first = selecting_sound(&empty);
        first.create("ensure daily backups", None, 100).unwrap();
        storage
            .save_sound_transition(&empty, &first, SOUND_WAV)
            .unwrap();
        {
            let guard = storage.connection.lock().unwrap();
            let connection = guard.as_ref().unwrap();
            set_metadata(connection, "last_backup_day", "force-next-rotation").unwrap();
            create_private_backup(
                connection,
                &directory.path().join(format!(
                    "sela.pre-upgrade-v4-{}.sqlite3",
                    uuid::Uuid::new_v4()
                )),
            )
            .unwrap();
        }
        let second = selecting_sound(&first);
        storage
            .save_sound_transition(&first, &second, SOUND_WAV)
            .unwrap();
        let backup = Connection::open_with_flags(
            &storage.backup_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let backup_id: String = backup
            .query_row(
                "SELECT custom_sound_id FROM settings WHERE id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            Some(backup_id.as_str()),
            first.settings.custom_sound_id.as_deref()
        );
        let third = selecting_sound(&second);
        storage
            .save_sound_transition(&second, &third, SOUND_WAV)
            .unwrap();
        assert_eq!(storage.read_custom_sound(&backup_id).unwrap(), SOUND_WAV);
        assert!(
            !sounds::sound_path(
                &storage.sound_root(),
                second.settings.custom_sound_id.as_deref().unwrap()
            )
            .unwrap()
            .exists()
        );
        // A daily rotation must not discard a separately preserved migration snapshot.
        {
            let guard = storage.connection.lock().unwrap();
            set_metadata(guard.as_ref().unwrap(), "last_backup_day", "rotate-again").unwrap();
        }
        storage.save_transition(&third, &third).unwrap();
        assert_eq!(storage.read_custom_sound(&backup_id).unwrap(), SOUND_WAV);
    }

    #[test]
    fn unreadable_backup_defers_cleanup_instead_of_losing_restore_assets() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        let empty = storage.load_or_migrate(&[], 100).unwrap();
        let first = selecting_sound(&empty);
        storage
            .save_sound_transition(&empty, &first, SOUND_WAV)
            .unwrap();
        fs::write(&storage.backup_path, b"unreadable recovery database").unwrap();
        let second = selecting_sound(&first);
        storage
            .save_sound_transition(&first, &second, SOUND_WAV)
            .unwrap();
        assert_eq!(
            storage
                .read_custom_sound(first.settings.custom_sound_id.as_deref().unwrap())
                .unwrap(),
            SOUND_WAV
        );
        assert_eq!(
            storage
                .read_custom_sound(second.settings.custom_sound_id.as_deref().unwrap())
                .unwrap(),
            SOUND_WAV
        );
    }

    #[test]
    fn serialized_sound_lease_protects_pending_uploads_and_reads_from_cleanup() {
        use std::sync::{Arc, mpsc};
        let directory = tempfile::tempdir().unwrap();
        let storage = Arc::new(AppStorage::new(directory.path().join("sela.sqlite3")));
        let empty = storage.load_or_migrate(&[], 100).unwrap();
        let next = selecting_sound(&empty);
        let id = next.settings.custom_sound_id.clone().unwrap();
        // Pause a real upload after writing but before committing. Both ordinary
        // commit cleanup and browser byte reads must wait for the entire lease.
        let lease = storage.lock_sounds();
        sounds::write(&storage.sound_root(), &id, SOUND_WAV).unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();
        let reader = {
            let storage = Arc::clone(&storage);
            let id = id.clone();
            let started = started_tx.clone();
            let results = result_tx.clone();
            std::thread::spawn(move || {
                started.send(()).unwrap();
                results.send(storage.read_custom_sound(&id)).unwrap();
            })
        };
        let committer = {
            let storage = Arc::clone(&storage);
            let next = next.clone();
            let before = empty.clone();
            std::thread::spawn(move || {
                started_tx.send(()).unwrap();
                let result = storage
                    .save_transition(&before, &next)
                    .map(|()| Vec::new())
                    .map_err(|error| error.to_string());
                result_tx.send(result).unwrap();
            })
        };
        started_rx.recv().unwrap();
        started_rx.recv().unwrap();
        assert!(matches!(
            result_rx.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
        {
            let mut connection = storage.lock_connection().unwrap();
            storage
                .save_transition_locked(connection.as_mut().unwrap(), &empty, &next)
                .unwrap();
        }
        drop(lease);
        let results = [
            result_rx.recv().unwrap().unwrap(),
            result_rx.recv().unwrap().unwrap(),
        ];
        assert!(results.iter().any(|bytes| bytes.as_slice() == SOUND_WAV));
        reader.join().unwrap();
        committer.join().unwrap();
        assert_eq!(storage.read_custom_sound(&id).unwrap(), SOUND_WAV);
    }

    #[test]
    fn scheduling_fields_round_trip_and_v2_upgrade_keeps_backup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sela.sqlite3");
        let mut connection = Connection::open(&path).unwrap();
        let tx = connection.transaction().unwrap();
        migrate_schema(&tx).unwrap();
        tx.execute_batch("ALTER TABLE settings ADD COLUMN sound_enabled INTEGER NOT NULL DEFAULT 1; ALTER TABLE settings ADD COLUMN default_snooze_minutes INTEGER NOT NULL DEFAULT 5; INSERT INTO reminders(id,title,created_at,due_at,status) VALUES ('old','old',100,200,'pending'); PRAGMA user_version=2;").unwrap();
        tx.commit().unwrap();
        drop(connection);
        let storage = AppStorage::new(path.clone());
        let before = storage.load_or_migrate(&[], 100).unwrap();
        assert_eq!(before.reminders[0].occurrence_revision, 0);
        assert!(before.reminders[0].occurrence_history.is_empty());
        let schedule = serde_json::from_str(r#"{"kind":"daily","date":"2025-01-01","time":"09:00","weekdays":[],"dates":[],"endDate":null,"timeZone":"UTC"}"#).unwrap();
        let mut after = before.clone();
        let id = after
            .create_scheduled("daily", schedule, 1_735_689_600_000)
            .unwrap();
        let due = after.reminders[1].due_at.unwrap();
        after.resolve(&id, ReminderStatus::Completed, due).unwrap();
        after.snooze(&id, 60_000, due).unwrap();
        storage.save_transition(&before, &after).unwrap();
        drop(storage);
        assert_eq!(
            AppStorage::new(path).load_or_migrate(&[], 200).unwrap(),
            after
        );
        let backup = directory
            .path()
            .read_dir()
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("sela.pre-upgrade-v2-")
            })
            .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&backup).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let connection = Connection::open(backup).unwrap();
        assert_eq!(
            connection
                .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row("SELECT title FROM reminders WHERE id='old'", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "old"
        );
    }

    #[test]
    fn failed_migration_rolls_back_and_keeps_a_recovery_backup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sela.sqlite3");
        let mut connection = Connection::open(&path).unwrap();
        let transaction = connection.transaction().unwrap();
        migrate_schema(&transaction).unwrap();
        transaction.execute_batch("ALTER TABLE settings ADD COLUMN sound_enabled INTEGER NOT NULL DEFAULT 1; ALTER TABLE settings ADD COLUMN default_snooze_minutes INTEGER NOT NULL DEFAULT 5; ALTER TABLE reminders ADD COLUMN snoozed_until INTEGER; INSERT INTO reminders(id,title,created_at,due_at,status) VALUES ('old','kept',100,200,'pending'); PRAGMA user_version=2;").unwrap();
        transaction.commit().unwrap();
        drop(connection);

        let storage = AppStorage::new(path.clone());
        let error = storage.load_or_migrate(&[], 100).unwrap_err();
        let StorageError::UpgradeFailed { recovery_path } = &error else {
            panic!("expected a recovery path, got {error}");
        };
        assert!(Path::new(recovery_path).exists());
        assert!(error.to_string().contains(recovery_path));
        drop(storage);
        let connection = Connection::open(&path).unwrap();
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row("SELECT title FROM reminders WHERE id='old'", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "kept"
        );
        let columns = connection
            .prepare("PRAGMA table_info(reminders)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(!columns.iter().any(|column| column == "schedule"));
        assert!(directory.path().read_dir().unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("sela.pre-upgrade-v2-")
        }));
    }

    #[test]
    fn settings_preferences_persist_across_restart() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sela.sqlite3");
        let storage = AppStorage::new(path.clone());
        let before = storage.load_or_migrate(&[], 100).unwrap();
        assert!(before.settings.sound_enabled);
        assert_eq!(before.settings.default_snooze_minutes, 5);
        let mut after = before.clone();
        after.settings.sound_enabled = false;
        after.settings.sound_choice = crate::domain::SoundChoice::Custom;
        after.settings.custom_sound_id = Some("d6e2b55f-2890-4831-b50b-d16d4a83f432".into());
        after.settings.default_snooze_minutes = 15;
        storage.save_transition(&before, &after).unwrap();
        drop(storage);
        let loaded = AppStorage::new(path).load_or_migrate(&[], 200).unwrap();
        assert!(!loaded.settings.sound_enabled);
        assert_eq!(
            loaded.settings.sound_choice,
            crate::domain::SoundChoice::Custom
        );
        assert_eq!(
            loaded.settings.custom_sound_id.as_deref(),
            Some("d6e2b55f-2890-4831-b50b-d16d4a83f432")
        );
        assert_eq!(loaded.settings.default_snooze_minutes, 15);
    }

    #[test]
    fn upgrade_preserves_a_pre_migration_sqlite_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sela.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE original(value TEXT); INSERT INTO original VALUES ('kept');",
            )
            .unwrap();
        drop(connection);

        let storage = AppStorage::new(path);
        storage.load_or_migrate(&[], 100).unwrap();
        let backup = directory
            .path()
            .read_dir()
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("sela.pre-upgrade-v0-")
            })
            .unwrap();
        let connection = Connection::open(backup).unwrap();
        let value: String = connection
            .query_row("SELECT value FROM original", [], |row| row.get(0))
            .unwrap();
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(value, "kept");
        assert_eq!(version, 0);
    }

    #[test]
    fn sqlite_persists_only_changed_rows_and_keeps_a_daily_backup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sela.sqlite3");
        let storage = AppStorage::new(path.clone());
        let empty = storage.load_or_migrate(&[], 100).unwrap();
        let mut first = empty.clone();
        let id = first.create("first", None, 100).unwrap();
        storage.save_transition(&empty, &first).unwrap();
        assert!(directory.path().join("sela.backup.sqlite3").exists());
        let mut second = first.clone();
        second.create("second", Some(10_000), 200).unwrap();
        storage.save_transition(&first, &second).unwrap();
        let reopened = storage.load_or_migrate(&[], 300).unwrap();
        assert_eq!(reopened.reminders.len(), 2);
        assert_eq!(reopened.reminders[0].id, id);
        assert!(path.exists());
        assert!(directory.path().join("sela.backup.sqlite3").exists());
    }

    #[test]
    fn reopened_occurrence_and_consumed_history_survive_reload() {
        let directory = tempfile::tempdir().unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        let empty = storage.load_or_migrate(&[], 100).unwrap();
        let schedule: crate::scheduling::Schedule = serde_json::from_str(r#"{"kind":"daily","date":"2025-01-01","time":"09:00","weekdays":[],"dates":[],"endDate":null,"timeZone":"UTC"}"#).unwrap();
        let now = 1_735_689_600_000;
        let mut completed = empty.clone();
        let id = completed.create_scheduled("daily", schedule, now).unwrap();
        let due = completed.reminders[0].due_at.unwrap();
        completed
            .resolve(&id, crate::domain::ReminderStatus::Completed, due)
            .unwrap();
        storage.save_transition(&empty, &completed).unwrap();
        let mut reopened = completed.clone();
        let revision = reopened.reminders[0].occurrence_revision;
        reopened
            .reopen(&id, revision, Some((0, due)), due + 1)
            .unwrap();
        storage.save_transition(&completed, &reopened).unwrap();
        let loaded = storage.load_or_migrate(&[], due + 2).unwrap();
        assert_eq!(loaded, reopened);
    }

    #[test]
    fn failed_write_rolls_back_all_changes_and_preserves_backup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sela.sqlite3");
        let storage = AppStorage::new(path.clone());
        let empty = storage.load_or_migrate(&[], 100).unwrap();
        let mut saved = empty.clone();
        saved.create("saved reminder", Some(1_000), 100).unwrap();
        storage.save_transition(&empty, &saved).unwrap();

        let mut changed = saved.clone();
        changed
            .create("rejected reminder", Some(2_000), 200)
            .unwrap();
        changed.settings.alert_style = AlertStyle::Notch;
        {
            let guard = storage.connection.lock().unwrap();
            guard.as_ref().unwrap().execute_batch(
                "CREATE TRIGGER reject_settings BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;",
            ).unwrap();
        }
        assert!(matches!(
            storage.save_transition(&saved, &changed),
            Err(StorageError::WriteFailed)
        ));
        drop(storage);

        let reopened = AppStorage::new(path).load_or_migrate(&[], 300).unwrap();
        assert_eq!(reopened.reminders.len(), 1);
        assert_eq!(reopened.reminders[0].title, "saved reminder");
        assert_eq!(reopened.settings.alert_style, saved.settings.alert_style);
        let backup = AppStorage::new(directory.path().join("sela.backup.sqlite3"))
            .load_or_migrate(&[], 300)
            .unwrap();
        assert_eq!(backup.reminders.len(), 1);
        assert_eq!(backup.reminders[0].title, "saved reminder");
    }

    #[test]
    fn malformed_legacy_data_remains_untouched_and_can_be_retried() {
        let directory = tempfile::tempdir().unwrap();
        let legacy = directory.path().join("legacy.json");
        fs::write(&legacy, "invalid json").unwrap();
        let storage = AppStorage::new(directory.path().join("sela.sqlite3"));
        assert!(matches!(
            storage.load_or_migrate(std::slice::from_ref(&legacy), 100),
            Err(StorageError::MigrationFailed)
        ));
        assert_eq!(fs::read_to_string(&legacy).unwrap(), "invalid json");

        let json = r#"{"version":1,"reminders":[{"id":"old","title":"legacy","createdAt":100,"dueAt":2000,"status":"pending"}],"settings":{"alertStyle":"notch"}}"#;
        fs::write(&legacy, json).unwrap();
        let document = storage.load_or_migrate(&[legacy], 200).unwrap();
        assert_eq!(document.reminders.len(), 1);
        assert_eq!(document.reminders[0].id, "old");
    }

    #[test]
    fn legacy_json_migrates_once_inside_sqlite_and_source_stays_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let legacy = directory.path().join("legacy.json");
        let json = r#"{"version":1,"reminders":[{"id":"old","title":"legacy","createdAt":100,"dueAt":2000,"status":"pending"}],"settings":{"alertStyle":"notch"}}"#;
        fs::write(&legacy, json).unwrap();
        let storage = AppStorage::new(directory.path().join("production/sela.sqlite3"));
        let document = storage
            .load_or_migrate(std::slice::from_ref(&legacy), 500)
            .unwrap();
        assert_eq!(document.reminders[0].id, "old");
        assert_eq!(document.settings.alert_style, AlertStyle::Notch);
        assert_eq!(fs::read_to_string(&legacy).unwrap(), json);
        fs::write(&legacy, "changed after import").unwrap();
        assert_eq!(
            storage.load_or_migrate(&[legacy], 900).unwrap().reminders[0].id,
            "old"
        );
    }

    #[test]
    fn newer_database_schema_is_never_downgraded_or_rewritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sela.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection
            .pragma_update(None, "user_version", DB_SCHEMA_VERSION + 5)
            .unwrap();
        drop(connection);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        }
        let original = fs::read(&path).unwrap();
        let permissions = fs::metadata(&path).unwrap().permissions();
        let storage = AppStorage::new(path.clone());
        assert!(matches!(
            storage.load_or_migrate(&[], 100),
            Err(StorageError::NewerVersion)
        ));
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(fs::metadata(&path).unwrap().permissions(), permissions);
        let connection = Connection::open(path).unwrap();
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, DB_SCHEMA_VERSION + 5);
    }

    #[test]
    fn corrupt_sqlite_and_json_sources_are_never_reset_silently() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sela.sqlite3");
        fs::write(&path, "not sqlite").unwrap();
        let storage = AppStorage::new(path.clone());
        assert!(storage.load_or_migrate(&[], 100).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "not sqlite");
        assert!(directory.path().read_dir().unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("corrupt")
        }));
    }
}
