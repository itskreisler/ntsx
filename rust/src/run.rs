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

/// Check if a file is encoded in UTF-8 or a non-UTF-8 encoding (UTF-16 LE/BE)
/// Returns Some(encoding_name) if non-UTF-8, None if UTF-8 or unreadable
fn detect_non_utf8_encoding(path: &PathBuf) -> Option<String> {
    use std::io::Read;
    let mut file = fs::File::open(path).ok()?;
    let mut buf = [0u8; 4];
    let bytes_read = file.read(&mut buf).ok()?;
    
    if bytes_read < 2 {
        return None; // Too small to determine
    }
    
    // Check for UTF-16 LE BOM (FF FE)
    if buf[0] == 0xFF && buf[1] == 0xFE {
        return Some("UTF-16 LE".to_string());
    }
    
    // Check for UTF-16 BE BOM (FE FF)
    if buf[0] == 0xFE && buf[1] == 0xFF {
        return Some("UTF-16 BE".to_string());
    }
    
    // Check for UTF-8 BOM (EF BB BF) - this is valid UTF-8, no warning needed
    if bytes_read >= 3 && buf[0] == 0xEF && buf[1] == 0xBB && buf[2] == 0xBF {
        return None;
    }
    
    // Check for null bytes in first 4 bytes (indicates UTF-16 without BOM)
    if buf[0] == 0x00 || buf[1] == 0x00 {
        return Some("UTF-16 (no BOM)".to_string());
    }
    
    None
}

fn split_args(raws: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for raw in raws {
        for token in raw.split_whitespace() {
            let t = token.trim_matches(|c| c == '\'' || c == '"');
            if !t.is_empty() {
                out.push(t.to_string());
            }
        }
    }
    out
}

fn dev_log(debug: bool, msg: &str) {
    if debug {
        eprintln!("[ntsx:debug] {}", msg);
    }
}

