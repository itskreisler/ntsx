use crate::cache::{prepare_cache, restore_node_modules};
use crate::node_version::resolve_node_binary;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub struct RunOptions {
    pub with_list: Vec<String>,
    pub script: Option<String>,
    pub eval_code: Option<String>,
    pub script_args: Vec<String>,
    pub quiet: bool,
    pub eval_runtime: String,
    pub tsx_args: Vec<String>,
    pub node_args: Vec<String>,
    pub npm_args: Vec<String>,
    pub node_version: Option<String>,
    pub debug: bool,
}

fn is_ts_file(p: &str) -> bool {
    p.ends_with(".ts") || p.ends_with(".mts") || p.ends_with(".cts") || p.ends_with(".tsx")
}

fn which(bin: &str) -> Option<PathBuf> {
    if let Ok(path_env) = env::var("PATH") {
        for dir in env::split_paths(&path_env) {
            let candidate = dir.join(bin);
            if candidate.is_file() {
                return Some(candidate);
            }
            #[cfg(windows)]
            {
                let cand_exe = dir.join(format!("{bin}.exe"));
                if cand_exe.is_file() {
                    return Some(cand_exe);
                }
                let cand_cmd = dir.join(format!("{bin}.cmd"));
                if cand_cmd.is_file() {
                    return Some(cand_cmd);
                }
            }
        }
    }
    None
}

pub async fn run(opts: RunOptions) -> Result<i32, Box<dyn std::error::Error>> {
    let is_eval = opts.eval_code.is_some();
    if !is_eval && (opts.script.is_none() || opts.script.as_deref() == Some("")) {
        return Err("A script path or --eval code is required".into());
    }

    let script_path = if is_eval {
        None
    } else {
        let s = opts.script.as_ref().unwrap();
        let abs = fs::canonicalize(s).map_err(|_| format!("Script not found: {s}"))?;
        Some(abs)
    };

    let target_dir = script_path
        .as_ref()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let mut stash = None;
    if !opts.with_list.is_empty() {
        let s = prepare_cache(
            &opts.with_list,
            &target_dir,
            opts.quiet,
            &opts.npm_args,
            opts.debug,
        )
        .await?;
        stash = Some(s);
    }

    let result = async {
        let is_ts = if let Some(ref sp) = script_path {
            is_ts_file(&sp.to_string_lossy())
        } else {
            opts.eval_runtime == "tsx"
        };

        let node_bin = resolve_node_binary(opts.node_version.as_deref()).await?;
        let custom_node_dir =
            if opts.node_version.is_some() && node_bin != env::current_exe().unwrap_or_default() {
                node_bin.parent().map(|p| p.to_path_buf())
            } else {
                None
            };

        let mut child_cmd;
        let mut child_args = Vec::new();

        if is_ts {
            if let Some(tsx_path) = which("tsx") {
                child_cmd = Command::new(tsx_path);
            } else {
                child_cmd = Command::new("npx");
                child_args.push("-y".to_string());
                child_args.push("tsx".to_string());
            }

            for arg in &opts.tsx_args {
                child_args.push(arg.clone());
            }

            if is_eval {
                child_args.push("-e".to_string());
                child_args.push(opts.eval_code.clone().unwrap());
                if !opts.script_args.is_empty() {
                    child_args.push("--".to_string());
                    child_args.extend(opts.script_args.iter().cloned());
                }
            } else {
                child_args.push(script_path.unwrap().to_string_lossy().to_string());
                child_args.extend(opts.script_args.iter().cloned());
            }
        } else {
            child_cmd = Command::new(&node_bin);

            for arg in &opts.node_args {
                child_args.push(arg.clone());
            }

            if is_eval {
                child_args.push("--input-type=module".to_string());
                child_args.push("-e".to_string());
                child_args.push(opts.eval_code.clone().unwrap());
                if !opts.script_args.is_empty() {
                    child_args.push("--".to_string());
                    child_args.extend(opts.script_args.iter().cloned());
                }
            } else {
                child_args.push(script_path.unwrap().to_string_lossy().to_string());
                child_args.extend(opts.script_args.iter().cloned());
            }
        }

        if let Some(c_dir) = custom_node_dir {
            if let Ok(path_env) = env::var("PATH") {
                let new_path =
                    format!("{}{}{path_env}", c_dir.display(), std::path::MAIN_SEPARATOR);
                child_cmd.env("PATH", new_path);
            }
        }

        child_cmd.args(&child_args);

        let mut child = child_cmd.spawn()?;
        let status = child.wait()?;
        Ok(status.code().unwrap_or(1))
    }
    .await;

    if let Some(s) = stash {
        let _ = restore_node_modules(&target_dir.join("node_modules"), s).await;
    }

    result
}
