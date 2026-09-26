#!/usr/bin/env bash

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$ROOT/bin"

build() {
    local target="$1"
    local platform="$2"
    local extension="$3"

    echo "Building ntsx for $platform ($target)..."

    if cargo build --release --target "$target" 2>/dev/null; then
        mkdir -p "$BIN/$platform"
        cp "$ROOT/target/$target/release/ntsx$extension" "$BIN/$platform/ntsx$extension"
        chmod +x "$BIN/$platform/ntsx$extension" 2>/dev/null || true
        echo "✓ Built $BIN/$platform/ntsx$extension"
    else
        echo "⚠️ Target $target not available or linker missing; attempting host fallback for $platform..."
        if [ "$target" = "$(rustc -vV | grep host | cut -d' ' -f2)" ] || [ -z "$target" ]; then
            cargo build --release
            mkdir -p "$BIN/$platform"
            cp "$ROOT/target/release/ntsx$extension" "$BIN/$platform/ntsx$extension"
            chmod +x "$BIN/$platform/ntsx$extension" 2>/dev/null || true
            echo "✓ Built $BIN/$platform/ntsx$extension (host release)"
        fi
    fi
}

# Determine host target
HOST_TARGET="$(rustc -vV | grep host | cut -d' ' -f2)"

# Build host native target first to guarantee local binary exists
cargo build --release

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
mkdir -p "$BIN"
cp "$ROOT/target/release/ntsx" "$BIN/ntsx" 2>/dev/null || cp "$ROOT/target/release/ntsx.exe" "$BIN/ntsx.exe" 2>/dev/null || true

# Try multi-target builds if target toolchains are installed
build "aarch64-unknown-linux-gnu" "linux-aarch64" ""
build "x86_64-unknown-linux-gnu" "linux-x86_64" ""
build "x86_64-pc-windows-gnu" "windows-x86_64" ".exe"
build "aarch64-pc-windows-gnullvm" "windows-aarch64" ".exe"
build "x86_64-apple-darwin" "macos-x86_64" ""
build "aarch64-apple-darwin" "macos-aarch64" ""

echo "Done building Rust binaries."
