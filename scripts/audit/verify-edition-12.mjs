/**
 * Weryfikacja liczb i stanów wydania 12 audytu wobec ŻYWEGO repozytorium.
 *
 * PO CO TO ISTNIEJE. Rozdział 16 dokumentu audytu twierdzi rzeczy o stanie repozytorium: ile jest
 * plików, progów, bramek, migracji, polityk RLS i asercji pgTAP, w jakim stanie są znaleziska
 * Z1-Z10 wydania 11 i które dziury nadal stoją. Każde z tych twierdzeń starzeje się po pierwszym
 * PR-ze, który go dotknie - i wtedy dokument zaczyna kłamać po cichu.
 *
 * Skrypt wyprowadza każdą liczbę NIEZALEŻNIE z drzewa plików, a polityki RLS i asercje pgTAP liczy
 * BIBLIOTEKAMI REPOZYTORIUM (`extractLatestPolicies`, `analyzePgTapFile`) - wydanie 11 pomyliło się
 * właśnie na tym, że liczyło pgTAP własnym wzorcem razem z komentarzami. Stany znalezisk sprawdza
 * po kodzie: asercja „dziura nadal stoi" przestaje być zielona w dniu naprawy - i to jest sygnał,
 * że dokument trzeba przepisać, nie że coś się zepsuło.
 *
 * URUCHOMIENIE:  bun scripts/audit/verify-edition-12.mjs
 * (bun, bo skrypt importuje moduły TS repozytorium). Kod wyjścia 1, gdy którakolwiek asercja jest czerwona.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOC = `${ROOT}/docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`;
const README = `${ROOT}/README.md`;

const read = (rel) => fs.readFileSync(`${ROOT}/${rel}`, "utf8");
const norm = (s) =>
  String(s)
    .replace(/\u00a0/g, " ")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ");
const walk = (dir, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!/^(node_modules|\.git)$/.test(entry.name)) walk(full, acc);
    } else acc.push(full);
  }
  return acc;
};
const lines = (t) => {
  const n = t.split("\n").length;
  return t.endsWith("\n") ? n - 1 : n;
};

const doc = norm(fs.readFileSync(DOC, "utf8"));
const readme = norm(fs.readFileSync(README, "utf8"));
let zielone = 0;
const czerwone = [];
const assert = (warunek, opis) => (warunek ? zielone++ : czerwone.push(opis));
const rowne = (jest, ma, opis) => assert(jest === ma, `${opis}: jest ${jest}, dokument mówi ${ma}`);
const wDokumencie = (fragment) =>
  assert(doc.includes(norm(fragment)), `dokument nie zawiera: ${fragment}`);
const wReadme = (fragment) =>
  assert(readme.includes(norm(fragment)), `README nie zawiera: ${fragment}`);

/* --- skala: jedna definicja (rozdz. 16.2) --- */
const isTest = (f) => /(^|\/)__tests__\/|\.test\.|\.spec\./.test(f);
const isSrc = (f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !/\.d\.ts$/.test(f);
const zrodla = walk(`${ROOT}/src`)
  .map((p) => path.relative(ROOT, p))
  .filter(isSrc);
const prod = zrodla.filter((f) => !isTest(f));
const testy = zrodla.filter(isTest);
rowne(prod.length, 4031, "pliki produkcyjne");
rowne(
  prod.reduce((s, f) => s + lines(read(f)), 0),
  860585,
  "wiersze kodu produkcyjnego",
);
rowne(testy.length, 2999, "pliki testowe");
rowne(
  prod.filter((f) => f.startsWith("src/routes/") && !f.endsWith("routeTree.gen.ts")).length,
  418,
  "trasy",
);
rowne(
  prod.filter((f) => /^src\/components\/ui\/[^/]+\.tsx$/.test(f)).length,
  48,
  "komponenty design systemu",
);
const pkg = JSON.parse(read("package.json"));
rowne(Object.keys(pkg.scripts).length, 91, "skrypty package.json");
rowne(Object.keys(pkg.scripts).filter((s) => s.startsWith("check:")).length, 50, "bramki check:*");
rowne(
  fs.readdirSync(`${ROOT}/src/lib/ci`).filter((f) => f.endsWith(".ts")).length,
  53,
  "moduły src/lib/ci",
);
rowne(
  fs.readdirSync(`${ROOT}/supabase/migrations`).filter((f) => f.endsWith(".sql")).length,
  1059,
  "migracje supabase",
);
rowne(
  fs.readdirSync(`${ROOT}/drizzle/migrations`).filter((f) => f.endsWith(".sql")).length,
  146,
  "migracje drizzle (SQL)",
);
rowne(
  fs.readdirSync(`${ROOT}`).filter((f) => /^playwright\..*config\.ts$/.test(f)).length,
  6,
  "konfiguracje Playwrighta",
);
wDokumencie("4 031");
wDokumencie("860 585");

/* --- pgTAP i RLS liczone bibliotekami repozytorium --- */
const { analyzePgTapFile } = await import(`${ROOT}/src/lib/ci/pgTapPlan.ts`);
const pgtap = fs.readdirSync(`${ROOT}/supabase/tests`).filter((f) => f.endsWith(".sql"));
let planned = 0;
for (const f of pgtap) planned += analyzePgTapFile(f, read(`supabase/tests/${f}`)).planned ?? 0;
rowne(pgtap.length, 115, "pliki pgTAP");
rowne(planned, 2093, "asercje pgTAP (analizator repo)");
wDokumencie("115 / 2 093");
const { extractLatestPolicies } = await import(`${ROOT}/src/lib/ci/rlsPolicies.ts`);
const { stripSqlComments } = await import(`${ROOT}/scripts/lib/sqlMigrations.ts`);
const migracje = fs
  .readdirSync(`${ROOT}/supabase/migrations`)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((file) => ({ file, sql: stripSqlComments(read(`supabase/migrations/${file}`)) }));
const polityki = extractLatestPolicies(migracje);
rowne(polityki.size, 666, "polityki RLS w stanie końcowym");
rowne(new Set([...polityki.values()].map((p) => p.table)).size, 291, "tabele z politykami");
wDokumencie("666 / 291");

/* --- progi pokrycia: ile i ile martwych --- */
const picomatch = (await import(`${ROOT}/node_modules/picomatch/index.js`)).default;
const cfg = read("vitest.config.ts");
const blok = cfg.slice(cfg.indexOf("thresholds"));
const klucze = [...blok.matchAll(/^\s*"((?:[^"\\]|\\.)+)":\s*\{/gm)].map((m) =>
  JSON.parse(`"${m[1]}"`),
);
const wszystkiePliki = walk(`${ROOT}/src`).map((p) => path.relative(ROOT, p));
const martwe = klucze.filter((k) => {
  const m = picomatch(k, { dot: true });
  return !wszystkiePliki.some((f) => m(f));
});
rowne(klucze.length, 834, "progi per ścieżka");
rowne(martwe.length, 5, `martwe progi (${martwe.join(", ")})`);
assert(
  martwe.includes("src/components/admin/newsletter/deliverability/suppressionTable.ts"),
  "piąty martwy próg to suppressionTable.ts",
);

