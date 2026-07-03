import { OpenDriveParser } from "./odrParser.js";

export class WasmBackedOpenDriveParser {
  constructor() {
    this.fallback = new OpenDriveParser();
    this.modulePromise = this.loadModule();
    this.mode = "loading";
  }

  async parse(text, fileName = "untitled.xodr") {
    const module = await this.modulePromise;
    if (!module) {
      this.mode = "javascript";
      return this.fallback.parse(text, fileName);
    }
    this.mode = "wasm";
    try {
      const parsed = JSON.parse(module.parseOpenDriveToJson(text, fileName));
      if (parsed?.error) throw new Error(parsed.error);
      return parsed;
    } catch (error) {
      console.warn("WASM parser failed; falling back to JavaScript parser.", error);
      this.mode = "javascript";
      return this.fallback.parse(text, fileName);
    }
  }

  async loadModule() {
    try {
      const moduleUrl = new URL("../../wasm/opendrive_wasm.js", import.meta.url);
      const wasmDir = new URL("../../wasm/", import.meta.url);
      const imported = await import(moduleUrl.href);
      const factory = imported.default ?? imported;
      return await factory({
        locateFile: (path) => new URL(path, wasmDir).href,
      });
    } catch (error) {
      console.info("WASM parser unavailable; falling back to JavaScript parser.", error);
      return null;
    }
  }
}
