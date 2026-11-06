//! The macOS app menu, with Quit routed through the window's close request.
//!
//! The stock Quit item terminates the app directly, so the web view never
//! hears about it and cannot ask about unsaved changes. This replaces it with
//! an item that closes the main window instead: the front end's close guard
//! then saves, discards, or cancels, and the app exits once the last window
//! is gone.

use tauri::menu::{Menu, MenuEvent, MenuItem, MenuItemKind};
use tauri::{AppHandle, Manager, Runtime};

const QUIT_ID: &str = "studio-quit";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() else {
        return Ok(menu);
    };
    for (position, item) in app_menu.items()?.into_iter().enumerate() {
        let MenuItemKind::Predefined(predefined) = item else {
            continue;
        };
        let text = predefined.text()?;
        if !text.starts_with("Quit") {
            continue;
        }
        let quit = MenuItem::with_id(app, QUIT_ID, text, true, Some("CmdOrCtrl+Q"))?;
        app_menu.remove(&predefined)?;
        app_menu.insert(&quit, position)?;
        break;
    }
    Ok(menu)
}

pub fn handle_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if event.id() != QUIT_ID {
        return;
    }
    match app.get_webview_window("main") {
        Some(window) => {
            if window.close().is_err() {
                app.exit(0);
            }
        }
        None => app.exit(0),
    }
}
