#pragma once

#include <string>
#include <vector>

namespace odrweb {

struct Point {
  double x = 0.0;
  double y = 0.0;
  double hdg = 0.0;
  double s = 0.0;
};

struct Bounds {
  double min_x = 1e100;
  double min_y = 1e100;
  double max_x = -1e100;
  double max_y = -1e100;
};

struct Width {
  double s_offset = 0.0;
  double a = 0.0;
  double b = 0.0;
  double c = 0.0;
  double d = 0.0;
};

struct RoadMark {
  std::string type;
  std::string color;
  std::string lane_change;
  double width = 0.12;
};

struct Lane {
  std::string key;
  std::string road_id;
  double section_s = 0.0;
  int id = 0;
  std::string type;
  std::string side;
  std::vector<Point> polygon;
  std::vector<Point> centerline;
  std::vector<RoadMark> road_marks;
  Bounds bounds;
};

struct RoadObject {
  std::string key;
  std::string road_id;
  std::string id;
  std::string name;
  std::string type;
  double s = 0.0;
  double t = 0.0;
  double hdg = 0.0;
  double width = 0.0;
  double length = 0.0;
  double height = 0.0;
  Point point;
  std::vector<Point> outline;
  Bounds bounds;
};

struct Signal {
  std::string key;
  std::string road_id;
  std::string id;
  std::string name;
  std::string type;
  std::string subtype;
  double s = 0.0;
  double t = 0.0;
  double width = 0.0;
  double height = 0.0;
  double h_offset = 0.0;
  Point point;
  std::vector<Point> shape;
  Bounds bounds;
};

struct Junction {
  std::string id;
  std::string name;
  int connection_count = 0;
};

struct Road {
  std::string id;
  std::string name;
  std::string junction;
  double length = 0.0;
  std::vector<Point> reference_line;
  std::vector<Width> lane_offsets;
  std::vector<Lane> lanes;
  std::vector<RoadObject> objects;
  std::vector<Signal> signals;
  Bounds bounds;
};

struct Header {
  std::string name;
  std::string rev_major;
  std::string rev_minor;
  std::string vendor;
  std::string geo_reference;
};

struct Stats {
  int roads = 0;
  int lanes = 0;
  int objects = 0;
  int signals = 0;
  int junctions = 0;
  double length_meters = 0.0;
};

struct OpenDriveMap {
  std::string file_name;
  Header header;
  std::vector<Road> roads;
  std::vector<RoadObject> objects;
  std::vector<Signal> signals;
  std::vector<Junction> junctions;
  Bounds bounds;
  Stats stats;
};

}  // namespace odrweb
