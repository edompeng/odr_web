import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, "index.html"), join(dist, "index.html"));
await cp(join(root, "src"), join(dist, "src"), { recursive: true });
await writeFile(join(dist, ".nojekyll"), "");

const wasmBuildDir = join(root, "build_wasm", "wasm");
try {
  await access(join(wasmBuildDir, "opendrive_wasm.js"));
  await access(join(wasmBuildDir, "opendrive_wasm.wasm"));
  await mkdir(join(dist, "wasm"), { recursive: true });
  await cp(join(wasmBuildDir, "opendrive_wasm.js"), join(dist, "wasm", "opendrive_wasm.js"));
  await cp(join(wasmBuildDir, "opendrive_wasm.wasm"), join(dist, "wasm", "opendrive_wasm.wasm"));
} catch {
  // The app remains usable through the JavaScript fallback when WASM has not
  // been built on this machine.
}

console.log(`Static artifact written to ${dist}`);
