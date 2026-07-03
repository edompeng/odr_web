export function buildTreeItems(map) {
  if (!map) return [];
  const items = [];
  for (const road of map.roads) {
    items.push({
      kind: "road",
      label: `${road.id} ${road.name || ""}`.trim(),
      search: `road ${road.id} ${road.name}`,
      hit: { kind: "road", road },
    });
    for (const lane of road.lanes) {
      if (lane.laneId === 0) continue;
      items.push({
        kind: "lane",
        label: `road ${road.id} / lane ${lane.laneId} (${lane.laneType})`,
        search: `lane ${road.id} ${lane.laneId} ${lane.laneType}`,
        hit: { kind: "lane", road, lane },
      });
    }
    for (const object of road.objects) {
      items.push({
        kind: "obj",
        label: `road ${road.id} / object ${object.id || object.type}`,
        search: `object ${road.id} ${object.id} ${object.name} ${object.type}`,
        hit: { kind: "object", object },
      });
    }
    for (const signal of road.signals) {
      items.push({
        kind: "sig",
        label: `road ${road.id} / signal ${signal.id || signal.type}`,
        search: `signal ${road.id} ${signal.id} ${signal.name} ${signal.type}`,
        hit: { kind: "signal", signal },
      });
    }
  }
  return items;
}

export function describeHit(hit) {
  if (!hit) return "选择道路、车道、对象或信号后显示属性。";
  if (hit.kind === "lane") {
    return JSON.stringify(
      {
        type: "lane",
        roadId: hit.road.id,
        roadName: hit.road.name,
        laneId: hit.lane.laneId,
        laneType: hit.lane.laneType,
        side: hit.lane.side,
        sectionS: hit.lane.sectionS,
        roadMarks: hit.lane.roadMarks,
      },
      null,
      2,
    );
  }
  if (hit.kind === "road") {
    return JSON.stringify(
      {
        type: "road",
        id: hit.road.id,
        name: hit.road.name,
        length: hit.road.length,
        junction: hit.road.junction,
        laneCount: hit.road.lanes.length,
        objectCount: hit.road.objects.length,
        signalCount: hit.road.signals.length,
      },
      null,
      2,
    );
  }
  return JSON.stringify(hit.signal ?? hit.object, null, 2);
}

export function hitTitle(hit) {
  if (!hit) return "元素信息";
  if (hit.kind === "lane") return `Lane ${hit.lane.laneId} / Road ${hit.road.id}`;
  if (hit.kind === "road") return `Road ${hit.road.id}`;
  if (hit.kind === "signal") return `Signal ${hit.signal.id || hit.signal.type}`;
  return `Object ${hit.object.id || hit.object.type}`;
}
