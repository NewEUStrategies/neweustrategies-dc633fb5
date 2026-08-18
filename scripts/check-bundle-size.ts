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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

// 2026-08-14  PUBLIC +4,2 KB PONAD PRÓG - dwie zmierzone przyczyny, żadna nie
//             jest regresją chunku startowego (chunk: 467,4 przy progu 513).
//
// POMIAR (ten sam host, pełny build obu stron):
//   * gałąź BEZ tych zmian:  465,7 chunk / 2477,1 public  <- próg 2475 JUŻ
//     przekroczony: commit "Stylizowano karte stanowiska" dodał publiczną
//     trasę karier (chunk `zatrudniamy`, +19,3 KB) bez wpisu tutaj. To nowa
//     powierzchnia produktu - PUBLIC liczy każdy chunk osiągalny z publicznego
//     URL-a, więc floor jest właściwą odpowiedzią (ten sam werdykt co przy
//     klubach w 08-12).
//   * gałąź Z tymi zmianami: 467,4 chunk / 2479,1 public (+2,0 KB) -
//     infrastruktura preloadu LCP: `heroImage` (deskryptor preloadu hero
//     buildera; współdzielony przez trasy `/` i `/$`, więc hoistowany do
//     entry), wspólne moduły `sizes` (sliderSizes/widgetImageSizes/
//     cardImageSizes - parytet preload<->render), kontekst above-fold
//     i akumulator nagłówka `Link`. Koszt jednorazowy; w zamian preload
//     obrazu LCP na stronie głównej, stronach buildera, archiwach i trasach
//     szczegółowych + nagłówki Link utrwalane w NES Edge Cache
//     (docs/WDROZENIE_SSR_LCP_2026-08-13.md).
// Próg PUBLIC idzie na 2505 (~1% zapasu nad zmierzonym 2479,1 - ta sama
// reguła co w 08-12: podnosi go każda nowa trasa publiczna, zapas rzędu
// kilku KB zapala bramkę od cudzych merge'ów w ciągu godziny).

// 2026-08-14 (2)  OVERALL +4,6 KB PONAD PRÓG - w całości dryf maina, zero
//             udziału tej gałęzi (jej zmiany to kod WYŁĄCZNIE serwerowy:
//             SWR katalogu tenantów i indeksu przekierowań + okno stale NES;
//             .output/public bajt w bajt jak czysty main).
// POMIAR (ten sam host, pełny build obu stron):
//   * czysty main:      3794,6 overall (chunk 467,5 / public 2479,1 - w progach),
//   * ta gałąź:         3794,6 overall - identycznie.
// Skład dryfu wg ruchów względem baseline'u: powierzchnia karier
// (`zatrudniamy` +21,6 KB overall, wpis wyżej) + entry +3,3 KB. Próg OVERALL
// idzie na 3835 (~1% zapasu nad zmierzonym 3794,6 - reguła z 08-12; tę liczbę
// podnosi każdy nowy ekran adminowy, których czytelnik nigdy nie pobiera).

