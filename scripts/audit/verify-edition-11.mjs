/**
 * Weryfikacja liczb wydania 11 audytu wobec ZYWEGO repozytorium.
 *
 * PO CO TO ISTNIEJE. Rozdzialy 15.14-15.16 dokumentu audytu twierdza rzeczy o stanie repozytorium:
 * ile jest progow pokrycia i ile z nich jest martwych, ile modulow `src/lib/ci` nie ma konsumenta,
 * ile jest konfiguracji Playwrighta i testow e2e, ile wierszy ma kod produkcyjny, co lezy poza
 * taksonomia. Kazde z tych twierdzen starzeje sie po pierwszym PR-ze, ktory tego dotknie - i wtedy
 * dokument zaczyna klamac, a nikt tego nie zauwaza.
 *
 * Ten skrypt wyprowadza kazda z tych liczb NIEZALEZNIE z drzewa plikow i porownuje z tym, co stoi
 * w dokumencie i w `README.md`. Nie czyta zadnych plikow posrednich ani wynikow agentow - dziala
 * na czystym klonie.
 *
 * URUCHOMIENIE:  node scripts/audit/verify-edition-11.mjs
 * Kod wyjscia 1, gdy ktorakolwiek asercja jest czerwona.
 *
 * UWAGA NA PRZYSZLOSC (zapisana w rozdz. 15.16.1 jako blad procesu): pierwsza wersja weryfikatora
 * wydania 11 asertowala liczby SPRZED korekt i przez kilka godzin przy zielonym przebiegu utrwalalaby
 * stan juz nieprawdziwy. Korekta liczby w dokumencie i korekta jej asercji tutaj ida JEDNYM ruchem.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOC = `${ROOT}/docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`;
const README = `${ROOT}/README.md`;

const sh = (cmd) => {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }).trim();
  } catch (error) {
    return String(error.stdout ?? "").trim();
  }
};
/** Normalizacja do porownan tekstowych: prettier wyrownuje tabele spacjami, a pogrubienia sa nieistotne. */
const norm = (s) => String(s).replace(/ /g, " ").replace(/\*/g, "").replace(/\s+/g, " ");
const walk = (dir, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    entry.isDirectory() ? walk(full, acc) : acc.push(full);
  }
  return acc;
};

const doc = norm(fs.readFileSync(DOC, "utf8"));
const readme = norm(fs.readFileSync(README, "utf8"));
let zielone = 0;
const czerwone = [];
const assert = (warunek, opis) => (warunek ? zielone++ : czerwone.push(opis));
const wDokumencie = (fragment) =>
  assert(doc.includes(norm(fragment)), `dokument nie zawiera: ${fragment}`);
const wReadme = (fragment) =>
  assert(readme.includes(norm(fragment)), `README nie zawiera: ${fragment}`);

const wszystkieZrodla = walk(`${ROOT}/src`).map((p) => p.replace(`${ROOT}/`, ""));
const produkcyjne = wszystkieZrodla.filter(
  (p) =>
    /\.(ts|tsx)$/.test(p) && !/\.(test|spec)\.(ts|tsx)$/.test(p) && !/routeTree\.gen\.ts$/.test(p),
);

/* --- progi pokrycia: ile jest i ile pilnuje nieistniejacych plikow --- */
const picomatch = (await import(`${ROOT}/node_modules/picomatch/index.js`)).default;
const vitestConfig = fs.readFileSync(`${ROOT}/vitest.config.ts`, "utf8");
const blokProgow = vitestConfig.slice(
  vitestConfig.indexOf("thresholds"),
  vitestConfig.indexOf("\n    },", vitestConfig.indexOf("thresholds")),
);
// Klucz w zrodle TS ma podwojone ukosniki; wartosc w runtime ma pojedyncze.
const kluczeProgow = [...blokProgow.matchAll(/^\s*"((?:[^"\\]|\\.)+)":\s*\{/gm)].map((m) =>
  m[1].replace(/\\\\/g, "\\"),
);
const martweProgi = kluczeProgow.filter((klucz) => {
  const pasuje = picomatch(klucz, { dot: true });
  // NIE `.filter(pasuje)`: Array.filter podaje indeks jako drugi argument, a picomatch traktuje
  // go jako `returnState` i zwraca wtedy obiekt - zawsze prawdziwy.
  return !wszystkieZrodla.some((plik) => pasuje(plik));
});
assert(
  kluczeProgow.length === 694,
  `progow per-sciezka: ${kluczeProgow.length}, dokument mowi 694`,
);
assert(
  martweProgi.length === 4,
  `martwych progow: ${martweProgi.length} (${martweProgi.join(", ")}), dokument mowi 4`,
);
wDokumencie("Realnych progów jest 690, nie 694");

