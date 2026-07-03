import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const buildId = (process.env.GITHUB_SHA || `${Date.now()}`).slice(0, 12);
const versionedRoot = join(dist, "build", buildId);

await rm(dist, { recursive: true, force: true });
await mkdir(versionedRoot, { recursive: true });
const html = await readFile(join(root, "index.html"), "utf8");
await writeFile(
  join(dist, "index.html"),
  html
    .replace("./src/styles.css", `./build/${buildId}/src/styles.css`)
    .replace("./src/main.js", `./build/${buildId}/src/main.js`),
);
await cp(join(root, "src"), join(versionedRoot, "src"), { recursive: true });
await writeFile(join(dist, ".nojekyll"), "");

const wasmBuildDir = join(root, "build_wasm", "wasm");
try {
  await access(join(wasmBuildDir, "opendrive_wasm.js"));
  await access(join(wasmBuildDir, "opendrive_wasm.wasm"));
  await mkdir(join(dist, "wasm"), { recursive: true });
  await mkdir(join(versionedRoot, "wasm"), { recursive: true });
  await cp(join(wasmBuildDir, "opendrive_wasm.js"), join(dist, "wasm", "opendrive_wasm.js"));
  await cp(join(wasmBuildDir, "opendrive_wasm.wasm"), join(dist, "wasm", "opendrive_wasm.wasm"));
  await cp(join(wasmBuildDir, "opendrive_wasm.js"), join(versionedRoot, "wasm", "opendrive_wasm.js"));
  await cp(join(wasmBuildDir, "opendrive_wasm.wasm"), join(versionedRoot, "wasm", "opendrive_wasm.wasm"));
} catch {
  // The app remains usable through the JavaScript fallback when WASM has not
  // been built on this machine.
}

console.log(`Static artifact written to ${dist} with build id ${buildId}`);