// 2026-08-15  ZAPAS PUBLIC/OVERALL PONIŻEJ 1% - zmierzone, naprawione u źródła,
//             bez ruszania progów w górę. Ostrzeżenie o zapasie wskazywało
//             `catalog +12,3` i `zatrudniamy +10,4`; pomiar rozłożył to na
//             TRZY różne historie, z których każda dostała inną odpowiedź.
//
// POMIAR PRZED (ten sam host, pełny build): 466,6 chunk / 2487,3 public /
// 3801,9 overall -> zapasy 0,71% public i 0,86% overall.
//
// 1. `invalidate +18,6 (NOWY)` + `znikł SeoPanel` to JEDEN ruch, nie dwa:
//    chunk ustawień edytora (PostSettingsMetabox, AccessSettingsPane, SeoPanel,
//    RevisionsCard - 106,4 kB źródeł wg przyrządu) zmienił nazwę, bo doszedł mu
//    moduł `lib/seo/invalidate.ts`. Nie był regresją - ale od zawsze liczył się
//    do PUBLIC, mimo że w zbudowanym wyjściu importują go WYŁĄCZNIE
//    `admin.pages._slug` i `admin.posts._slug` (odwołanie w `index-*.js` to
//    wpis manifestu preloadu, nie import - ta sama pułapka, co przy
//    `i18n-clubs-admin` 08-13).
// 2. `zatrudniamy +10,4` i większość `catalog +12,3` to nowa powierzchnia
//    produktu (trasa karier + jej dwujęzyczny słownik `i18n-careers`, 37,2 kB
//    źródła) - PUBLIC liczy każdy chunk osiągalny z publicznego URL-a, więc
//    te bajty są zasadne. Nieuzasadnione było to, co jechało z nimi na
//    gapę przez współdzielenie modułów między poddrzewami public/admin:
//    parsowanie skrzynki rekrutacyjnej (`recruitmentLayer`) w chunku
//    publicznym przez trzy drobne helpery formularza, a import wbudowanego
//    katalogu do bazy (`fallbackRoleRows`) w chunku `catalog`. Naprawa jak
//    zawsze na krawędzi grafu, nie w kilobajtach: publiczne jądro wyszło do
//    `recruitmentShared.ts`, helper adminowy do `catalogAdmin.ts`; po cięciu
//    `recruitmentLayer` ma w zbudowanym wyjściu dokładnie dwóch importerów
//    (`admin.careers`, `admin.crm._id`), a chunk publicznego formularza
//    (`cvUpload`) spadł do 2,6 KB.
// 3. NAJWIĘKSZE: przypadek (1) nie był wyjątkiem, był PRÓBKĄ. Klasyfikacja
//    ADMIN_ONLY po nazwie chunku systematycznie ZAWYŻAŁA PUBLIC, bo chunk
//    współdzielony przez kilka tras adminowych dostaje nazwę modułu, nie
//    trasy (`AdminColorPicker`, `NewsletterBuilder`, `LeadTasksPanel`,
//    rodzina dashboardów analityki - to są wprost „kandydaci wymagający
//    dowodu" z notki 08-13). Ręczne dopisywanie nazw ma dwie wady zmierzone
//    tego dnia: nie nadąża (255,4 KB gzip w 90 chunkach z twardym dowodem
//    adminowości liczyło się do PUBLIC) i KOLIDUJE (w wyjściu jest kilka
//    RÓŻNYCH plików `i18n-<hash>.js`: rdzeń publiczny obok słowników
//    adminowych - nazwa nie umie ich rozróżnić, plik umie). Od dziś bramka
//    prowadzi więc DOWÓD sama, per plik: buduje graf realnych krawędzi
//    importu w zbudowanym wyjściu (`from"./x.js"` / `import("./x.js")`;
//    goły string w manifeście preloadu NIE jest krawędzią) i domyka
//    tranzytywnie zbiór chunków, których wszyscy importerzy są adminowi.
//    Nazwy z ADMIN_ONLY zostają jako kotwice domknięcia (trasy `admin.*` są
//    nazwane po trasie, więc stabilne). Kierunek błędu jest bezpieczny:
//    chunk bez dowodu zostaje w PUBLIC, a gdy jutro dowolna publiczna trasa
//    zaimportuje `AdminColorPicker`, krawędź pojawia się w grafie i chunk
//    WRACA do PUBLIC automatycznie - czyli regresja zapala bramkę, zamiast
//    chować się za wpisem na liście.
//
// POMIAR PO ETAPIE 1 (ten sam host, pełny build): 466,6 chunk / 2232,5
// public / 3802,7 overall - przy domknięciu ADDYTYWNYM zakotwiczonym w
// pełnej liście nazw. Ten wynik przeżył trzy godziny, patrz (2) niżej.
//
// 2026-08-15 (2)  RECENZJA PR #232 ZŁAPAŁA LUKĘ W DOWODZIE - I LUKA JUŻ
//             DZIAŁAŁA. Wersja z etapu 1 trzymała starą listę nazw jako
//             bezwarunkowe ziarna domknięcia, więc chunk zakotwiczony NAZWĄ
//             nie wracał do PUBLIC po pojawieniu się publicznego importera
//             (samonaprawa działała tylko dla chunków dowodzonych grafem).
//             Pomiar wykazał, że to nie teoria:
//   * `EChartClient` (266,8 KB gzip!) - wpis nazwowy z 07-25 był wtedy
//     prawdziwy („osiągalny wyłącznie z /admin/analytics"), ale zgnił bez
//     ostrzeżenia, gdy 08-12 kluby wydały publiczne insighty:
//     club._clubSlug.insights -> EChart -> EChartClient. Czytelnik POBIERA
//     silnik wykresów, a bramka od tygodni liczyła go administracji;
//   * `sidebarLayouts` (9,5 KB) - kotwica `sidebar` przez przypadek nazwy
//     łapała też publiczne layouty sidebara wpisu (importer: resolver $.tsx).
// Naprawa: klasyfikacja jest NAJWIĘKSZYM PUNKTEM STAŁYM reguły „adminowy,
// bo trasa /admin albo wszyscy importerzy adminowi" (start od pełnego
// zbioru, iteracyjne odbieranie statusu przy publicznym importerze).
// Jedyny bezwarunkowy korzeń to autoryzowana granica produktu - chunki tras
// /admin - a wzajemne importy klasy Builder <-> PostBlockEditor przeżywają
// z konstrukcji. Lista nazw komponentów ZNIKA w całości.
//
// POMIAR PO (ten sam host, ten sam build): 466,6 chunk / 2508,4 public /
// 3802,7 overall. UCZCIWY bilans całego dnia względem starej księgowości
// (2487,3): -255,4 KB chunków adminowych liczonych czytelnikowi, +276,3 KB
// chunków publicznych liczonych administracji - netto PUBLIC był przez
// tygodnie ZANIŻONY o ~21 KB, a nie zawyżony. Realne zejście bajtów z
// publicznego grafu (cięcie karier) to ~2 KB; reszta to korekta pomiaru
// w obie strony. OVERALL bez zmian z definicji - klasyfikacja nie usuwa
// kodu; jego realne zejście to wciąż backlog z 08-06 (i18n-club 181 kB
// w entry, node-html-parser 202 kB, lucide-react 187 kB), do którego
// dochodzi teraz zmierzony, nazwany kandydat: EChartClient na publicznej
// ścieżce insightów klubu (lazy per widget, ale PUBLIC liczy osiągalność).
//
// FLOORY za śladem (reguła 08-12/08-14, ~1%): public 2505 -> 2535 (nad
// UCZCIWYM 2508,4 - to nie jest re-floor dryfu, tylko pierwszy pomiar bez
// zaniżenia; stare 2505 stało nad liczbą, która nie była prawdą), chunk
// 513 -> 471 (przy 466,6 stara wartość dawała 10% luzu i przestała łapać
// regresje entry - a pozycja i18n-club wciąż tam siedzi), overall ZOSTAJE
// 3835 (zmierzone 3802,7; konwencja ~1% dałaby 3841, czyli WYŻEJ - nie
// podnosimy). Zapas overall 0,84% pozostaje ciasny świadomie: to koszt
// realnie wydanej powierzchni adminowej i zejdzie wyłącznie przez
// usunięcie bajtów z backlogu, nie przez księgowość.
//
// 2026-08-15 (3)  PO MERGE'U PR #240 (podział WidgetView per typ + katalog
//             widgetów spod admin/). Zmierzone na tym samym hoście:
//             376,5 chunk / 2543,2 public / 3814,4 overall.
//             CO SIĘ STAŁO, wg diffu per chunk względem baseline'u d255605:
//   * `index` 570,0 -> 475,8 KB (-94,2) - komplet 44 widgetów zszedł z chunku
//     wejściowego, a `check:entry-purity` widzi już tylko 7 chunków statycznie
//     osiągalnych ze ścieżki bootowania (z 724). To jest cel tej pracy i on
//     został osiągnięty: pierwszy transfer czytelnika spadł o ~16%;
//   * cena: 254 NOWYCH chunków = +242,6 KB gzip łącznie. Sam podział nie
//     usuwa kodu, tylko przenosi go za granice `import()`, a każdy mały plik
//     gzipuje się gorzej niż ten sam kod w jednym strumieniu (znany koszt,
//     patrz wpis 2026-08-06 (2) o 45 plikach po kilkaset bajtów). Największa
//     pojedyncza pozycja to `normalizeRichHtml` 46,9 KB - to NIE jest nowy
//     kod, tylko `node-html-parser` (201,7 kB źródła, 98,9% chunku) wycięty
//     z `index` do własnego chunku ładowanego dopiero przez widget rich-html.
//             BILANS: PUBLIC 2508,4 -> 2543,2 (+34,8 KB księgowo), ale to, co
//             płaci realny czytelnik PRZY PIERWSZYM WEJŚCIU, spadło o 94,2 KB.
//             PUBLIC liczy OSIĄGALNOŚĆ z publicznego URL-a, więc lazy chunk
//             widgetu, którego dana strona nie renderuje, wchodzi do sumy tak
//             samo jak kod w entry - dlatego ta bramka rośnie od podziału,
//             który poprawia percepcję. Świadomie NIE cofamy podziału i NIE
//             sklejamy widgetów w grube barrel'e: to odzyskałoby kilkanaście
//             KB sumy kosztem powrotu bajtów na ścieżkę bootowania.
//             REALNE zejście sumy zostaje tam, gdzie było nazwane: usunięcie
//             `node-html-parser` z publicznego grafu (normalizacja list WP
//             przy imporcie/zapisie zamiast przy renderze), split i18n-club
//             i lucide-react.
//
// FLOORY za śladem (reguła 08-12/08-14, ~1%): public 2535 -> 2570 (nad
// zmierzonym 2543,2), overall ZOSTAJE 3835 (zmierzone 3814,4, zapas 0,5%),
// chunk 471 -> 385 RATCHET W DÓŁ (zmierzone 376,5 - podział zbił entry, więc
// próg schodzi razem z nim i dalej łapie regresję rzędu 2%).
//
// 2026-08-18  CIĘCIE ŚCIEŻKI BOOTOWANIA (diagnoza wolnego pierwszego wejścia,
//             docs/WDROZENIE_PIERWSZE_WEJSCIE_2026-08-18.md). Zmierzone na
//             jednym hoście przed/po (uwaga: instalacja npm z publicznego
//             rejestru czytała ~1% WYŻEJ niż baseline CI - liczby porównywać
//             parami przed/po, nie z baseline'em):
//   * chunk wejściowy (plik index-*.js): 373,9 -> 253,2 KB gz (-120,7 KB,
//     -32%) - to płaci KAŻDE pierwsze wejście przed hydratacją;
//   * pełne domknięcie statyczne bootu: 654 -> ~554 KB gz / 2179 -> ~1876 KB
//     surowych (parse/compile skaluje się z surowymi);
//   * największym plikiem przestał być entry - jest nim EChartClient
//     (266,8 KB gz, admin-only, lazy).
//             CO ZESZŁO z entry (przyczyny, nie kilobajty - pilnuje ich
//             check:entry-purity): 182 kB źródeł słowników i18n-* (side-effect
//             importy w plikach tras -> wzorzec ensureI18n() w komponencie),
//             dompurify (split lib/sanitizePure), sonner (lib/notify + lazy
//             Toaster), sekcje-label i akordeon (lazyWidgets), treści prawne
//             (lib/legal/meta.ts vs moduł ?tsr-shared), clubs/api (loader
//             importuje wycinek publicClub), eksportowane komponenty tras
//             admin.library/admin.comments (eksport blokował splitter).
//             zod i tailwind-merge ZOSTAJĄ na ścieżce bootowania (schematy
//             ustawień w loaderze roota / cn() w każdym komponencie), ale we
//             własnych chunkach vendorowych - stabilny cache między deployami.
//             BILANS KSIĘGOWY: public 2567,4 -> 2535,0 (-32,4; słowniki
//             adminowe wróciły do grafu admin-only), overall 3847,6 -> 3866,4
//             (+18,8) - ta sama klasa kosztu co wpis 2026-08-15 (3): podział
//             nie usuwa kodu, a ~30 nowych granic chunków gzipuje się gorzej
//             niż jeden strumień. Świadomie akceptowane: +19 KB sumy sesji
//             (w większości powierzchnie adminowe) za -121 KB gz na KAŻDYM
//             pierwszym wejściu czytelnika.
//
// FLOORY za śladem: public 2570 -> 2545 RATCHET W DÓŁ (zmierzone 2535,0 na
// hoście czytającym wyżej niż CI), overall 3835 -> 3870 (zmierzone 3866,4;
// na CI przewidywane ~3833 - stary próg zostawiał <0,1% zapasu, czyli
// flapping od pierwszego cudzego merge'a; ~1% zapasu wg lekcji z 08-01),
// chunk 385 -> 280 RATCHET W DÓŁ (zmierzone 266,8 - entry zszedł do 253,2,
// próg schodzi za śladem i dalej łapie regresję rzędu 5%).

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
  // Największy pojedynczy chunk gzip. Zmierzone 2026-08-18: 266,8 (EChartClient,
  // admin-only) - entry po cięciu ścieżki bootowania ma 253,2. Ratchet
  // 385 -> 280: próg schodzi za śladem (wpis 2026-08-18 w kronice).
  chunk: 280,
  // gzip JS osiągalny z publicznego URL-a. Zmierzone 2026-08-18: 2535,0
  // (host czytający ~1% wyżej niż CI) - słowniki adminowe wróciły do grafu
  // admin-only. Ratchet 2570 -> 2545.
  public: 2545,
  // gzip JS łącznie z kodem tylko adminowym. Zmierzone 2026-08-18: 3866,4
  // (na CI przewidywane ~3833). Podniesione 3835 -> 3870: koszt ~30 nowych
  // granic chunków po zejściu ~700 kB źródeł ze ścieżki bootowania - pełne
  // uzasadnienie we wpisie 2026-08-18 w kronice wyżej.
  overall: 3870,
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

