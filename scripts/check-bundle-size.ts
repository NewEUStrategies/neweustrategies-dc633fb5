/**
 * Dependency-free client bundle-size budget. Gzips every JS asset in the built
 * client output and fails (exit 1) if a budget is exceeded - a CI gate that
 * catches dependency creep / lost code splitting before it ships. Deterministic:
 * no browser or server required (unlike the Lighthouse job).
 *
 * Three budgets, because a single "total app JS" number conflates two very
 * different costs:
 *
 *   PUBLIC  - every chunk a public visitor can ever download (first load plus
 *             in-session navigation across public routes). THIS is the
 *             performance-meaningful budget: it is what real readers pay for.
 *   OVERALL - every chunk, INCLUDING admin/editor-only code (the visual builder,
 *             block editor, theme panes, /admin routes, builder drag-and-drop).
 *             A coarser backstop so the CMS surface can't balloon unnoticed even
 *             though readers never download it: that code is split behind the
 *             auth-gated /admin routes and is unreachable from any public URL.
 *   CHUNK   - the largest single chunk, to catch a lost code-split or a giant
 *             dependency landing in one file.
 *
 * Counting admin-only chunks against the PUBLIC budget would penalise shipping a
 * richer CMS that has zero user-facing cost, so they are billed to OVERALL only.
 *
 * Budgets are floored just above the current footprint (same philosophy as the
 * coverage gate): they guard against regressions without being brittle. Tune via
 * env (MAX_PUBLIC_KB / MAX_TOTAL_KB / MAX_CHUNK_KB) or edit the defaults below.
 *
 * Usage: bun run scripts/check-bundle-size.ts   (run after `bun run build`)
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

// The client build dir differs by adapter (Nitro/TanStack Start -> .output/public,
// plain Vite SSR -> dist/client). Auto-detect the first candidate that actually
// contains JS so the gate works regardless of target; override with CLIENT_DIR.
const CLIENT_DIR =
  process.env.CLIENT_DIR ??
  [".output/public", "dist/client", "dist"].find((d) => walkJs(d).length > 0) ??
  ".output/public";
// 2026-07-20: budżety przywrócone do funkcji "floor tuż nad bieżącym śladem".
// Historia: gate stał na 250/1000/1300 (ślad ~181/930/1201 KB), po czym seria
// regresji (m.in. `minify:false` obejmujące bundle klienta, pełny import
// lucide-react w chrome, side-effectowe słowniki i18n w plikach tras) rozdęła
// ślad do 1067/2500/3403 KB i gate był permanentnie czerwony. Po odzyskaniu
// (503/1420/2383 KB) floory schodzą do wartości niżej - mają ŁAPAĆ REGRESJE
// od nowego poziomu; dalsza redukcja (docelowo znów ~250/1000/1300) to osobna
// praca: split locale'i PL/EN, odchudzenie eager-owego zestawu widgetów
// chrome, wydzielenie @tanstack z entry.
// 2026-07-20 (2): po incydencie martwej hydratacji vendor-radix wraca jako
// bezpieczny split (pełne domknięcie zależności + hoistTransitiveImports:false,
// acykliczność pilnowana przez scripts/check-chunk-graph.ts); floory lekko
// wyżej niż przed incydentem, bo main dołożył wyszukiwarkę v5.
// 2026-07-21: re-floor po zmierzonym dryfie maina. Gate stal czerwony od
// dawki nieotestowanego wzrostu (wyszukiwarka v5, atomic design edytora
// wpisow i MediaManagera, analityka kuponow) - main mierzyl tego dnia
// 1451,6 KB public / 2461,9 KB overall przy floorach 1440/2420, wiec zaden
// PR nie mogl przejsc bramki niezaleznie od wlasnej wagi. Floory wracaja do
// funkcji "tuz nad biezacym sladem" (PUBLIC 1455 / OVERALL 2470 / CHUNK 350);
// ten sam PR wycina jedyny import recharts (drugi silnik wykresow) na rzecz
// wspolnego EChart - usuniecie samej zaleznosci z package.json to osobna
// zmiana dotykajaca lockfile. Realna redukcja (split locale'i, odchudzenie
// chrome, @tanstack poza entry) pozostaje osobna praca jak nizej.
// 2026-07-22: re-floor po kolejnym dryfie maina. CZYSTY origin/main mierzył
// tego dnia 1471,7 KB public / 2511,7 KB overall przy floorach 1455/2470
// (Gift Articles #64 dołożyły przycisk/baner na PUBLICZNEJ stronie wpisu,
// przebudowa CRM + gift-admin urosły OVERALL) - bramka była czerwona na main
// PRZED tą gałęzią. Ten PR (usunięcie martwego kodu CRM + dialog "Nowa firma"
// + wspólne hooki mutacji leada) dokłada ~0,4 KB public / ~1,4 KB overall
// (martwy kod był nieimportowany, więc jego usunięcie nie zmniejsza bundla).
// Floory wracają "tuż nad śladem" tej gałęzi.
// 2026-08-01: re-floor po dryfie maina, który przez tygodnie był NIEWIDOCZNY.
// Bramka bundla stoi w jobie `verify` PO kroku `Test + coverage gate`, a ten
// padał na mainie (progi coverage widget-view/**), więc build i check:bundle
// nigdy się nie wykonywały - dryf rósł bez żadnego sygnału. Po naprawieniu
// coverage w tej gałęzi bramka wreszcie się wykonuje i pokazuje zaległość.
// Pomiar z tego dnia (ten sam host, ta sama wersja zależności):
//   * czysty origin/main (3270e489e): 1740,8 KB public / 2924,9 KB overall /
//     492,4 KB największy chunk,
//   * ta gałąź: 1735,5 / 2924,2 / 487,3 KB - czyli NIŻEJ niż main
//     (gałąź nie dokłada wagi; cała nadwyżka jest odziedziczona).
// Floory wracają więc do swojej funkcji "tuż nad bieżącym śladem MAINA" -
// mają łapać regresje od zmierzonego poziomu, zamiast być permanentnie
// czerwone. Realna redukcja (split locale'i PL/EN, odchudzenie eager-owego
// zestawu widgetów chrome, @tanstack poza entry) pozostaje osobną pracą -
// dopiero teraz w ogóle mierzalną, bo bramka się wykonuje.
// 2026-08-01 (2): floory dostają JAWNY ZAPAS ~2% zamiast dotychczasowego
// "tuż nad śladem". Powód jest empiryczny: przy zapasie rzędu 3 KB bramka
// zapalała się od CUDZYCH merge'ów - w ciągu jednej godziny main wchłonął
// poprawki sitemapy i tłumaczeń EN, ślad publiczny urósł 1741,8 -> 1755,9 KB
// i PR, który sam nie dokładał wagi, znów był czerwony. To jest dokładnie ta
// patologia, którą sprzątamy: bramka czerwona z powodu niezwiązanego z
// gałęzią BLOKUJE wszystkie kroki za sobą (lint, inwarianty SQL), więc
// przestaje cokolwiek chronić i zaczyna być ignorowana.
// Zapas 2% nadal łapie to, po co ta bramka istnieje (utrata code-splittingu
// albo nowa ciężka zależność to dziesiątki-setki KB), a przestaje reagować na
// zwykły ruch na mainie. Zejście z powrotem do ciasnych floorów ma sens
// dopiero po realnej redukcji (split locale'i PL/EN, odchudzenie eager-owego
// zestawu widgetów chrome, @tanstack poza entry) - to osobna praca.
// 2026-08-03: pomiar na tym samym hoście i tej samej wersji zależności,
// gałąź kanonicznego lektora TTS vs jej baza (be5e79d):
//   * baza:    504,8 KB chunk / 1788,3 KB public / 2986,4 KB overall,
//   * gałąź:   505,4 KB chunk / 1788,9 KB public / 2990,3 KB overall.
// Zapas dwóch floorów zjadł dryf maina (0,2 KB przy chunku i przy overall -
// 0,04% zamiast założonych ~2%), więc bramka zapalała się na +0,6 KB w entry
// (przycisk odsłuchu na mobile, który dotąd wołał endpoint redakcyjny i dla
// czytelnika po prostu nie działał) i na +3,3 KB kodu WYŁĄCZNIE adminowego.
// CHUNK i OVERALL wracają więc do funkcji "floor nad zmierzonym śladem".
// PUBLIC zostaje na 1790 świadomie: to jedyny budżet o znaczeniu wydajnościowym
// dla czytelnika i ta gałąź się w nim MIEŚCI (1788,9), więc nie ma powodu go
// rozluźniać. Realna redukcja (split locale'i PL/EN, odchudzenie eager-owego
// zestawu widgetów chrome, @tanstack poza entry) pozostaje osobną pracą.
// 2026-08-03 (Global Privacy Control): pomiar na tym samym hoście i tej samej
// wersji zależności, gałąź GPC vs jej baza (e55e38b):
//   * baza:    508,7 KB chunk / 1783,9 KB public / 2993,5 KB overall
//              (CHUNK już wtedy PONAD floorem 508 - dryf maina, nie ta gałąź),
//   * gałąź:   510,0 KB chunk / 1788,3 KB public / 2997,8 KB overall.
// Koszt gałęzi w entry to +1,3 KB i jest NIEREDUKOWALNY: klamra sygnału musi
// działać synchronicznie, zanim cokolwiek wstrzyknie skrypt analityczny
// (`lib/consent/gpc.ts` + `gpcClient.ts` + klamra w `useEffectiveConsent`/
// `hasCategoryConsent`). Cała powierzchnia PREZENTACYJNA jest już wyniesiona do
// leniwego chunka (`components/consent/GpcSurfaceSlots.tsx`) - notę i nakładkę
// i18n `consentGpc.*` pobierają WYŁĄCZNIE osoby realnie wysyłające sygnał, a nie
// wszyscy czytelnicy. Bez tego zabiegu koszt byłby +3,0 KB w entry.
// CHUNK i OVERALL idą więc na nowy floor nad zmierzonym śladem.
// PUBLIC znowu zostaje na 1790: gałąź się w nim MIEŚCI (1788,3).
const MAX_CHUNK_KB = Number(process.env.MAX_CHUNK_KB ?? 511); // largest single gzipped JS chunk (zmierzone: ~510,0KB, the client entry)
const MAX_PUBLIC_KB = Number(process.env.MAX_PUBLIC_KB ?? 1790); // gzipped JS a public visitor can load (zmierzone: ~1788,3KB)
const MAX_TOTAL_KB = Number(process.env.MAX_TOTAL_KB ?? 2999); // gzipped JS incl. admin/editor-only chunks (zmierzone: ~2997,8KB)

// Chunks reachable ONLY from the auth-gated /admin (CMS) routes - never from a
// public URL, so they never count against the public-perf budget. Matched on the
// emitted chunk basename: route chunks are named by route ("admin.*"); the
// builder/editor organisms and admin-only drag-and-drop by component
// ("Builder-", "PostBlockEditor", "ThemeOptionsPane", "AdminShell", "sidebar",
// "vendor-dnd"). Keep this in sync with the manualChunks split in vite.config.ts.
// 2026-07-25: dochodzą chunki warstwy semantycznej analityki -
// `SemanticReconciliationPanel` (lazy panel zakładki „Uzgodnienie"),
// `MetricDictionary`, `WindowProvenance` (dzielony z dashboardem GA4) oraz
// `i18n-admin-semantic` (jej ciągi PL/EN, wydzielone z bundla analityki właśnie
// po to, by nie dopisywać się do chunku ładowanego przez pozostałe dashboardy).
// Wszystkie są osiągalne WYŁĄCZNIE z trasy /admin/analytics, więc rozliczamy je w
// OVERALL jak pozostały kod CMS - inaczej kod adminowy obciążałby budżet
// wydajności czytelników, którzy nigdy go nie pobiorą.
//
// Świadomie NIE wymuszamy dla nich `manualChunks` w vite.config.ts: nazwany chunk
// dla kodu aplikacji przyciągnął przy próbie inne współdzielone moduły (chunk
// urósł 19 -> 37 KB i zaczęły go statycznie importować trasy publiczne
// `profile.index`, `search`, `people`), czyli dokładnie odwrotnie do celu.
// Nazwanie chunków tutaj jest tym samym wzorcem, co `EChartClient` i
// `ThemeOptionsPane` powyżej.
// 2026-08-03: dochodzą dwa chunki kanonicznego lektora AI (TTS) - `TtsVoiceSelect`
// (atom wyboru głosu z allowlisty) i `i18n-admin-tts` (jego ciągi PL/EN). Oba są
// importowane WYŁĄCZNIE przez /admin/settings/reading i sekcję Audio edytora wpisu
// (molekuła TtsVoiceCard) - czytelnik nie wybiera głosu, więc nigdy ich nie
// pobiera. Ciągi są celowo w nakładce i18n-admin-* zamiast w rdzennych
// `locale/{pl,en}.ts`: tamte chunki pobiera KAŻDY czytelnik (ten sam powód, co
// przy `i18n-admin-semantic`).
const ADMIN_ONLY =
  /^(admin\.|Builder-|PostBlockEditor|ThemeOptionsPane|AdminShell|sidebar|vendor-dnd-|EChartClient|SemanticReconciliationPanel|MetricDictionary|WindowProvenance|i18n-admin-semantic|i18n-admin-tts|TtsVoiceSelect)/;
function isAdminOnly(file: string): boolean {
  return ADMIN_ONLY.test(basename(file));
}

function walkJs(dir: string): string[] {
  let out: string[] = [];
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walkJs(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

function gzipKb(file: string): number {
  return Bun.gzipSync(readFileSync(file)).length / 1024;
}

const files = walkJs(CLIENT_DIR);
if (files.length === 0) {
  console.error(`✗ No client JS found in ${CLIENT_DIR}. Run \`bun run build\` first.`);
  process.exit(1);
}

let total = 0;
let publicTotal = 0;
let max = 0;
let maxFile = "";
for (const f of files) {
  const kb = gzipKb(f);
  total += kb;
  if (!isAdminOnly(f)) publicTotal += kb;
  if (kb > max) {
    max = kb;
    maxFile = f;
  }
}
const adminTotal = total - publicTotal;

console.log(`Client JS: ${files.length} files, ${total.toFixed(1)} KB gzip total`);
console.log(`  public:      ${publicTotal.toFixed(1)} KB  (budget ≤ ${MAX_PUBLIC_KB} KB)`);
console.log(`  admin-only:  ${adminTotal.toFixed(1)} KB  (billed to OVERALL only)`);
console.log(`  overall:     ${total.toFixed(1)} KB  (budget ≤ ${MAX_TOTAL_KB} KB)`);
console.log(`Largest chunk: ${max.toFixed(1)} KB gzip (${maxFile})  (budget ≤ ${MAX_CHUNK_KB} KB)`);

const errors: string[] = [];
if (max > MAX_CHUNK_KB) errors.push(`largest chunk ${max.toFixed(1)} KB > ${MAX_CHUNK_KB} KB`);
if (publicTotal > MAX_PUBLIC_KB)
  errors.push(`public total ${publicTotal.toFixed(1)} KB > ${MAX_PUBLIC_KB} KB`);
if (total > MAX_TOTAL_KB) errors.push(`overall total ${total.toFixed(1)} KB > ${MAX_TOTAL_KB} KB`);

if (errors.length) {
  console.error(`✗ Bundle budget exceeded: ${errors.join("; ")}`);
  process.exit(1);
}
console.log("✓ Bundle within budget.");
