/**
 * Weryfikacja liczb i stanów wydania 14 audytu (rozdział 18) wobec drzewa, które to wydanie zmierzyło.
 *
 * PO CO TO ISTNIEJE. Rozdział 18 twierdzi rzeczy o drzewie `346012635` (scalenie PR #518): ile jest
 * plików, wierszy, migracji, polityk RLS i asercji pgTAP, co przyszło w oknie od wydania 13
 * (`5b8c77c01`), co zmienił commit `c3f0c0e72`, jak wygląda graf importów między modułami, które
 * fakty w kodzie stoją za najpoważniejszymi defektami i za rekomendacjami Speed Index.
 *
 * DWA TRYBY (jak w wydaniu 13).
 *   bun scripts/audit/verify-edition-14.mjs          czyta drzewa `346012635` i `5b8c77c01` z obiektów
 *                                                    gita. Czerwień = dokument nie zgadza się z drzewem,
 *                                                    które opisuje.
 *   bun scripts/audit/verify-edition-14.mjs --zywe   twierdzenia o stanie (skala, kod, README) sprawdza
 *                                                    na bieżącym katalogu roboczym. Czerwień =
 *                                                    repozytorium poszło dalej i rozdział 18 trzeba
 *                                                    przepisać, a nie że coś się zepsuło.
 * Drzewo wydania 13, historia okna i rozliczenie rejestru zawsze pochodzą z obiektów gita.
 *
 * Asercje pgTAP, polityki RLS i komentarze SQL liczą BIBLIOTEKI REPOZYTORIUM z bieżącej gałęzi.
 * Graf modułów skrypt liczy od nowa (klasyfikacja `classifyPath` z drzewa pomiaru dla obu drzew,
 * jak `docs/audyt-ed14/narzedzia/graf14.mjs.txt`). Liczb pokrycia i Lighthouse nie powtarza (wymagają
 * pełnego przebiegu suity i przeglądarki) - sprawdza, czy dokument i README podają te same co dane
 * w `docs/audyt-ed14/`. Faktów zmierzonych w API GitHuba (ochrona `main`, przebiegi Actions) też nie
 * powtarza: wymagają sieci.
 *
 * Kod wyjścia 1, gdy którakolwiek asercja jest czerwona.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOC = `${ROOT}/docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`;
const README = `${ROOT}/README.md`;
const DANE = `${ROOT}/docs/audyt-ed14`;
const REWIZJA_POMIARU = "346012635";
const REWIZJA_ED13 = "5b8c77c01";
const COMMIT_ZASAD = "c3f0c0e72";
const ZYWE = process.argv.includes("--zywe");

const git = (args, opcje = {}) => {
  const r = spawnSync("git", args, { cwd: ROOT, maxBuffer: 1 << 30, ...opcje });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${String(r.stderr).trim()}`);
  return r.stdout;
};
for (const rewizja of [REWIZJA_POMIARU, REWIZJA_ED13, COMMIT_ZASAD]) {
  const r = spawnSync("git", ["cat-file", "-e", `${rewizja}^{commit}`], { cwd: ROOT });
  if (r.status !== 0) {
    console.error(
      `Brak commita ${rewizja} w tym klonie - pobierz historię (np. git fetch --unshallow) i uruchom ponownie.`,
    );
    process.exit(2);
  }
}

/* --- drzewa: obiekty gita albo katalog roboczy, jeden interfejs (jak w wydaniu 13) --- */
const drzewoGita = (rewizja) => {
  const obiekty = new Map();
  for (const rekord of git(["ls-tree", "-r", "-z", "--full-tree", rewizja], {
    encoding: "utf8",
  }).split("\0")) {
    if (!rekord) continue;
    const tab = rekord.indexOf("\t");
    const [, typ, obiekt] = rekord.slice(0, tab).split(" ");
    if (typ === "blob") obiekty.set(rekord.slice(tab + 1), obiekt);
  }
  const tresci = new Map();
  const wczytaj = (sciezki) => {
    const brak = [...new Set(sciezki)].filter((p) => obiekty.has(p) && !tresci.has(p));
    for (let i = 0; i < brak.length; i += 2000) {
      const partia = brak.slice(i, i + 2000);
      const wyjscie = git(["cat-file", "--batch"], {
        input: `${partia.map((p) => obiekty.get(p)).join("\n")}\n`,
      });
      let o = 0;
      for (const p of partia) {
        const nl = wyjscie.indexOf(10, o);
        const rozmiar = Number(wyjscie.toString("latin1", o, nl).split(" ")[2]);
        tresci.set(p, wyjscie.toString("utf8", nl + 1, nl + 1 + rozmiar));
        o = nl + 1 + rozmiar + 1;
      }
    }
  };
  return {
    opis: `${rewizja} (obiekty gita)`,
    pliki: [...obiekty.keys()],
    sha: (p) => obiekty.get(p),
    wczytaj,
    czytaj: (p) => {
      wczytaj([p]);
      if (!tresci.has(p)) throw new Error(`${rewizja}: brak pliku ${p}`);
      return tresci.get(p);
    },
  };
};
const drzewoZywe = () => {
  const pliki = [
    ...new Set(
      git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
        .split("\0")
        .filter((p) => p && fs.existsSync(`${ROOT}/${p}`) && fs.statSync(`${ROOT}/${p}`).isFile()),
    ),
  ];
  return {
    opis: "katalog roboczy",
    pliki,
    sha: (p) =>
      fs.existsSync(`${ROOT}/${p}`)
        ? git(["hash-object", "--", p], { encoding: "utf8" }).trim()
        : undefined,
    wczytaj: () => {},
    czytaj: (p) => fs.readFileSync(`${ROOT}/${p}`, "utf8"),
  };
};
const P14 = drzewoGita(REWIZJA_POMIARU);
const T = ZYWE ? drzewoZywe() : P14;
const E13 = drzewoGita(REWIZJA_ED13);

/* --- asercje i dokument --- */
const norm = (s) => String(s).replace(/ /g, " ").replace(/\*/g, "").replace(/\s+/g, " ");
const docSurowy = fs.readFileSync(DOC, "utf8");
const doc = norm(docSurowy);
const readmeSurowy = fs.readFileSync(README, "utf8");
const podzialReadme = readmeSurowy.indexOf("\n# English version");
const czesciReadme =
  podzialReadme < 0
    ? { PL: readmeSurowy, EN: "" }
    : { PL: readmeSurowy.slice(0, podzialReadme), EN: readmeSurowy.slice(podzialReadme) };
let zielone = 0;
const czerwone = [];
const assert = (warunek, opis) => (warunek ? zielone++ : czerwone.push(opis));
const rowne = (jest, ma, opis) => assert(jest === ma, `${opis}: jest ${jest}, dokument mówi ${ma}`);
const wDokumencie = (fragment) =>
  assert(doc.includes(norm(fragment)), `dokument nie zawiera: ${fragment}`);
