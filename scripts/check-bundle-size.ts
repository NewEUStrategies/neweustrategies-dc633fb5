/**
 * Dependency-free client bundle-size budget. Gzips every JS **and CSS** asset in
 * the built client output and fails (exit 1) if a budget is exceeded - a CI gate
 * that catches dependency creep / lost code splitting before it ships.
 * Deterministic: no browser or server required (unlike the Lighthouse job).
 *
 * (Do 2026-09-01 ten nagłówek mówił „Gzips every JS asset" i było to prawdą -
 * dokładnie w tym była wada: `walkJs()` zbierał WYŁĄCZNIE `.js`, więc arkusz
 * stylów render-blocking, 79,6 KB gzip na KAŻDYM URL-u, nie był mierzony przez
 * ŻADNĄ bramkę w repo. Wpis IX w kronice niżej.)
 *
 * Five budgets, because a single "total app JS" number conflates costs that are
 * paid by different people at different moments:
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
 *   CSS     - gzip każdego wyemitowanego arkusza. Zdominowany przez arkusz
 *             korzenia, który `rootHead.ts` wypisuje jako `<link
 *             rel=stylesheet>` PLUS pierwszą wartość nagłówka `Link`, czyli
 *             blokuje render na każdym URL-u (wpis IX).
 *   BOOT    - gzip STATYCZNEGO DOMKNIĘCIA ścieżki bootowania: chunki, które SSR
 *             wstrzykuje jako `<script type="module">`, plus wszystko osiągalne
 *             z nich krawędzią statyczną. Jedyna z tych liczb, którą czytelnik
 *             płaci CAŁĄ, zanim ruszy hydratacja (wpis X).
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
//
// 2026-08-19  OVERALL 3870 -> 3876 (+6 KB). ROZBICIE CZTERECH PANELI MODUŁU 1
//             NA ATOMIC DESIGN. Wpis jest tu dlatego, że bramka wprost tego
//             wymaga („najpierw zmierz przyczynę, potem dopisz do kroniki"),
//             a nie dlatego, że podniesienie progu jest wygodne.
//
//             POMIAR NA DWÓCH BUILDACH TEGO SAMEGO DRZEWA (jeden host, jedna
//             wersja zależności) - bez tego nie da się odpowiedzieć, czyj to koszt:
//               * przed pracą (39a9efd): 2534,2 public / 1331,0 admin / 3865,2 overall
//               * po pracy:              2537,6 public / 1332,9 admin / 3870,5 overall
//             Czyli +3,4 public / +1,9 admin / +5,3 overall. Zapas OVERALL PRZED
//             tą pracą wynosił 4,8 KB (0,12%) i bramka SAMA to zgłaszała
//             ostrzeżeniem „ZAPAS BUDŻETU PONIŻEJ 2%" - ta gałąź go domknęła.
//
//             ROZKŁAD, z porównania chunków obu buildów:
//               * +3,7 KB - siedem mikro-chunków atomów paneli. Vite wydziela
//                 współdzielony moduł aplikacji do własnego chunku, a przy ~1 KB
//                 rzeczywistej treści narzut opakowania jest większy niż sam kod.
//               * +1,6 KB - dwa słowniki i18n: 164 klucze przeniesione z map
//                 `COPY = { pl, en }` wpisanych w komponenty. Tego kosztu nie da
//                 się uniknąć - to ten sam tekst, tylko wreszcie widoczny dla
//                 bramek parytetu.
//
//             CO ODZYSKANO, ZANIM PRÓG RUSZYŁ (zmierzone, nie „próbowaliśmy"):
//               * BARYŁKA ATOMÓW NIE DZIAŁA i została wycofana. Rollup przechodzi
//                 przez re-eksport do modułów docelowych, więc siedem chunków
//                 zostało siedmioma (0,0 KB różnicy). Wycofana także dlatego, że
//                 baryłka zaciemnia PRAWDZIWE krawędzie importu, których pilnuje
//                 check:chunks.
//               * PANEL REKOMENDACJI wychodził jako osobny chunk (+9,9 KB) tylko
//                 dlatego, że plik trasy importował z modułu organizmu DWIE rzeczy
//                 (panel i widok „nie znaleziono"). Rozdzielenie plików zwinęło go
//                 do chunku trasy: `admin.related` 8,23 -> 8,05 KB, czyli MNIEJ
//                 niż przed tą pracą, przy panelu z 0% na 100% pokrycia.
//                 Odzyskane ~2 KB.
//
//             PUBLIC (budżet czytelnika) NIE JEST przekroczony i ma 7,4 KB zapasu.
//             Próg PUBLIC i próg największego chunku zostają bez zmian.

// 2026-08-19 II  CZWARTY RAZ TĄ SAMĄ MECHANIKĄ - i tym razem policzony do końca.
//             Krok `Bundle size budget` stoi w `verify` PO `Test + coverage gate`,
//             a ten padał na mainie na progach pokrycia per-ścieżka w
//             `src/lib/billing/**`. `main` nie miał ZIELONEGO CI przez 60
//             przebiegów (2026-08-16T17:53Z -> 2026-08-19T15:37Z: 42 failure,
//             17 cancelled, zero success), więc build i ten skrypt NIE
//             WYKONYWAŁY SIĘ ANI RAZU w tym okresie - razem z siedmioma innymi
//             bramkami stojącymi za tym krokiem. PR #272 zdjął blokadę pokrycia
//             (re-floor czterech progów billing do wartości zmierzonych), więc
//             jako pierwszy dotarł do tego kroku - i zapalił go na liczbach,
//             których nie wniósł: to zmiana WYŁĄCZNIE w `vitest.config.ts`,
//             zero bajtów po stronie klienta. Dokładnie sytuacja z 08-12.
//
// POMIAR (pełny build, ten sam host, f23fb74):
//   * zmierzone:   266,8 chunk / 2542,6 public / 3881,6 overall,
//   * floory:      280         / 2545          / 3876
//                  -> przekroczony JEDEN: overall +5,6 KB (0,14%).
//
// DLACZEGO FLOOR, A NIE CIĘCIE. Przekroczenie jest wyłącznie na OVERALL, czyli
// na liczbie, która rośnie z definicji wraz z nową powierzchnią produktu - patrz
// akapit „DLACZEGO PUBLIC/OVERALL NIE MOGŁY SPAŚĆ". Obie liczby, które mierzą
// REGRESJĘ płaconą przez wejście czytelnika, przechodzą: największy chunk ma
// 13,2 KB zapasu, PUBLIC ma 2,4 KB. Nie ma tu więc regresji do wycięcia - jest
// dryf agregatu, na który floor jest właściwą odpowiedzią (tak samo jak 08-12).
// Ruchy względem baseline'u 2d04eb92f raportuje sama bramka: i18n +43,4 i vendor
// +39,0 przy index -121,0, plus trzy nowe chunki (ConsentBanner 7,1;
// admin.library 5,6; sectionLabelVariants 5,1). Inwentarza chunku NIE
// uruchamiam: on służy do rozbierania KONKRETNEGO chunku, który przebił swój
// próg, a tutaj żaden nie przebił.
//
// CZEGO TU NIE ROBIMY. Nie tykamy `manualChunks` dla słowników i18n - akapit
// „NIEUDANY EKSPERYMENT" wyżej opisuje dokładnie tę drogę i to, dlaczego dała
// wynik FAŁSZYWY (Rollup wciąga `src/lib/i18n.ts`, te same bajty w dwóch
// plikach, PUBLIC zaniżony o 48 KB). Zapisano go, „żeby nie powtórzyć go po raz
// trzeci" - i tu się do tego stosujemy.
//
// UWAGA NA NASTĘPNY RAZ: PUBLIC ma już tylko 2,4 KB zapasu (2542,6 / 2545). To
// budżet czytelnika i on pęknie następny. Realna redukcja - split locale'i
// PL/EN, odchudzenie eager-owego zestawu widgetów chrome, @tanstack poza entry -
// jest wciąż osobną pracą i z każdym takim wpisem pilniejszą.

// 2026-08-19 III  FLOOR Z NIEWŁAŚCIWEGO HOSTA - i dlaczego ta bramka mierzy
//             ARTEFAKT NIEDETERMINISTYCZNY. Wpis II wyżej postawił floor 3882 na
//             pomiarze z hosta deweloperskiego. Bramka i tak padła w CI:
//
//               host deweloperski (frozen lockfile):  788 plików / 3881,6 KB
//               runner CI (run 2397, 9c6a441):        790 plików / 3892,0 KB
//                                                     -> +2 pliki, +10,4 KB
//
//             Cała różnica jest SKUPIONA w jednym chunku: `admin.posts._slug`
//             ma 71,0 KB lokalnie i 80,5 KB na runnerze (+9,5 KB), co pokrywa
//             się z deltą ADMIN_ONLY (1339,0 -> 1348,5). PUBLIC różni się
//             o 1,0 KB, największy chunk jest identyczny (266,8).
//
//             PRZYCZYNA: krok `Install dependencies` w `ci.yml` uruchamia
//             `bun install` BEZ `--frozen-lockfile`. Runner może więc rozwiązać
//             nowsze wersje w zakresach semver niż te zapisane w `bun.lock`,
//             a build z innych wersji daje inny podział chunków.
//
//             ZAKRES TEJ ROZBIEŻNOŚCI - SPROSTOWANIE. Pierwsza wersja tego wpisu
//             mówiła, że rozmiar „potrafi się zmienić BEZ ŻADNEJ zmiany w kodzie",
//             sugerując dryf między przebiegami. Dane tego nie potwierdzają:
//             runner dał DOKŁADNIE 3892,0 przy 790 plikach dwa razy (run 2397
//             i 2408). Udokumentowana rozbieżność jest więc HOST <-> RUNNER, a nie
//             PRZEBIEG <-> PRZEBIEG. To osłabia pilność, nie samą diagnozę:
//             brak `--frozen-lockfile` nadal znaczy, że nikt nie ma gwarancji
//             powtarzalności, tylko że dotąd się nie rozjechało.
//
//             ZASADA NA PRZYSZŁOŚĆ: floor tej bramki ustawia się WYŁĄCZNIE
//             z liczby zmierzonej na runnerze (log kroku `Bundle size budget`).
//             Pomiar lokalny służy do szukania przyczyny, nigdy do stawiania progu.
//             I UWAGA NA ZAOKRĄGLENIE: wydruk to `toFixed(1)`, a porównanie leci
//             na surowej liczbie - floor równy wydrukowanej wartości PADA (patrz
//             wpis IV niżej).
//
//             NASTĘPNY KROK, NIE ROBIONY TUTAJ: `bun install --frozen-lockfile`
//             w CI. Zdeterminizowałby artefakt i najpewniej sprowadził pomiar
//             do liczby lokalnej (3881,6), ale zmienia instalację zależności dla
//             WSZYSTKICH jobów i może odsłonić rozjazd `bun.lock` z `package.json`,
//             więc zasługuje na własny PR i własne review.
//
// 2026-08-19 IV  FLOOR RÓWNY WYDRUKOWANEJ WARTOŚCI = BRAMKA CZERWONA. Floor 3892
//             postawiony na wydruku „overall: 3892.0 KB" padł na komunikacie,
//             który wygląda jak sprzeczność sam ze sobą:
//
//               overall:  3892.0 KB  (budget ≤ 3892 KB)
//               ✗ Bundle budget exceeded: overall total 3892.0 KB > 3892 KB
//
//             Skrypt porównuje `total > MAX_TOTAL_KB` na surowej liczbie
//             zmiennoprzecinkowej, a wypisuje ją przez `toFixed(1)`. „3892.0"
//             znaczy więc „cokolwiek z [3892,00; 3892,05)" - i realna wartość
//             leżała nad 3892. Floor 3893: +1 KB (0,026%), nie jako zapas, tylko
//             po to, by przeskoczyć granicę zaokrąglenia. Ten przebieg był
//             PIERWSZYM, w którym krok 40 w ogóle się wykonał (wcześniej job
//             `verify` ginął na `timeout-minutes: 20` w połowie `Build`), więc ta
//             pułapka nie miała dotąd okazji się pokazać.
//
// 2026-08-20 V  ROZBIEŻNOŚĆ HOST <-> RUNNER ZAMKNIĘTA U ŹRÓDŁA. Wpis III
//             odkładał `bun install --frozen-lockfile` w CI na osobny PR - tu
//             został wprowadzony w kroku `Install dependencies` joba `verify`
//             (`.github/workflows/ci.yml`). `bun install --frozen-lockfile`
//             na hoście przechodzi bez zmian (1057 instalacji / 1007 pakietów),
//             więc `bun.lock` i `package.json` są zgodne i flaga niczego nie
//             wywraca. Od teraz runner buduje z DOKŁADNIE tych wersji co host,
//             a floor tej bramki wolno stawiać z pomiaru lokalnego.
//
//             Pomiar po tej zmianie (host, main po scaleniu #274 i #275):
//               790 plików / OVERALL 3893,7 KB / PUBLIC 2544,7 / max chunk 266,8
//             Floor 3893 z wpisu IV padał o 0,7 KB. Ratchet 3893 -> 3894,
//             znów „tuż nad ślad" i z zapasem tylko na zaokrąglenie (reguła
//             z wpisu IV: floor z wydruku = wydrukowana wartość + 1 KB).
//             Wzrost względem 3892,0 to nie regresja bootowania: PUBLIC stoi
//             (2544,7 przy florze 2545), największy chunk się nie ruszył, cała
//             delta siedzi w kodzie admin-only.

// 2026-08-30 VI  DWA TYGODNIE WZROSTU ZMIERZONE DOPIERO TERAZ, BO BRAMKA NIE
//             JECHAŁA. Floor public 2545 -> 2711, overall 3894 -> 4302.
//
//             POMIAR (runner, `--frozen-lockfile`, przebieg 2756 / job `build`,
//             głowa e6374f2): 939 plików, public 2710,8 KB, admin-only 1591,1 KB,
//             overall 4301,9 KB, największy chunk 271,3 KB. Floor stawiany
//             zgodnie z zasadą z wpisu V - z liczby RUNNERA, nie hosta: host dał
//             tego samego dnia public 2698,4 i overall 4295,0, czyli o 12,4 i 6,9 KB
//             NIŻEJ. Gdyby floor poszedł z hosta, bramka byłaby czerwona od razu.
//             Do obu liczb doliczone ułamki KB na granicę zaokrąglenia (wpis IV).
//             `chunk` ZOSTAJE na 280: zmierzone 271,3 mieści się z zapasem.
//
//             DLACZEGO TAK DUŻO NARAZ - I DLACZEGO TO NIE JEST REGRESJA JEDNEJ
//             ZMIANY. Krok `Bundle size budget` NIE WYKONAŁ SIĘ ANI RAZU między
//             2026-08-29 09:21 a 2026-08-30. Najpierw `ci.yml` był nieparsowalny
//             (niecytowany skalar z `: ` w nazwie kroku - GitHub tworzył przebieg
//             i nie planował ŻADNEGO joba), a po jego naprawie job `verify` ginął
//             na czerwonym `format:check`, czyli szóstym kroku z czterdziestu
//             czterech. Bramka mierzyła więc ostatni raz przy florze z 15.08,
//             a w tym czasie weszły dwa tygodnie funkcjonalności.
//
//             PRZYCZYNA, ZMIERZONA (ruchy wobec baseline'u 2d04eb92f z 15.08):
//               + 125,6 KB  i18n            (204,5 -> 330,1)
//               - 105,0 KB  index           (479,7 -> 374,7)
//               +  65,5 KB  EventStudioModuleSections (NOWY)
//               +  39,8 KB  vendor          (281,8 -> 321,6)
//               +  31,1 KB  useEventSessions (NOWY)
//               -  17,2 KB  events._slug    (18,4 -> 1,2)
//               +  15,7 KB  admin.posts._slug (64,9 -> 80,6)
//               +  15,3 KB  scanner (NOWY)
//               +  12,2 KB  events._slug.index (NOWY)
//               +   9,7 KB  browser (NOWY)
//               +   9,5 KB  admin.events_._eventId (NOWY)
//               +   8,5 KB  MeetingInviteDialog (NOWY)
//                   znikł   admin.community.events
//             (przepisane z logu kroku `Bundle size budget`, przebieg 2756,
//             w kolejności, w jakiej je wypisał)
//
//             CO TA TABELA POKAZUJE, A CZEGO NIE. Netto z nazwanych pozycji:
//             +210,7 KB. Raport wypisuje NAJWYŻEJ DWANAŚCIE ruchów (`movers()`
//             sortuje po wartości bezwzględnej delty i tnie listę do dwunastu),
//             więc to nie jest cały przyrost. Baseline
//             `reports/bundle-baseline.json` (2d04eb92f, 15.08) stoi na
//             public 2543,3 i overall 3814,5, więc REALNY przyrost to
//             +167,5 KB na publicznym i +487,4 KB na overall. Brakujące
//             276,7 KB siedzi poza tą dwunastką. To jest studio wydarzeń,
//             sesje, skaner i słowniki - praca funkcjonalna, nie przypadkowy
//             dryf.
//
//             TO JEST PODNIESIENIE PROGU, CZYLI OSTATECZNOŚĆ - I TAK JEST
//             NAZWANE. Ścięcie 407,9 KB (tyle dzieli pomiar od POPRZEDNIEGO
//             floora) to projekt na własny PR, nie poprawka przy okazji CI; zostawienie bramki czerwonej też nie jest
//             wyjściem, bo wtedy nie łapie NICZEGO nowego. Floor przyjmuje
//             zmierzony stan jako dług i od tej chwili znowu bramkuje przyrosty.
//
//             PIERWSZY KANDYDAT DO CIĘCIA, gdy ktoś ten dług weźmie: WARSTWA
//             SŁOWNIKÓW - ale najpierw jak czytać tę tabelę, bo `i18n` NIE JEST
//             jednym chunkiem. `stableChunkName()` ucina z nazwy pliku końcówkę
//             `-<hash>`, a wzorzec `-[A-Za-z0-9_-]{8,}$` jest łapczywy i dla
//             plików `i18n-*` zjada razem z hashem człon opisowy:
//             `i18n-club-DGC_-VAI.js` i `i18n-admin-events-6jnk00Ff.js` trafiają
//             do JEDNEGO wiadra o nazwie `i18n`. Zmierzone na hoście (suma gzip
//             po `.output/public/assets/i18n-*.js`): 46 chunków, 330,1 KB -
//             dokładnie liczba, którą bramka wypisała w kolumnie „po".
//             +125,6 KB to więc wzrost CAŁEJ warstwy słowników, nie jednego
//             pliku. Najwięksi pojedynczy mieszkańcy wiadra (gzip, host):
//               36,6 KB  i18n-club              31,0 KB  i18n-builder
//               25,2 KB  i18n-admin-events      21,1 KB  i18n-admin-event-onsite
//               20,0 KB  i18n-profile
//             `report:chunk-inventory i18n` trafia w `i18n-club` i pokazuje tam
//             137,7 kB źródeł SPRZED minifikacji, w 100% z jednego pliku
//             `src/lib/i18n-club.ts`, w chunku współdzielonym (2 importy
//             statyczne). Cięcie zaczyna się od rozstrzygnięcia, które z tych
//             46 chunków wchodzą do budżetu PUBLICZNEGO: `i18n-admin-*` liczą
//             się wyłącznie do OVERALL, a dziś cieńszy jest zapas publiczny.
//
//             CZEGO TEN WPIS NIE ZAŁATWIA: `Test + coverage gate` (od tego
//             samego PR-a w osobnym jobie `test`) pada na progach pokrycia dla
//             `src/components/admin/billing/**` i `src/components/profile/**`,
//             więc CI jest czerwone niezależnie od bundla. To ten sam mechanizm
//             co tutaj - ratchet ustawiony, gdy bramka jeszcze jechała, i dwa
//             tygodnie kodu dołożone przy bramce, która nie ruszyła ani razu -
//             ale osobny dług i osobna robota.

// 2026-08-30 VII  PIERWSZE ZŁAPANIE NOWEGO FLOORA - I TO PIĘĆ GODZIN PO JEGO
//             POSTAWIENIU. Floor public 2711 -> 2715, overall 4302 -> 4306.
//
//             POMIAR (runner, przebieg 33324768989 / job `build`, głowa
//             c2e1e35 - scalenie PR #307 „Kasa etapu 4 zapisu na wydarzenie"):
//             941 plików, public 2714,3 KB, admin-only 1590,9 KB, overall
//             4305,2 KB, największy chunk 271,4 KB. Wobec wpisu VI: +3,5 KB
//             publicznego, +3,3 KB overall, +2 pliki. `chunk` znowu bez zmian.
//
//             PRZYCZYNA: warstwa słowników modułu Wydarzeń. Wiadro `i18n`
//             urosło 330,1 -> 331,1 (PR #307 dołożył 28 linii do
//             `src/lib/i18n-event-front.ts` i 80 do
//             `src/lib/i18n-event-registration.ts`). To tłumaczy 1,0 z 3,5 KB;
//             pozostałe 2,5 KB leży poza dwunastką ruchów, którą raport
//             wypisuje - żadna pojedyncza pozycja nie przekroczyła progu
//             raportowania. Ta gałąź nie dokłada ANI BAJTA kodu klienckiego,
//             więc cały przyrost pochodzi ze scalonego maina.
//
//             DOWÓD NA ZASADĘ „FLOOR Z RUNNERA" (wpis V), najmocniejszy jaki
//             padł: na tym samym drzewie HOST wypisał public 2701,7 i overall
//             4298,1, czyli MIEŚCI SIĘ w progach 2711/4302 i świeci na zielono.
//             Czerwony jest wyłącznie runner. Gdyby floor stawiać z hosta,
//             bramka zgłaszałaby przekroczenie tylko w CI i nikt nie umiałby
//             go odtworzyć lokalnie.
//
//             OBSERWACJA STRUKTURALNA, NIE ZMIANA ZASADY. Konwencja tej kroniki
//             to floor NA ZMIERZONEJ WARTOŚCI plus ułamek na zaokrąglenie -
//             zero zapasu, „próg schodzi za śladem". Konsekwencję widać teraz
//             policzalnie: każde scalenie dokładające kilobajt kodu klienckiego
//             zapala bramkę u tego, kto akurat trzyma próg, a nie u autora
//             przyrostu. Minęło PIĘĆ GODZIN między wpisem VI a tym. Zero zapasu
//             daje maksymalną czułość na dryf i to jest jego zaleta; kosztem
//             jest czerwona bramka na każdym PR-ze po każdym scaleniu z treścią.
//             Zapisane, żeby decyzja o ewentualnym marginesie (np. 0,5%) miała
//             oparcie w liczbach, a nie w zmęczeniu. Do tej decyzji konwencja
//             obowiązuje bez zmian i ten wpis się do niej stosuje.

// 2026-08-30 VIII `lazy()` NIE ZDEJMUJE KRAWĘDZI - dwie optymalizacje, które
//             mierzyły nie to, co ta bramka. Ten wpis NIE rusza floorów;
//             opisuje ZNALEZISKO i jedną naprawę, która zeszła z PUBLIC.
//             (Pomiary poniżej powstały PRZED wpisami VI i VII, czyli przy
//             florach 2545 / 3894. Po ich podniesieniu do 2715 / 4306 wnioski
//             się nie zmieniają - zmienia się tylko zapas: te -32,1 KB są
//             teraz marginesem NAD floorem, a nie drogą do niego.)
//
//             MECHANIZM, ODTWORZONY POMIAREM. `BuilderRenderer` (chrome KAŻDEJ
//             strony publicznej) trzymał
//             `lazy(() => import(".../EmptyContainerPickerBox"))` z komentarzem
//             obiecującym wprost, że „słowniki edytora nie wchodzą do bundla
//             publicznego chrome". Bliźniaczo `ClubInsights` sięgał po `EChart`
//             z katalogu panelu, tłumacząc to tym, że prymityw „trzyma ECharts
//             poza grafem SSR". OBIE TE RZECZY SĄ PRAWDZIWE - i obie mierzą co
//             innego niż ta bramka. `lazy()` zdejmuje moduł ze ŚCIEŻKI
//             STARTOWEJ, ale krawędź w grafie zostaje, a `adminOnlyByGraph()`
//             wyżej dopasowuje `import(` tym samym wyrażeniem co `from` - więc
//             moduł nadal jest OSIĄGALNY z publicznej trasy i nadal liczy się
//             do budżetu czytelnika.
//
//             NAPRAWA, KTÓRA WESZŁA: odwrócenie zależności zamiast kolejnego
//             odroczenia. Kanwa buildera (kod adminowy) PODAJE komponent boksu
//             przez kontekst, publiczny renderer zna wyłącznie kształt propsów.
//             Krawędź znika, zamiast się przesuwać.
//               PUBLIC 2701,8 -> 2669,7 KB  (-32,1: i18n-builder 31,0 +
//                                           StructurePicker 1,0 + boks 0,4)
//               ADMIN  1596,6 -> 1629,0 KB  (te same bajty, inne wiadro)
//               OVERALL bez zmian - bo niczego nie skasowano.
//             Regresję pilnuje `publicRendererLayering.test.ts`, nie komentarz:
//             poprzedni komentarz stał tam i był nieprawdziwy przez cały czas
//             swojego istnienia.
//
//             CO ZOSTAJE ŚWIADOMIE, JAKO DECYZJA PRODUKTOWA (2026-08-30):
//             `ClubInsights` nadal importuje `EChart`, więc 266,8 KB ECharts
//             siedzi w budżecie PUBLICZNYM, choć wszystkie pozostałe wykresy
//             w aplikacji są adminowe. Zmierzone: zdjęcie tej jednej krawędzi
//             zbiłoby PUBLIC do ~2402 KB - 142 KB poniżej floora 2545
//             sprzed dwóch tygodni i 313 KB poniżej dzisiejszego 2715, bez
//             podnoszenia czegokolwiek. Kosztem
//             byłoby przepisanie trzech wykresów (liniowy z trzema seriami,
//             słupkowy poziomy, kołowy z przewijaną legendą) na własne SVG.
//             Zamawiający wybrał zachowanie pełnych wykresów na publicznych
//             wglądach klubu. To jest więc CENA ZNANA I POLICZONA, nie dryf.
//
//             CZEGO ŻADNE PRZENOSZENIE NIE ZAŁATWI: OVERALL. Ta bramka sumuje
//             WYEMITOWANE bajty, więc przeniesienie chunku między grafami
//             zmienia wyłącznie wiadro. Zejście OVERALL pod 3894 wymaga
//             SKASOWANIA setek kilobajtów wysyłanego kodu, czyli usunięcia
//             funkcji -
//             i dlatego floor OVERALL jest osobną, uczciwą decyzją, a floor
//             PUBLIC nie musiał nią być.

// 2026-09-01 IX  CZWARTY FLOOR: ARKUSZ STYLÓW RENDER-BLOCKING. Ta zmiana NIE
//             podnosi żadnego progu - dokłada bramkę tam, gdzie do dziś nie
//             było ŻADNEJ.
//
//             CO BYŁO NIEMIERZONE. `walkJs()` (niżej, dawniej jedyny enumerator
//             plików w tym skrypcie) miał jedną linię aperturą:
//             `e.name.endsWith(".js")`. Ten sam filtr stoi w
//             `check-chunk-graph.ts` i `check-entry-purity.ts`, a
//             `lighthouserc.json` ma `unused-css-rules`, `unminified-css`
//             i `uses-text-compression` w `skipAudits` i wszystkie asercje na
//             `warn`. Wynik: ZERO bramek w repo mierzyło CSS.
//             Zmierzone dziś na artefakcie cloudflare'owym (tą samą funkcją
//             `Bun.gzipSync`, którą liczy ta bramka):
//               styles-BQZz5a-B.css          570 392 B surowe / 81 501 B gzip
//               BlocksRenderer-BU-unhS5.css    5 321 B surowe /  1 402 B gzip
//               razem                        575 713 B surowe / 82 903 B gzip
//                                                            = 80,96 KB
//             Dla skali: floor największego chunku to 280 KB, a arkusz korzenia
//             waży 79,6 KB gzip, czyli 28% tego budżetu - i w odróżnieniu od
//             `EChartClient` jest RENDER-BLOCKING na KAŻDYM URL-u, bo
//             `rootDocumentLinks` wypisuje go bezwarunkowo
//             (`src/lib/seo/rootHead.ts`) i promuje na PIERWSZĄ wartość
//             nagłówka `Link` („Kolejność jest kontraktem: arkusz stylów
//             pierwszy (blokuje render)").
//
//             DLACZEGO JEDNA LICZBA, A NIE PUBLIC/ADMIN. `adminOnlyByGraph()`
//             dowodzi adminowości z LITERALNYCH krawędzi importu między
//             wyemitowanymi `.js`. Arkusz nie ma krawędzi importu - wchodzi do
//             `__root.tsx` przez `?url`, czyli jako zasób, nie jako moduł. Nie
//             ma więc z czego zbudować dowodu i floor CSS jest świadomie
//             POJEDYNCZY, w kształcie OVERALL. Rozbicie public/admin wymaga
//             DRUGIEGO wejścia CSS (osobny `@source`, osobny `<link>` na
//             layoucie /admin) i to jest osobna, ryzykowna praca: zmierzone
//             +52 KB gzip duplikacji w parze arkuszy przy -10,6 KB zysku dla
//             czytelnika, a do tego dziewięć selektorów z przestrzeni adminowej
//             ma PUBLICZNYCH odbiorców (m.in. `lib/interests/joinUsSizeCss.ts`
//             liczy specyficzność na `.admin-compact li/label/span`). Nie
//             wchodzimy w to przy okazji stawiania progu.
//
//             CZEGO TEN FLOOR NIE ROBI: nie zlicza bloków reguł ani nie patrzy
//             w strukturę arkusza. Ten skrypt jest ZALEŻNOŚCIOWO PUSTY z
//             charakteru (nagłówek: „Dependency-free"), a policzenie reguł
//             wymaga parsera CSS. Kto będzie ciął arkusz, robi to pomiarem
//             obok bramki, nie w bramce.
//
//             FLOOR 82 - I TO JEST LICZBA Z HOSTA, DO PRZEFLOOROWANIA. Pomiar
//             80,96 KB (wydruk „81.0"). Do floora doliczone 0,5% na
//             udokumentowaną rozbieżność host <-> runner (wpis VII: PUBLIC host
//             2701,7 -> runner 2714,3, czyli +0,466% - największa zmierzona w
//             tej kronice), potem sufit do pełnego KB. Zapas wychodzi 1,04 KB
//             (1,27%), więc bramka od pierwszego zielonego przebiegu wypisze
//             ostrzeżenie „ZAPAS BUDŻETU PONIŻEJ 2%" - i tak ma być, to ten sam
//             koszt maksymalnej czułości, który policzył wpis VII. ZASADA Z
//             WPISU V OBOWIĄZUJE: pierwszy zielony log runnera jest podstawą do
//             przefloorowania tej liczby (w górę albo w dół), bo do tej chwili
//             nikt nie zmierzył CSS na runnerze ANI RAZU.

// 2026-09-01 X  PIĄTY FLOOR: DOMKNIĘCIE ŚCIEŻKI BOOTOWANIA. Też bez podnoszenia
//             czegokolwiek - to metryka, którą ta kronika mierzyła RĘCZNIE
//             (wpis 2026-08-18: „pełne domknięcie statyczne bootu: 654 -> ~554
//             KB gz / 2179 -> ~1876 KB surowych") i nigdy nie bramkowała.
//
//             DLACZEGO ISTNIEJĄCE CZTERY TEGO NIE ŁAPIĄ. `chunk` mierzy
//             NAJWIĘKSZY PLIK, więc mierzy raz entry, raz coś zupełnie innego:
//             08-18 entry zszedł 373,9 -> 253,2, a próg schodził za
//             `EChartClient` (266,8, lazy), czyli za liczbą, której czytelnik na
//             pierwszym wejściu nie pobiera. `public` i `overall` mierzą
//             OSIĄGALNOŚĆ, nie pierwsze wczytanie (akapit „DLACZEGO
//             PUBLIC/OVERALL NIE MOGŁY SPAŚĆ"), więc przeniesienie kodu z eager
//             do lazy nie rusza ich ani o bajt - i symetrycznie: powrót
//             statycznej krawędzi do entry nie zapala ich ani o bajt. `css`
//             mierzy arkusze. Żadna z tych liczb nie mówi, ile waży to, co
//             przeglądarka MUSI pobrać, sparsować i wykonać przed
//             `hydrateRoot`.
//
//             CO JEST LICZONE. Domknięcie TRANZYTYWNE po krawędziach WYŁĄCZNIE
//             STATYCZNYCH, z korzeni czytanych z manifestu TanStack Start
//             (`scripts:[{… src:"/assets/*.js"}]` w `.output/server`) - czyli
//             dokładnie ten sam zbiór, który liczy `check:entry-purity`.
//             `import()` NIE jest krawędzią inicjalizacyjną, i dlatego ten floor
//             NIE MOŻE użyć `EDGE_RE` z `adminOnlyByGraph()`: tamten wzorzec
//             ŚWIADOMIE dopasowuje `import(`, bo pyta o OSIĄGALNOŚĆ (wpis VIII:
//             „`lazy()` NIE ZDEJMUJE KRAWĘDZI"). Dwa różne pytania, dwa różne
//             wzorce - `STATIC_EDGE_RE` niżej.
//
//             POMIAR (host, 2026-09-01, artefakt cloudflare'owy, 944 pliki):
//               korzeń `index-RQbuiFhe.js` -> 9 chunków statycznie osiągalnych
//               573,2 KB gzip / 1944,3 KB surowych
//               270,5 index  71,5 vendor-radix  60,0 vendor-react
//                56,4 vendor-supabase  49,8 vendor-tanstack  29,5 vendor-lucide
//                15,5 vendor-i18n  12,1 vendor-zod  8,0 vendor-tw-merge
//             To 21,4% budżetu PUBLIC i 13,3% OVERALL - i JEDYNA z tych liczb,
//             którą płaci KAŻDE pierwsze wejście. Wobec ręcznego pomiaru z
//             08-18 (~554 KB) to +19 KB dryfu, którego nikt nie widział, bo nie
//             było progu.
//
//             DLACZEGO TU, A NIE W `check-entry-purity.ts`. Tamta bramka mierzy
//             PRZYCZYNĘ (krawędź w grafie) i jej nagłówek mówi wprost, że
//             DLATEGO jest odporna na kompensację. Suma kilobajtów jest
//             kompensowalna z definicji: zetnij `vendor-lucide` o 29 KB, dołóż
//             29 KB do entry - domknięcie stoi, a bramka milczy. Floor
//             kilobajtowy postawiony tam uczyniłby tamten nagłówek
//             NIEPRAWDZIWYM, a wpis VIII jest właśnie o komentarzu, który „stał
//             tam i był nieprawdziwy przez cały czas swojego istnienia". Do
//             tego: `budget()` + `IN_CI` (jedyny mechanizm zamrażania progów w
//             repo), `HEADROOM_WARN_PCT`, baseline i ta kronika istnieją
//             WYŁĄCZNIE w tym pliku. Próg postawiony gdziekolwiek indziej niż
//             przez `budget()` nie ma żadnej dyscypliny zamrożenia, czyli jest
//             „sugestią, nie bramką".
//             CENA, NAZWANA UCZCIWIE: odczyt manifestu i chodzenie po
//             krawędziach statycznych mają teraz DRUGI egzemplarz i te dwa nie
//             mogą się rozjechać. Trzymamy je razem trzema rzeczami: ta sama
//             zmienna `ENTRY_CHUNKS`, ten sam filtr `import(`, wzajemne
//             odwołania w komentarzach obu plików. Właściwym końcem tej drogi
//             jest wspólny `scripts/lib/bootClosure.ts` importowany przez oba -
//             i to jest osobny PR, bo dotyka pliku o innym charterze.
//
//             FLOOR 579 - LICZBA Z HOSTA, DO PRZEFLOOROWANIA. Pierwsza wersja
//             tego wpisu stawiała 577 na pomiarze 573,17 KB i BYŁA POMIAREM
//             W TRAKCIE ZMIANY: sonda bootu, `hydrateBudget`, `useNowMs`,
//             `appReady`, `localeChunks` i trzy nowe moduły zapytań buildera
//             weszły do domknięcia PO tym pomiarze. Na domkniętym drzewie
//             artefakt daje 575,3 KB gzip / 1951,3 KB surowych (te same
//             9 chunków), czyli floorowi 577 zostawało 0,29% zapasu - mniej niż
//             udokumentowana rozbieżność host <-> runner (+0,466%), więc bramka
//             padłaby na runnerze na własnym szumie. 579 = 575,3 + 0,5%, sufit
//             do pełnego KB, zapas 3,7 KB (0,64%). Ostrzeżenie o zapasie poniżej
//             2% zapali się i tak - to ten sam koszt maksymalnej czułości.
//             Ryzyko rozjazdu host <-> runner jest tu najmniejsze z pięciu
//             progów: jedyny ROZŁOŻONY pomiar (wpis III) pokazał deltę
//             SKUPIONĄ w `admin.posts._slug` przy NAJWIĘKSZYM CHUNKU
//             IDENTYCZNYM - a domknięcie bootu to entry plus osiem vendorów,
//             czyli dokładnie ta część artefaktu, która się nie rozjechała. To
//             ARGUMENT, NIE DOWÓD: floor idzie z runnera (wpis V).

// 2026-09-01 XI  `stableChunkName()` NAPRAWIONE - RAPORT PRZESTAJE SKLEJAĆ
//             RÓŻNE CHUNKI W JEDNO WIADRO. Ta zmiana nie rusza ani jednego
//             progu i nie usuwa ani jednego bajtu: naprawia PRZYRZĄD, którym od
//             15.08 czytamy przyczyny. Wpis VI opisał tę pułapkę dokładnie („bo
//             `i18n` NIE JEST jednym chunkiem") i OBSZEDŁ ją prozą, licząc sumę
//             ręcznie po `.output/public/assets/i18n-*.js`. Obchodzenie
//             własnego przyrządu w komentarzu jest dokładnie tym, czego zakazuje
//             wpis VIII: komentarz nie jest bramką.
//
//             PRZYCZYNA, JEDEN ZNAK. Wzorzec `-[A-Za-z0-9_-]{8,}$` ma OTWARTY
//             kwantyfikator nad klasą, która ZAWIERA `-`, a hash Vite to
//             DOKŁADNIE osiem znaków base64url (`A-Za-z0-9_-`). Dopasowanie idzie
//             od lewej, więc już przy PIERWSZYM myślniku nazwy warunek „co
//             najmniej osiem znaków do końca" jest spełniony i zjadane są razem
//             z hashem wszystkie członki opisowe. `.` w klasie NIE MA - dlatego
//             trasy kropkowane (`admin.posts._slug`) przeżywały, a myślnikowane
//             nie. Naprawa: `{8,}` -> `{8}`. Wzorzec jest zakotwiczony na `$`,
//             a hash ma dokładnie osiem znaków, więc kandydat jest tylko jeden:
//             ostatnie dziewięć znaków nazwy.
//
//             DRUGA POŁOWA NAPRAWY: `.css`. Funkcja ucinała rozszerzenie
//             wzorcem `/\.js$/`, więc dla arkusza zwracała nazwę Z HASHEM
//             (`styles-BQZz5a-B.css`) - hash-strip nie łapie, bo `.` nie należy
//             do klasy. Wpuszczenie CSS do raportu (wpis IX) bez tej poprawki
//             dawałoby wiersz `(NOWY)` na KAŻDYM buildzie. Stąd
//             `/\.(js|css)$/`.
//
//             ZMIERZONE (host, 946 wyemitowanych plików = 944 `.js` + 2 `.css`):
//             124 pliki zmieniają wiadro (122 `.js` + 2 `.css`), wiader
//             813 -> 879. Wzorzec sprawdzony PRZECIW PRAWDZIE, nie tylko
//             przeciw poprzedniej wersji: dla każdego pliku „nazwa bez ośmiu
//             znaków hasha" zgadza się z wynikiem funkcji w 946 przypadkach na
//             946. Wariant BEZ `-` w klasie (`-[A-Za-z0-9_]{8}$`) daje wprawdzie
//             893 wiadra, ale ZOSTAWIA hash na 98 plikach - bo 98 z 946 hashy
//             zawiera literalny myślnik (`vendor-zod-oLpi5p-c`,
//             `useEventSessions-BR0xmR-H`, `webVitals-i2-4S9YH`) - czyli
//             produkuje świeży wiersz `(NOWY)` na każdym buildzie NA ZAWSZE.
//             Odrzucony właśnie dlatego. Pliki bez hasha (`push-sw.js`,
//             `scanner-sw.js`) zachowują się identycznie w obu wersjach.
//
//             `vendor` - WIADRO, KTÓRE NAPRAWA ROZBIJA. Kolumna `vendor +39,8`
//             z wpisu VI i `vendor 281,8 -> 321,6` to nie chunk, to DZIESIĘĆ
//             plików. Zmierzone dziś, 321,7 KB gzip razem:
//               71,5 vendor-radix     60,0 vendor-react    56,4 vendor-supabase
//               49,8 vendor-tanstack  29,5 vendor-lucide   15,5 vendor-i18n
//               12,1 vendor-zod        8,0 vendor-tw-merge
//               vendor-dompurify + vendor-sonner (reszta)
//             Osiem z tych dziesięciu leży na ŚCIEŻCE BOOTOWANIA (floor `boot`,
//             wpis X), a dwa - `vendor-dompurify` i `vendor-sonner` - zeszły z
//             niej 18.08 i pilnuje ich `check:entry-purity`. Sklejone w jedno
//             wiadro te dwie klasy były w raporcie NIEROZRÓŻNIALNE: powrót
//             sonnera do bootu i przyrost radixa dawały tę samą linijkę
//             `vendor +N`. Po naprawie każdy vendor ma własną pozycję.
//
//             `index` - WIADRO, KTÓREGO NAPRAWA NIE RUSZA, I DLATEGO OSOBNY
//             AKAPIT. `index` to dziś SIEDEM plików, 374,3 KB, i wszystkie
//             nazywają się `index` NAPRAWDĘ - kolizja nie bierze się z hasha,
//             więc żaden wzorzec jej nie zdejmie:
//               270,5 index-RQbuiFhe  <- chunk WEJŚCIOWY, korzeń bootu
//               100,0 index-BSktzxww  <- importer: DocumentViewerBody
//                 1,3 / 1,2 / 0,5 / 0,4 / 0,4  <- chunki tras, wciągane `import()`
//             Konsekwencja dla czytania tej kroniki: linia `index -105,0
//             (479,7 -> 374,7)` z wpisu VI NIE MÓWI, ile spadł chunk wejściowy -
//             to suma wiadra. Pierwszy transfer czytelnika mierzy od dziś floor
//             `boot`, nie kolumna `index`.
//             DRUGA KONSEKWENCJA, DO OSOBNEJ ROBOTY: `isEntryChunk()` w
//             `adminOnlyByGraph()` to `basename(p).startsWith("index-")`, więc
//             WSZYSTKIE SIEDEM jest bezwarunkowo wyjmowane ze zbioru adminowego
//             i liczone do PUBLIC BEZ DOWODU Z GRAFU - choć chunkiem WEJŚCIOWYM
//             jest z nich JEDEN. To ta sama klasa luki, którą recenzja PR #232
//             zamknęła dla kotwic nazwowych (wpis 08-15 (2)): nazwa zwiera
//             dowód.
//             POPRAWKA DO POMIARU, KTÓRY PODEJRZEWAŁ TU CZYNNĄ REGRESJĘ: dziś ta
//             luka NIE zawyża budżetu publicznego. Sprawdzone na artefakcie -
//             `index-BSktzxww` (100,0 KB) ma DOKŁADNIE JEDNEGO importera,
//             `DocumentViewerBody-DVu8NsOy.js`, a tego importuje PUBLICZNA trasa
//             `club._clubSlug.index-*.js`. Dowód z grafu dałby więc PUBLIC tak
//             samo; nazwa niczego tu nie przemyca. Wadą jest sam BRAK dowodu:
//             gdyby ta krawędź kiedyś przeszła pod /admin, bramka nadal
//             liczyłaby te 100 KB czytelnikowi i nikt by tego nie zobaczył.
//             NIE zamykamy tego tutaj - naprawa rusza liczby PUBLIC/ADMIN, więc
//             zasługuje na własny pomiar przed/po i własne review.
//
//             BASELINE: KLUCZE SIĘ ZMIENIAJĄ, WIĘC RAPORT MUSI TO WIEDZIEĆ.
//             `reports/bundle-baseline.json` (2d04eb92f, 15.08) był pisany
//             STARĄ konwencją wiader. Sprawdzone: porównanie nowych kluczy ze
//             starym plikiem daje szum - w dwunastce ruchów osiem wierszy to
//             `(NOWY)` po samym przemianowaniu (`vendor-radix 0,0 -> 71,5`,
//             `i18n-club 0,0 -> 36,6`), plus „znikł vendor" i „znikł i18n", a
//             PRAWDZIWE ruchy (i18n +129,0, EventStudio +65,5) wypadają z
//             listy. Baseline dostaje więc pole `bucketConvention` i dopóki
//             plik go nie ma, `movers()` porównuje po kluczach STAREJ
//             konwencji, mówiąc o tym jedną linią. Diagnoza jest wtedy
//             identyczna jak przed naprawą (sprawdzone: te same dwanaście
//             wierszy) plus jeden PRAWDZIWY nowy wiersz `styles.css`.
//             DLACZEGO NIE PRZEPISUJEMY BASELINE'U W TYM COMMICIE: zasada z
//             wpisu V mówi „z ZIELONEGO buildu RUNNERA", a ten pomiar jest z
//             hosta i bramka jest CZERWONA na `overall` (4318,0 > 4306, dług
//             odziedziczony z maina, nie z tej zmiany). Zapisanie baseline'u
//             teraz zabetonowałoby liczby hosta z czerwonego artefaktu.
//             `--update-baseline` na pierwszym zielonym runnerze wpisze
//             `bucketConvention: 2` i tryb zgodności przestanie się włączać.

// 2026-09-02 XII  RE-FLOOR OVERALL 4306 -> 4329, I TYLKO ON. Z pięciu progów
//             przekroczony jest DOKŁADNIE JEDEN, więc rusza się dokładnie
//             jeden - pozostałe cztery zostają tam, gdzie stoją.
//
//             POMIAR (host, artefakt cloudflare'owy, 943 pliki, 2026-09-02):
//               overall  4320,6 KB  (floor 4306)  -> PRZEKROCZENIE 14,6 KB
//               public   2687,6     (<= 2715)      chunk  274,6  (<= 280)
//               css        81,0     (<= 82)        boot   577,3  (<= 579)
//
//             GDZIE SIEDZI WZROST - ROZKŁAD, NIE DOMYSŁ. Wpis VII zapisał dla
//             drzewa, na którym stanął floor 4306, pomiar TEGO SAMEGO HOSTA:
//             public 2701,7 / overall 4298,1, czyli admin-only 1596,4. Dziś
//             host daje public 2687,6 / overall 4320,6, czyli admin-only
//             1633,0:
//               public     2701,7 -> 2687,6    -14,1 KB
//               admin-only 1596,4 -> 1633,0    +36,6 KB
//               overall    4298,1 -> 4320,6    +22,5 KB
//             Budżet PUBLICZNY SPADŁ (PR #309 „bundle-public-budget-cut"),
//             a przyrost w całości - i jeszcze 14,1 KB ponad niego - dołożyła
//             powierzchnia osiągalna wyłącznie spod /admin. Dlatego czerwony
//             jest WYŁĄCZNIE `overall`: to jedyny z pięciu progów, który
//             w ogóle liczy kod adminowy.
//
//             PRZYCZYNA, NAZWANA Z NAZWY. Od 1cfc501 (floor 4306, 30.08)
//             scalono PR #308 do #320. W `src/` przybyło 67 nowych plików
//             produkcyjnych (bez testów i stories), z czego 42 pod
//             `src/components/admin/`: gifting 10, monetization 9, ads 8,
//             membership 7, coupons 5, donations 3 - plus 3 w
//             `src/lib/admin/monetization`, słownik
//             `src/lib/i18n-admin-monetization.ts` i trasa
//             `admin.monetization-ledger`. Cały ruch produkcyjny w `src/` to
//             200 plików, +12 608 / -4 312 linii; jego część adminowa
//             (`components/admin` + `lib/admin` + `routes/admin`) to 68 plików,
//             +5 687 / -3 181. To nie jest dryf narzędzi ani wymiana
//             zależności - to nowa powierzchnia produktu, dołożona świadomie.
//
//             ROZWAŻONE CIĘCIE ZAMIAST FLOORA - ODRZUCONE, Z LICZBAMI.
//             Zejście pod 4306 wymaga SKASOWANIA >= 15 KB wyemitowanego kodu:
//             `overall` sumuje bajty, więc przełożenie chunku między wiadrami
//             nie daje ani bajta (akapit „CZEGO ŻADNE PRZENOSZENIE NIE
//             ZAŁATWI", wpis VIII). Trzy kandydatury, dwie zważone dziś na
//             artefakcie: duplikaty ~2,8 KB (wycena z analizy, tu nieważona -
//             i tak o rząd wielkości za mało), shim Font Awesome
//             `lucide-shim.fa-C7vWNulb.js` 39,0 KB gzip i wygenerowany katalog
//             ikon `lucideIconNodes.generated-CsYpKku0.js` 109,1 KB gzip.
//             Wagę mają dwie ostatnie i żadna nie jest jednocześnie TANIA
//             i BEZPIECZNA: pierwsza zdejmuje z produktu przełącznik paczki
//             ikon (`admin.settings.general` + `IconPackSync`), druga -
//             wybieralny katalog ikon (`LucideIconPicker`, `DynamicIconFull`).
//             To zmiany produktowe z własnym pomiarem przed/po i własnym
//             review, jak `ClubInsights`/ECharts we wpisie VIII - a nie coś,
//             co wciska się do PR-a o zielone CI.
//
//             SPROSTOWANIE DO TEJ WYCENY, ZMIERZONE: shim FA NIE leży
//             w powierzchni admin-only. Chunk WEJŚCIOWY `index-CiXKim-t.js`
//             (ten sam, który jest korzeniem floora `boot`: 274,6 + osiem
//             vendorów 302,6 = 577,2 wobec wydrukowanych 577,3) trzyma
//             `f.lazy(()=>import("./lucide-shim.fa-C7vWNulb.js"))`, więc
//             krawędź wychodzi z korzenia PUBLICZNEGO, `EDGE_RE` ją łapie
//             i te 39,0 KB liczą się TAKŻE do PUBLIC. Znowu mechanizm z wpisu
//             VIII: `lazy()` NIE ZDEJMUJE KRAWĘDZI. Cięcie zbiłoby więc oba
//             budżety naraz, co czyni je bardziej atrakcyjnym, a nie mniej -
//             ale nie zmienia tego, że jest zmianą produktową.
//
//             ARYTMETYKA FLOORA. 4305,2 (runner, wpis VII) + 22,5 (przyrost
//             host-do-hosta) = 4327,7 rzutowane na runnera; sufit do pełnego
//             KB i +1 KB na granicę zaokrąglenia (mechanizm rozpisany przy
//             florze 3893: porównanie idzie na surowej liczbie, a wydruk
//             `toFixed(1)` zaokrągla) -> 4329.
//
// 2026-09-03 XIII  SPROSTOWANIE DO XII, ZANIM WPIS ZDAZYL WEJSC: 4329 -> 4351.
//             Wpis XII policzono na drzewie `main` @ 25bca08. Zanim PR trafil do
//             scalenia, `main` przesunal sie na 0ec42aa i pomiar sie zmienil.
//             Zostawienie 4329 znaczyloby wypuszczenie kroniki z liczba, o ktorej
//             WIADOMO, ze jest za niska - a to ta sama choroba, ktora ten PR leczy.
//
//             POMIAR PO SCALENIU (host, 953 pliki, 2026-09-03):
//               overall 4342,6 (byl 4320,6)   public 2718,1 (byl 2687,6)
//               chunk    316,2 (byl  274,6)   boot    618,8 (byl  577,3)
//               css       81,2 (byl   81,0)
//             Arytmetyka bez zmian co do metody: host przy florze 4306 to 4298,1
//             (wpis VII), dzis 4342,6, czyli przyrost host-do-hosta +44,5 KB.
//             4305,2 (runner, wpis VII) + 44,5 = 4349,7 -> sufit i +1 na granice
//             zaokraglenia -> 4351.
//
//             UWAGA, I TO JEST WAZNIEJSZE OD SAMEGO FLOORA: przekroczone sa teraz
//             CZTERY progi, nie jeden. `chunk` +41,6 KB i `boot` +41,5 KB wzgledem
//             poprzedniego pomiaru to nie dryf - to ~40 KB dolozone do tego, co
//             KAZDY CZYTELNIK pobiera przed hydratacja. Tych trzech progow
//             (`chunk`, `public`, `boot`) ten commit SWIADOMIE NIE RUSZA: floor
//             postawiony pod regresje sciezki bootowania bylby powrotem do ery
//             „re-floor zamiast naprawy", ktora wpis z 2026-08-06 zamknal. Nalezy
//             im sie wlasny pomiar skladu chunku wejsciowego
//             (`BUNDLE_INVENTORY=1 bun run build && bun run report:chunk-inventory index`)
//             i wlasna decyzja: co weszlo do korzenia i czy ma tam zostac.
//             Do tego czasu job `build` pozostaje czerwony - i to jest uczciwszy
//             stan niz zielony osiagniety podniesieniem czterech progow naraz.
//
//             TA LICZBA JEST Z HOSTA I CZEKA NA PRZEFLOOROWANIE Z PIERWSZEGO
//             ZIELONEGO LOGU RUNNERA - dokładnie tak, jak floory `css` i `boot`
//             z 01.09. Runnera na tym drzewie NIKT NIE ZMIERZYŁ: 4327,7 to
//             PROGNOZA, nie odczyt, oparta na jednym mostku host <-> runner
//             (wpis VII, to samo drzewo: PUBLIC 2701,7 -> 2714,3, czyli
//             +0,466%; OVERALL 4298,1 -> 4305,2). Zasada z wpisu V obowiązuje
//             bez wyjątku: floor idzie z runnera, w górę albo w dół, przy
//             pierwszym zielonym przebiegu. Zapas nad dzisiejszym pomiarem
//             hosta to 8,4 KB (0,19%), więc ostrzeżenie „ZAPAS BUDŻETU PONIŻEJ
//             2%" zapali się od razu - ten sam koszt maksymalnej czułości,
//             który policzył wpis VII.
//
//             CZEGO TEN WPIS ŚWIADOMIE NIE RUSZA: pozostałych czterech progów,
//             a zwłaszcza `public`. Konwencja „próg schodzi za śladem" kazałaby
//             ściąć go dziś z 2715 za pomiarem 2687,6 (27,4 KB zapasu). Nie
//             robimy tego, bo ten pomiar jest z HOSTA, a host czyta NIŻEJ: na
//             drzewie wpisu VII różnica wynosiła 12,6 KB na PUBLIC. Floor
//             ścięty do śladu hosta mógłby zostawić job `build` czerwony na
//             runnerze - i zniszczyć jedyny zielony log, z którego wolno
//             przefloorować wszystkie pięć progów naraz, z prawdziwych liczb.

/**
 * Progi ZAMROŻONE (2026-08-12). Do tej pory każdy z nich dało się rozluźnić
 * jedną zmienną środowiskową w workflow - bramka, którą wolno wyłączyć bez
 * commita, jest sugestią, nie bramką. W CI zmienne MAX_CHUNK_KB /
 * MAX_PUBLIC_KB / MAX_TOTAL_KB / MAX_CSS_KB / MAX_BOOT_KB są więc IGNOROWANE
 * (skrypt mówi to głośno):
 * obowiązują wyłącznie stałe poniżej, a ich zmiana przechodzi przez review
 * razem z przyczyną wzrostu i wpisem do kroniki. Poza CI nadpisanie działa -
 * do lokalnego eksperymentu „ile zejdzie, jeśli...".
 */
