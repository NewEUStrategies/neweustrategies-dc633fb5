// @vitest-environment node
//
// GRANICE WARSTW TAKSONOMII (audyt ED14, „graf zależności i kontrakty").
//
// JAKIE RYZYKO PILNUJE TEN PLIK.
//   1. Jądro platformy ukryte w domenach: `useAuth.tsx` (moduł 15),
//      `useSiteSetting.ts` (19), `seo/{meta,head,request}.ts` (8) … importowane
//      z 10-22 obszarów, a przypisane jednemu „właścicielowi modułu". Lista
//      jądra jest w `PLATFORM_CORE` (scripts/taxonomy/moduleMap.mjs); plik
//      domenowy, który przekroczy próg, a nie jest na liście, oblewa test.
//   2. Moduł 20 łączył trasy (kompozycja - wolno im znać domeny) z rdzeniem
//      platformy; 77% importów „platformy" do domen pochodziło z tras. Po
//      rozdziale: warstwy kompozycji (23) nie importuje nic spoza niej,
//      a importy rdzenia (20) do domen nie mogą rosnąć (sufit = pomiar
//      2026-10-26; wolno go wyłącznie obniżać).
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PLATFORM_CORE,
  PLATFORM_CORE_MIN_IMPORTING_AREAS,
  PLATFORM_LAYERS,
  classifyPath,
} from "../../../../scripts/taxonomy/moduleMap.mjs";
import { type ImportEdge, buildImportGraph } from "../moduleImportGraph";

/**
 * Importy wartości (statyczne) z rdzenia (moduł 20) do modułów domenowych.
 * Pomiar 2026-10-26 po rozdziale 20C/20R. Wzorce naprawy z audytu:
 * `lib/queries/*` -> `content/sponsored` (zapytania do modułu 3),
 * `robotsRequest.server.ts` -> `seo/robots` (przenieść do `lib/seo` albo
 * odwrócić rejestrem). ZAPADKA: po każdej naprawie obniż do nowej wartości.
 */
const CORE_TO_DOMAIN_CEILING = 114;

// Także moduły JavaScript (`lib/icons/iconChunkIndex.js`) - inaczej ich krawędzie
// znikają z grafu po cichu.
const PRODUCTION_SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const NOT_PRODUCTION = /(^|\/)(__tests__|test)\/|\.(test|spec|stories)\.|\.d\.ts$/;

function productionFiles(): string[] {
  return (readdirSync("src", { recursive: true }) as string[])
    .map((entry) => `src/${entry.split("\\").join("/")}`)
    .filter((path) => PRODUCTION_SOURCE.test(path) && !NOT_PRODUCTION.test(path))
    .sort();
}

function areaOf(path: string): string {
  const { module, crossCutting } = classifyPath(path);
  if (module !== null) return String(module);
  return crossCutting === null ? "NULL" : `X-${crossCutting}`;
}

const isDomain = (area: string): boolean =>
  /^\d+$/.test(area) &&
  Number(area) !== PLATFORM_LAYERS.core &&
  Number(area) !== PLATFORM_LAYERS.composition;

describe("taksonomia: jądro platformy i warstwa kompozycji", () => {
  const files = productionFiles();
  const edges: ImportEdge[] = buildImportGraph(files, (path) => readFileSync(path, "utf8"));
  const staticEdges = edges.filter((edge) => !edge.dynamic);
  const describeEdge = (edge: ImportEdge): string =>
    `${edge.from} [${areaOf(edge.from)}] -> ${edge.to} [${areaOf(edge.to)}]`;

  it("graf obejmuje kod produkcyjny (bez testów)", () => {
    expect(files.length).toBeGreaterThan(3000);
    expect(files.some((path) => NOT_PRODUCTION.test(path))).toBe(false);
    expect(staticEdges.length).toBeGreaterThan(10_000);
  });

  it("każdy wzorzec PLATFORM_CORE trafia dokładnie w jeden istniejący plik", () => {
    for (const pattern of PLATFORM_CORE) {
      const hits = files.filter((path) => pattern.test(path));
      expect(hits.length, `martwy albo za szeroki wzorzec ${pattern}`).toBeGreaterThan(0);
      expect(hits.length, `${pattern}: ${hits.join(", ")}`).toBeLessThanOrEqual(3);
      for (const hit of hits) expect(classifyPath(hit).module).toBe(PLATFORM_LAYERS.core);
    }
  });

  it(`żaden plik domenowy nie jest importowany z ≥ ${PLATFORM_CORE_MIN_IMPORTING_AREAS} innych obszarów (jądro ukryte w domenie)`, () => {
    const importers = new Map<string, Set<string>>();
    for (const edge of staticEdges) {
      const target = areaOf(edge.to);
      const source = areaOf(edge.from);
      if (!isDomain(target) || source === target) continue;
      if (!importers.has(edge.to)) importers.set(edge.to, new Set());
      importers.get(edge.to)!.add(source);
    }
    const hidden = [...importers.entries()]
      .filter(([, areas]) => areas.size >= PLATFORM_CORE_MIN_IMPORTING_AREAS)
      .map(
        ([path, areas]) =>
          `${path} [moduł ${areaOf(path)}] <- ${areas.size} obszarów (${[...areas].sort().join(", ")}) - dopisz do PLATFORM_CORE w scripts/taxonomy/moduleMap.mjs`,
      );
    expect(hidden).toEqual([]);
  });

  it("warstwy kompozycji (trasy, router, start) nie importuje nic spoza niej - także leniwie", () => {
    const composition = String(PLATFORM_LAYERS.composition);
    const upward = edges
      .filter((edge) => areaOf(edge.to) === composition && areaOf(edge.from) !== composition)
      .map(describeEdge);
    expect(upward).toEqual([]);
  });

  it(`rdzeń platformy (moduł ${PLATFORM_LAYERS.core}) nie zyskuje importów modułów domenowych (sufit ${CORE_TO_DOMAIN_CEILING})`, () => {
    const core = String(PLATFORM_LAYERS.core);
    const inversions = staticEdges.filter(
      (edge) => areaOf(edge.from) === core && isDomain(areaOf(edge.to)),
    );
    expect(
      inversions.length,
      `rdzeń -> domeny: ${inversions.length} (sufit ${CORE_TO_DOMAIN_CEILING}). Nowy import domeny w rdzeniu odwraca kierunek zależności - przenieś kod do domeny albo odwróć zależność rejestrem.\n${inversions.map(describeEdge).join("\n")}`,
    ).toBeLessThanOrEqual(CORE_TO_DOMAIN_CEILING);
  });
});
