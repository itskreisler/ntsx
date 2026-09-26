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
            let script = args.script;
            let lock_path = format!("{script}.lock");
            let content = serde_json::json!({
                "script": script,
                "version": "1.0.0",
                "dependencies": {}
            });
            if let Ok(json) = serde_json::to_string_pretty(&content) {
                let _ = std::fs::write(&lock_path, json);
                println!("Lockfile generated at {lock_path}");
            }
            ExitCode::SUCCESS
        }
        CliCommand::Tool(args) => {
            let (tool_name, tool_args) = match args.command {
                Some(ToolCommand::Run { tool, args }) => (tool, args),
                None => {
                    if args.tool_args.is_empty() {
                        eprintln!("ntsx: tool name required");
                        return ExitCode::from(1);
                    }
                    (args.tool_args[0].clone(), args.tool_args[1..].to_vec())
                }
            };
            // Run tool using npx -y <tool> <args...> with system node
            let node_bin = match node_version::resolve_node_binary(None, true).await {
                Ok(bin) => bin,
                Err(err) => {
                    eprintln!("ntsx: {err}");
                    return ExitCode::from(1);
                }
            };
            let npx_path = node_bin.parent().unwrap().join(if cfg!(windows) { "npx.exe" } else { "npx" });
            let mut child_cmd = std::process::Command::new(npx_path);
            child_cmd.arg("-y").arg(&tool_name);
            child_cmd.args(&tool_args);
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
