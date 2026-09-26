use clap::{Args, Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(
    name = "ntsx",
    about = "Run Node/TS scripts with ephemeral dependencies (uv-style --with)",
    version,
    after_help = "\
Examples:
  ntsx run --with axios --with jsdom script.ts
  ntsx run --with chalk@^4 script.js arg1
  ntsx run -e \"import { JSDOM } from 'jsdom'; console.log(typeof JSDOM)\"

Dependencies are installed to ~/.cache/ntsx and linked via a node_modules symlink.
"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Run a script or inline code with ephemeral dependencies
    Run(RunArgs),

    /// Generate a <script>.lock lockfile for a script and its dependencies
    Lock(LockArgs),

    /// Run ephemeral developer tools
    Tool(ToolArgs),

    /// Manage the ntsx dependency cache
    Cache(CacheArgs),
}

#[derive(Args, Debug)]
pub struct LockArgs {
    /// Ephemeral dependency specifier.
    #[arg(short = 'w', long = "with")]
    pub with: Vec<String>,

    /// Script file path.
    pub script: String,
}

#[derive(Args, Debug)]
pub struct ToolArgs {
    #[command(subcommand)]
    pub command: Option<ToolCommand>,

    /// Default tool name
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub tool_args: Vec<String>,
}

#[derive(Subcommand, Debug)]
pub enum ToolCommand {
    /// Run a developer tool ephemerally
    Run {
        /// Tool package name
        tool: String,
        /// Arguments passed to tool
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
}

#[derive(Args, Debug)]
pub struct RunArgs {
    /// Ephemeral dependency.
    #[arg(short = 'w', long = "with")]
    pub with: Vec<String>,

    /// Evaluate inline code.
    #[arg(short = 'e', long = "eval")]
    pub eval: Option<String>,

    /// Runtime for inline eval.
    #[arg(
        long = "eval-runtime",
        value_parser = ["tsx", "node"],
        default_value = "tsx"
    )]
    pub eval_runtime: String,

    /// Flags forwarded to tsx.
    #[arg(long = "tsx-args", allow_hyphen_values = true)]
    pub tsx_args: Vec<String>,

    /// Flags forwarded to node.
    #[arg(long = "node-args", allow_hyphen_values = true)]
    pub node_args: Vec<String>,

    /// Flags forwarded to npm.
    #[arg(long = "npm-args", allow_hyphen_values = true)]
    pub npm_args: Vec<String>,

    /// Suppress npm install output.
    #[arg(short = 'q', long)]
    pub quiet: bool,

    /// Show internal steps.
    #[arg(short = 'd', long)]
    pub debug: bool,

    /// Pin Node version.
    #[arg(long)]
    pub node: Option<String>,

    /// Script path.
    pub script: Option<String>,

    /// Arguments passed to the script.
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub script_args: Vec<String>,
}

#[derive(Args, Debug)]
pub struct CacheArgs {
    #[command(subcommand)]
    pub command: CacheCommand,
}

#[derive(Subcommand, Debug)]
pub enum CacheCommand {
    /// Delete the entire ntsx cache.
    Clean {
        /// Skip confirmation prompt.
        #[arg(short = 'f', long)]
        force: bool,
    },

    /// Print the absolute path to the cache directory.
    Dir,

    /// Prune unused cache items.
    Prune,

    /// Show cache size and workspace count.
    Stats,
}
