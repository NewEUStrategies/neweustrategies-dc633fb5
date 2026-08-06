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
 * PROGI SĄ ZAMROŻONE W KODZIE (2026-08-06)
 * Do tej pory każdy próg dało się nadpisać zmienną środowiskową
 * (MAX_PUBLIC_KB / MAX_TOTAL_KB / MAX_CHUNK_KB). Bramka, którą wolno rozluźnić
 * jedną zmienną w workflow, nie jest bramką - jest sugestią. W CI zmienne są
 * więc IGNOROWANE: obowiązują wyłącznie stałe z tego pliku, a ich zmiana
 * wymaga commita, czyli przechodzi przez review razem z przyczyną wzrostu.
 * Poza CI nadpisanie nadal działa (lokalny eksperyment „ile zejdzie, jeśli…"),
 * ale skrypt głośno mówi, że mierzy pod innym progiem.
 *
 * PODNOSZENIE PROGU JEST OSTATECZNOŚCIĄ, NIE ODRUCHEM
 * Historia poniżej to głównie kolejne re-floory - bo bramka mówiła ILE, nigdy
 * PRZEZ CO. Od 2026-08-06 jest na to narzędzie: `BUNDLE_STATS=1 bun run build`
 * + `bun run analyze:bundle` pokazuje skład każdego chunku z dokładnością do
 * modułu. Zanim podniesiesz próg - sprawdź, co dokładnie urosło.
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
// ---------------------------------------------------------------------------
// KRONIKA FLOORÓW (skrót - pełne uzasadnienia w historii gita tego pliku)
//
// 2026-07-20  250/1000/1300 -> 503/1420/2383. Seria regresji: `minify:false`
//             obejmujące bundle klienta, pełny import lucide-react w chrome,
//             side-effectowe słowniki i18n w plikach tras.
// 2026-07-20  Powrót vendor-radix po incydencie martwej hydratacji (domknięcie
//             zależności + hoistTransitiveImports:false + gate check:chunks).
// 2026-07-21  1440/2420 -> 350/1455/2470. Zmierzony dryf maina (wyszukiwarka
//             v5, atomic design edytora wpisów, analityka kuponów) blokował
//             KAŻDY PR niezależnie od jego wagi.
// 2026-07-22  -> 1471,7/2511,7 (Gift Articles + przebudowa CRM).
// 2026-08-01  -> 1740,8/2924,9/492,4. Dryf był NIEWIDOCZNY tygodniami: krok
//             bramki stoi PO `Test + coverage gate`, a ten padał na mainie,
//             więc build i check:bundle nigdy się nie wykonywały.
// 2026-08-01  Floory dostają ~2% zapasu, bo przy zapasie ~3 KB bramka zapalała
//             się od CUDZYCH merge'ów w ciągu godziny.
// 2026-08-03  508/1790/2996 (kanoniczny lektor TTS).
// 2026-08-03  511/1799/3005 (Global Privacy Control). OSTATNI wpis „na ślepo":
//             audyt r2 z 2026-08-06 wykazał, że te trzy liczby NIE BYŁY już
//             pomiarem - bramka nie była uruchamiana, a rzeczywisty ślad maina
//             wynosił 541,6 / 1886,9 / 3129,0 KB (przekroczenia +30,6 / +87,9
//             / +124,0 KB).
//
// 2026-08-06  KONIEC ERY „RE-FLOOR ZAMIAST NAPRAWY". Ta zmiana najpierw
//             NAPRAWIA, potem mierzy, a progi zamraża w kodzie (bez env w CI):
//
//   * kasa poza chunk wejściowy - `routes/$.tsx` -> `Paywall` ->
//     `EmbeddedCheckoutDialog` -> `@stripe/react-stripe-js` + `loadStripe`
//     wciągało SDK operatora płatności do entry, czyli do KAŻDEGO anonimowego
//     czytelnika (w artefakcie były i `EmbeddedCheckout`, i `js.stripe.com`).
//     Teraz SDK żyje w leniwej wyspie `StripeEmbeddedFrame` + `lib/stripe/sdk`,
//     pilnowanej bez builda przez `src/lib/ci/bundleIslands.ts`.
//   * `vendor-tanstack` wreszcie POWSTAJE. Reguła istniała od tygodni, ale
//     nigdy nie działała: wejściem klienta jest plik POD
//     /node_modules/@tanstack/, a Rollup nie potrafi przenieść modułu
//     wejściowego do nazwanego chunku - zamiast tego zapadał cały chunk z
//     powrotem w entry. ~330 KB (surowo) routera i react-query jechało w
//     `index-*.js` bez żadnego ostrzeżenia.
//   * `vendor-lucide` - ikony w jednym, trwale cache'owalnym chunku zamiast
//     kilkudziesięciu 300-bajtowych odprysków.
//   * słownik buildera (~101 KB źródła) wypada z entry: `Editable.tsx` nie
//     rejestruje już `i18n-builder` side-effectem, bo renderuje się wyłącznie
//     w kanwie edytora (ta sama zasada, co w `resizeWrappers.tsx`).
//
// Efekt zmierzony na tym samym hoście i tej samej wersji zależności:
// największy chunk 541,6 -> 433,5 KB gzip. Progi poniżej stoją nad
// zmierzonym śladem TEJ gałęzi.
//
// NASTĘPNA DŹWIGNIA (zmierzona, świadomie NIE w tej zmianie): `node-html-parser`
// waży 201,7 KB surowo W CHUNKU WEJŚCIOWYM. Ciągną go dwa importy:
// `lib/sanitize.ts` (gałąź `import.meta.env.SSR` jest w kliencie MARTWA, ale
// pakiet nie deklaruje `sideEffects:false`, więc nie jest wytrząsany) oraz
// `lib/builder/normalizeRichHtml.ts` (realnie używany w przeglądarce przez
// `RichHtmlView`). Usunięcie wymaga przepisania normalizacji list na natywny
// `DOMParser` po stronie klienta - to zmiana dotykająca renderowania
// OPUBLIKOWANEJ treści, więc należy jej się własny PR z testami parytetu
// wyjścia, a nie doklejenie do zmiany bundlowej.
// ---------------------------------------------------------------------------

/**
 * Progi ZAMROŻONE. W CI obowiązują wyłącznie te liczby - zmiana wymaga commita
 * i review razem z przyczyną wzrostu. Poza CI można je nadpisać zmiennymi
 * MAX_CHUNK_KB / MAX_PUBLIC_KB / MAX_TOTAL_KB do lokalnego eksperymentu.
 */
const FROZEN_BUDGET_KB = {
  chunk: 438, // największy pojedynczy chunk gzip (zmierzone: 433,5 KB)
  public: 1910, // gzip JS osiągalny z publicznego URL-a (zmierzone: 1891,2 KB)
  overall: 3168, // gzip JS łącznie z kodem tylko adminowym (zmierzone: 3135,9 KB)
} as const;

/** GitHub Actions ustawia CI=true; honorujemy też generyczne CI innych runnerów. */
const IN_CI = process.env.CI === "true" || process.env.CI === "1";

function budget(name: keyof typeof FROZEN_BUDGET_KB, envVar: string): number {
  const frozen = FROZEN_BUDGET_KB[name];
  const override = process.env[envVar];
  if (!override) return frozen;
  if (IN_CI) {
    console.warn(
      `! ${envVar}=${override} ZIGNOROWANE - w CI obowiązuje próg zamrożony (${frozen} KB).`,
    );
    return frozen;
  }
  const parsed = Number(override);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`✗ ${envVar}="${override}" nie jest dodatnią liczbą.`);
    process.exit(1);
  }
  console.warn(`! Lokalne nadpisanie: ${envVar}=${parsed} KB (próg zamrożony: ${frozen} KB).`);
  return parsed;
}

const MAX_CHUNK_KB = budget("chunk", "MAX_CHUNK_KB");
const MAX_PUBLIC_KB = budget("public", "MAX_PUBLIC_KB");
const MAX_TOTAL_KB = budget("overall", "MAX_TOTAL_KB");

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