const wReadme = (jezyk, fragment) =>
  assert(
    norm(czesciReadme[jezyk]).includes(norm(fragment)),
    `README (${jezyk}) nie zawiera: ${fragment}`,
  );
assert(podzialReadme > 0, 'README: brak nagłówka „# English version" - części się nie rozdzielą');
const odNaglowka = (naglowek, doNaglowka) => {
  const i = docSurowy.indexOf(naglowek);
  if (i < 0) return "";
  const j = doNaglowka ? docSurowy.indexOf(doNaglowka, i) : -1;
  return docSurowy.slice(i, j < 0 ? undefined : j);
};
const ROZDZIAL = odNaglowka("\n## 18. ");
const sekcja = (n) => odNaglowka(`### 18.${n}.`, `### 18.${n + 1}.`);
// Wiersze tabeli markdown spod wiersza nagłówka pasującego do `naglowek` (bez nagłówka i separatora),
// komórki po norm() i bez backticków. Tabela kończy się na pierwszej linii, która nie zaczyna się od `|`.
const tabelaPod = (tekst, naglowek) => {
  const linie = tekst.split("\n");
  const start = linie.findIndex((l) => naglowek.test(l));
  if (start < 0) return [];
  const wiersze = [];
  for (const l of linie.slice(start + 2)) {
    if (!l.startsWith("|")) break;
    wiersze.push(
      l
        .split("|")
        .slice(1, -1)
        .map((c) => norm(c).replace(/`/g, "").trim()),
    );
  }
  return wiersze;
};
const etykieta = (s) => norm(s).replace(/`/g, "").trim();
// Liczba po polsku: separator tysięcy to spacja, przecinek dziesiętny.
const pl = (n, miejsca) =>
  (miejsca === undefined ? String(n) : n.toFixed(miejsca))
    .replace(".", ",")
    .replace(/^(-?\d+)/, (c) => c.replace(/\B(?=(\d{3})+(?!\d))/g, " "));
const procent = (a, b) => (b ? (100 * a) / b : 100);
const json = (rel) => JSON.parse(fs.readFileSync(`${DANE}/${rel}`, "utf8"));
const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/* --- 18.2: skala na obu drzewach, jedna definicja (jak 17.2) --- */
const isTest = (f) => /(^|\/)__tests__\/|\.test\.|\.spec\./.test(f);
const isSrc = (f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !/\.d\.ts$/.test(f);
const wiersze = (t) => {
  const n = t.split("\n").length;
  return t.endsWith("\n") ? n - 1 : n;
};
const wKatalogu = (d, katalog, wzorzec) =>
  d.pliki.filter(
    (p) =>
      p.startsWith(`${katalog}/`) && !p.slice(katalog.length + 1).includes("/") && wzorzec.test(p),
  );
const picomatch = (await import(`${ROOT}/node_modules/picomatch/index.js`)).default;
const { analyzePgTapFile } = await import(`${ROOT}/src/lib/ci/pgTapPlan.ts`);
const { extractLatestPolicies } = await import(`${ROOT}/src/lib/ci/rlsPolicies.ts`);
const { stripSqlComments } = await import(`${ROOT}/scripts/lib/sqlMigrations.ts`);

// Blok `thresholds` z vitest.config.ts: klucze per ścieżka i próg globalny.
const progiZ = (cfg) => {
  const j = cfg.indexOf("{", cfg.indexOf("thresholds"));
  let glebokosc = 0;
  let k = j;
  for (; k < cfg.length; k++) {
    if (cfg[k] === "{") glebokosc++;
    else if (cfg[k] === "}" && --glebokosc === 0) break;
  }
  const blok = cfg.slice(j, k + 1);
  const klucze = [];
  for (const m of blok.matchAll(/^\s*"((?:[^"\\]|\\.)+)":\s*\{/gm)) {
    const klucz = JSON.parse(`"${m[1]}"`);
    if (klucz.includes("/") || klucz.includes("*")) klucze.push(klucz);
  }
  let poziom = 0;
  let plaski = "";
  for (const c of blok) {
    if (c === "{") poziom++;
    else if (c === "}") poziom--;
    else if (poziom === 1) plaski += c;
  }
  const globalne = ["statements", "functions", "lines", "branches"].map((n) =>
    Number(plaski.match(new RegExp(`^\\s*${n}:\\s*(\\d+)`, "m"))?.[1]),
  );
  return { klucze, globalne };
};
const metryki = (d) => {
  const zrodla = d.pliki.filter((p) => p.startsWith("src/") && isSrc(p));
  const sql = d.pliki.filter((p) =>
    /^(supabase\/(migrations|tests)|drizzle\/migrations)\/[^/]+\.sql$/.test(p),
  );
  d.wczytaj([...zrodla, ...sql]);
  const m = {
    prod: [],
    testy: [],
    prodLines: 0,
    testLines: 0,
    cases: 0,
    expects: 0,
    noMockTests: 0,
    routes: 0,
    uiComponents: 0,
    fails: 0,
    failsPliki: 0,
  };
  for (const f of zrodla) {
    const t = d.czytaj(f);
    if (isTest(f)) {
      m.testy.push(f);
      m.testLines += wiersze(t);
      m.cases += (t.match(/^\s*(it|test)(\.\w+)*\s*\(/gm) ?? []).length;
      m.expects += (t.match(/\bexpect\s*[.(]/g) ?? []).length;
      if (!/\bvi\.(mock|fn|spyOn|stubGlobal|doMock|hoisted)\b/.test(t)) m.noMockTests++;
      const nf = (t.match(/\b(it|test)\.fails\s*\(/g) ?? []).length;
      m.fails += nf;
      if (nf) m.failsPliki++;
    } else {
      m.prod.push(f);
      m.prodLines += wiersze(t);
      if (f.startsWith("src/routes/") && !f.endsWith("routeTree.gen.ts")) m.routes++;
      if (/^src\/components\/ui\/[^/]+\.tsx$/.test(f)) m.uiComponents++;
    }
  }
  const pkg = JSON.parse(d.czytaj("package.json"));
  const skrypty = Object.keys(pkg.scripts ?? {});
  m.skryptyCheck = skrypty.filter((s) => s.startsWith("check:"));
  m.scripts = skrypty.length;
  m.ciModules = wKatalogu(d, "src/lib/ci", /\.ts$/).length;
  m.gateTests = zrodla.filter((f) => /\.gate\.test\.(ts|tsx)$/.test(f)).length;
  m.migracjeSupabase = wKatalogu(d, "supabase/migrations", /\.sql$/).sort();
  m.migracjeDrizzle = wKatalogu(d, "drizzle/migrations", /\.sql$/).sort();
  m.workflows = wKatalogu(d, ".github/workflows", /\.ya?ml$/).length;
  m.docs = wKatalogu(d, "docs", /\.md$/).length;
  m.playwright = d.pliki.filter((p) => /^playwright\..*config\.ts$/.test(p)).length;
  const pgtap = wKatalogu(d, "supabase/tests", /\.sql$/);
  m.pgtap = pgtap.length;
  m.asercje = pgtap
    .map((f) => analyzePgTapFile(path.basename(f), d.czytaj(f)))
    .reduce((s, a) => s + a.counted, 0);
  const polityki = extractLatestPolicies(
    m.migracjeSupabase.map((f) => ({ file: path.basename(f), sql: stripSqlComments(d.czytaj(f)) })),
  );
  m.polityki = polityki.size;
  m.tabeleZPolitykami = new Set([...polityki.values()].map((p) => p.table)).size;
  const { klucze, globalne } = progiZ(d.czytaj("vitest.config.ts"));
  m.progi = klucze;
  m.progGlobalny = globalne;
  const dopasowania = klucze.map((k) => [k, picomatch(k, { dot: true })]);
  // Nie `.filter(dopasuj)`: Array.filter podaje indeks jako drugi argument, a picomatch czyta go jako returnState.
  m.martweProgi = dopasowania.filter(([, dopasuj]) => !m.prod.some((f) => dopasuj(f))).length;
  m.podProgiem = m.prod.filter((f) => dopasowania.some(([, dopasuj]) => dopasuj(f))).length;
  m.bramkiCi = new Set(
    [...d.czytaj(".github/workflows/ci.yml").matchAll(/bun run (check:[a-z0-9:-]+)/g)].map(
      (x) => x[1],
    ),
  ).size;
  return m;
};
const MT = metryki(T);
const M13 = metryki(E13);
const P14M = ZYWE ? metryki(P14) : MT;

{
  const tabela = new Map(
    tabelaPod(sekcja(2), /^\|\s*Metryka\s*\|\s*Wydanie 13/).map((w) => [w[0], w]),
  );
  const WIERSZE = [
    ["Pliki kodu produkcyjnego", (m) => pl(m.prod.length)],
    ["Wiersze kodu produkcyjnego", (m) => pl(m.prodLines)],
    ["Pliki testowe", (m) => pl(m.testy.length)],
    ["Wiersze testów", (m) => pl(m.testLines)],
    ["Przypadki testowe (skan statyczny)", (m) => pl(m.cases)],
    ["Wywołania `expect` (skan statyczny)", (m) => pl(m.expects)],
    ["Pliki testowe bez atrapy `vi.*`", (m) => pl(m.noMockTests)],
    ["Trasy (pliki w `src/routes`)", (m) => pl(m.routes)],
    ["Komponenty design systemu (`components/ui`)", (m) => pl(m.uiComponents)],
    ["Skrypty `package.json` / bramki `check:*`", (m) => `${m.scripts} / ${m.skryptyCheck.length}`],
    ["Moduły `src/lib/ci`", (m) => pl(m.ciModules)],
    ["Bramki-testy `*.gate.test.*`", (m) => pl(m.gateTests)],
    ["Migracje `supabase/migrations`", (m) => pl(m.migracjeSupabase.length)],
    ["Migracje `drizzle/migrations` (SQL)", (m) => pl(m.migracjeDrizzle.length)],
    ["Pliki pgTAP / asercje (analizator repo)", (m) => `${pl(m.pgtap)} / ${pl(m.asercje)}`],
    [
      "Polityki RLS / tabele z politykami (repo)",
      (m) => `${pl(m.polityki)} / ${pl(m.tabeleZPolitykami)}`,
    ],
    [
      "Progi pokrycia per ścieżka (martwe)",
      (m) => (m.progi.length ? `${pl(m.progi.length)} (${m.martweProgi})` : "0"),
    ],
    [
      "Pliki produkcyjne pod progiem per ścieżka",
      (m) =>
        m.podProgiem
          ? `${pl(m.podProgiem)} (${pl((100 * m.podProgiem) / m.prod.length, 2)}%)`
          : "0",
    ],
    ["Wpisy `it.fails` / plików", (m) => `${pl(m.fails)} / ${pl(m.failsPliki)}`],
    ["Przepływy GitHub Actions", (m) => pl(m.workflows)],
    ["Dokumenty w `docs/`", (m) => pl(m.docs)],
  ];
  for (const [nazwa, wartosc] of WIERSZE) {
    const w = tabela.get(etykieta(nazwa));
    if (!w) {
      assert(false, `18.2: brak wiersza „${nazwa}"`);
      continue;
    }
    rowne(wartosc(M13), w[1], `18.2 „${nazwa}", wydanie 13 (${REWIZJA_ED13})`);
    rowne(wartosc(MT), w[2], `18.2 „${nazwa}", wydanie 14 (${T.opis})`);
  }
  const e2e = tabela.get("Testy e2e / pliki / konfiguracje");
  assert(
    e2e?.[1]?.endsWith(` / ${M13.playwright}`),
    `18.2: konfiguracji Playwrighta w wydaniu 13 było ${M13.playwright}`,
  );
  assert(
    e2e?.[2]?.endsWith(` / ${MT.playwright}`),
    `18.2: konfiguracji Playwrighta jest ${MT.playwright}`,
  );
  // Testy e2e z `playwright test --list` (dane pomiaru) plus test integracyjny liczony ze źródła.
  const lista = fs.readFileSync(`${DANE}/e2e14.txt`, "utf8");
  const zListy = [...lista.matchAll(/Total: (\d+) tests? in (\d+) files?/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
  const integracja = (
    T.czytaj("integration/events/paid-lifecycle.spec.ts").match(/^\s*(test|it)(\.\w+)*\(/gm) ?? []
  ).length;
  const testyE2e = zListy.reduce((s, [n]) => s + n, 0) + integracja;
  const plikiE2e = zListy.reduce((s, [, n]) => s + n, 0) + 1;
  rowne(
    `${testyE2e} / ${plikiE2e} / ${MT.playwright}`,
    e2e?.[2],
    "18.2: testy e2e / pliki / konfiguracje",
  );
}

/* --- okno: historia i pliki (18.2) --- */
const OKNO = `${REWIZJA_ED13}..${REWIZJA_POMIARU}`;
assert(
  spawnSync("git", ["merge-base", "--is-ancestor", REWIZJA_ED13, REWIZJA_POMIARU], { cwd: ROOT })
    .status === 0,
  "historia okna nie jest ciągła: 5b8c77c01 nie jest przodkiem 346012635",
);
{
  const commity = Number(git(["rev-list", "--count", OKNO], { encoding: "utf8" }).trim());
  const scalenia = Number(
    git(["rev-list", "--count", "--merges", OKNO], { encoding: "utf8" }).trim(),
  );
  const numery = [
    ...new Set(
      [
        ...git(["log", "--merges", "--format=%s", OKNO], { encoding: "utf8" }).matchAll(
          /Merge pull request #(\d+)/g,
        ),
      ].map((m) => Number(m[1])),
    ),
  ];
  wDokumencie(
    `W oknie jest **${pl(commity)} commity** (${scalenia} scalenia, w tym ${numery.length} PR-ów #${Math.min(...numery)}-#${Math.max(...numery)})`,
  );
  rowne(commity, 1604, "commity w oknie");
  const autorzy = new Map();
  for (const a of git(["log", "--format=%an", OKNO], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean))
    autorzy.set(a, (autorzy.get(a) ?? 0) + 1);
  const organizacja = [...autorzy]
    .filter(([a]) => /new ?european ?strategies|neweustrategies/i.test(a))
    .reduce((s, [, n]) => s + n, 0);
  wDokumencie(
    `Autorzy: Claude ${autorzy.get("Claude") ?? 0}, edytor Lovable (\`gpt-engineer-app[bot]\`) ${autorzy.get("gpt-engineer-app[bot]") ?? 0}, konto organizacji ${organizacja}.`,
  );
  rowne(
    Number(
      git(["rev-list", "--count", `${REWIZJA_POMIARU}..6a0b9d570`], { encoding: "utf8" }).trim(),
    ),
    13,
    "commity edytora po scaleniu #518 (do 6a0b9d570)",
  );
}
{
  const p13 = new Set(M13.prod);
  const p14 = new Set(P14M.prod);
  const t13 = new Set(M13.testy);
  const t14 = new Set(P14M.testy);
  const usuniete = M13.prod.filter((f) => !p14.has(f));
  wDokumencie(
    `W \`src/\` przybyło ${P14M.prod.filter((f) => !p13.has(f)).length} plików produkcyjnych, a ${usuniete.length} usunięto, w tym ${usuniete.filter((f) => f.startsWith("src/lib/ci/")).length} modułów bramek z \`src/lib/ci/\``,
  );
  wDokumencie(
    `plików testowych przybyło ${P14M.testy.filter((f) => !t13.has(f)).length}, usunięto ${M13.testy.filter((f) => !t14.has(f)).length}.`,
  );
}

/* --- 18.3: commit zmiany zasad --- */
{
  const stat = git(["show", "--shortstat", "--format=", COMMIT_ZASAD], { encoding: "utf8" });
  const pliki = Number(stat.match(/(\d+) files? changed/)?.[1]);
  const usunieteWiersze = Number(stat.match(/(\d+) deletions?/)?.[1]);
  wDokumencie(`zmienił ${pl(pliki)} plików i usunął ${pl(usunieteWiersze)} wierszy`);
  const zmiany = git(["show", "--name-status", "--format=", COMMIT_ZASAD], { encoding: "utf8" })
    .split("\n")
    .filter((l) => l.startsWith("D\t"))
    .map((l) => l.slice(2))
    .filter((f) => /(__tests__|\.test\.)/.test(f));
  const wSrc = zmiany.filter((f) => f.startsWith("src/")).length;
  const wScripts = zmiany.filter((f) => f.startsWith("scripts/")).length;
  wDokumencie(
    `**${zmiany.length} plików testów usuniętych** (${wSrc} w \`src/\`, ${wScripts} w \`scripts/\`)`,
  );
  const przed = JSON.parse(
    git(["show", `${COMMIT_ZASAD}^:package.json`], { encoding: "utf8" }),
  ).scripts;
  const po = JSON.parse(
    git(["show", `${COMMIT_ZASAD}:package.json`], { encoding: "utf8" }),
  ).scripts;
  const zdjete = Object.keys(przed).filter((s) => s.startsWith("check:") && !(s in po));
  wDokumencie(`**${zdjete.length} skryptów \`check:*\` usuniętych,**`);
  const nowe = P14M.skryptyCheck.filter((s) => !M13.skryptyCheck.includes(s)).sort();
  rowne(
    nowe.join(", "),
    "check:document-weight, check:migration-lanes, check:on-conflict-arbiters, check:sql-definer-views, check:structured-data-live, check:ts-sql-contract",
    "18.3: nowe bramki w oknie",
  );
  wDokumencie(`W tym samym oknie doszło **${nowe.length} nowych bramek**`);
  wDokumencie(
    `Bilans: ${M13.skryptyCheck.length} → ${P14M.skryptyCheck.length} skryptów \`check:*\`.`,
  );
  rowne(M13.progi.length, 947, "18.3: progi per ścieżka w wydaniu 13");
  rowne(MT.progi.length, 0, "18.3: progi per ścieżka teraz");
  rowne(
    MT.progGlobalny.join("/"),
    "79/77/80/73",
    "18.3: próg globalny (instrukcje/funkcje/linie/gałęzie)",
  );
  assert(
    T.czytaj("vitest.config.ts").includes("Pokrycie NIE jest bramką CI."),
    "18.3: vitest.config.ts nie mówi już, że pokrycie nie jest bramką CI - przepisać 18.3",
  );
}

/* --- 18.4-18.5: pokrycie z danych pomiaru (dokument i README muszą mówić to samo) --- */
const POK = json("pokrycie14.json");
const DEL = json("pokrycie14-delta.json");
const PRZ = json("przebieg14.json");
{
  const T14 = POK.T;
  const T13 = JSON.parse(fs.readFileSync(`${ROOT}/docs/audyt-ed13/pokrycie13.json`, "utf8")).T;
  const tab = new Map(
    tabelaPod(sekcja(4), /^\|\s*Metryka\s*\|\s*Wydanie 13\s*\|/).map((w) => [w[0], w]),
  );
  for (const [nazwa, a, b] of [
    ["Linie", "Lc", "L"],
    ["Instrukcje", "Sc", "S"],
    ["Funkcje", "Fc", "F"],
    ["Gałęzie", "Bc", "B"],
  ]) {
    const w = tab.get(nazwa);
    assert(
      w?.[1]?.startsWith(`${pl(procent(T13[a], T13[b]), 2)}%`),
      `18.4 „${nazwa}" wydanie 13: ${pl(procent(T13[a], T13[b]), 2)}%`,
    );
    assert(
      w?.[2]?.startsWith(`${pl(procent(T14[a], T14[b]), 2)}%`),
      `18.4 „${nazwa}" wydanie 14: ${pl(procent(T14[a], T14[b]), 2)}%`,
    );
  }
  rowne(pl(T14.files), tab.get("Pliki w mianowniku")?.[2], "18.4: pliki w mianowniku");
  rowne(String(T14.zero), tab.get("Pliki na zerze")?.[2], "18.4: pliki na zerze");
  rowne(pl(T14.L - T14.Lc), tab.get("Niepokryte linie")?.[2], "18.4: niepokryte linie");
  rowne(String(T14.dead), tab.get("Martwe funkcje nazwane")?.[2], "18.4: martwe funkcje");
  const linie = pl(procent(T14.Lc, T14.L), 2);
  const funkcje = pl(procent(T14.Fc, T14.F), 2);
  wDokumencie(
    `**Linie ${linie}%, funkcje ${funkcje}%, instrukcje ${pl(procent(T14.Sc, T14.S), 2)}%, gałęzie ${pl(procent(T14.Bc, T14.B), 2)}%**`,
  );
  wReadme("PL", `${linie}% linii i ${funkcje}% funkcji`);
  wReadme(
    "EN",
    `${linie.replace(",", ".")}% of lines and ${funkcje.replace(",", ".")}% of functions`,
  );
  const n = PRZ.przypadki;
  wDokumencie(
    `${pl(PRZ.plikiTestowe)} plików testowych, ${pl(n.numTotalTests)} przypadków, **${n.numFailedTests} czerwonych**, ${n.numPendingTests} pominiętych`,
  );
  wReadme("PL", `${pl(n.numTotalTests)} przypadków testowych na ${pl(PRZ.plikiTestowe)} plikach`);
  // Zapas progu globalnego - liczony z pomiaru i z progu w konfiguracji drzewa pomiaru.
  for (const [i, a, b] of [
    [0, "Sc", "S"],
    [1, "Fc", "F"],
    [2, "Lc", "L"],
    [3, "Bc", "B"],
  ])
    wDokumencie(`${pl(procent(T14[a], T14[b]) - P14M.progGlobalny[i], 2)} pp`);
  // Zera: 56 straciło pokrycie, 5 nowych plików; nowe pliki naprawdę są nowe, a macierze naprawdę zniknęły.
  const utracone = DEL.zera14.filter((z) => z.ed13 !== "nowy" && z.ed13 !== "zero");
  const nowe = DEL.zera14.filter((z) => z.ed13 === "nowy");
  rowne(DEL.zera14.length, T14.zero, "18.4: lista zer zgodna z sumą");
  wDokumencie(`${utracone.length} z nich miało pokrycie w wydaniu 13`);
  rowne(
    utracone.filter((z) => z.f.startsWith("src/components/admin/blocks/edit/")).length,
    40,
    "18.4: edytory bloków na zerze",
  );
  for (const z of nowe)
    assert(
      P14.sha(z.f) !== undefined && E13.sha(z.f) === undefined,
      `18.4: ${z.f} nie jest nowym plikiem okna`,
    );
  for (let i = 1; i <= 6; i++) {
    const f = `src/components/admin/blocks/edit/__tests__/blockEditMatrix.part${i}.test.tsx`;
    assert(E13.sha(f) !== undefined && P14.sha(f) === undefined, `18.4: ${f} nie zniknął w oknie`);
  }
  wDokumencie(`Na zerze jest też ${nowe.length} nowych plików z okna`);
  // 18.5: każdy wiersz tabeli per moduł wobec danych.
  const wiersze185 = tabelaPod(sekcja(5), /^\|\s*Moduł\s*\|\s*Nazwa\s*\|/);
  rowne(wiersze185.length, Object.keys(POK.perKey).length, "18.5: wiersze tabeli per moduł");
  for (const w of wiersze185) {
    const r = POK.perKey[w[0]];
    if (!r) {
      assert(false, `18.5: moduł ${w[0]} spoza danych`);
      continue;
    }
    rowne(String(r.files), w[2], `18.5 moduł ${w[0]}: pliki`);
    rowne(`${pl(procent(r.Lc, r.L), 2)}%`, w[3], `18.5 moduł ${w[0]}: linie`);
    rowne(`${pl(procent(r.Fc, r.F), 2)}%`, w[5], `18.5 moduł ${w[0]}: funkcje`);
    rowne(`${pl(procent(r.Bc, r.B), 2)}%`, w[7], `18.5 moduł ${w[0]}: gałęzie`);
    assert(w[8]?.startsWith(`${r.zero} (`), `18.5 moduł ${w[0]}: zera ${r.zero}`);
  }
}

/* --- 18.6: funkcjonalności --- */
const FUN = json("funkcjonalnosci14.json");
{
  const wiersze186 = tabelaPod(sekcja(6), /^\|\s*Moduł\s*\|\s*Funkcjonalność\s*\|/);
  rowne(wiersze186.length, FUN.wiersze.length, "18.6: wiersze tabeli funkcjonalności");
  wDokumencie(
    `**${FUN.wiersze.length} funkcjonalności**, z czego **${FUN.wiersze.filter((r) => r.nowa).length} nowych**`,
  );
  rowne(FUN.nieprzeniesione.length, 0, "18.6: nazwy wydania 13 nieprzeniesione");
  rowne(FUN.zle.length, 0, "18.6: błędne wzorce regex");
}

/* --- 18.7: graf importów liczony od nowa na obu drzewach --- */
{
  const mapaModulow = (() => {
    const tymczasowy = path.join(os.tmpdir(), `moduleMap-ed14-${process.pid}.mjs`);
    fs.writeFileSync(tymczasowy, P14.czytaj("scripts/taxonomy/moduleMap.mjs"));
    return tymczasowy;
  })();
  const { classifyPath, MODULES } = await import(pathToFileURL(mapaModulow).href);
  fs.rmSync(mapaModulow, { force: true });
  const klucz = (f) => {
    const c = classifyPath(f);
    return c.module != null ? String(c.module) : c.crossCutting ? `X-${c.crossCutting}` : "NULL";
  };
  const m20 = MODULES.find((m) => m.id === 20);
  const jawne20 = m20.patterns.filter(
    (p) => !["^src\\/routes\\/", "^src\\/lib\\/"].includes(p.source),
  );
  const EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"];
  const IMP =
    /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gm;
  const FROM = /\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g;
  const RPC = /\.rpc\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g;
  const scc = (krawedzie) => {
    const V = [...new Set(krawedzie.flat())];
    const adj = new Map(V.map((v) => [v, []]));
    for (const [a, b] of krawedzie) adj.get(a).push(b);
    let i = 0;
    const st = [];
    const on = new Set();
    const ix = new Map();
    const lo = new Map();
    const out = [];
    const dfs = (v) => {
      ix.set(v, i);
      lo.set(v, i);
      i++;
      st.push(v);
      on.add(v);
      for (const w of adj.get(v)) {
        if (!ix.has(w)) {
          dfs(w);
          lo.set(v, Math.min(lo.get(v), lo.get(w)));
        } else if (on.has(w)) lo.set(v, Math.min(lo.get(v), ix.get(w)));
      }
      if (lo.get(v) === ix.get(v)) {
        const c = [];
        let w;
        do {
          w = st.pop();
          on.delete(w);
          c.push(w);
        } while (w !== v);
        if (c.length > 1) out.push(c);
      }
    };
    for (const v of V) if (!ix.has(v)) dfs(v);
    return out.map((c) => c.length).sort((a, b) => b - a);
  };
  const graf = (d) => {
    const zrodla = d.pliki.filter((p) => p.startsWith("src/") && isSrc(p));
    d.wczytaj(zrodla);
    const istnieje = new Set(zrodla);
    const resolve = (z, spec) => {
      let p;
      if (spec.startsWith("@/")) p = `src/${spec.slice(2)}`;
      else if (spec.startsWith("."))
        p = path.posix.normalize(path.posix.join(path.posix.dirname(z), spec));
      else return null;
      for (const e of EXT) if (istnieje.has(p + e)) return p + e;
      return null;
    };
    const k = new Map(zrodla.map((f) => [f, klucz(f)]));
    const wezel = (f) =>
      k.get(f) !== "20" ? k.get(f) : jawne20.some((p) => p.test(f)) ? "20" : "20*";
    const kraw = new Map();
    const bezLapacza = new Set();
    const tabele = new Map();
    const rpc = new Map();
    for (const f of zrodla) {
      if (isTest(f)) continue;
      const tresc = d.czytaj(f);
      for (const m of tresc.matchAll(IMP)) {
        const cel = resolve(f, m[2] ?? m[3]);
        if (!cel || isTest(cel) || k.get(cel) === k.get(f)) continue;
        const e = `${k.get(f)}>${k.get(cel)}`;
        kraw.set(e, (kraw.get(e) ?? 0) + 1);
        const a = wezel(f);
        const b = wezel(cel);
        if (!m[1] && !m[3] && a !== b) bezLapacza.add(`${a}>${b}`);
      }
      for (const [re, mapa] of [
        [FROM, tabele],
        [RPC, rpc],
      ])
        for (const m of tresc.matchAll(re))
          (mapa.get(m[1]) ?? mapa.set(m[1], new Set()).get(m[1])).add(k.get(f));
    }
    const lista = [...kraw.keys()].map((e) => e.split(">"));
    const realne = [...bezLapacza].map((e) => e.split(">"));
    return {
      krawedzie: kraw.size,
      importy: [...kraw.values()].reduce((s, n) => s + n, 0),
      pary: lista.filter(([a, b]) => kraw.has(`${b}>${a}`)).length / 2,
      scc: scc(lista),
      sccBezLapacza: scc(realne.filter(([a, b]) => a !== "20*" && b !== "20*")),
      sccBezLapaczaINull: scc(
        realne.filter(([a, b]) => ![a, b].some((x) => x === "20*" || x === "NULL")),
      ),
      tabele: tabele.size,
      tabeleWspolne: [...tabele.values()].filter((s) => s.size > 1).length,
      rpc: rpc.size,
      rpcWspolne: [...rpc.values()].filter((s) => s.size > 1).length,
      profiles: tabele.get("profiles")?.size,
    };
  };
  const G13 = graf(E13);
  const G14 = graf(T);
  const tab = new Map(tabelaPod(sekcja(7), /^\|\s*Miara\s*\|\s*Wydanie 13/).map((w) => [w[0], w]));
  const sprawdz = (nazwa, f) => {
    const w = tab.get(nazwa);
    rowne(f(G13), w?.[1], `18.7 „${nazwa}", wydanie 13`);
    rowne(f(G14), w?.[2], `18.7 „${nazwa}", wydanie 14 (${T.opis})`);
  };
  sprawdz("Krawędzie moduł → moduł", (g) => pl(g.krawedzie));
  sprawdz("Importy między modułami", (g) => pl(g.importy));
  sprawdz("Pary modułów importujące się nawzajem", (g) => pl(g.pary));
  sprawdz("Silnie spójne składowe (rozmiar)", (g) => `${g.scc.length} (${g.scc[0]})`);
  sprawdz(
    "Tabele czytane z kodu / w więcej niż jednym module",
    (g) => `${g.tabele} / ${g.tabeleWspolne}`,
  );
  sprawdz("RPC wołane z kodu / w więcej niż jednym module", (g) => `${g.rpc} / ${g.rpcWspolne}`);
  wDokumencie(
    `składowa ma nadal ${G14.sccBezLapacza[0]} węzłów; bez węzła „poza taksonomią" ${G14.sccBezLapaczaINull[0]}`,
  );
  wDokumencie(`\`profiles\` (${G14.profiles} modułów)`);
}

/* --- 18.8-18.9: fakty w kodzie za najpoważniejszymi defektami i rozjazdami --- */
const plik = (p) => {
  try {
    return T.czytaj(p);
  } catch {
    return "";
  }
};
const drizzle = MT.migracjeDrizzle.map((f) => T.czytaj(f)).join("\n");
const supabase = (f) => T.czytaj(`supabase/migrations/${f}`);
// N14-13-1: trigger najemcy subskrypcji tylko w pasie supabase, a webhook na nim polega.
assert(
  /CREATE OR REPLACE FUNCTION public\.subscriptions_pin_tenant\(/.test(
    supabase("20261007140300_subscriptions_tenant_from_owner.sql"),
  ),
  "N14-13-1: brak funkcji w pasie supabase",
);
assert(
  !/FUNCTION public\.subscriptions_pin_tenant\(/.test(drizzle),
  "N14-13-1: pas drizzle ma już subscriptions_pin_tenant - przepisać 18.9",
);
assert(
  plik("src/lib/billing/webhookDispatch.server.ts").includes('.select("id, tenant_id, user_id")'),
  "N14-13-1: webhook nie czyta już najemcy z RETURNING",
);
// N14-13-2, N14-16-2: poprawka kuponu B2B i komentarze ściany tylko w pasie supabase.
assert(
  supabase("20261007140200_release_coupon_server_only.sql").includes("release_b2b_coupon"),
  "N14-13-2: brak migracji w pasie supabase",
);
assert(
  !drizzle.includes("release_b2b_coupon"),
  "N14-13-2: pas drizzle ma już release_b2b_coupon - przepisać 18.9",
);
assert(
  !drizzle.includes("club_post_comments_list"),
  "N14-16-2: pas drizzle ma już club_post_comments_list - przepisać 18.9",
);
assert(
  plik("src/lib/clubs/postsApi.ts").includes('supabase.rpc("club_post_comments_list"'),
  "N14-16-2: klient nie woła już club_post_comments_list",
);
// N14-6-1: wyszukiwanie głosowe w trybie ciągłym, onFinal przy każdym zdarzeniu z wynikiem końcowym.
{
  const v = plik("src/lib/search/useVoiceSearch.ts");
  assert(
    v.includes("rec.continuous = true;") &&
      v.includes("if (hasFinal) onFinalRef.current?.(phrase);"),
    "N14-6-1: useVoiceSearch zmienione - przepisać 18.9",
  );
}
// N14-18-1: zbiorcze wycofanie zgody raportuje liczbę z wejścia, a RPC filtruje po bieżącym najemcy.
assert(
  /touched = ids\.length;/.test(plik("src/lib/crm.functions.ts")),
  "N14-18-1: crm.functions.ts nie raportuje już ids.length",
);
assert(
  supabase("20261012180900_marketing_consent_unsubscribe_contact_crm_staff.sql").includes(
    "WHERE l.tenant_id = v_tenant",
  ),
  "N14-18-1: RPC nie filtruje po najemcy",
);
// N14-16-1: club_post_create normalizuje tylko link, a późniejszej definicji nie ma.
{
  const ost = "20261007100100_club_post_mentions_and_link_validation.sql";
  assert(
    supabase(ost).includes("IF v_el->>'type' = 'link' THEN"),
    "N14-16-1: brak gałęzi normalizacji linku",
  );
  const pozniej = MT.migracjeSupabase.filter(
    (f) => path.basename(f) > ost && /FUNCTION public\.club_post_create\(/.test(T.czytaj(f)),
  );
  rowne(pozniej.join(", "), "", "N14-16-1: późniejsza definicja club_post_create");
}
// 18.8: ruleset w repo deklaruje aktywną ochronę, post-deploy biegnie po każdej bramce.
assert(
  plik("governance/release/main-ruleset.json").includes('"enforcement": "active"'),
  "18.8: ruleset w repo nie deklaruje już enforcement active",
);
assert(
  plik(".github/workflows/ci.yml").includes("check:migration-ledger"),
  "18.8: post-deploy bez check:migration-ledger",
);
for (const f of [".github/workflows/scheduler.yml", ".github/workflows/billing-nightly.yml"])
  assert(T.sha(f) !== undefined, `18.8: brak ${f}`);
// N-19-1 i N-16-1 naprawione (18.10).
assert(
  plik("src/lib/admin/invitations.functions.ts").includes(
    'const USER_ROLES_CONFLICT_TARGET = "tenant_id,user_id,role";',
  ),
  "N-19-1: cel konfliktu ról zmieniony - przepisać 18.10",
);
assert(
  supabase("20261004090000_club_log_vocabulary_covers_writers.sql").includes("'club_updated'"),
  "N-16-1: brak club_updated w słowniku dziennika klubu",
);

/* --- 18.9: liczby defektów z danych --- */
{
  const D = json("defekty14.json");
  const ile = (w) => D.filter((x) => x.waga === w).length;
  wDokumencie(
    `**${D.length} defektów**: krytyczny ${ile("krytyczny")}, wysokich ${ile("wysoki")}, średnich ${ile("sredni")}, niskich ${ile("niski")}`,
  );
  rowne(
    tabelaPod(sekcja(9), /^\|\s*ID\s*\|\s*Waga\s*\|/).length,
    D.length,
    "18.9: wiersze tabeli defektów",
  );
}

/* --- 18.10: rejestr; pozycje zamknięte mechanicznie naprawdę leżą w plikach bez zmian --- */
{
  const R = json("rejestr-stan14.json");
  const ile = (s) => R.filter((x) => x.stan14 === s).length;
  const tab = tabelaPod(sekcja(10), /^\|\s*Źródło\s*\|\s*Naprawione/);
  const razem = tab.find((w) => w[0] === "Razem");
  rowne(
    `${ile("naprawiony")} / ${ile("zmieniony")} / ${ile("otwarty")} / ${R.length}`,
    razem?.slice(1).join(" / "),
    "18.10: wiersz Razem",
  );
  const mech = R.filter((x) => x.zrodloStanu.startsWith("mechanicznie"));
  for (const x of mech)
    assert(
      E13.sha(x.plik) !== undefined && E13.sha(x.plik) === P14.sha(x.plik),
      `18.10: ${x.id} - ${x.plik} zmienił się w oknie`,
    );
  wDokumencie(`${mech.length} pozycji w plikach, których okno nie dotknęło`);
  wDokumencie(
    `**Otwartych wysokich jest ${R.filter((x) => x.stan14 === "otwarty" && x.waga === "wysoki").length}**`,
  );
  for (const id of ["N-19-1", "N-16-1"])
    rowne(R.find((x) => x.id === id)?.stan14, "naprawiony", `18.10: ${id}`);
}

/* --- 18.12: PSI ze zrzutów, mediany Lighthouse z raportów, fakty w kodzie za przyczynami --- */
{
  const L = json("lighthouse/podsumowanie14.json");
  const tab = new Map(tabelaPod(sekcja(12), /^\|\s*Profil\s*\|\s*Wydajność/).map((w) => [w[0], w]));
  const d = L.psiZrzuty.desktop;
  const m = L.psiZrzuty.mobile;
  rowne(
    `${d.wydajnosc} ${d.ulatwienia} ${d.sprawdzoneMetody} ${d.seo} ${d.SI}`,
    [1, 2, 3, 4].map((i) => tab.get("PSI desktop")?.[i]).join(" ") +
      ` ${tab.get("PSI desktop")?.[9]?.split(" (")[0]}`,
    "18.12: PSI desktop",
  );
  rowne(
    `${m.wydajnosc} ${m.ulatwienia} ${m.sprawdzoneMetody} ${m.seo} ${m.SI}`,
    [1, 2, 3, 4].map((i) => tab.get("PSI mobile (Moto G Power, 4G)")?.[i]).join(" ") +
      ` ${tab.get("PSI mobile (Moto G Power, 4G)")?.[9]?.split(" (")[0]}`,
    "18.12: PSI mobile",
  );
  for (const [profil, nazwa] of [
    ["desktop", "Lighthouse lokalnie, desktop (mediana z 5)"],
    ["mobile", "Lighthouse lokalnie, mobile (mediana z 5)"],
  ]) {
    const przebiegi = L.przebiegi.filter(
      (p) => p.plik.startsWith("raporty/mediana-") && p.formFactor === profil,
    );
    rowne(przebiegi.length, 5, `18.12: przebiegi ${profil}`);
    const si = mediana(przebiegi.map((p) => p.metryki["speed-index"].ms));
    const perf = mediana(przebiegi.map((p) => p.kategorie.performance));
    const w = tab.get(nazwa);
    rowne(String(Math.round(perf)), w?.[1], `18.12: mediana wydajności ${profil}`);
    assert(
      w?.[9]?.startsWith(`${pl(si / 1000, 1)} s`),
      `18.12: mediana SI ${profil} ${pl(si / 1000, 1)} s`,
    );
  }
  const slad = (f) =>
    L.przebiegi.find((p) => p.plik === `slad/pl-${f}.json`)?.metryki["speed-index"].ms;
  assert(
    Math.abs(0.575 * 5713 + 0.492 * 1823 - slad("desktop")) < 1,
    "18.12: wzór SI desktop nie odtwarza śladu z dokładnością 1 ms",
  );
  assert(
    Math.abs(1.4 * 2965 + 0.4 * 4326 - slad("mobile")) < 1,
    "18.12: wzór SI mobile nie odtwarza śladu z dokładnością 1 ms",
  );
  assert(
    plik("src/routes/index.tsx").includes(
      "remainingHomeBudget(deadlineAt, HOME_ABOVE_FOLD_BUDGET_MS)",
    ),
    "18.12: budżet rozgrzewki hero liczony inaczej - przepisać przyczynę 2",
  );
  const budzet = plik("src/lib/ssr/homeSsrBudget.ts");
  assert(
    budzet.includes("HOME_SSR_BUDGET_MS = 600;") &&
      budzet.includes("HOME_ABOVE_FOLD_BUDGET_MS = 500;"),
    "18.12: budżety SSR strony głównej zmienione",
  );
  assert(
    plik("src/lib/http/documentCache.server.ts").includes(
      "const [toClient, toCache] = response.body.tee();",
    ),
    "18.12: cache dokumentu nie zapisuje już tee strumienia",
  );
  assert(
    plik("src/lib/builder/sectionStreaming.tsx").includes("On a cache HIT it is never seen"),
    "18.12: komentarz o HIT zmieniony",
  );
  assert(
    plik("src/lib/http/mediaCache.server.ts").includes(
      'url.searchParams.set("accept", request.headers.get("accept") ?? "");',
    ),
    "18.12: klucz cache /media nie zawiera już surowego Accept",
  );
  {
    const c = plik("src/lib/http/cachePolicy.ts");
    assert(
      /PUBLIC_CONTENT_S_MAXAGE = 900;/.test(c) && /CHROME_DEGRADED_S_MAXAGE = 30;/.test(c),
      "18.12: polityki świeżości dokumentu zmienione",
    );
  }
  {
    const h = plik("src/components/Header.tsx");
    const odczyt = h.indexOf(
      "const slack = document.documentElement.scrollHeight - window.innerHeight;",
    );
    const wywolanie = h.indexOf("    evaluate();\n", odczyt);
    assert(
      odczyt > 0 && wywolanie > odczyt,
      "18.12: Header.tsx nie czyta już scrollHeight w pierwszym evaluate()",
    );
  }
}

/* --- struktura rozdziału 18, plan 18.13, nagłówek dokumentu --- */
for (let i = 1; i <= 15; i++)
  assert(ROZDZIAL.includes(`### 18.${i}.`), `rozdział 18: brak sekcji 18.${i}`);
for (const zly of ["—", "–"]) {
  assert(!ROZDZIAL.includes(zly), `rozdział 18 zawiera znak U+${zly.charCodeAt(0).toString(16)}`);
  assert(
    !docSurowy.slice(0, docSurowy.indexOf("## Wydanie 13 (2026-10-04)")).includes(zly),
    `nagłówek wydania 14 zawiera znak U+${zly.charCodeAt(0).toString(16)}`,
  );
}
assert(
  docSurowy.startsWith(
    "# Audyt pokrycia testami: moduł po module, funkcja po funkcji (2026-10-18)",
  ),
  "H1 dokumentu bez daty wydania 14",
);
assert(
  docSurowy.includes("\n## Wydanie 13 (2026-10-04) - nagłówek poprzedniego wydania\n"),
  "nagłówek wydania 13 nie przeniesiony",
);
{
  const plan = sekcja(13);
  const pozycje = [...plan.matchAll(/^\d+\. (.*)$/gm)].map((m) => m[1]);
  rowne(pozycje.length, 8, "pozycje planu 18.13");
  assert(
    pozycje.every((p) => /^\*\*[^*]{6,}\*\* /.test(p)),
    "18.13: pozycja planu bez tytułu",
  );
}

/* --- README: tabela metryk, każdy wiersz osobno w części polskiej i angielskiej --- */
{
  const mapaModulow = path.join(os.tmpdir(), `moduleMap-ed14-readme-${process.pid}.mjs`);
  fs.writeFileSync(mapaModulow, T.czytaj("scripts/taxonomy/moduleMap.mjs"));
  const { MODULES, CROSS_CUTTING } = await import(pathToFileURL(mapaModulow).href);
  fs.rmSync(mapaModulow, { force: true });
  const e2e = tabelaPod(sekcja(2), /^\|\s*Metryka\s*\|\s*Wydanie 13/)
    .find((w) => w[0] === "Testy e2e / pliki / konfiguracje")?.[2]
    ?.split(" / ")
    .map(Number) ?? [NaN, NaN, NaN];
  const METRYKI = [
    ["Moduły domenowe", "Domain modules", [MODULES.length, CROSS_CUTTING.length]],
    ["Udokumentowane funkcjonalności", "Documented functionalities", [FUN.wiersze.length]],
    ["Pliki kodu produkcyjnego", "Production source files", [MT.prod.length, MT.prodLines]],
    ["Pliki testowe", "Test files", [MT.testy.length]],
    ["Testy warstwy danych (pgTAP)", "Data-layer tests (pgTAP)", [MT.pgtap, MT.asercje]],
    [
      "Testy ścieżek użytkownika (Playwright)",
      "User-journey tests (Playwright)",
      [e2e[1], e2e[0], MT.playwright],
    ],
    ["Bramki jakości w CI (`check:*`)", "Quality gates in CI (`check:*`)", [MT.bramkiCi]],
    [
      "Migracje bazy danych",
      "Database migrations",
      [MT.migracjeSupabase.length, MT.migracjeDrizzle.length],
    ],
    [
      "Polityki RLS w stanie końcowym",
      "RLS policies in final state",
      [MT.polityki, MT.tabeleZPolitykami],
    ],
  ];
  const LICZBY = { PL: /\d{1,3}(?: \d{3})+|\d+/g, EN: /\d{1,3}(?:,\d{3})+|\d+/g };
  const naLiczbe = (s) => Number(s.replace(/[\s,]/g, ""));
  for (const [jezyk, kolumna, naglowek] of [
    ["PL", 0, /^\|\s*Wymiar\s*\|\s*Stan\s*\|/],
    ["EN", 1, /^\|\s*Dimension\s*\|\s*State\s*\|/],
  ]) {
    const tabela = new Map(tabelaPod(czesciReadme[jezyk], naglowek).map(([k, v]) => [k, v]));
    assert(
      tabela.size === METRYKI.length,
      `README (${jezyk}): tabela metryk ma ${tabela.size} wierszy, skrypt sprawdza ${METRYKI.length}`,
    );
    for (const metryka of METRYKI) {
      const e = etykieta(metryka[kolumna]);
      const stan = tabela.get(e);
      const repo = metryka[2].join(" / ");
      const mowi =
        stan === undefined
          ? "brak wiersza"
          : [...stan.matchAll(LICZBY[jezyk])].map((m) => naLiczbe(m[0])).join(" / ");
      assert(mowi === repo, `README (${jezyk}) „${e}": drzewo daje ${repo}, README mówi ${mowi}`);
    }
  }
  wReadme("PL", "(HEAD `346012635`, scalenie PR #518)");
  wReadme("EN", "(HEAD `346012635`, the merge of PR #518)");
  wReadme("PL", "(wydanie 14)");
  wReadme("EN", "(edition 14)");
}

console.log(
  `Weryfikacja wydania 14 (${T.opis}): ${zielone} zielonych, ${czerwone.length} czerwonych.`,
);
for (const c of czerwone) console.log(`  ✗ ${c}`);
if (czerwone.length) process.exit(1);
