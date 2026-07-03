#include <exception>
#include <string>

#include "src/cpp/odr/opendrive_parser.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>
#endif

namespace odrweb {
namespace wasm {
namespace {

std::string JsonString(const std::string& value) {
  std::string out = "\"";
  for (const char ch : value) {
    switch (ch) {
      case '"':
        out += "\\\"";
        break;
      case '\\':
        out += "\\\\";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        out += ch;
        break;
    }
  }
  out += "\"";
  return out;
}

}  // namespace

std::string ParseOpenDriveToJsonForWasm(const std::string& xml,
                                        const std::string& file_name) {
  try {
    return ParseOpenDriveToJson(xml, file_name);
  } catch (const std::exception& error) {
    return "{\"error\":" + JsonString(error.what()) + "}";
  } catch (...) {
    return "{\"error\":\"Unknown OpenDRIVE parse error\"}";
  }
}

}  // namespace wasm
}  // namespace odrweb

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_BINDINGS(odr_web_viewer) {
  emscripten::function("parseOpenDriveToJson",
                       &odrweb::wasm::ParseOpenDriveToJsonForWasm);
}
#endif
