import {
  lanePolygonFromOffsets,
  offsetPolylineByOffsets,
  parseGeometryNode,
  sampleGeometry,
  segmentPolylineByS,
  widthAt,
} from "./opendriveGeometry.js";
import { boundsOf, hasValidBounds, mergeBounds } from "./math.js";

const LANE_COLORS = new Map([
  ["driving", "#335f78"],
  ["shoulder", "#4a5360"],
  ["sidewalk", "#52644e"],
  ["border", "#4c4c55"],
  ["restricted", "#5f4b4b"],
  ["parking", "#655b45"],
  ["biking", "#3e665f"],
]);

function attr(node, name, fallback = "") {
  return node?.getAttribute(name) ?? fallback;
}

function attrNumber(node, name, fallback = 0) {
  const raw = node?.getAttribute(name);
  if (raw === null || raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function directChildren(node, name) {
  if (!node) return [];
  return [...node.children].filter((child) => child.localName === name);
}

function firstDirect(node, name) {
  return directChildren(node, name)[0] ?? null;
}

function parseWidthEntries(laneNode) {
  return directChildren(laneNode, "width")
    .map((node) => ({
      sOffset: attrNumber(node, "sOffset"),
      a: attrNumber(node, "a"),
      b: attrNumber(node, "b"),
      c: attrNumber(node, "c"),
      d: attrNumber(node, "d"),
    }))
    .sort((a, b) => a.sOffset - b.sOffset);
}

function parseRoadMarks(laneNode) {
  return directChildren(laneNode, "roadMark").map((node) => ({
    type: attr(node, "type", "unknown"),
    color: attr(node, "color", "white"),
    laneChange: attr(node, "laneChange", ""),
    width: attrNumber(node, "width", 0.12),
  }));
}

function parseLanes(sectionNode, side) {
  const sideNode = firstDirect(sectionNode, side);
  if (!sideNode) return [];
  return directChildren(sideNode, "lane").map((laneNode) => ({
    id: attrNumber(laneNode, "id"),
    type: attr(laneNode, "type", "unknown"),
    level: attr(laneNode, "level", "false"),
    widths: parseWidthEntries(laneNode),
    roadMarks: parseRoadMarks(laneNode),
    side,
  }));
}

function sampleRoadReferenceLine(roadNode) {
  const planView = firstDirect(roadNode, "planView");
  const geometries = directChildren(planView, "geometry").map(parseGeometryNode);
  const points = [];
  for (const geometry of geometries) {
    const sampled = sampleGeometry(geometry);
    if (points.length > 0 && sampled.length > 0) sampled.shift();
    points.push(...sampled);
  }
  return points;
}

function buildLaneShapes(road, sectionNode, sectionEnd) {
  const sectionS = attrNumber(sectionNode, "s");
  const sectionLine = segmentPolylineByS(road.referenceLine, sectionS, sectionEnd);
  if (sectionLine.length < 2) return [];
  const laneGroups = {
    left: parseLanes(sectionNode, "left").sort((a, b) => a.id - b.id),
    right: parseLanes(sectionNode, "right").sort((a, b) => Math.abs(a.id) - Math.abs(b.id)),
    center: parseLanes(sectionNode, "center"),
  };
  const shapes = [];

  for (const side of ["left", "right"]) {
    const cumulative = new Array(sectionLine.length).fill(0);
    const sign = side === "left" ? 1 : -1;
    for (const lane of laneGroups[side]) {
      const innerOffsets = new Array(sectionLine.length);
      const outerOffsets = new Array(sectionLine.length);
      const centerOffsets = new Array(sectionLine.length);
      sectionLine.forEach((point, index) => {
        const width = widthAt(lane.widths, Math.max(0, point.s - sectionS));
        innerOffsets[index] = sign * cumulative[index];
        cumulative[index] += width;
        outerOffsets[index] = sign * cumulative[index];
        centerOffsets[index] = (innerOffsets[index] + outerOffsets[index]) * 0.5;
      });
      const polygon = lanePolygonFromOffsets(sectionLine, innerOffsets, outerOffsets);
      const centerline = offsetPolylineByOffsets(sectionLine, centerOffsets);
      shapes.push({
        key: `${road.id}:${sectionS}:${lane.id}`,
        roadId: road.id,
        sectionS,
        laneId: lane.id,
        laneType: lane.type,
        side,
        polygon,
        centerline,
        bounds: boundsOf(polygon),
        color: LANE_COLORS.get(lane.type) ?? "#46525f",
        roadMarks: lane.roadMarks,
      });
    }
  }

  for (const lane of laneGroups.center) {
    shapes.push({
      key: `${road.id}:${sectionS}:0`,
      roadId: road.id,
      sectionS,
      laneId: lane.id,
      laneType: lane.type,
      side: "center",
      polygon: [],
      centerline: sectionLine,
      bounds: boundsOf(sectionLine),
      color: "#d9dde2",
      roadMarks: lane.roadMarks,
    });
  }

  return shapes;
}

function parseObjects(roadNode, road) {
  const objectsNode = firstDirect(roadNode, "objects");
  return directChildren(objectsNode, "object").map((node) => ({
    key: `${road.id}:object:${attr(node, "id")}`,
    roadId: road.id,
    id: attr(node, "id"),
    name: attr(node, "name"),
    type: attr(node, "type"),
    s: attrNumber(node, "s"),
    t: attrNumber(node, "t"),
    width: attrNumber(node, "width"),
    length: attrNumber(node, "length"),
  }));
}

function parseSignals(roadNode, road) {
  const signalsNode = firstDirect(roadNode, "signals");
  return directChildren(signalsNode, "signal").map((node) => ({
    key: `${road.id}:signal:${attr(node, "id")}`,
    roadId: road.id,
    id: attr(node, "id"),
    name: attr(node, "name"),
    type: attr(node, "type"),
    subtype: attr(node, "subtype"),
    s: attrNumber(node, "s"),
    t: attrNumber(node, "t"),
  }));
}

function parseJunctions(doc) {
  return [...doc.querySelectorAll("OpenDRIVE > junction")].map((node) => ({
    id: attr(node, "id"),
    name: attr(node, "name"),
    connectionCount: directChildren(node, "connection").length,
  }));
}

function projectRoadPoint(road, s, t) {
  if (road.referenceLine.length === 0) return { x: 0, y: 0 };
  let nearest = road.referenceLine[0];
  let best = Number.POSITIVE_INFINITY;
  for (const p of road.referenceLine) {
    const d = Math.abs((p.s ?? 0) - s);
    if (d < best) {
      best = d;
      nearest = p;
    }
  }
  return {
    x: nearest.x - Math.sin(nearest.hdg) * t,
    y: nearest.y + Math.cos(nearest.hdg) * t,
    hdg: nearest.hdg,
  };
}

function hasRenderableGeometry(road) {
  return (
    road.referenceLine.length > 0 ||
    road.lanes.some((lane) => lane.polygon.length > 0 || lane.centerline.length > 0) ||
    road.objects.length > 0 ||
    road.signals.length > 0
  );
}

export class OpenDriveParser {
  parse(text, fileName = "untitled.xodr") {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      throw new Error(parserError.textContent?.trim() || "OpenDRIVE XML 解析失败");
    }

    const header = doc.querySelector("OpenDRIVE > header");
    const roads = [...doc.querySelectorAll("OpenDRIVE > road")].map((roadNode) => {
      const road = {
        id: attr(roadNode, "id"),
        name: attr(roadNode, "name"),
        junction: attr(roadNode, "junction", "-1"),
        length: attrNumber(roadNode, "length"),
        referenceLine: sampleRoadReferenceLine(roadNode),
        lanes: [],
        objects: [],
        signals: [],
      };
      const lanesNode = firstDirect(roadNode, "lanes");
      const sections = directChildren(lanesNode, "laneSection");
      road.lanes = sections.flatMap((sectionNode, index) => {
        const sectionEnd = index + 1 < sections.length ? attrNumber(sections[index + 1], "s") : road.length;
        return buildLaneShapes(road, sectionNode, sectionEnd);
      });
      road.objects = parseObjects(roadNode, road).map((object) => ({
        ...object,
        point: projectRoadPoint(road, object.s, object.t),
      }));
      road.signals = parseSignals(roadNode, road).map((signal) => ({
        ...signal,
        point: projectRoadPoint(road, signal.s, signal.t),
      }));
      road.bounds = mergeBounds([boundsOf(road.referenceLine), ...road.lanes.map((lane) => lane.bounds)]);
      return road;
    });

    const laneCount = roads.reduce((sum, road) => sum + road.lanes.filter((lane) => lane.laneId !== 0).length, 0);
    const objects = roads.flatMap((road) => road.objects);
    const signals = roads.flatMap((road) => road.signals);
    const junctions = parseJunctions(doc);
    const bounds = mergeBounds(
      roads
        .filter(hasRenderableGeometry)
        .map((road) => road.bounds)
        .filter(hasValidBounds),
    );

    return {
      fileName,
      header: {
        name: attr(header, "name"),
        revMajor: attr(header, "revMajor"),
        revMinor: attr(header, "revMinor"),
        vendor: attr(header, "vendor"),
        geoReference: doc.querySelector("OpenDRIVE > header > geoReference")?.textContent?.trim() ?? "",
      },
      roads,
      objects,
      signals,
      junctions,
      bounds,
      stats: {
        roads: roads.length,
        lanes: laneCount,
        objects: objects.length,
        signals: signals.length,
        junctions: junctions.length,
        lengthMeters: roads.reduce((sum, road) => sum + road.length, 0),
      },
    };
  }
}
