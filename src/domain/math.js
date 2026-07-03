export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function cubic(coeff, ds) {
  return coeff.a + coeff.b * ds + coeff.c * ds * ds + coeff.d * ds * ds * ds;
}

export function boundsOf(points) {
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const p of points) {
    bounds.minX = Math.min(bounds.minX, p.x);
    bounds.minY = Math.min(bounds.minY, p.y);
    bounds.maxX = Math.max(bounds.maxX, p.x);
    bounds.maxY = Math.max(bounds.maxY, p.y);
  }
  if (!Number.isFinite(bounds.minX)) {
    return { minX: -10, minY: -10, maxX: 10, maxY: 10 };
  }
  return bounds;
}

export function mergeBounds(boundsList) {
  return boundsList.reduce(
    (out, b) => ({
      minX: Math.min(out.minX, b.minX),
      minY: Math.min(out.minY, b.minY),
      maxX: Math.max(out.maxX, b.maxX),
      maxY: Math.max(out.maxY, b.maxY),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

export function pointToSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-9) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

export function pointToPolylineDistance(point, points) {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return distance(point, points[0]);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i += 1) {
    best = Math.min(best, pointToSegmentDistance(point, points[i - 1], points[i]));
  }
  return best;
}

export function polygonContains(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y + 1e-12) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function formatMeters(value) {
  if (!Number.isFinite(value)) return "0.00 m";
  if (value >= 1000) return `${(value / 1000).toFixed(3)} km`;
  return `${value.toFixed(2)} m`;
}
