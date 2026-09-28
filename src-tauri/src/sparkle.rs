use tauri::menu::{HELP_SUBMENU_ID, Menu, MenuItem, MenuItemKind};

const CHECK_FOR_UPDATES_ID: &str = "graph_studio_check_for_updates";

unsafe extern "C" {
    fn graph_studio_sparkle_start() -> bool;
    fn graph_studio_sparkle_check_for_updates() -> bool;
}

pub fn install(app: &mut tauri::App) -> tauri::Result<()> {
    // Tauri setup and menu callbacks run on the Cocoa main thread.
    let available = unsafe { graph_studio_sparkle_start() };
    if !available {
        eprintln!("Sparkle is unavailable; update checks are disabled in this app bundle");
    }
    let menu = Menu::default(app.handle())?;
    let item = MenuItem::with_id(
        app,
        CHECK_FOR_UPDATES_ID,
        "Check for Updates…",
        available,
        None::<&str>,
    )?;
    if let Some(MenuItemKind::Submenu(help)) = menu.get(HELP_SUBMENU_ID) {
        help.append(&item)?;
    }
    app.set_menu(menu)?;
    app.on_menu_event(|_, event| {
        if event.id().0 == CHECK_FOR_UPDATES_ID {
            unsafe { graph_studio_sparkle_check_for_updates() };
        }
    });
    Ok(())
}