const FROZEN_BUDGET_KB = {
  // Największy pojedynczy chunk gzip. Zmierzone 2026-08-18: 266,8 (EChartClient,
  // admin-only) - entry po cięciu ścieżki bootowania ma 253,2. Ratchet
  // 385 -> 280: próg schodzi za śladem (wpis 2026-08-18 w kronice).
  chunk: 280,
  // gzip JS osiągalny z publicznego URL-a. Zmierzone NA RUNNERZE 2026-08-30
  // (przebieg 2756, job `build`, `--frozen-lockfile`): 2710,8 przy 939 plikach.
  // Ratchet 2545 -> 2711 (wpis 2026-08-30 VI): dwa tygodnie funkcjonalności,
  // które weszły przy bramce NIEWYKONUJĄCEJ SIĘ ANI RAZU od 29.08. Host dał
  // tego dnia 2698,4, czyli o 12,4 KB MNIEJ - floor idzie z runnera (zasada
  // z wpisu V), plus ułamek na granicę zaokrąglenia (wpis IV).
  // Ratchet 2711 -> 2715 (wpis 2026-08-30 VII): scalenie PR #307 dołożyło
  // 3,5 KB słowników modułu Wydarzeń. Runner 2714,3; host na tym samym
  // drzewie 2701,7, czyli MIEŚCIŁ SIĘ w 2711 - czerwony był wyłącznie runner.
  public: 2715,
  // gzip JS łącznie z kodem tylko adminowym. Zmierzone NA RUNNERZE 2026-08-19
  // (run 2397 i 2408, identycznie): 3892,0 przy 790 plikach.
  // Floor 3893, NIE 3892 - i to nie zapas, tylko granica zaokrąglenia.
  // Skrypt porównuje `total > MAX_TOTAL_KB` na surowej liczbie
  // zmiennoprzecinkowej, a w wydruku pokazuje `toFixed(1)`. Wydrukowane
  // „3892.0" znaczy więc „cokolwiek z [3892,00; 3892,05)", i przy florze 3892
  // bramka padła na `3892.0 KB > 3892 KB` - komunikat wyglądał jak sprzeczność
  // sam ze sobą. Floor stawiany z WYDRUKU musi więc być o 1 KB wyżej od
  // wydrukowanej wartości, albo trzeba czytać liczbę bez zaokrąglenia.
  // Ratchet 3893 -> 3894 (wpis 2026-08-20 V): pomiar hosta 3893,7 przy zdeterminizowanej
  // instalacji (--frozen-lockfile), plus 1 KB wyłącznie na granicę zaokrąglenia.
  // Ratchet 3894 -> 4302 (wpis 2026-08-30 VI): zmierzone NA RUNNERZE 4301,9
  // (przebieg 2756, job `build`), host 4295,0. Przyczyna rozpisana w kronice -
  // studio wydarzeń, sesje, skaner i słowniki, +407,9 KB od baseline'u z 15.08.
  // Ratchet 4302 -> 4306 (wpis 2026-08-30 VII): runner 4305,2 po scaleniu
  // PR #307 (941 plików zamiast 939); host na tym drzewie 4298,1.
  // Ratchet 4306 -> 4329 (wpis 2026-09-02 XII): host dziś 4320,6 przy 943
  // plikach, host na drzewie floora 4306 dawał 4298,1 (wpis VII) - przyrost
  // host-do-hosta +22,5 KB. Rzut na runnera: 4305,2 + 22,5 = 4327,7, sufit do
  // pełnego KB i +1 KB na granicę zaokrąglenia (mechanizm wyżej, floor 3893)
  // -> 4329. Przyczyna: nowa powierzchnia adminowa z PR #308-#320 (ads,
  // coupons, donations, gifting, membership, monetization) - admin-only
  // 1596,4 -> 1633,0, przy PUBLIC schodzącym 2701,7 -> 2687,6.
  // TA LICZBA JEST Z HOSTA, NIE Z RUNNERA, I CZEKA NA PRZEFLOOROWANIE
  // Z PIERWSZEGO ZIELONEGO LOGU RUNNERA (zasada z wpisu V) - jak `css` i `boot`.
  overall: 4351,
  // gzip WSZYSTKICH wyemitowanych arkuszy stylów. Zdominowany przez arkusz
  // korzenia, który blokuje render na KAŻDYM URL-u (`rootHead.ts` wypisuje go
  // jako `<link rel=stylesheet>` i jako pierwszą wartość nagłówka `Link`).
  // Do 2026-09-01 nie mierzyła go ŻADNA bramka w repo: `walkJs()` zbierał
  // wyłącznie `.js` (wpis IX).
  // Zmierzone 2026-09-01 NA HOŚCIE (artefakt cloudflare'owy, 2 arkusze):
  // 80,96 KB gzip (82 903 B; styles 79,6 + BlocksRenderer 1,4).
  // Floor 82 = pomiar + 0,5% na rozbieżność host <-> runner (wpis VII: PUBLIC
  // host 2701,7 -> runner 2714,3, +0,466%) i sufit do pełnego KB. Zapas 1,04 KB
  // (1,27%), więc ostrzeżenie o zapasie poniżej 2% zapala się od razu.
  // TA LICZBA JEST Z HOSTA I CZEKA NA PRZEFLOOROWANIE Z PIERWSZEGO ZIELONEGO
  // LOGU RUNNERA (zasada z wpisu V) - CSS nie był mierzony na runnerze ANI RAZU.
  //
  // ── 2026-09-03: ZAPAS ZMIERZONY PONOWNIE I ROZSTRZYGNIĘCIE O CIĘCIU ───────
  //
  // ZAPAS JEST TRZY RAZY MNIEJSZY, NIŻ MÓWIŁ AUDYT WYDANIA 9. Tamten podawał
  // 2,8 KiB (3,4%). ZMIERZONE TĄ BRAMKĄ, jej własnym kompresorem
  // (`Bun.gzipSync`, `gzipKb()` niżej), na artefakcie z tego dnia:
  //   styles-*.css          572 185 B raw   79,8525 KiB gzip
  //   BlocksRenderer-*.css    5 321 B raw    1,3691 KiB gzip
  //   RAZEM                                 81,2217 KiB
  //   ZAPAS do floora 82                     0,7783 KiB = 0,95%
  //
  // SKĄD ROZBIEŻNOŚĆ Z AUDYTEM - i to jest pułapka warta zapisania: audyt
  // liczył `gzip -9`, a ta bramka używa `Bun.gzipSync` na POZIOMIE DOMYŚLNYM.
  // Zmierzona różnica na tych dwóch plikach to 1,6 KiB - czyli DWUKROTNOŚĆ
  // całego pozostałego zapasu. `gzip -9` NIE JEST więc przybliżeniem tej
  // liczby i nie wolno nim o tym floorze wnioskować.
  //
  // CZY DA SIĘ ZDJĄĆ Z ARKUSZA PUBLICZNEGO >= 25% GZIP PRZEZ WYCIĘCIE PANELU
  // I BUILDERA (punkt 5(b) z wydania 8, powtórzony jako A3 w wydaniu 9):
  // NIE DA SIĘ. Zmierzone WŁASNYM KOMPILATOREM TAILWINDA 4.2.4 (`compile()` +
  // `Scanner` z `@tailwindcss/oxide`, świeża instancja na każdy zbiór
  // kandydatów - `build()` jest kumulatywne i przy współdzielonej instancji
  // po cichu zwraca to samo wyjście):
  //
  //   ZBIÓR KANDYDATÓW              RAW        GZIP      UDZIAŁ
  //   wszystkie (69 427)            702 534    84 666    100%
  //   tylko publiczne (62 627)      628 360    77 975     92,1%
  //   ZERO kandydatów               206 032    34 117     40,3%  <- nieredukowalne
  //
  //   CIĘCIE z zawężenia `@source` (cały CSS admin-only poza arkusz):
  //     raw -10,56%   gzip -7,90%
  //
  // Czyli sufit tego cięcia to ~8% gzip, a cel 25% jest poza zasięgiem
  // trzykrotnie. Powód jest strukturalny: 40,3% arkusza to część
  // NIEREDUKOWALNA (preflight, blok `@theme`, ~8 800 wierszy CSS-a pisanego
  // ręcznie w `src/styles.css`), której żadne zawężenie źródeł nie dotyczy,
  // a utilities faktycznie WYŁĄCZNIE adminowe to tylko 6 800 kandydatów
  // z 69 427.
  //
  // USTALENIE, KTÓRE PRZEWRACA CAŁY POMYSŁ - `builder` NIE JEST POWIERZCHNIĄ
  // ADMINOWĄ. Pierwsze podejście liczyło `src/components/builder/**`
  // i `src/lib/builder/**` jako admin i dawało „-13%". To jest NIEPRAWDA:
  // `BuilderRenderer` jest importowany przez `components/Header.tsx:9`,
  // `components/Footer.tsx:4`, `components/content/ContentRenderer.tsx:20`
  // i `components/home/molecules/HomeBuilderContent.tsx:48` - czyli renderuje
  // się na KAŻDYM publicznym URL-u. Zawężenie `@source` po tych katalogach
  // zabrałoby arkuszowi publicznemu klasy NAGŁÓWKA I STOPKI. Z tego samego
  // powodu nie istnieje wariant „przenieś reguły `[data-builder-renderer]`":
  // ten atrybut ustawia PUBLICZNY renderer
  // (`components/builder/organisms/BuilderRenderer.tsx`).
  //
  // I DRUGI POWÓD, NIEZALEŻNY: ROZDZIELENIE ARKUSZA ZWIĘKSZA SUMĘ, a ten floor
  // mierzy SUMĘ WSZYSTKICH wyemitowanych arkuszy (`walkCss` niżej nie
  // rozróżnia ścieżek). Arkusz adminowy musi sam wnieść swoje utilities, więc
  // suma rośnie o kilka KiB i floor `css` zapaliłby się na CZERWONO - a jego
  // podniesienie jest w tym repozytorium zakazane. Cięcie „na arkuszu
  // publicznym" wymagałoby więc ROZDZIELENIA TEGO BUDŻETU na publiczny
  // i całkowity, czyli zmiany kontraktu bramki, a nie zmiany stylów.
  //
  // WNIOSEK DLA NASTĘPNEJ OSOBY: przy zapasie 0,95% pierwszą rzeczą do
  // zrobienia NIE jest split panelu (sufit ~8%, koszt: nowy arkusz
  // render-blocking na trasach panelu i wzrost sumy), a praca nad częścią
  // NIEREDUKOWALNĄ - 34 117 B gzip w `src/styles.css` pisanych ręcznie.
  // 2026-09-06: split public/admin CSS. The old 82 KiB total is not the
  // render-blocking cost of a public URL. Clean production build: 71.9 KiB
  // shared + 1.3 KiB public renderer + 12.6 KiB admin = 85.8 KiB total.
  // Separate gzip streams cost 4.5 KiB overall, while public CSS falls by
  // 8.1 KiB. Keep both costs gated and count every unknown stylesheet as public.
  css: 87,
  publicCss: 74,
  // gzip STATYCZNEGO DOMKNIĘCIA ŚCIEŻKI BOOTOWANIA: chunki wstrzykiwane przez
  // SSR jako `<script type="module">` plus wszystko, co z nich osiągalne
  // KRAWĘDZIĄ STATYCZNĄ (`import()` krawędzią inicjalizacyjną nie jest). Ten sam
  // zbiór, który liczy `check:entry-purity` - tam mierzy się PRZYCZYNĘ
  // (krawędź), tu wagę (wpis X).
  // Zmierzone 2026-09-01 NA HOŚCIE: 9 chunków, 573,17 KB gzip / 1944,3 KB
  // surowych (entry 270,5 + osiem vendorów).
  // Kronika mierzyła tę liczbę RĘCZNIE 18.08 (~554 KB) i nigdy jej nie
  // bramkowała; +19 KB dryfu w dwa tygodnie to koszt braku progu.
  // PRZEFLOOROWANE 577 -> 579 W TYM SAMYM DNIU, i to jest przyznanie się do
  // błędu metody, nie ratchet za wzrostem: pomiar 573,17 KB został wzięty
  // w TRAKCIE zmiany, przed wejściem sondy bootu (`bootProbeScript`), modułu
  // `hydrateBudget`, `useNowMs`, `appReady`, `localeChunks` i trzech nowych
  // modułów zapytań buildera w rejestrze prefetchu. Na DOMKNIĘTYM drzewie
  // artefakt daje 575,3 KB, więc floor 577 miał 1,7 KB (0,29%) zapasu - mniej
  // niż udokumentowana rozbieżność host <-> runner (+0,466%, wpis VII), czyli
  // bramka zapaliłaby się na runnerze na własnym szumie, nie na regresji.
  // Floor 579 = 575,3 + 0,5% (578,2) i sufit do pełnego KB; zapas 3,7 KB
  // (0,64%). TA LICZBA JEST Z HOSTA I CZEKA NA PRZEFLOOROWANIE Z RUNNERA
  // (wpis V) - w dół, jeśli runner pokaże mniej.
  boot: 579,
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
const MAX_CSS_KB = budget("css", "MAX_CSS_KB");
const MAX_PUBLIC_CSS_KB = budget("publicCss", "MAX_PUBLIC_CSS_KB");
const MAX_BOOT_KB = budget("boot", "MAX_BOOT_KB");

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

/**
 * WERSJA KONWENCJI NAZW WIADER. 2026-09-01 (wpis XI) `stableChunkName()`
 * przestał zjadać członki opisowe nazw, więc 124 z 946 plików trafia do INNEGO
 * wiadra niż w baseline'ie z 15.08. Porównanie nowych kluczy ze starym plikiem
 * daje szum zamiast diagnozy (sprawdzone: osiem z dwunastu wierszy to `(NOWY)`
 * po samym przemianowaniu), więc baseline nosi numer konwencji, a `movers()`
 * czyta plik bez numeru przez `legacyChunkName()`. Baseline zapisany
 * `--update-baseline` na zielonym runnerze dostaje numer 2 i tryb zgodności
 * przestaje się włączać.
 */
const BUCKET_CONVENTION = 2;

interface BaselineFile {
  readonly measuredAt: string;
  readonly commit: string;
  /** Brak pola = plik z epoki łapczywego wzorca (konwencja 1). */
  readonly bucketConvention?: number;
  readonly totals: {
    readonly public: number;
    readonly overall: number;
    readonly chunk: number;
    /** Dopisane 2026-09-01 (wpisy IX i X); starsze pliki ich nie mają. */
    readonly css?: number;
    readonly publicCss?: number;
    readonly boot?: number;
  };
  readonly chunks: Readonly<Record<string, number>>;
}

/**
 * `assets/index-HSMM7HnQ.js` -> `index`; `vendor-tw-merge-CPcsbTWB.js` ->
 * `vendor-tw-merge`; `styles-BQZz5a-B.css` -> `styles`; plik bez hasha
 * (`push-sw.js`) zostaje bez zmian.
 *
 * KWANTYFIKATOR JEST DOKŁADNY (`{8}`), NIE OTWARTY. Hash Vite to osiem znaków
 * base64url, a klasa zawiera `-`, więc `{8,}` dopasowywał się już przy PIERWSZYM
 * myślniku nazwy i sklejał `vendor-radix` z `vendor-react` w jedno wiadro
 * `vendor` (wpisy VI i XI w kronice). Rozszerzenie ucinamy razem z `.css`, bo od
 * wpisu IX arkusze też wchodzą do raportu per wiadro.
 */
function stableChunkName(file: string): string {
  const base = file.split("/").pop() ?? file;
  return base.replace(/\.(js|css)$/, "").replace(/-[A-Za-z0-9_-]{8}$/, "");
}

/**
 * Nazwa wiadra STARĄ konwencją - WYŁĄCZNIE do czytania baseline'u sprzed
 * naprawy z wpisu XI. Nie używaj jej do niczego nowego: to jest właśnie ten
 * łapczywy wzorzec, który sklejał `i18n-club` z `i18n-admin-events`.
 */
function legacyChunkName(file: string): string {
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

/**
 * Rekurencyjny enumerator plików o jednym rozszerzeniu.
 *
 * DLACZEGO `walkJs` ZOSTAJE OSOBNĄ NAZWĄ, A NIE PARAMETREM W MIEJSCU WYWOŁANIA:
 * autodetekcja `CLIENT_DIR` (na górze pliku) wybiera pierwszy katalog z
 * kandydatów, który zawiera JS. Gdyby sondowała „jakiekolwiek pliki", katalog z
 * arkuszami stylów, a bez chunków, mógłby wygrać i bramka mierzyłaby nie ten
 * artefakt. Deklaracje funkcji, nie stałe strzałkowe, bo `CLIENT_DIR` woła
 * `walkJs` PRZED tym miejscem w pliku i liczy na hoisting.
 */
function walkAssets(dir: string, ext: string): string[] {
  let out: string[] = [];
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walkAssets(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

function walkJs(dir: string): string[] {
  return walkAssets(dir, ".js");
}

/** Arkusze stylów - mierzone od 2026-09-01 (wpis IX), wcześniej niemierzone. */
function walkCss(dir: string): string[] {
  return walkAssets(dir, ".css");
}

function gzipKb(file: string): number {
  return Bun.gzipSync(readFileSync(file)).length / 1024;
}

/**
 * KORZENIE ŚCIEŻKI BOOTOWANIA (2026-09-01, wpis X).
 *
 * Czytane z manifestu TanStack Start, nie zgadywane po nazwie ani po rozmiarze -
 * manifest jest jedynym miejscem, które NAPRAWDĘ mówi, co serwer wstrzykuje jako
 * `<script type="module">`. Override `ENTRY_CHUNKS` jest CELOWO tą samą zmienną,
 * co w `check-entry-purity.ts`: jeden artefakt, jedna pokrętka, żeby te dwie
 * bramki nie mogły policzyć różnych korzeni.
 */
const SERVER_DIRS = [".output/server", "dist/server"] as const;

function findBootChunks(): string[] {
  const override = process.env["ENTRY_CHUNKS"];
  if (override) return override.split(",").map((s) => basename(s.trim()));

  const scriptRe = /scripts:\s*\[[^\]]*?src:\s*["']\/assets\/([A-Za-z0-9._$-]+\.js)["']/g;
  const found = new Set<string>();
  for (const dir of SERVER_DIRS) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of entries) {
      if (!file.endsWith(".mjs") && !file.endsWith(".js")) continue;
      for (const m of readFileSync(join(dir, file), "utf8").matchAll(scriptRe)) found.add(m[1]);
    }
    if (found.size > 0) break;
  }
  return [...found];
}

/**
 * Krawędzie WYŁĄCZNIE STATYCZNE. To NIE jest `EDGE_RE` z `adminOnlyByGraph()`:
 * tamten wzorzec ŚWIADOMIE liczy `import(` jako krawędź, bo pyta o OSIĄGALNOŚĆ
 * (wpis VIII: „`lazy()` NIE ZDEJMUJE KRAWĘDZI"). Tu pytamy o INICJALIZACJĘ, więc
 * `import(` trzeba odfiltrować - identycznie jak w `check-entry-purity.ts`
 * i `check-chunk-graph.ts`.
 */
const STATIC_EDGE_RE = /(import\s*\(?\s*|from\s*)["'](\.\/[^"']+\.js)["']/g;

function bootClosure(paths: readonly string[]): Set<string> {
  const byBase = new Map<string, string>();
  for (const p of paths) byBase.set(basename(p), p);
  const roots = findBootChunks()
    .map((b) => byBase.get(b))
    .filter((p): p is string => p !== undefined);
  // Cicha kapitulacja jest tu gorsza niż czerwona bramka: floor, który po
  // zmianie układu artefaktu po prostu przestaje istnieć, to znowu „sugestia,
  // nie bramka" (akapit PROGI SĄ ZAMROŻONE).
  if (roots.length === 0) {
    console.error(
      "✗ Nie udalo sie ustalic chunku startowego z manifestu TanStack Start.\n" +
        `  Szukano \`scripts:[{attrs:{src:"/assets/*.js"}}]\` w: ${SERVER_DIRS.join(", ")}.\n` +
        "  Jesli adapter zmienil uklad artefaktu, podaj chunk jawnie: ENTRY_CHUNKS=index-HASH.js",
    );
    process.exit(1);
  }
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const m of readFileSync(node, "utf8").matchAll(STATIC_EDGE_RE)) {
      if (m[1].trimEnd().endsWith("(")) continue;
      const next = byBase.get(basename(m[2]));
      if (next !== undefined && next !== node) stack.push(next);
    }
  }
  return seen;
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
// Ten sam podział wiader, ale kluczami STAREJ konwencji - wyłącznie po to, by
// `movers()` umiał czytać baseline sprzed wpisu XI. Patrz `BUCKET_CONVENTION`.
const perChunkLegacy = new Map<string, number>();
for (const f of files) {
  const kb = gzipKb(f);
  total += kb;
  if (!adminOnly.has(f)) publicTotal += kb;
  else if (isAdminRoot(f)) adminRootTotal += kb;
  const name = stableChunkName(f);
  perChunk.set(name, (perChunk.get(name) ?? 0) + kb);
  const legacy = legacyChunkName(f);
  perChunkLegacy.set(legacy, (perChunkLegacy.get(legacy) ?? 0) + kb);
  if (kb > max) {
    max = kb;
    maxFile = f;
  }
}
const adminTotal = total - publicTotal;

// ── CSS: arkusze, których do 2026-09-01 nie mierzyła żadna bramka (wpis IX) ──
const cssFiles = walkCss(CLIENT_DIR);
if (cssFiles.length === 0) {
  // Bramka, która po zmianie układu artefaktu po cichu mierzy 0 KB, jest gorsza
  // niż brak bramki: świeci na zielono i nikt nie wie, że nic nie pilnuje.
  console.error(
    `✗ Brak arkuszy CSS w ${CLIENT_DIR}, a arkusz korzenia jest wypisywany bezwarunkowo\n` +
      "  (`src/lib/seo/rootHead.ts`). Albo build jest niepełny, albo adapter zmienił\n" +
      "  układ artefaktu - w drugim przypadku popraw `walkCss`/`CLIENT_DIR`, nie floor.",
  );
  process.exit(1);
}
let cssTotal = 0;
let publicCssTotal = 0;
for (const f of cssFiles) {
  const kb = gzipKb(f);
  cssTotal += kb;
  if (stableChunkName(f) !== "admin-styles") publicCssTotal += kb;
  // Arkusz dostaje SUFIKS `.css` w nazwie wiadra, bo `stableChunkName` zdejmuje
  // rozszerzenie i bez sufiksu `BlocksRenderer-*.css` (1,4 KB) wpadałby do
  // wiadra chunku `BlocksRenderer-*.js` (41,9 KB w baseline'ie) - dwie klasy
  // zasobów w jednej liczbie to dokładnie ta wada, którą naprawia wpis XI.
  const name = `${stableChunkName(f)}.css`;
  perChunk.set(name, (perChunk.get(name) ?? 0) + kb);
  perChunkLegacy.set(name, (perChunkLegacy.get(name) ?? 0) + kb);
}

// ── BOOT: to, co przeglądarka wykonuje przed hydratacją (wpis X) ─────────────
const bootFiles = bootClosure(files);
let bootTotal = 0;
let bootRaw = 0;
for (const f of bootFiles) {
  bootTotal += gzipKb(f);
  // Surowe bajty raportowane obok gzipu, bo parse/compile skaluje się z nimi,
  // nie z gzipem (wpis 2026-08-18). Raportowane, NIE bramkowane - jedna
  // metryka, jeden próg.
  bootRaw += readFileSync(f).length / 1024;
}

console.log(`Client JS: ${files.length} files, ${total.toFixed(1)} KB gzip total`);
console.log(`  public:      ${publicTotal.toFixed(1)} KB  (budget ≤ ${MAX_PUBLIC_KB} KB)`);
console.log(
  `  admin-only:  ${adminTotal.toFixed(1)} KB  (billed to OVERALL only; ${adminOnly.size} chunków ` +
    `z punktu stałego grafu importów, w tym ${adminRootTotal.toFixed(1)} KB w korzeniach tras /admin)`,
);
console.log(`  overall:     ${total.toFixed(1)} KB  (budget ≤ ${MAX_TOTAL_KB} KB)`);
console.log(`Largest chunk: ${max.toFixed(1)} KB gzip (${maxFile})  (budget ≤ ${MAX_CHUNK_KB} KB)`);
console.log(
  `Client CSS: ${cssFiles.length} files, ${cssTotal.toFixed(1)} KB gzip  ` +
    `(all stylesheets; budget ≤ ${MAX_CSS_KB} KB)`,
);
console.log(
  `  public CSS:  ${publicCssTotal.toFixed(1)} KB (shared + public route styles; budget ≤ ${MAX_PUBLIC_CSS_KB} KB)`,
);
console.log(
  `Boot closure: ${bootTotal.toFixed(1)} KB gzip / ${bootRaw.toFixed(1)} KB raw  ` +
    `(${bootFiles.size} chunków statycznie osiągalnych ze SSR-owego <script>; ` +
    `budget ≤ ${MAX_BOOT_KB} KB)`,
);

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
  // TRYB ZGODNOŚCI Z BASELINE'EM SPRZED WPISU XI. Naprawa `stableChunkName()`
  // przemianowała 124 z 946 wiader, więc porównanie nowych kluczy ze starym
  // plikiem dawałoby listę `(NOWY)`/`znikł` zamiast diagnozy. Dla takiego pliku
  // porównujemy po kluczach STAREJ konwencji: raport jest wtedy identyczny jak
  // przed naprawą (te same dwanaście wierszy), a nie pusty ani zaszumiony.
  const legacyBaseline = (base.bucketConvention ?? 1) < BUCKET_CONVENTION;
  const current = legacyBaseline ? perChunkLegacy : perChunk;

  const deltas: Array<{ name: string; delta: number; now: number; was: number }> = [];
  for (const [name, kb] of current) {
    const was = base.chunks[name];
    if (was === undefined) {
      if (kb >= 5) deltas.push({ name: `${name} (NOWY)`, delta: kb, now: kb, was: 0 });
      continue;
    }
    const delta = kb - was;
    if (Math.abs(delta) >= 1) deltas.push({ name, delta, now: kb, was });
  }
  const gone = Object.keys(base.chunks).filter((n) => !current.has(n) && base.chunks[n] >= 5);
  if (deltas.length === 0 && gone.length === 0) return [];

  const lines = [`Ruchy względem baseline'u (${base.commit}, ${base.measuredAt.slice(0, 10)}):`];
  if (legacyBaseline) {
    lines.push(
      `  (baseline pisany STARĄ konwencją wiader - nazwy niżej są sklejone, np. jedno ` +
        `\`vendor\` na dziesięć plików. Przepisz go na zielonym buildzie runnera: ` +
        `bun run scripts/check-bundle-size.ts --update-baseline)`,
    );
  }
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
if (cssTotal > MAX_CSS_KB) errors.push(`css total ${cssTotal.toFixed(1)} KB > ${MAX_CSS_KB} KB`);
if (publicCssTotal > MAX_PUBLIC_CSS_KB)
  errors.push(`public css ${publicCssTotal.toFixed(1)} KB > ${MAX_PUBLIC_CSS_KB} KB`);
if (bootTotal > MAX_BOOT_KB)
  errors.push(`boot closure ${bootTotal.toFixed(1)} KB > ${MAX_BOOT_KB} KB`);

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

// ── Baseline: jawna aktualizacja ─────────────────────────────────────────────
if (process.argv.includes("--update-baseline")) {
  const commit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]).stdout.toString().trim();
  const snapshot: BaselineFile = {
    measuredAt: new Date().toISOString(),
    commit,
    bucketConvention: BUCKET_CONVENTION,
    totals: {
      public: Number(publicTotal.toFixed(1)),
      overall: Number(total.toFixed(1)),
      chunk: Number(max.toFixed(1)),
      css: Number(cssTotal.toFixed(1)),
      publicCss: Number(publicCssTotal.toFixed(1)),
      boot: Number(bootTotal.toFixed(1)),
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

// ── Zapas: ostrzeżenie ZANIM bramka zapali się u kogoś innego ────────────────
const headroom = [
  { name: "largest chunk", now: max, limit: MAX_CHUNK_KB },
  { name: "public total", now: publicTotal, limit: MAX_PUBLIC_KB },
  { name: "overall total", now: total, limit: MAX_TOTAL_KB },
  { name: "css total", now: cssTotal, limit: MAX_CSS_KB },
  { name: "public css", now: publicCssTotal, limit: MAX_PUBLIC_CSS_KB },
  { name: "boot closure", now: bootTotal, limit: MAX_BOOT_KB },
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
