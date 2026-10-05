/**
 * Weryfikacja liczb i stanów wydania 13 audytu (rozdział 17) wobec drzewa, które to wydanie zmierzyło.
 *
 * PO CO TO ISTNIEJE. Rozdział 17 twierdzi rzeczy o drzewie `5b8c77c01`: ile jest plików, wierszy,
 * progów, migracji, polityk RLS i asercji pgTAP, co przyszło w oknie od wydania 12 (`b8b53ae5`),
 * w jakim stanie są znaleziska Z1-Z10 i defekty z rejestru. Weryfikator wydania 12 czytał katalog
 * roboczy, więc robił się czerwony po pierwszym PR-ze, który dotknął którejkolwiek liczby - i nie dało
 * się odróżnić „dokument kłamie" od „repozytorium poszło dalej".
 *
 * DLATEGO DWA TRYBY.
 *   bun scripts/audit/verify-edition-13.mjs          czyta drzewa `5b8c77c01` i `b8b53ae5` z obiektów
 *                                                    gita (`git ls-tree` + `git cat-file --batch`).
 *                                                    Działa na każdej gałęzi, która ma ten commit
 *                                                    w historii. Czerwień = dokument nie zgadza się
 *                                                    z drzewem, które opisuje.
 *   bun scripts/audit/verify-edition-13.mjs --zywe   twierdzenia o stanie sprawdza na bieżącym
 *                                                    katalogu roboczym (pliki śledzone i nieignorowane).
 *                                                    Czerwień = repozytorium poszło dalej i rozdział 17
 *                                                    trzeba przepisać, a nie że coś się zepsuło.
 * Drzewo wydania 12 i historia okna (commity, scalenia) zawsze pochodzą z obiektów gita.
 *
 * Asercje pgTAP, polityki RLS i komentarze SQL liczą BIBLIOTEKI REPOZYTORIUM z bieżącej gałęzi
 * (`analyzePgTapFile`, `extractLatestPolicies`, `stripSqlComments`) na treści plików z drzewa pomiaru.
 * Liczb pokrycia skrypt nie powtarza (wymagają pełnego przebiegu suity, 17.4) - sprawdza tylko, czy
 * dokument i README podają te same. Dane rejestru, defektów i rynku czyta z `docs/audyt-ed13/`.
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
const DANE = `${ROOT}/docs/audyt-ed13`;
const REWIZJA_POMIARU = "5b8c77c01";
const REWIZJA_ED12 = "b8b53ae5";
const ZYWE = process.argv.includes("--zywe");

const git = (args, opcje = {}) => {
  const r = spawnSync("git", args, { cwd: ROOT, maxBuffer: 1 << 30, ...opcje });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${String(r.stderr).trim()}`);
  return r.stdout;
};
for (const rewizja of [REWIZJA_POMIARU, REWIZJA_ED12]) {
  const r = spawnSync("git", ["cat-file", "-e", `${rewizja}^{commit}`], { cwd: ROOT });
  if (r.status !== 0) {
    console.error(
      `Brak commita ${rewizja} w tym klonie - pobierz historię (np. git fetch --unshallow) i uruchom ponownie.`,
    );
    process.exit(2);
  }
}

/* --- drzewa: obiekty gita albo katalog roboczy, jeden interfejs --- */
// Treść czytam partiami przez jedno `git cat-file --batch` na partię: pliki źródłowe to kilka
// tysięcy obiektów, a `git show` na plik to kilka tysięcy procesów.
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
const T = ZYWE ? drzewoZywe() : drzewoGita(REWIZJA_POMIARU);
const E12 = drzewoGita(REWIZJA_ED12);