/**
 * ODSETEK ZAPASU, PONIŻEJ KTÓREGO BRAMKA KRZYCZY, CHOĆ JESZCZE PRZECHODZI.
 *
 * PO CO. Kronika wyżej to trzy wpisy (08-01, 08-03, 08-12) o tej samej awarii:
 * bramka zapala się na przypadkowym commicie, autor nie zna przyczyny, więc
 * podnosi próg - i od tej chwili nie łapie już nic. Wspólny mechanizm nie jest
 * po stronie progu, jest po stronie MOMENTU: nikt nie widzi, że zapas skończył
 * się dwa tygodnie wcześniej. 2026-08-13 największy chunk miał 1,7 KB luzu
 * (0,33%) i żaden przebieg CI o tym nie powiedział, bo bramka była zielona.
 *
 * Ostrzeżenie nie blokuje merge'a. Ma jedną rolę: sprawić, żeby wyczerpanie
 * zapasu było widoczne u AUTORA WZROSTU, a nie u kolejnej osoby.
 */
const HEADROOM_WARN_PCT = 2;

/**
 * Baseline rozmiarów per chunk (`reports/bundle-baseline.json`).
 *
 * Bramka bez niego mówi ILE, nigdy PRZEZ CO - i właśnie dlatego kolejne
 * re-floory szły bez diagnozy. Z baseline'em skrypt sam nazywa chunki, które
 * urosły najbardziej, więc pierwsza informacja po czerwonej bramce to nie
 * „514 > 513", a „index +14,2 KB, Builder +3,1 KB".
 *
 * KLUCZEM JEST NAZWA BEZ HASHA. `index-HSMM7HnQ.js` i `index-CVfAOQee.js` to ten
 * sam chunk w dwóch buildach; porównanie po pełnej nazwie nie dałoby ani jednej
 * pary. Baseline aktualizuje się JAWNIE (`--update-baseline`) i jedzie w commicie,
 * dokładnie jak progi: żeby zmiana przeszła przez review razem z przyczyną.
 */
