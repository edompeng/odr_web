#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${ROOT_DIR}/build_wasm"

if ! command -v emcmake >/dev/null 2>&1; then
  echo "emcmake not found. Install and activate Emscripten SDK first." >&2
  exit 1
fi

emcmake cmake -S "${ROOT_DIR}" -B "${BUILD_DIR}" -DCMAKE_BUILD_TYPE=Release
cmake --build "${BUILD_DIR}" --parallel --target opendrive_wasm
npm run build
mkdir -p "${ROOT_DIR}/dist/wasm"
cp "${BUILD_DIR}/wasm/opendrive_wasm.js" "${ROOT_DIR}/dist/wasm/"
cp "${BUILD_DIR}/wasm/opendrive_wasm.wasm" "${ROOT_DIR}/dist/wasm/"