/* --- asercje i dokument --- */
const norm = (s) =>
  String(s)
    .replace(/\u00a0/g, " ")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ");
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
// Wiersze tabeli markdown spod wiersza nagłówka pasującego do `naglowek` (bez nagłówka i separatora),
// komórki po norm(). Tabela kończy się na pierwszej linii, która nie zaczyna się od `|`.
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
// Etykieta wiersza w tej samej postaci co pierwsza komórka z tabelaPod (bez gwiazdek i backticków).
const wiersz = (tabela, etykieta) => tabela.get(norm(etykieta).replace(/`/g, "").trim());
// Liczba po polsku: separator tysięcy to spacja, przecinek dziesiętny.
const pl = (n, miejsca) =>
  (miejsca === undefined ? String(n) : n.toFixed(miejsca))
    .replace(".", ",")
    .replace(/^(-?\d+)/, (c) => c.replace(/\B(?=(\d{3})+(?!\d))/g, " "));
const json = (rel) => JSON.parse(fs.readFileSync(`${DANE}/${rel}`, "utf8"));

/* --- 17.2: skala na obu drzewach, jedna definicja --- */
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
const { analyzePgTapFile, isPgTapFileBroken } = await import(`${ROOT}/src/lib/ci/pgTapPlan.ts`);
const { extractLatestPolicies } = await import(`${ROOT}/src/lib/ci/rlsPolicies.ts`);
const { stripSqlComments } = await import(`${ROOT}/scripts/lib/sqlMigrations.ts`);

// Blok `thresholds` z vitest.config.ts: klucze per ścieżka, ich wartości i próg globalny.
const progiZ = (cfg) => {
  const j = cfg.indexOf("{", cfg.indexOf("thresholds"));
  let glebokosc = 0;
  let k = j;
  for (; k < cfg.length; k++) {
    if (cfg[k] === "{") glebokosc++;
    else if (cfg[k] === "}" && --glebokosc === 0) break;
  }
  const blok = cfg.slice(j, k + 1);
  const wartosci = new Map();
  for (const m of blok.matchAll(/^\s*"((?:[^"\\]|\\.)+)":\s*\{([^}]*)\}/gm)) {
    const klucz = JSON.parse(`"${m[1]}"`);
    if (!klucz.includes("/") && !klucz.includes("*")) continue;
    const metryka = (nazwa) => Number(m[2].match(new RegExp(`${nazwa}:\\s*([\\d.]+)`))?.[1] ?? NaN);
    wartosci.set(klucz, ["statements", "functions", "lines", "branches"].map(metryka));
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
  return { wartosci, globalne };
};
const BAZY = {
  clockFreeze: "scripts/lib/clockFreezeBaseline.ts",
  i18nHardcoded: "scripts/lib/i18nHardcodedBaseline.ts",
  i18nOverlayImport: "scripts/lib/i18nOverlayImportBaseline.ts",
  unknownCast: "scripts/lib/unknownCastBaseline.ts",
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
    skip: 0,
    todo: 0,
    only: 0,
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
      m.skip += (t.match(/\b(it|test|describe)\.skip(If)?\s*\(/g) ?? []).length;
      m.todo += (t.match(/\b(it|test)\.todo\s*\(/g) ?? []).length;
      m.only += (t.match(/\b(it|test|describe)\.only\s*\(/g) ?? []).length;
    } else {
      m.prod.push(f);
      m.prodLines += wiersze(t);
      if (f.startsWith("src/routes/") && !f.endsWith("routeTree.gen.ts")) m.routes++;
      if (/^src\/components\/ui\/[^/]+\.tsx$/.test(f)) m.uiComponents++;
    }
  }
  const pkg = JSON.parse(d.czytaj("package.json"));
  const skrypty = Object.keys(pkg.scripts ?? {});
  m.scripts = skrypty.length;
  m.checkScripts = skrypty.filter((s) => s.startsWith("check:")).length;
  m.ciModules = wKatalogu(d, "src/lib/ci", /\.ts$/).length;
  m.gateTests = zrodla.filter((f) => /\.gate\.test\.(ts|tsx)$/.test(f)).length;
  m.migracjeSupabase = wKatalogu(d, "supabase/migrations", /\.sql$/).sort();
  m.migracjeDrizzle = wKatalogu(d, "drizzle/migrations", /\.sql$/).sort();
  m.workflows = wKatalogu(d, ".github/workflows", /\.ya?ml$/).length;
  m.docs = wKatalogu(d, "docs", /\.md$/).length;
  m.playwright = d.pliki.filter((p) => /^playwright\..*config\.ts$/.test(p)).length;
  const pgtap = wKatalogu(d, "supabase/tests", /\.sql$/);
  const analizy = pgtap.map((f) => analyzePgTapFile(path.basename(f), d.czytaj(f)));
  m.pgtap = pgtap.map((f) => path.basename(f));
  m.asercje = analizy.reduce((s, a) => s + a.counted, 0);
  m.pgtapZepsute = analizy.filter(isPgTapFileBroken).map((a) => a.file);
  const polityki = extractLatestPolicies(
    m.migracjeSupabase.map((f) => ({ file: path.basename(f), sql: stripSqlComments(d.czytaj(f)) })),
  );
  m.polityki = polityki.size;
  m.tabeleZPolitykami = new Set([...polityki.values()].map((p) => p.table)).size;
  const cfg = d.czytaj("vitest.config.ts");
  const { wartosci, globalne } = progiZ(cfg);
  m.progi = wartosci;
  m.progGlobalny = globalne;
  const dopasowania = [...wartosci.keys()].map((k) => [k, picomatch(k, { dot: true })]);
  // Nie `.filter(dopasuj)`: Array.filter podaje indeks jako drugi argument, a picomatch czyta go jako returnState.
  m.martweProgi = dopasowania
    .filter(([, dopasuj]) => !m.prod.some((f) => dopasuj(f)))
    .map(([k]) => k);
  m.podProgiem = m.prod.filter((f) => dopasowania.some(([, dopasuj]) => dopasuj(f))).length;
  m.bazy = Object.fromEntries(
    Object.entries(BAZY).map(([nazwa, plik]) => {
      const wpisy = [...d.czytaj(plik).matchAll(/^\s*\["([^"]+)",\s*(\d+)\]/gm)];
      return [
        nazwa,
        {
          wpisy: wpisy.length,
          suma: wpisy.reduce((s, w) => s + Number(w[2]), 0),
          mapa: new Map(wpisy.map((w) => [w[1], Number(w[2])])),
        },
      ];
    }),
  );
  m.cfg = cfg;
  return m;
};
const MT = metryki(T);
const M12 = metryki(E12);

// Tabela 17.2: każda komórka obu kolumn porównana z drzewem, z którego pochodzi.
{
  const tabela = new Map(
    tabelaPod(odNaglowka("### 17.2.", "### 17.3."), /^\|\s*Metryka\s*\|\s*Wydanie 12/).map((w) => [
      w[0],
      w,
    ]),
  );
  const procent = (m) => `${pl(m.podProgiem)} (${pl((100 * m.podProgiem) / m.prod.length, 2)}%)`;
  const WIERSZE = [
    ["Pliki kodu produkcyjnego", (m) => pl(m.prod.length)],
    ["Wiersze kodu produkcyjnego", (m) => pl(m.prodLines)],
    ["Pliki testowe", (m) => pl(m.testy.length)],
    ["Wiersze testów", (m) => pl(m.testLines)],
    ["Przypadki testowe (skan statyczny)", (m) => pl(m.cases)],
    ["Wywołania expect (skan statyczny)", (m) => pl(m.expects)],
    ["Pliki testowe bez atrapy vi.*", (m) => pl(m.noMockTests)],
    ["Trasy (pliki w src/routes)", (m) => pl(m.routes)],
    ["Komponenty design systemu (components/ui)", (m) => pl(m.uiComponents)],
    ["Skrypty package.json / bramki check:*", (m) => `${m.scripts} / ${m.checkScripts}`],
    ["Moduły src/lib/ci", (m) => pl(m.ciModules)],
    ["Bramki-testy *.gate.test.*", (m) => pl(m.gateTests)],
    ["Migracje supabase/migrations", (m) => pl(m.migracjeSupabase.length)],
    ["Migracje drizzle/migrations (SQL)", (m) => pl(m.migracjeDrizzle.length)],
    ["Pliki pgTAP / asercje (analizator repo)", (m) => `${pl(m.pgtap.length)} / ${pl(m.asercje)}`],
    [
      "Polityki RLS / tabele z politykami (repo)",
      (m) => `${pl(m.polityki)} / ${pl(m.tabeleZPolitykami)}`,
    ],
    ["Progi pokrycia per ścieżka (martwe)", (m) => `${pl(m.progi.size)} (${m.martweProgi.length})`],
    ["Pliki produkcyjne pod progiem per ścieżka", procent],
    ["Wpisy it.fails / plików", (m) => `${pl(m.fails)} / ${pl(m.failsPliki)}`],
    ["Przepływy GitHub Actions", (m) => pl(m.workflows)],
    ["Dokumenty w docs/", (m) => pl(m.docs)],
  ];
  for (const [etykieta, wartosc] of WIERSZE) {
    const w = wiersz(tabela, etykieta);
    if (!w) {
      assert(false, `17.2: brak wiersza „${etykieta}"`);
      continue;
    }
    rowne(wartosc(M12), w[1], `17.2 „${etykieta}", wydanie 12 (${REWIZJA_ED12})`);
    rowne(wartosc(MT), w[2], `17.2 „${etykieta}", wydanie 13 (${T.opis})`);
  }
  // Testy Playwrighta liczy `playwright test --list` (17.10), którego skrypt nie powtarza;
  // sprawdza konfiguracje i to, że wiersz mówi o nich to samo.
  const e2e = wiersz(tabela, "Testy e2e / pliki / konfiguracje");
  assert(
    e2e?.[2]?.endsWith(` / ${MT.playwright}`),
    `17.2: konfiguracji Playwrighta jest ${MT.playwright}`,
  );
  assert(
    e2e?.[1]?.endsWith(` / ${M12.playwright}`),
    `17.2: konfiguracji Playwrighta w wydaniu 12 było ${M12.playwright}`,
  );
}

