import { boundsOf, cubic } from "./math.js";

const DEFAULT_STEP_METERS = 2.5;

function normalFromHeading(hdg) {
  return { x: -Math.sin(hdg), y: Math.cos(hdg) };
}

function attrNumber(node, name, fallback = 0) {
  const raw = node?.getAttribute(name);
  if (raw === null || raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function sampleGeometry(geometry, stepMeters = DEFAULT_STEP_METERS) {
  const length = Math.max(0, geometry.length);
  const steps = Math.max(2, Math.ceil(length / stepMeters) + 1);
  const points = [];
  for (let i = 0; i < steps; i += 1) {
    const s = length * (i / (steps - 1));
    points.push(sampleGeometryAt(geometry, s));
  }
  return points;
}

export function sampleGeometryAt(geometry, ds) {
  const { x, y, hdg, kind, data } = geometry;
  if (kind === "arc") {
    const curvature = data.curvature || 0;
    if (Math.abs(curvature) < 1e-9) {
      return { x: x + ds * Math.cos(hdg), y: y + ds * Math.sin(hdg), hdg, s: geometry.s + ds };
    }
    const radius = 1 / curvature;
    const theta = ds * curvature;
    return {
      x: x + radius * (Math.sin(hdg + theta) - Math.sin(hdg)),
      y: y - radius * (Math.cos(hdg + theta) - Math.cos(hdg)),
      hdg: hdg + theta,
      s: geometry.s + ds,
    };
  }

  if (kind === "poly3") {
    const u = ds;
    const v = cubic(data, ds);
    return {
      x: x + u * Math.cos(hdg) - v * Math.sin(hdg),
      y: y + u * Math.sin(hdg) + v * Math.cos(hdg),
      hdg: hdg + Math.atan(data.b + 2 * data.c * ds + 3 * data.d * ds * ds),
      s: geometry.s + ds,
    };
  }

  if (kind === "paramPoly3") {
    const p = data.pRange === "normalized" ? ds / Math.max(geometry.length, 1e-9) : ds;
    const u = cubic(data.u, p);
    const v = cubic(data.v, p);
    const du = data.u.b + 2 * data.u.c * p + 3 * data.u.d * p * p;
    const dv = data.v.b + 2 * data.v.c * p + 3 * data.v.d * p * p;
    return {
      x: x + u * Math.cos(hdg) - v * Math.sin(hdg),
      y: y + u * Math.sin(hdg) + v * Math.cos(hdg),
      hdg: hdg + Math.atan2(dv, du || 1e-9),
      s: geometry.s + ds,
    };
  }

  if (kind === "spiral") {
    return sampleSpiralApprox(geometry, ds);
  }

  return { x: x + ds * Math.cos(hdg), y: y + ds * Math.sin(hdg), hdg, s: geometry.s + ds };
}

function sampleSpiralApprox(geometry, ds) {
  const steps = Math.max(2, Math.ceil(ds / 1.5));
  let x = geometry.x;
  let y = geometry.y;
  let hdg = geometry.hdg;
  let previousS = 0;
  for (let i = 1; i <= steps; i += 1) {
    const currentS = ds * (i / steps);
    const midS = (previousS + currentS) * 0.5;
    const curvature =
      geometry.data.curvStart +
      (geometry.data.curvEnd - geometry.data.curvStart) * (midS / Math.max(geometry.length, 1e-9));
    const delta = currentS - previousS;
    hdg += curvature * delta;
    x += delta * Math.cos(hdg);
    y += delta * Math.sin(hdg);
    previousS = currentS;
  }
  return { x, y, hdg, s: geometry.s + ds };
}

export function offsetPolyline(centerline, offset) {
  return centerline.map((p) => {
    const normal = normalFromHeading(p.hdg);
    return { x: p.x + normal.x * offset, y: p.y + normal.y * offset, z: p.z ?? 0, hdg: p.hdg, s: p.s };
  });
}

export function offsetPolylineByOffsets(centerline, offsets) {
  return centerline.map((p, index) => {
    const normal = normalFromHeading(p.hdg);
    const offset = offsets[index] ?? 0;
    return { x: p.x + normal.x * offset, y: p.y + normal.y * offset, z: p.z ?? 0, hdg: p.hdg, s: p.s };
  });
}

export function lanePolygonFromCenterline(centerline, innerOffset, outerOffset) {
  const inner = offsetPolyline(centerline, innerOffset);
  const outer = offsetPolyline(centerline, outerOffset);
  return [...inner, ...outer.reverse()];
}

export function lanePolygonFromOffsets(centerline, innerOffsets, outerOffsets) {
  const inner = offsetPolylineByOffsets(centerline, innerOffsets);
  const outer = offsetPolylineByOffsets(centerline, outerOffsets);
  return [...inner, ...outer.reverse()];
}

export function interpolatePointAtS(points, s) {
  if (points.length === 0) return { x: 0, y: 0, hdg: 0, s };
  if (s <= points[0].s) return { ...points[0], s: points[0].s };
  if (s >= points.at(-1).s) return { ...points.at(-1), s: points.at(-1).s };

  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].s < s) low = mid + 1;
    else high = mid;
  }

  const next = points[low];
  const prev = points[low - 1];
  const span = Math.max(1e-9, next.s - prev.s);
  const ratio = (s - prev.s) / span;
  return {
    x: prev.x + (next.x - prev.x) * ratio,
    y: prev.y + (next.y - prev.y) * ratio,
    z: (prev.z ?? 0) + ((next.z ?? 0) - (prev.z ?? 0)) * ratio,
    hdg: prev.hdg + (next.hdg - prev.hdg) * ratio,
    s,
  };
}