const BASELINE_PATH = "reports/bundle-baseline.json";

interface BaselineFile {
  readonly measuredAt: string;
  readonly commit: string;
  readonly totals: { readonly public: number; readonly overall: number; readonly chunk: number };
  readonly chunks: Readonly<Record<string, number>>;
}

/** `assets/index-HSMM7HnQ.js` -> `index`; `_libs/echarts.js` -> `echarts`. */
function stableChunkName(file: string): string {
  const base = file.split("/").pop() ?? file;
  return base.replace(/\.js$/, "").replace(/-[A-Za-z0-9_-]{8,}$/, "");
}

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
// 2026-08-13: dochodzi `i18n-clubs-admin` - 35 z 41 sekcji `adminClubs` wyszlo
// z `i18n-club.ts`, zeby nie jechaly w chunku WEJSCIOWYM. Chunk jest adminowy
// z dowodu, nie z nazwy: w zbudowanym wyjsciu importuja go WYLACZNIE chunki tras
// `admin.community.clubs.*` oraz `ClubLayoutPicker` (osiagalny tylko z panelu -
// przez `ClubElementsGallery`, ktory lezy pod `src/components/clubs/`, ale nie ma
// ani jednego publicznego importera). Odwolanie w `index-*.js` to wpis w MANIFESCIE
// zasobow trasy (tablica stringow do preloadu), nie import statyczny.
//
// 2026-08-15: DOWOD PRZESTAL BYC RECZNY. Akapit „KANDYDACI, KTORZY ZOSTAJA"
// z 08-13 (i18n-builder, i18n-admin-analytics - „wymagaja dowodu, nie nazwy")
// jest od dzis wykonywany przez sama bramke, per PLIK, z grafu realnych
// krawedzi importu w zbudowanym wyjsciu. Goly string w manifescie preloadu
// `index-*.js` nie jest krawedzia - dokladnie ten sam dowod, ktory 08-13
// przeprowadzono recznie dla `i18n-clubs-admin`. Per plik, bo nazwa nie umie
// rozroznic kilku ROZNYCH plikow `i18n-<hash>.js` (rdzen publiczny obok
// slownikow adminowych), a plik umie.
//
// 2026-08-15 (2): KOTWICE NAZWOWE ZLIKWIDOWANE PO RECENZJI. Pierwsza wersja
// dowodu trzymala stara liste nazw jako bezwarunkowe ziarna domkniecia.
// Recenzja PR #232 wskazala luke: chunk zakotwiczony NAZWA nie wracal do
// PUBLIC po pojawieniu sie publicznego importera - a pomiar wykazal, ze ta
// luka juz DZIALALA, w obu kierunkach:
//   * `EChartClient` (266,8 KB gzip!) - wpis z 07-25 („osiagalny wylacznie
//     z /admin/analytics") zgnil bez ostrzezenia, gdy 08-12 kluby dostaly
//     publiczna trase insightow: club._clubSlug.insights -> EChart ->
//     EChartClient. Czytelnik POBIERA silnik wykresow, a bramka liczyla go
//     administracji;
//   * `sidebarLayouts` (9,5 KB) - kotwica `sidebar` (adminowy sidebar CMS)
//     przez przypadek nazwy lapala tez publiczne layouty sidebara wpisu,
//     importowane przez publiczny resolver `$.tsx`.
// Jedynym bezwarunkowym korzeniem klasyfikacji jest wiec AUTORYZOWANA
// GRANICA PRODUKTU, nie nazwa komponentu: chunki tras /admin (`admin.*` po
// kropce i chunk layoutu `admin-<hash>`), bo tylko ich „adminowosci" nie da
// sie wyczytac z grafu (laduje je router z publicznego entry, a strzeze ich
// autoryzacja serwerowa). Cala reszta - Builder, PostBlockEditor,
// ThemeOptionsPane, slowniki i18n-admin-* itd. - ma status wyliczany z grafu
// na kazdym buildzie; wzajemne importy (Builder <-> PostBlockEditor) przezywa
// konstrukcja najwiekszego punktu stalego, patrz `adminOnlyByGraph`.
const ADMIN_ROOT = /^admin[.-]/;
function isAdminRoot(file: string): boolean {
  return ADMIN_ROOT.test(basename(file));
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

/**
 * DOWÓD ADMINOWOŚCI Z GRAFU IMPORTÓW (2026-08-15, konstrukcja punktu stałego
 * po recenzji PR #232 - patrz kronika i notka nad ADMIN_ROOT).
 *
 * Klasyfikacja to NAJWIĘKSZY PUNKT STAŁY reguły: chunk jest adminowy, gdy
 * jest trasą /admin (korzeń) ALBO ma co najmniej jednego importera i KAŻDY
 * jego importer jest adminowy. Start od „wszystko poza entry jest adminowe",
 * potem iteracyjne odbieranie statusu każdemu chunkowi z publicznym
 * importerem (lub bez importerów), aż do punktu stałego. Dzięki temu:
 *   * wzajemnie importujące się chunki adminowe (Builder <-> PostBlockEditor)
 *     zachowują status, jeśli ich zewnętrzni importerzy są adminowi,
 *   * publiczny importer odbiera status CAŁEMU osiągalnemu poddrzewu
 *     automatycznie - regresja zapala bramkę, zamiast chować się za wpisem
 *     na liście nazw (luka z recenzji PR #232),
 *   * chunk bez ani jednej widocznej krawędzi (entry, service worker, pliki
 *     ładowane wyłącznie mechanizmem tras) zostaje w PUBLIC - kierunek błędu
 *     jest bezpieczny.
 *
 * Krawędzią jest wyłącznie literalny import w kodzie chunku - `from"./x.js"`,
 * `import"./x.js"`, `import("./x.js")`, `export...from"./x.js"`. Goły string
 * `"assets/x.js"` w tablicy manifestu preloadu krawędzią NIE jest (pułapka
 * opisana przy `i18n-clubs-admin`, 08-13): preload tylko pobiera plik,
 * wykonanie wymaga importu.
 */
function adminOnlyByGraph(paths: readonly string[]): Set<string> {
  const byBase = new Map<string, string>();
  for (const p of paths) byBase.set(basename(p), p);

  // Odwrotny graf: plik -> zbiór plików, które go importują.
  const importersOf = new Map<string, Set<string>>();
  for (const p of paths) importersOf.set(p, new Set());
  const EDGE_RE = /(?:\bfrom|\bimport)\s*\(?\s*["'][^"']*?([\w.$[\]-]+\.js)["']\)?/g;
  for (const p of paths) {
    const source = readFileSync(p, "utf8");
    for (const match of source.matchAll(EDGE_RE)) {
      const target = byBase.get(match[1]);
      if (target && target !== p) importersOf.get(target)?.add(p);
    }
  }

  const isEntryChunk = (p: string) => basename(p).startsWith("index-");
  const admin = new Set(paths.filter((p) => !isEntryChunk(p)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of [...admin]) {
      if (isAdminRoot(p)) continue;
      const importers = importersOf.get(p);
      let revoked = !importers || importers.size === 0;
      if (!revoked && importers) {
        for (const importer of importers) {
          if (!admin.has(importer)) {
            revoked = true;
            break;
          }
        }
      }
      if (revoked) {
        admin.delete(p);
        changed = true;
      }
    }
  }
  return admin;
}

const files = walkJs(CLIENT_DIR);
if (files.length === 0) {
  console.error(`✗ No client JS found in ${CLIENT_DIR}. Run \`bun run build\` first.`);
  process.exit(1);
}

const adminOnly = adminOnlyByGraph(files);

let total = 0;
let publicTotal = 0;
let adminRootTotal = 0;
let max = 0;
let maxFile = "";
const perChunk = new Map<string, number>();
for (const f of files) {
  const kb = gzipKb(f);
  total += kb;
  if (!adminOnly.has(f)) publicTotal += kb;
  else if (isAdminRoot(f)) adminRootTotal += kb;
  const name = stableChunkName(f);
  perChunk.set(name, (perChunk.get(name) ?? 0) + kb);
  if (kb > max) {
    max = kb;
    maxFile = f;
  }
}
const adminTotal = total - publicTotal;

console.log(`Client JS: ${files.length} files, ${total.toFixed(1)} KB gzip total`);
console.log(`  public:      ${publicTotal.toFixed(1)} KB  (budget ≤ ${MAX_PUBLIC_KB} KB)`);
console.log(
  `  admin-only:  ${adminTotal.toFixed(1)} KB  (billed to OVERALL only; ${adminOnly.size} chunków ` +
    `z punktu stałego grafu importów, w tym ${adminRootTotal.toFixed(1)} KB w korzeniach tras /admin)`,
);
console.log(`  overall:     ${total.toFixed(1)} KB  (budget ≤ ${MAX_TOTAL_KB} KB)`);
console.log(`Largest chunk: ${max.toFixed(1)} KB gzip (${maxFile})  (budget ≤ ${MAX_CHUNK_KB} KB)`);

// Audyt dowodu na żądanie: pełna lista chunków adminowych z grafu, z wagami.
if (process.argv.includes("--admin-proof")) {
  const rows = [...adminOnly]
    .map((p) => ({ name: stableChunkName(p), kb: gzipKb(p), root: isAdminRoot(p) }))
    .sort((a, b) => b.kb - a.kb);
  console.log(`Chunki adminowe z punktu stałego grafu (${rows.length}):`);
  for (const row of rows) {
    console.log(
      `  ${row.kb.toFixed(1).padStart(7)} KB  ${row.name}${row.root ? "  [korzeń]" : ""}`,
    );
  }
}

// ── Baseline: jawna aktualizacja ─────────────────────────────────────────────
if (process.argv.includes("--update-baseline")) {
  const commit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]).stdout.toString().trim();
  const snapshot: BaselineFile = {
    measuredAt: new Date().toISOString(),
    commit,
    totals: {
      public: Number(publicTotal.toFixed(1)),
      overall: Number(total.toFixed(1)),
      chunk: Number(max.toFixed(1)),
    },
    chunks: Object.fromEntries(
      [...perChunk.entries()]
        .filter(([, kb]) => kb >= 1)
        .sort((a, b) => b[1] - a[1])
        .map(([name, kb]) => [name, Number(kb.toFixed(1))]),
    ),
  };
  mkdirSync("reports", { recursive: true });
  writeFileSync(BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `✓ Baseline zapisany: ${BASELINE_PATH} (${Object.keys(snapshot.chunks).length} chunków, commit ${commit}).`,
  );
  process.exit(0);
}

