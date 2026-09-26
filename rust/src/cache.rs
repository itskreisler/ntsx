use crate::config::get_cache_root;
use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct CacheStats {
    pub exists: bool,
    pub workspace_count: usize,
    pub size_bytes: u64,
}

pub struct CleanCacheResult {
    pub cleared: bool,
    pub size_freed: u64,
}

pub enum StashKind {
    Fresh,
    Link(String),
    Dir(PathBuf),
}

pub struct NodeModulesStash {
    pub kind: StashKind,
}

pub fn fmt_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else if bytes < 1024 * 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.2} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    }
}

pub fn short_hash(input: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in input.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{:016x}", hash)
}

pub fn workspace_hash(target_dir: &Path) -> String {
    short_hash(&target_dir.to_string_lossy())
}

pub fn deps_hash(with_list: &[String]) -> String {
    let mut sorted = with_list.to_vec();
    sorted.sort();
    short_hash(&sorted.join("\0"))
}

pub fn cache_key(with_list: &[String], npm_args: &[String]) -> String {
    let mut combined = vec![deps_hash(with_list)];
    combined.extend(npm_args.iter().cloned());
    short_hash(&combined.join("\0"))
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Ok(meta) = fs::symlink_metadata(&p) {
                if meta.is_dir() {
                    total += dir_size(&p);
                } else {
                    total += meta.len();
                }
            }
        }
    }
    total
}

pub async fn cache_stats() -> Result<CacheStats, Box<dyn std::error::Error>> {
    let root = get_cache_root();
    if !root.exists() {
        return Ok(CacheStats {
            exists: false,
            workspace_count: 0,
            size_bytes: 0,
        });
    }

    let mut workspace_count = 0;
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                workspace_count += 1;
            }
        }
    }

    let size_bytes = dir_size(&root);
    Ok(CacheStats {
        exists: true,
        workspace_count,
        size_bytes,
    })
}

pub async fn clean_cache(force: bool) -> Result<CleanCacheResult, Box<dyn std::error::Error>> {
    let stats = cache_stats().await?;
    if !stats.exists {
        return Ok(CleanCacheResult {
            cleared: false,
            size_freed: 0,
        });
    }

    let size_freed = stats.size_bytes;
    let cache_root = get_cache_root();

    let confirmed = if force {
        true
    } else {
        print!(
            "Delete cache {} ({})? [y/N] ",
            cache_root.display(),
            fmt_bytes(size_freed)
        );
        io::stdout().flush()?;
        let mut input = String::new();
        io::stdin().read_line(&mut input)?;
        let trimmed = input.trim();
        trimmed.eq_ignore_ascii_case("y") || trimmed.eq_ignore_ascii_case("yes")
    };

    if !confirmed {
        return Ok(CleanCacheResult {
            cleared: false,
            size_freed,
        });
    }

    if cache_root.exists() {
        fs::remove_dir_all(&cache_root)?;
    }

    Ok(CleanCacheResult {
        cleared: true,
        size_freed,
    })
}

pub async fn stash_node_modules(p: &Path) -> Result<NodeModulesStash, Box<dyn std::error::Error>> {
    if let Ok(meta) = fs::symlink_metadata(p) {
        if meta.file_type().is_symlink() {
            if let Ok(target) = fs::read_link(p) {
                let cache_root_str = get_cache_root().to_string_lossy().to_string();
                if target.to_string_lossy().contains(&cache_root_str) {
                    let _ = fs::remove_file(p);
                    return Ok(NodeModulesStash {
                        kind: StashKind::Fresh,
                    });
                }
                let _ = fs::remove_file(p);
                return Ok(NodeModulesStash {
                    kind: StashKind::Link(target.to_string_lossy().to_string()),
                });
            }
        } else if meta.is_dir() {
            let backup_path = p
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join(format!(".ntsx-{}.bak", std::process::id()));
            let _ = fs::rename(p, &backup_path);
            return Ok(NodeModulesStash {
                kind: StashKind::Dir(backup_path),
            });
        }
    }
    Ok(NodeModulesStash {
        kind: StashKind::Fresh,
    })
}

pub async fn restore_node_modules(
    p: &Path,
    stash: NodeModulesStash,
) -> Result<(), Box<dyn std::error::Error>> {
    let _ = fs::remove_file(p);
    let _ = fs::remove_dir_all(p);

    match stash.kind {
        StashKind::Link(original_target) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::symlink;
                let _ = symlink(original_target, p);
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::symlink_dir;
                let _ = symlink_dir(original_target, p);
            }
        }
        StashKind::Dir(backup_path) => {
            if backup_path.exists() {
                let _ = fs::rename(backup_path, p);
            }
        }
        StashKind::Fresh => {}
    }
    Ok(())
}

pub fn parse_spec(spec: &str) -> (String, String) {
    if let Some(stripped) = spec.strip_prefix('@') {
        if let Some(at) = stripped.find('@') {
            let name = format!("@{}", &stripped[..at]);
            let ver = &stripped[at + 1..];
            return (name, ver.to_string());
        } else {
            return (spec.to_string(), "*".to_string());
        }
    }
    if let Some(at) = spec.find('@') {
        let (name, ver) = spec.split_at(at);
        (name.to_string(), ver[1..].to_string())
    } else {
        (spec.to_string(), "*".to_string())
    }
}

pub async fn prepare_cache(
    with_list: &[String],
    target_dir: &Path,
    quiet: bool,
    npm_args: &[String],
    _debug: bool,
) -> Result<NodeModulesStash, Box<dyn std::error::Error>> {
    let ws_hash = workspace_hash(target_dir);
    let ws_cache_dir = get_cache_root().join(ws_hash);
    let dep_cache_dir = ws_cache_dir.join(cache_key(with_list, npm_args));
    let cache_node_modules = dep_cache_dir.join("node_modules");

    fs::create_dir_all(&ws_cache_dir)?;
    fs::create_dir_all(&dep_cache_dir)?;

    let pkg_json_path = dep_cache_dir.join("package.json");
    if !pkg_json_path.exists() || !cache_node_modules.exists() {
        let mut deps = BTreeMap::new();
        for spec in with_list {
            let (name, version) = parse_spec(spec);
            deps.insert(name, version);
        }

        let pkg_manifest = serde_json::json!({
            "name": format!("ntsx-cache-{}", deps_hash(with_list)),
            "type": "module",
            "private": true,
            "dependencies": deps
        });

        fs::write(&pkg_json_path, serde_json::to_string_pretty(&pkg_manifest)?)?;

        let mut npm_cmd = Command::new("npm");
        npm_cmd
            .arg("install")
            .arg("--no-audit")
            .arg("--no-fund")
            .current_dir(&dep_cache_dir);
        for extra in npm_args {
            npm_cmd.arg(extra);
        }

        if quiet {
            npm_cmd
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
        }

        let output = npm_cmd.output()?;
        if !output.status.success() {
            let stderr_str = String::from_utf8_lossy(&output.stderr);
            let detail = stderr_str
                .trim()
                .lines()
                .take(8)
                .collect::<Vec<_>>()
                .join("\n");
            return Err(format!("Invalid package spec (expected pkg, pkg@version, @scope/pkg, or @scope/pkg@version)\n\n{detail}").into());
        }
    }

    let target_node_modules = target_dir.join("node_modules");
    let stash = stash_node_modules(&target_node_modules).await?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        symlink(&cache_node_modules, &target_node_modules)?;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::symlink_dir;
        symlink_dir(&cache_node_modules, &target_node_modules)?;
    }

    Ok(stash)
}
