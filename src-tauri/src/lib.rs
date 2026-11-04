mod commands;
mod domain;
mod notifications;
mod runtime;
mod scheduling;
mod sounds;
mod storage;
mod windows;

#[cfg(debug_assertions)]
mod smoke;

use crate::{runtime::AppRuntime, storage::AppStorage};
use log::LevelFilter;
use std::{path::PathBuf, sync::Arc};
use tauri::{Emitter, Manager, RunEvent, webview::PageLoadEvent};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_opener::OpenerExt;

struct StartupVisibility(bool);

fn external_navigation_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("external-navigation")
        .on_navigation(|webview, url| {
            let internal_host = matches!(
                url.host_str(),
                Some("localhost") | Some("127.0.0.1") | Some("tauri.localhost") | Some("::1")
            );
            if url.scheme() == "tauri" || internal_host {
                return true;
            }
            if matches!(url.scheme(), "http" | "https" | "mailto" | "tel") {
                log::info!("opening external URL: {url}");
                let _ = webview.opener().open_url(url.as_str(), None::<&str>);
                return false;
            }
            false
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_targets = {
        #[cfg(debug_assertions)]
        {
            vec![
                Target::new(TargetKind::Stdout),
                Target::new(TargetKind::LogDir { file_name: None }),
                Target::new(TargetKind::Webview),
            ]
        }
        #[cfg(not(debug_assertions))]
        {
            vec![
                Target::new(TargetKind::Stdout),
                Target::new(TargetKind::LogDir { file_name: None }),
            ]
        }
    };

    let log_level = if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Warn
    };
    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log_level)
                .targets(log_targets)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if !args.iter().any(|argument| argument == "--background") {
                windows::open_dashboard(app);
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        windows::toggle_capture(app);
                    }
                })
                .build(),
        )
        .plugin(external_navigation_plugin())
        .setup(setup)
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && matches!(payload.event(), PageLoadEvent::Finished)
                && webview.app_handle().state::<StartupVisibility>().0
            {
                windows::open_dashboard(webview.app_handle());
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle();
                if window.label() == "alert" {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let runtime = app.state::<Arc<AppRuntime>>();
                        let token = runtime.snapshot().alert_token;
                        if runtime.dismiss_alert(token).await.is_ok() {
                            commands::publish_and_present(&app);
                        }
                    });
                } else if window.label() == "main" {
                    windows::hide_dashboard(app);
                } else {
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::mark_window_ready,
            commands::get_snapshot,
            commands::get_notification_permission,
            commands::take_requested_dashboard_tab,
            commands::resize_capture,
            commands::clear_resolved_history,
            commands::reopen_reminder,
            commands::edit_timer_reminder,
            commands::create_reminder,
            commands::create_scheduled_reminder,
            commands::edit_scheduled_reminder,
            commands::rename_reminder,
            commands::change_reminder,
            commands::dismiss_alert,
            commands::preview_alert,
            commands::set_alert_style,
            commands::set_sound_enabled,
            commands::set_sound_choice,
            commands::upload_custom_sound,
            commands::get_custom_sound,
            commands::set_default_snooze_minutes,
            commands::retry_failed_deliveries,
            commands::set_appearance,
            commands::complete_onboarding,
            commands::get_launch_at_login,
            commands::set_launch_at_login,
            commands::show_capture,
            commands::hide_capture,
            commands::show_dashboard,
            commands::hide_dashboard,
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build Sela");
    app.run(|_app, event| {
        if matches!(event, RunEvent::ExitRequested { .. }) {
            log::info!("Sela is shutting down");
        }
    });
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    let smoke_test =
        cfg!(debug_assertions) && args.iter().any(|argument| argument == "--smoke-test");
    let background = args.iter().any(|argument| argument == "--background");

    let (storage_path, legacy_path) = storage_paths(app, smoke_test)?;
    let storage = AppStorage::new(storage_path);
    let loaded = storage.load_or_migrate(&legacy_path, storage::unix_timestamp());
    let (document, storage_error) = match loaded {
        Ok(document) => (document, None),
        Err(error) => {
            log::error!("storage unavailable: {error}");
            (domain::Document::default(), Some(error.to_string()))
        }
    };
    let show_main = !smoke_test && !background && !document.settings.onboarding_completed;
    let appearance = document.settings.appearance;
    let launch_at_login = app.autolaunch().is_enabled().unwrap_or_else(|error| {
        log::warn!("could not read Launch at Login state: {error}");
        false
    });
    let runtime = Arc::new(AppRuntime::new(
        document,
        storage,
        storage_error,
        launch_at_login,
    ));
    app.manage(Arc::clone(&runtime));
    app.manage(StartupVisibility(show_main));

    windows::create_auxiliary_windows(app)?;
    windows::apply_appearance(app.handle(), appearance);
    configure_shortcut(app, &runtime);
    configure_tray(app)?;

    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    start_scheduler(app.handle().clone());

    #[cfg(debug_assertions)]
    if smoke_test {
        smoke::start(app.handle().clone());
    }
    Ok(())
}

