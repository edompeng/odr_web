const defaultDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
const DEFAULT_MAX_RECOVERY_TEXT_LENGTH = 64 * 1024 * 1024;

export async function parseParserWorkerRequest(data, parser, decoder = defaultDecoder, options = {}) {
  const maxRecoveryTextLength = options.maxRecoveryTextLength ?? DEFAULT_MAX_RECOVERY_TEXT_LENGTH;
  const { id, fileName, text, buffer } = data;
  let xml = "";
  try {
    xml = typeof text === "string" ? text : decoder.decode(buffer);
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
