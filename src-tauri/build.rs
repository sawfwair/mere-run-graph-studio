fn main() {
    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("src/sparkle.m")
            .flag("-fobjc-arc")
            .compile("graph_studio_sparkle");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }
    tauri_build::build()
}
