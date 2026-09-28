use crate::config::get_cache_root;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub fn get_node_cache_root() -> PathBuf {
    get_cache_root().join("node")
}

pub fn get_dist_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "win"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

pub fn get_dist_arch() -> &'static str {
    if cfg!(target_arch = "x86") {
        "x86"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "arm") {
        "armv7l"
    } else {
        "x64"
    }
}

fn which_node() -> Option<PathBuf> {
    if let Ok(path_env) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_env) {
            #[cfg(windows)]
            {
                let cand_exe = dir.join("node.exe");
                if cand_exe.is_file() {
                    return Some(cand_exe);
                }
                let cand_cmd = dir.join("node.cmd");
                if cand_cmd.is_file() {
                    return Some(cand_cmd);
                }
            }
            #[cfg(not(windows))]
            {
                let cand = dir.join("node");
                if cand.is_file() {
                    return Some(cand);
                }
            }
        }
    }
    None
}

pub async fn get_cached_node_binary(requested: &str) -> Option<PathBuf> {
    let clean = requested
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V');
    let bin_relative = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "bin/node"
    };

    let node_root = get_node_cache_root();
    if let Ok(entries) = fs::read_dir(&node_root) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name == clean
                    || name == format!("v{clean}")
                    || name.starts_with(&format!("{clean}."))
                {
                    let candidate = entry.path().join(bin_relative);
                    if candidate.exists() {
                        return Some(candidate);
                    }
                }
            }
        }
    }
    None
}

pub async fn download_node_release(
    requested: &str,
    quiet: bool,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let clean = requested
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V');
    let full_version = if clean.contains('.') {
        format!("v{clean}")
    } else {
        match clean {
            "26" => "v26.10.0".to_string(),
            "24" => "v24.21.0".to_string(),
            "22" => "v22.23.3".to_string(),
            _ => format!("v{clean}.0.0"),
        }
    };

    let plat = get_dist_platform();
    let arch = get_dist_arch();
    let ver_no_v = full_version.trim_start_matches('v');
    let ver_dir = get_node_cache_root().join(ver_no_v);
    let bin_relative = if plat == "win" {
        "node.exe"
    } else {
        "bin/node"
    };
    let expected_bin = ver_dir.join(bin_relative);

    if expected_bin.exists() {
        return Ok(expected_bin);
    }

    fs::create_dir_all(&ver_dir)?;

    let archive_ext = if plat == "win" { "zip" } else { "tar.gz" };
    let archive_name = format!("node-{full_version}-{plat}-{arch}.{archive_ext}");
    let archive_url = format!("https://nodejs.org/dist/{full_version}/{archive_name}");
    let archive_path = get_node_cache_root().join(&archive_name);

    if !quiet {
        eprintln!("ntsx: downloading Node.js {full_version} ({plat}-{arch})...");
    }

    let curl_status = Command::new("curl")
        .arg("-sSL")
        .arg("-f")
        .arg("-H")
        .arg("User-Agent: ntsx")
        .arg("-o")
        .arg(&archive_path)
        .arg(&archive_url)
        .status()?;

    if !curl_status.success() {
        let _ = fs::remove_file(&archive_path);
        return Err(format!("Failed to download {archive_url}").into());
    }

    if plat == "win" {
        let ps_cmd = format!(
            "Expand-Archive -Path \"{}\" -DestinationPath \"{}\" -Force",
            archive_path.display(),
            get_node_cache_root().display()
        );
        let _ = Command::new("powershell")
            .args(["-Command", &ps_cmd])
            .status();
    } else {
        let _ = Command::new("tar")
            .args([
                "-xzf",
                &archive_path.to_string_lossy(),
                "-C",
                &get_node_cache_root().to_string_lossy(),
            ])
            .status();
    }

    let _ = fs::remove_file(&archive_path);

    let extracted_folder = get_node_cache_root().join(format!("node-{full_version}-{plat}-{arch}"));
    if extracted_folder.exists() {
        if let Ok(entries) = fs::read_dir(&extracted_folder) {
            for entry in entries.flatten() {
                let target = ver_dir.join(entry.file_name());
                let _ = fs::rename(entry.path(), target);
            }
        }
        let _ = fs::remove_dir_all(&extracted_folder);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if expected_bin.exists() {
            let _ = fs::set_permissions(&expected_bin, fs::Permissions::from_mode(0o755));
        }
    }

    if expected_bin.exists() {
        Ok(expected_bin)
    } else {
        Err(format!("Node binary not found at {}", expected_bin.display()).into())
    }
}

pub async fn resolve_node_binary(
    version: Option<&str>,
    quiet: bool,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let requested = match version {
        Some(v) if !v.is_empty() && v != "current" => v,
        _ => {
            if let Some(host_node) = which_node() {
                return Ok(host_node);
            }
            return Err("Node.js is not installed or not found on PATH. Recommendation: run with '--node 22' or '--node 24' to download Node.js automatically.".into());
        }
    };

    if let Some(cached) = get_cached_node_binary(requested).await {
        return Ok(cached);
    }

    let downloaded = download_node_release(requested, quiet).await?;
    Ok(downloaded)
}
