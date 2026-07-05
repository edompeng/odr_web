import { WasmBackedOpenDriveParser } from "./wasmParser.js";

const parser = new WasmBackedOpenDriveParser({ enableJavaScriptFallback: false });
const decoder = new TextDecoder("utf-8");

self.addEventListener("message", async (event) => {
  const { id, fileName, text, buffer } = event.data;
  try {
    const xml = typeof text === "string" ? text : decoder.decode(buffer);
    const map = await parser.parse(xml, fileName);
    self.postMessage({ id, ok: true, mode: parser.mode, map });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      recoverable: true,
      fileName,
      text: xml,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
