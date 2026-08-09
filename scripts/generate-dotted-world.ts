// Build-time generator for the "dotted world" layer used by the `world-map`
// builder widget (src/components/maps/WorldMap.tsx).
//
// DLACZEGO GENERATOR, A NIE BIBLIOTEKA
// Pierwowzór widgetu rysuje tło biblioteką `dotted-map` (pakiet niesie własny
// świat w GeoJSON i liczy siatkę kropek w przeglądarce). W tym repozytorium
// obowiązuje odwrotna doktryna, ta sama co dla choroplety: GEOMETRIA NIE
// PODRÓŻUJE W BUNDLU JS. Zamiast dokładać zależność runtime, siatka kropek jest
// wyliczana RAZ, przy budowie, z zasobu, który już leży w repo
// (public/geo/world-110m.v1.json - Natural Earth przez world-atlas), i zapisana
// jako statyczny, wersjonowany plik CDN-owalny.
//
// CO POWSTAJE
//   public/geo/world-dots.v1.svg   - warstwa kropek (siatka „diagonal", jak
//       `grid: "diagonal"` w pierwowzorze) w viewBoxie siatki (COLS x ROWS),
//       o TEJ SAMEJ proporcji co płótno widgetu 800x400 - komórka siatki
//       pokrywa się co do piksela z rzutem `projectPoint`. Plik jest MASKĄ
//       LUMINANCJI, nie obrazkiem: kropki są BIAŁE na przezroczystym tle, więc
//       `<mask>` w SVG widgetu przepuszcza w nich kolor prostokąta pod spodem.
//       Jedna kopia obsługuje tryb jasny, ciemny, dowolny kolor z panelu ORAZ
//       dowolne kadrowanie (viewBox widgetu przycina maskę razem z resztą).
//   src/lib/maps/countryCentroids.ts - centroidy krajów (ISO-2 -> lat/lon) dla
//       edytora: autor wybiera kraj, a panel wpisuje współrzędne punktu. Tabela
//       jest importowana WYŁĄCZNIE przez panel admina, nigdy przez renderer.
//
// Użycie:
//   bun run scripts/generate-dotted-world.ts
//
// Wejście (public/geo/world-110m.v1.json) niesie ścieżki SVG już rzutowane
// projekcją Natural Earth I plus metadane `proj`, więc test „ląd czy woda"
// robimy w płaszczyźnie rzutowanej: projekcja jest ciągła i różnowartościowa na
// (-180..180, -90..90), więc punkt jest w kraju wtedy i tylko wtedy, gdy jego
// obraz leży w wielokącie kraju.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const GEO_ASSET = join("public", "geo", "world-110m.v1.json");
const OUT_SVG = join("public", "geo", "world-dots.v1.svg");
const OUT_CENTROIDS = join("src", "lib", "maps", "countryCentroids.ts");

/**
 * Siatka kropek: 180 wierszy na 180° szerokości, czyli 1° na komórkę.
 *
 * Pierwowzór stoi na `height: 100` biblioteki `dotted-map` (1,8° na komórkę),
 * ale widget potrafi KADROWAĆ mapę do samych połączeń. Przy typowym zbliżeniu
 * ~2x siatka 1,8° rozjeżdża się w wielkie kule i wybrzeża przestają być
 * czytelne - Wielka Brytania robi się kleksem. 1° trzyma ten sam charakter
 * „halftone" także w zbliżeniu; koszt to ~40 KB po gzipie na wersjonowanym,
 * cache'owanym pliku, który i tak nie wchodzi do bundla JS.
 */
const ROWS = 180;
const COLS = 360;
/**
 * Nadpróbkowanie testu „ląd czy woda" wewnątrz komórki. Pojedyncza próbka
 * w środku komórki daje poszarpane wybrzeża (kropka albo jest, albo jej nie ma,
 * o czym decyduje jeden punkt); 2x2 z progiem 50% pokrycia wygładza linię
 * brzegową i usuwa samotne kropki na wodzie.
 */
const SUPERSAMPLE = 2;
const COVERAGE_MIN = 0.5;
/**
 * Promień kropki w jednostkach SIATKI (komórka = 1). 0,24 daje średnicę ~48%
 * odstępu - proporcja pierwowzoru (`radius: 0.22` przy odstępie 1), lekko
 * odchudzona, bo przy gęstszej siatce pole kropek szybciej zlewa się w plamę.
 */
const DOT_R = 0.24;
/**
 * Pas szerokości geograficznych, w którym stawiamy kropki. Bez odcięcia
 * Antarktyda i czapa arktyczna zjadają dolny/górny pas mapy, a pierwowzór ich
 * nie pokazuje (kadr jest „zamieszkany świat").
 */
const LAT_MAX = 84;
const LAT_MIN = -58;

const RAD = Math.PI / 180;

interface GeoProjMeta {
  type: string;
  lat0?: number;
  lon0?: number;
  minX: number;
  minY: number;
  scale: number;
  padding: number;
}
interface GeoAsset {
  viewBox: string;
  proj: GeoProjMeta;
  countries: Array<{ id: string; pl: string; en: string; d: string }>;
}

