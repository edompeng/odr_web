import { WorkerBackedOpenDriveParser } from "./domain/workerParser.js";
import { CoordinateFormatter, parseCoordinateInput } from "./domain/coordinates.js";
import { formatMeters } from "./domain/math.js";
import { loadViewerSettings, saveViewerSettings } from "./domain/viewerSettings.js";
import { validateOpenDriveMap } from "./domain/topologyValidator.js";
import { CanvasRenderer } from "./render/canvasRenderer.js";
import { buildTreeNodes, describeHit, filterTreeNodes, getTreeChildren, hitTitle } from "./ui/treeModel.js";

const TREE_RENDER_LIMIT = 1500;
const TREE_FILTER_SCAN_LIMIT = 12000;
const AUTO_VALIDATION_COMPLEXITY_LIMIT = 50000;

const SAMPLE_ODR = `<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <header revMajor="1" revMinor="4" name="sample" version="1" date="2026-07-03" north="80" south="-20" east="140" west="-20" vendor="ODR Web Viewer">
    <geoReference><![CDATA[+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs]]></geoReference>
  </header>
  <road name="Main Road" length="120" id="1" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="70"><line/></geometry>
      <geometry s="70" x="70" y="0" hdg="0" length="50"><arc curvature="0.018"/></geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <left>
          <lane id="1" type="driving" level="false"><width sOffset="0" a="3.5" b="0" c="0" d="0"/><roadMark type="solid" color="white"/></lane>
          <lane id="2" type="shoulder" level="false"><width sOffset="0" a="1.2" b="0" c="0" d="0"/></lane>
        </left>
        <center><lane id="0" type="none" level="false"><roadMark type="solid" color="yellow"/></lane></center>
        <right>
          <lane id="-1" type="driving" level="false"><width sOffset="0" a="3.5" b="0" c="0" d="0"/><roadMark type="broken" color="white"/></lane>
        </right>
      </laneSection>
    </lanes>
    <objects><object id="obj-1" type="pole" s="38" t="-5" width="0.5" length="0.5"/></objects>
    <signals><signal id="sig-1" type="1000001" subtype="trafficLight" s="88" t="4"/></signals>
  </road>
  <road name="Ramp" length="72" id="2" junction="10">
    <planView><geometry s="0" x="42" y="-22" hdg="1.1" length="72"><arc curvature="-0.022"/></geometry></planView>
    <lanes>
      <laneSection s="0">
        <left><lane id="1" type="driving" level="false"><width sOffset="0" a="3.2" b="0" c="0" d="0"/></lane></left>
        <center><lane id="0" type="none" level="false"/></center>
        <right><lane id="-1" type="driving" level="false"><width sOffset="0" a="3.2" b="0" c="0" d="0"/></lane></right>
      </laneSection>
    </lanes>
  </road>
  <junction id="10" name="Sample Junction"><connection id="1" incomingRoad="1" connectingRoad="2" contactPoint="start"/></junction>
</OpenDRIVE>`;

class OdrViewerApp {
  constructor() {
    this.parser = new WorkerBackedOpenDriveParser();
    this.renderer = new CanvasRenderer(document.querySelector("#mapCanvas"));
    this.coordinateFormatter = new CoordinateFormatter();
    this.settings = loadViewerSettings();
    this.treeNodes = [];
    this.expandedTreeNodes = new Set();
    this.selectedHit = null;
    this.validationIssues = [];
    this.currentMap = null;
    this.currentFileName = "";
    this.isDragging = false;
    this.lastPointer = null;
    this.measureMode = false;
    this.loadGeneration = 0;
    this.bindUi();
    this.populateLayers();
    this.setCoordinateMode(this.settings.coordinateMode, false);
    this.renderFavorites();
    void this.loadText(SAMPLE_ODR, "sample.xodr");
    window.addEventListener("resize", () => this.renderer.resize());
  }

