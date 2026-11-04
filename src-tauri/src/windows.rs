use crate::domain::Appearance;
use crate::runtime::AppRuntime;
use std::sync::Arc;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const CAPTURE_WIDTH: f64 = 640.0;
pub const CAPTURE_HEIGHT: f64 = 180.0;
const CAPTURE_SCHEDULE_HEIGHT: f64 = 700.0;
const CAPTURE_FALLBACK_WIDTH: f64 = 480.0;
const CAPTURE_FALLBACK_HEIGHT: f64 = 360.0;
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
    .inner_size(CAPTURE_FALLBACK_WIDTH, CAPTURE_HEIGHT)
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
    let monitor = monitor_under_cursor(app).or_else(|| window.current_monitor().ok().flatten());
    if let Err(error) = fit_capture_to_monitor(&window, false, monitor) {
        log::warn!("could not position Quick Add: {error}");
    }
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("sela://capture-open", ());
}

pub fn resize_capture(app: &tauri::AppHandle, scheduled: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("capture") else {
        return Ok(());
    };
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    fit_capture_to_monitor(&window, scheduled, monitor)
}

fn fit_capture_to_monitor(
    window: &tauri::WebviewWindow,
    scheduled: bool,
    monitor: Option<tauri::Monitor>,
) -> tauri::Result<()> {
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let (size, position) = capture_frame(
            scheduled,
            monitor.scale_factor(),
            area.position.x,
            area.position.y,
            area.size.width,
            area.size.height,
        );
        window.set_size(size)?;
        window.set_position(position)?;
    } else {
        // If monitor discovery is unavailable, do not expand to a potentially offscreen form.
        window.set_size(tauri::LogicalSize::new(
            CAPTURE_FALLBACK_WIDTH,
            if scheduled {
                CAPTURE_FALLBACK_HEIGHT
            } else {
                CAPTURE_HEIGHT
            },
        ))?;
    }
    Ok(())
}

fn capture_frame(
    scheduled: bool,
    scale: f64,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> (tauri::PhysicalSize<u32>, tauri::PhysicalPosition<i32>) {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let capture_width = ((CAPTURE_WIDTH * scale).round() as u32)
        .max(1)
        .min(width.max(1));
    let desired_height = if scheduled {
        CAPTURE_SCHEDULE_HEIGHT
    } else {
        CAPTURE_HEIGHT
    };
    let capture_height = ((desired_height * scale).round() as u32)
        .max(1)
        .min(height.max(1));
    let centered_x = i64::from(x) + (i64::from(width) - i64::from(capture_width)) / 2;
    (
        tauri::PhysicalSize::new(capture_width, capture_height),
        tauri::PhysicalPosition::new(
            centered_x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
            y,
        ),
    )
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
#[cfg(test)]
mod capture_tests {
    use super::capture_frame;

    #[test]
    fn capture_is_top_centered_inside_the_work_area() {
        let (size, position) = capture_frame(false, 1.0, 0, 24, 1920, 1056);
        assert!(size.width <= 1920 && size.height <= 1056);
        assert_eq!(position.x, (1920 - size.width as i32) / 2);
        assert_eq!(position.y, 24);
    }

    #[test]
    fn scheduled_capture_clamps_both_dimensions_on_a_small_scaled_monitor() {
        let (size, position) = capture_frame(true, 2.0, -1024, 40, 1024, 600);
        assert_eq!(size, tauri::PhysicalSize::new(1024, 600));
        assert_eq!(position, tauri::PhysicalPosition::new(-1024, 40));
    }

    #[test]
    fn compact_capture_also_fits_a_narrow_short_work_area() {
        let (size, position) = capture_frame(false, 1.5, 100, -500, 300, 100);
        assert_eq!(size, tauri::PhysicalSize::new(300, 100));
        assert_eq!(position, tauri::PhysicalPosition::new(100, -500));
    }

    #[test]
    fn scheduled_capture_keeps_its_desired_size_when_the_work_area_allows_it() {
        let (size, position) = capture_frame(true, 2.0, -2560, 25, 2560, 1800);
        assert_eq!(size, tauri::PhysicalSize::new(1280, 1400));
        assert_eq!(position, tauri::PhysicalPosition::new(-1920, 25));
    }

    #[test]
    fn unavailable_scale_uses_conservative_unscaled_dimensions() {
        let actual = capture_frame(false, 0.0, 0, 20, 800, 600);
        let expected = capture_frame(false, 1.0, 0, 20, 800, 600);
        assert_eq!(actual, expected);
    }
}