fn which(bin: &str) -> Option<PathBuf> {
    if let Ok(path_env) = env::var("PATH") {
        for dir in env::split_paths(&path_env) {
            // On Windows, prefer .exe over .cmd to avoid issues with paths containing spaces
            #[cfg(windows)]
            {
                let cand_exe = dir.join(format!("{bin}.exe"));
                if cand_exe.is_file() {
                    return Some(cand_exe);
                }
            }
            // On Windows, skip files without extension (likely shell scripts from nvm)
            #[cfg(windows)]
            {
                let cand_cmd = dir.join(format!("{bin}.cmd"));
                if cand_cmd.is_file() {
                    return Some(cand_cmd);
                }
            }
            #[cfg(not(windows))]
            {
                let candidate = dir.join(bin);
                if candidate.is_file() {
                    return Some(candidate);
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
        // On Windows, strip the \\?\ prefix from canonicalized paths to avoid issues with Node.js
        let path_str = abs.to_string_lossy().to_string();
        let clean_path = if cfg!(windows) && path_str.starts_with(r"\\?\") {
            PathBuf::from(&path_str[4..])
        } else {
            abs
        };
        Some(clean_path)
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
        // Check for non-UTF-8 encoding in script files
        if let Some(ref sp) = script_path {
            if let Some(encoding) = detect_non_utf8_encoding(sp) {
                eprintln!(
                    "ntsx: WARNING: Script file '{}' is encoded in {}. \
                    esbuild requires UTF-8 encoding. \
                    Please convert the file to UTF-8 to avoid errors.",
                    sp.display(),
                    encoding
                );
            }
        }

        let is_ts = if let Some(ref sp) = script_path {
            is_ts_file(&sp.to_string_lossy())
        } else {
            opts.eval_runtime == "tsx"
        };

        dev_log(opts.debug, &format!("is_eval: {}, script_path: {:?}", is_eval, script_path));
        dev_log(opts.debug, &format!("is_ts: {}", is_ts));
        dev_log(opts.debug, &format!("node_version: {:?}", opts.node_version));
        dev_log(opts.debug, &format!("with_list: {:?}", opts.with_list));
        dev_log(opts.debug, &format!("target_dir: {:?}", target_dir));
        dev_log(opts.debug, &format!("eval_runtime: {}", opts.eval_runtime));
        dev_log(opts.debug, &format!("tsx_args: {:?}", opts.tsx_args));
        dev_log(opts.debug, &format!("node_args: {:?}", opts.node_args));
        dev_log(opts.debug, &format!("script_args: {:?}", opts.script_args));

        let node_bin = resolve_node_binary(opts.node_version.as_deref(), opts.quiet).await?;
        dev_log(opts.debug, &format!("resolved node_bin: {:?}", node_bin));
        dev_log(opts.debug, &format!("node_bin exists: {}", node_bin.exists()));
        dev_log(opts.debug, &format!("node_bin parent: {:?}", node_bin.parent()));
        
        // If node_bin is just "node" (relative), find the actual binary using which()
        let actual_node_bin = if node_bin.as_os_str() == "node" {
            which("node").unwrap_or(node_bin)
        } else {
            node_bin
        };
        dev_log(opts.debug, &format!("actual_node_bin: {:?}", actual_node_bin));
        dev_log(opts.debug, &format!("actual_node_bin exists: {}", actual_node_bin.exists()));
        dev_log(opts.debug, &format!("actual_node_bin parent: {:?}", actual_node_bin.parent()));
        
        let custom_node_dir = if opts.node_version.is_some() && actual_node_bin.as_os_str() != "node" {
            actual_node_bin.parent().map(|p| p.to_path_buf())
        } else {
            None
        };
        dev_log(opts.debug, &format!("custom_node_dir: {:?}", custom_node_dir));

    // Modify PATH early so `which` searches the correct PATH (including custom Node dir)
    if let Some(c_dir) = &custom_node_dir {
        if let Ok(path_env) = env::var("PATH") {
            let path_sep = if cfg!(windows) { ";" } else { ":" };
            let new_path = format!("{}{path_sep}{path_env}", c_dir.display());
            env::set_var("PATH", &new_path);
            dev_log(opts.debug, &format!("Modified PATH: {}", new_path));
        }
    }

    let mut child_cmd;
    let mut child_args: Vec<String> = Vec::new();

    if is_ts {
            // When using --node, always use npx -y tsx with the custom Node binary
            // to avoid PATH issues with nvm (spaces in paths, etc.)
            if custom_node_dir.is_some() {
                // Use npx from the custom Node's directory
                let npx_path = custom_node_dir.as_ref().unwrap().join(if cfg!(windows) { "npx.cmd" } else { "npx" });
                dev_log(opts.debug, &format!("Using npx from custom Node: {:?}", npx_path));
                child_cmd = Command::new(npx_path);
                child_args.push("-y".to_string());
                child_args.push("tsx".to_string());

                for arg in split_args(&opts.tsx_args) {
                    child_args.push(arg);
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
                // No custom Node: try to find tsx globally first, then fallback to npx -y tsx
                let tsx_bin = which("tsx");
                dev_log(opts.debug, &format!("which tsx: {:?}", tsx_bin));

                if let Some(tsx_path) = tsx_bin {
                    // Use global tsx
                    dev_log(opts.debug, &format!("Using global tsx: {:?}", tsx_path));
                    child_cmd = Command::new(tsx_path);
                } else {
                    // Fallback to npx -y tsx
                    eprintln!("ntsx: tsx not found globally, using 'npx -y tsx' (slower). Recommendation: install tsx globally with 'npm install -g tsx'");
                    let node_dir = actual_node_bin.parent().unwrap();
                    let npx_path = if cfg!(windows) {
                        // Try npx.exe first, then npx.cmd (nvm uses .cmd)
                        let npx_exe = node_dir.join("npx.exe");
                        if npx_exe.exists() {
                            npx_exe
                        } else {
                            node_dir.join("npx.cmd")
                        }
                    } else {
                        node_dir.join("npx")
                    };
                    dev_log(opts.debug, &format!("Using npx from node directory: {:?}", npx_path));
                    dev_log(opts.debug, &format!("npx_path exists: {}", npx_path.exists()));
                    child_cmd = Command::new(npx_path);
                    child_args.push("-y".to_string());
                    child_args.push("tsx".to_string());
                }

                for arg in split_args(&opts.tsx_args) {
                    child_args.push(arg);
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
            }
        } else {
            // JS execution
            dev_log(opts.debug, &format!("Running JS with actual_node_bin: {:?}", actual_node_bin));
            dev_log(opts.debug, &format!("actual_node_bin exists: {}", actual_node_bin.exists()));
            child_cmd = Command::new(&actual_node_bin);

            for arg in split_args(&opts.node_args) {
                child_args.push(arg);
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

        dev_log(opts.debug, &format!("Executing command: {:?} {:?}", child_cmd.get_program(), child_args));
        child_cmd.args(&child_args);

        // Capture stderr to provide better error messages
        let mut child = child_cmd
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| {
                format!(
                    "Failed to spawn process '{}': {}. \
                    Ensure the binary exists and is executable.",
                    child_cmd.get_program().display(),
                    e
                )
            })?;

        let mut stderr_output = String::new();
        if let Some(mut stderr) = child.stderr.take() {
            use std::io::Read;
            let _ = stderr.read_to_string(&mut stderr_output);
        }

        let status = child.wait().map_err(|e| {
            format!(
                "Failed to wait for process '{}': {}",
                child_cmd.get_program().display(),
                e
            )
        })?;

        // If the process failed and we captured stderr, show it
        if !status.success() && !stderr_output.trim().is_empty() {
            eprintln!("\n--- Process stderr ---\n{}\n----------------------", stderr_output.trim());
        }

        Ok(status.code().unwrap_or(1))
    }
    .await;

    if let Some(s) = stash {
        let _ = restore_node_modules(&target_dir.join("node_modules"), s).await;
    }

    result
}
