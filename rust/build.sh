#!/usr/bin/env bash

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$ROOT/bin"

build() {
    local target="$1"
    local platform="$2"
    local extension="$3"

    echo "Building ntsx for $platform ($target)..."

    mkdir -p "$BIN/$platform"

    if cargo build --release --target "$target" 2>/dev/null; then
        cp "$ROOT/target/$target/release/ntsx$extension" "$BIN/$platform/ntsx$extension"
        chmod +x "$BIN/$platform/ntsx$extension" 2>/dev/null || true
        echo "✓ Built $BIN/$platform/ntsx$extension ($target)"
    else
        echo "⚠️ Target $target linker unavailable in build environment; omitting $platform binary build."
    fi
}

# Build native release first
cargo build --release

# Determine host target & platform
HOST_TARGET="$(rustc -vV | grep host | cut -d' ' -f2)"
HOST_PLATFORM="linux-x86_64"
if [[ "$HOST_TARGET" == *"aarch64"* ]]; then
    if [[ "$HOST_TARGET" == *"apple"* ]]; then
        HOST_PLATFORM="macos-aarch64"
    else
        HOST_PLATFORM="linux-aarch64"
    fi
elif [[ "$HOST_TARGET" == *"apple"* ]]; then
    HOST_PLATFORM="macos-x86_64"
elif [[ "$HOST_TARGET" == *"windows"* ]]; then
    HOST_PLATFORM="windows-x86_64"
fi

mkdir -p "$BIN/$HOST_PLATFORM"
cp "$ROOT/target/release/ntsx" "$BIN/$HOST_PLATFORM/ntsx" 2>/dev/null || cp "$ROOT/target/release/ntsx.exe" "$BIN/$HOST_PLATFORM/ntsx.exe" 2>/dev/null || true

# Attempt multi-target builds if cross-compilation linkers exist
build "aarch64-unknown-linux-gnu" "linux-aarch64" ""
build "x86_64-unknown-linux-gnu" "linux-x86_64" ""
build "x86_64-pc-windows-gnu" "windows-x86_64" ".exe"
build "aarch64-pc-windows-gnullvm" "windows-aarch64" ".exe"

# Clean up any unnested root bin binaries
rm -f "$BIN/ntsx" "$BIN/ntsx.exe"

echo "Done building Rust binaries."
