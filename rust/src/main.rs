use std::env;
use std::path::PathBuf;
use std::process::Command;

fn get_dist_ntsx() -> PathBuf {
    if let Ok(path) = env::var("NTSX_DIST_PATH") {
        return PathBuf::from(path);
    }
    if let Ok(mut exe) = env::current_exe() {
        exe.pop(); // remove binary name
        exe.pop(); // remove release
        exe.pop(); // remove target
        let dist = exe.join("dist").join("ntsx.js");
        if dist.exists() {
            return dist;
        }
    }
    let cwd_dist = PathBuf::from("dist").join("ntsx.js");
    if cwd_dist.exists() {
        return cwd_dist;
    }
    PathBuf::from("/app/dist/ntsx.js")
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let dist_ntsx = get_dist_ntsx();

    let status = Command::new("node")
        .arg(&dist_ntsx)
        .args(&args)
        .status()
        .expect("failed to execute node dist/ntsx.js");

    std::process::exit(status.code().unwrap_or(1));
}