/* --- rejestr it.fails --- */
let fails = 0;
let plikiFails = 0;
for (const f of testy) {
  const n = (read(f).match(/\bit\.fails\s*\(/g) ?? []).length;
  fails += n;
  if (n) plikiFails++;
}
rowne(fails, 346, "wpisy it.fails");
rowne(plikiFails, 191, "pliki z it.fails");

/* --- Z1-Z10: stan po kodzie (rozdz. 16.7) --- */
// Z1 częściowo: DEFAULT false w obu pasach, flip z 0001 dalej w repo i bez kolumny faktu decyzji.
assert(
  read("drizzle/migrations/0011_profiles_discoverable_opt_in_restore.sql") ===
    read("supabase/migrations/20260913150000_profiles_discoverable_opt_in_restore.sql"),
  "Z1: 0011 nie jest bajt w bajt bliźniakiem 20260913150000",
);
assert(
  /SET discoverable = true/.test(
    read("drizzle/migrations/0001_profiles_discoverable_default_true.sql"),
  ),
  "Z1: 0001 bez hurtowego UPDATE - przepisać 16.7",
);
// Z2 częściowo: porównanie najemców w impersonacji JEST, upsert profilu z zaproszenia BEZ kontroli dotychczasowego najemcy też jest.
assert(
  read("src/lib/admin/impersonation.functions.ts").includes(
    "Forbidden: target user is outside your tenant",
  ),
  "Z2: brak porównania najemców w startImpersonation",
);
{
  const inv = read("src/lib/admin/invitations.functions.ts");
  const i = inv.indexOf('await supabaseAdmin.from("profiles").upsert(');
  const okno = inv.slice(Math.max(0, i - 2500), i);
  assert(
    i > 0 &&
      /tenant_id: inv\.tenant_id/.test(inv.slice(i, i + 400)) &&
      !/existingProfile\?\.tenant_id|tenant_id !== inv\.tenant_id/.test(okno),
    "Z2: performSend sprawdza już najemcę istniejącego profilu - przepisać 16.7",
  );
}
// Z3 częściowo: zapis na bramce platformowej; bliźniacze uzbrojenie z hosta żądania pod requireAdminEditor.
assert(
  /updateJobRunnerSettings = createServerFn\(\{ method: "POST" \}\)\s*\.middleware\(\[requirePlatformAdmin\]\)/.test(
    read("src/lib/newsletter-admin.functions.ts"),
  ),
  "Z3: updateJobRunnerSettings nie stoi na requirePlatformAdmin",
);
assert(
  /ensureJobRunnerArmed\(getOrigin\(\)\)/.test(read("src/lib/admin/scheduler.functions.ts")),
  "Z3: bliźniacze uzbrojenie runnera zniknęło - przepisać 16.7",
);
// Z4 częściowo: stempel poczty transakcyjnej z rozstrzygnięcia adresu.
assert(
  /tenant_id: gate\.tenantId/.test(read("src/routes/platform/email/transactional/send.ts")),
  "Z4: send.ts nie stempluje już gate.tenantId - przepisać 16.7",
);
// Z5 naprawione.
assert(
  /const MAX_TICKS = 1000;/.test(read("src/lib/charts/scale.ts")),
  "Z5: brak sufitu MAX_TICKS w scale.ts",
);
// Z6 naprawione: bramka wpięta w CI.
assert(
  read(".github/workflows/ci.yml").includes("bun run check:dangerous-html"),
  "Z6: check:dangerous-html nie jest w ci.yml",
);
// Z7 naprawione.
assert(
  /tenant_id = \(select public\.current_tenant_id\(\)\)\s*AND \(select public\.is_super_admin\(\)\)/.test(
    read("supabase/migrations/20260912180000_impersonation_tenant_scope.sql"),
  ),
  "Z7: brak wiązania najemcy w polityce dziennika impersonacji",
);
// Z8 częściowo: lustro GA4 przed sprawdzeniem zgody, bez redakcji frazy.
{
  const t = read("src/lib/analytics/track.ts");
  assert(
    t.indexOf("mirrorToGa4(mirrored);") > 0 &&
      t.indexOf("mirrorToGa4(mirrored);") < t.indexOf("if (!hasAnalyticsConsent()) return;"),
    "Z8: lustro GA4 nie stoi już przed bramką zgody - przepisać 16.7",
  );
  assert(
    /params\.search_term = event\.entityId/.test(read("src/lib/analytics/ga4EventMap.ts")),
    "Z8: search_term nie jest już surową frazą - przepisać 16.7",
  );
}
// Z9 otwarte: nieprawdziwe zdanie w konfiguracji i strażnik niepustości.
assert(
  cfg.includes("w CI, z prawdziwymi poświadczeniami, przechodzą"),
  "Z9: zdanie o CI zniknęło z vitest.config.ts - przepisać 16.7",
);
assert(
  /const shouldRun = Boolean\(SUPABASE_URL && SUPABASE_KEY\);/.test(
    read("src/__tests__/db-schema-invariant.test.ts"),
  ),
  "Z9: strażnik db-schema-invariant zmieniony - przepisać 16.7",
);
// Z10 otwarte: zamrożenie per plik.
assert(
  /if \(FREEZE\.test\(code\)\)/.test(read("src/lib/ci/clockFreeze.ts")),
  "Z10: clockFreeze nie sprawdza już zamrożenia per plik - przepisać 16.7",
);
assert(
  !read("scripts/lib/clockFreezeBaseline.ts").includes(
    '["src/routes/__tests__/publicCatchAllRoute.test.tsx",',
  ),
  "Z10: publicCatchAllRoute wrócił do linii bazowej",
);

/* --- nowe defekty wysokie od krytyka kompletności (16.8): mechanizm po kodzie --- */
// Kody wydarzeń: anon dostaje wyrocznię istnienia kodu, a przeglądarka woła RPC z pominięciem limitera.
{
  const kody = "supabase/migrations/20260922220000_event_ticket_codes.sql";
  const m = read(kody);
  assert(
    m.includes(
      "GRANT EXECUTE ON FUNCTION public.event_coupon_revealed_tickets(uuid, text) TO anon",
    ),
    "kody wydarzeń: event_coupon_revealed_tickets bez GRANT dla anon - przepisać 16.8",
  );
  assert(
    /IF array_length\(c\.event_ids,1\) IS NOT NULL THEN\s*RETURN QUERY SELECT false,'event_not_eligible'::text,c\.id,0,_amount_cents,c\.name/.test(
      m,
    ),
    "kody wydarzeń: validate_b2b_coupon nie oddaje już coupon_id i nazwy - przepisać 16.8",
  );
  const pozniejsze = fs
    .readdirSync(`${ROOT}/supabase/migrations`)
    .filter((f) => f.endsWith(".sql") && f > path.basename(kody))
    .filter((f) =>
      /CREATE OR REPLACE FUNCTION public\.(validate_b2b_coupon|event_coupon_revealed_tickets)\b/.test(
        read(`supabase/migrations/${f}`),
      ),
    );
  rowne(pozniejsze.length, 0, "późniejsze redefinicje funkcji kodów wydarzeń");
  for (const [plik, rpc] of [
    ["src/hooks/useValidateCoupon.ts", "validate_b2b_coupon"],
    ["src/lib/events/eventCodesApi.ts", "event_coupon_revealed_tickets"],
  ]) {
    const t = read(plik);
    assert(
      t.includes(`supabase.rpc("${rpc}"`) && !/rateLimit|rate_limit/.test(t),
      `kody wydarzeń: ${plik} nie woła już ${rpc} wprost albo ma limiter - przepisać 16.8`,
    );
  }
}
// Alert o sporze: odbiorcy bez filtra najemcy; poprawny wariant istnieje, ale nikt go nie woła.
{
  const r = read("src/lib/billing/refunds.server.ts");
  const i = r.indexOf("async function alertAdminsAboutDispute(");
  const cialo = i > 0 ? r.slice(i, r.indexOf("\n}\n", i)) : "";
  assert(
    cialo.includes('.from("user_roles")') &&
      cialo.includes('.eq("role", "admin")') &&
      !cialo.includes('.eq("tenant_id"'),
    "alert o sporze: alertAdminsAboutDispute filtruje już najemcę - przepisać 16.8",
  );
  const wolajacy = prod.filter(
    (f) =>
      f !== "src/lib/events/tenantAdminAlert.server.ts" && read(f).includes("notifyTenantAdmins"),
  );
  rowne(wolajacy.length, 0, "pliki produkcyjne wołające notifyTenantAdmins");
}
wDokumencie("Nowych defektów potwierdzonych po próbie obalenia: 169");

/* --- plan naprawczy (16.15): treść każdej pozycji, nie sam nagłówek --- */
{
  const surowy = fs.readFileSync(DOC, "utf8");
  const i = surowy.indexOf("### 16.15.");
  const plan = surowy.slice(i, surowy.indexOf("### 16.16.", i));
  const pozycje = [...plan.matchAll(/^\d+\. (.*)$/gm)].map((m) => m[1]);
  rowne(pozycje.length, 14, "pozycje planu 16.15");
  assert(
    pozycje.length > 0 && pozycje.every((p) => /^\*\*[^*]{8,}\*\*/.test(p)),
    "16.15: pozycja planu bez tytułu",
  );
  for (const tytul of [
    "Zaproszenie nie może przenieść cudzego konta między najemcami",
    "Kody wydarzeń: limit prób i jedna odpowiedź dla pudła",
    "Alert o sporze tylko do administratorów najemcy, którego dotyczy",
    "Testy bez sieci: osłona w setupie zamiast reguły w jednym pliku",
  ]) {
    assert(plan.includes(`**${tytul}**`), `16.15 bez pozycji: ${tytul}`);
  }
}

/* --- sieć w testach (16.12): mechanizm po kodzie; liczby wywołań pochodzą z przebiegu
   z rejestratorem, którego ten skrypt nie powtarza --- */
{
  const karta = read("src/components/admin/seo/TechnicalFoundationCard.tsx");
  assert(
    karta.includes('const PROBE_PATHS = ["/sitemap.xml", "/robots.txt", "/llms.txt", "/"]') &&
      karta.includes("const targets = [`${CANONICAL_SITE_ORIGIN}${path}`, path];"),
    "sieć: karta fundamentów nie sonduje już domeny kanonicznej - przepisać 16.12",
  );
  assert(
    !/stubGlobal\(\s*["']fetch|globalThis\.fetch\s*=|spyOn\(\s*globalThis\s*,\s*["']fetch/.test(
      read("src/routes/__tests__/adminSeoHubRoutes.test.tsx"),
    ),
    "sieć: adminSeoHubRoutes podmienia już fetch - przepisać 16.12",
  );
  assert(
    read("src/lib/billing/fxRate.ts").includes(
      'const NBP_URL = "https://api.nbp.pl/api/exchangerates/rates/A/EUR/?format=json";',
    ),
    "sieć: fxRate nie pyta już NBP - przepisać 16.12",
  );
  assert(
    !/disableIframePageLoading|disableCSSFileLoading/.test(cfg),
    "sieć: vitest.config.ts wyłącza już ładowanie zasobów happy-dom - przepisać 16.12",
  );
  assert(
    !/stubGlobal\(\s*["']fetch|globalThis\.fetch\s*=/.test(read("vitest.setup.ts")),
    "sieć: vitest.setup.ts osłania już fetch - przepisać 16.12",
  );
  assert(
    read("src/components/quiz/__tests__/LazyQuizIframe.test.tsx").includes(
      "Test jednostkowy nie ma prawa dotykać sieci",
    ),
    "sieć: zniknęła lokalna reguła z LazyQuizIframe.test.tsx",
  );
}
wDokumencie("11 zewnętrznych hostów, 20 plików testowych, 93 wywołania na jeden przebieg");
wDokumencie("79 330 zielonych, 19 czerwonych i 50 pominiętych");

/* --- rachunek sumienia (16.16): błędy wydania 11 i własne błędy tego wydania --- */
// TZ był przypięty w CI już w wydaniu 11 - dziś też.
assert(/^\s*TZ: UTC/m.test(read(".github/workflows/ci.yml")), "ci.yml bez TZ: UTC");
wDokumencie("Asercji pgTAP było 1 921, nie 1 973");
wDokumencie(
  "Pierwsza publikacja tego rozdziału miała plan naprawczy z jedenastoma pustymi pozycjami",
);

/* --- pomiar pokrycia (16.4-16.6): liczby z przebiegu, ktorego ten skrypt nie powtarza -
   sprawdza tylko, czy dokument i README mowia to samo --- */
for (const fragment of ["97,03%", "95,83%", "96,06%", "91,78%", "79 399", "2 992"]) {
  wDokumencie(fragment);
}
wReadme("97,03% linii i 95,83% funkcji");
wReadme("97.03% of lines and 95.83% of functions");
wDokumencie("**323 funkcjonalności**");
wReadme("**323**");
// 19 czerwonych przypadkow w pomiarze to zaslepka xlsx - zrodlo blokady musi byc nazwane.
wDokumencie("cdn.sheetjs.com");
for (const r of [
  "### 16.4.",
  "### 16.5.",
  "### 16.6.",
  "### 16.8.",
  "### 16.9.",
  "### 16.15.",
  "### 16.17.",
]) {
  wDokumencie(r);
}

/* --- higiena (16.14) --- */
wReadme("istanbul");
assert(!/providerem v8/.test(readme), "README nadal mówi o providerze v8");
assert(
  read("docs/ARCHITECTURE.md").includes(
    "Order: **typecheck -> test + coverage gate -> build -> bundle budget -> lint**",
  ),
  "ARCHITECTURE.md poprawiony - przepisać pozycję 18 w 16.14",
);

console.log(`Weryfikacja wydania 12: ${zielone} zielonych, ${czerwone.length} czerwonych.`);
for (const c of czerwone) console.log(`  ✗ ${c}`);
if (czerwone.length) process.exit(1);