/** Natural Earth I - wielomian z d3-geo (ISC), spójny z generate-geo-maps.ts. */
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

/** Współczynnik skalujący długość geograficzną w Natural Earth I (tylko phi). */
function ne1LambdaFactor(phi: number): number {
  const phi2 = phi * phi;
  const phi4 = phi2 * phi2;
  return 0.8707 - 0.131979 * phi2 + phi4 * (-0.013791 + phi4 * (0.003971 * phi2 - 0.001529 * phi4));
}

/** Pionowa składowa Natural Earth I (rosnąca po phi) - do odwrócenia bisekcją. */
function ne1Y(phi: number): number {
  const phi2 = phi * phi;
  const phi4 = phi2 * phi2;
  return (
    phi * (1.007226 + phi2 * (0.015085 + phi4 * (-0.044475 + 0.028874 * phi2 - 0.005916 * phi4)))
  );
}

/** Odwrotność Natural Earth I - bisekcja po phi (funkcja monotoniczna). */
function naturalEarth1Invert(x: number, y: number): [number, number] {
  let lo = -Math.PI / 2;
  let hi = Math.PI / 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (ne1Y(mid) < y) lo = mid;
    else hi = mid;
  }
  const phi = (lo + hi) / 2;
  const factor = ne1LambdaFactor(phi);
  const lambda = Math.abs(factor) < 1e-9 ? 0 : x / factor;
  return [lambda / RAD, phi / RAD];
}

type Ring = Array<[number, number]>;

/** Ścieżki zasobu to wyłącznie `M`/`L`/`Z` z absolutnymi współrzędnymi. */
function parsePath(d: string): Ring[] {
  const rings: Ring[] = [];
  let current: Ring = [];
  const re = /([MLZ])([-0-9. ]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1] === "Z") {
      if (current.length) rings.push(current);
      current = [];
      continue;
    }
    const parts = m[2].trim().split(/\s+/);
    if (parts.length < 2) continue;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (m[1] === "M") {
      if (current.length) rings.push(current);
      current = [[x, y]];
    } else {
      current.push([x, y]);
    }
  }
  if (current.length) rings.push(current);
  return rings;
}

interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function bboxOf(ring: Ring): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Ray casting; wielokąty zasobu są proste (bez dziur w osobnych pierścieniach). */
function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Powierzchnia ze wzoru na pole wielokąta (do wyboru największego pierścienia). */
function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(sum) / 2;
}

