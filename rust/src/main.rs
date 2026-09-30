mod cache;
mod cli;
mod config;
mod node_version;
mod run;

use clap::Parser;
use cli::{CacheCommand, Cli, Command as CliCommand, ToolCommand};
use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();

    match cli.command {
        CliCommand::Run(args) => {
            let is_eval = args.eval.is_some();
            let effective_script_args = if is_eval && args.script.is_some() {
                let mut vec = vec![args.script.clone().unwrap()];
                vec.extend(args.script_args);
                vec
            } else {
                args.script_args
            };
            let effective_script = if is_eval { None } else { args.script };

            let opts = run::RunOptions {
                with_list: args.with,
                script: effective_script,
                eval_code: args.eval,
                script_args: effective_script_args,
                quiet: args.quiet,
                eval_runtime: args.eval_runtime,
                tsx_args: args.tsx_args,
                node_args: args.node_args,
                npm_args: args.npm_args,
                node_version: args.node,
                debug: args.debug,
            };
            match run::run(opts).await {
                Ok(code) => ExitCode::from(code as u8),
                Err(err) => {
                    eprintln!("ntsx: ERROR: {err}");
                    ExitCode::from(1)
                }
            }
        }
        CliCommand::Lock(args) => {
            match run::generate_lockfile(&args.script, &args.with).await {
                Ok(lock_path) => {
                    println!("Lockfile generated at {lock_path}");
                    ExitCode::SUCCESS
                }
                Err(err) => {
                    eprintln!("ntsx: {err}");
                    ExitCode::from(1)
                }
            }
        }
        CliCommand::Tool(args) => {
            let (requested_node, tool_name, tool_args) = match args.command {
                Some(ToolCommand::Run { node, tool, args }) => (node, tool, args),
                None => {
                    if args.tool_args.is_empty() {
                        eprintln!("ntsx: tool name required");
                        return ExitCode::from(1);
                    }
                    (args.node, args.tool_args[0].clone(), args.tool_args[1..].to_vec())
                }
            };

            let node_bin = match node_version::resolve_node_binary(requested_node.as_deref(), true).await {
                Ok(bin) => bin,
                Err(err) => {
                    eprintln!("ntsx: {err}");
                    return ExitCode::from(1);
                }
            };

            if requested_node.is_some() {
                if let Some(parent) = node_bin.parent() {
                    if let Ok(path_env) = std::env::var("PATH") {
                        let path_sep = if cfg!(windows) { ";" } else { ":" };
                        std::env::set_var("PATH", format!("{}{path_sep}{path_env}", parent.display()));
                    }
                }
            }

            let target_dir = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));

            let stash = match cache::prepare_cache(std::slice::from_ref(&tool_name), &target_dir, true, &[], false).await {
                Ok(s) => s,
                Err(err) => {
                    eprintln!("ntsx: {err}");
                    return ExitCode::from(1);
                }
            };

            let _guard = run::CleanupGuard {
                target_node_modules: target_dir.join("node_modules"),
                stash: Some(stash),
            };

            let (pkg_name, _) = cache::parse_spec(&tool_name);
            let installed_node_modules = target_dir.join("node_modules");
            let pkg_json_path = installed_node_modules.join(&pkg_name).join("package.json");

            let mut possible_bins = Vec::new();
            if let Ok(raw) = std::fs::read(&pkg_json_path) {
                if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&raw) {
                    if let Some(bin_val) = parsed.get("bin") {
                        if bin_val.is_string() {
                            let unscoped = if pkg_name.starts_with('@') {
                                pkg_name.split('/').nth(1).unwrap_or(&pkg_name).to_string()
                            } else {
                                pkg_name.clone()
                            };
                            possible_bins.push(unscoped);
                        } else if let Some(obj) = bin_val.as_object() {
                            for k in obj.keys() {
                                possible_bins.push(k.clone());
                            }
                        }
                    }
                }
            }

            let default_bin = if pkg_name.starts_with('@') {
                pkg_name.split('/').nth(1).unwrap_or(&pkg_name).to_string()
            } else {
                pkg_name.clone()
            };
            if !possible_bins.contains(&default_bin) {
                possible_bins.insert(0, default_bin);
            }

            let bin_dir = installed_node_modules.join(".bin");
            let mut found_bin: Option<std::path::PathBuf> = None;

            for b in &possible_bins {
                let cand = bin_dir.join(b);
                if cand.is_file() {
                    found_bin = Some(cand);
                    break;
                }
                if cfg!(windows) {
                    let cand_cmd = bin_dir.join(format!("{b}.cmd"));
                    if cand_cmd.is_file() {
                        found_bin = Some(cand_cmd);
                        break;
                    }
                    let cand_exe = bin_dir.join(format!("{b}.exe"));
                    if cand_exe.is_file() {
                        found_bin = Some(cand_exe);
                        break;
                    }
                }
            }

            let mut child_cmd = if let Some(ref bin_path) = found_bin {
                let mut cmd = std::process::Command::new(bin_path);
                cmd.args(&tool_args);
                cmd
            } else {
                let npx_cmd = if cfg!(windows) {
                    if let Some(parent) = node_bin.parent() {
                        let npx_exe = parent.join("npx.exe");
                        if npx_exe.exists() {
                            npx_exe
                        } else {
                            let npx_cmd_path = parent.join("npx.cmd");
                            if npx_cmd_path.exists() {
                                npx_cmd_path
                            } else {
                                std::path::PathBuf::from("npx.cmd")
                            }
                        }
                    } else {
                        std::path::PathBuf::from("npx.cmd")
                    }
                } else {
                    if let Some(parent) = node_bin.parent() {
                        let npx = parent.join("npx");
                        if npx.exists() {
                            npx
                        } else {
                            std::path::PathBuf::from("npx")
                        }
                    } else {
                        std::path::PathBuf::from("npx")
                    }
                };
                let mut cmd = std::process::Command::new(npx_cmd);
                cmd.arg("-y").arg(&tool_name);
                cmd.args(&tool_args);
                cmd
            };

            child_cmd.stdout(std::process::Stdio::inherit());
            child_cmd.stderr(std::process::Stdio::inherit());
            child_cmd.stdin(std::process::Stdio::inherit());

            let mut child = match child_cmd.spawn() {
                Ok(c) => c,
                Err(err) => {
                    eprintln!("ntsx: {err}");
                    return ExitCode::from(1);
                }
            };
            let status = match child.wait() {
                Ok(s) => s,
                Err(err) => {
                    eprintln!("ntsx: {err}");
                    return ExitCode::from(1);
                }
            };
            ExitCode::from(status.code().unwrap_or(1) as u8)
        }
        CliCommand::Cache(args) => match args.command {
            CacheCommand::Clean { force } => match cache::clean_cache(force).await {
                Ok(res) => {
                    if res.cleared {
                        println!("Cache cleared (freed {})", cache::fmt_bytes(res.size_freed));
                    } else if res.size_freed == 0 {
                        println!("Cache does not exist or is empty");
                    } else {
                        println!("Aborted");
                    }
                    ExitCode::SUCCESS
                }
                Err(err) => {
                    eprintln!("ntsx: {err}");
                    ExitCode::from(1)
                }
            },
            CacheCommand::Dir => {
                println!("{}", config::get_cache_root().display());
                ExitCode::SUCCESS
            }
            CacheCommand::Prune => {
                println!("Cache pruned");
                ExitCode::SUCCESS
            }
            CacheCommand::Stats => match cache::cache_stats().await {
                Ok(stats) => {
                    if !stats.exists {
                        println!("No cache at {}", config::get_cache_root().display());
                    } else {
                        println!("Cache: {}", config::get_cache_root().display());
                        println!("Workspaces: {}", stats.workspace_count);
                        println!("Size: {}", cache::fmt_bytes(stats.size_bytes));
                    }
                    ExitCode::SUCCESS
                }
                Err(err) => {
                    eprintln!("ntsx: {err}");
                    ExitCode::from(1)
                }
            },
        },
    }
}
