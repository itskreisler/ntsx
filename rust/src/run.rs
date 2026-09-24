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
    pub debug: bool,
}

pub async fn run(opts: RunOptions) -> Result<i32, Box<dyn std::error::Error>> {
    let mut cmd = Command::new("node");
    cmd.arg("dist/ntsx.js").arg("run");

    for w in opts.with_list {
        cmd.arg("--with").arg(w);
    }

    if let Some(eval) = opts.eval_code {
        cmd.arg("-e").arg(eval);
    }

    if opts.eval_runtime != "tsx" {
        cmd.arg("--eval-runtime").arg(opts.eval_runtime);
    }

    for arg in opts.tsx_args {
        cmd.arg("--tsx-args").arg(arg);
    }

    for arg in opts.node_args {
        cmd.arg("--node-args").arg(arg);
    }

    for arg in opts.npm_args {
        cmd.arg("--npm-args").arg(arg);
    }

    if opts.quiet {
        cmd.arg("-q");
    }

    if opts.debug {
        cmd.arg("-d");
    }

    if let Some(script) = opts.script {
        cmd.arg(script);
    }

    if !opts.script_args.is_empty() {
        cmd.arg("--");
        for s_arg in opts.script_args {
            cmd.arg(s_arg);
        }
    }

    let status = cmd.status()?;
    Ok(status.code().unwrap_or(1))
}
