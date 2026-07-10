// Build-time generator for the interactive map geometry assets.
//
// Emits pre-projected SVG path data to public/geo/*.json so the runtime map
// component (src/components/charts/ChoroplethMap.tsx) ships ZERO geometry or
// projection code in the JS bundle - it just fetches a static, CDN-cacheable
// JSON and paints <path d>. Country display names (PL/EN) are embedded at
// build time from i18n-iso-countries, so no locale data ships to the client.
//
// Usage:
//   bun run scripts/generate-geo-maps.ts <dir-with-world-atlas-json>
//
// Input files (countries-110m.json, countries-50m.json) come from the
// world-atlas npm package (ISC, data derived from Natural Earth - public
// domain). They are NOT a runtime or dev dependency; fetch them once with:
//   curl -sO https://registry.npmjs.org/world-atlas/-/world-atlas-2.0.2.tgz
//   tar -xzf world-atlas-2.0.2.tgz
//   bun run scripts/generate-geo-maps.ts package
//
// The Natural Earth I raw projection polynomial is ported from d3-geo (ISC,
// (c) Mike Bostock) - see https://github.com/d3/d3-geo.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import countriesLib from "i18n-iso-countries";

// ----------------------------------------------------------------------------
// Minimal TopoJSON decoding (only what world-atlas needs: quantized topology,
// Polygon/MultiPolygon geometries).
// ----------------------------------------------------------------------------

interface TopoTransform {
  scale: [number, number];
  translate: [number, number];
}

interface TopoGeometry {
  type: "Polygon" | "MultiPolygon";
  id?: string | number;
  properties?: { name?: string };
  arcs: number[][] | number[][][];
}

interface Topology {
  type: "Topology";
  transform: TopoTransform;
  arcs: number[][][];
  objects: Record<string, { type: "GeometryCollection"; geometries: TopoGeometry[] }>;
}

type Ring = [number, number][];
/** Polygon = exterior ring + holes. */
type Polygon = Ring[];

interface CountryFeature {
  /** ISO 3166-1 numeric id as found in world-atlas (may be "-99" for disputed). */
  numericId: string;
  name: string;
  polygons: Polygon[];
}

function decodeArcs(topo: Topology): Ring[] {
  const { scale, translate } = topo.transform;
  return topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    const out: Ring = [];
    for (const [dx, dy] of arc) {
      x += dx;
      y += dy;
      out.push([x * scale[0] + translate[0], y * scale[1] + translate[1]]);
    }
    return out;
  });
}

/** Stitch arc indices into a ring; negative index means reversed complement. */
function stitchRing(arcIndices: number[], arcs: Ring[]): Ring {
  const ring: Ring = [];
  for (const rawIdx of arcIndices) {
    const reversed = rawIdx < 0;
    const arc = arcs[reversed ? ~rawIdx : rawIdx];
    const pts = reversed ? [...arc].reverse() : arc;
    // Consecutive arcs share their junction point - drop the duplicate.
    ring.push(...(ring.length ? pts.slice(1) : pts));
  }
  return ring;
}

