#!/usr/bin/env bash

# ==============================================================================
# ntsx - Setup & Cross-Compilation Guide for 4 Architectures
#
# Targets built:
#   1. linux-x86_64    (x86_64-unknown-linux-gnu)
#   2. linux-aarch64   (aarch64-unknown-linux-gnu)
#   3. windows-x86_64  (x86_64-pc-windows-gnu)
#   4. windows-aarch64 (aarch64-pc-windows-gnullvm)
# ==============================================================================

set -e

echo "=== 1. Instalar Targets de Rust via rustup ==="
rustup target add x86_64-unknown-linux-gnu
rustup target add aarch64-unknown-linux-gnu
rustup target add x86_64-pc-windows-gnu
rustup target add aarch64-pc-windows-gnullvm

echo "=== 2. Instalar Compiladores Cruzados y Linkers ==="
# Para linux-aarch64: gcc-aarch64-linux-gnu
# Para windows-x86_64: gcc-mingw-w64
if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y gcc-aarch64-linux-gnu gcc-mingw-w64 file
fi

echo "=== 3. Instalar cargo-zigbuild y zig (para windows-aarch64) ==="
# cargo-zigbuild y zig permiten compilar para windows-aarch64 desde Linux sin el SDK de MSVC
pip install cargo-zigbuild ziglang

echo "=== 4. Ejecutar Compilaciones con build.sh ==="
bash "$(dirname "${BASH_SOURCE[0]}")/build.sh"

echo "=== 5. Verificación de Binarios Generados ==="
BIN_DIR="$(dirname "${BASH_SOURCE[0]}")/bin"
file "$BIN_DIR/linux-x86_64/ntsx"
file "$BIN_DIR/linux-aarch64/ntsx"
file "$BIN_DIR/windows-x86_64/ntsx.exe"
file "$BIN_DIR/windows-aarch64/ntsx.exe"

echo "=== Proceso completado exitosamente ==="
