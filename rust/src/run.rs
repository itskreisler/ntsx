use crate::cache::{parse_spec, prepare_cache, restore_node_modules, StashKind};
use crate::node_version::resolve_node_binary;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use tokio::process::Command as AsyncCommand;

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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LockfileDependency {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integrity: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LockfileRuntime {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LockfileData {
    pub version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    pub runtime: LockfileRuntime,
    pub dependencies: BTreeMap<String, LockfileDependency>,
}

#[derive(Debug, Default, Clone)]
pub struct ScriptMetadata {
    pub dependencies: Vec<String>,
    pub node: Option<String>,
}

pub struct CleanupGuard {
    pub target_node_modules: PathBuf,
    pub stash: Option<crate::cache::NodeModulesStash>,
}

impl Drop for CleanupGuard {
    fn drop(&mut self) {
        if let Some(stash) = self.stash.take() {
            let target = &self.target_node_modules;
            let _ = fs::remove_file(target);
            let _ = fs::remove_dir_all(target);
            match stash.kind {
                StashKind::Link(ref orig) => {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::symlink;
                        let _ = symlink(orig, target);
                    }
                    #[cfg(windows)]
                    {
                        use std::os::windows::fs::symlink_dir;
                        if symlink_dir(orig, target).is_err() {
                            let _ = crate::cache::copy_dir_all(std::path::Path::new(orig), target);
                        }
                    }
                }
                StashKind::Dir(ref backup_path) => {
                    if backup_path.exists() {
                        let _ = fs::rename(backup_path, target);
                    }
                }
                StashKind::Fresh => {}
            }
        }
    }
}

pub fn read_lockfile(script_path: &Path) -> Option<LockfileData> {
    let lock_path = format!("{}.lock", script_path.display());
    let content = fs::read_to_string(&lock_path).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn parse_script_metadata(script_path: &Path) -> ScriptMetadata {
    let content = match fs::read_to_string(script_path) {
        Ok(c) => c,
        Err(_) => return ScriptMetadata::default(),
    };
    parse_metadata_string(&content)
}

pub fn parse_metadata_string(content: &str) -> ScriptMetadata {
    let mut in_block = false;
    let mut block_lines = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        let is_start = trimmed.starts_with("// /// ntsx")
            || trimmed.starts_with("/// ntsx")
            || (trimmed.starts_with("//") && trimmed.contains("/// ntsx"));

        if is_start {
            in_block = true;
            continue;
        }

        if in_block {
            let is_end = trimmed == "// ///"
                || trimmed == "///"
                || trimmed == "// ///ntsx"
                || trimmed == "///ntsx";
            if is_end {
                break;
            }
            let comment_content = trimmed
                .strip_prefix("// ")
                .or_else(|| trimmed.strip_prefix("//"))
                .or_else(|| trimmed.strip_prefix("/// "))
                .or_else(|| trimmed.strip_prefix("///"))
                .unwrap_or(trimmed);
            block_lines.push(comment_content);
        }
    }

    if block_lines.is_empty() {
        return ScriptMetadata::default();
    }

    let mut dependencies = Vec::new();
    let mut node = None;

    let full_block = block_lines.join("\n");

    if let Some(deps_start) = full_block.find("dependencies") {
        if let Some(bracket_start) = full_block[deps_start..].find('[') {
            let start_idx = deps_start + bracket_start;
            if let Some(bracket_end) = full_block[start_idx..].find(']') {
                let raw_deps = &full_block[start_idx + 1..start_idx + bracket_end];
                for token in raw_deps.split(',') {
                    let cleaned = token.trim().trim_matches(|c| c == '\'' || c == '"').trim();
                    if !cleaned.is_empty() {
                        dependencies.push(cleaned.to_string());
                    }
                }
            }
        }
    }

    if let Some(node_idx) = full_block.find("node") {
        let sub = &full_block[node_idx..];
        if let Some(eq_idx) = sub.find('=') {
            let val_str = sub[eq_idx + 1..].lines().next().unwrap_or("").trim();
            let cleaned = val_str.trim_matches(|c| c == '\'' || c == '"' || c == ';').trim();
            if !cleaned.is_empty() {
                node = Some(cleaned.to_string());
            }
        }
    }

    ScriptMetadata { dependencies, node }
}

pub async fn generate_lockfile(
    script_path_str: &str,
    with_list: &[String],
) -> Result<String, Box<dyn std::error::Error>> {
    let script_path = PathBuf::from(script_path_str);
    let abs_script =
        fs::canonicalize(&script_path).map_err(|_| format!("Script not found: {script_path_str}"))?;
    let path_str = abs_script.to_string_lossy().to_string();
    let clean_script = if cfg!(windows) && path_str.starts_with(r"\\?\") {
        PathBuf::from(&path_str[4..])
    } else {
        abs_script
    };

    let target_dir = clean_script
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    let meta = parse_script_metadata(&clean_script);
    let mut combined_specs = Vec::new();
    combined_specs.extend(with_list.iter().cloned());
    for dep in meta.dependencies {
        if !combined_specs.contains(&dep) {
            combined_specs.push(dep);
        }
    }

    let stash = prepare_cache(&combined_specs, &target_dir, true, &[], false).await?;

    let installed_node_modules = target_dir.join("node_modules");
    let mut dependencies = BTreeMap::new();

    for spec in &combined_specs {
        let (pkg_name, _) = parse_spec(spec);
        let pkg_json_path = installed_node_modules.join(&pkg_name).join("package.json");

        let dep_info = if let Ok(raw_pkg) = fs::read(&pkg_json_path) {
            let mut hasher = Sha256::new();
            hasher.update(&raw_pkg);
            let result = hasher.finalize();
            let integrity = format!("sha256-{:x}", result);

            let parsed: serde_json::Value = serde_json::from_slice(&raw_pkg).unwrap_or_default();
            let ver = parsed
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();

            LockfileDependency {
                version: ver,
                integrity: Some(integrity),
            }
        } else {
            LockfileDependency {
                version: "unknown".to_string(),
                integrity: None,
            }
        };

        dependencies.insert(pkg_name, dep_info);
    }

    restore_node_modules(&installed_node_modules, stash).await?;

    let node_ver = match StdCommand::new("node").arg("--version").output() {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .trim()
            .trim_start_matches('v')
            .to_string(),
        _ => "22.0.0".to_string(),
    };

    let lock_data = LockfileData {
        version: 1,
        script: clean_script
            .file_name()
            .map(|n| n.to_string_lossy().to_string()),
        runtime: LockfileRuntime {
            name: "node".to_string(),
            version: node_ver,
        },
        dependencies,
    };

    let lock_path = format!("{script_path_str}.lock");
    let json = serde_json::to_string_pretty(&lock_data)?;
    fs::write(&lock_path, json + "\n")?;

    Ok(lock_path)
}

fn is_ts_file(p: &str) -> bool {
    p.ends_with(".ts") || p.ends_with(".mts") || p.ends_with(".cts") || p.ends_with(".tsx")
}

fn detect_non_utf8_encoding(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut file = fs::File::open(path).ok()?;
    let mut buf = [0u8; 4];
    let bytes_read = file.read(&mut buf).ok()?;

    if bytes_read < 2 {
        return None;
    }

    if buf[0] == 0xFF && buf[1] == 0xFE {
        return Some("UTF-16 LE".to_string());
    }

    if buf[0] == 0xFE && buf[1] == 0xFF {
        return Some("UTF-16 BE".to_string());
    }

    if bytes_read >= 3 && buf[0] == 0xEF && buf[1] == 0xBB && buf[2] == 0xBF {
        return None;
    }

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
            #[cfg(windows)]
            {
                let cand_exe = dir.join(format!("{bin}.exe"));
                if cand_exe.is_file() {
                    return Some(cand_exe);
                }
            }
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

    let (metadata_deps, metadata_node) = if let Some(ref sp) = script_path {
        let meta = parse_script_metadata(sp);
        (meta.dependencies, meta.node)
    } else {
        (Vec::new(), None)
    };

    let effective_node_version = opts.node_version.or(metadata_node);

    let locked_deps = if let Some(ref sp) = script_path {
        if let Some(lock) = read_lockfile(sp) {
            lock.dependencies
                .into_iter()
                .map(|(pkg, info)| format!("{pkg}@{}", info.version))
                .collect()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    let mut effective_with_list = Vec::new();
    for dep in locked_deps
        .into_iter()
        .chain(metadata_deps.into_iter())
        .chain(opts.with_list.into_iter())
    {
        if !effective_with_list.contains(&dep) {
            effective_with_list.push(dep);
        }
    }

    let mut _guard = CleanupGuard {
        target_node_modules: target_dir.join("node_modules"),
        stash: None,
    };

    if !effective_with_list.is_empty() {
        let s = prepare_cache(
            &effective_with_list,
            &target_dir,
            opts.quiet,
            &opts.npm_args,
            opts.debug,
        )
        .await?;
        _guard.stash = Some(s);
    }

    let result = async {
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

        dev_log(
            opts.debug,
            &format!("is_eval: {}, script_path: {:?}", is_eval, script_path),
        );
        dev_log(opts.debug, &format!("is_ts: {}", is_ts));
        dev_log(
            opts.debug,
            &format!("effective_node_version: {:?}", effective_node_version),
        );
        dev_log(
            opts.debug,
            &format!("effective_with_list: {:?}", effective_with_list),
        );
        dev_log(opts.debug, &format!("target_dir: {:?}", target_dir));

        let node_bin = resolve_node_binary(effective_node_version.as_deref(), opts.quiet).await?;
        let actual_node_bin = if node_bin.as_os_str() == "node" {
            which("node").unwrap_or(node_bin)
        } else {
            node_bin
        };

        let custom_node_dir = if effective_node_version.is_some()
            && actual_node_bin.as_os_str() != "node"
        {
            actual_node_bin.parent().map(|p| p.to_path_buf())
        } else {
            None
        };

        if let Some(c_dir) = &custom_node_dir {
            if let Ok(path_env) = env::var("PATH") {
                let path_sep = if cfg!(windows) { ";" } else { ":" };
                let new_path = format!("{}{path_sep}{path_env}", c_dir.display());
                env::set_var("PATH", &new_path);
            }
        }

        let mut child_cmd;
        let mut child_args: Vec<String> = Vec::new();

        if is_ts {
            if let Some(ref c_dir) = custom_node_dir {
                let npx_path = c_dir.join(if cfg!(windows) { "npx.cmd" } else { "npx" });
                child_cmd = AsyncCommand::new(npx_path);
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
                let tsx_bin = which("tsx");
                if let Some(tsx_path) = tsx_bin {
                    child_cmd = AsyncCommand::new(tsx_path);
                } else {
                    let node_dir = actual_node_bin.parent().unwrap();
                    let npx_path = if cfg!(windows) {
                        let npx_exe = node_dir.join("npx.exe");
                        if npx_exe.exists() {
                            npx_exe
                        } else {
                            node_dir.join("npx.cmd")
                        }
                    } else {
                        node_dir.join("npx")
                    };
                    child_cmd = AsyncCommand::new(npx_path);
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
            child_cmd = AsyncCommand::new(&actual_node_bin);

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

        child_cmd.args(&child_args);

        let mut child = child_cmd
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .map_err(|e| {
                format!(
                    "Failed to spawn process '{}': {}. \
                    Ensure the binary exists and is executable.",
                    child_cmd.as_std().get_program().to_string_lossy(),
                    e
                )
            })?;

        tokio::select! {
            status_res = child.wait() => {
                match status_res {
                    Ok(status) => Ok(status.code().unwrap_or(1)),
                    Err(e) => Err(format!("Process wait error: {e}").into()),
                }
            }
            _ = tokio::signal::ctrl_c() => {
                let _ = child.kill().await;
                eprintln!("\nntsx: process interrupted (SIGINT)");
                Ok(130)
            }
        }
    }
    .await;

    result
}