/* --- moduly logiki bramek bez konsumenta poza wlasnym testem --- */
const moduleCi = fs.readdirSync(`${ROOT}/src/lib/ci`).filter((f) => f.endsWith(".ts"));
const bezKonsumenta = moduleCi
  .map((plik) => plik.replace(/\.ts$/, ""))
  .filter((nazwa) => {
    const uzycia = sh(
      `grep -rl "\\b${nazwa}\\b" src scripts --include='*.ts' --include='*.tsx' 2>/dev/null`,
    )
      .split("\n")
      .filter(Boolean)
      .filter(
        (p) => p !== `src/lib/ci/${nazwa}.ts` && p !== `src/lib/ci/__tests__/${nazwa}.test.ts`,
      );
    return uzycia.length === 0;
  });
assert(moduleCi.length === 40, `modulow w src/lib/ci: ${moduleCi.length}, dokument mowi 40`);
assert(
  bezKonsumenta.length === 2 &&
    bezKonsumenta.includes("ftsConfigSymmetry") &&
    bezKonsumenta.includes("staticAssetShadowing"),
  `bez konsumenta: [${bezKonsumenta.join(", ")}], dokument mowi [ftsConfigSymmetry, staticAssetShadowing]`,
);
// Cztery pozostale sa egzekwowane bramka-testem - to wlasnie ta roznica byla blednie zaraportowana.
for (const bramka of [
  "src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts",
  "src/lib/ci/__tests__/profileIntentCatalog.gate.test.ts",
])
  assert(fs.existsSync(`${ROOT}/${bramka}`), `brak bramki-testu ${bramka}`);

/* --- warstwa e2e: cztery konfiguracje, jedna nieuruchamiana przez zaden workflow --- */
const konfiguracje = [
  "playwright.config.ts",
  "playwright.artifact.config.ts",
  "playwright.performance.config.ts",
  "playwright.ab.config.ts",
];
for (const konfiguracja of konfiguracje)
  assert(fs.existsSync(`${ROOT}/${konfiguracja}`), `brak ${konfiguracja}`);
const plikowSpec = Number(
  sh(`find e2e e2e-performance e2e-ab -name '*.spec.ts' 2>/dev/null | wc -l`),
);
assert(plikowSpec === 17, `plikow *.spec.ts: ${plikowSpec}, dokument mowi 17`);
assert(
  sh(`grep -rl "playwright.ab.config\\|e2e-ab" .github/workflows 2>/dev/null`) === "",
  "konfiguracja A/B jednak wystepuje w workflow - dokument mowi, ze nie jest uruchamiana automatycznie",
);
wDokumencie("129 testów w 17 plikach");
wReadme("17 plików, 129 testów");
wReadme("17 files, 129 tests");

/* --- wiersze kodu produkcyjnego: wc -l, nie split("\n").length --- */
let wierszyWc = 0;
let plikowBezKoncowegoZnaku = 0;
for (const plik of produkcyjne) {
  const tresc = fs.readFileSync(`${ROOT}/${plik}`, "utf8");
  wierszyWc += (tresc.match(/\n/g) || []).length;
  if (!tresc.endsWith("\n")) plikowBezKoncowegoZnaku += 1;
}
assert(
  produkcyjne.length === 3534,
  `plikow produkcyjnych: ${produkcyjne.length}, dokument mowi 3 534`,
);
assert(wierszyWc === 743500, `wierszy (wc -l): ${wierszyWc}, dokument mowi 743 500`);
assert(
  plikowBezKoncowegoZnaku === 0,
  `plikow bez konczacego znaku nowej linii: ${plikowBezKoncowegoZnaku}`,
);
wReadme("743 500 linii");
wReadme("743,500 lines");

/* --- taksonomia: trasy, wiersz poza mapa --- */
const taksonomia = await import(`${ROOT}/scripts/taxonomy/moduleMap.mjs`);
const trasy = produkcyjne.filter((p) => p.startsWith("src/routes/"));
assert(trasy.length === 379, `tras: ${trasy.length}, dokument mowi 379`);
const trasyModulu3 = trasy.filter((p) => taksonomia.classifyPath(p).module === 3);
assert(trasyModulu3.length === 0, `modul 3 ma ${trasyModulu3.length} tras, dokument mowi 0`);
const pozaTaksonomia = produkcyjne.filter((p) => {
  const klasa = taksonomia.classifyPath(p);
  return klasa.module == null && !klasa.crossCutting;
});
assert(pozaTaksonomia.length === 58, `poza taksonomia: ${pozaTaksonomia.length}, dokument mowi 58`);
assert(
  pozaTaksonomia.every((p) => p.startsWith("src/test/")),
  `nie wszystko poza taksonomia lezy pod src/test/: ${pozaTaksonomia
    .filter((p) => !p.startsWith("src/test/"))
    .slice(0, 3)
    .join(", ")}`,
);