function decodeCountries(topo: Topology): CountryFeature[] {
  const arcs = decodeArcs(topo);
  const out: CountryFeature[] = [];
  for (const geom of topo.objects.countries.geometries) {
    const polygonsRaw: number[][][] =
      geom.type === "Polygon" ? [geom.arcs as number[][]] : (geom.arcs as number[][][]);
    const polygons: Polygon[] = polygonsRaw.map((poly) =>
      poly.map((ringArcs) => stitchRing(ringArcs, arcs)),
    );
    out.push({
      numericId: String(geom.id ?? ""),
      name: geom.properties?.name ?? "",
      polygons,
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Projections (spherical degrees in, unit coordinates out; y grows north).
// ----------------------------------------------------------------------------

const RAD = Math.PI / 180;

/** Natural Earth I raw projection - polynomial from d3-geo (ISC). */
function naturalEarth1(lonDeg: number, latDeg: number): [number, number] {
  const lambda = lonDeg * RAD;
  const phi = latDeg * RAD;
  const phi2 = phi * phi;
  const phi4 = phi2 * phi2;
  return [
    lambda *
      (0.8707 - 0.131979 * phi2 + phi4 * (-0.013791 + phi4 * (0.003971 * phi2 - 0.001529 * phi4))),
    phi * (1.007226 + phi2 * (0.015085 + phi4 * (-0.044475 + 0.028874 * phi2 - 0.005916 * phi4))),
  ];
}

/**
 * Lambert azimuthal equal-area centered on (lat0, lon0) - the projection
 * family used by official EU (EPSG:3035-style) Europe maps.
 */
function makeLaea(lat0Deg: number, lon0Deg: number) {
  const phi1 = lat0Deg * RAD;
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  return (lonDeg: number, latDeg: number): [number, number] => {
    const phi = latDeg * RAD;
    const dLambda = (lonDeg - lon0Deg) * RAD;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const denom = 1 + sinPhi1 * sinPhi + cosPhi1 * cosPhi * Math.cos(dLambda);
    // Antipodal guard - never hit for the clipped Europe window.
    const k = Math.sqrt(2 / Math.max(denom, 1e-9));
    return [
      k * cosPhi * Math.sin(dLambda),
      k * (cosPhi1 * sinPhi - sinPhi1 * cosPhi * Math.cos(dLambda)),
    ];
  };
}

// ----------------------------------------------------------------------------
// Sutherland-Hodgman clipping of lon/lat rings against a rectangular window.
// Used to cut the Europe view (drops overseas territories, trims Russia /
// Türkiye at the window edge exactly like official EU inset maps do).
// ----------------------------------------------------------------------------

interface ClipWindow {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

/**
 * Unwrap longitudes along a ring so consecutive points never jump across the
 * antimeridian (+180 -> -180). Without this, rings that cross it (Russia,
 * Fiji) produce a horizontal band across the whole map after clipping.
 */
function unwrapRing(ring: Ring): Ring {
  if (ring.length === 0) return ring;
  const out: Ring = [ring[0]];
  let offset = 0;
  for (let i = 1; i < ring.length; i++) {
    const rawDelta = ring[i][0] - ring[i - 1][0];
    if (rawDelta > 180) offset -= 360;
    else if (rawDelta < -180) offset += 360;
    out.push([ring[i][0] + offset, ring[i][1]]);
  }
  return out;
}

/**
 * Split a (possibly unwrapped) ring at the antimeridian into window-sized
 * pieces: clip once against [-180, 180] and once against the same window
 * shifted by 360 deg (covers the unwrapped overflow), shifting the result back.
 */
function splitAtAntimeridian(ring: Ring, latMin: number, latMax: number): Ring[] {
  const unwrapped = unwrapRing(ring);
  const lons = unwrapped.map((p) => p[0]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  if (maxLon <= 180 && minLon >= -180) return [unwrapped];
  // Po unwrapie pierścień nieopasujący globu rozciąga się poza dokładnie
  // JEDNĄ krawędź (>180 lub <-180) - wystarczy jedno przesunięte cięcie.
  const window = { lonMin: -180, lonMax: 180, latMin, latMax };
  const shift = maxLon > 180 ? -360 : 360;
  const pieces: Ring[] = [];
  const base = clipRing(unwrapped, window);
  if (base.length >= 3) pieces.push(base);
  const shifted = clipRing(
    unwrapped.map((p): [number, number] => [p[0] + shift, p[1]]),
    window,
  );
  if (shifted.length >= 3) pieces.push(shifted);
  return pieces;
}

function clipRing(ring: Ring, w: ClipWindow): Ring {
  type Edge = {
    inside: (p: [number, number]) => boolean;
    t: (a: [number, number], b: [number, number]) => number;
  };
  const edges: Edge[] = [
    { inside: (p) => p[0] >= w.lonMin, t: (a, b) => (w.lonMin - a[0]) / (b[0] - a[0]) },
    { inside: (p) => p[0] <= w.lonMax, t: (a, b) => (w.lonMax - a[0]) / (b[0] - a[0]) },
    { inside: (p) => p[1] >= w.latMin, t: (a, b) => (w.latMin - a[1]) / (b[1] - a[1]) },
    { inside: (p) => p[1] <= w.latMax, t: (a, b) => (w.latMax - a[1]) / (b[1] - a[1]) },
  ];
  let poly = ring;
  for (const edge of edges) {
    if (poly.length === 0) break;
    const next: Ring = [];
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i];
      const prev = poly[(i + poly.length - 1) % poly.length];
      const curIn = edge.inside(cur);
      const prevIn = edge.inside(prev);
      if (curIn) {
        if (!prevIn) {
          const t = edge.t(prev, cur);
          next.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
        }
        next.push(cur);
      } else if (prevIn) {
        const t = edge.t(prev, cur);
        next.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
      }
    }
    poly = next;
  }
  return poly;
}

// ----------------------------------------------------------------------------
// Fitting, simplification, path serialization.
// ----------------------------------------------------------------------------

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function emptyBounds(): Bounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function extend(b: Bounds, x: number, y: number): void {
  if (x < b.minX) b.minX = x;
  if (x > b.maxX) b.maxX = x;
  if (y < b.minY) b.minY = y;
  if (y > b.maxY) b.maxY = y;
}

type Project = (lon: number, lat: number) => [number, number];

/** Project every ring, flip y for SVG, fit into width x height with padding. */
function projectAndFit(
  features: CountryFeature[],
  project: Project,
  width: number,
  padding: number,
): { projected: Map<string, number[][][][]>; height: number } {
  const bounds = emptyBounds();
  const rawByCountry = new Map<string, number[][][][]>();
  for (const f of features) {
    const polys: number[][][][] = [];
    for (const polygon of f.polygons) {
      const rings: number[][][] = [];
      for (const ring of polygon) {
        const pts: number[][] = [];
        for (const [lon, lat] of ring) {
          const [px, pyUp] = project(lon, lat);
          const x = px;
          const y = -pyUp; // SVG y grows down
          extend(bounds, x, y);
          pts.push([x, y]);
        }
        if (pts.length >= 3) rings.push(pts);
      }
      if (rings.length) polys.push(rings);
    }
    rawByCountry.set(f.numericId + "|" + f.name, polys);
  }
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const scale = (width - padding * 2) / spanX;
  const height = Math.round(spanY * scale + padding * 2);
  const projected = new Map<string, number[][][][]>();
  for (const [key, polys] of rawByCountry) {
    projected.set(
      key,
      polys.map((rings) =>
        rings.map((ring) =>
          ring.map(([x, y]) => [
            (x - bounds.minX) * scale + padding,
            (y - bounds.minY) * scale + padding,
          ]),
        ),
      ),
    );
  }
  return { projected, height };
}

/** Drop points that move less than `epsilon` px - cheap, shape-preserving. */
function thinRing(ring: number[][], epsilon: number): number[][] {
  const out: number[][] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= epsilon) out.push(p);
  }
  return out;
}

function ringToPath(ring: number[][]): string {
  let d = "";
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i];
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d + "Z";
}

function polygonsToPath(polys: number[][][][], epsilon: number): string {
  let d = "";
  for (const rings of polys) {
    for (const ring of rings) {
      const thin = thinRing(ring, epsilon);
      if (thin.length >= 3) d += ringToPath(thin);
    }
  }
  return d;
}

// ----------------------------------------------------------------------------
// Country identity: numeric -> alpha-2 + bilingual names via i18n-iso-countries
// (embedded at build time, so no locale data ships in the client bundle).
// ----------------------------------------------------------------------------

/** Disputed/unnumbered territories world-atlas ships with a non-ISO id. */
const NAME_OVERRIDES: Record<string, { id: string; pl: string; en: string }> = {
  Kosovo: { id: "XK", pl: "Kosowo", en: "Kosovo" },
  Somaliland: { id: "XS", pl: "Somaliland", en: "Somaliland" },
  "N. Cyprus": { id: "XN", pl: "Cypr Północny", en: "Northern Cyprus" },
};

interface OutCountry {
  /** ISO 3166-1 alpha-2 (or X* placeholder for disputed territories). */
  id: string;
  pl: string;
  en: string;
  d: string;
}

interface GeoAsset {
  v: 1;
  /** Attribution kept inside the asset so it travels with the data. */
  license: string;
  viewBox: string;
  countries: OutCountry[];
}

function identify(f: CountryFeature): { id: string; pl: string; en: string } | null {
  const override = NAME_OVERRIDES[f.name];
  if (override) return override;
  const padded = f.numericId.padStart(3, "0");
  const alpha2 = countriesLib.numericToAlpha2(padded);
  if (!alpha2) return null;
  const pl = countriesLib.getName(alpha2, "pl") ?? f.name;
  const en = countriesLib.getName(alpha2, "en") ?? f.name;
  return { id: alpha2, pl, en };
}

function buildAsset(
  features: CountryFeature[],
  project: Project,
  width: number,
  epsilon: number,
): GeoAsset {
  const { projected, height } = projectAndFit(features, project, width, 8);
  const countries: OutCountry[] = [];
  for (const f of features) {
    const identity = identify(f);
    if (!identity) continue;
    const polys = projected.get(f.numericId + "|" + f.name);
    if (!polys) continue;
    const d = polygonsToPath(polys, epsilon);
    if (!d) continue;
    countries.push({ ...identity, d });
  }
  countries.sort((a, b) => a.id.localeCompare(b.id));
  return {
    v: 1,
    license:
      "Geometry: Natural Earth (public domain) via world-atlas (ISC). Projection code ported from d3-geo (ISC).",
    viewBox: `0 0 ${width} ${height}`,
    countries,
  };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

const inputDir = process.argv[2];
if (!inputDir) {
  console.error("Usage: bun run scripts/generate-geo-maps.ts <dir-with-world-atlas-json>");
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
countriesLib.registerLocale(require("i18n-iso-countries/langs/pl.json"));
// eslint-disable-next-line @typescript-eslint/no-require-imports
countriesLib.registerLocale(require("i18n-iso-countries/langs/en.json"));

const outDir = join(import.meta.dir, "..", "public", "geo");
mkdirSync(outDir, { recursive: true });

// --- World (110m, Natural Earth I, Antarctica dropped) ---
const world110 = JSON.parse(
  readFileSync(join(inputDir, "countries-110m.json"), "utf8"),
) as Topology;
const worldFeatures = decodeCountries(world110)
  .filter((f) => f.numericId !== "010")
  .map((f) => ({
    ...f,
    // Rozetnij pierścienie na antypołudniku (Rosja, Fidżi) - inaczej wychodzi
    // pozioma smuga przez całą mapę. fill-rule=evenodd zachowuje dziury.
    polygons: f.polygons.map((polygon) =>
      polygon.flatMap((ring) => splitAtAntimeridian(ring, -90, 90)),
    ),
  }));
const worldAsset = buildAsset(worldFeatures, naturalEarth1, 960, 0.4);
writeFileSync(join(outDir, "world-110m.v1.json"), JSON.stringify(worldAsset));

// --- Europe (50m detail, LAEA "EU-style", clipped to the Europe window) ---
const EUROPE_WINDOW: ClipWindow = { lonMin: -25, lonMax: 50.5, latMin: 34, latMax: 72 };
const world50 = JSON.parse(readFileSync(join(inputDir, "countries-50m.json"), "utf8")) as Topology;
const europeFeatures: CountryFeature[] = [];
for (const f of decodeCountries(world50)) {
  const polygons: Polygon[] = [];
  for (const polygon of f.polygons) {
    // Unwrap przed klipem - pierścień Rosji przecina antypołudnik i bez tego
    // zostawia poziomy pas w poprzek całego okna Europy.
    const clipped = polygon
      .map((ring) => clipRing(unwrapRing(ring), EUROPE_WINDOW))
      .filter((ring) => ring.length >= 3);
    // Keep the polygon only if its exterior ring survived the clip.
    if (clipped.length && clipRing(unwrapRing(polygon[0]), EUROPE_WINDOW).length >= 3) {
      polygons.push(clipped);
    }
  }
  if (polygons.length) europeFeatures.push({ ...f, polygons });
}
const europeAsset = buildAsset(europeFeatures, makeLaea(52, 10), 960, 0.5);
writeFileSync(join(outDir, "europe-50m.v1.json"), JSON.stringify(europeAsset));

const worldKb = (JSON.stringify(worldAsset).length / 1024).toFixed(1);
const europeKb = (JSON.stringify(europeAsset).length / 1024).toFixed(1);
console.log(`geo assets written to public/geo/`);
console.log(
  `  world-110m.v1.json  ${worldKb} KB (${worldAsset.countries.length} countries, ${worldAsset.viewBox})`,
);
console.log(
  `  europe-50m.v1.json  ${europeKb} KB (${europeAsset.countries.length} countries, ${europeAsset.viewBox})`,
);
