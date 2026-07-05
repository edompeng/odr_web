#include "src/cpp/odr/json_serializer.h"

#include <iomanip>
#include <sstream>

namespace odrweb {
namespace {

void JsonString(std::ostream& os, const std::string& value) {
  os << '"';
  for (const char ch : value) {
    switch (ch) {
      case '"':
        os << "\\\"";
        break;
      case '\\':
        os << "\\\\";
        break;
      case '\b':
        os << "\\b";
        break;
      case '\f':
        os << "\\f";
        break;
      case '\n':
        os << "\\n";
        break;
      case '\r':
        os << "\\r";
        break;
      case '\t':
        os << "\\t";
        break;
      default:
        if (static_cast<unsigned char>(ch) < 0x20) {
          os << "\\u" << std::hex << std::setw(4) << std::setfill('0')
             << static_cast<int>(static_cast<unsigned char>(ch)) << std::dec;
        } else {
          os << ch;
        }
    }
  }
  os << '"';
}

void PointJson(std::ostream& os, const Point& point) {
  os << "{\"x\":" << point.x << ",\"y\":" << point.y << ",\"hdg\":" << point.hdg
     << ",\"s\":" << point.s << ",\"z\":" << point.z << "}";
}

void BoundsJson(std::ostream& os, const Bounds& bounds) {
  os << "{\"minX\":" << bounds.min_x << ",\"minY\":" << bounds.min_y
     << ",\"maxX\":" << bounds.max_x << ",\"maxY\":" << bounds.max_y << "}";
}

template <typename T, typename Fn>
void ArrayJson(std::ostream& os, const std::vector<T>& values, Fn fn) {
  os << '[';
  for (std::size_t i = 0; i < values.size(); ++i) {
    if (i != 0) os << ',';
    fn(os, values[i]);
  }
  os << ']';
}

void RoadMarkJson(std::ostream& os, const RoadMark& mark) {
  os << "{\"type\":";
  JsonString(os, mark.type);
  os << ",\"color\":";
  JsonString(os, mark.color);
  os << ",\"laneChange\":";
  JsonString(os, mark.lane_change);
  os << ",\"width\":" << mark.width << "}";
}

void LaneJson(std::ostream& os, const Lane& lane) {
  os << "{\"key\":";
  JsonString(os, lane.key);
  os << ",\"roadId\":";
  JsonString(os, lane.road_id);
  os << ",\"sectionS\":" << lane.section_s << ",\"laneId\":" << lane.id
     << ",\"laneType\":";
  JsonString(os, lane.type);
  os << ",\"side\":";
  JsonString(os, lane.side);
  os << ",\"polygon\":";
  ArrayJson(os, lane.polygon, PointJson);
  os << ",\"centerline\":";
  ArrayJson(os, lane.centerline, PointJson);
  os << ",\"bounds\":";
  BoundsJson(os, lane.bounds);
  os << ",\"color\":";
  JsonString(os, LaneColorForType(lane.type));
  os << ",\"roadMarks\":";
  ArrayJson(os, lane.road_marks, RoadMarkJson);
  os << '}';
}

void ObjectJson(std::ostream& os, const RoadObject& object) {
  os << "{\"key\":";
  JsonString(os, object.key);
  os << ",\"roadId\":";
  JsonString(os, object.road_id);
  os << ",\"id\":";
  JsonString(os, object.id);
  os << ",\"name\":";
  JsonString(os, object.name);
  os << ",\"type\":";
  JsonString(os, object.type);
  os << ",\"s\":" << object.s << ",\"t\":" << object.t
     << ",\"hdg\":" << object.hdg << ",\"width\":" << object.width
     << ",\"length\":" << object.length << ",\"height\":" << object.height
     << ",\"point\":";
  PointJson(os, object.point);
  os << ",\"outline\":";
  ArrayJson(os, object.outline, PointJson);
  os << ",\"bounds\":";
  BoundsJson(os, object.bounds);
  os << '}';
}

void SignalJson(std::ostream& os, const Signal& signal) {
  os << "{\"key\":";
  JsonString(os, signal.key);
  os << ",\"roadId\":";
  JsonString(os, signal.road_id);
  os << ",\"id\":";
  JsonString(os, signal.id);
  os << ",\"name\":";
  JsonString(os, signal.name);
  os << ",\"type\":";
  JsonString(os, signal.type);
  os << ",\"subtype\":";
  JsonString(os, signal.subtype);
  os << ",\"s\":" << signal.s << ",\"t\":" << signal.t
     << ",\"width\":" << signal.width << ",\"height\":" << signal.height
     << ",\"hOffset\":" << signal.h_offset << ",\"point\":";
  PointJson(os, signal.point);
  os << ",\"shape\":";
  ArrayJson(os, signal.shape, PointJson);
  os << ",\"bounds\":";
  BoundsJson(os, signal.bounds);
  os << '}';
}

void JunctionJson(std::ostream& os, const Junction& junction) {
  os << "{\"id\":";
  JsonString(os, junction.id);
  os << ",\"name\":";
  JsonString(os, junction.name);
  os << ",\"connectionCount\":" << junction.connection_count << '}';
}

void RoadJson(std::ostream& os, const Road& road) {
  os << "{\"id\":";
  JsonString(os, road.id);
  os << ",\"name\":";
  JsonString(os, road.name);
  os << ",\"junction\":";
  JsonString(os, road.junction);
  os << ",\"length\":" << road.length << ",\"referenceLine\":";
  ArrayJson(os, road.reference_line, PointJson);
  os << ",\"lanes\":";
  ArrayJson(os, road.lanes, LaneJson);
  os << ",\"objects\":";
  ArrayJson(os, road.objects, ObjectJson);
  os << ",\"signals\":";
  ArrayJson(os, road.signals, SignalJson);
  os << ",\"bounds\":";
  BoundsJson(os, road.bounds);
  os << '}';
}

}  // namespace

std::string LaneColorForType(const std::string& type) {
  if (type == "driving") return "#335f78";
  if (type == "shoulder") return "#4a5360";
  if (type == "sidewalk") return "#52644e";
  if (type == "border") return "#4c4c55";
  if (type == "restricted") return "#5f4b4b";
  if (type == "parking") return "#655b45";
  if (type == "biking") return "#3e665f";
  return "#46525f";
}

std::string SerializeOpenDriveMap(const OpenDriveMap& map) {
  std::ostringstream os;
  os << std::setprecision(15);
  os << "{\"fileName\":";
  JsonString(os, map.file_name);
  os << ",\"header\":{\"name\":";
  JsonString(os, map.header.name);
  os << ",\"revMajor\":";
  JsonString(os, map.header.rev_major);
  os << ",\"revMinor\":";
  JsonString(os, map.header.rev_minor);
  os << ",\"vendor\":";
  JsonString(os, map.header.vendor);
  os << ",\"geoReference\":";
  JsonString(os, map.header.geo_reference);
  os << ",\"xOffset\":" << map.header.x_offset;
  os << ",\"yOffset\":" << map.header.y_offset;
  os << "},\"roads\":";
  ArrayJson(os, map.roads, RoadJson);
  os << ",\"objects\":";
  ArrayJson(os, map.objects, ObjectJson);
  os << ",\"signals\":";
  ArrayJson(os, map.signals, SignalJson);
  os << ",\"junctions\":";
  ArrayJson(os, map.junctions, JunctionJson);
  os << ",\"bounds\":";
  BoundsJson(os, map.bounds);
  os << ",\"stats\":{\"roads\":" << map.stats.roads
     << ",\"lanes\":" << map.stats.lanes << ",\"objects\":" << map.stats.objects
     << ",\"signals\":" << map.stats.signals
     << ",\"junctions\":" << map.stats.junctions
     << ",\"lengthMeters\":" << map.stats.length_meters << "}}";
  return os.str();
}

}  // namespace odrweb
