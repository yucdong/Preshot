fn main() {
    // Recompile the executable's Windows resources when the brand icon changes.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