/* --- okno: historia i pliki (17.2, 17.3) --- */
const OKNO = `${REWIZJA_ED12}..${REWIZJA_POMIARU}`;
assert(
  spawnSync("git", ["merge-base", "--is-ancestor", REWIZJA_ED12, REWIZJA_POMIARU], { cwd: ROOT })
    .status === 0,
  "historia okna nie jest ciągła: b8b53ae5 nie jest przodkiem 5b8c77c01",
);
rowne(
  Number(git(["rev-list", "--count", OKNO], { encoding: "utf8" }).trim()),
  402,
  "commity w oknie",
);
rowne(
  Number(git(["rev-list", "--count", "--merges", OKNO], { encoding: "utf8" }).trim()),
  117,
  "scalenia w oknie",
);
{
  const numery = [
    ...git(["log", "--merges", "--format=%s", OKNO], { encoding: "utf8" }).matchAll(
      /Merge pull request #(\d+)/g,
    ),
  ].map((m) => Number(m[1]));
  rowne(`#${Math.min(...numery)}-#${Math.max(...numery)}`, "#427-#466", "zakres PR-ów w oknie");
  wDokumencie("W oknie są 402 commity (117 scaleń, PR-y #427-#466)");
}
{
  const przed = new Set(M12.prod);
  const po = new Set(MT.prod);
  const nowe = MT.prod.filter((f) => !przed.has(f));
  const usuniete = M12.prod.filter((f) => !po.has(f)).sort();
  rowne(nowe.length, 68, "nowe pliki produkcyjne w oknie");
  rowne(
    usuniete.join(", "),
    [
      "src/components/ui/download-button.tsx",
      "src/components/ui/form-link.tsx",
      "src/lib/i18n-admin-event-sessions.ts",
      "src/lib/i18n-download-button.ts",
      "src/lib/icons/DynamicIconFull.tsx",
    ].join(", "),
    "usunięte pliki produkcyjne",
  );
  wDokumencie("### 17.3. Co przyszło: 68 nowych plików i pięć usuniętych");
}

