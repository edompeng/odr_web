#pragma once

#include <string>

#include "src/cpp/odr/model.h"

namespace odrweb {

class OpenDriveParser {
 public:
  OpenDriveMap Parse(const std::string& xml,
                     const std::string& file_name) const;
};

std::string ParseOpenDriveToJson(const std::string& xml,
                                 const std::string& file_name);

}  // namespace odrweb
