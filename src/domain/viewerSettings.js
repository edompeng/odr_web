const DEFAULT_SETTINGS = Object.freeze({
  coordinateMode: "utm",
  layers: Object.freeze({}),
  favorites: Object.freeze([]),
});

const STORAGE_KEY = "odr-web-viewer.settings.v1";
const KNOWN_LAYER_IDS = new Set([
  "lanes",
  "laneLines",
  "roadmarks",
  "objects",
  "signals",
  "referenceLines",
  "junctions",
  "userPoints",
]);

export function createDefaultSettings() {
  return {
    coordinateMode: DEFAULT_SETTINGS.coordinateMode,
    layers: {},
    favorites: [],
  };
}

export function mergeViewerSettings(value) {
  const settings = createDefaultSettings();
  if (!value || typeof value !== "object") return settings;

  if (value.coordinateMode === "utm" || value.coordinateMode === "lonlat") {
    settings.coordinateMode = value.coordinateMode;
  }

  if (value.layers && typeof value.layers === "object") {
    for (const [id, visible] of Object.entries(value.layers)) {
      if (KNOWN_LAYER_IDS.has(id) && typeof visible === "boolean") {
        settings.layers[id] = visible;
      }
    }
  }

  if (Array.isArray(value.favorites)) {
    settings.favorites = value.favorites
      .filter((favorite) => favorite && typeof favorite === "object")
      .map((favorite) => ({
        id: String(favorite.id ?? "").trim(),
        title: String(favorite.title ?? "").trim(),
      }))
      .filter((favorite) => favorite.id && favorite.title)
      .slice(0, 200);
  }

  return settings;
}

export function loadViewerSettings(storage = globalThis.localStorage) {
  if (!storage) return createDefaultSettings();
  try {
    return mergeViewerSettings(JSON.parse(storage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return createDefaultSettings();
  }
}

export function saveViewerSettings(settings, storage = globalThis.localStorage) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(mergeViewerSettings(settings)));
  } catch {
    // Local storage can be unavailable in private contexts; keep the viewer usable.
  }
}
