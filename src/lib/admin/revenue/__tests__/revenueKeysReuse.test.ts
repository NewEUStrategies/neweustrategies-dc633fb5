// BRAMKA: komponenty huba i ścieżek NIE pobierają danych same - wyłącznie
// przez fabryki producentów (`*QueryOptions`, `revenueKeys`, `journeyKeys`).
//
// PO CO. Hub czyta te same agregaty co pulpit, BI i moduły (AD-19: jedna
// funkcja serwerowa `getRevenueSnapshot` dla trzech ekranów). Komponent
// z własnym `queryFn` albo kluczem zapisanym literałem to druga kopia
// zapytania: inny klucz = inny wpis cache = podwójne pobranie, a reguła szyny
// zdarzeń unieważnia prefiks fabryki, więc kopia przestaje się odświeżać na
// żywo - bez błędu, do pierwszego przeładowania. `queryKeyLiterals.gate` łapie
// literały RÓWNE prefiksom fabryk w całym repo; ta bramka jest ostrzejsza
// i węższa: w `components/admin/{revenue,journeys}/**` nie ma ŻADNEGO
// `queryFn` ani literału tablicy klucza.
//
// KOMENTARZE SĄ MASKOWANE (`bezKomentarzy`): nagłówki plików huba cytują
// zakazane wzorce, żeby wyjaśnić, czego unikają.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { bezKomentarzy } from "@/lib/ci/sourceScan";

const ROOTS = ["src/components/admin/revenue", "src/components/admin/journeys"] as const;

/** Pliki źródłowe (bez testów) pod katalogiem - rekurencyjnie, posortowane. */
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__") continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  rule: string;
}

/**
 * Wzorce zakazane w komponentach huba:
 *  - `queryFn` - własne pobranie danych zamiast `*QueryOptions` producenta;
 *  - `queryKey: [` - klucz zapisany literałem tablicy;
 *  - `["admin-revenue"` / `["admin", "journeys"` - literał prefiksu fabryki gdziekolwiek
 *    (np. w `invalidateQueries`), także w napisie szablonowym.
 */
const RULES: readonly { rule: string; pattern: RegExp }[] = [
  { rule: "queryFn", pattern: /\bqueryFn\b/g },
  { rule: "queryKey-literal", pattern: /\bqueryKey\s*:\s*\[/g },
  { rule: "revenue-key-literal", pattern: /\[\s*["'`]admin-revenue["'`]/g },
  // `journeyKeys.root()` to `["admin", "journeys"]` - prefiks dwuelementowy.
  { rule: "journey-key-literal", pattern: /\[\s*["'`]admin["'`]\s*,\s*["'`]journeys["'`]/g },
];

function violationsIn(file: string, source: string): Violation[] {
  const code = bezKomentarzy(source);
  const out: Violation[] = [];
  for (const { rule, pattern } of RULES) {
    for (const match of code.matchAll(pattern)) {
      const line = code.slice(0, match.index).split("\n").length;
      out.push({ file, line, rule });
    }
  }
  return out;
}

describe("komponenty huba i ścieżek czytają dane wyłącznie przez fabryki producentów", () => {
  const files = ROOTS.flatMap(sourceFiles);

  it("skan widzi pliki huba (pusty skan byłby cicho zielony)", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain("src/components/admin/revenue/organisms/RevenueHubLayout.tsx");
  });

  it("zero `queryFn` i zero literałów kluczy React Query", () => {
    const found = files.flatMap((file) => violationsIn(file, readFileSync(file, "utf8")));
    expect(found).toEqual([]);
  });

  it("reguły łapią każdy zakazany wzorzec, a komentarz z cytatem nie jest naruszeniem", () => {
    const planted = [
      "const a = useQuery({ queryKey: ['admin-revenue', 'x'], queryFn: load });",
      'qc.invalidateQueries({ queryKey: ["admin", "journeys", id] });',
      "const k = [`admin-revenue`, tenant];",
      "// queryFn w komentarzu nie jest kodem: queryKey: ['admin-revenue']",
    ].join("\n");
    const rules = violationsIn("fixture.tsx", planted).map((v) => `${v.rule}@${v.line}`);
    expect(rules.sort()).toEqual(
      [
        "queryFn@1",
        "queryKey-literal@1",
        "revenue-key-literal@1",
        "queryKey-literal@2",
        "journey-key-literal@2",
        "revenue-key-literal@3",
      ].sort(),
    );
  });

  it("fabryki są wołane, nie przepisywane: układ huba unieważnia przez revenueKeys", () => {
    const layout = bezKomentarzy(
      readFileSync("src/components/admin/revenue/organisms/RevenueHubLayout.tsx", "utf8"),
    );
    expect(layout).toContain("revenueKeys.root()");
    expect(layout).toContain("revenueKeys.domainTenant(");
  });
});