/* --- 17.7: znaleziska wydania 11 po kodzie --- */
const tylkoT = (plik) => T.czytaj(plik);
const bezZmianWOknie = (plik) => E12.sha(plik) !== undefined && E12.sha(plik) === T.sha(plik);
// Z1 częściowo: DEFAULT false w obu pasach, hurtowy flip z 0001 w repo, opis w rejestrze pasów bez poprawki.
assert(
  tylkoT("drizzle/migrations/0011_profiles_discoverable_opt_in_restore.sql") ===
    tylkoT("supabase/migrations/20260913150000_profiles_discoverable_opt_in_restore.sql"),
  "Z1: 0011 nie jest bajt w bajt bliźniakiem 20260913150000",
);
assert(
  /SET discoverable = true/.test(
    tylkoT("drizzle/migrations/0001_profiles_discoverable_default_true.sql"),
  ),
  "Z1: 0001 bez hurtowego UPDATE - przepisać 17.7",
);
assert(
  tylkoT("src/lib/ci/migrationLaneParity.ts").includes(
    "Stan naprawia forward-only 0011 (DEFAULT false)",
  ),
  "Z1: opis 0001 w rejestrze pasów poprawiony - przepisać 17.7",
);
// Z2 częściowo z regresją: porównanie najemców jest, a cel konfliktu roli nie ma indeksu w bazie.
{
  const inv = tylkoT("src/lib/admin/invitations.functions.ts");
  assert(
    inv.includes('throw new Error("account_in_other_tenant")'),
    "Z2: brak porównania najemców w performSend",
  );
  rowne(
    (inv.match(/onConflict: "user_id,role", ignoreDuplicates: true/g) ?? []).length,
    2,
    "N-19-1: upserty user_roles z celem konfliktu (user_id, role) w performSend i provisionTeamMembers",
  );
  assert(
    inv.includes("throw new Error(`role_write_failed:${roleWriteError.message}`)"),
    "N-19-1: błąd zapisu roli nie przerywa już wysyłki - przepisać 17.7 i 17.8",
  );
  const zdjecie = "supabase/migrations/20260531181120_d76ba039-9c35-4128-a979-7dd406a536e1.sql";
  const m = tylkoT(zdjecie);
  assert(
    m.includes(
      "ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;",
    ) && m.includes("ON public.user_roles (tenant_id, user_id, role);"),
    "N-19-1: migracja 20260531181120 nie zdejmuje już UNIQUE (user_id, role)",
  );
  // Żaden plik migracji w żadnym pasie nie stawia potem UNIQUE / PRIMARY KEY na (user_id, role) w user_roles.
  const pozniej = [
    ...MT.migracjeSupabase.filter((f) => path.basename(f) > path.basename(zdjecie)),
    ...MT.migracjeDrizzle,
  ].filter((f) =>
    stripSqlComments(T.czytaj(f))
      .split(";")
      .some(
        (s) =>
          /user_roles/i.test(s) &&
          /\b(UNIQUE|PRIMARY\s+KEY)\b/i.test(s) &&
          /\(\s*user_id\s*,\s*role\s*\)/i.test(s),
      ),
  );
  rowne(pozniej.join(", "), "", "N-19-1: migracje przywracające unikalność (user_id, role)");
}
// Z3 częściowo: bliźniacze uzbrojenie runnera z hosta żądania.
assert(
  /ensureJobRunnerArmed\(getOrigin\(\)\)/.test(tylkoT("src/lib/admin/scheduler.functions.ts")),
  "Z3: bliźniacze uzbrojenie runnera zniknęło - przepisać 17.7",
);
// Z4 częściowo: alert o sporze naprawiony, stempel poczty z rozstrzygnięcia adresu - bez zmian.
assert(
  tylkoT("src/lib/billing/refunds.server.ts").includes("await notifyTenantAdmins({"),
  "Z4: alert o sporze nie idzie przez notifyTenantAdmins",
);
assert(
  /tenant_id: gate\.tenantId/.test(tylkoT("src/routes/platform/email/transactional/send.ts")),
  "Z4: send.ts nie stempluje już gate.tenantId - przepisać 17.7",
);
// Z5-Z7 naprawione w wydaniu 12 i nietknięte w oknie.
assert(
  /const MAX_TICKS = 1000;/.test(tylkoT("src/lib/charts/scale.ts")),
  "Z5: brak sufitu MAX_TICKS",
);
assert(
  tylkoT(".github/workflows/ci.yml").includes("bun run check:dangerous-html"),
  "Z6: check:dangerous-html poza ci.yml",
);
{
  const z7 = "supabase/migrations/20260912180000_impersonation_tenant_scope.sql";
  assert(
    /tenant_id = \(select public\.current_tenant_id\(\)\)\s*AND \(select public\.is_super_admin\(\)\)/.test(
      tylkoT(z7),
    ),
    "Z7: brak wiązania najemcy w polityce dziennika impersonacji",
  );
  const redefinicje = [...MT.migracjeSupabase, ...MT.migracjeDrizzle].filter(
    (f) =>
      T.czytaj(f).includes("super_admin_read_impersonation") &&
      ![z7, "drizzle/migrations/0006_impersonation_tenant_scope.sql"].includes(f) &&
      path.basename(f) > "20260912180000",
  );
  rowne(
    redefinicje.join(", "),
    "",
    "Z7: późniejsze redefinicje polityki super_admin_read_impersonation",
  );
}
if (!ZYWE) {
  for (const plik of [
    "src/lib/charts/scale.ts",
    "supabase/migrations/20260912180000_impersonation_tenant_scope.sql",
  ]) {
    assert(bezZmianWOknie(plik), `Z5/Z7: ${plik} zmienił się w oknie - przepisać 17.7`);
  }
}
// Z8 częściowo: redakcja jest, PESEL przechodzi z woli testu, lustro GA4 przed bramką zgody.
{
  const t = tylkoT("src/lib/analytics/track.ts");
  assert(
    t.includes('entityId: (redactPii(q) ?? "")'),
    "Z8: fraza do GA4 nie idzie przez redactPii",
  );
  assert(
    t.indexOf("mirrorToGa4(mirrored);") > 0 &&
      t.indexOf("mirrorToGa4(mirrored);") < t.indexOf("if (!hasAnalyticsConsent()) return;"),
    "Z8: lustro GA4 nie stoi już przed bramką zgody - przepisać 17.7",
  );
  assert(
    tylkoT("src/lib/observability/__tests__/redact.test.ts").includes('"PESEL 90010112345",'),
    "Z8: test nie przypina już przepuszczania PESEL - przepisać 17.7",
  );
}
// Z9 otwarte: nieprawdziwe zdanie w konfiguracji i strażnik niepustości.
assert(
  MT.cfg.includes("w CI, z prawdziwymi poświadczeniami, przechodzą"),
  "Z9: zdanie o CI zniknęło z vitest.config.ts",
);
assert(
  /const shouldRun = Boolean\(SUPABASE_URL && SUPABASE_KEY\);/.test(
    tylkoT("src/__tests__/db-schema-invariant.test.ts"),
  ),
  "Z9: strażnik db-schema-invariant zmieniony - przepisać 17.7",
);
// Z10 otwarte: zamrożenie per plik; podcastEpisodeRoute zszedł z linii bazowej (6 -> 0) bez zamrożenia.
assert(
  /if \(FREEZE\.test\(code\)\)/.test(tylkoT("src/lib/ci/clockFreeze.ts")),
  "Z10: clockFreeze nie sprawdza już per plik",
);
{
  const sciezka = "src/routes/__tests__/podcastEpisodeRoute.test.tsx";
  rowne(
    M12.bazy.clockFreeze.mapa.get(sciezka),
    6,
    "Z10: podcastEpisodeRoute w linii bazowej wydania 12",
  );
  rowne(
    MT.bazy.clockFreeze.mapa.has(sciezka),
    false,
    "Z10: podcastEpisodeRoute w linii bazowej wydania 13",
  );
}
wDokumencie("Plan naprawczy wydania 12 (16.15): 3 pozycje z 14 wykonane, 3 częściowo, 8 nie.");

