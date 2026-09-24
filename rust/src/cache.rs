use crate::config::get_cache_root;
use std::fs;
use std::io::{self, Write};
use std::path::Path;

pub struct CacheStats {
    pub exists: bool,
    pub workspace_count: usize,
    pub size_bytes: u64,
}

pub struct CleanCacheResult {
    pub cleared: bool,
    pub size_freed: u64,
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
        print!("Delete cache {} ({})? [y/N] ", cache_root.display(), fmt_bytes(size_freed));
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
