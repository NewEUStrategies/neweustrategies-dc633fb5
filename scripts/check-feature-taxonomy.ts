// Bramka taksonomii: pilnuje, żeby tabela funkcjonalności dała się przeliczyć.
//
// TRZY NIEZMIENNIKI, KAŻDY Z WŁASNEJ AWARII:
//
//  1. ŻADEN PLIK MODUŁU NIE WISI POZA FUNKCJONALNOŚCIĄ. Do wydania 8 sześć tras
//     panelu społeczności (Q&A, ankiety, pulpit, odznaki, kontrybutorzy,
//     zaangażowanie) - razem 344 linie i 189 funkcji na zerze - nie należało
//     do żadnego z jedenastu wierszy modułu 16. Tabela pokazywała wtedy 89,12%
//     modułu i milczała o największym zerze, jakie w nim stało.
//
//  2. ŻADNA REGUŁA NIE JEST MARTWA. Rozdział 9.1 audytu przypisuje modułowi 22
//     pięć wzorców wycinających pliki wydarzeń z katalogów społeczności.
//     Wszystkie pięć było martwych, bo moduł 16 dopadał te pliki dziesięć
//     wierszy wcześniej. Reguła, która nigdy nie trafia, to nie reguła -
//     to komentarz udający regułę.
//
//  3. ŻADNA FUNKCJONALNOŚĆ NIE JEST PUSTA. Wiersz „Społeczność: odznaki,
//     zaangażowanie, Q&A, ankiety" nosił w nazwie Q&A i nie miał ani jednego
//     pliku Q&A. Nazwa wiersza jest obietnicą wobec czytelnika tabeli.
import { execFileSync } from "node:child_process";
import { classifyPath, CARVE_OUTS, MODULES } from "./taxonomy/moduleMap.mjs";
import { FEATURES, featureForPath } from "./taxonomy/features.mjs";

/** Pliki produkcyjne, dokładnie w zakresie pomiaru z `vitest.config.ts`. */
function productionFiles(): string[] {
  const listed = execFileSync("git", ["ls-files", "src/**/*.ts", "src/**/*.tsx"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  return listed.filter(
    (file) =>
      !file.includes("/__tests__/") &&
      !/\.(test|spec)\.tsx?$/.test(file) &&
      !file.startsWith("src/test/") &&
      file !== "src/routeTree.gen.ts" &&
      file !== "src/integrations/supabase/types.ts" &&
      file !== "src/lib/icons/lucideIconNodes.generated.ts" &&
      !file.endsWith("widget-view/lazyWidgets.tsx"),
  );
}

const files = productionFiles();
const problems: string[] = [];

// 1. Każdy plik modułu z taksonomią trafia do dokładnie jednej funkcjonalności.
const orphans = files.filter((file) => {
  const { module } = classifyPath(file);
  return module !== null && FEATURES.has(module) && featureForPath(file) === null;
});
if (orphans.length > 0) {
  problems.push(
    `Pliki poza taksonomią funkcjonalności (${orphans.length}):\n${orphans.map((f) => `  ${f}`).join("\n")}`,
  );
}

// 2. Żadna reguła nie jest martwa - ani wyjątek, ani wzorzec funkcjonalności.
const deadCarveOuts = CARVE_OUTS.filter((carve) => !files.some((f) => carve.pattern.test(f)));
if (deadCarveOuts.length > 0) {
  problems.push(
    `Martwe wyjątki mapy modułów (${deadCarveOuts.length}):\n${deadCarveOuts
      .map((c) => `  ${String(c.pattern)} -> moduł ${c.module}`)
      .join("\n")}`,
  );
}
for (const [moduleId, rows] of FEATURES) {
  for (const row of rows) {
    const dead = row.patterns.filter(
      (pattern) => !files.some((f) => classifyPath(f).module === moduleId && pattern.test(f)),
    );
    if (dead.length > 0) {
      problems.push(
        `Martwe wzorce funkcjonalności „${row.name}":\n${dead.map((p) => `  ${String(p)}`).join("\n")}`,
      );
    }
  }
}

// 3. Żadna funkcjonalność nie jest pusta.
for (const [moduleId, rows] of FEATURES) {
  const inModule = files.filter((f) => classifyPath(f).module === moduleId);
  for (const row of rows) {
    const count = inModule.filter((f) => featureForPath(f) === row.key).length;
    if (count === 0) problems.push(`Funkcjonalność bez ani jednego pliku: „${row.name}"`);
  }
}

// 4. Każdy moduł mapy ma co najmniej jeden plik - inaczej mapa opisuje repo,
//    którego już nie ma.
for (const mod of MODULES) {
  if (!files.some((f) => classifyPath(f).module === mod.id)) {
    problems.push(`Moduł bez ani jednego pliku: ${mod.id} - ${mod.name}`);
  }
}

if (problems.length > 0) {
  console.error("check:feature-taxonomy - BŁĄD\n");
  console.error(problems.join("\n\n"));
  process.exit(1);
}

const covered = files.filter((f) => classifyPath(f).module !== null).length;
console.log(
  `check:feature-taxonomy - OK: ${files.length} plików produkcyjnych, ${covered} w modułach, ` +
    `${[...FEATURES.values()].flat().length} funkcjonalności bez sieroty i bez martwej reguły.`,
);