/* --- 17.8: nowe defekty - wysokie po kodzie, liczby z danych --- */
{
  const ustawienia = "supabase/migrations/20261003170000_club_cover_write_follows_capabilities.sql";
  assert(
    tylkoT(ustawienia).includes("'club_updated'"),
    "N-16-1: club_update_settings nie wpisuje już club_updated",
  );
  const ostatniCheck = MT.migracjeSupabase
    .filter((f) => T.czytaj(f).includes("ADD CONSTRAINT club_moderation_log_action_check"))
    .pop();
  rowne(
    ostatniCheck,
    "supabase/migrations/20260808290000_discussion_clubs_a27_segment_invitations.sql",
    "N-16-1: ostatnia definicja club_moderation_log_action_check",
  );
  const zClubUpdated = [...MT.migracjeSupabase, ...MT.migracjeDrizzle].filter(
    (f) =>
      /club_moderation_log_action_check/.test(T.czytaj(f)) && /'club_updated'/.test(T.czytaj(f)),
  );
  rowne(zClubUpdated.join(", "), "", "N-16-1: migracje dopisujące club_updated do CHECK");
  assert(
    /overall:\s*4772,/.test(tylkoT("scripts/check-bundle-size.ts")),
    "N-CI-1: budżet overall w check-bundle-size.ts nie wynosi już 4772 KB",
  );
  const D = json("defekty13.json");
  const liczba = (werdykt, waga) =>
    D.filter((d) => d.werdykt === werdykt && (!waga || d.waga === waga)).length;
  rowne(liczba("POTWIERDZONY"), 79, "potwierdzone nowe defekty (defekty13.json)");
  rowne(
    ["wysoki", "sredni", "niski"].map((w) => liczba("POTWIERDZONY", w)).join("/"),
    "4/19/56",
    "potwierdzone wysokie/średnie/niskie",
  );
  rowne(liczba("BRAK"), 45, "zgłoszone bez próby obalenia");
  rowne(liczba("OBALONY"), 14, "obalone");
  wDokumencie(
    "Potwierdzonych po próbie obalenia: 79 - wysokich 4, średnich 19, niskich 56, krytycznych 0",
  );
  wDokumencie("Zgłoszone bez próby obalenia (45)");
  wDokumencie("Krytyk kompletności (śledztwo bez próby obalenia)");
}

