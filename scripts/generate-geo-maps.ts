// Build-time generator for the interactive map geometry assets.
//
// Emits pre-projected SVG path data to public/geo/*.json so the runtime map
// component (src/components/charts/ChoroplethMap.tsx) ships ZERO geometry or
// projection code in the JS bundle - it just fetches a static, CDN-cacheable
// JSON and paints <path d>. Country display names (PL/EN) are embedded at
// build time from i18n-iso-countries, so no locale data ships to the client.
//
// Generuje SIEDEM zasobów:
//   world-110m.v2.json          świat, Natural Earth I, bez Antarktydy
//   europe-50m.v2.json          LAEA (52, 10),    okno -25..50,5 / 34..72
//   africa-50m.v1.json          LAEA (0, 15),     okno -26..58 / -35,5..37,5
//   asia-50m.v1.json            LAEA (35, 100),   okno 25..191 / -11,5..82
//   north-america-50m.v1.json   LAEA (45, -105),  okno -190..-10 / 6,5..84
//   south-america-50m.v1.json   LAEA (-20, -60),  okno -93..-33 / -56..13
//   oceania-50m.v1.json         LAEA (-25, 172,5) okno 110..240 / -48..21
//
// Wszystkie mapy regionalne idą z countries-50m.json, nie ze 110m. Powód nie
// jest estetyczny: przy 110m z zasobu WYPADAJĄ CAŁE KRAJE, a nie szczegóły -
// Oceania miałaby 7 krajów zamiast 24 (nie ma FM, MH, PW, KI, NR, TO, WS, GU,
// MP, CK, NU, WF, NF, PN, PF), Ameryka Płn. 18 zamiast 38 (bez niemal całych
// Karaibów), Azja traci BH, HK, MO, MV, SG i XN, Afryka CV, KM, MU, SC, ST
// i SH. Dla mapy-choroplety brak kraju to brak miejsca na daną, więc rozmiar
// kontroluje upraszczanie geometrii (Douglas-Peucker), a nie rozdzielczość
// źródła.
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
// Jawny wpis /index.js + jawna rejestracja języków (patrz no-restricted-imports
// w eslint.config.js) - ten sam wzorzec co CountryCombobox.
import countriesLib from "i18n-iso-countries/index.js";

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
  /**
   * Granice w stopniach. `lonMax` WOLNO przekroczyć 180 - okno Azji sięga 191,
   * a Oceanii 240 - bo oba kontynenty leżą okrakiem na antypołudniku.
   * Długości spoza [-180, 180] wprowadza `recenterRing`; sama projekcja LAEA
   * radzi sobie z nimi bez zmian, bo liczy `sin/cos` z różnicy długości,
   * a te są okresowe co 360 stopni.
   */
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

/**
 * Przesuń CAŁY pierścień o wielokrotność 360 stopni tak, żeby wypadł możliwie
 * blisko środka okna. Wołać PO `unwrapRing`.
 *
 * PO CO TO JEST. `unwrapRing` naprawia skok WEWNĄTRZ pierścienia, ale nie
 * rusza pierścienia, który żadnego skoku nie ma - a przy Azji i Oceanii
 * problem jest odwrotny niż na mapie świata: to nie pierścień przechodzi przez
 * antypołudnik, tylko OKNO. Samoa (-172,8 do -171,4) nie ma w sobie żadnego
 * skoku, więc po unwrapie dalej leży przy -172 i po prostu nie trafia w okno
 * Oceanii (110 do 240). `clipRing` zwracał pustą tablicę, pętla budująca
 * pomijała feature i kraj ZNIKAŁ BEZ SŁOWA. Zmierzone na 50m: bez tej funkcji
 * z Oceanii wypadały AS, TO, WF i WS, a Czukotka była ucinana równo na 180
 * stopniach (sztuczna pionowa krawędź długości 42 px w poprzek Rosji).
 *
 * `splitAtAntimeridian` tego NIE ROZWIĄZUJE i nie miało rozwiązywać - tamto
 * tnie pierścień względem [-180, 180] na potrzeby mapy świata, gdzie projekcja
 * naturalEarth1 jest NIEOKRESOWA (długość wchodzi do wzoru liniowo) i bez
 * cięcia Rosja robi poziomą smugę przez całą mapę. Tu projekcja jest
 * azymutalna i okresowa, więc ciąć nie ma czego - trzeba tylko dowieźć
 * pierścień do właściwej „kopii" globu.
 *
 * Wybieramy przesunięcie NAJBLIŻSZE ŚRODKOWI OKNA, a nie pierwsze mieszczące
 * się w [lonMin, lonMin+360). Przy oknie Europy (-25 do 50,5) ta druga reguła
 * przerzuciłaby Grenlandię z -50 na +310 i wycięła ją z mapy Europy, na której
 * jest od zawsze.
 */
