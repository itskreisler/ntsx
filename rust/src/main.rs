use std::env;
use std::ffi::OsString;
use std::process::Command;

fn get_dist_ntsx() -> std::path::PathBuf {
    if let Ok(path) = env::var("NTSX_DIST_PATH") {
        return std::path::PathBuf::from(path);
    }
    if let Ok(mut exe) = env::current_exe() {
        exe.pop(); // remove binary name
        exe.pop(); // remove bin
        let dist = exe.join("dist").join("ntsx.js");
        if dist.exists() {
            return dist;
        }
    }
    let cwd_dist = std::path::PathBuf::from("dist").join("ntsx.js");
    if cwd_dist.exists() {
        return cwd_dist;
    }
    std::path::PathBuf::from("/app/dist/ntsx.js")
}

fn main() {
    let raw_args: Vec<OsString> = env::args_os().skip(1).collect();
    let dist_ntsx = get_dist_ntsx();

    let status = Command::new("node")
        .arg(&dist_ntsx)
        .args(&raw_args)
        .status()
        .expect("failed to execute node dist/ntsx.js");

    std::process::exit(status.code().unwrap_or(1));
}