/* --- 17.9: rejestr defektów wydań 11 i 12 --- */
{
  const R = json("rejestr-defektow.json");
  const S = json("rejestr-stan13.json");
  rowne(R.length, 323, "pozycje rejestru");
  const stan = (id) => S[id]?.[0];
  const ile = (st) => R.filter((r) => stan(r.id) === st).length;
  rowne(
    `${ile("naprawiony")}/${ile("zmieniony")}/${ile("otwarty")}`,
    "109/25/189",
    "rejestr: naprawione/zmienione/otwarte",
  );
  const mech = R.filter((r) => S[r.id]?.[1] === "mechanicznie");
  rowne(mech.length, 114, "otwarte rozliczone mechanicznie");
  // Reguła mechaniczna: plik pozycji bajt w bajt ten sam w obu drzewach.
  const zmienione = mech.filter((r) => !bezZmianWOknie(r.plik)).map((r) => `${r.id} ${r.plik}`);
  rowne(
    zmienione.join("; "),
    "",
    '17.9: pozycje „otwarte mechanicznie" w plikach zmienionych od wydania 12',
  );
  const krytyczne = R.filter((r) => r.waga === "krytyczny");
  rowne(
    `${krytyczne.length}/${krytyczne.filter((r) => stan(r.id) === "naprawiony").length}`,
    "7/7",
    "krytyczne w rejestrze / naprawione",
  );
  wDokumencie(
    "Dziś: naprawionych 109, zmienionych (mechanizm przebudowany, defekt w innej postaci) 25, otwartych 189",
  );
  wDokumencie("Wszystkie siedem defektów krytycznych z rejestru jest naprawionych.");
}

/* --- 17.10: progi, zapadki, bramki --- */
{
  const p12 = M12.progi;
  const p13 = MT.progi;
  const nowe = [...p13.keys()].filter((k) => !p12.has(k)).length;
  const usuniete = [...p12.keys()].filter((k) => !p13.has(k)).length;
  const wspolne = [...p13.keys()].filter((k) => p12.has(k));
  const obnizone = wspolne.filter((k) => p13.get(k).some((v, i) => v < p12.get(k)[i])).length;
  const podniesione = wspolne.filter(
    (k) =>
      p13.get(k).some((v, i) => v > p12.get(k)[i]) && !p13.get(k).some((v, i) => v < p12.get(k)[i]),
  ).length;
  rowne(
    `${nowe}/${usuniete}/${obnizone}/${podniesione}`,
    "113/0/0/26",
    "progi: nowe/usunięte/obniżone/podniesione",
  );
  rowne(
    MT.progGlobalny.join(" / "),
    "79 / 77 / 80 / 73",
    "próg globalny (instrukcje / funkcje / linie / gałęzie)",
  );
  rowne(M12.progGlobalny.join(" / "), "79 / 77 / 80 / 73", "próg globalny wydania 12");
  rowne(
    MT.martweProgi.join(", "),
    [
      "src/components/admin/analytics/ChartDataTable.tsx",
      "src/components/admin/analytics/chartTheme.ts",
      "src/components/admin/analytics/EChart.tsx",
      "src/components/admin/analytics/EChartClient.tsx",
      "src/components/admin/newsletter/deliverability/suppressionTable.ts",
    ].join(", "),
    "martwe progi",
  );
  const tabela = new Map(
    tabelaPod(odNaglowka("### 17.10.", "### 17.11."), /^\|\s*Warstwa\s*\|\s*Wydanie 12\s*\|/).map(
      (w) => [w[0], w],
    ),
  );
  for (const [nazwa, nazwaWiersza] of [
    ["clockFreeze", "Zapadka clockFreeze (wpisy / literały)"],
    ["i18nHardcoded", "Zapadka i18nHardcoded"],
    ["i18nOverlayImport", "Zapadka i18nOverlayImport"],
    ["unknownCast", "Zapadka unknownCast"],
  ]) {
    const w = wiersz(tabela, nazwaWiersza);
    const opis = (b) => `${pl(b.wpisy)} / ${pl(b.suma)}`;
    rowne(opis(M12.bazy[nazwa]), w?.[1], `17.10 ${nazwaWiersza}, wydanie 12`);
    rowne(opis(MT.bazy[nazwa]), w?.[2], `17.10 ${nazwaWiersza}, wydanie 13`);
  }
  rowne(
    `${M12.gateTests} → ${MT.gateTests}`,
    `${wiersz(tabela, "Bramki-testy *.gate.test.*")?.[1]} → ${wiersz(tabela, "Bramki-testy *.gate.test.*")?.[2]}`,
    "17.10 bramki-testy",
  );
}

