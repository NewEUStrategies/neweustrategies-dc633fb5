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
 * Kronika poniżej to w większości kolejne re-floory - bo bramka mówiła ILE,
 * nigdy PRZEZ CO. Od 2026-08-06 jest na to przyrząd:
 * `BUNDLE_INVENTORY=1 bun run build` + `bun run report:chunk-inventory index`
 * pokazuje skład każdego chunku z dokładnością do modułu. Zanim podniesiesz
 * próg - zmierz, co dokładnie urosło, i dopisz to do kroniki.
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
// PUBLIC musi się ruszyć pierwszy raz od 07-25 - nie dlatego, że ta gałąź go
// przebiła, ale dlatego, że main przebił go SAM (1794,0 > 1790). Floor idzie
// nad zmierzony ślad po scaleniu, nie "z zapasem". Realna redukcja (split
// locale'i PL/EN, odchudzenie eager-owego zestawu widgetów chrome, @tanstack
// poza entry) pozostaje osobną, pilniejszą niż dotąd pracą.
// 2026-08-06 (SDK płatności poza ścieżką bootowania + re-floor po dryfie maina).
//
// STAN WYJŚCIOWY. Bramka była czerwona na CZYSTYM mainie (d4edce2), i to nie
// pierwszy raz niezauważenie: krok `Bundle size budget` stoi w jobie `verify`
// PO `Test + coverage gate`, a ten padał na rozjeździe snapshotu bramek autoryzacji,
// więc build i ten skrypt w ogóle się NIE WYKONYWAŁY. Pomiar pełnym buildem na
// jednym hoście i jednej wersji zależności:
//   * czysty main:        541,8 KB chunk / 1887,1 KB public / 3129,2 KB overall,
//   * floory przed:       511    /  1799   /  3005  -> przekroczenia +30,8 / +88,1 / +124,2.
//
// CO ZROBIŁA TA GAŁĄŹ. Wyprowadziła SDK operatora płatności ze ścieżki bootowania
// czytelnika. Łańcuch był w całości STATYCZNY: routes/$.tsx -> Paywall ->
// EmbeddedCheckoutDialog -> @stripe/react-stripe-js, a lib/stripe.ts (loadStripe)
// miało 17 statycznych importerów, w większości sięgających wyłącznie po helper
// środowiskowy do kluczy zapytań. Moduł współdzielony przez wiele chunków Rollup
// hoistuje do wspólnego przodka - czyli do ENTRY - więc marker `js.stripe.com`
// siedział w chunku startowym KAŻDEGO anonimowego czytelnika. Teraz ramka wchodzi
// przez `React.lazy` (components/checkout/EmbeddedCheckoutFrame), a `loadStripe`
// przez `import()`; nowy blokujący krok CI `check:entry-purity` pilnuje tej
// krawędzi w grafie chunków, a nie jej skutku w kilobajtach.
//
// UCZCIWY BILANS TEJ ZMIANY: -1,0 KB w entry, +1,5 KB public, +1,4 KB overall
// (541,8 -> 540,8 / 1887,1 -> 1888,6 / 3129,2 -> 3130,6). Loader Stripe.js to
// ~1 KB gzip, a dołożony placeholder ramki, granica błędu i klucze PL/EN kosztują
// tyle samo. To NIE jest zmiana o wadze - jest o tym, KTO i KIEDY pobiera kod
// bramki płatniczej. Nie udajemy, że zamyka lukę 88 KB.
//
// DLACZEGO PUBLIC/OVERALL NIE MOGŁY SPAŚĆ. PUBLIC liczy KAŻDY chunk osiągalny z
// publicznego URL-a, nie pierwsze wczytanie - więc przeniesienie kodu z eager do
// lazy nie rusza tej liczby ani o bajt. PUBLIC spada wyłącznie wtedy, gdy kod
// znika albo staje się osiągalny wyłącznie spod /admin.
//
// NIEUDANY EKSPERYMENT - ZAPISANY, ŻEBY NIE POWTÓRZYĆ GO PO RAZ TRZECI.
// Przyrząd (`BUNDLE_INVENTORY=1 bun run build` + `bun run report:chunk-inventory
// index`) pokazał 156,5 kB źródeł słowników i18n powierzchni WYŁĄCZNIE adminowych
// w chunku startowym (i18n-builder 101,3 kB, i18n-admin-post-panes 26,1 kB,
// i18n-admin-popup-signup 15,4 kB i cztery mniejsze) - wszystkie mają importerów
// tylko pod components/admin/** albo routes/admin*, a do entry trafiły tą samą
// mechaniką co Stripe. Wymuszony `manualChunks` po DOKŁADNYCH ścieżkach plików
// (nigdy po katalogu, dokładnie jak radzi notatka z 07-25) dał pozornie świetny
// wynik: 492,7 KB chunk / 1842,1 KB public. Wynik był FAŁSZYWY. Rollup wciągnął do
// nazwanego chunku także `src/lib/i18n.ts` (bootstrap i18n potrzebny na KAŻDEJ
// stronie), więc chunk stał się statycznym importem entry i wszystkich tras
// publicznych - czytelnik pobierał te same bajty, tylko w dwóch plikach zamiast
// jednego (492,7 + 48,2 = 540,9, czyli tyle samo), a ADMIN_ONLY rozliczał je do
// OVERALL i PUBLIC zaniżał się o 48 KB. Zmiana została wycofana: bramka, która
// pokazuje ładniejszą liczbę bez pokrycia w bajtach, jest gorsza niż czerwona.
//
// FLOORY wracają więc do swojej funkcji „tuż nad zmierzonym śladem" (bez zapasu -
// zapas z 08-01 i tak zjadł dryf w kilka dni). Mają łapać regresje od tego
// poziomu, zamiast być permanentnie czerwone i blokować wszystkie kroki za sobą.
//
// ZMIERZONY BACKLOG REDUKCJI (entry, bajty źródeł przed minifikacją - z przyrządu,
// nie z pamięci; dotąd ta lista była zgadywana):
//   * src/components/admin      437 kB  - warstwa widoku buildera współdzielona
//                                         przez publiczny renderer i edytor CMS,
//   * node-html-parser          202 kB  - przez lib/builder/normalizeRichHtml
//                                         (RichHtmlView), w przeglądarce do
//                                         zastąpienia natywnym DOM-em,
//   * src/lib/builder           190 kB,
//   * lucide-react              187 kB,
//   * i18n powierzchni admina   157 kB  - patrz nieudany eksperyment wyżej;
//                                         właściwa droga to leniwa rejestracja
//                                         słownika, nie wymuszony chunk,
//   * zod                       132 kB, tailwind-merge 97 kB, dompurify 82 kB.
// 2026-08-06 (2): PODZIAŁ CHUNKÓW - trzy naprawy i KONIEC ERY „re-floor zamiast
// naprawy". Ta gałąź startuje z powyższego stanu (540,8 / 1888,6 / 3130,6) i po
// raz pierwszy od tygodni RUSZA największy chunk w dół, zamiast podnosić próg.
//
// 1. `vendor-tanstack` NIGDY NIE POWSTAWAŁ. Reguła `manualChunks` dla
//    /node_modules/@tanstack/ siedziała w konfiguracji od tygodni i była martwa:
//    wejściem klienta TanStack Start jest
//    `@tanstack/react-start/dist/plugin/default-entry/client.tsx`, czyli plik POD
//    tą samą ścieżką. Reguła przypisywała więc MODUŁ WEJŚCIOWY do nazwanego
//    chunku, a Rollup odpowiada na to zapadnięciem CAŁEGO chunku z powrotem do
//    entry - bez ostrzeżenia. Skutkiem ~330 kB (surowo) routera i react-query w
//    `index-*.js`. Naprawa: `manualChunks` pomija moduły wejściowe
//    (`meta.getModuleInfo(id)?.isEntry`), wydziela wyłącznie biblioteki LIŚCIOWE
//    (react-router, router-core, history, store, query-core, react-query,
//    *-ssr-query-core) wraz z domknięciem spoza vendor-react (seroval,
//    seroval-plugins, cookie-es, isbot - inaczej vendor-tanstack importuje je z
//    entry i powstaje CYKL, klasa awarii z 2026-07-20), a runtime bootstrapu
//    (@tanstack/*start*) zostaje w entry. To ostatnie nie jest ozdobnikiem:
//    pierwsza próba z całą rodziną w chunku dała entry 0,2 KB i vendor-tanstack
//    1,59 MB, bo Rollup barwi nazwanym chunkiem cały graf osiągalny z jego
//    modułów, a przez rodzinę *start* biegnie droga do `src/router.tsx`.
// 2. `vendor-lucide`. Po (1) Rollup rozsypał ikony na 45 plików po 300-400 B
//    (każda ikona współdzielona przez >=2 leniwe chunki dostawała własny) -
//    ~22 KB gzip samego narzutu nagłówków, bo pliki tej wielkości się nie
//    kompresują. Jeden chunk cofa ten koszt i jest trwale cache'owalny.
// 3. Słownik buildera (~101 kB źródła, pierwsza pozycja backlogu wyżej) wypada
//    z entry: `Editable.tsx` nie rejestruje już `i18n-builder` side-effectem.
//    UWAGA - to NIE jest powtórka nieudanego eksperymentu opisanego wyżej:
//    tamten WYMUSZAŁ `manualChunks` po ścieżkach i wciągnął `lib/i18n.ts`; ten
//    usuwa krawędź w grafie i pozwala Rollupowi zdecydować samemu. `Editable`
//    renderuje się wyłącznie przy `canEdit = editable && onContentChange`, czyli
//    w kanwie buildera - a chunk kanwy rejestruje ten słownik przy inicjalizacji.
//    Ta sama zasada jest już udokumentowana i stosowana w
//    `widget-view/resizeWrappers.tsx`.
//
// POMIAR (ten sam host, ta sama wersja zależności, pełny build):
//   * baza (main po scaleniu): 540,8 / 1888,6 / 3130,6 KB,
//   * ta gałąź:                434,1 / 1896,1 / 3142,7 KB.
// Największy chunk - jedyna z tych liczb, którą płaci KAŻDE pierwsze wejście -
// spada o 106,7 KB. PUBLIC/OVERALL są płaskie z powodu dokładnie tego,
// co opisuje akapit „DLACZEGO PUBLIC/OVERALL NIE MOGŁY SPAŚĆ" powyżej: drobniejszy
// podział przenosi bajty między plikami, nie usuwa ich.