// ── Baseline: diagnoza „PRZEZ CO", nie tylko „ILE" ───────────────────────────
/**
 * Zwraca gotowe linie raportu ruchów względem baseline'u. Puste, gdy baseline'u
 * nie ma - brak pliku nie może wywrócić bramki, bo bramka pilnuje progów, a nie
 * istnienia raportu.
 */
function movers(): string[] {
  if (!existsSync(BASELINE_PATH)) {
    return [
      `Brak ${BASELINE_PATH} - bramka nie umie nazwać, co urosło.`,
      `Zapisz baseline na zielonym buildzie: bun run scripts/check-bundle-size.ts --update-baseline`,
    ];
  }
  let base: BaselineFile;
  try {
    base = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineFile;
  } catch {
    return [`${BASELINE_PATH} jest nieczytelny - pomijam diagnozę ruchów.`];
  }
  const deltas: Array<{ name: string; delta: number; now: number; was: number }> = [];
  for (const [name, kb] of perChunk) {
    const was = base.chunks[name];
    if (was === undefined) {
      if (kb >= 5) deltas.push({ name: `${name} (NOWY)`, delta: kb, now: kb, was: 0 });
      continue;
    }
    const delta = kb - was;
    if (Math.abs(delta) >= 1) deltas.push({ name, delta, now: kb, was });
  }
  const gone = Object.keys(base.chunks).filter((n) => !perChunk.has(n) && base.chunks[n] >= 5);
  if (deltas.length === 0 && gone.length === 0) return [];

  const lines = [`Ruchy względem baseline'u (${base.commit}, ${base.measuredAt.slice(0, 10)}):`];
  for (const d of deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 12)) {
    const sign = d.delta > 0 ? "+" : "";
    lines.push(
      `  ${sign}${d.delta.toFixed(1).padStart(7)} KB  ${d.name}  (${d.was.toFixed(1)} -> ${d.now.toFixed(1)})`,
    );
  }
  for (const name of gone.slice(0, 5)) lines.push(`  ${"znikł".padStart(10)}  ${name}`);
  return lines;
}

