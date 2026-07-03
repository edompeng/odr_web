import assert from "node:assert/strict";
import test from "node:test";

import { pointToPolylineDistance, polygonContains, polylineLength } from "../src/domain/math.js";
import {
  lanePolygonFromCenterline,
  lanePolygonFromOffsets,
  sampleGeometry,
  sampleGeometryAt,
  segmentPolylineByS,
  widthAt,
} from "../src/domain/opendriveGeometry.js";

test("samples line geometry at expected endpoints", () => {
  const geometry = { s: 0, x: 10, y: -4, hdg: 0, length: 20, kind: "line", data: {} };
  const points = sampleGeometry(geometry, 10);
  assert.equal(points.length, 3);
  assert.equal(points[0].x, 10);
  assert.equal(points[0].y, -4);
  assert.equal(points.at(-1).x, 30);
  assert.equal(points.at(-1).y, -4);
});

test("samples arc geometry with changing heading", () => {
  const geometry = { s: 0, x: 0, y: 0, hdg: 0, length: 10, kind: "arc", data: { curvature: 0.1 } };
  const point = sampleGeometryAt(geometry, 10);
  assert.ok(point.x > 8);
  assert.ok(point.y > 4);
  assert.ok(Math.abs(point.hdg - 1) < 1e-9);
});

test("evaluates lane width polynomial by active sOffset", () => {
  const widths = [
    { sOffset: 0, a: 3, b: 0, c: 0, d: 0 },
    { sOffset: 10, a: 4, b: 0.5, c: 0, d: 0 },
  ];
  assert.equal(widthAt(widths, 2), 3);
  assert.equal(widthAt(widths, 12), 5);
});

test("builds lane polygon from centerline offsets", () => {
  const centerline = [
    { x: 0, y: 0, hdg: 0, s: 0 },
    { x: 10, y: 0, hdg: 0, s: 10 },
  ];
  const polygon = lanePolygonFromCenterline(centerline, 0, 3.5);
  assert.equal(polygon.length, 4);
  assert.deepEqual(polygon[0], { x: 0, y: 0, hdg: 0, s: 0 });
  assert.equal(polygon[2].y, 3.5);
  assert.ok(polygonContains({ x: 5, y: 1 }, polygon));
  assert.equal(polygonContains({ x: 5, y: -1 }, polygon), false);
});

test("polyline helpers support measurement and picking", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 3, y: 4 },
    { x: 6, y: 4 },
  ];
  assert.equal(polylineLength(points), 8);
  assert.equal(pointToPolylineDistance({ x: 3, y: 6 }, points), 2);
});

test("segments reference line and supports variable lane offsets", () => {
  const centerline = [
    { x: 0, y: 0, hdg: 0, s: 0 },
    { x: 10, y: 0, hdg: 0, s: 10 },
    { x: 20, y: 0, hdg: 0, s: 20 },
  ];
  const segment = segmentPolylineByS(centerline, 5, 15);
  assert.equal(segment[0].s, 5);
  assert.equal(segment.at(-1).s, 15);
  assert.equal(segment.length, 3);

  const polygon = lanePolygonFromOffsets(segment, [0, 0, 0], [2, 3, 4]);
  assert.equal(polygon.length, 6);
  assert.equal(polygon[3].y, 4);
  assert.ok(polygonContains({ x: 10, y: 2 }, polygon));
});