/* --- 17.11: baza --- */
{
  const dziennik = (d) => JSON.parse(d.czytaj("drizzle/migrations/meta/_journal.json")).entries;
  const j12 = dziennik(E12);
  const j13 = dziennik(T);
  rowne(`${j12.length} → ${j13.length}`, "116 → 145", "wpisy dziennika _journal.json");
  const stare = new Set(j12.map((e) => e.tag));
  const noweWpisy = j13.filter((e) => !stare.has(e.tag));
  const max12 = Math.max(...j12.map((e) => e.when));
  rowne(noweWpisy.length, 29, "nowe wpisy dziennika");
  assert(
    noweWpisy.every((e, i) => e.when > max12 && (i === 0 || e.when > noweWpisy[i - 1].when)),
    "17.11: nowe wpisy dziennika nie są rosnące albo nie przekraczają maksimum wydania 12",
  );
  let maks = -Infinity;
  const ponizej = [];
  for (const e of j12) {
    if (e.when < maks) ponizej.push(e.tag.slice(0, 4));
    maks = Math.max(maks, e.when);
  }
  rowne(
    ponizej.join(", "),
    "0062, 0063, 0064, 0114, 0115",
    "wpisy sprzed okna z when mniejszym od maksimum",
  );
  const tagi = new Set(j13.map((e) => e.tag));
  const bezWpisu = MT.migracjeDrizzle
    .filter((f) => !M12.migracjeDrizzle.includes(f))
    .map((f) => path.basename(f, ".sql"))
    .filter((t) => !tagi.has(t));
  rowne(
    bezWpisu.join(", "),
    "0131_event_seat_state_single_source",
    "nowe pliki drizzle bez wpisu w dzienniku",
  );
  const nowePgTap = MT.pgtap.filter((f) => !M12.pgtap.includes(f)).length;
  rowne(nowePgTap, 22, "nowe pliki pgTAP");
  rowne(
    MT.pgtapZepsute.join(", "),
    "",
    "pgTAP: plan(N) niezgodny z asercjami albo brak plan()/finish()",
  );
  wDokumencie(
    "pgTAP: 115 → 137 plików, 2 093 → 2 678 asercji, `planned = counted` w każdym pliku, zero zepsutych",
  );
  wDokumencie(
    "Migracje: supabase 1 059 → 1 082 (+23), `drizzle/migrations` 146 → 176 (+30), dziennik `_journal.json` 116 → 145 wpisów",
  );
  const drizzleOnly = tylkoT("src/lib/ci/migrationLaneParity.ts");
  for (const tag of ["0137_", "0140_"]) {
    assert(
      new RegExp(`tag: "${tag}[^"]*",\\s*drizzleOnly:`).test(drizzleOnly),
      `17.11: ${tag} nie jest w rejestrze drizzleOnly`,
    );
  }
}

