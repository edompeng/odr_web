import { WasmBackedOpenDriveParser } from "./wasmParser.js";
import { parseParserWorkerRequest } from "./parserWorkerProtocol.js";

const parser = new WasmBackedOpenDriveParser({ enableJavaScriptFallback: false });

self.addEventListener("message", async (event) => {
  self.postMessage(await parseParserWorkerRequest(event.data, parser));
});
