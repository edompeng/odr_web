import { WasmBackedOpenDriveParser } from "./wasmParser.js";
import { OpenDriveParser } from "./odrParser.js";

export class WorkerBackedOpenDriveParser {
  constructor() {
    this.fallback = new WasmBackedOpenDriveParser();
    this.javascriptFallback = new OpenDriveParser();
    this.worker = null;
    this.pending = null;
    this.nextRequestId = 1;
    this.mode = "worker";
  }

  async parse(input, fileName = "untitled.xodr") {
    if (!canUseWorker()) {
      return this.parseOnMainThread(input, fileName);
    }

    if (this.pending) this.resetWorker();
    const worker = this.ensureWorker();
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      worker.postMessage(buildRequest(id, input, fileName), transferList(input));
    });
  }

  parseOnMainThread(input, fileName) {
    this.mode = "main-thread";
    if (input instanceof ArrayBuffer) {
      return this.fallback.parse(new TextDecoder("utf-8").decode(input), fileName);
    }
    return this.fallback.parse(input, fileName);
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("./parserWorker.js", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });
    this.worker.addEventListener("error", (event) => {
      this.rejectPending(new Error(event.message || "OpenDRIVE worker failed"));
      this.resetWorker();
    });
    return this.worker;
  }

  async handleMessage(message) {
    if (!this.pending || message.id !== this.pending.id) return;
    const { resolve, reject } = this.pending;
    this.pending = null;
    if (message.ok) {
      this.mode = `worker/${message.mode}`;
      resolve(message.map);
    } else if (message.recoverable && typeof message.text === "string") {
      this.resetWorker();
      try {
        this.mode = "main-thread/javascript";
        resolve(this.javascriptFallback.parse(message.text, message.fileName || "untitled.xodr"));
      } catch (error) {
        reject(error);
      }
    } else {
      reject(new Error(message.message || "OpenDRIVE parse failed"));
    }
  }

  rejectPending(error) {
    if (!this.pending) return;
    this.pending.reject(error);
    this.pending = null;
  }

  resetWorker() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.rejectPending(new Error("OpenDRIVE parse was cancelled"));
  }
}

function canUseWorker() {
  return typeof Worker !== "undefined" && typeof URL !== "undefined";
}

function buildRequest(id, input, fileName) {
  if (input instanceof ArrayBuffer) return { id, fileName, buffer: input };
  return { id, fileName, text: input };
}

function transferList(input) {
  return input instanceof ArrayBuffer ? [input] : [];
}
