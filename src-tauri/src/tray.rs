//! macOS menu-bar tray: hide on window close, restore from tray.

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Runtime, WindowEvent,
};

const MAIN_WINDOW: &str = "main";

/// Monochrome template mark for the menu bar (black + alpha; macOS tints it).
const TRAY_ICON_PNG: &[u8] = include_bytes!("../icons/tray-icon.png");

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.hide();
    }
}

fn tray_template_icon() -> tauri::Result<Image<'static>> {
    Image::from_bytes(TRAY_ICON_PNG)
}

/// Install menu-bar tray + close-to-tray behavior (macOS).
pub fn setup_macos_tray(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();

    let show_i = MenuItem::with_id(app, "show", "Show DevTree", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit DevTree", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;

    let icon = tray_template_icon()?;

    let _tray = TrayIconBuilder::with_id("devtree-tray")
        .icon(icon)
        // Template icons are tinted by macOS for light/dark menu bars.
        .icon_as_template(true)
        .menu(&menu)
        .tooltip("DevTree")
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "hide" => hide_main_window(app),
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(&handle);
            }
        })
        .build(app)?;

    Ok(())
}

/// Close button hides the window instead of quitting (macOS).
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        let _ = window.hide();
        api.prevent_close();
    }
}

/// Dock icon click while no windows visible restores the main window.
pub fn on_reopen<R: Runtime>(app: &AppHandle<R>, has_visible_windows: bool) {
    if !has_visible_windows {
        show_main_window(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_icon_png_decodes() {
        let icon = tray_template_icon().expect("tray-icon.png should decode");
        assert!(icon.width() > 0);
        assert!(icon.height() > 0);
    }

    #[test]
    fn main_window_label() {
        assert_eq!(MAIN_WINDOW, "main");
    }
}
