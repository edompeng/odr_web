import proj4 from "../vendor/proj4.esm.js";

const WGS84_PROJ = "+proj=longlat +datum=WGS84 +no_defs";

export class CoordinateFormatter {
  constructor(map = null) {
    this.mode = "utm";
    this.projection = createProjection(map?.header ?? null);
  }

  setMap(map) {
    this.projection = createProjection(map?.header ?? null);
  }

  setMode(mode) {
    this.mode = mode === "lonlat" && this.projection ? "lonlat" : "utm";
  }

  canUseLonLat() {
    return Boolean(this.projection);
  }

  point(point) {
    if (!point) return {};
    if (this.mode === "lonlat" && this.projection) {
      const lonLat = this.projection.toLonLat(point);
      if (isValidLonLat(lonLat)) {
        return {
          longitude: round(lonLat.longitude, 8),
          latitude: round(lonLat.latitude, 8),
          altitude: pointHeight(lonLat),
          ...(Number.isFinite(point.hdg) ? { hdg: round(point.hdg, 6) } : {}),
          ...(Number.isFinite(point.s) ? { s: round(point.s, 3) } : {}),
        };
      }
    }
    return projectedPoint(point);
  }

  status(point) {
    const display = this.point(point);
    if (Number.isFinite(display.longitude) && Number.isFinite(display.latitude)) {
      return `lon: ${display.longitude.toFixed(8)}, lat: ${display.latitude.toFixed(8)}, H: ${display.altitude.toFixed(3)}`;
    }
    return `E: ${display.easting.toFixed(3)}, N: ${display.northing.toFixed(3)}, H: ${display.height.toFixed(3)}`;
  }

  worldPoint(values) {
    const z = Number.isFinite(values.z) ? values.z : 0;
    if (this.mode === "lonlat" && this.projection) {
      const projected = this.projection.toLocal(values.x, values.y);
      return { x: projected.x, y: projected.y, z };
    }
    return { x: values.x, y: values.y, z };
  }
}

function projectedPoint(point) {
  return {
    easting: round(point.x, 3),
    northing: round(point.y, 3),
    height: pointHeight(point),
    ...(Number.isFinite(point.hdg) ? { hdg: round(point.hdg, 6) } : {}),
    ...(Number.isFinite(point.s) ? { s: round(point.s, 3) } : {}),
  };
}

function pointHeight(point) {
  if (Number.isFinite(point.z)) return round(point.z, 3);
  if (Number.isFinite(point.altitude)) return round(point.altitude, 3);
  if (Number.isFinite(point.height)) return round(point.height, 3);
  return 0;
}

export function serializeWithDisplayCoordinates(value, formatter) {
  return JSON.stringify(toDisplayCoordinates(value, formatter), null, 2);
}

export function parseCoordinateInput(text) {
  return text
    .split(";")
    .map((part) => part.trim().replace(/^\(/, "").replace(/\)$/, ""))
    .filter(Boolean)
    .map((part) => part.split(/[,\s]+/).filter(Boolean).map(Number))
    .filter((values) => values.length >= 2 && values.length <= 3 && values.every(Number.isFinite))
    .map(([x, y, z = 0]) => ({ x, y, z }));
}

function toDisplayCoordinates(value, formatter) {
  if (Array.isArray(value)) return value.map((entry) => toDisplayCoordinates(entry, formatter));
  if (!value || typeof value !== "object") return value;
  if (isPoint(value)) return formatter.point(value);

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "bounds") continue;
    out[key] = toDisplayCoordinates(entry, formatter);
  }
  return out;
}

function isPoint(value) {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

function createProjection(header) {
  const geoReference = normalizeGeoReference(header?.geoReference ?? "");
  if (!geoReference) return null;
  const offset = {
    x: finiteNumber(header?.xOffset, 0),
    y: finiteNumber(header?.yOffset, 0),
  };
  try {
    const source = proj4(geoReference);
    const toLonLat = (point) => {
      const [, , inputZ] = pointTuple(point, offset);
      const [longitude, latitude, altitude = inputZ] = proj4(source, WGS84_PROJ, pointTuple(point, offset));
      return { longitude, latitude, altitude };
    };
    const toLocal = (longitude, latitude) => {
      const [x, y] = proj4(WGS84_PROJ, source, [longitude, latitude]);
      return { x: x - offset.x, y: y - offset.y };
    };
    return { toLonLat, toLocal };
  } catch {
    return null;
  }
}

function normalizeGeoReference(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pointTuple(point, offset) {
  return [point.x + offset.x, point.y + offset.y, pointHeight(point)];
}

function isValidLonLat(point) {
  return (
    Number.isFinite(point.longitude) &&
    Number.isFinite(point.latitude) &&
    Math.abs(point.longitude) <= 180 &&
    Math.abs(point.latitude) <= 90
  );
}

function round(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
