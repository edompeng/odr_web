const defaultDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;

export async function parseParserWorkerRequest(data, parser, decoder = defaultDecoder) {
  const { id, fileName, text, buffer } = data;
  let xml = "";
  try {
    xml = typeof text === "string" ? text : decoder.decode(buffer);
    const map = await parser.parse(xml, fileName);
    return { id, ok: true, mode: parser.mode, map };
  } catch (error) {
    return {
      id,
      ok: false,
      recoverable: Boolean(xml),
      fileName,
      text: xml,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