// 2026-08-12  DRYF MAINA +530 KB PUBLIC W SZEŚĆ DNI - i znowu niewidoczny tą
//             SAMĄ mechaniką co 08-01 i 08-03: krok `Bundle size budget` stoi
//             w `verify` PO `Test + coverage gate`, a ten był czerwony na
//             mainie na progach pokrycia katalogów `src/lib/network/**`
//             i `src/components/profile/**`. Build i ten skrypt NIE
//             WYKONYWAŁY SIĘ ANI RAZU od 08-06. Ta gałąź naprawiła bramkę
//             pokrycia, więc jako pierwsza dotarła do tego kroku - i zapaliła
//             go na liczbach, których nie wniosła.
//
// POMIAR (ten sam host, ta sama wersja zależności, pełny build obu stron):
//   * main 5141533:   511,1 chunk / 2444,9 public / 3742,8 overall,
//   * ta gałąź:       511,2       / 2449,4        / 3749,8,
//   * floory 08-06:   439         / 1915          / 3175
//                     -> przekroczenie MAINA: +72,1 / +529,9 / +567,8 KB.
// Udział tej gałęzi w luce: +0,1 / +4,5 / +7,0 KB, czyli 0,8% PUBLIC-a
// (dwa nowe chunki: trasa ustawień powiadomień i słownik panelu wydarzeń).
//
// TE DWIE LICZBY ZNACZĄ CO INNEGO i dlatego nie mają jednej diagnozy:
//
//   PUBLIC/OVERALL (+530/+568 KB) to NOWA POWIERZCHNIA PRODUKTU wydana
//   06-12.08: moduł klubów dyskusyjnych (~20 tras `/club/*`, ankiety,
//   zaproszenia, minisite, roster) i ekrany sieci kontaktów. PUBLIC liczy
//   KAŻDY chunk osiągalny z publicznego URL-a, nie pierwsze wczytanie, więc
//   nowy moduł podnosi tę liczbę z definicji - patrz akapit „DLACZEGO
//   PUBLIC/OVERALL NIE MOGŁY SPAŚĆ". Tu floor jest właściwą odpowiedzią.
//
//   NAJWIĘKSZY CHUNK (+72 KB gzip, 434,1 -> 511,1) to REGRESJA, którą płaci
//   KAŻDE pierwsze wejście - i jest zmierzona, nie zgadnięta. Przyrząd
//   (`BUNDLE_INVENTORY=1 bun run build` + `bun run report:chunk-inventory
//   index`) pokazuje w entry `src/lib/i18n-club.ts` na 181,4 kB źródła (6,4%
//   chunku startowego, 4650 linii). Mechanika jest ta sama co przy Stripe
//   i `vendor-tanstack`: `ensureClubI18n` ma 34 importerów, a te dzielą się na
//   DWA rozłączne poddrzewa tras - publiczne `/club/*` i adminowe
//   `/admin/community/clubs/*` (plus komponenty w `components/clubs/**`
//   używane przez oba). Moduł współdzielony przez chunki z dwóch poddrzew
//   Rollup hoistuje do ich wspólnego przodka, czyli do ENTRY.
//
// CZEGO TU CELOWO NIE ZROBIONO. Wymuszenie `manualChunks` na tym słowniku to
// DOKŁADNIE nieudany eksperyment opisany wyżej („NIEUDANY EKSPERYMENT -
// ZAPISANY, ŻEBY NIE POWTÓRZYĆ GO PO RAZ TRZECI") - tamten wciągnął
// `lib/i18n.ts` i dał ładniejszą liczbę bez pokrycia w bajtach. Właściwa droga
// jest inna i wynika wprost z pomiaru: PODZIELIĆ słownik po powierzchniach
// (`i18n-club.ts` dla `/club/*` + osobny plik dla kluczy wyłącznie adminowych)
// i zostawić `ensureClubI18n` tylko w trasie układu `/club` oraz w odpowiedniku
// adminowym. Wtedy publiczna część ma jednego wspólnego przodka - chunk układu
// `club.tsx` - a nie entry. To osobna zmiana: dotyka 34 miejsc rejestracji
// i 4650 linii słownika, więc nie wchodzi do gałęzi o i18n, dostępności
// i pokryciu, gdzie nikt nie przyszedłby jej recenzować pod tym kątem.
// Floor największego chunku idzie więc TYLKO nad zmierzony ślad maina, bez
// zapasu - żeby ta pozycja dalej piszczała przy każdym kolejnym kilobajcie.