  bindUi() {
    this.el = {
      fileInput: document.querySelector("#fileInput"),
      fileDrop: document.querySelector("#fileDrop"),
      dropOverlay: document.querySelector("#dropOverlay"),
      sampleButton: document.querySelector("#sampleButton"),
      screenshotButton: document.querySelector("#screenshotButton"),
      fitViewButton: document.querySelector("#fitViewButton"),
      view2dButton: document.querySelector("#view2dButton"),
      view3dButton: document.querySelector("#view3dButton"),
      coordUtmButton: document.querySelector("#coordUtmButton"),
      coordLonLatButton: document.querySelector("#coordLonLatButton"),
      coordinateInput: document.querySelector("#coordinateInput"),
      jumpButton: document.querySelector("#jumpButton"),
      addPointButton: document.querySelector("#addPointButton"),
      clearPointsButton: document.querySelector("#clearPointsButton"),
      measureToggle: document.querySelector("#measureToggle"),
      layerList: document.querySelector("#layerList"),
      treeList: document.querySelector("#treeList"),
      searchInput: document.querySelector("#searchInput"),
      mapStatus: document.querySelector("#mapStatus"),
      hoverStatus: document.querySelector("#hoverStatus"),
      measureStatus: document.querySelector("#measureStatus"),
      detailsTitle: document.querySelector("#detailsTitle"),
      detailsContent: document.querySelector("#detailsContent"),
      clearSelectionButton: document.querySelector("#clearSelectionButton"),
      statsContent: document.querySelector("#statsContent"),
      validateButton: document.querySelector("#validateButton"),
      validationList: document.querySelector("#validationList"),
      favoritesList: document.querySelector("#favoritesList"),
      clearFavoritesButton: document.querySelector("#clearFavoritesButton"),
      contextMenu: document.querySelector("#contextMenu"),
      canvas: document.querySelector("#mapCanvas"),
    };

    this.el.fileInput.addEventListener("change", (event) => this.loadFile(event.target.files?.[0]));
    this.el.sampleButton.addEventListener("click", () => void this.loadText(SAMPLE_ODR, "sample.xodr"));
    this.el.fitViewButton.addEventListener("click", () => this.renderer.fitToBounds());
    this.el.screenshotButton.addEventListener("click", () => this.downloadScreenshot());
    this.el.view2dButton.addEventListener("click", () => this.setViewMode("2d"));
    this.el.view3dButton.addEventListener("click", () => this.setViewMode("3d"));
    this.el.coordUtmButton.addEventListener("click", () => this.setCoordinateMode("utm"));
    this.el.coordLonLatButton.addEventListener("click", () => this.setCoordinateMode("lonlat"));
    this.el.jumpButton.addEventListener("click", () => this.jumpToCoordinate());
    this.el.addPointButton.addEventListener("click", () => this.addCoordinatePoints());
    this.el.clearPointsButton.addEventListener("click", () => this.clearCoordinatePoints());
    this.el.validateButton.addEventListener("click", () => this.runValidation());
    this.el.clearFavoritesButton.addEventListener("click", () => this.clearFavorites());
    this.el.coordinateInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.jumpToCoordinate();
    });
    this.el.measureToggle.addEventListener("change", () => {
      this.measureMode = this.el.measureToggle.checked;
      if (!this.measureMode) this.renderer.clearMeasure();
      this.updateMeasureStatus();
    });
    this.el.searchInput.addEventListener("input", () => this.renderTree());
    this.el.clearSelectionButton.addEventListener("click", () => this.selectHit(null));

    for (const target of [document.body, this.el.fileDrop]) {
      target.addEventListener("dragover", (event) => {
        event.preventDefault();
        this.el.dropOverlay.classList.add("visible");
      });
      target.addEventListener("dragleave", () => this.el.dropOverlay.classList.remove("visible"));
      target.addEventListener("drop", (event) => {
        event.preventDefault();
        this.el.dropOverlay.classList.remove("visible");
        void this.loadFile(event.dataTransfer?.files?.[0]);
      });
    }

    this.bindCanvas();
    window.addEventListener("click", () => this.hideContextMenu());
  }

  bindCanvas() {
    const canvas = this.el.canvas;
    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      this.isDragging = true;
      this.lastPointer = { x: event.offsetX, y: event.offsetY };
    });
    canvas.addEventListener("pointermove", (event) => {
      const pos = { x: event.offsetX, y: event.offsetY };
      if (this.isDragging && event.buttons) {
        this.renderer.panBy(pos.x - this.lastPointer.x, pos.y - this.lastPointer.y);
        this.lastPointer = pos;
        return;
      }
      const hit = this.renderer.pick(pos);
      this.renderer.setHovered(hit);
      this.updateHoverStatus(hit, pos);
    });
    canvas.addEventListener("pointerup", (event) => {
      const pos = { x: event.offsetX, y: event.offsetY };
      const moved = this.lastPointer && Math.hypot(pos.x - this.lastPointer.x, pos.y - this.lastPointer.y) > 4;
      this.isDragging = false;
      if (!moved) {
        if (this.measureMode) {
          const world = this.renderer.screenToWorld(pos);
          this.renderer.addMeasurePoint(world);
          this.updateMeasureStatus();
        } else {
          this.selectHit(this.renderer.pick(pos));
        }
      }
    });
    canvas.addEventListener("dblclick", (event) => {
      const hit = this.renderer.pick({ x: event.offsetX, y: event.offsetY });
      if (hit) this.renderer.centerOnHit(hit);
    });
    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.showContextMenu(event);
    });
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.renderer.zoomAt({ x: event.offsetX, y: event.offsetY }, -event.deltaY);
      },
      { passive: false },
    );
  }

  populateLayers() {
    this.el.layerList.replaceChildren(
      ...CanvasRenderer.layerDefinitions().map((layer) => {
        const label = document.createElement("label");
        label.className = "layer-row";
        const text = document.createElement("span");
        text.textContent = layer.label;
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = this.settings.layers[layer.id] ?? layer.visible;
        this.renderer.setLayerVisible(layer.id, input.checked);
        input.addEventListener("change", () => {
          this.renderer.setLayerVisible(layer.id, input.checked);
          this.settings.layers[layer.id] = input.checked;
          this.saveSettings();
        });
        label.append(text, input);
        return label;
      }),
    );
  }

  async loadFile(file) {
    if (!file) return;
    const generation = ++this.loadGeneration;
    this.el.mapStatus.textContent = `${file.name} | 正在读取...`;
    const buffer = await file.arrayBuffer();
    await this.loadText(buffer, file.name, generation);
  }

  async loadText(text, fileName, generation = ++this.loadGeneration) {
    try {
      this.el.mapStatus.textContent = `${fileName} | 后台解析中...`;
      const map = await this.parser.parse(text, fileName);
      if (generation !== this.loadGeneration) return;
      this.currentMap = map;
      this.currentFileName = fileName;
      this.coordinateFormatter.setMap(map);
      this.setCoordinateMode(this.settings.coordinateMode, false);
      this.renderer.setMap(map);
      this.treeNodes = buildTreeNodes(map);
      this.expandedTreeNodes = new Set();
      this.renderTree();
      this.updateStats();
      if (this.shouldAutoValidate(map)) {
        this.runValidation();
      } else {
        this.validationIssues = [];
        this.el.validationList.textContent = "大地图已跳过自动检查，可点击检查手动运行";
      }
      this.renderFavorites();
      this.selectHit(null);
      this.updateMeasureStatus();
      this.el.mapStatus.textContent =
        `${fileName} | ${this.parser.mode} | roads ${map.stats.roads} | ` +
        `lanes ${map.stats.lanes} | ${formatMeters(map.stats.lengthMeters)}`;
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.el.mapStatus.textContent = `加载失败: ${error.message}`;
      console.error(error);
    }
  }

  renderTree() {
    const q = this.el.searchInput.value.trim().toLowerCase();
    const filterState = { visited: 0, truncated: false };
    const nodes = filterTreeNodes(this.treeNodes, q, { state: filterState, maxVisited: TREE_FILTER_SCAN_LIMIT });
    const renderState = { count: 0, truncated: false };
    const fragment = document.createDocumentFragment();
    for (const node of nodes) {
      this.appendTreeNode(fragment, node, 0, Boolean(q), renderState);
      if (renderState.truncated) break;
    }
    if (filterState.truncated || renderState.truncated) {
      this.appendTreeNotice(fragment, "结果过多，请搜索更具体的道路、对象或信号");
    }
    this.el.treeList.replaceChildren(fragment);
  }

  appendTreeNode(parent, node, depth, forceExpanded, state) {
    if (state.count >= TREE_RENDER_LIMIT) {
      state.truncated = true;
      return;
    }
    state.count += 1;
    const row = document.createElement("div");
    row.className = "tree-item";
    row.role = "treeitem";
    row.style.setProperty("--tree-depth", depth);
    if (node.hit && !this.renderer.isElementVisible(node.id)) row.classList.add("muted");
    const cachedChildren = Array.isArray(node.children) ? node.children : null;
    const hasChildren = cachedChildren ? cachedChildren.length > 0 : typeof node.childrenFactory === "function";
    const expanded = forceExpanded || this.expandedTreeNodes.has(node.id);
    row.setAttribute("aria-expanded", hasChildren ? String(expanded) : "false");

    const toggle = document.createElement("button");
    toggle.className = "tree-toggle";
    toggle.type = "button";
    toggle.textContent = hasChildren ? (expanded ? "▾" : "▸") : "";
    toggle.disabled = !hasChildren;
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.expandedTreeNodes.has(node.id)) this.expandedTreeNodes.delete(node.id);
      else this.expandedTreeNodes.add(node.id);
      this.renderTree();
    });

    const kind = document.createElement("span");
    kind.className = "tree-kind";
    kind.textContent = node.kind;
    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = node.label;
    const visibility = document.createElement("button");
    visibility.className = "tree-visibility";
    visibility.type = "button";
    visibility.textContent = node.hit && !this.renderer.isElementVisible(node.id) ? "◌" : "●";
    visibility.disabled = !node.hit;
    visibility.title = node.hit ? "显示/隐藏元素" : "";
    visibility.addEventListener("click", (event) => {
      event.stopPropagation();
      const next = !this.renderer.isElementVisible(node.id);
      this.renderer.setElementVisible(node.id, next);
      if (!next && hitIdentity(this.selectedHit) === node.id) this.selectHit(null);
      this.renderTree();
    });
    row.append(toggle, kind, label, visibility);
    if (node.hit) {
      row.addEventListener("click", () => {
        this.selectHit(node.hit);
        this.renderer.centerOnHit(node.hit);
      });
    }
    parent.append(row);
    if (hasChildren && expanded) {
      for (const child of getTreeChildren(node)) {
        this.appendTreeNode(parent, child, depth + 1, forceExpanded, state);
        if (state.truncated) break;
      }
    }
  }

  appendTreeNotice(parent, text) {
    const row = document.createElement("div");
    row.className = "tree-item muted";
    row.role = "note";
    row.style.setProperty("--tree-depth", 0);
    row.textContent = text;
    parent.append(row);
  }

  setViewMode(mode) {
    this.el.view2dButton.classList.toggle("active", mode === "2d");
    this.el.view3dButton.classList.toggle("active", mode === "3d");
    this.renderer.setViewMode(mode);
  }

  selectHit(hit) {
    this.selectedHit = hit;
    this.renderer.setSelected(hit);
    this.el.detailsTitle.textContent = hitTitle(hit);
    this.el.detailsContent.textContent = describeHit(hit, this.coordinateFormatter);
  }

  updateHoverStatus(hit, screenPos) {
    const world = this.renderer.screenToWorld(screenPos);
    const prefix = hit ? `${hit.kind} | ` : "";
    this.el.hoverStatus.textContent = `${prefix}${this.coordinateFormatter.status(world)}`;
  }

  setCoordinateMode(mode, persist = true) {
    this.coordinateFormatter.setMode(mode);
    this.el.coordUtmButton.classList.toggle("active", this.coordinateFormatter.mode === "utm");
    this.el.coordLonLatButton.classList.toggle("active", this.coordinateFormatter.mode === "lonlat");
    this.el.coordLonLatButton.disabled = !this.coordinateFormatter.canUseLonLat();
    this.el.coordLonLatButton.title = this.coordinateFormatter.canUseLonLat()
      ? ""
      : "geoReference 未提供 UTM 投影";
    if (persist) {
      this.settings.coordinateMode = this.coordinateFormatter.mode;
      this.saveSettings();
    }
    this.selectHit(this.selectedHit);
  }

  jumpToCoordinate() {
    const [first] = parseCoordinateInput(this.el.coordinateInput.value);
    if (!first) {
      this.el.mapStatus.textContent = "坐标格式无效，请输入 x,y 或 lon,lat";
      return;
    }
    const world = this.coordinateFormatter.worldPoint(first);
    this.renderer.centerOnPoint(world);
    this.el.hoverStatus.textContent = this.coordinateFormatter.status(world);
  }

  addCoordinatePoints() {
    const points = parseCoordinateInput(this.el.coordinateInput.value);
    if (points.length === 0) {
      this.el.mapStatus.textContent = "坐标格式无效，请输入 x,y 或 lon,lat，可用 ; 分隔多个点";
      return;
    }
    points.forEach((point, index) => {
      this.renderer.addUserPoint(this.coordinateFormatter.worldPoint(point), `P${index + 1}`);
    });
    this.el.mapStatus.textContent = `已添加 ${points.length} 个坐标点`;
  }

  clearCoordinatePoints() {
    this.renderer.clearUserPoints();
    this.el.mapStatus.textContent = "坐标点已清空";
  }

  updateStats() {
    if (!this.currentMap) {
      this.el.statsContent.textContent = "未加载地图";
      return;
    }
    const stats = this.currentMap.stats;
    this.el.statsContent.textContent = [
      `roads: ${stats.roads}`,
      `lanes: ${stats.lanes}`,
      `objects: ${stats.objects}`,
      `signals: ${stats.signals}`,
      `junctions: ${stats.junctions}`,
      `length: ${formatMeters(stats.lengthMeters)}`,
    ].join("\n");
  }

  runValidation() {
    this.validationIssues = validateOpenDriveMap(this.currentMap);
    this.renderValidation();
  }

  shouldAutoValidate(map) {
    const stats = map?.stats;
    if (!stats) return true;
    return stats.roads + stats.lanes + stats.objects + stats.signals <= AUTO_VALIDATION_COMPLEXITY_LIMIT;
  }

  renderValidation() {
    if (!this.currentMap) {
      this.el.validationList.textContent = "未加载地图";
      return;
    }
    if (this.validationIssues.length === 0) {
      this.el.validationList.textContent = "未发现明显问题";
      return;
    }
    this.el.validationList.replaceChildren(
      ...this.validationIssues.slice(0, 80).map((issue) => {
        const row = document.createElement("div");
        row.className = `compact-row ${issue.severity}`;
        const label = document.createElement("span");
        label.textContent = `${issue.severity}: ${issue.message}`;
        row.append(label);
        if (issue.hit) {
          row.addEventListener("click", () => {
            const hit = this.resolveHit(hitIdentity(issue.hit)) ?? issue.hit;
            this.selectHit(hit);
            this.renderer.centerOnHit(hit);
          });
        }
        return row;
      }),
    );
  }

  addFavorite(hit) {
    const id = hitIdentity(hit);
    if (!id) return;
    const title = hitTitle(hit);
    this.settings.favorites = [{ id, title }, ...this.settings.favorites.filter((favorite) => favorite.id !== id)].slice(
      0,
      200,
    );
    this.saveSettings();
    this.renderFavorites();
  }

  removeFavorite(id) {
    this.settings.favorites = this.settings.favorites.filter((favorite) => favorite.id !== id);
    this.saveSettings();
    this.renderFavorites();
  }

  clearFavorites() {
    this.settings.favorites = [];
    this.saveSettings();
    this.renderFavorites();
  }

  renderFavorites() {
    if (this.settings.favorites.length === 0) {
      this.el.favoritesList.textContent = "暂无收藏";
      return;
    }
    this.el.favoritesList.replaceChildren(
      ...this.settings.favorites.map((favorite) => {
        const row = document.createElement("div");
        row.className = "compact-row";
        const label = document.createElement("span");
        label.textContent = favorite.title;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.title = "移除收藏";
        remove.textContent = "×";
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          this.removeFavorite(favorite.id);
        });
        row.addEventListener("click", () => {
          const hit = this.resolveHit(favorite.id);
          if (!hit) {
            this.el.mapStatus.textContent = `${favorite.title} 在当前地图中不存在`;
            return;
          }
          this.selectHit(hit);
          this.renderer.centerOnHit(hit);
        });
        row.append(label, remove);
        return row;
      }),
    );
  }

  showContextMenu(event) {
    const hit = this.renderer.pick({ x: event.offsetX, y: event.offsetY });
    const world = this.renderer.screenToWorld({ x: event.offsetX, y: event.offsetY });
    const menu = this.el.contextMenu;
    const actions = [
      ["复制坐标", () => this.copyText(this.coordinateFormatter.status(world))],
      ["添加坐标点", () => this.renderer.addUserPoint(world, "ctx")],
    ];
    if (hit) {
      actions.unshift(["定位元素", () => this.renderer.centerOnHit(hit)]);
      actions.push(["添加收藏", () => this.addFavorite(hit)]);
      actions.push(["复制元素信息", () => this.copyText(describeHit(hit, this.coordinateFormatter))]);
      actions.push(["隐藏元素", () => {
        this.renderer.setElementVisible(hitIdentity(hit), false);
        this.selectHit(null);
        this.renderTree();
      }]);
    }
    if (this.currentFileName) {
      actions.push(["复制地图名", () => this.copyText(this.currentFileName.replace(/\.[^.]+$/, ""))]);
    }
    menu.replaceChildren(
      ...actions.map(([label, action]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", () => {
          action();
          this.hideContextMenu();
        });
        return button;
      }),
    );
    menu.hidden = false;
    menu.style.left = `${event.offsetX}px`;
    menu.style.top = `${event.offsetY}px`;
  }

  hideContextMenu() {
    this.el.contextMenu.hidden = true;
  }

  async copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  updateMeasureStatus() {
    this.el.measureStatus.textContent = `测距: ${formatMeters(this.renderer.measureDistance())}`;
  }

  downloadScreenshot() {
    const link = document.createElement("a");
    link.download = "odr-viewer.png";
    link.href = this.renderer.exportPng();
    link.click();
  }

  resolveHit(id) {
    if (!this.currentMap || !id) return null;
    if (id.startsWith("road:")) {
      const roadId = id.slice("road:".length);
      const road = this.currentMap.roads.find((candidate) => String(candidate.id) === roadId);
      return road ? { kind: "road", road } : null;
    }
    if (id.startsWith("lane:")) {
      const key = id.slice("lane:".length);
      for (const road of this.currentMap.roads) {
        const lane = road.lanes.find((candidate) => candidate.key === key);
        if (lane) return { kind: "lane", road, lane };
      }
    }
    if (id.startsWith("object:")) {
      const key = id.slice("object:".length);
      const object = this.currentMap.objects.find((candidate) => candidate.key === key);
      return object ? { kind: "object", object } : null;
    }
    if (id.startsWith("signal:")) {
      const key = id.slice("signal:".length);
      const signal = this.currentMap.signals.find((candidate) => candidate.key === key);
      return signal ? { kind: "signal", signal } : null;
    }
    return null;
  }

  saveSettings() {
    saveViewerSettings(this.settings);
  }
}

new OdrViewerApp();

function hitIdentity(hit) {
  if (!hit) return "";
  if (hit.kind === "lane") return `lane:${hit.lane.key}`;
  if (hit.kind === "road") return `road:${hit.road.id}`;
  if (hit.kind === "signal") return `signal:${hit.signal.key}`;
  if (hit.kind === "object") return `object:${hit.object.key}`;
  return hit.kind;
}
