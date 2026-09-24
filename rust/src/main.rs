mod cache;
mod cli;
mod config;
mod run;

use cache::{cache_stats, clean_cache, fmt_bytes};
use cli::{CacheArgs, CacheCommand, Cli, Command, RunArgs};
use config::get_cache_root;
use run::{run, RunOptions};

use clap::Parser;

async fn run_command(args: RunArgs) -> Result<(), Box<dyn std::error::Error>> {
    if args.node.is_some() {
        eprintln!("ntsx: note: --node is reserved and currently ignored");
    }

    let is_eval = args.eval.is_some();

    let (script, script_args) = if is_eval {
        let effective_script_args = match args.script {
            Some(s) => std::iter::once(s).chain(args.script_args).collect(),
            None => args.script_args,
        };
        (None, effective_script_args)
    } else {
        (args.script, args.script_args)
    };

    let exit_code = run(RunOptions {
        with_list: args.with,
        script,
        eval_code: args.eval,
        script_args,
        quiet: args.quiet,
        eval_runtime: args.eval_runtime,
        tsx_args: args.tsx_args,
        node_args: args.node_args,
        npm_args: args.npm_args,
        debug: args.debug,
    })
    .await?;

    if exit_code != 0 {
        std::process::exit(exit_code);
    }

    Ok(())
}

async fn cache_command(args: CacheArgs) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        CacheCommand::Clean { force } => {
            let result = clean_cache(force).await?;

            if result.cleared {
                println!("Cache cleared (freed {})", fmt_bytes(result.size_freed));
            } else if result.size_freed == 0 {
                println!("Cache does not exist or is empty");
            } else {
                println!("Aborted");
            }
        }

        CacheCommand::Stats => {
            let stats = cache_stats().await?;

            if !stats.exists {
                println!("No cache at {}", get_cache_root().display());
                return Ok(());
            }

            println!("Cache: {}", get_cache_root().display());
            println!("Workspaces: {}", stats.workspace_count);
            println!("Size: {}", fmt_bytes(stats.size_bytes));
        }
    }

    Ok(())
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Command::Run(args) => run_command(args).await,
        Command::Cache(args) => cache_command(args).await,
    };

    if let Err(error) = result {
        eprintln!("ntsx: {error}");
        std::process::exit(1);
    }
}