/* --- 17.12: rejestr it.fails, pominięte, sieć --- */
{
  rowne(
    `${M12.fails} / ${M12.failsPliki} → ${MT.fails} / ${MT.failsPliki}`,
    "346 / 191 → 310 / 168",
    "it.fails: wpisy / pliki",
  );
  rowne(`${MT.skip}/${MT.todo}/${MT.only}`, "1/0/0", "it.skip / it.todo / it.only");
  assert(
    /const shouldRun = /.test(tylkoT("src/__tests__/lang-parity.test.ts")) ||
      /describe\.skip/.test(tylkoT("src/__tests__/lang-parity.test.ts")),
    "Z9: lang-parity.test.ts nie przełącza się już na pominięcie bez zmiennych Supabase",
  );
  const nbp = MT.testy.filter((f) => T.czytaj(f).includes("api.nbp.pl")).length;
  rowne(nbp, 5, "pliki testów z literałem api.nbp.pl");
  assert(
    !/stubGlobal\(\s*["']fetch|globalThis\.fetch\s*=/.test(tylkoT("vitest.setup.ts")),
    "sieć: vitest.setup.ts osłania już fetch - przepisać 17.12",
  );
  assert(
    !/disableIframePageLoading|disableCSSFileLoading/.test(MT.cfg),
    "sieć: vitest.config.ts wyłącza już ładowanie zasobów happy-dom",
  );
  wDokumencie("To jedyne 50 pominiętych przypadków w 85 101.");
}

/* --- 17.4-17.6: liczby z przebiegu (dokument i README muszą mówić to samo) --- */
for (const fragment of [
  "98,84%",
  "98,32%",
  "98,00%",
  "94,02%",
  "85 101",
  "3 253",
  "**350 funkcjonalności**",
  "3 972 plikach",
]) {
  wDokumencie(fragment);
}
const funkcjonalnosci = tabelaPod(
  odNaglowka("### 17.6.", "### 17.7."),
  /^\|\s*Moduł\s*\|\s*Funkcjonalność\s*\|/,
).length;
rowne(funkcjonalnosci, 350, "funkcjonalności (wiersze tabeli 17.6)");
wReadme("PL", "98,84% linii i 98,32% funkcji");
wReadme("EN", "98.84% of lines and 98.32% of functions");

/* --- 17.14: rynek - liczby z danych pomiaru --- */
{
  const tab = json("rynek/tabela13.json");
  const nes = tab.find((r) => r.klucz === "nes");
  rowne(tab.length, 33, "witryny w porównaniu (NES + 32 ośrodki)");
  rowne(nes.suma11, 21, "NES wdrożenie K1-K11");
  rowne(tab.filter((r) => (r.suma11 ?? 0) > nes.suma11).length + 1, 13, "miejsce wdrożenia NES");
  rowne(tab.filter((r) => r.zweryfikowana).length, 23, "oceny po próbie obalenia");
  rowne(
    tab
      .filter((r) => r.K15 === 3)
      .map((r) => r.klucz)
      .sort()
      .join(", "),
    "atlanticcouncil, nes",
    "komplet nagłówków bezpieczeństwa (K15 = 3)",
  );
  // Zdolność z kodu: ocena agenta po korektach weryfikatora (tak samo liczy tabela 17.14).
  const kod = json("rynek/nes-zdolnosci.json");
  const korekty = new Map((kod.weryfikacja?.korekty ?? []).map((k) => [k.kryterium, k.powinnoByc]));
  const sumaKodu = kod.profil.oceny.reduce(
    (s, o) => s + (korekty.get(o.kryterium) ?? o.punktyZdolnosci),
    0,
  );
  rowne(sumaKodu, 30, "NES zdolność z kodu K1-K11");
  wDokumencie("Z kodu platforma zbiera 30/33");
  wDokumencie("Wdrożenie publiczne ma 21/33 i jest 13. z 33.");
}

/* --- struktura rozdziału 17 i plan 17.15 --- */
for (let i = 1; i <= 17; i++) wDokumencie(`### 17.${i}.`);
{
  const plan = odNaglowka("### 17.15.", "### 17.16.");
  const pozycje = [...plan.matchAll(/^\d+\. (.*)$/gm)].map((m) => m[1]);
  rowne(pozycje.length, 12, "pozycje planu 17.15");
  assert(
    pozycje.length > 0 && pozycje.every((p) => /^\*\*[^*]{8,}\*\* - zamyka: /.test(p)),
    '17.15: pozycja planu bez tytułu albo bez „zamyka"',
  );
}

/* --- README: tabela metryk, każdy wiersz osobno w części polskiej i angielskiej --- */
{
  const mapaModulow = (() => {
    const tresc = T.czytaj("scripts/taxonomy/moduleMap.mjs");
    const tymczasowy = path.join(os.tmpdir(), `moduleMap-ed13-${process.pid}.mjs`);
    fs.writeFileSync(tymczasowy, tresc);
    return tymczasowy;
  })();
  const { MODULES, CROSS_CUTTING } = await import(pathToFileURL(mapaModulow).href);
  fs.rmSync(mapaModulow, { force: true });
  const e2e = tabelaPod(odNaglowka("### 17.2.", "### 17.3."), /^\|\s*Metryka\s*\|\s*Wydanie 12/)
    .find((w) => w[0] === "Testy e2e / pliki / konfiguracje")?.[2]
    ?.split(" / ")
    .map(Number) ?? [NaN, NaN, NaN];
  const METRYKI = [
    ["Moduły domenowe", "Domain modules", [MODULES.length, CROSS_CUTTING.length]],
    ["Udokumentowane funkcjonalności", "Documented functionalities", [funkcjonalnosci]],
    ["Pliki kodu produkcyjnego", "Production source files", [MT.prod.length, MT.prodLines]],
    ["Pliki testowe", "Test files", [MT.testy.length]],
    ["Testy warstwy danych (pgTAP)", "Data-layer tests (pgTAP)", [MT.pgtap.length, MT.asercje]],
    [
      "Testy ścieżek użytkownika (Playwright)",
      "User-journey tests (Playwright)",
      [e2e[1], e2e[0], MT.playwright],
    ],
    ["Bramki jakości w CI (`check:*`)", "Quality gates in CI (`check:*`)", [MT.checkScripts]],
    ["Progi pokrycia per ścieżka", "Per-path coverage thresholds", [MT.progi.size]],
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
      const etykieta = norm(metryka[kolumna]).replace(/`/g, "").trim();
      const stan = tabela.get(etykieta);
      const repo = metryka[2].join(" / ");
      const mowi =
        stan === undefined
          ? "brak wiersza"
          : [...stan.matchAll(LICZBY[jezyk])].map((m) => naLiczbe(m[0])).join(" / ");
      assert(
        mowi === repo,
        `README (${jezyk}) „${etykieta}": drzewo daje ${repo}, README mówi ${mowi}`,
      );
    }
  }
  wReadme("PL", "(HEAD `5b8c77c01`)");
  wReadme("EN", "(HEAD `5b8c77c01`)");
  wReadme("PL", "(wydanie 13)");
  wReadme("EN", "(edition 13)");
}

console.log(
  `Weryfikacja wydania 13 (${T.opis}): ${zielone} zielonych, ${czerwone.length} czerwonych.`,
);
for (const c of czerwone) console.log(`  ✗ ${c}`);
if (czerwone.length) process.exit(1);