fn storage_paths(
    app: &tauri::App,
    smoke_test: bool,
) -> Result<(PathBuf, Vec<PathBuf>), Box<dyn std::error::Error>> {
    if smoke_test {
        let root = std::env::temp_dir().join(format!("sela-smoke-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root)?;
        let legacy = root.join("legacy.json");
        std::fs::write(
            &legacy,
            r#"{"version":1,"reminders":[{"id":"legacy","title":"Legacy reminder","createdAt":100,"dueAt":null,"status":"pending"}],"settings":{"alertStyle":"fullscreen"}}"#,
        )?;
        return Ok((root.join("production/sela.sqlite3"), vec![legacy]));
    }

    let app_data = app.path().app_data_dir()?;
    let production = app_data.join("sela.sqlite3");
    let mut legacy = vec![app_data.join("sela.json")];
    #[cfg(target_os = "macos")]
    if app.config().identifier != "com.akbarsaputrait.sela.reliability-test"
        && let Ok(home) = app.path().home_dir()
    {
        legacy
            .push(home.join("Library/Application Support/local.reminder.prototype/reminders.json"));
    }
    Ok((production, legacy))
}

fn configure_shortcut(app: &tauri::App, runtime: &AppRuntime) {
    let error = app
        .global_shortcut()
        .register("CommandOrControl+Shift+Space")
        .err()
        .map(|error| {
            log::warn!("global shortcut unavailable: {error}");
            "⌘⇧Space is used by another app. Use the Sela menu-bar icon for now.".to_owned()
        });
    runtime.set_shortcut_error(error);
}

fn configure_tray(app: &tauri::App) -> tauri::Result<()> {
    let menu = tauri::menu::Menu::with_items(
        app,
        &[
            &tauri::menu::MenuItem::with_id(
                app,
                "capture",
                "New reminder — ⌘⇧Space",
                true,
                None::<&str>,
            )?,
            &tauri::menu::PredefinedMenuItem::separator(app)?,
            &tauri::menu::MenuItem::with_id(app, "activities", "Activities", true, None::<&str>)?,
            &tauri::menu::MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?,
            &tauri::menu::MenuItem::with_id(app, "about", "About Sela", true, None::<&str>)?,
            &tauri::menu::PredefinedMenuItem::separator(app)?,
            &tauri::menu::MenuItem::with_id(app, "quit", "Quit Sela", true, None::<&str>)?,
        ],
    )?;
    tauri::tray::TrayIconBuilder::new()
        .icon(
            app.default_window_icon()
                .cloned()
                .expect("default app icon is configured"),
        )
        .tooltip("Sela")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => windows::open_capture(app),
            "activities" | "settings" | "about" => {
                app.state::<Arc<AppRuntime>>()
                    .request_dashboard_tab(event.id.as_ref());
                windows::open_dashboard(app);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("sela://dashboard-tab", event.id.as_ref());
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn start_scheduler(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let runtime = app.state::<Arc<AppRuntime>>();
            if runtime.reconcile_due(storage::unix_timestamp()).await {
                commands::publish_and_present(&app);
            }
            let delay = runtime.next_scheduler_delay(storage::unix_timestamp());
            runtime.wait_for_scheduler_or_timeout(delay).await;
        }
    });
}
