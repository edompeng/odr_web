import { serializeWithDisplayCoordinates } from "../domain/coordinates.js";

export function buildTreeNodes(map) {
  if (!map) return [];
  return map.roads.map((road) => ({
    id: `road:${road.id}`,
    kind: "road",
    label: `${road.id} ${road.name || ""}`.trim(),
    search: `road ${road.id} ${road.name}`,
    hit: { kind: "road", road },
    childrenFactory: () => [
      groupNode(
        `road:${road.id}:lanes`,
        "lanes",
        `车道 (${road.lanes.filter((lane) => lane.laneId !== 0).length})`,
        () => road.lanes
          .filter((lane) => lane.laneId !== 0)
          .map((lane) => ({
            id: `lane:${lane.key}`,
            kind: "lane",
            label: `lane ${lane.laneId} (${lane.laneType})`,
            search: `lane ${road.id} ${lane.laneId} ${lane.laneType}`,
            hit: { kind: "lane", road, lane },
            children: [],
          })),
      ),
      groupNode(
        `road:${road.id}:objects`,
        "objects",
        `对象 (${road.objects.length})`,
        () => road.objects.map((object) => ({
          id: `object:${object.key}`,
          kind: "obj",
          label: object.id || object.type || "object",
          search: `object ${road.id} ${object.id} ${object.name} ${object.type}`,
          hit: { kind: "object", object },
          children: [],
        })),
      ),
      groupNode(
        `road:${road.id}:signals`,
        "signals",
        `信号 (${road.signals.length})`,
        () => road.signals.map((signal) => ({
          id: `signal:${signal.key}`,
          kind: "sig",
          label: signal.id || signal.type || "signal",
          search: `signal ${road.id} ${signal.id} ${signal.name} ${signal.type}`,
          hit: { kind: "signal", signal },
          children: [],
        })),
      ),
    ],
  }));
}

export function getTreeChildren(node) {
  if (Array.isArray(node.children)) return node.children;
  if (typeof node.childrenFactory === "function") {
    node.children = node.childrenFactory();
    node.childrenFactory = null;
    return node.children;
  }
  return [];
}

export function filterTreeNodes(nodes, query, options = {}) {
  if (!query) return nodes;
  const state = options.state ?? { visited: 0, truncated: false };
  const maxVisited = options.maxVisited ?? 12000;
  return nodes.flatMap((node) => {
    if (state.visited >= maxVisited) {
      state.truncated = true;
      return [];
    }
    state.visited += 1;
    const children = filterTreeNodes(getTreeChildren(node), query, { ...options, state, maxVisited });
    if (node.search.toLowerCase().includes(query) || children.length > 0) {
      return [{ ...node, children }];
    }
    return [];
  });
}

export function describeHit(hit, formatter) {
  if (!hit) return "选择道路、车道、对象或信号后显示属性。";
  if (hit.kind === "lane") {
    return serializeWithDisplayCoordinates(
      {
        type: "lane",
        roadId: hit.road.id,
        roadName: hit.road.name,
        laneId: hit.lane.laneId,
        laneType: hit.lane.laneType,
        side: hit.lane.side,
        sectionS: hit.lane.sectionS,
        centerline: hit.lane.centerline,
        polygon: hit.lane.polygon,
        roadMarks: hit.lane.roadMarks,
      },
      formatter,
    );
  }
  if (hit.kind === "road") {
    return serializeWithDisplayCoordinates(
      {
        type: "road",
        id: hit.road.id,
        name: hit.road.name,
        length: hit.road.length,
        junction: hit.road.junction,
        laneCount: hit.road.lanes.length,
        objectCount: hit.road.objects.length,
        signalCount: hit.road.signals.length,
        referenceLine: hit.road.referenceLine,
      },
      formatter,
    );
  }
  return serializeWithDisplayCoordinates(hit.signal ?? hit.object, formatter);
}

export function hitTitle(hit) {
  if (!hit) return "元素信息";
  if (hit.kind === "lane") return `Lane ${hit.lane.laneId} / Road ${hit.road.id}`;
  if (hit.kind === "road") return `Road ${hit.road.id}`;
  if (hit.kind === "signal") return `Signal ${hit.signal.id || hit.signal.type}`;
  return `Object ${hit.object.id || hit.object.type}`;
}

function groupNode(id, kind, label, children) {
  return {
    id,
    kind,
    label,
    search: `${kind} ${label}`,
    hit: null,
    childrenFactory: typeof children === "function" ? children : null,
    children: Array.isArray(children) ? children : null,
  };
}
