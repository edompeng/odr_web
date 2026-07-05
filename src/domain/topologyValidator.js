import { hasValidBounds } from "./math.js";

export function validateOpenDriveMap(map) {
  const issues = [];
  if (!map || !Array.isArray(map.roads) || map.roads.length === 0) {
    issues.push(issue("error", "map.roads.empty", "地图没有可渲染道路"));
    return issues;
  }

  const roadIds = new Set(map.roads.map((road) => String(road.id)));
  for (const road of map.roads) validateRoad(road, issues);
  for (const object of map.objects ?? []) validatePlacedElement("object", object, roadIds, issues);
  for (const signal of map.signals ?? []) validatePlacedElement("signal", signal, roadIds, issues);
  return issues;
}

function validateRoad(road, issues) {
  const roadHit = { kind: "road", road };
  if (!Array.isArray(road.referenceLine) || road.referenceLine.length < 2) {
    issues.push(issue("error", "road.referenceLine.short", `Road ${road.id} 参考线点数不足`, roadHit));
  }
  if (!Number.isFinite(road.length) || road.length <= 0) {
    issues.push(issue("warning", "road.length.invalid", `Road ${road.id} 长度无效`, roadHit));
  }
  if (!hasValidBounds(road.bounds)) {
    issues.push(issue("warning", "road.bounds.invalid", `Road ${road.id} 包围盒无效`, roadHit));
  }

  const lanes = Array.isArray(road.lanes) ? road.lanes : [];
  if (lanes.filter((lane) => lane.laneId !== 0).length === 0) {
    issues.push(issue("warning", "road.lanes.empty", `Road ${road.id} 没有非中心车道`, roadHit));
  }
  for (const lane of lanes) validateLane(road, lane, issues);
}

function validateLane(road, lane, issues) {
  if (lane.laneId === 0) return;
  const laneHit = { kind: "lane", road, lane };
  if (!Array.isArray(lane.centerline) || lane.centerline.length < 2) {
    issues.push(issue("warning", "lane.centerline.short", `Road ${road.id} lane ${lane.laneId} 中线点数不足`, laneHit));
  }
  if (!Array.isArray(lane.polygon) || lane.polygon.length < 3) {
    issues.push(issue("warning", "lane.polygon.short", `Road ${road.id} lane ${lane.laneId} 面几何点数不足`, laneHit));
  }
}

function validatePlacedElement(kind, element, roadIds, issues) {
  const hit = kind === "signal" ? { kind, signal: element } : { kind, object: element };
  const label = `${kind} ${element.id || element.key || ""}`.trim();
  if (!roadIds.has(String(element.roadId))) {
    issues.push(issue("warning", `${kind}.road.missing`, `${label} 引用的 roadId 不存在`, hit));
  }
  if (!isFinitePoint(element.point)) {
    issues.push(issue("warning", `${kind}.point.invalid`, `${label} 坐标无效`, hit));
  }
}

function isFinitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function issue(severity, code, message, hit = null) {
  return { severity, code, message, hit };
}
