import { WasmBackedOpenDriveParser } from "./domain/wasmParser.js";
import { CoordinateFormatter } from "./domain/coordinates.js";
import { formatMeters } from "./domain/math.js";
import { CanvasRenderer } from "./render/canvasRenderer.js";
import { buildTreeNodes, describeHit, filterTreeNodes, hitTitle } from "./ui/treeModel.js";

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
    this.parser = new WasmBackedOpenDriveParser();
    this.renderer = new CanvasRenderer(document.querySelector("#mapCanvas"));
    this.coordinateFormatter = new CoordinateFormatter();
    this.treeNodes = [];
    this.expandedTreeNodes = new Set();
    this.selectedHit = null;
    this.isDragging = false;
    this.lastPointer = null;
    this.measureMode = false;
    this.loadGeneration = 0;
    this.bindUi();
    this.populateLayers();
    this.setCoordinateMode("utm");
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
        input.checked = layer.visible;
        input.addEventListener("change", () => this.renderer.setLayerVisible(layer.id, input.checked));
        label.append(text, input);
        return label;
      }),
    );
  }

  async loadFile(file) {
    if (!file) return;
    const generation = ++this.loadGeneration;
    this.el.mapStatus.textContent = `${file.name} | 正在读取...`;
    const text = await file.text();
    await this.loadText(text, file.name, generation);
  }

  async loadText(text, fileName, generation = ++this.loadGeneration) {
    try {
      this.el.mapStatus.textContent = `${fileName} | 正在解析...`;
      const map = await this.parser.parse(text, fileName);
      if (generation !== this.loadGeneration) return;
      this.coordinateFormatter.setMap(map);
      this.setCoordinateMode(this.coordinateFormatter.mode);
      this.renderer.setMap(map);
      this.treeNodes = buildTreeNodes(map);
      this.expandedTreeNodes = new Set(this.treeNodes.map((node) => node.id));
      this.renderTree();
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
    const nodes = filterTreeNodes(this.treeNodes, q);
    const fragment = document.createDocumentFragment();
    for (const node of nodes) this.appendTreeNode(fragment, node, 0, Boolean(q));
    this.el.treeList.replaceChildren(fragment);
  }

  appendTreeNode(parent, node, depth, forceExpanded) {
    const row = document.createElement("div");
    row.className = "tree-item";
    row.role = "treeitem";
    row.style.setProperty("--tree-depth", depth);
    const hasChildren = (node.children?.length ?? 0) > 0;
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
    row.append(toggle, kind, label);
    if (node.hit) {
      row.addEventListener("click", () => {
        this.selectHit(node.hit);
        this.renderer.centerOnHit(node.hit);
      });
    }
    parent.append(row);
    if (hasChildren && expanded) {
      for (const child of node.children) this.appendTreeNode(parent, child, depth + 1, forceExpanded);
    }
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

  setCoordinateMode(mode) {
    this.coordinateFormatter.setMode(mode);
    this.el.coordUtmButton.classList.toggle("active", this.coordinateFormatter.mode === "utm");
    this.el.coordLonLatButton.classList.toggle("active", this.coordinateFormatter.mode === "lonlat");
    this.el.coordLonLatButton.disabled = !this.coordinateFormatter.canUseLonLat();
    this.el.coordLonLatButton.title = this.coordinateFormatter.canUseLonLat()
      ? ""
      : "geoReference 未提供 UTM 投影";
    this.selectHit(this.selectedHit);
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
}

new OdrViewerApp();
