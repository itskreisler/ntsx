use crate::config::get_cache_root;
use std::env;
use std::fs;
use std::path::PathBuf;

pub fn get_node_cache_root() -> PathBuf {
    get_cache_root().join("node")
}

#[allow(dead_code)]
pub fn get_dist_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "win"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

#[allow(dead_code)]
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

pub async fn resolve_node_binary(
    version: Option<&str>,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let current_exec = env::current_exe().unwrap_or_else(|_| PathBuf::from("node"));

    let requested = match version {
        Some(v) if !v.is_empty() && v != "current" => v,
        _ => return Ok(current_exec),
    };

    if let Some(cached) = get_cached_node_binary(requested).await {
        return Ok(cached);
    }

    // Default fallback to current host Node binary if not explicitly cached
    Ok(current_exec)
}