/** Centroid wielokąta (wzór na środek masy powierzchni). */
function ringCentroid(ring: Ring): [number, number] {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += cross;
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

function main(): void {
  const asset = JSON.parse(readFileSync(GEO_ASSET, "utf8")) as GeoAsset;
  const { proj } = asset;
  if (proj.type !== "naturalEarth1") {
    throw new Error(`Nieobsługiwana projekcja zasobu: ${proj.type}`);
  }

  const project = (lon: number, lat: number): [number, number] => {
    const [px, py] = naturalEarth1(lon, lat);
    return [
      (px - proj.minX) * proj.scale + proj.padding,
      (-py - proj.minY) * proj.scale + proj.padding,
    ];
  };
  const unproject = (x: number, y: number): [number, number] => {
    const rawX = (x - proj.padding) / proj.scale + proj.minX;
    const rawY = -((y - proj.padding) / proj.scale + proj.minY);
    return naturalEarth1Invert(rawX, rawY);
  };

  const rings: Ring[] = [];
  const boxes: BBox[] = [];
  const centroids: Array<{ id: string; en: string; lat: number; lng: number }> = [];

  for (const country of asset.countries) {
    const parsed = parsePath(country.d);
    for (const ring of parsed) {
      if (ring.length < 3) continue;
      rings.push(ring);
      boxes.push(bboxOf(ring));
    }
    // Centroid liczymy z NAJWIĘKSZEGO pierścienia, nie ze średniej wszystkich:
    // dla krajów z terytoriami zamorskimi (FR, US, NL) środek masy całości ląduje
    // na oceanie, a autor spodziewa się kropki na kontynencie macierzystym.
    const biggest = parsed
      .filter((r) => r.length >= 3)
      .reduce<{ ring: Ring; area: number } | null>((best, ring) => {
        const area = ringArea(ring);
        return !best || area > best.area ? { ring, area } : best;
      }, null);
    if (!biggest) continue;
    const [cx, cy] = ringCentroid(biggest.ring);
    const [lng, lat] = unproject(cx, cy);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    centroids.push({
      id: country.id,
      en: country.en,
      lat: Math.round(lat * 100) / 100,
      lng: Math.round(lng * 100) / 100,
    });
  }

  const isLand = (x: number, y: number): boolean => {
    for (let i = 0; i < rings.length; i++) {
      const b = boxes[i];
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      if (pointInRing(x, y, rings[i])) return true;
    }
    return false;
  };

  const latStep = 180 / ROWS;
  const lonStep = 360 / COLS;
  /** Pokrycie lądem komórki (0..1) z siatki nadpróbkowania SUPERSAMPLE^2. */
  const coverage = (lat: number, lon: number): number => {
    let hit = 0;
    for (let sy = 0; sy < SUPERSAMPLE; sy++) {
      for (let sx = 0; sx < SUPERSAMPLE; sx++) {
        const la = lat + ((sy + 0.5) / SUPERSAMPLE - 0.5) * latStep;
        let lo = lon + ((sx + 0.5) / SUPERSAMPLE - 0.5) * lonStep;
        if (lo > 180) lo -= 360;
        if (lo < -180) lo += 360;
        if (isLand(...project(lo, la))) hit++;
      }
    }
    return hit / (SUPERSAMPLE * SUPERSAMPLE);
  };

  const dots: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    const lat = 90 - (row + 0.5) * latStep;
    if (lat > LAT_MAX || lat < LAT_MIN) continue;
    // Siatka „diagonal": co drugi wiersz przesunięty o pół komórki, więc kropki
    // układają się w ukośne rzędy zamiast w prostokątną kratę.
    const offset = row % 2 === 1 ? 0.5 : 0;
    for (let col = 0; col < COLS; col++) {
      let lon = -180 + (col + 0.5 + offset) * lonStep;
      if (lon > 180) lon -= 360;
      if (coverage(lat, lon) < COVERAGE_MIN) continue;
      let x = col + 0.5 + offset;
      if (x > COLS) x -= COLS;
      dots.push(`<use href="#d" x="${x.toFixed(1)}" y="${(row + 0.5).toFixed(1)}"/>`);
    }
  }

  // Układ współrzędnych PLIKU to sama siatka (COLS x ROWS), a nie płótno
  // widgetu: pozycje kropek stają się wtedy krótkimi liczbami (~2x mniejszy
  // plik), a proporcja jest ta sama co 800x400, więc `<image>` w masce dosiada
  // się do płótna co do piksela.
  //
  // `r` stoi na jednym wzorcu w <defs>, bo to własność GEOMETRII i NIE jest
  // dziedziczona - `r` na wspólnym <g> daje promień 0 i pusty plik (maska
  // renderuje się jako nic, bez żadnego błędu). `<use>` klonuje wzorzec razem
  // z promieniem i wypełnieniem.
  //
  // Kropki są BIAŁE: plik służy jako maska luminancji SVG (`<mask>`), w której
  // biel znaczy „pokaż", a przezroczystość „ukryj". Kolor daje dopiero
  // prostokąt pod maską, więc jeden plik obsługuje każdy motyw i każdy kolor
  // wybrany w panelu.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COLS} ${ROWS}" ` +
    `width="${COLS}" height="${ROWS}">` +
    `<defs><circle id="d" r="${DOT_R}" fill="#fff"/></defs>` +
    `<g>${dots.join("")}</g>` +
    `</svg>\n`;
  writeFileSync(OUT_SVG, svg, "utf8");

  centroids.sort((a, b) => a.id.localeCompare(b.id));
  const centroidsTs =
    `// WYGENEROWANE PRZEZ scripts/generate-dotted-world.ts - nie edytować ręcznie.\n` +
    `//\n` +
    `// Centroidy krajów (ISO 3166-1 alpha-2 -> lat/lng) policzone z największego\n` +
    `// pierścienia geometrii w public/geo/world-110m.v1.json. Służą WYŁĄCZNIE\n` +
    `// panelowi widgetu „Mapa świata": autor wybiera kraj, panel wpisuje\n` +
    `// współrzędne punktu. Renderer publiczny czyta już tylko lat/lng z treści,\n` +
    `// więc ta tabela nigdy nie trafia do bundla strony.\n` +
    `export interface CountryCentroid {\n` +
    `  /** ISO 3166-1 alpha-2. */\n` +
    `  id: string;\n` +
    `  /** Angielska nazwa kraju (etykieta zapasowa w pickerze). */\n` +
    `  en: string;\n` +
    `  lat: number;\n` +
    `  lng: number;\n` +
    `}\n\n` +
    `export const COUNTRY_CENTROIDS: ReadonlyArray<CountryCentroid> = [\n` +
    centroids
      .map(
        (c) =>
          `  { id: ${JSON.stringify(c.id)}, en: ${JSON.stringify(c.en)}, lat: ${c.lat}, lng: ${c.lng} },`,
      )
      .join("\n") +
    `\n];\n`;
  writeFileSync(OUT_CENTROIDS, centroidsTs, "utf8");

  const kb = (Buffer.byteLength(svg) / 1024).toFixed(1);
  process.stdout.write(
    `Wygenerowano:\n` +
      `  ${OUT_SVG}         ${kb} KB (${dots.length} kropek, siatka ${COLS}x${ROWS} diagonal)\n` +
      `  ${OUT_CENTROIDS}   ${centroids.length} krajów\n`,
  );
}

main();
