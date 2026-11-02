use crate::domain::Appearance;
use crate::runtime::AppRuntime;
use std::sync::Arc;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const CAPTURE_WIDTH: f64 = 640.0;
pub const CAPTURE_HEIGHT: f64 = 132.0;
pub const NOTCH_ALERT_WIDTH: f64 = 560.0;
pub const NOTCH_ALERT_HEIGHT: f64 = 196.0;

pub fn create_auxiliary_windows(app: &tauri::App) -> tauri::Result<()> {
    let alert = WebviewWindowBuilder::new(
        app,
        "alert",
        WebviewUrl::App("index.html?window=alert".into()),
    )
    .title("Sela reminder")
    .visible(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .skip_taskbar(true)
    .inner_size(720.0, 500.0)
    .build()?;
    alert.set_always_on_top(true)?;
    alert.set_visible_on_all_workspaces(true)?;

    let capture = WebviewWindowBuilder::new(
        app,
        "capture",
        WebviewUrl::App("index.html?window=capture".into()),
    )
    .title("Sela quick add")
    .visible(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .inner_size(CAPTURE_WIDTH, CAPTURE_HEIGHT)
    .build()?;
    let capture_handle = capture.clone();
    capture.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            let _ = capture_handle.emit("sela://capture-close", ());
        }
    });
    Ok(())
}

pub fn open_capture(app: &tauri::AppHandle) {
    if !app.state::<Arc<AppRuntime>>().request_capture() {
        return;
    }
    let Some(window) = app.get_webview_window("capture") else {
        return;
    };
    if let Some(monitor) = monitor_under_cursor(app) {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let width = (CAPTURE_WIDTH * scale) as i32;
        let position = tauri::PhysicalPosition::new(
            area.position.x + (area.size.width as i32 - width) / 2,
            area.position.y,
        );
        let _ = window.set_position(position);
    }
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("sela://capture-open", ());
}

pub fn toggle_capture(app: &tauri::AppHandle) {
    match app.get_webview_window("capture") {
        Some(window) if window.is_visible().unwrap_or(false) => {
            let _ = window.emit("sela://capture-close", ());
        }
        _ => open_capture(app),
    }
}

pub fn hide_capture(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.hide();
    }
}

pub fn open_dashboard(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // A visible dashboard should behave like a normal app window, including Cmd-Tab.
        #[cfg(target_os = "macos")]
        if let Err(error) = app.set_activation_policy(tauri::ActivationPolicy::Regular) {
            log::warn!("could not make dashboard switchable: {error}");
        }
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn hide_dashboard(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        #[cfg(target_os = "macos")]
        if let Err(error) = app.set_activation_policy(tauri::ActivationPolicy::Accessory) {
            log::warn!("could not return to menu-bar mode: {error}");
        }
    }
}

pub fn position_notch_alert(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("alert") else {
        return Ok(());
    };
    if let Some(monitor) = monitor_under_cursor(app) {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let width = (NOTCH_ALERT_WIDTH * scale) as i32;
        window.set_size(tauri::LogicalSize::new(
            NOTCH_ALERT_WIDTH,
            NOTCH_ALERT_HEIGHT,
        ))?;
        window.set_position(tauri::PhysicalPosition::new(
            area.position.x + (area.size.width as i32 - width) / 2,
            area.position.y,
        ))?;
    }
    Ok(())
}

pub fn position_fullscreen_alert(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("alert") else {
        return Ok(());
    };
    if let Some(monitor) = monitor_under_cursor(app) {
        window.set_position(*monitor.position())?;
        window.set_size(*monitor.size())?;
    }
    Ok(())
}

pub fn apply_appearance(app: &tauri::AppHandle, appearance: Appearance) {
    let theme = match appearance {
        Appearance::System => None,
        Appearance::Light => Some(tauri::Theme::Light),
        Appearance::Dark => Some(tauri::Theme::Dark),
    };
    for window in app.webview_windows().values() {
        let _ = window.set_theme(theme);
    }
}

fn monitor_under_cursor(app: &tauri::AppHandle) -> Option<tauri::Monitor> {
    app.cursor_position()
        .ok()
        .and_then(|position| {
            app.monitor_from_point(position.x, position.y)
                .ok()
                .flatten()
        })
        .or_else(|| app.primary_monitor().ok().flatten())
}
