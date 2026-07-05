#include "src/cpp/odr/opendrive_parser.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iterator>
#include <sstream>
#include <stdexcept>

#include "src/cpp/odr/json_serializer.h"
#include "src/cpp/odr/math_util.h"
#include "src/cpp/odr/xml_lite.h"

namespace odrweb {
namespace {

constexpr double kDefaultStepMeters = 2.5;

double NumberAttr(const XmlNode& node, const std::string& key,
                  double fallback = 0.0) {
  const std::string& raw = node.Attr(key);
  if (raw.empty()) return fallback;
  char* end = nullptr;
  const double value = std::strtod(raw.c_str(), &end);
  return end == raw.c_str() ? fallback : value;
}

int IntAttr(const XmlNode& node, const std::string& key, int fallback = 0) {
  return static_cast<int>(std::lround(NumberAttr(node, key, fallback)));
}

std::string StringAttr(const XmlNode& node, const std::string& key,
                       const std::string& fallback = "") {
  const std::string& raw = node.Attr(key);
  return raw.empty() ? fallback : raw;
}

struct Geometry {
  std::string kind = "line";
  double s = 0.0;
  double x = 0.0;
  double y = 0.0;
  double hdg = 0.0;
  double length = 0.0;
  double curvature = 0.0;
  double curv_start = 0.0;
  double curv_end = 0.0;
  double a = 0.0;
  double b = 0.0;
  double c = 0.0;
  double d = 0.0;
  double a_u = 0.0;
  double b_u = 1.0;
  double c_u = 0.0;
  double d_u = 0.0;
  double a_v = 0.0;
  double b_v = 0.0;
  double c_v = 0.0;
  double d_v = 0.0;
  bool normalized = true;
};

std::vector<Width> ParsePolynomialEntries(const XmlNode& parent,
                                          const std::string& child_name);
double PolynomialAt(const std::vector<Width>& entries, double s,
                    double fallback = 0.0);

Point SampleSpiralApprox(const Geometry& geometry, double ds) {
  const int steps = std::max(2, static_cast<int>(std::ceil(ds / 1.5)));
  double x = geometry.x;
  double y = geometry.y;
  double hdg = geometry.hdg;
  double previous_s = 0.0;
  for (int i = 1; i <= steps; ++i) {
    const double current_s = ds * (static_cast<double>(i) / steps);
    const double mid_s = (previous_s + current_s) * 0.5;
    const double curvature =
        geometry.curv_start + (geometry.curv_end - geometry.curv_start) *
                                  (mid_s / std::max(geometry.length, 1e-9));
    const double delta = current_s - previous_s;
    hdg += curvature * delta;
    x += delta * std::cos(hdg);
    y += delta * std::sin(hdg);
    previous_s = current_s;
  }
  return {x, y, hdg, geometry.s + ds};
}

Point SampleGeometryAt(const Geometry& geometry, double ds) {
  if (geometry.kind == "arc") {
    if (std::abs(geometry.curvature) < 1e-9) {
      return {geometry.x + ds * std::cos(geometry.hdg),
              geometry.y + ds * std::sin(geometry.hdg), geometry.hdg,
              geometry.s + ds};
    }
    const double radius = 1.0 / geometry.curvature;
    const double theta = ds * geometry.curvature;
    return {geometry.x + radius * (std::sin(geometry.hdg + theta) -
                                   std::sin(geometry.hdg)),
            geometry.y - radius * (std::cos(geometry.hdg + theta) -
                                   std::cos(geometry.hdg)),
            geometry.hdg + theta, geometry.s + ds};
  }

  if (geometry.kind == "poly3") {
    const double u = ds;
    const double v = Cubic(geometry.a, geometry.b, geometry.c, geometry.d, ds);
    return {
        geometry.x + u * std::cos(geometry.hdg) - v * std::sin(geometry.hdg),
        geometry.y + u * std::sin(geometry.hdg) + v * std::cos(geometry.hdg),
        geometry.hdg + std::atan(geometry.b + 2.0 * geometry.c * ds +
                                 3.0 * geometry.d * ds * ds),
        geometry.s + ds};
  }

  if (geometry.kind == "paramPoly3") {
    const double p =
        geometry.normalized ? ds / std::max(geometry.length, 1e-9) : ds;
    const double u =
        Cubic(geometry.a_u, geometry.b_u, geometry.c_u, geometry.d_u, p);
    const double v =
        Cubic(geometry.a_v, geometry.b_v, geometry.c_v, geometry.d_v, p);
    const double du =
        geometry.b_u + 2.0 * geometry.c_u * p + 3.0 * geometry.d_u * p * p;
    const double dv =
        geometry.b_v + 2.0 * geometry.c_v * p + 3.0 * geometry.d_v * p * p;
    return {
        geometry.x + u * std::cos(geometry.hdg) - v * std::sin(geometry.hdg),
        geometry.y + u * std::sin(geometry.hdg) + v * std::cos(geometry.hdg),
        geometry.hdg + std::atan2(dv, std::abs(du) < 1e-9 ? 1e-9 : du),
        geometry.s + ds};
  }

  if (geometry.kind == "spiral") return SampleSpiralApprox(geometry, ds);

  return {geometry.x + ds * std::cos(geometry.hdg),
          geometry.y + ds * std::sin(geometry.hdg), geometry.hdg,
          geometry.s + ds};
}

std::vector<Point> SampleGeometry(const Geometry& geometry,
                                  double step_meters = kDefaultStepMeters) {
  const double length = std::max(0.0, geometry.length);
  const int steps =
      std::max(2, static_cast<int>(std::ceil(length / step_meters)) + 1);
  std::vector<Point> points;
  points.reserve(static_cast<std::size_t>(steps));
  for (int i = 0; i < steps; ++i) {
    const double ds = length * (static_cast<double>(i) / (steps - 1));
    points.push_back(SampleGeometryAt(geometry, ds));
  }
  return points;
}

Geometry ParseGeometry(const XmlNode& node) {
  Geometry geometry;
  geometry.s = NumberAttr(node, "s");
  geometry.x = NumberAttr(node, "x");
  geometry.y = NumberAttr(node, "y");
  geometry.hdg = NumberAttr(node, "hdg");
  geometry.length = NumberAttr(node, "length");

  for (const auto& child_ptr : node.children) {
    const XmlNode& child = *child_ptr;
    if (child.name == "line" || child.name == "arc" || child.name == "spiral" ||
        child.name == "poly3" || child.name == "paramPoly3") {
      geometry.kind = child.name;
      if (child.name == "arc") {
        geometry.curvature = NumberAttr(child, "curvature");
      } else if (child.name == "spiral") {
        geometry.curv_start = NumberAttr(child, "curvStart");
        geometry.curv_end = NumberAttr(child, "curvEnd");
      } else if (child.name == "poly3") {
        geometry.a = NumberAttr(child, "a");
        geometry.b = NumberAttr(child, "b");
        geometry.c = NumberAttr(child, "c");
        geometry.d = NumberAttr(child, "d");
      } else if (child.name == "paramPoly3") {
        geometry.normalized =
            StringAttr(child, "pRange", "normalized") != "arcLength";
        geometry.a_u = NumberAttr(child, "aU");
        geometry.b_u = NumberAttr(child, "bU", 1.0);
        geometry.c_u = NumberAttr(child, "cU");
        geometry.d_u = NumberAttr(child, "dU");
        geometry.a_v = NumberAttr(child, "aV");
        geometry.b_v = NumberAttr(child, "bV");
        geometry.c_v = NumberAttr(child, "cV");
        geometry.d_v = NumberAttr(child, "dV");
      }
      break;
    }
  }
  return geometry;
}

std::vector<Point> SampleReferenceLine(const XmlNode& road_node) {
  std::vector<Point> points;
  const XmlNode* plan_view = road_node.FirstChild("planView");
  if (!plan_view) return points;
  std::vector<Width> elevations;
  if (const XmlNode* elevation_profile = road_node.FirstChild("elevationProfile")) {
    elevations = ParsePolynomialEntries(*elevation_profile, "elevation");
  }
  for (const XmlNode* geometry_node : plan_view->Children("geometry")) {
    std::vector<Point> sampled = SampleGeometry(ParseGeometry(*geometry_node));
    for (Point& point : sampled) {
      point.z = PolynomialAt(elevations, point.s, 0.0);
    }
    if (!points.empty() && !sampled.empty()) sampled.erase(sampled.begin());
    points.insert(points.end(), sampled.begin(), sampled.end());
  }
  return points;
}

Point InterpolatePointAtS(const std::vector<Point>& points, double s) {
  if (points.empty()) return {};
  if (s <= points.front().s) return points.front();
  if (s >= points.back().s) return points.back();

  const auto upper = std::lower_bound(
      points.begin(), points.end(), s,
      [](const Point& point, double target_s) { return point.s < target_s; });
  if (upper == points.begin()) return *upper;
  const Point& next = *upper;
  const Point& prev = *(upper - 1);
  const double span = std::max(1e-9, next.s - prev.s);
  const double ratio = (s - prev.s) / span;
  return {prev.x + (next.x - prev.x) * ratio,
          prev.y + (next.y - prev.y) * ratio,
          prev.hdg + (next.hdg - prev.hdg) * ratio, s,
          prev.z + (next.z - prev.z) * ratio};
}

std::vector<Point> SegmentReferenceLine(const std::vector<Point>& points,
                                        double section_s, double section_end) {
  std::vector<Point> segment;
  if (points.empty() || section_end <= section_s) return segment;

  const double start = std::max(section_s, points.front().s);
  const double end = std::min(section_end, points.back().s);
  if (end < start) return segment;

  segment.reserve(static_cast<std::size_t>(
      std::max(2.0, std::ceil((end - start) / kDefaultStepMeters) + 2.0)));
  segment.push_back(InterpolatePointAtS(points, start));
  for (const Point& point : points) {
    if (point.s > start + 1e-9 && point.s < end - 1e-9) {
      segment.push_back(point);
    }
  }
  if (end > start + 1e-9) {
    segment.push_back(InterpolatePointAtS(points, end));
  }
  return segment;
}

std::vector<Width> ParseWidths(const XmlNode& lane_node) {
  std::vector<Width> widths;
  for (const XmlNode* node : lane_node.Children("width")) {
    widths.push_back({NumberAttr(*node, "sOffset"), NumberAttr(*node, "a"),
                      NumberAttr(*node, "b"), NumberAttr(*node, "c"),
                      NumberAttr(*node, "d")});
  }
  std::sort(widths.begin(), widths.end(),
            [](const Width& lhs, const Width& rhs) {
              return lhs.s_offset < rhs.s_offset;
            });
  return widths;
}

std::vector<Width> ParsePolynomialEntries(const XmlNode& parent,
                                          const std::string& child_name) {
  std::vector<Width> entries;
  for (const XmlNode* node : parent.Children(child_name)) {
    entries.push_back({NumberAttr(*node, "s"), NumberAttr(*node, "a"),
                       NumberAttr(*node, "b"), NumberAttr(*node, "c"),
                       NumberAttr(*node, "d")});
  }
  std::sort(entries.begin(), entries.end(),
            [](const Width& lhs, const Width& rhs) {
              return lhs.s_offset < rhs.s_offset;
            });
  return entries;
}

double PolynomialAt(const std::vector<Width>& entries, double s,
                    double fallback) {
  if (entries.empty()) return fallback;
  const Width* selected = &entries.front();
  for (const Width& entry : entries) {
    if (entry.s_offset <= s) selected = &entry;
  }
  const double ds = std::max(0.0, s - selected->s_offset);
  return Cubic(selected->a, selected->b, selected->c, selected->d, ds);
}

std::vector<RoadMark> ParseRoadMarks(const XmlNode& lane_node) {
  std::vector<RoadMark> marks;
  for (const XmlNode* node : lane_node.Children("roadMark")) {
    marks.push_back({StringAttr(*node, "type", "unknown"),
                     StringAttr(*node, "color", "white"),
                     StringAttr(*node, "laneChange"),
                     NumberAttr(*node, "width", 0.12)});
  }
  return marks;
}

struct LaneSource {
  int id = 0;
  std::string type;
  std::string side;
  std::vector<Width> widths;
  std::vector<RoadMark> road_marks;
};

std::vector<LaneSource> ParseLaneGroup(const XmlNode& section_node,
                                       const std::string& side) {
  std::vector<LaneSource> lanes;
  const XmlNode* side_node = section_node.FirstChild(side);
  if (!side_node) return lanes;
  for (const XmlNode* lane_node : side_node->Children("lane")) {
    lanes.push_back({IntAttr(*lane_node, "id"),
                     StringAttr(*lane_node, "type", "unknown"), side,
                     ParseWidths(*lane_node), ParseRoadMarks(*lane_node)});
  }
  return lanes;
}

std::vector<Point> OffsetPolylineByOffsets(const std::vector<Point>& centerline,
                                           const std::vector<double>& offsets) {
  std::vector<Point> out;
  out.reserve(centerline.size());
  for (std::size_t i = 0; i < centerline.size(); ++i) {
    out.push_back(OffsetPoint(centerline[i], offsets[i]));
  }
  return out;
}

std::vector<Point> LanePolygonFromOffsets(
    const std::vector<Point>& centerline, const std::vector<double>& inner,
    const std::vector<double>& outer_offsets) {
  std::vector<Point> polygon = OffsetPolylineByOffsets(centerline, inner);
  std::vector<Point> outer = OffsetPolylineByOffsets(centerline, outer_offsets);
  polygon.insert(polygon.end(), outer.rbegin(), outer.rend());
  return polygon;
}

Point ProjectRoadPoint(const Road& road, double s, double t) {
  return OffsetPoint(InterpolatePointAtS(road.reference_line, s), t);
}

Point TransformLocalPoint(const Point& origin, double hdg, double u, double v) {
  Point out;
  out.x = origin.x + std::cos(hdg) * u - std::sin(hdg) * v;
  out.y = origin.y + std::sin(hdg) * u + std::cos(hdg) * v;
  out.hdg = hdg;
  out.s = origin.s;
  out.z = origin.z;
  return out;
}

std::vector<Point> RectangleAroundPoint(const Point& origin, double hdg,
                                        double length, double width) {
  if (length <= 0.0 || width <= 0.0) return {};
  const double half_length = length * 0.5;
  const double half_width = width * 0.5;
  return {TransformLocalPoint(origin, hdg, -half_length, -half_width),
          TransformLocalPoint(origin, hdg, half_length, -half_width),
          TransformLocalPoint(origin, hdg, half_length, half_width),
          TransformLocalPoint(origin, hdg, -half_length, half_width)};
}

std::vector<Point> ParseObjectOutline(const XmlNode& object_node,
                                      const Road& road,
                                      const RoadObject& object) {
  for (const XmlNode* outline : object_node.Children("outline")) {
    std::vector<const XmlNode*> corner_road = outline->Children("cornerRoad");
    if (corner_road.size() >= 3) {
      std::vector<Point> points;
      points.reserve(corner_road.size());
      for (const XmlNode* corner : corner_road) {
        points.push_back(ProjectRoadPoint(road, NumberAttr(*corner, "s", object.s),
                                          NumberAttr(*corner, "t", object.t)));
      }
      return points;
    }

    std::vector<const XmlNode*> corner_local = outline->Children("cornerLocal");
    if (corner_local.size() >= 3) {
      std::vector<Point> points;
      points.reserve(corner_local.size());
      const double hdg = object.point.hdg + object.hdg;
      for (const XmlNode* corner : corner_local) {
        points.push_back(TransformLocalPoint(object.point, hdg,
                                             NumberAttr(*corner, "u"),
                                             NumberAttr(*corner, "v")));
      }
      return points;
    }
  }
  return RectangleAroundPoint(object.point, object.point.hdg + object.hdg,
                              object.length, object.width);
}

std::vector<Point> SignalShape(const Signal& signal) {
  if (signal.width <= 0.0) return {};
  const double depth =
      std::max(0.15, std::min(0.4, signal.height > 0.0 ? signal.height * 0.08
                                                       : 0.2));
  return RectangleAroundPoint(signal.point, signal.point.hdg + signal.h_offset,
                              depth, signal.width);
}

std::vector<Lane> BuildLaneShapes(const Road& road, const XmlNode& section_node,
                                  double section_end) {
  const double section_s = NumberAttr(section_node, "s");
  const std::vector<Point> section_line =
      SegmentReferenceLine(road.reference_line, section_s, section_end);
  if (section_line.size() < 2) return {};

  std::vector<LaneSource> left = ParseLaneGroup(section_node, "left");
  std::vector<LaneSource> right = ParseLaneGroup(section_node, "right");
  std::vector<LaneSource> center = ParseLaneGroup(section_node, "center");

  std::sort(left.begin(), left.end(),
            [](const LaneSource& lhs, const LaneSource& rhs) {
              return lhs.id < rhs.id;
            });
  std::sort(right.begin(), right.end(),
            [](const LaneSource& lhs, const LaneSource& rhs) {
              return std::abs(lhs.id) < std::abs(rhs.id);
            });

  std::vector<Lane> shapes;
  shapes.reserve(left.size() + right.size() + center.size());
  auto add_side = [&](const std::vector<LaneSource>& sources,
                      const std::string& side, double sign) {
    std::vector<double> cumulative(section_line.size(), 0.0);
    for (const LaneSource& source : sources) {
      std::vector<double> inner(section_line.size());
      std::vector<double> outer(section_line.size());
      std::vector<double> center_offsets(section_line.size());
      for (std::size_t i = 0; i < section_line.size(); ++i) {
        const double local_s = std::max(0.0, section_line[i].s - section_s);
        const double lane_offset = PolynomialAt(road.lane_offsets, section_line[i].s);
        const double width = WidthAt(source.widths, local_s);
        inner[i] = lane_offset + sign * cumulative[i];
        cumulative[i] += width;
        outer[i] = lane_offset + sign * cumulative[i];
        center_offsets[i] = (inner[i] + outer[i]) * 0.5;
      }
      Lane lane;
      lane.key = road.id + ":" + std::to_string(section_s) + ":" +
                 std::to_string(source.id);
      lane.road_id = road.id;
      lane.section_s = section_s;
      lane.id = source.id;
      lane.type = source.type;
      lane.side = side;
      lane.polygon = LanePolygonFromOffsets(section_line, inner, outer);
      lane.centerline = OffsetPolylineByOffsets(section_line, center_offsets);
      lane.road_marks = source.road_marks;
      lane.bounds = BoundsOf(lane.polygon);
      shapes.push_back(std::move(lane));
    }
  };

  add_side(left, "left", 1.0);
  add_side(right, "right", -1.0);

  for (const LaneSource& source : center) {
    Lane lane;
    lane.key = road.id + ":" + std::to_string(section_s) + ":0";
    lane.road_id = road.id;
    lane.section_s = section_s;
    lane.id = source.id;
    lane.type = source.type;
    lane.side = "center";
    std::vector<double> center_offsets(section_line.size());
    for (std::size_t i = 0; i < section_line.size(); ++i) {
      center_offsets[i] = PolynomialAt(road.lane_offsets, section_line[i].s);
    }
    lane.centerline = OffsetPolylineByOffsets(section_line, center_offsets);
    lane.road_marks = source.road_marks;
    lane.bounds = BoundsOf(lane.centerline);
    shapes.push_back(std::move(lane));
  }
  return shapes;
}

void ParseObjectsAndSignals(const XmlNode& road_node, Road* road) {
  if (const XmlNode* objects_node = road_node.FirstChild("objects")) {
    for (const XmlNode* node : objects_node->Children("object")) {
      RoadObject object;
      object.road_id = road->id;
      object.id = StringAttr(*node, "id");
      object.key = road->id + ":object:" + object.id;
      object.name = StringAttr(*node, "name");
      object.type = StringAttr(*node, "type");
      object.s = NumberAttr(*node, "s");
      object.t = NumberAttr(*node, "t");
      object.hdg = NumberAttr(*node, "hdg");
      object.width = NumberAttr(*node, "width");
      object.length = NumberAttr(*node, "length");
      object.height = NumberAttr(*node, "height");
      object.point = ProjectRoadPoint(*road, object.s, object.t);
      object.outline = ParseObjectOutline(*node, *road, object);
      object.bounds = BoundsOf(object.outline.size() >= 3
                                   ? object.outline
                                   : std::vector<Point>{object.point});
      road->objects.push_back(std::move(object));
    }
  }

  if (const XmlNode* signals_node = road_node.FirstChild("signals")) {
    for (const XmlNode* node : signals_node->Children("signal")) {
      Signal signal;
      signal.road_id = road->id;
      signal.id = StringAttr(*node, "id");
      signal.key = road->id + ":signal:" + signal.id;
      signal.name = StringAttr(*node, "name");
      signal.type = StringAttr(*node, "type");
      signal.subtype = StringAttr(*node, "subtype");
      signal.s = NumberAttr(*node, "s");
      signal.t = NumberAttr(*node, "t");
      signal.width = NumberAttr(*node, "width");
      signal.height = NumberAttr(*node, "height");
      signal.h_offset = NumberAttr(*node, "hOffset");
      signal.point = ProjectRoadPoint(*road, signal.s, signal.t);
      signal.shape = SignalShape(signal);
      signal.bounds = BoundsOf(signal.shape.size() >= 3
                                   ? signal.shape
                                   : std::vector<Point>{signal.point});
      road->signals.push_back(std::move(signal));
    }
  }
}

std::vector<Junction> ParseJunctions(const XmlNode& root) {
  std::vector<Junction> junctions;
  for (const XmlNode* node : root.Children("junction")) {
    Junction junction;
    junction.id = StringAttr(*node, "id");
    junction.name = StringAttr(*node, "name");
    junction.connection_count =
        static_cast<int>(node->Children("connection").size());
    junctions.push_back(std::move(junction));
  }
  return junctions;
}

}  // namespace

OpenDriveMap OpenDriveParser::Parse(const std::string& xml,
                                    const std::string& file_name) const {
  XmlLiteParser xml_parser;
  std::unique_ptr<XmlNode> root = xml_parser.Parse(xml);
  if (!root || root->name != "OpenDRIVE") {
    throw std::runtime_error("Input is not an OpenDRIVE document");
  }

  OpenDriveMap map;
  map.file_name = file_name;
  if (const XmlNode* header = root->FirstChild("header")) {
    map.header.name = StringAttr(*header, "name");
    map.header.rev_major = StringAttr(*header, "revMajor");
    map.header.rev_minor = StringAttr(*header, "revMinor");
    map.header.vendor = StringAttr(*header, "vendor");
    map.header.x_offset = NumberAttr(*header, "xOffset",
                                     NumberAttr(*header, "x_offs", 0.0));
    map.header.y_offset = NumberAttr(*header, "yOffset",
                                     NumberAttr(*header, "y_offs", 0.0));
    if (const XmlNode* geo = header->FirstChild("geoReference")) {
      map.header.geo_reference = geo->text;
    }
    if (const XmlNode* offset = header->FirstChild("offset")) {
      map.header.x_offset = NumberAttr(*offset, "x", map.header.x_offset);
      map.header.y_offset = NumberAttr(*offset, "y", map.header.y_offset);
    }
  }

  for (const XmlNode* road_node : root->Children("road")) {
    Road road;
    road.id = StringAttr(*road_node, "id");
    road.name = StringAttr(*road_node, "name");
    road.junction = StringAttr(*road_node, "junction", "-1");
    road.length = NumberAttr(*road_node, "length");
    road.reference_line = SampleReferenceLine(*road_node);

    if (const XmlNode* lanes_node = road_node->FirstChild("lanes")) {
      road.lane_offsets = ParsePolynomialEntries(*lanes_node, "laneOffset");
      const std::vector<const XmlNode*> sections =
          lanes_node->Children("laneSection");
      for (std::size_t i = 0; i < sections.size(); ++i) {
        const double section_end = (i + 1 < sections.size())
                                       ? NumberAttr(*sections[i + 1], "s")
                                       : road.length;
        std::vector<Lane> lanes =
            BuildLaneShapes(road, *sections[i], section_end);
        road.lanes.insert(road.lanes.end(),
                          std::make_move_iterator(lanes.begin()),
                          std::make_move_iterator(lanes.end()));
      }
    }

    ParseObjectsAndSignals(*road_node, &road);
    road.bounds = BoundsOf(road.reference_line);
    for (const Lane& lane : road.lanes) MergeBounds(&road.bounds, lane.bounds);
    for (const RoadObject& object : road.objects) {
      MergeBounds(&road.bounds, object.bounds);
    }
    for (const Signal& signal : road.signals) {
      MergeBounds(&road.bounds, signal.bounds);
    }
    if (HasValidBounds(road.bounds)) MergeBounds(&map.bounds, road.bounds);
    road.bounds = NormalizeBounds(road.bounds);
    map.stats.length_meters += road.length;
    map.stats.lanes += static_cast<int>(
        std::count_if(road.lanes.begin(), road.lanes.end(),
                      [](const Lane& lane) { return lane.id != 0; }));
    map.objects.insert(map.objects.end(), road.objects.begin(),
                       road.objects.end());
    map.signals.insert(map.signals.end(), road.signals.begin(),
                       road.signals.end());
    map.roads.push_back(std::move(road));
  }

  map.junctions = ParseJunctions(*root);
  map.stats.roads = static_cast<int>(map.roads.size());
  map.stats.objects = static_cast<int>(map.objects.size());
  map.stats.signals = static_cast<int>(map.signals.size());
  map.stats.junctions = static_cast<int>(map.junctions.size());
  map.bounds = NormalizeBounds(map.bounds);
  return map;
}

std::string ParseOpenDriveToJson(const std::string& xml,
                                 const std::string& file_name) {
  return SerializeOpenDriveMap(OpenDriveParser().Parse(xml, file_name));
}

}  // namespace odrweb
