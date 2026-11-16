// @vitest-environment node
//
// Moduły chunku startowego nie sięgają do liści panelu (roadmapa ładowania
// §9.1 J3).
//
// Moduł importowany statycznie przez kod bootu trafia do `app-initial`
// W CAŁOŚCI - razem z eksportami, których używa wyłącznie panel. Dlatego kod
// panelu tych modułów mieszka w osobnych liściach (importuje je tylko panel),
// a ten test pilnuje, żeby moduł bootu nie dosięgnął liścia statycznym
// importem: wprost, reeksportem ani przez pośrednika. Jedna taka krawędź
// wciąga liść z powrotem do chunku startowego każdej strony, a `check:bundle`
// zauważy to dopiero, gdy wzrost przekroczy próg.
//
// Granica testu: graf źródeł, nie artefakt. Że moduł bootu naprawdę jest w
// `app-initial` (i liść nie), mierzy build (`check:bundle`, `chunk-inventory`).
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildImportGraph } from "../moduleImportGraph";

/** Moduł bootu -> pliki, których jego statyczne domknięcie nie może zawierać. */
const BOOT_MODULE_LEAVES: ReadonlyArray<readonly [string, readonly string[]]> = [
  // `robots.ts` też: builder robots.txt wołają tylko trasy serwerowe i podgląd panelu.
  ["src/lib/seo/settings.ts", ["src/lib/seo/crawlerPolicy.ts", "src/lib/seo/robots.ts"]],
  ["src/lib/builder/globalWidgets.ts", ["src/lib/builder/globalWidgetsAdmin.ts"]],
  ["src/lib/builder/experiments.ts", ["src/lib/builder/experimentsAdmin.ts"]],
  ["src/lib/builder/themed.ts", ["src/lib/builder/themedWrites.ts"]],
  ["src/lib/builder/dynamicText.ts", ["src/lib/builder/dynamicTagCatalog.ts"]],
  ["src/lib/ads/types.ts", ["src/lib/ads/adminFields.ts"]],
  ["src/lib/theme/customFonts.ts", ["src/lib/theme/customFontUpload.ts"]],
  ["src/lib/builder/liveTypography.ts", ["src/lib/builder/liveTypographyBroadcast.ts"]],
  ["src/hooks/usePostLayoutSettings.ts", ["src/hooks/usePostLayoutSettingsAdmin.ts"]],
  ["src/hooks/useFontScale.ts", ["src/hooks/useFontScaleAdmin.ts"]],
  ["src/lib/cropSizes.ts", ["src/lib/cropSizesAdmin.ts"]],
  ["src/lib/admin/impersonation.ts", ["src/lib/admin/impersonationStart.ts"]],
];

const PRODUCTION_SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const NOT_PRODUCTION = /(^|\/)(__tests__|test)\/|\.(test|spec|stories)\.|\.d\.ts$/;

function productionFiles(): string[] {
  return (readdirSync("src", { recursive: true }) as string[])
    .map((entry) => `src/${entry.split("\\").join("/")}`)
    .filter((path) => PRODUCTION_SOURCE.test(path) && !NOT_PRODUCTION.test(path))
    .sort();
}

describe("chunk startowy: moduły bootu nie sięgają do liści panelu", () => {
  const files = productionFiles();
  const known = new Set(files);
  const next = new Map<string, string[]>();
  for (const edge of buildImportGraph(files, (path) => readFileSync(path, "utf8"))) {
    if (edge.dynamic) continue;
    const list = next.get(edge.from) ?? [];
    list.push(edge.to);
    next.set(edge.from, list);
  }

  /** Statyczne domknięcie z pierwszą znalezioną ścieżką do każdego pliku. */
  function staticClosure(root: string): Map<string, string[]> {
    const paths = new Map<string, string[]>([[root, [root]]]);
    const queue = [root];
    while (queue.length > 0) {
      const from = queue.shift() as string;
      for (const to of next.get(from) ?? []) {
        if (paths.has(to)) continue;
        paths.set(to, [...(paths.get(from) as string[]), to]);
        queue.push(to);
      }
    }
    return paths;
  }

  it("każdy moduł i liść z listy istnieje (przemianowanie nie wyłącza strażnika po cichu)", () => {
    const listed = BOOT_MODULE_LEAVES.flatMap(([boot, leaves]) => [boot, ...leaves]);
    expect(listed.filter((path) => !known.has(path))).toEqual([]);
  });

  it.each(BOOT_MODULE_LEAVES)("%s nie importuje statycznie liści panelu", (boot, leaves) => {
    const closure = staticClosure(boot);
    const reached = leaves
      .filter((leaf) => closure.has(leaf))
      .map((leaf) => (closure.get(leaf) as string[]).join(" -> "));
    expect(reached).toEqual([]);
  });
});
