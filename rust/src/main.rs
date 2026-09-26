mod cache;
mod cli;
mod config;
mod node_version;
mod run;

use clap::Parser;
use cli::{CacheCommand, Cli, Command, ToolCommand};
use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();

    match cli.command {
        Command::Run(args) => {
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
                    eprintln!("ntsx: {err}");
                    ExitCode::from(1)
                }
            }
        }
        Command::Lock(args) => {
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
        Command::Tool(args) => {
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
            let opts = run::RunOptions {
                with_list: vec![tool_name],
                script: None,
                eval_code: None,
                script_args: tool_args,
                quiet: true,
                eval_runtime: "node".to_string(),
                tsx_args: vec![],
                node_args: vec![],
                npm_args: vec![],
                node_version: None,
                debug: false,
            };
            match run::run(opts).await {
                Ok(code) => ExitCode::from(code as u8),
                Err(err) => {
                    eprintln!("ntsx: {err}");
                    ExitCode::from(1)
                }
            }
        }
        Command::Cache(args) => match args.command {
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