export function segmentPolylineByS(points, startS, endS) {
  if (points.length === 0 || endS <= startS) return [];
  const start = Math.max(startS, points[0].s);
  const end = Math.min(endS, points.at(-1).s);
  if (end < start) return [];

  const segment = [interpolatePointAtS(points, start)];
  for (const point of points) {
    if (point.s > start + 1e-9 && point.s < end - 1e-9) {
      segment.push(point);
    }
  }
  if (end > start + 1e-9) segment.push(interpolatePointAtS(points, end));
  return segment;
}

export function polylineBounds(polyline) {
  return boundsOf(polyline);
}

export function parseGeometryNode(node) {
  const child = [...node.children].find((entry) =>
    ["line", "arc", "spiral", "poly3", "paramPoly3"].includes(entry.localName),
  );
  const kind = child?.localName ?? "line";
  const data = {};
  if (kind === "arc") data.curvature = attrNumber(child, "curvature");
  if (kind === "spiral") {
    data.curvStart = attrNumber(child, "curvStart");
    data.curvEnd = attrNumber(child, "curvEnd");
  }
  if (kind === "poly3") {
    data.a = attrNumber(child, "a");
    data.b = attrNumber(child, "b");
    data.c = attrNumber(child, "c");
    data.d = attrNumber(child, "d");
  }
  if (kind === "paramPoly3") {
    data.pRange = child.getAttribute("pRange") || "normalized";
    data.u = {
      a: attrNumber(child, "aU"),
      b: attrNumber(child, "bU", 1),
      c: attrNumber(child, "cU"),
      d: attrNumber(child, "dU"),
    };
    data.v = {
      a: attrNumber(child, "aV"),
      b: attrNumber(child, "bV"),
      c: attrNumber(child, "cV"),
      d: attrNumber(child, "dV"),
    };
  }
  return {
    s: attrNumber(node, "s"),
    x: attrNumber(node, "x"),
    y: attrNumber(node, "y"),
    hdg: attrNumber(node, "hdg"),
    length: attrNumber(node, "length"),
    kind,
    data,
  };
}

export function widthAt(widthEntries, localS) {
  if (widthEntries.length === 0) return 3.5;
  let selected = widthEntries[0];
  for (const entry of widthEntries) {
    if (entry.sOffset <= localS) selected = entry;
  }
  return Math.max(0, cubic(selected, Math.max(0, localS - selected.sOffset)));
}

export function elevationAt(elevationEntries, s) {
  if (elevationEntries.length === 0) return 0;
  let selected = elevationEntries[0];
  for (const entry of elevationEntries) {
    if (entry.sOffset <= s) selected = entry;
  }
  return cubic(selected, Math.max(0, s - selected.sOffset));
}
