// BRAMKA: OBRYS WSKAZANIA I FOKUSU NA MAPIE WIDAĆ NA KAŻDEJ KLASIE.
//
// PO CO. Obrys aktywnego kraju był dotąd JEDNYM kolorem: tusz pierwszego
// planu przy wskazaniu, akcent przy fokusie. Każdy jeden kolor ginie na części
// rampy - akcent #fa9346 miał 1,02:1 na środku jasnej rampy niebieskiej, tusz
// 1,53:1 na jej ciemnym końcu - więc kraj o NAJWYŻSZEJ wartości, czyli ten,
// o który czytelnik pyta najczęściej, dostawał wyróżnienie, którego nie widać.
//
// REGUŁA. Obrys jest DWUTONOWY: halo w kolorze karty pod tuszem pierwszego
// planu (`map.css`). Dla każdego koloru, którym mapa może pomalować kraj -
// każdej rampy, w obu motywach i w druku, przy każdym całkowitym udziale
// 0..100 (klasy i skala ciągła mieszają kotwice zawsze w całych procentach),
// plus tło i kreskowanie „brak danych" - co najmniej jeden z dwóch tonów ma
// >= 3:1 (próg WCAG 1.4.11 dla obiektu graficznego). Tusz i halo między sobą
// też muszą mieć >= 3:1, bo to ich para rysuje pierścień na jasnej klasie.
//
// Geometria obrysu jest jedna dla obu motywów (AGENTS.md: motyw zmienia
// wyłącznie kolory) - bramka sprawdza też, że `map.css` nie ma reguł
// zależnych od motywu i że grubości są w pikselach ekranu.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  colorMixOklab,
  contrastRatio,
  fromOklch,
  MAP_NEUTRALS,
  MAP_RAMPS,
  type ChartThemeName,
} from "@/lib/charts/palette";
import { MAP_SCHEMES } from "@/lib/charts/types";

const STYLES = readFileSync("src/styles.css", "utf8");
const CHARTS = readFileSync("src/components/charts/charts.css", "utf8");
const MAP_CSS = readFileSync("src/components/charts/map.css", "utf8");

const BLOKI: Record<ChartThemeName | "print", string> = {
  light: STYLES.slice(STYLES.indexOf(":root,"), STYLES.indexOf(".dark {")),
  dark: STYLES.slice(STYLES.indexOf(".dark {"), STYLES.indexOf("@layer base")),
  print: CHARTS.slice(CHARTS.indexOf("@media print {")),
};

/** Wartość tokenu jako hex - arkusz zapisuje część tokenów w `oklch(...)`. */
function tokenHex(block: string, name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
  if (!m) throw new Error(`test: brak tokenu ${name}`);
  const raw = m[1].trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  const ok = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(raw);
  if (ok) return fromOklch(Number(ok[1]), Number(ok[2]), Number(ok[3]));
  throw new Error(`test: nieczytelny token ${name}: ${raw}`);
}

/** Każdy kolor, którym mapa może pomalować kraj w danym motywie rampy. */
function koloryMapy(ramp: ChartThemeName): string[] {
  const out: string[] = [MAP_NEUTRALS[ramp].nodata, MAP_NEUTRALS[ramp].nodataHatch];
  for (const scheme of MAP_SCHEMES) {
    const k = MAP_RAMPS[scheme][ramp];
    for (let pct = 0; pct <= 100; pct += 1) {
      if (scheme === "diverging") {
        const mid = "mid" in k && k.mid !== undefined ? k.mid : k.min;
        out.push(colorMixOklab(k.min, pct, mid), colorMixOklab(k.max, pct, mid));
      } else {
        out.push(colorMixOklab(k.max, pct, k.min));
      }
    }
  }
  return out;
}

const PRZYPADKI: ReadonlyArray<{
  nazwa: string;
  blok: "light" | "dark" | "print";
  ramp: ChartThemeName;
}> = [
  { nazwa: "jasny", blok: "light", ramp: "light" },
  { nazwa: "ciemny", blok: "dark", ramp: "dark" },
  // Druk maluje jasnymi tokenami (blok `@media print` w charts.css).
  { nazwa: "druk", blok: "print", ramp: "light" },
];

describe("obrys dwutonowy mapy - kontrast z każdą klasą", () => {
  it.each(PRZYPADKI)(
    "$nazwa: tusz albo halo ma >= 3:1 do każdego koloru kraju",
    ({ blok, ramp }) => {
      const halo = tokenHex(BLOKI[blok], "--card");
      const tusz = tokenHex(BLOKI[blok], "--foreground");
      const slabe: string[] = [];
      for (const kolor of koloryMapy(ramp)) {
        const lepszy = Math.max(contrastRatio(halo, kolor), contrastRatio(tusz, kolor));
        if (lepszy < 3) slabe.push(`${kolor} (${lepszy.toFixed(2)}:1)`);
      }
      expect(slabe, "kolory, na których obrys aktywnego kraju nie ma 3:1").toEqual([]);
    },
  );

  it.each(PRZYPADKI)("$nazwa: tusz i halo rysują pierścień (>= 3:1 między sobą)", ({ blok }) => {
    const halo = tokenHex(BLOKI[blok], "--card");
    const tusz = tokenHex(BLOKI[blok], "--foreground");
    expect(contrastRatio(halo, tusz)).toBeGreaterThanOrEqual(3);
  });

  it("bramka sama nie jest ślepa: jeden ton (akcent) oblewa na środku rampy", () => {
    // Kontrola negatywna: dawny obrys fokusu w kolorze akcentu ginie na
    // jasnej rampie - gdyby pętla wyżej niczego nie liczyła, to też by
    // przeszło.
    const akcent = "#fa9346";
    const najgorszy = Math.min(...koloryMapy("light").map((k) => contrastRatio(akcent, k)));
    expect(najgorszy).toBeLessThan(3);
  });
});

describe("geometria obrysu - ta sama w obu motywach, w pikselach ekranu", () => {
  /** Ciało reguły CSS po selektorze (pierwsze wystąpienie). */
  function regula(selektor: string): string {
    const start = MAP_CSS.indexOf(`${selektor} {`);
    if (start < 0) throw new Error(`test: brak reguły ${selektor}`);
    return MAP_CSS.slice(start, MAP_CSS.indexOf("}", start));
  }

  it("halo w kolorze karty pod tuszem pierwszego planu, oba bez skalowania", () => {
    expect(regula(".neh-map-outline-halo")).toMatch(/stroke:\s*var\(--card\);/);
    expect(regula(".neh-map-outline-ink")).toMatch(/stroke:\s*var\(--foreground\);/);
    expect(regula(".neh-map-outline path")).toMatch(/vector-effect:\s*non-scaling-stroke;/);
    const halo = Number(/stroke-width:\s*([\d.]+)px/.exec(regula(".neh-map-outline-halo"))?.[1]);
    const tusz = Number(/stroke-width:\s*([\d.]+)px/.exec(regula(".neh-map-outline-ink"))?.[1]);
    // Halo wystaje spod tuszu po obu stronach - inaczej nie ma dwóch tonów.
    expect(tusz).toBeGreaterThanOrEqual(2);
    expect(halo - tusz).toBeGreaterThanOrEqual(2);
  });

  it("arkusz mapy nie ma reguł zależnych od motywu ani od palety barw", () => {
    const bezKomentarzy = MAP_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(bezKomentarzy).not.toMatch(/\.dark\b|\.light\b|prefers-color-scheme/);
    // Kolory wyłącznie z tokenów - żadnego hexa w regułach mapy.
    expect(bezKomentarzy).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
