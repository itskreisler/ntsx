use std::path::PathBuf;

pub fn home_dir() -> PathBuf {
    if cfg!(windows) {
        std::env::var("USERPROFILE")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("."))
            })
    } else {
        std::env::var("HOME")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    }
}

pub fn get_cache_root() -> PathBuf {
    home_dir().join(".cache").join("ntsx")
}
