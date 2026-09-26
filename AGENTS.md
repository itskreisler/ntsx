# AGENTS.md - ntsx Project

## Project Overview
ntsx is an ephemeral Node/TypeScript runner with `--with` deps, `--node` version pinning, and caching at `~/.cache/ntsx`.

## Development Environment

> **⚠️ IMPORTANT**: The following environment details are specific to **this machine only** (Kreisler's Windows PC). Do NOT assume these paths or versions exist on other machines. Always verify the environment before building or testing.

### Rust Toolchain
- **Rust**: 1.98.1 via rustup (stable-x86_64-pc-windows-gnu)
- **Installation**: `C:\Users\Kreisler\.cargo\bin` and `C:\Users\Kreisler\.rustup\toolchains\stable-x86_64-pc-windows-gnu`
- **Target**: GNU (not MSVC) - uses rustup's self-contained MinGW

### MinGW
- **Working**: rustup's self-contained MinGW at `C:\Users\Kreisler\.rustup\toolchains\stable-x86_64-pc-windows-gnu\bin` (has `libgcc_eh.a` in `lib/rustlib/x86_64-pc-windows-gnu/lib/self-contained/`)
- **Conflicting (avoid)**: w64devkit at `D:\LIBS\w64devkit\bin` (missing `libgcc_eh.a` - causes build failures)

### Node.js Version Manager
- **nvm**: `C:\Users\Kreisler\AppData\Local\Author Software\nvm` (paths with spaces - causes runtime issues with `.cmd` files)
- **nvm node**: `C:\Users\Kreisler\AppData\Local\Author Software\nvm\.nodejs` (contains `node.exe`, `npx.exe`, `tsx.exe`)

### Chocolatey
- **Location**: `C:\ProgramData\chocolatey`
- **Installed packages**: ripgrep only

### Build Commands
```bash
# Use build.sh for cross-compilation
./build.sh

# Or manually with proper PATH (prioritize rustup's MinGW):
$env:PATH = "C:\Users\Kreisler\.rustup\toolchains\stable-x86_64-pc-windows-gnu\bin;" + ($env:PATH -replace "D:\\LIBS\\w64devkit\\bin;?", "")
cargo build --release
```

### Testing
```bash
# Test with --node flag (downloads and uses specific Node version)
ntsx run --with chalk --node 24.1.0 -e "import c from 'chalk'; console.log(c.green('hello world'))"

# Test without --node flag (uses system node)
ntsx run --with chalk -e "import c from 'chalk'; console.log(c.blue('hello without node flag'))"

# Debug logging
ntsx run --with chalk --node 24.1.0 -e "..." --debug
```

## Environment Verification (Run Before Building)
```bash
# Verify Rust toolchain
rustc --version
cargo --version

# Verify MinGW (should be rustup's, not w64devkit)
gcc --version
# Should show: gcc.exe (GCC) 13.2.0 or similar from rustup

# Verify PATH priority (rustup MinGW should be first)
$env:PATH -split ';' | Select-Object -First 5

# Verify Node/nvm (if needed)
node --version
npx --version
```

## Key Implementation Details

### Fixed Issues
1. **--node flag not properly managed**: Fixed by using `npx -y tsx` from the custom Node's directory when `--node` is specified
2. **System Node path with spaces breaks execution**: Fixed by preferring `.exe` over `.cmd` on Windows and using npx from the same directory as node binary
3. **nvm path issues**: Avoided by not relying on PATH for npx/tsx when using custom Node

### Debug Logging
Use `--debug` flag to see detailed execution information:
- Resolved node binary path
- Custom node directory
- Modified PATH
- npx path being used
- Full command being executed

## Project Structure
```
rust/
├── build.sh          # Cross-compilation script
├── Cargo.toml
├── bin/              # Output binaries
│   ├── linux-aarch64/
│   ├── linux-x86_64/
│   ├── windows-aarch64/
│   └── windows-x86_64/
└── src/
    ├── cache.rs      # Cache management
    ├── cli.rs        # CLI definitions (clap)
    ├── config.rs     # Config (cache root)
    ├── main.rs       # Entry point
    ├── node_version.rs  # Node.js download/resolution
    └── run.rs        # Main execution logic (with dev_log)
```

## Important Notes
- Always use `build.sh` for building
- On Windows, ensure rustup's MinGW is first in PATH
- The `--node` flag downloads Node.js to `~/.cache/ntsx/node/<version>/`
- Cache for `--with` packages at `~/.cache/ntsx/npm/`