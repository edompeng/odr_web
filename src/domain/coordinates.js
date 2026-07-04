const WGS84_A = 6378137.0;
const WGS84_E2 = 0.0066943799901413165;
const WGS84_E1 = (1 - Math.sqrt(1 - WGS84_E2)) / (1 + Math.sqrt(1 - WGS84_E2));
const UTM_K0 = 0.9996;

export class CoordinateFormatter {
  constructor(map = null) {
    this.mode = "utm";
    this.utm = parseUtmProjection(map?.header?.geoReference ?? "");
  }

  setMap(map) {
    this.utm = parseUtmProjection(map?.header?.geoReference ?? "");
  }

  setMode(mode) {
    this.mode = mode === "lonlat" && this.utm ? "lonlat" : "utm";
  }

  canUseLonLat() {
    return Boolean(this.utm);
  }

  point(point) {
    if (!point) return {};
    if (this.mode === "lonlat" && this.utm) {
      const lonLat = utmToLonLat(point.x, point.y, this.utm);
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
    if (this.mode === "lonlat" && this.utm) {
      return `lon: ${display.longitude.toFixed(8)}, lat: ${display.latitude.toFixed(8)}`;
    }
    return `E: ${display.easting.toFixed(3)}, N: ${display.northing.toFixed(3)}`;
  }
}

export function serializeWithDisplayCoordinates(value, formatter) {
  return JSON.stringify(toDisplayCoordinates(value, formatter), null, 2);
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

function parseUtmProjection(geoReference) {
  const proj = tokenValue(geoReference, "proj");
  const zone = Number(tokenValue(geoReference, "zone"));
  if (proj !== "utm" || !Number.isInteger(zone) || zone < 1 || zone > 60) return null;
  return { zone, south: /\+south(?:\s|$)/.test(geoReference) };
}

function tokenValue(text, key) {
  const match = text.match(new RegExp(`\\+${key}=([^\\s]+)`));
  return match?.[1] ?? "";
}

function utmToLonLat(easting, northing, projection) {
  const x = easting - 500000.0;
  const y = projection.south ? northing - 10000000.0 : northing;
  const m = y / UTM_K0;
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
  const d = x / (n1 * UTM_K0);

  const latitude =
    phi1 -
    (n1 * tanPhi1) /
      r1 *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ePrime2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ePrime2 - 3 * c1 ** 2) * d ** 6) / 720);

  const longitudeOrigin = ((projection.zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const longitude =
    longitudeOrigin +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ePrime2 + 24 * t1 ** 2) * d ** 5) / 120) /
      cosPhi1;

  return {
    longitude: longitude * (180 / Math.PI),
    latitude: latitude * (180 / Math.PI),
  };
}

function round(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
