// WYGLĄD OPUBLIKOWANY MAPY - bramka znak w znak.
//
// PO CO. PR2 dał mapie schematy barw, klasy i model skali (`kinds/mapScale.ts`).
// Mapy opublikowane przed tą zmianą nie mają w treści kluczy `scheme`
// ani `classes`, parser daje im `blue` i skalę ciągłą - i one NIE MOGĄ
// zmienić ani jednego odcienia. Tokeny `--chart-map-blue-*` mają te same hexy
// co `--chart-seq-*`, ale „ten sam kolor innym napisem" to wciąż zmiana
// opublikowanej treści (inny styl w HTML, inna podatność na przyszłą zmianę
// jednego z tokenów), więc bramka porównuje NAPISY, a nie kolory.
//
// JAK. Niżej stoi wzór mapy sprzed modelu, przepisany z kodu sprzed PR2 bez
// zmian (`0.15 + 0.85 * t`, `Math.round`, interpolacja hex w sRGB z pary
// SEQ_RAMP motywu). Dla każdej próbki danych i każdego zapisu „klucze
// nieobecne" porównujemy styl i atrybut `fill` KAŻDEJ ścieżki z danymi.
// Wszystkie identyfikatory próbek są w zasobie, bo reguła domeny z krajów
// narysowanych (PR2) jest celową zmianą tylko dla kodów spoza mapy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { GeoAsset } from "@/lib/charts/types";
import type { Json } from "@/lib/content-model/json";
import { parseDataMapConfig } from "@/lib/charts/parse";
import { SEQ_RAMP } from "@/lib/charts/palette";

const h = vi.hoisted(() => ({ geo: null as unknown }));

vi.mock("@/lib/charts/geoQuery", () => ({
  geoAssetQueryOptions: (region: string) => ({
    queryKey: ["geo", region],
    queryFn: () => h.geo ?? new Promise(() => {}),
  }),
}));

const { ChoroplethMap } = await import("../ChoroplethMap");

/** Wzór mapy sprzed modelu skali - KOPIA, nie import (patrz nagłówek). */
function staryHexLerp(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const mix = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function staraFarba(
  values: ReadonlyArray<{ id: string; value: number }>,
  theme: "light" | "dark",
): Map<string, { style: string; fill: string }> {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v.value < min) min = v.value;
    if (v.value > max) max = v.value;
  }
  const span = max - min;
  const out = new Map<string, { style: string; fill: string }>();
  for (const v of values) {
    const share = 0.15 + 0.85 * (span > 0 ? (v.value - min) / span : 0);
    const pct = Math.round(share * 100);
    out.set(v.id, {
      style: `fill: color-mix(in oklab, var(--chart-seq-max) ${pct}%, var(--chart-seq-min));`,
      fill: staryHexLerp(SEQ_RAMP[theme].min, SEQ_RAMP[theme].max, share),
    });
  }
  return out;
}

/** Dwuliterowe identyfikatory „AA".."AZ" - zasób i dane mówią tymi samymi kodami. */
const KODY = Array.from({ length: 26 }, (_, i) => `A${String.fromCharCode(65 + i)}`);

function zasob(ids: readonly string[]): GeoAsset {
  return {
    v: 1,
    license: "test",
    viewBox: "0 0 960 825",
    countries: ids.map((id, i) => ({ id, pl: id, en: id, d: `M${i} ${i}h1v1z` })),
  };
}

const PROBKI: Record<string, Array<{ id: string; value: number }>> = {
  "całe liczby z zerem": [
    { id: "AA", value: 0 },
    { id: "AB", value: 100 },
    { id: "AC", value: 50 },
    { id: "AD", value: 33.3 },
  ],
  ułamki: [
    { id: "AA", value: 1.234 },
    { id: "AB", value: 7.89 },
    { id: "AC", value: 3.3333 },
    { id: "AD", value: 5.5 },
  ],
  ujemne: [
    { id: "AA", value: -12 },
    { id: "AB", value: 4 },
    { id: "AC", value: -3.5 },
    { id: "AD", value: 0 },
  ],
  "jeden region": [{ id: "AA", value: 42 }],
  "wartości równe": [
    { id: "AA", value: 5 },
    { id: "AB", value: 5 },
  ],
  // 26 krajów co 4 - procenty na granicach połówki (0,5749999... -> 57).
  "pełna podziałka": KODY.map((id, i) => ({ id, value: i * 4 })),
};

/** Zapisy „mapa sprzed wyboru schematu" - każdy musi dać wygląd opublikowany. */
const ZAPISY: Record<string, Record<string, Json>> = {
  "klucze nieobecne": {},
  "blue + classes 0": { scheme: "blue", classes: 0 },
  "sam blue": { scheme: "blue" },
  "same classes 0": { classes: 0 },
};

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function sciezki(data: Record<string, Json>): Promise<SVGPathElement[]> {
  const view = render(
    <Wrapper>
      <ChoroplethMap config={parseDataMapConfig(data)} lang="pl" />
    </Wrapper>,
  );
  await waitFor(() => expect(view.container.querySelector("svg.block")).not.toBeNull());
  return [...view.container.querySelectorAll<SVGPathElement>("g.neh-map-countries > path")].filter(
    (p) => p.hasAttribute("tabindex"),
  );
}

beforeEach(() => {
  h.geo = zasob(KODY);
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

describe("mapa bez schematu i klas maluje DOKŁADNIE jak przed modelem skali", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const [zapis, klucze] of Object.entries(ZAPISY)) {
      for (const [nazwa, values] of Object.entries(PROBKI)) {
        it(`${theme} / ${zapis} / ${nazwa}`, async () => {
          if (theme === "dark") document.documentElement.classList.add("dark");
          const paths = await sciezki({ region: "europe", ...klucze, values });
          const oczekiwane = staraFarba(values, theme);
          expect(paths).toHaveLength(values.length);
          for (const p of paths) {
            const id = (p.getAttribute("aria-label") ?? "").split(":")[0];
            const stara = oczekiwane.get(id);
            expect(stara, id).toBeDefined();
            expect(p.getAttribute("style"), `${id}: styl`).toBe(stara?.style);
            expect(p.getAttribute("fill"), `${id}: fill`).toBe(stara?.fill);
          }
        });
      }
    }
  }
});

describe("wygląd opublikowany NIE przecieka na nowe mapy", () => {
  it("klasy w schemacie niebieskim malują tokenami --chart-map-blue-*, nie dawnym wzorem", async () => {
    const paths = await sciezki({
      region: "europe",
      scheme: "blue",
      classes: 5,
      values: PROBKI["pełna podziałka"],
    });
    for (const p of paths) {
      const style = p.getAttribute("style") ?? "";
      expect(style).toContain("--chart-map-blue-");
      expect(style).not.toContain("--chart-seq-");
    }
  });

  it("inny schemat w skali ciągłej też idzie przez model (tokeny schematu)", async () => {
    const paths = await sciezki({
      region: "europe",
      scheme: "slate",
      values: PROBKI["całe liczby z zerem"],
    });
    for (const p of paths) expect(p.getAttribute("style")).toContain("--chart-map-slate-");
  });
});
