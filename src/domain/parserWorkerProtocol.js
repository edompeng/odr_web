const defaultDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
const DEFAULT_MAX_RECOVERY_TEXT_LENGTH = 64 * 1024 * 1024;

export async function parseParserWorkerRequest(data, parser, decoder = defaultDecoder, options = {}) {
  const maxRecoveryTextLength = options.maxRecoveryTextLength ?? DEFAULT_MAX_RECOVERY_TEXT_LENGTH;
  const { id, fileName, text, buffer } = data;
  let xml = "";
  try {
    xml = typeof text === "string" ? text : decodeBuffer(buffer, decoder);
    const map = await parser.parse(xml, fileName);
    return { id, ok: true, mode: parser.mode, map };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const canRecover = Boolean(xml) && xml.length <= maxRecoveryTextLength;
    return {
      id,
      ok: false,
      recoverable: canRecover,
      fileName,
      ...(canRecover ? { text: xml } : {}),
      message: canRecover
        ? message
        : `${message}. JavaScript fallback is disabled for large OpenDRIVE files to avoid freezing the browser.`,
    };
  }
}

export function decodeOpenDriveInput(input, decoder = defaultDecoder) {
  if (typeof input === "string") return input;
  return decodeBuffer(input, decoder);
}

function decodeBuffer(buffer, decoder) {
  if (!decoder) throw new Error("TextDecoder is not available");
  const bytes = toByteView(buffer);
  try {
    return decoder.decode(bytes);
  } catch (error) {
    if (!isResizableArrayBuffer(bytes.buffer)) throw error;
    return decoder.decode(new Uint8Array(bytes));
  }
}

function toByteView(buffer) {
  if (buffer instanceof Uint8Array) return buffer;
  if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return new Uint8Array(buffer);
}

function isResizableArrayBuffer(buffer) {
  return Boolean(buffer?.resizable || (Number.isFinite(buffer?.maxByteLength) && buffer.maxByteLength !== buffer.byteLength));
}
