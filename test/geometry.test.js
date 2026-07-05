import assert from "node:assert/strict";
import test from "node:test";

import { CoordinateFormatter, parseCoordinateInput } from "../src/domain/coordinates.js";
import { createDefaultSettings, mergeViewerSettings } from "../src/domain/viewerSettings.js";
import {
  boundsOf,
  hasValidBounds,
  mergeBounds,
  pointToPolylineDistance,
  polygonContains,
  polylineLength,
} from "../src/domain/math.js";
import {
  lanePolygonFromCenterline,
  lanePolygonFromOffsets,
  sampleGeometry,
  sampleGeometryAt,
  segmentPolylineByS,
  widthAt,
} from "../src/domain/opendriveGeometry.js";
import { validateOpenDriveMap } from "../src/domain/topologyValidator.js";

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

test("bounds helpers skip empty geometry until a fallback is required", () => {
  const empty = boundsOf([]);
  assert.equal(hasValidBounds(empty), false);

  const merged = mergeBounds([empty, { minX: 1000, minY: 2000, maxX: 1010, maxY: 2020 }]);
  assert.deepEqual(merged, { minX: 1000, minY: 2000, maxX: 1010, maxY: 2020 });

  assert.deepEqual(mergeBounds([empty]), { minX: -10, minY: -10, maxX: 10, maxY: 10 });
});

test("coordinate formatter switches between UTM and longitude latitude display", () => {
  const formatter = new CoordinateFormatter({
    header: { geoReference: "+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs" },
  });
  formatter.setMode("lonlat");
  const point = formatter.point({ x: 500000, y: 0, hdg: 0, s: 0 });
  assert.ok(Math.abs(point.longitude - 117) < 1e-6);
  assert.ok(Math.abs(point.latitude) < 1e-6);

  formatter.setMap({ header: { geoReference: "" } });
  formatter.setMode("lonlat");
  assert.equal(formatter.mode, "utm");
  assert.deepEqual(formatter.point({ x: 1, y: 2 }), { easting: 1, northing: 2 });
});

test("coordinate formatter supports Transverse Mercator geoReference", () => {
  const formatter = new CoordinateFormatter({
    header: { geoReference: "+proj=tmerc +lat_0=0 +lon_0=117 +k=1 +x_0=500000 +y_0=0 +datum=WGS84" },
  });
  formatter.setMode("lonlat");
  const point = formatter.point({ x: 500000, y: 0 });
  assert.equal(formatter.canUseLonLat(), true);
  assert.ok(Math.abs(point.longitude - 117) < 1e-6);
  assert.ok(Math.abs(point.latitude) < 1e-6);

  const world = formatter.worldPoint({ x: 117, y: 0 });
  assert.ok(Math.abs(world.x - 500000) < 1e-6);
  assert.ok(Math.abs(world.y) < 1e-6);
});

test("coordinate input parser accepts comma, space, and semicolon separated points", () => {
  assert.deepEqual(parseCoordinateInput("1,2; (3 4 5); bad; 6,7"), [
    { x: 1, y: 2, z: 0 },
    { x: 3, y: 4, z: 5 },
    { x: 6, y: 7, z: 0 },
  ]);
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

test("topology validator reports invalid roads and degenerate lane geometry", () => {
  const issues = validateOpenDriveMap({
    roads: [
      {
        id: "r1",
        name: "broken",
        length: 0,
        referenceLine: [{ x: 0, y: 0 }],
        lanes: [
          { key: "r1:-1:0", laneId: -1, laneType: "driving", polygon: [{ x: 0, y: 0 }], centerline: [] },
          { key: "r1:0:0", laneId: 0, laneType: "none", polygon: [], centerline: [] },
        ],
        objects: [],
        signals: [],
      },
    ],
    objects: [{ key: "orphan", id: "o1", roadId: "missing", point: null }],
    signals: [{ key: "s1", id: "sig", roadId: "r1", point: { x: NaN, y: 0 } }],
  });

  assert.equal(issues.some((issue) => issue.severity === "error" && issue.code === "road.referenceLine.short"), true);
  assert.equal(issues.some((issue) => issue.code === "lane.polygon.short" && issue.hit.kind === "lane"), true);
  assert.equal(issues.some((issue) => issue.code === "object.road.missing"), true);
  assert.equal(issues.some((issue) => issue.code === "signal.point.invalid"), true);
});

test("viewer settings merge persisted values without trusting unknown keys", () => {
  const settings = mergeViewerSettings({
    coordinateMode: "lonlat",
    layers: { lanes: false, signals: true, unknown: false },
    favorites: [{ id: "road:1", title: "Road 1" }, { id: "", title: "bad" }],
  });

  assert.deepEqual(settings, {
    ...createDefaultSettings(),
    coordinateMode: "lonlat",
    layers: { lanes: false, signals: true },
    favorites: [{ id: "road:1", title: "Road 1" }],
  });
});
