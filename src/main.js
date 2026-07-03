import { WasmBackedOpenDriveParser } from "./domain/wasmParser.js";
import { formatMeters } from "./domain/math.js";
import { CanvasRenderer } from "./render/canvasRenderer.js";
import { buildTreeItems, describeHit, hitTitle } from "./ui/treeModel.js";

const SAMPLE_ODR = `<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <header revMajor="1" revMinor="4" name="sample" version="1" date="2026-07-03" north="80" south="-20" east="140" west="-20" vendor="ODR Web Viewer"/>
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
    this.treeItems = [];
    this.isDragging = false;
    this.lastPointer = null;
    this.measureMode = false;
    this.loadGeneration = 0;
    this.bindUi();
    this.populateLayers();
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
      this.renderer.setMap(map);
      this.treeItems = buildTreeItems(map);
      this.renderTree();
      this.selectHit(null);
      this.updateMeasureStatus();
      this.el.mapStatus.textContent = `${fileName} | ${this.parser.mode} | roads ${map.stats.roads} | lanes ${map.stats.lanes} | ${formatMeters(map.stats.lengthMeters)}`;
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.el.mapStatus.textContent = `加载失败: ${error.message}`;
      console.error(error);
    }
  }

  renderTree() {
    const q = this.el.searchInput.value.trim().toLowerCase();
    const filtered = this.treeItems.filter((item) => !q || item.search.toLowerCase().includes(q)).slice(0, 500);
    this.el.treeList.replaceChildren(
      ...filtered.map((item) => {
        const row = document.createElement("div");
        row.className = "tree-item";
        row.role = "treeitem";
        row.addEventListener("click", () => {
          this.selectHit(item.hit);
          this.renderer.centerOnHit(item.hit);
        });
        const kind = document.createElement("span");
        kind.className = "tree-kind";
        kind.textContent = item.kind;
        const label = document.createElement("span");
        label.className = "tree-label";
        label.textContent = item.label;
        row.append(kind, label);
        return row;
      }),
    );
  }

  setViewMode(mode) {
    this.el.view2dButton.classList.toggle("active", mode === "2d");
    this.el.view3dButton.classList.toggle("active", mode === "3d");
    this.renderer.setViewMode(mode);
  }

  selectHit(hit) {
    this.renderer.setSelected(hit);
    this.el.detailsTitle.textContent = hitTitle(hit);
    this.el.detailsContent.textContent = describeHit(hit);
  }

  updateHoverStatus(hit, screenPos) {
    const world = this.renderer.screenToWorld(screenPos);
    const prefix = hit ? `${hit.kind} | ` : "";
    this.el.hoverStatus.textContent = `${prefix}x: ${world.x.toFixed(2)}, y: ${world.y.toFixed(2)}`;
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