const errors: string[] = [];
if (max > MAX_CHUNK_KB) errors.push(`largest chunk ${max.toFixed(1)} KB > ${MAX_CHUNK_KB} KB`);
if (publicTotal > MAX_PUBLIC_KB)
  errors.push(`public total ${publicTotal.toFixed(1)} KB > ${MAX_PUBLIC_KB} KB`);
if (total > MAX_TOTAL_KB) errors.push(`overall total ${total.toFixed(1)} KB > ${MAX_TOTAL_KB} KB`);

if (errors.length) {
  console.error(`✗ Bundle budget exceeded: ${errors.join("; ")}`);
  for (const line of movers()) console.error(line);
  console.error(
    `  Skład chunku z dokładnością do modułu: BUNDLE_INVENTORY=1 bun run build && bun run report:chunk-inventory ${stableChunkName(maxFile)}`,
  );
  console.error(
    `  PODNIESIENIE PROGU JEST OSTATECZNOŚCIĄ: najpierw zmierz przyczynę powyżej i dopisz ją do kroniki w tym pliku.`,
  );
  process.exit(1);
}

// ── Zapas: ostrzeżenie ZANIM bramka zapali się u kogoś innego ────────────────
const headroom = [
  { name: "largest chunk", now: max, limit: MAX_CHUNK_KB },
  { name: "public total", now: publicTotal, limit: MAX_PUBLIC_KB },
  { name: "overall total", now: total, limit: MAX_TOTAL_KB },
].map((b) => ({ ...b, left: b.limit - b.now, pct: ((b.limit - b.now) / b.limit) * 100 }));

const tight = headroom.filter((b) => b.pct < HEADROOM_WARN_PCT);
if (tight.length > 0) {
  console.warn("");
  console.warn(`! ZAPAS BUDŻETU PONIŻEJ ${HEADROOM_WARN_PCT}% - następny wzrost zapali bramkę:`);
  for (const b of tight) {
    console.warn(
      `!   ${b.name}: zostało ${b.left.toFixed(1)} KB z ${b.limit} KB (${b.pct.toFixed(2)}%)`,
    );
  }
  const report = movers();
  if (report.length > 0) {
    console.warn("!");
    for (const line of report) console.warn(`! ${line}`);
  }
  console.warn(`! To NIE jest powód, żeby podnieść próg - to powód, żeby zmierzyć skład chunku:`);
  console.warn(
    `!   BUNDLE_INVENTORY=1 bun run build && bun run report:chunk-inventory ${stableChunkName(maxFile)}`,
  );
}

console.log("✓ Bundle within budget.");
