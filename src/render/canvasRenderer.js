import {
  boundsOf,
  formatMeters,
  mergeBounds,
  pointToPolylineDistance,
  polygonContains,
  polylineLength,
} from "../domain/math.js";

const LAYERS = [
  { id: "lanes", label: "车道面", visible: true },
  { id: "laneLines", label: "车道线", visible: true },
  { id: "roadmarks", label: "路面标线", visible: true },
  { id: "objects", label: "对象", visible: true },
  { id: "signals", label: "信号", visible: true },
  { id: "referenceLines", label: "参考线", visible: false },
  { id: "junctions", label: "路口", visible: true },
];

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.map = null;
    this.layers = new Map(LAYERS.map((layer) => [layer.id, { ...layer }]));
    this.camera = { x: 0, y: 0, zoom: 1, pitch: 0 };
    this.hovered = null;
    this.selected = null;
    this.measurePoints = [];
    this.devicePixelRatio = 1;
    this.viewBounds = null;
    this.resize();
  }

  static layerDefinitions() {
    return LAYERS.map((layer) => ({ ...layer }));
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.devicePixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.devicePixelRatio));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.devicePixelRatio));
    this.draw();
  }

  setMap(map) {
    this.map = map;
    this.selected = null;
    this.hovered = null;
    this.measurePoints = [];
    this.fitToBounds(map?.bounds);
  }

  setLayerVisible(id, visible) {
    const layer = this.layers.get(id);
    if (layer) layer.visible = visible;
    this.draw();
  }

  setViewMode(mode) {
    this.camera.pitch = mode === "3d" ? 0.52 : 0;
    this.draw();
  }

  fitToBounds(bounds = this.map?.bounds) {
    if (!bounds) return;
    const width = this.canvas.width / this.devicePixelRatio;
    const height = this.canvas.height / this.devicePixelRatio;
    const dx = Math.max(1, bounds.maxX - bounds.minX);
    const dy = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min(width / dx, height / dy) * 0.82;
    this.camera = {
      ...this.camera,
      x: (bounds.minX + bounds.maxX) * 0.5,
      y: (bounds.minY + bounds.maxY) * 0.5,
      zoom: Math.max(0.02, scale),
    };
    this.draw();
  }

  panBy(dx, dy) {
    this.camera.x -= dx / this.camera.zoom;
    this.camera.y += dy / (this.camera.zoom * Math.cos(this.camera.pitch || 0));
    this.draw();
  }

  zoomAt(screen, delta) {
    const before = this.screenToWorld(screen);
    const factor = delta > 0 ? 1.12 : 0.89;
    this.camera.zoom = Math.max(0.02, Math.min(500, this.camera.zoom * factor));
    const after = this.screenToWorld(screen);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
    this.draw();
  }

  screenToWorld({ x, y }) {
    const width = this.canvas.width / this.devicePixelRatio;
    const height = this.canvas.height / this.devicePixelRatio;
    const cosPitch = Math.max(0.35, Math.cos(this.camera.pitch));
    return {
      x: (x - width * 0.5) / this.camera.zoom + this.camera.x,
      y: -(y - height * 0.5) / (this.camera.zoom * cosPitch) + this.camera.y,
    };
  }

  worldToScreen(point) {
    const width = this.canvas.width / this.devicePixelRatio;
    const height = this.canvas.height / this.devicePixelRatio;
    const cosPitch = Math.max(0.35, Math.cos(this.camera.pitch));
    return {
      x: (point.x - this.camera.x) * this.camera.zoom + width * 0.5,
      y: -(point.y - this.camera.y) * this.camera.zoom * cosPitch + height * 0.5,
    };
  }

  pick(screen) {
    if (!this.map) return null;
    const world = this.screenToWorld(screen);
    const tolerance = 10 / this.camera.zoom;
    const pickBounds = pointBounds(world, tolerance);

    for (const road of this.map.roads) {
      if (!boundsIntersects(road.bounds, pickBounds)) continue;
      for (const lane of road.lanes) {
        if (!boundsIntersects(lane.bounds, pickBounds)) continue;
        if (lane.polygon.length > 2 && polygonContains(world, lane.polygon)) {
          return { kind: "lane", road, lane, point: world };
        }
      }
    }

    let best = null;
    for (const signal of this.map.signals) {
      const d = Math.hypot(signal.point.x - world.x, signal.point.y - world.y);
      if (d < tolerance && (!best || d < best.distance)) best = { kind: "signal", signal, distance: d, point: world };
    }
    for (const object of this.map.objects) {
      const d = Math.hypot(object.point.x - world.x, object.point.y - world.y);
      if (d < tolerance && (!best || d < best.distance)) best = { kind: "object", object, distance: d, point: world };
    }
    for (const road of this.map.roads) {
      const d = pointToPolylineDistance(world, road.referenceLine);
      if (d < tolerance && (!best || d < best.distance)) best = { kind: "road", road, distance: d, point: world };
    }
    return best;
  }

  setHovered(hit) {
    if (hitIdentity(this.hovered) === hitIdentity(hit)) {
      this.hovered = hit;
      return;
    }
    this.hovered = hit;
    this.draw();
  }

  setSelected(hit) {
    this.selected = hit;
    this.draw();
  }

  addMeasurePoint(point) {
    this.measurePoints.push(point);
    this.draw();
    return this.measureDistance();
  }

  clearMeasure() {
    this.measurePoints = [];
    this.draw();
  }

  measureDistance() {
    return polylineLength(this.measurePoints);
  }

  centerOnHit(hit) {
    const bounds = hitToBounds(hit);
    if (bounds) this.fitToBounds(bounds);
  }

  exportPng() {
    return this.canvas.toDataURL("image/png");
  }

  draw() {
    const ctx = this.ctx;
    const width = this.canvas.width / this.devicePixelRatio;
    const height = this.canvas.height / this.devicePixelRatio;
    ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);
    ctx.fillStyle = "#0e1116";
    ctx.fillRect(0, 0, width, height);
    this.viewBounds = this.visibleWorldBounds(width, height);
    this.drawGrid(ctx, width, height);

    if (!this.map) {
      this.drawEmptyState(ctx, width, height);
      return;
    }

    if (this.layers.get("lanes")?.visible) this.drawLanes(ctx);
    if (this.layers.get("junctions")?.visible) this.drawJunctions(ctx);
    if (this.layers.get("referenceLines")?.visible) this.drawReferenceLines(ctx);
    if (this.layers.get("roadmarks")?.visible || this.layers.get("laneLines")?.visible) this.drawLaneLines(ctx);
    if (this.layers.get("objects")?.visible) this.drawObjects(ctx);
    if (this.layers.get("signals")?.visible) this.drawSignals(ctx);
    this.drawHit(ctx, this.hovered, "#f0c44f", 2);
    this.drawHit(ctx, this.selected, "#39c6a3", 3);
    this.drawMeasure(ctx);
  }

  visibleWorldBounds(width, height) {
    const nw = this.screenToWorld({ x: 0, y: 0 });
    const se = this.screenToWorld({ x: width, y: height });
    return {
      minX: Math.min(nw.x, se.x),
      minY: Math.min(nw.y, se.y),
      maxX: Math.max(nw.x, se.x),
      maxY: Math.max(nw.y, se.y),
    };
  }

  drawGrid(ctx, width, height) {
    const stepWorld = niceStep(80 / this.camera.zoom);
    const topLeft = this.screenToWorld({ x: 0, y: 0 });
    const bottomRight = this.screenToWorld({ x: width, y: height });
    ctx.strokeStyle = "rgba(84, 96, 112, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(topLeft.x / stepWorld) * stepWorld; x < bottomRight.x; x += stepWorld) {
      const a = this.worldToScreen({ x, y: topLeft.y });
      const b = this.worldToScreen({ x, y: bottomRight.y });
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    for (let y = Math.floor(bottomRight.y / stepWorld) * stepWorld; y < topLeft.y; y += stepWorld) {
      const a = this.worldToScreen({ x: topLeft.x, y });
      const b = this.worldToScreen({ x: bottomRight.x, y });
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  drawEmptyState(ctx, width, height) {
    ctx.fillStyle = "#9aa8b4";
    ctx.textAlign = "center";
    ctx.font = "15px system-ui, sans-serif";
    ctx.fillText("拖入或打开 OpenDRIVE .xodr 文件", width * 0.5, height * 0.5);
  }

  drawLanes(ctx) {
    for (const road of this.map.roads) {
      for (const lane of road.lanes) {
        if (!boundsIntersects(lane.bounds, this.viewBounds)) continue;
        if (lane.polygon.length < 3) continue;
        ctx.fillStyle = lane.color;
        ctx.globalAlpha = lane.laneType === "driving" ? 0.9 : 0.72;
        drawPolygon(ctx, lane.polygon, (p) => this.worldToScreen(p));
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawLaneLines(ctx) {
    ctx.lineWidth = Math.max(1, Math.min(2, this.camera.zoom * 0.04));
    for (const road of this.map.roads) {
      if (!boundsIntersects(road.bounds, this.viewBounds)) continue;
      for (const lane of road.lanes) {
        if (!boundsIntersects(lane.bounds, this.viewBounds)) continue;
        if (lane.centerline.length < 2) continue;
        ctx.strokeStyle = lane.laneId === 0 ? "#e8edf2" : "rgba(230, 236, 241, 0.38)";
        drawPolyline(ctx, lane.centerline, (p) => this.worldToScreen(p));
        ctx.stroke();
      }
    }
  }

  drawReferenceLines(ctx) {
    ctx.strokeStyle = "#ff7875";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    for (const road of this.map.roads) {
      if (!boundsIntersects(road.bounds, this.viewBounds)) continue;
      drawPolyline(ctx, road.referenceLine, (p) => this.worldToScreen(p));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  drawObjects(ctx) {
    const pad = 8 / this.camera.zoom;
    for (const object of this.map.objects) {
      if (!pointInBounds(object.point, this.viewBounds, pad)) continue;
      const p = this.worldToScreen(object.point);
      ctx.fillStyle = "#d59b62";
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
    }
  }

  drawSignals(ctx) {
    const pad = 8 / this.camera.zoom;
    for (const signal of this.map.signals) {
      if (!pointInBounds(signal.point, this.viewBounds, pad)) continue;
      const p = this.worldToScreen(signal.point);
      ctx.fillStyle = "#ef6f6c";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawJunctions(ctx) {
    const junctionRoads = this.map.roads.filter((road) => road.junction && road.junction !== "-1");
    const grouped = Map.groupBy ? Map.groupBy(junctionRoads, (road) => road.junction) : groupBy(junctionRoads, (road) => road.junction);
    ctx.strokeStyle = "rgba(57, 198, 163, 0.35)";
    ctx.lineWidth = 2;
    for (const roads of grouped.values()) {
      const bounds = mergeBounds(roads.map((road) => road.bounds));
      if (!Number.isFinite(bounds.minX)) continue;
      if (!boundsIntersects(bounds, this.viewBounds)) continue;
      const pad = 4;
      const nw = this.worldToScreen({ x: bounds.minX - pad, y: bounds.maxY + pad });
      const se = this.worldToScreen({ x: bounds.maxX + pad, y: bounds.minY - pad });
      ctx.strokeRect(nw.x, nw.y, se.x - nw.x, se.y - nw.y);
    }
  }

  drawHit(ctx, hit, color, lineWidth) {
    if (!hit) return;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    if (hit.kind === "lane") {
      drawPolygon(ctx, hit.lane.polygon, (p) => this.worldToScreen(p));
      ctx.stroke();
    } else if (hit.kind === "road") {
      drawPolyline(ctx, hit.road.referenceLine, (p) => this.worldToScreen(p));
      ctx.stroke();
    } else {
      const p = this.worldToScreen(hit.signal?.point ?? hit.object?.point);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawMeasure(ctx) {
    if (this.measurePoints.length === 0) return;
    ctx.strokeStyle = "#f0c44f";
    ctx.fillStyle = "#f0c44f";
    ctx.lineWidth = 2;
    drawPolyline(ctx, this.measurePoints, (p) => this.worldToScreen(p));
    ctx.stroke();
    for (const point of this.measurePoints) {
      const p = this.worldToScreen(point);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    const last = this.worldToScreen(this.measurePoints.at(-1));
    ctx.fillStyle = "#eef3f6";
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText(formatMeters(this.measureDistance()), last.x + 8, last.y - 8);
  }
}

function drawPolyline(ctx, points, project) {
  if (points.length === 0) return;
  const first = project(points[0]);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i += 1) {
    const p = project(points[i]);
    ctx.lineTo(p.x, p.y);
  }
}

function drawPolygon(ctx, points, project) {
  if (points.length === 0) return;
  const first = project(points[0]);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i += 1) {
    const p = project(points[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

function hitToBounds(hit) {
  if (!hit) return null;
  if (hit.kind === "lane") return hit.lane.bounds;
  if (hit.kind === "road") return hit.road.bounds;
  const point = hit.signal?.point ?? hit.object?.point;
  if (!point) return null;
  return boundsOf([{ x: point.x - 12, y: point.y - 12 }, { x: point.x + 12, y: point.y + 12 }]);
}

function hitIdentity(hit) {
  if (!hit) return "";
  if (hit.kind === "lane") return `lane:${hit.lane.key}`;
  if (hit.kind === "road") return `road:${hit.road.id}`;
  if (hit.kind === "signal") return `signal:${hit.signal.key}`;
  if (hit.kind === "object") return `object:${hit.object.key}`;
  return hit.kind;
}

function boundsIntersects(a, b) {
  if (!a || !b || !Number.isFinite(a.minX) || !Number.isFinite(b.minX)) return true;
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function pointBounds(point, pad) {
  return { minX: point.x - pad, minY: point.y - pad, maxX: point.x + pad, maxY: point.y + pad };
}

function pointInBounds(point, bounds, pad = 0) {
  if (!bounds) return true;
  return (
    point.x >= bounds.minX - pad &&
    point.x <= bounds.maxX + pad &&
    point.y >= bounds.minY - pad &&
    point.y <= bounds.maxY + pad
  );
}

function niceStep(value) {
  const power = 10 ** Math.floor(Math.log10(Math.max(value, 1e-6)));
  const normalized = value / power;
  if (normalized < 2) return 2 * power;
  if (normalized < 5) return 5 * power;
  return 10 * power;
}

function groupBy(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}
