const WGS84_A = 6378137.0;
const WGS84_E2 = 0.0066943799901413165;
const WGS84_E1 = (1 - Math.sqrt(1 - WGS84_E2)) / (1 + Math.sqrt(1 - WGS84_E2));
const UTM_K0 = 0.9996;

export class CoordinateFormatter {
  constructor(map = null) {
    this.mode = "utm";
    this.projection = parseProjection(map?.header?.geoReference ?? "");
  }

  setMap(map) {
    this.projection = parseProjection(map?.header?.geoReference ?? "");
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
      const lonLat = transverseMercatorToLonLat(point.x, point.y, this.projection);
      return {
        longitude: round(lonLat.longitude, 8),
        latitude: round(lonLat.latitude, 8),
        ...(Number.isFinite(point.hdg) ? { hdg: round(point.hdg, 6) } : {}),
        ...(Number.isFinite(point.s) ? { s: round(point.s, 3) } : {}),
      };
    }
    return {
      easting: round(point.x, 3),
      northing: round(point.y, 3),
      ...(Number.isFinite(point.hdg) ? { hdg: round(point.hdg, 6) } : {}),
      ...(Number.isFinite(point.s) ? { s: round(point.s, 3) } : {}),
    };
  }

  status(point) {
    const display = this.point(point);
    if (this.mode === "lonlat" && this.projection) {
      return `lon: ${display.longitude.toFixed(8)}, lat: ${display.latitude.toFixed(8)}`;
    }
    return `E: ${display.easting.toFixed(3)}, N: ${display.northing.toFixed(3)}`;
  }

  worldPoint(values) {
    const z = Number.isFinite(values.z) ? values.z : 0;
    if (this.mode === "lonlat" && this.projection) {
      const projected = lonLatToTransverseMercator(values.x, values.y, this.projection);
      return { x: projected.x, y: projected.y, z };
    }
    return { x: values.x, y: values.y, z };
  }
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

function parseProjection(geoReference) {
  const proj = tokenValue(geoReference, "proj");
  if (proj === "utm") {
    const zone = Number(tokenValue(geoReference, "zone"));
    if (!Number.isInteger(zone) || zone < 1 || zone > 60) return null;
    return {
      latitudeOrigin: 0,
      longitudeOrigin: ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180),
      falseEasting: 500000,
      falseNorthing: /\+south(?:\s|$)/.test(geoReference) ? 10000000 : 0,
      scale: UTM_K0,
    };
  }
  if (proj === "tmerc") {
    return {
      latitudeOrigin: numberToken(geoReference, "lat_0", 0) * (Math.PI / 180),
      longitudeOrigin: numberToken(geoReference, "lon_0", 0) * (Math.PI / 180),
      falseEasting: numberToken(geoReference, "x_0", 0),
      falseNorthing: numberToken(geoReference, "y_0", 0),
      scale: numberToken(geoReference, "k", numberToken(geoReference, "k_0", 1)),
    };
  }
  return null;
}

function tokenValue(text, key) {
  const match = text.match(new RegExp(`\\+${key}=([^\\s]+)`));
  return match?.[1] ?? "";
}

function numberToken(text, key, fallback) {
  const value = Number(tokenValue(text, key));
  return Number.isFinite(value) ? value : fallback;
}

function transverseMercatorToLonLat(easting, northing, projection) {
  const x = easting - projection.falseEasting;
  const m = meridionalArc(projection.latitudeOrigin) + (northing - projection.falseNorthing) / projection.scale;
  const mu =
    m /
    (WGS84_A *
      (1 - WGS84_E2 / 4 - (3 * WGS84_E2 * WGS84_E2) / 64 - (5 * WGS84_E2 * WGS84_E2 * WGS84_E2) / 256));

  const phi1 =
    mu +
    (3 * WGS84_E1) / 2 * Math.sin(2 * mu) +
    (21 * WGS84_E1 ** 2) / 16 * Math.sin(4 * mu) +
    (151 * WGS84_E1 ** 3) / 96 * Math.sin(6 * mu) +
    (1097 * WGS84_E1 ** 4) / 512 * Math.sin(8 * mu);

  const ePrime2 = WGS84_E2 / (1 - WGS84_E2);
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const n1 = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi1 * sinPhi1);
  const r1 = (WGS84_A * (1 - WGS84_E2)) / (1 - WGS84_E2 * sinPhi1 * sinPhi1) ** 1.5;
  const t1 = tanPhi1 * tanPhi1;
  const c1 = ePrime2 * cosPhi1 * cosPhi1;
  const d = x / (n1 * projection.scale);

  const latitude =
    phi1 -
    (n1 * tanPhi1) /
      r1 *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ePrime2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ePrime2 - 3 * c1 ** 2) * d ** 6) / 720);

  const longitude =
    projection.longitudeOrigin +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ePrime2 + 24 * t1 ** 2) * d ** 5) / 120) /
      cosPhi1;

  return {
    longitude: longitude * (180 / Math.PI),
    latitude: latitude * (180 / Math.PI),
  };
}

function lonLatToTransverseMercator(longitude, latitude, projection) {
  const lon = longitude * (Math.PI / 180);
  const lat = latitude * (Math.PI / 180);
  const ep2 = WGS84_E2 / (1 - WGS84_E2);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
  const t = Math.tan(lat) ** 2;
  const c = ep2 * Math.cos(lat) ** 2;
  const a = (lon - projection.longitudeOrigin) * Math.cos(lat);
  const m = meridionalArc(lat) - meridionalArc(projection.latitudeOrigin);
  const x =
    projection.falseEasting +
    projection.scale *
      n *
      (a +
        ((1 - t + c) * a ** 3) / 6 +
        ((5 - 18 * t + t ** 2 + 72 * c - 58 * ep2) * a ** 5) / 120);
  const y =
    projection.falseNorthing +
    projection.scale *
      (m +
        n *
          Math.tan(lat) *
          (a ** 2 / 2 +
            ((5 - t + 9 * c + 4 * c ** 2) * a ** 4) / 24 +
            ((61 - 58 * t + t ** 2 + 600 * c - 330 * ep2) * a ** 6) / 720));
  return { x, y };
}

function meridionalArc(latitude) {
  return (
    WGS84_A *
    ((1 - WGS84_E2 / 4 - (3 * WGS84_E2 ** 2) / 64 - (5 * WGS84_E2 ** 3) / 256) * latitude -
      ((3 * WGS84_E2) / 8 + (3 * WGS84_E2 ** 2) / 32 + (45 * WGS84_E2 ** 3) / 1024) *
        Math.sin(2 * latitude) +
      ((15 * WGS84_E2 ** 2) / 256 + (45 * WGS84_E2 ** 3) / 1024) * Math.sin(4 * latitude) -
      ((35 * WGS84_E2 ** 3) / 3072) * Math.sin(6 * latitude))
  );
}

function round(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