/**
 * Progi ZAMROŻONE (2026-08-12). Do tej pory każdy z nich dało się rozluźnić
 * jedną zmienną środowiskową w workflow - bramka, którą wolno wyłączyć bez
 * commita, jest sugestią, nie bramką. W CI zmienne MAX_CHUNK_KB /
 * MAX_PUBLIC_KB / MAX_TOTAL_KB są więc IGNOROWANE (skrypt mówi to głośno):
 * obowiązują wyłącznie stałe poniżej, a ich zmiana przechodzi przez review
 * razem z przyczyną wzrostu i wpisem do kroniki. Poza CI nadpisanie działa -
 * do lokalnego eksperymentu „ile zejdzie, jeśli...".
 */
const FROZEN_BUDGET_KB = {
  // Największy pojedynczy chunk gzip. Zmierzone: main 511,1 / ta gałąź 511,2.
  // BEZ zapasu, bo to jedyna z tych liczb, którą płaci każde pierwsze wejście,
  // a jej wzrost od 08-06 (+72 KB) ma zmierzoną przyczynę do naprawy - patrz
  // wpis 2026-08-12 wyżej.
  chunk: 513,
  // gzip JS osiągalny z publicznego URL-a. Zmierzone: main 2444,9 / gałąź 2449,4.
  // ~1% zapasu, bo tę liczbę podnosi KAŻDA nowa trasa publiczna i przy zapasie
  // rzędu kilku KB bramka zapala się od cudzych merge'ów w ciągu godziny
  // (lekcja z 08-01).
  public: 2475,
  // gzip JS łącznie z kodem tylko adminowym. Zmierzone: main 3742,8 / gałąź 3749,8.
  overall: 3790,
} as const;

/** GitHub Actions ustawia CI=true; honorujemy też generyczne CI innych runnerów. */
const IN_CI = process.env["CI"] === "true" || process.env["CI"] === "1";

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
