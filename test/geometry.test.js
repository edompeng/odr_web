import assert from "node:assert/strict";
import test from "node:test";

import { CoordinateFormatter, parseCoordinateInput, serializeWithDisplayCoordinates } from "../src/domain/coordinates.js";
import { parseParserWorkerRequest } from "../src/domain/parserWorkerProtocol.js";
import { createDefaultSettings, mergeViewerSettings } from "../src/domain/viewerSettings.js";
import { SpatialIndex } from "../src/render/spatialIndex.js";
import {
  boundsOf,
  hasValidBounds,
  mergeBounds,
  pointToPolylineDistance,
  polygonContains,
  polylineLength,
} from "../src/domain/math.js";
import {
  elevationAt,
  lanePolygonFromCenterline,
  lanePolygonFromOffsets,
  samplingStepForLength,
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

test("default geometry sampling caps long segments", () => {
  assert.equal(samplingStepForLength(20), 2.5);
  assert.equal(samplingStepForLength(5000), 5000 / 256);
  const geometry = { s: 0, x: 0, y: 0, hdg: 0, length: 5000, kind: "line", data: {} };
  const points = sampleGeometry(geometry);
  assert.equal(points.length, 257);
  assert.equal(points.at(-1).x, 5000);
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

test("evaluates road elevation polynomial by active s", () => {
  const elevations = [
    { sOffset: 0, a: 1, b: 0.5, c: 0, d: 0 },
    { sOffset: 10, a: 10, b: 1, c: 0, d: 0 },
  ];
  assert.equal(elevationAt(elevations, 4), 3);
  assert.equal(elevationAt(elevations, 12), 12);
});

test("builds lane polygon from centerline offsets", () => {
  const centerline = [
    { x: 0, y: 0, z: 1, hdg: 0, s: 0 },
    { x: 10, y: 0, z: 3, hdg: 0, s: 10 },
  ];
  const polygon = lanePolygonFromCenterline(centerline, 0, 3.5);
  assert.equal(polygon.length, 4);
  assert.deepEqual(polygon[0], { x: 0, y: 0, z: 1, hdg: 0, s: 0 });
  assert.equal(polygon[2].y, 3.5);
  assert.equal(polygon[2].z, 3);
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
  assert.deepEqual(formatter.point({ x: 1, y: 2 }), { easting: 1, northing: 2, height: 0 });
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

test("coordinate formatter uses proj geoReference strings and header offsets", () => {
  const formatter = new CoordinateFormatter({
    header: {
      geoReference:
        "+proj=tmerc +ellps=WGS84 +datum=WGS84 +k_0=1 +lon_0=100.761986185656 +lat_0=0 +x_0=0 +y_0=-3080868.788728 +units=m",
      xOffset: 0,
      yOffset: -3080868.788728,
    },
  });
  formatter.setMode("lonlat");

  const point = formatter.point({ x: 0, y: 0 });
  assert.ok(Math.abs(point.longitude - 100.761986185656) < 1e-8);
  assert.ok(Math.abs(point.latitude) < 1e-8);

  const world = formatter.worldPoint({ x: 100.761986185656, y: 0 });
  assert.ok(Math.abs(world.x) < 1e-6);
  assert.ok(Math.abs(world.y) < 1e-6);
});

test("coordinate formatter does not serialize invalid longitude latitude as null", () => {
  const formatter = new CoordinateFormatter({
    header: { geoReference: "+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs" },
  });
  formatter.setMode("lonlat");

  const json = formatter.point({ x: 1e100, y: 1e100 });
  assert.deepEqual(json, { easting: 1e100, northing: 1e100, height: 0 });
  assert.equal(serializeWithDisplayCoordinates({ point: { x: 1e100, y: 1e100 } }, formatter).includes("null"), false);
});

test("coordinate formatter displays height in all coordinate modes", () => {
  const formatter = new CoordinateFormatter({
    header: { geoReference: "+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs" },
  });

  assert.deepEqual(formatter.point({ x: 500000, y: 0, z: 12.3456 }), {
    easting: 500000,
    northing: 0,
    height: 12.346,
  });
  assert.equal(formatter.status({ x: 500000, y: 0, z: 12.3456 }), "E: 500000.000, N: 0.000, H: 12.346");

  formatter.setMode("lonlat");
  const lonLat = formatter.point({ x: 500000, y: 0, z: 12.3456 });
  assert.equal(lonLat.altitude, 12.346);
  assert.equal(formatter.status({ x: 500000, y: 0, z: 12.3456 }), "lon: 117.00000000, lat: 0.00000000, H: 12.346");

  const serialized = serializeWithDisplayCoordinates({ point: { x: 500000, y: 0, z: 12.3456 } }, formatter);
  assert.equal(serialized.includes('"altitude": 12.346'), true);
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

test("parser worker returns decoded XML when WASM parsing fails", async () => {
  const response = await parseParserWorkerRequest(
    { id: 7, fileName: "large.xodr", text: "<OpenDRIVE/>" },
    {
      mode: "wasm",
      parse() {
        throw new Error("OOM");
      },
    },
  );

  assert.equal(response.ok, false);
  assert.equal(response.recoverable, true);
  assert.equal(response.fileName, "large.xodr");
  assert.equal(response.text, "<OpenDRIVE/>");
  assert.equal(response.message, "OOM");
});

test("parser worker decodes ArrayBuffer inputs through a byte view", async () => {
  const bytes = new TextEncoder().encode("<OpenDRIVE/>");
  const response = await parseParserWorkerRequest(
    { id: 9, fileName: "resizable.xodr", buffer: bytes.buffer },
    {
      mode: "test",
      parse(xml, fileName) {
        assert.equal(xml, "<OpenDRIVE/>");
        return { fileName };
      },
    },
    {
      decode(input) {
        assert.equal(input instanceof Uint8Array, true);
        return new TextDecoder("utf-8").decode(input);
      },
    },
  );

  assert.equal(response.ok, true);
  assert.deepEqual(response.map, { fileName: "resizable.xodr" });
});

test("parser worker does not return very large XML to the main thread", async () => {
  const response = await parseParserWorkerRequest(
    { id: 8, fileName: "huge.xodr", text: "<OpenDRIVE/>" },
    {
      mode: "wasm",
      parse() {
        throw new Error("OOM");
      },
    },
    undefined,
    { maxRecoveryTextLength: 4 },
  );

  assert.equal(response.ok, false);
  assert.equal(response.recoverable, false);
  assert.equal(response.text, undefined);
  assert.match(response.message, /JavaScript fallback is disabled/);
});

test("spatial index returns only items intersecting query bounds", () => {
  const items = [
    { id: "a", bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
    { id: "b", bounds: { minX: 50, minY: 50, maxX: 60, maxY: 60 } },
    { id: "c", bounds: { minX: 100, minY: 100, maxX: 110, maxY: 110 } },
  ];
  const index = SpatialIndex.fromItems(items, (item) => item.bounds, {
    minX: 0,
    minY: 0,
    maxX: 120,
    maxY: 120,
  });

  assert.deepEqual(
    index.query({ minX: 45, minY: 45, maxX: 65, maxY: 65 }).map((item) => item.id),
    ["b"],
  );
  assert.deepEqual(
    index.query({ minX: -5, minY: -5, maxX: 12, maxY: 12 }).map((item) => item.id),
    ["a"],
  );
});
