#pragma once

#include <string>

#include "src/cpp/odr/model.h"

namespace odrweb {

std::string SerializeOpenDriveMap(const OpenDriveMap& map);
std::string LaneColorForType(const std::string& type);

}  // namespace odrweb