/* --- polityki RLS: stan koncowy po odtworzeniu wszystkich migracji --- */
const katalogMigracji = `${ROOT}/supabase/migrations`;
const migracje = fs
  .readdirSync(katalogMigracji)
  .filter((f) => f.endsWith(".sql"))
  .sort();
assert(migracje.length === 958, `migracji: ${migracje.length}, dokument mowi 958`);
const zywe = new Map();
const reCreate =
  /create\s+policy\s+("(?:[^"]*)"|[A-Za-z_][\w]*)\s+on\s+((?:"[^"]+"|[\w.]+))([\s\S]*?);/gi;
const reDrop =
  /drop\s+policy\s+(?:if\s+exists\s+)?("(?:[^"]*)"|[A-Za-z_][\w]*)\s+on\s+((?:"[^"]+"|[\w.]+))/gi;
const bezCudzyslowu = (s) =>
  s
    .replace(/"/g, "")
    .toLowerCase()
    .replace(/^public\./, "");
for (const plik of migracje) {
  const sql = fs.readFileSync(path.join(katalogMigracji, plik), "utf8");
  const operacje = [];
  for (const m of sql.matchAll(reCreate))
    operacje.push({
      i: m.index,
      op: "create",
      nazwa: m[1].replace(/"/g, ""),
      tabela: bezCudzyslowu(m[2]),
      tresc: m[3],
    });
  for (const m of sql.matchAll(reDrop))
    operacje.push({
      i: m.index,
      op: "drop",
      nazwa: m[1].replace(/"/g, ""),
      tabela: bezCudzyslowu(m[2]),
    });
  operacje.sort((a, b) => a.i - b.i);
  for (const o of operacje) {
    const klucz = `${o.tabela}|${o.nazwa}`;
    o.op === "create" ? zywe.set(klucz, o) : zywe.delete(klucz);
  }
}
const polityki = [...zywe.values()];
const tabele = new Set(polityki.map((p) => p.tabela));
const tenantowe = polityki.filter((p) => /tenant_id|current_tenant/i.test(p.tresc));
assert(
  polityki.length === 634,
  `polityk RLS w stanie koncowym: ${polityki.length}, dokument mowi 634`,
);
assert(tabele.size === 262, `tabel z politykami: ${tabele.size}, dokument mowi 262`);
assert(
  tenantowe.length === 576,
  `polityk wiazacych najemce: ${tenantowe.length}, dokument mowi 576`,
);
wReadme("634 na 262 tabelach");
wReadme("634 across 262 tables");

/* --- drugi pas migracji i slepota bramek SQL --- */
const drizzle = fs.existsSync(`${ROOT}/drizzle/migrations`)
  ? fs.readdirSync(`${ROOT}/drizzle/migrations`).filter((f) => f.endsWith(".sql"))
  : [];
assert(drizzle.length === 6, `migracji drizzle: ${drizzle.length}, dokument mowi 6`);
const katalogMigracjiWBramkach = (fs
  .readFileSync(`${ROOT}/scripts/lib/sqlMigrations.ts`, "utf8")
  .match(/MIGRATIONS_DIR\s*=\s*"([^"]+)"/) ?? [])[1];
assert(
  katalogMigracjiWBramkach === "supabase/migrations",
  `MIGRATIONS_DIR = ${katalogMigracjiWBramkach}, dokument opiera znalezisko Z1 na "supabase/migrations"`,
);

/* --- bramki check:* --- */
const pakiet = JSON.parse(fs.readFileSync(`${ROOT}/package.json`, "utf8"));
const bramki = Object.keys(pakiet.scripts).filter((k) => k.startsWith("check:"));
assert(bramki.length === 44, `bramek check:*: ${bramki.length}, dokument mowi 44`);
const workflowy = fs.readdirSync(`${ROOT}/.github/workflows`).filter((f) => /\.ya?ml$/.test(f));
const trescWorkflowow = workflowy
  .map((f) => fs.readFileSync(`${ROOT}/.github/workflows/${f}`, "utf8"))
  .join("\n");
const niewpiete = bramki.filter((b) => !trescWorkflowow.includes(b));
assert(niewpiete.length === 0, `bramki niewpiete w zaden workflow: ${niewpiete.join(", ")}`);
assert(
  fs
    .readFileSync(`${ROOT}/.github/workflows/first-visit.yml`, "utf8")
    .includes("check:first-visit-regression"),
  "check:first-visit-regression nie jest w first-visit.yml - dokument prostuje wlasnie to",
);

/* --- wynik --- */
const razem = zielone + czerwone.length;
console.log(
  `Weryfikacja wydania 11 wobec zywego repozytorium: ${razem} asercji, ${zielone} zielonych, ${czerwone.length} czerwonych`,
);
if (czerwone.length > 0) {
  console.log("\nCZERWONE:");
  for (const opis of czerwone) console.log(`  - ${opis}`);
  process.exit(1);
}
