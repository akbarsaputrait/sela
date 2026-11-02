use crate::{
    commands,
    domain::{AlertStyle, Appearance, ColorTheme, ReminderStatus},
    runtime::AppRuntime,
    storage::{self, AppStorage},
    windows,
};
use std::{sync::Arc, time::Duration};
use tauri::Manager;

async fn wait_for(label: &str, check: impl Fn() -> bool) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    while tokio::time::Instant::now() < deadline {
        if check() {
            println!("SMOKE PASS: {label}");
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err(format!("Timed out: {label}"))
}

async fn run(app: &tauri::AppHandle) -> Result<(), String> {
    let runtime = app.state::<Arc<AppRuntime>>();
    wait_for("all webviews loaded", || runtime.ready_window_count() == 3).await?;

    let document = runtime.document();
    if document.reminders.len() != 1
        || document.reminders[0].id != "legacy"
        || document.migration.is_none()
    {
        return Err("Legacy migration did not preserve its source record.".into());
    }
    println!("SMOKE PASS: prototype JSON migrated into SQLite");

    runtime
        .mutate_document(|document| {
            document.settings.appearance = Appearance::Dark;
            document.settings.color_theme = ColorTheme::Cobalt;
            document.settings.onboarding_completed = true;
            Ok(())
        })
        .await?;
    windows::apply_appearance(app, Appearance::Dark);
    let main = app
        .get_webview_window("main")
        .ok_or("Dashboard window did not open.")?;
    wait_for("native windows applied the selected theme", || {
        matches!(main.theme(), Ok(tauri::Theme::Dark))
    })
    .await?;

    windows::open_capture(app);
    let capture = app
        .get_webview_window("capture")
        .ok_or("Quick-add window did not open.")?;
    wait_for("quick add is visible and focused", || {
        capture.is_visible().unwrap_or(false) && capture.is_focused().unwrap_or(false)
    })
    .await?;
    let position = capture
        .outer_position()
        .map_err(|_| "Could not position quick add.")?;
    let monitor = capture
        .current_monitor()
        .map_err(|_| "Could not inspect the current display.")?
        .ok_or("No display is available.")?;
    if position.y != monitor.work_area().position.y {
        return Err("Quick add did not position below the menu bar.".into());
    }
    windows::hide_capture(app);

    windows::open_dashboard(app);
    wait_for("dashboard is visible", || {
        main.is_visible().unwrap_or(false)
    })
    .await?;
    windows::open_capture(app);
    wait_for(
        "dashboard stays visible when another window is focused",
        || capture.is_focused().unwrap_or(false) && main.is_visible().unwrap_or(false),
    )
    .await?;
    windows::hide_capture(app);
    windows::hide_dashboard(app);

    let timer_id = runtime
        .mutate_document(|document| {
            document
                .create("Smoke reminder", Some(1_000), storage::unix_timestamp())
                .map_err(|error| error.to_string())
        })
        .await?;
    commands::publish(app);
    wait_for("native scheduler selected the due reminder", || {
        runtime.snapshot().active_id.as_deref() == Some(&timer_id)
    })
    .await?;
    commands::publish_and_present(app);
    let alert = app
        .get_webview_window("alert")
        .ok_or("Alert window did not open.")?;
    wait_for("full-screen alert is visible", || {
        alert.is_visible().unwrap_or(false)
    })
    .await?;

    let first = runtime.snapshot();
    runtime.dismiss_alert(first.alert_token).await?;
    commands::publish_and_present(app);
    wait_for("dismiss leaves reminder due without reopening", || {
        !alert.is_visible().unwrap_or(true)
            && runtime.snapshot().reminders.iter().any(|reminder| {
                reminder.id == timer_id && reminder.status == ReminderStatus::Pending
            })
    })
    .await?;

    runtime
        .mutate_document({
            let timer_id = timer_id.clone();
            move |document| {
                document
                    .reschedule(&timer_id, 1_000, storage::unix_timestamp())
                    .map_err(|error| error.to_string())
            }
        })
        .await?;
    runtime
        .mutate_document(|document| {
            document.settings.alert_style = AlertStyle::Notch;
            Ok(())
        })
        .await?;
    wait_for("notch reminder becomes due", || {
        runtime.snapshot().active_id.as_deref() == Some(&timer_id)
    })
    .await?;
    commands::publish_and_present(app);
    wait_for("notch alert appears below the menu bar", || {
        let Ok(position) = alert.outer_position() else {
            return false;
        };
        alert.is_visible().unwrap_or(false)
            && alert
                .current_monitor()
                .ok()
                .flatten()
                .is_some_and(|monitor| position.y == monitor.work_area().position.y)
    })
    .await?;

    let before = runtime.entrances();
    for _ in 0..2 {
        let snapshot = runtime.snapshot();
        runtime.dismiss_alert(snapshot.alert_token).await?;
        commands::publish_and_present(app);
        runtime.start_preview().await?;
        commands::publish_and_present(app);
        wait_for("notch preview reopens", || {
            alert.is_visible().unwrap_or(false)
        })
        .await?;
    }
    if runtime.entrances() < before + 2 {
        return Err("The notch entrance animation did not replay.".into());
    }
    println!("SMOKE PASS: notch entrance replays");

    let snapshot = runtime.snapshot();
    runtime.dismiss_alert(snapshot.alert_token).await?;
    runtime
        .mutate_document(|document| {
            document.settings.alert_style = AlertStyle::Native;
            Ok(())
        })
        .await?;
    let token_before_native = runtime.snapshot().alert_token;
    let native_id = runtime
        .mutate_document(|document| {
            document
                .create("Native smoke", Some(1_000), storage::unix_timestamp())
                .map_err(|error| error.to_string())
        })
        .await?;
    wait_for(
        "native delivery hands off without blocking later reminders",
        || {
            let snapshot = runtime.snapshot();
            snapshot.alert_token > token_before_native
                && snapshot.active_id.is_none()
                && snapshot.delivery_error.is_none()
                && snapshot.reminders.iter().any(|reminder| {
                    reminder.id == native_id
                        && reminder.status == ReminderStatus::Pending
                        && reminder
                            .due_at
                            .is_some_and(|due| due <= storage::unix_timestamp())
                })
                && !alert.is_visible().unwrap_or(true)
        },
    )
    .await?;

    let persisted = AppStorage::new(runtime.database_path());
    let document = persisted
        .load_or_migrate(&[], storage::unix_timestamp())
        .map_err(|error| error.to_string())?;
    if document.settings.appearance != Appearance::Dark
        || document.settings.color_theme != ColorTheme::Cobalt
        || !document.settings.onboarding_completed
        || !document
            .reminders
            .iter()
            .any(|reminder| reminder.id == "legacy")
    {
        return Err("Saved settings or migrated reminder did not survive.".into());
    }
    println!("SMOKE PASS: settings and migrated reminder persist in SQLite");
    Ok(())
}

pub fn start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        match run(&app).await {
            Ok(()) => {
                println!("SMOKE COMPLETE");
                app.exit(0);
            }
            Err(error) => {
                eprintln!("SMOKE FAILED: {error}");
                app.exit(1);
            }
        }
    });
}
