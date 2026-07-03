#pragma once

#include <cmath>
#include <vector>

#include "src/cpp/odr/model.h"

namespace odrweb {

inline double Cubic(double a, double b, double c, double d, double x) {
  return ((d * x + c) * x + b) * x + a;
}

inline void ExtendBounds(Bounds* bounds, const Point& point) {
  bounds->min_x = std::min(bounds->min_x, point.x);
  bounds->min_y = std::min(bounds->min_y, point.y);
  bounds->max_x = std::max(bounds->max_x, point.x);
  bounds->max_y = std::max(bounds->max_y, point.y);
}

inline void MergeBounds(Bounds* out, const Bounds& in) {
  if (!std::isfinite(in.min_x)) return;
  out->min_x = std::min(out->min_x, in.min_x);
  out->min_y = std::min(out->min_y, in.min_y);
  out->max_x = std::max(out->max_x, in.max_x);
  out->max_y = std::max(out->max_y, in.max_y);
}

inline Bounds BoundsOf(const std::vector<Point>& points) {
  Bounds bounds;
  for (const Point& point : points) {
    ExtendBounds(&bounds, point);
  }
  return bounds;
}

inline Point OffsetPoint(const Point& point, double offset) {
  Point out = point;
  out.x += -std::sin(point.hdg) * offset;
  out.y += std::cos(point.hdg) * offset;
  return out;
}

inline double WidthAt(const std::vector<Width>& widths, double local_s) {
  if (widths.empty()) return 3.5;
  const Width* selected = &widths.front();
  for (const Width& width : widths) {
    if (width.s_offset <= local_s) selected = &width;
  }
  const double x = std::max(0.0, local_s - selected->s_offset);
  return std::max(0.0,
                  Cubic(selected->a, selected->b, selected->c, selected->d, x));
}

}  // namespace odrweb