function recenterRing(ring: Ring, lonCenter: number): Ring {
  if (ring.length === 0) return ring;
  const shift = Math.round((lonCenter - ring[0][0]) / 360);
  if (shift === 0) return ring;
  return ring.map(([lon, lat]): [number, number] => [lon + shift * 360, lat]);
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

/**
 * Affine fit of the raw (projected, y-flipped) plane into the viewBox:
 * px = (raw - min) * scale + padding. Embedded in the asset (`proj`) so the
 * runtime can project extra lon/lat points (corridor lines, city markers)
 * onto the SAME canvas without shipping any geometry code duplication drift.
 */
interface FitTransform {
  minX: number;
  minY: number;
  scale: number;
  padding: number;
}

/** Project every ring, flip y for SVG, fit into width x height with padding. */
function projectAndFit(
  features: CountryFeature[],
  project: Project,
  width: number,
  padding: number,
): { projected: Map<string, number[][][][]>; height: number; fit: FitTransform } {
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
  return {
    projected,
    height,
    fit: { minX: bounds.minX, minY: bounds.minY, scale, padding },
  };
}

/**
 * Douglas-Peucker: zostawia punkt tylko wtedy, gdy jego odległość PROSTOPADŁA
 * od cięciwy łączącej końce upraszczanego odcinka przekracza tolerancję.
 *
 * DLACZEGO NIE PRZERZEDZANIE PO SĄSIEDZIE, KTÓRE TU STAŁO WCZEŚNIEJ. Poprzednia
 * wersja (`thinRing`) odrzucała punkt, gdy jego odległość L1 od POPRZEDNIKA była
 * mniejsza od progu. Taki filtr nie ogranicza błędu kształtu w ŻADEN sposób:
 * sto kolejnych punktów po 0,49 px każdy zostaje odrzuconych, a linia brzegowa
 * dryfuje przez ten czas o 49 px - czyli o jedną dwudziestą szerokości mapy.
 * W drugą stronę ten sam filtr ZOSTAWIAŁ punkt oddalony o 0,6 px, choć leżał
 * dokładnie na cięciwie i nie wnosił nic poza bajtami.
 *
 * Douglas-Peucker przy TYM SAMYM progu 0,5 px ogranicza błąd prostopadły do
 * 0,5 px, więc jest jednocześnie WIERNIEJSZY i dużo oszczędniejszy. Zmierzone
 * na world-atlas 2.0.2: europe-50m 198 KiB -> 82 KiB, world-110m 131 KiB ->
 * 87 KiB, a pięć kontynentów zmieściło się w 279 KiB zamiast 827 KiB. To była
 * jedyna dźwignia rozmiaru, która cokolwiek dała - filtrowanie mikrowysp po
 * polu (próg 4 px^2) ścinało z Azji 295 podścieżek i tylko 8% bajtów, bo
 * rozmiar robią DŁUGIE LINIE BRZEGOWE (Kanada, Rosja, Indonezja), a nie liczba
 * wysepek.
 */
function douglasPeucker(pts: number[][], tolerance: number): number[][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const tol2 = tolerance * tolerance;
  // Iteracyjnie, nie rekurencyjnie: pierścień Kanady ma 11,5 tys. punktów,
  // a rekurencja na takiej długości potrafi rozwalić stos.
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    if (b - a < 2) continue;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let far = -1;
    let farD2 = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let d2: number;
      if (len2 === 0) {
        // Cięciwa zdegenerowana do punktu - mierz odległość wprost od niego.
        const ex = px - ax;
        const ey = py - ay;
        d2 = ex * ex + ey * ey;
      } else {
        // Rzut na ODCINEK (t przycięte do [0,1]), nie na prostą: bez tego
        // punkt za końcem cięciwy dostaje zaniżoną odległość.
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - (ax + t * dx);
        const ey = py - (ay + t * dy);
        d2 = ex * ex + ey * ey;
      }
      if (d2 > farD2) {
        farD2 = d2;
        far = i;
      }
    }
    if (farD2 > tol2) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[][] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/**
 * Upraszczanie ZAMKNIĘTEGO pierścienia.
 *
 * Douglas-Peucker puszczony na całym pierścieniu ścina go do jednego odcinka:
 * pierwszy i ostatni punkt pierścienia to TEN SAM punkt, więc cięciwa ma
 * zerową długość i cała reszta wypada „blisko" niej. Dlatego pierścień idzie
 * na dwie połówki (podział w indeksie n/2) i każda upraszcza się osobno.
 *
 * Pierścienie z world-atlas są zamknięte (sprawdzone: 1629 na 1629 w 50m ma
 * ostatni punkt równy pierwszemu), więc odcięcie ostatniego punktu każdej
 * połówki niczego nie gubi - `Z` w ścieżce SVG domyka figurę samo.
 */
function simplifyRing(ring: number[][], epsilon: number): number[][] {
  if (ring.length < 4) return ring;
  const mid = Math.floor(ring.length / 2);
  const head = douglasPeucker(ring.slice(0, mid + 1), epsilon);
  const tail = douglasPeucker(ring.slice(mid), epsilon);
  return [...head.slice(0, -1), ...tail.slice(0, -1)];
}

/** Pole pierścienia (wzór na pole wielokąta), bezwzględne - do wyboru
 *  największego kawałka kraju w fallbacku `polygonsToPath`. */
function ringArea(ring: number[][]): number {
  let acc = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    acc += x1 * y2 - x2 * y1;
  }
  return Math.abs(acc) / 2;
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
      const thin = simplifyRing(ring, epsilon);
      if (thin.length >= 3) d += ringToPath(thin);
    }
  }
  // FALLBACK: kraj MNIEJSZY OD PROGU UPRASZCZANIA znikał z zasobu bez śladu.
  // Upraszczanie mogło zejść poniżej trzech punktów, `d` wychodziło puste,
  // a `buildAsset` pomijał taki kraj przez `if (!d) continue` - cicho, bez
  // ostrzeżenia. Tak właśnie WYPADŁ WATYKAN z europe-50m.v2.json: zasób miał
  // 64 kraje zamiast 65 i nikt tego nie zauważył, bo San Marino, Monako,
  // Liechtenstein, Andora i Malta są odrobinę większe i przechodziły.
  // Przy kontynentach problem urósłby: bez tego fallbacku ginęły MO, MV
  // (Azja), BL, MS (Ameryka Płn.), NR, NF (Oceania).
  //
  // Dlatego gdy nie przetrwało NIC, wracamy do NAJWIĘKSZEGO pierścienia
  // BEZ upraszczania. Kosztuje kilkadziesiąt bajtów na taki kraj i daje
  // gwarancję: lista krajów w zasobie == lista krajów na wejściu.
  if (!d) {
    let best: number[][] | null = null;
    let bestArea = -1;
    for (const rings of polys) {
      for (const ring of rings) {
        const area = ringArea(ring);
        if (area > bestArea) {
          bestArea = area;
          best = ring;
        }
      }
    }
    if (best && best.length >= 3) d = ringToPath(best);
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

/**
 * Projection + fit metadata embedded in the asset. Mirrors
 * `GeoProjectionMeta` in src/lib/charts/types.ts - lets the runtime project
 * arbitrary lon/lat (corridor waypoints, city markers) onto the same canvas.
 */
interface GeoProjectionMeta {
  type: "laea" | "naturalEarth1";
  /** LAEA center - present only for type "laea". */
  lat0?: number;
  lon0?: number;
  minX: number;
  minY: number;
  scale: number;
  padding: number;
}

interface GeoAsset {
  v: 1;
  /** Attribution kept inside the asset so it travels with the data. */
  license: string;
  viewBox: string;
  proj: GeoProjectionMeta;
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
  projMeta: Pick<GeoProjectionMeta, "type" | "lat0" | "lon0">,
  width: number,
  epsilon: number,
): GeoAsset {
  const { projected, height, fit } = projectAndFit(features, project, width, 8);
  // JEDEN WPIS NA KRAJ, NIE NA FEATURE. world-atlas potrafi mieć dwa osobne
  // feature'y o tym samym numerze ISO - w 50m są to „Australia" i „Ashmore and
  // Cartier Is.", oba z numerem 036. Wcześniejsze `countries.push()` per feature
  // dawało w zasobie Oceanii DWA wpisy o id "AU", a runtime (ChoroplethMap)
  // renderuje kraje przez `key={c.id}`: React dostawał zduplikowany klucz,
  // a kraj z danymi rysował się dwa razy. Błąd był przy tym zależny od progu
  // upraszczania - mniejszy feature raz znikał, raz nie - więc łatwo go było
  // przeoczyć. Scalamy po `identity.id`, doklejając ścieżkę: `fill-rule`
  // evenodd i tak traktuje kolejne podścieżki jak kawałki tej samej figury.
  const byId = new Map<string, OutCountry>();
  for (const f of features) {
    const identity = identify(f);
    if (!identity) continue;
    const polys = projected.get(f.numericId + "|" + f.name);
    if (!polys) continue;
    const d = polygonsToPath(polys, epsilon);
    if (!d) continue;
    const prev = byId.get(identity.id);
    if (prev) prev.d += d;
    else byId.set(identity.id, { ...identity, d });
  }
  const countries = [...byId.values()];
  countries.sort((a, b) => a.id.localeCompare(b.id));
  return {
    v: 1,
    license:
      "Geometry: Natural Earth (public domain) via world-atlas (ISC). Projection code ported from d3-geo (ISC).",
    viewBox: `0 0 ${width} ${height}`,
    proj: {
      ...projMeta,
      minX: fit.minX,
      minY: fit.minY,
      scale: fit.scale,
      padding: fit.padding,
    },
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

const outDir = join(import.meta.dirname, "..", "public", "geo");
mkdirSync(outDir, { recursive: true });

const written: { file: string; asset: GeoAsset; bytes: number }[] = [];

function emit(file: string, asset: GeoAsset): void {
  const json = JSON.stringify(asset);
  writeFileSync(join(outDir, file), json);
  // Buffer.byteLength, NIE json.length: to drugie liczy jednostki kodowe
  // UTF-16, a nazwy krajów mają polskie znaki diakrytyczne. Dla Europy
  // rozjazd wynosił kilkanaście bajtów - mało, ale budżet rozmiaru musi
  // pilnować tego, co naprawdę ląduje na dysku i w transferze.
  written.push({ file, asset, bytes: Buffer.byteLength(json, "utf8") });
}

// ----------------------------------------------------------------------------
// Mapa świata (110m, Natural Earth I, bez Antarktydy)
// ----------------------------------------------------------------------------

const world110 = JSON.parse(
  readFileSync(join(inputDir, "countries-110m.json"), "utf8"),
) as Topology;
const worldFeatures = decodeCountries(world110)
  .filter((f) => f.numericId !== "010")
  .map((f) => ({
    ...f,
    // Rozetnij pierścienie na antypołudniku (Rosja, Fidżi) - inaczej wychodzi
    // pozioma smuga przez całą mapę. fill-rule=evenodd zachowuje dziury.
    // Tylko TUTAJ, bo tylko naturalEarth1 jest projekcją nieokresową; mapy
    // kontynentów (LAEA) rozwiązują antypołudnik przez `recenterRing`.
    polygons: f.polygons.map((polygon) =>
      polygon.flatMap((ring) => splitAtAntimeridian(ring, -90, 90)),
    ),
  }));
emit(
  "world-110m.v2.json",
  buildAsset(worldFeatures, naturalEarth1, { type: "naturalEarth1" }, 960, 0.4),
);

// ----------------------------------------------------------------------------
// Mapy regionalne (50m, LAEA, przycięte oknem)
// ----------------------------------------------------------------------------

interface RegionSpec {
  /** Nazwa pliku bez rozszerzenia - runtime adresuje zasób po niej. */
  file: string;
  window: ClipWindow;
  /** Środek LAEA. */
  lat0: number;
  lon0: number;
  /**
   * Lista ISO alpha-2 albo `null` = bierz wszystko, co wpadło w okno.
   * Europa jedzie bez listy (patrz komentarz przy EUROPE_WINDOW).
   */
  iso: readonly string[] | null;
}

/**
 * PO CO OKNO, SKORO JEST LISTA KRAJÓW. Lista mówi, KTÓRE kraje należą do
 * kontynentu; okno mówi, JAKI KAWAŁEK świata pokazujemy - i te dwie rzeczy się
 * nie pokrywają. Okno robi trzy rzeczy, których lista nie zrobi:
 *
 *  1. Przycina Rosję na granicy Europa/Azja. Rosja jest na OBU mapach i na
 *     każdej ma INNY KSZTAŁT: w Europie ucięta na 50,5 stopnia E, w Azji na 25.
 *     Zakresy się nachodzą, więc ten sam `id="RU"` niesie w dwóch zasobach
 *     różną geometrię - to jest zamierzone, nie rozjazd. Tak samo robią
 *     urzędowe mapy poglądowe UE i tak samo są już przycięte w Europie
 *     Turcja, Kazachstan i Iran.
 *  2. Odcina terytoria zamorskie krajów Z LISTY, które rozciągnęłyby kadr na
 *     pusty ocean: Wyspy Księcia Edwarda przy RPA (47 stopni S), Wyspę
 *     Wielkanocną przy Chile (109 stopni W), Macquarie przy Australii.
 *     `projectAndFit` liczy kadr z sumy WSZYSTKICH punktów, więc jedna taka
 *     wysepka potrafi zmniejszyć cały kontynent o kilkanaście procent.
 *  3. Ustala kadr i proporcje zasobu.
 *
 * A po co lista, skoro jest okno: bo samo okno wpuszcza sąsiadów. Zmierzone
 * na 50m - w oknie Afryki ląduje 24 kraje spoza Afryki (z połową Półwyspu
 * Arabskiego: SA, YE, OM, plus ES, IT, GR, TR, IR, IQ), w oknie Azji 40,
 * w oknie Ameryki Płn. 22 (z Afryką Zachodnią i Wyspami Zielonego Przylądka).
 * Dla mapy-choroplety, gdzie każdy kraj jest fokusowalny i ma nazwę
 * w `<title>`, „pół Arabii Saudyjskiej" w mapie Afryki to błąd merytoryczny.
 */
const REGIONS: RegionSpec[] = [
  {
    // Europa bez listy krajów - świadomie. Okno jest wąskie, więc sąsiedzi
    // wchodzą tylko wąskim marginesem (DZ, MA, TN, IQ, IR, KZ, SY, LB) i są
    // KONTEKSTEM przyciętym krawędzią, dokładnie jak na urzędowych mapach UE.
    // Ten sam trik nie skaluje się na Afrykę czy Azję - stąd listy niżej.
    file: "europe-50m.v2.json",
    window: { lonMin: -25, lonMax: 50.5, latMin: 34, latMax: 72 },
    lat0: 52,
    lon0: 10,
    iso: null,
  },
  {
    // lonMin -26: Wyspy Zielonego Przylądka (Santo Antao, -25,4).
    // lonMax 58: Mauritius (57,8) i Seszele - wariant obcięty na 52 gubił oba,
    //   a przy tym wychodził WIĘKSZY (48,0 wobec 46,5 KiB), bo węższe okno
    //   podnosi skalę i zostawia więcej punktów po upraszczaniu.
    // latMax 37,5: Cap Angela w Tunezji (37,35), najdalszy punkt Afryki.
    // latMin -35,5: Przylądek Igielny (-34,8); świadomie ODCINA Wyspy Księcia
    //   Edwarda (RPA, -47), które rozciągnęłyby kadr o 12 stopni na południe.
    file: "africa-50m.v1.json",
    window: { lonMin: -26, lonMax: 58, latMin: -35.5, latMax: 37.5 },
    lat0: 0,
    lon0: 15,
    iso: [
      "AO",
      "BF",
      "BI",
      "BJ",
      "BW",
      "CD",
      "CF",
      "CG",
      "CI",
      "CM",
      "CV",
      "DJ",
      "DZ",
      "EG",
      "EH",
      "ER",
      "ET",
      "GA",
      "GH",
      "GM",
      "GN",
      "GQ",
      "GW",
      "KE",
      "KM",
      "LR",
      "LS",
      "LY",
      "MA",
      "MG",
      "ML",
      "MR",
      "MU",
      "MW",
      "MZ",
      "NA",
      "NE",
      "NG",
      "RW",
      "SC",
      "SD",
      "SH",
      "SL",
      "SN",
      "SO",
      "SS",
      "ST",
      "SZ",
      "TD",
      "TG",
      "TN",
      "TZ",
      "UG",
      "XS",
      "ZA",
      "ZM",
      "ZW",
    ],
  },
  {
    // lonMin 25 jest WYMUSZONE przez Turcję (25,7) i Cypr. Sprawdzone: przy
    //   lonMin 40 z mapy wypadają CY, IL, JO, LB, PS, SY i XN.
    // lonMax 191: Czukotka - pierścień Rosji po unwrapie sięga 190,3.
    // latMax 82: Ziemia Franciszka Józefa (81,9).
    // latMin -11,5: Indonezja (Roti, -10,9) i Timor Wschodni.
    file: "asia-50m.v1.json",
    window: { lonMin: 25, lonMax: 191, latMin: -11.5, latMax: 82 },
    lat0: 35,
    lon0: 100,
    iso: [
      "AE",
      "AF",
      "AM",
      "AZ",
      "BD",
      "BH",
      "BN",
      "BT",
      "CN",
      "CY",
      "GE",
      "HK",
      "ID",
      "IL",
      "IN",
      "IO",
      "IQ",
      "IR",
      "JO",
      "JP",
      "KG",
      "KH",
      "KP",
      "KR",
      "KW",
      "KZ",
      "LA",
      "LB",
      "LK",
      "MM",
      "MN",
      "MO",
      "MV",
      "MY",
      "NP",
      "OM",
      "PH",
      "PK",
      "PS",
      "QA",
      "RU",
      "SA",
      "SG",
      "SY",
      "TH",
      "TJ",
      "TL",
      "TM",
      "TR",
      "TW",
      "UZ",
      "VN",
      "XN",
      "YE",
    ],
  },
  {
    // lonMin -190 (czyli 170 stopni E po przesunięciu): Aleuty. Ich zachodnie
    //   wyspy leżą przy 179,8 E i dopiero `recenterRing` sprowadza je na
    //   -180,2 - bez tego wypadałyby z kadru Ameryki.
    // lonMax -10: północno-wschodni cypel Grenlandii (-11,4).
    // latMax 84: Kap Morris Jesup (83,6), najdalszy punkt lądu na północy.
    // latMin 6,5: Panama (7,2); Kolumbia jest już Ameryką Południową.
    file: "north-america-50m.v1.json",
    window: { lonMin: -190, lonMax: -10, latMin: 6.5, latMax: 84 },
    lat0: 45,
    lon0: -105,
    iso: [
      "AG",
      "AI",
      "AW",
      "BB",
      "BL",
      "BM",
      "BS",
      "BZ",
      "CA",
      "CR",
      "CU",
      "CW",
      "DM",
      "DO",
      "GD",
      "GL",
      "GT",
      "HN",
      "HT",
      "JM",
      "KN",
      "KY",
      "LC",
      "MF",
      "MS",
      "MX",
      "NI",
      "PA",
      "PM",
      "PR",
      "SV",
      "SX",
      "TC",
      "TT",
      "US",
      "VC",
      "VG",
      "VI",
    ],
  },
  {
    // lonMin -93: Galapagos (-91,7). Wariant bez nich (-82) wychodził WIĘKSZY
    //   (45,6 wobec 40,6 KiB) i dawał kadr 960x1396, czyli proporcję 1,45 -
    //   nie do ułożenia na stronie. Wyspa Wielkanocna (Chile, -109,4) zostaje
    //   odcięta świadomie, bo rozciągnęłaby kadr o kolejne 17 stopni.
    // lonMax -33: Fernando de Noronha (-32,4) i Ponta do Seixas.
    // latMin -56: Przylądek Horn (-55,9) i Georgia Południowa (-54,9).
    // latMax 13: Punta Gallinas w Kolumbii (12,5).
    file: "south-america-50m.v1.json",
    window: { lonMin: -93, lonMax: -33, latMin: -56, latMax: 13 },
    lat0: -20,
    lon0: -60,
    iso: ["AR", "BO", "BR", "CL", "CO", "EC", "FK", "GS", "GY", "PE", "PY", "SR", "UY", "VE"],
  },
  {
    // lonMin 110: Steep Point w Australii (112,9).
    // lonMax 240 (czyli -120): Pitcairn (-124) i Gambiery (Polinezja Fr.).
    //   Wariant obcięty na 190 gubił CK, NU, PF i PN, a wychodził WIĘKSZY
    //   (22,4 wobec 19,1 KiB) - patrz ta sama zależność co przy Afryce.
    // latMin -48: Wyspa Stewart i Chatham; świadomie odcina Campbell (-52,6)
    //   i Macquarie (-54,7).
    // latMax 21: Mariany Północne (20,5).
    //
    // CZEGO NIE MA I DLACZEGO NIE POMOŻE DOPISANIE DO LISTY: Tuvalu (TV),
    // Tokelau (TK) i Minor Outlying Islands (UM) NIE ISTNIEJĄ w źródle -
    // Natural Earth nie wydziela ich jako osobnych geometrii ani w 50m, ani
    // w 110m (sprawdzone po numerycznym ISO i po nazwie). Lista poniżej
    // zawiera KOMPLET tego, co w źródle jest; dopisanie do niej TV zmieniłoby
    // tylko tyle, że kod wyglądałby, jakby Tuvalu dało się narysować.
    // Postawienie ich na mapie wymaga innego źródła geometrii, nie innej
    // listy - i jest osobną decyzją.
    file: "oceania-50m.v1.json",
    window: { lonMin: 110, lonMax: 240, latMin: -48, latMax: 21 },
    lat0: -25,
    lon0: 172.5,
    iso: [
      "AS",
      "AU",
      "CK",
      "FJ",
      "FM",
      "GU",
      "KI",
      "MH",
      "MP",
      "NC",
      "NF",
      "NR",
      "NU",
      "NZ",
      "PF",
      "PG",
      "PN",
      "PW",
      "SB",
      "TO",
      "VU",
      "WF",
      "WS",
    ],
  },
];

const world50 = JSON.parse(readFileSync(join(inputDir, "countries-50m.json"), "utf8")) as Topology;
const world50Features = decodeCountries(world50);

for (const region of REGIONS) {
  const allowed = region.iso ? new Set(region.iso) : null;
  const lonCenter = (region.window.lonMin + region.window.lonMax) / 2;
  const features: CountryFeature[] = [];
  for (const f of world50Features) {
    if (allowed) {
      const identity = identify(f);
      if (!identity || !allowed.has(identity.id)) continue;
    }
    const polygons: Polygon[] = [];
    for (const polygon of f.polygons) {
      // Unwrap przed klipem - pierścień Rosji przecina antypołudnik i bez tego
      // zostawia poziomy pas w poprzek całego okna. Recenter PO unwrapie -
      // dowozi pierścień do właściwej kopii globu (patrz `recenterRing`).
      const prepared = polygon.map((ring) => recenterRing(unwrapRing(ring), lonCenter));
      const clipped = prepared
        .map((ring) => clipRing(ring, region.window))
        .filter((ring) => ring.length >= 3);
      // Zostaw wielokąt tylko, gdy przetrwał jego pierścień ZEWNĘTRZNY -
      // inaczej z kraju przyciętego krawędzią zostałyby same dziury.
      if (clipped.length && clipRing(prepared[0], region.window).length >= 3) {
        polygons.push(clipped);
      }
    }
    if (polygons.length) features.push({ ...f, polygons });
  }
  emit(
    region.file,
    buildAsset(
      features,
      makeLaea(region.lat0, region.lon0),
      { type: "laea", lat0: region.lat0, lon0: region.lon0 },
      960,
      0.5,
    ),
  );
}

// ----------------------------------------------------------------------------
// Podsumowanie
// ----------------------------------------------------------------------------

let totalBytes = 0;
console.log("geo assets written to public/geo/");
for (const { file, asset, bytes } of written) {
  totalBytes += bytes;
  console.log(
    `  ${file.padEnd(26)} ${(bytes / 1024).toFixed(1).padStart(7)} KiB  ` +
      `${String(asset.countries.length).padStart(3)} krajów  viewBox ${asset.viewBox}`,
  );
}
console.log(`  ${"RAZEM".padEnd(26)} ${(totalBytes / 1024).toFixed(1).padStart(7)} KiB`);
