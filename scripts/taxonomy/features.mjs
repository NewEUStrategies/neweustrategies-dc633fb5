// Taksonomia FUNKCJONALNOŚCI wewnątrz modułów + liczenie pokrycia per wiersz.
//
// ── PO CO TEN PLIK POWSTAŁ ─────────────────────────────────────────────────
// Rozdział 3 audytu pokrycia publikuje 141 wierszy „funkcjonalność -> procent",
// ale reguł, które je produkują, NIE publikuje (przyznaje to sam przy module
// 17: „Podział na cztery funkcjonalności nie jest opublikowany jako regexy").
// Wiersz, którego nie da się przeliczyć, nie jest pomiarem - jest cytatem.
// I dokładnie tak się to skończyło w module 16: wiersz „Społeczność: odznaki,
// zaangażowanie, Q&A, ankiety" (21 plików, 664 LOC, 35,5% linii) NIE ZAWIERAŁ
// ANI JEDNEGO PLIKU Q&A, a 235 z jego 428 niepokrytych linii to bilety
// i prelegenci wydarzeń. Prawdziwe panele Q&A, ankiet i odznak stały w tym
// czasie poza wszystkimi jedenastoma funkcjonalnościami modułu - razem 344
// linie i 189 funkcji na zerze, niewidoczne w tabeli.
//
// Od tej zmiany taksonomia jest KODEM. `moduleMap.mjs` mapuje plik na moduł
// (rozdz. 9.1, z naprawą martwych reguł - patrz tam), ten plik mapuje plik
// modułu 16 na funkcjonalność, a `npm run check:feature-taxonomy` pilnuje
// trzech niezmienników: każdy plik modułu trafia do dokładnie jednej
// funkcjonalności, żadna reguła nie jest martwa i żadna funkcjonalność nie
// jest pusta.
//
// ── ZAKRES ─────────────────────────────────────────────────────────────────
// Pełną taksonomię mają dziś MODUŁY 16, 21 i 3 - każdy dopisany po tej samej
// awarii: wiersze tabeli audytu istniały, ich reguł nikt nie opublikował,
// a niekompletność czytała się jak „wszystko w porządku". Moduł 3 dołączył
// jako trzeci: 173 z jego 468 plików nie należały do żadnego wiersza, a leżało
// w nich 717 z 1026 niepokrytych linii modułu (69,9%) - czyli tabela była
// ślepa na 70% długu, który opisywała. Pozostałe moduły mają w tabelach audytu
// wiersze, których reguł nikt nie opublikował; przepisywanie ich „z pamięci"
// dałoby liczby wyglądające na porównywalne i takimi niebędące. Dopisanie
// kolejnego modułu to jeden wpis w `FEATURES`, a `check:feature-taxonomy`
// od razu zacznie go pilnować.
import { classifyPath, MODULE_NAMES } from "./moduleMap.mjs";

/**
 * Funkcjonalności modułu 16, w kolejności rozstrzygania (pierwsze trafienie
 * wygrywa). Nazwy wierszy audytu wydania 8 zostały zachowane wszędzie tam,
 * gdzie nadal opisują zawartość; wiersz zbiorczy „odznaki, zaangażowanie,
 * Q&A, ankiety" jest ROZBITY, bo mieszał cztery niepowiązane powierzchnie
 * z dwiema, których w module w ogóle nie ma (bilety i prelegenci wydarzeń
 * należą do modułu 22 - patrz CARVE_OUTS w `moduleMap.mjs`).
 */
export const FEATURES_16 = [
  {
    key: "clubs-apply",
    name: "KLUBY: zgłoszenia członkowskie (apply)",
    // `applyApi.ts` (246 linii) świadomie NIE tutaj: to warstwa zapytań
    // panelu, nie formularz zgłoszenia - siedzi w „API i zapytania".
    patterns: [
      /^src\/lib\/clubs\/(applyHead|applyPrefill|applyValidation|applicationNotify)/,
      /^src\/routes\/club\.apply\./,
    ],
  },
  {
    key: "clubs-access",
    name: "KLUBY: dostęp i uprawnienia (gate, macierz, plany)",
    patterns: [
      /^src\/lib\/clubs\/(capabilityMatrix|gateView|hubAccess|minisiteAccess|planTiers|moderationRules|membershipSignals)/,
    ],
  },
  {
    key: "clubs-threads",
    name: "KLUBY: wątki dyskusyjne (dynamika, puls, źródła)",
    patterns: [
      /^src\/lib\/clubs\/thread(?!WorkspaceApi)/,
      /^src\/lib\/clubs\/(newThreadForm|useThreadDraft|useThreadWorkspace|useDeferredReplies|stances)/,
    ],
  },
  {
    key: "clubs-taxonomy",
    name: "KLUBY: tematy, specjalizacje, obszary polityk",
    patterns: [
      /^src\/lib\/clubs\/(topicCatalog|topics|policyAreas|expertiseDraft|specializationHead|specializationPage|specializations)\.ts$/,
      /^src\/lib\/clubs\/(useClubTopics|useClubSpecializations|hubCatalog)/,
    ],
  },
  {
    key: "clubs-api",
    name: "KLUBY: API i zapytania (klub, posty, wątki)",
    patterns: [
      /^src\/lib\/clubs\/(api|applyApi|postsApi|networkApi|workspaceApi|topicsApi|specializationsApi|coverApi|threadWorkspaceApi)\.ts$/,
      /^src\/lib\/clubs\/(queryKeys|clubInvalidations|publicClub|clubSemantic\.functions|linkPreview\.functions)/,
      /^src\/lib\/clubs\/use(Club|Thread)/,
    ],
  },
  {
    key: "clubs-admin-rules",
    name: "KLUBY: reguły panelu admina",
    patterns: [/^src\/lib\/clubs\/admin/],
  },
  {
    key: "clubs-view-rules",
    name: "KLUBY: reguły widoków wyprowadzone z JSX-a",
    // Łapacz reszty biblioteki reguł - świadomie po wszystkich wierszach
    // szczegółowych, bo to one nadają znaczenie, a nie katalog.
    patterns: [/^src\/lib\/clubs\//],
  },
  {
    key: "clubs-ui",
    name: "KLUBY: UI (atomy/molekuły/organizmy)",
    patterns: [/^src\/components\/clubs\//],
  },
  {
    key: "clubs-admin-ui",
    name: "KLUBY: panel admina (UI)",
    patterns: [/^src\/components\/admin\/clubs\//],
  },
  {
    key: "clubs-admin-routes",
    name: "KLUBY: trasy panelu klubów",
    patterns: [/^src\/routes\/admin\.community\.clubs/],
  },
  {
    key: "clubs-public-routes",
    name: "KLUBY: trasy publiczne klubu",
    patterns: [/^src\/routes\/club[.]/],
  },
  {
    key: "comments",
    name: "Komentarze i moderacja",
    patterns: [
      /^src\/lib\/comments\//,
      /^src\/components\/comments\//,
      /^src\/routes\/admin\.comments/,
    ],
  },
  {
    key: "community-qa",
    name: "Społeczność: sesje Q&A",
    // WIERSZ NOWY. Do wydania 8 funkcjonalność „Q&A" istniała w NAZWIE innego
    // wiersza i nie miała w nim ani jednego pliku; jedyny realny panel Q&A
    // (`admin.community.qa.tsx`, 0/122 linii, 0/57 funkcji) wpadał regułą
    // modułową do MODUŁU 7 przez człon `qa` w jego łapaczu tras.
    patterns: [/^src\/routes\/admin\.community\.qa/],
  },
  {
    key: "community-polls",
    name: "Społeczność: ankiety",
    patterns: [/^src\/routes\/admin\.community\.polls/, /^src\/components\/community\/PollCard/],
  },
  {
    key: "community-reputation",
    name: "Społeczność: odznaki i reputacja",
    patterns: [
      /^src\/routes\/admin\.community\.(badges|contributors)/,
      /^src\/lib\/community\/reputation/,
      /^src\/components\/community\/ReputationLevelChip/,
    ],
  },
  {
    key: "community-engagement",
    name: "Społeczność: zaangażowanie i pulpit",
    patterns: [
      /^src\/routes\/admin\.community\.(engagement|index)/,
      /^src\/routes\/admin\.community\.tsx$/,
      /^src\/components\/admin\/community\/CommunitySubNav/,
    ],
  },
  {
    key: "community-scheduler",
    name: "Społeczność: harmonogram kanałów (cron + panel zdrowia)",
    patterns: [
      /^src\/routes\/api\/public\/community-cron/,
      /^src\/components\/admin\/community\/SchedulerHealthPanel/,
    ],
  },
  {
    key: "community-admission",
    name: "Społeczność: dopuszczenie do społeczności (domeny, wybór członka)",
    patterns: [/^src\/components\/admin\/community\/(VerificationDomainsCard|MemberPicker)/],
  },
  {
    key: "community-public-read",
    name: "Społeczność: publiczna warstwa odczytu",
    patterns: [/^src\/lib\/community\/(publicQueries|tenant)/],
  },
  {
    key: "community-modules",
    name: "Społeczność: włączanie modułów społeczności",
    patterns: [
      /^src\/lib\/community\/(modulesSettings|useCommunityModules)/,
      /^src\/components\/community\/CommunityDisabled/,
    ],
  },
];

/**
 * Funkcjonalności modułu 21, w kolejności rozstrzygania (pierwsze trafienie
 * wygrywa).
 *
 * WIERSZ DOTYCHCZASOWY BYŁ NIEPRZELICZALNY I ZANIŻONY. Audyt wydania z
 * 2026-08-18 pokazuje dla tego modułu JEDEN wiersz funkcjonalności - „Kariera:
 * ogłoszenia i zgłoszenia", 26 plików, 576 LOC, linie 81,3%, funkcje 164/224.
 * Modułu 21 nie było wtedy w tej mapie wcale, więc `featureForPath` zwracał dla
 * jego plików `null`, a `report.mjs` pomijał moduł w tabeli funkcjonalności
 * (`if (!FEATURES.has(module)) continue;`). Ten wiersz nie powstał więc z kodu.
 *
 * RACHUNEK, KTÓRY TO PRZYBIJA (pomiar tego HEAD-a, `coverage.all`):
 *   moduł 21 . . . 29 plików, linie 468/849, funkcje 164/348
 *   wiersz audytu . 26 plików, LOC 576,      funkcje 164/224
 *   849 - 576 = 273 = 148 (`admin.hiring`) + 109 (`admin.careers`) + 16 (`jobs-tick`)
 *   348 - 224 = 124 =  81 (`admin.hiring`) +  42 (`admin.careers`) +  1 (`jobs-tick`)
 *   licznik funkcji w OBU wierszach ten sam (164), bo wykluczona trójka miała
 *   dokładnie ZERO pokrytych funkcji.
 * Wiersz obiecywał „ogłoszenia i zgłoszenia" i wycinał z siebie DOKŁADNIE oba
 * panele, w których ogłoszenia się redaguje, a zgłoszenia czyta - czyli trzy
 * największe zera modułu. To ta sama choroba, przeciw której napisano
 * niezmiennik 1 bramki `check:feature-taxonomy` („żaden plik modułu nie wisi
 * poza funkcjonalnością"); bramka jej nie widziała, bo sprawdza wyłącznie
 * moduły, które JUŻ mają taksonomię.
 *
 * Od tej zmiany moduł 21 ma taksonomię, więc tabela funkcjonalności liczy się
 * z kodu, a bramka pilnuje jej kompletności.
 */
export const FEATURES_21 = [
  {
    key: "careers-application",
    name: "Kariera: zgłoszenie kandydata (walidacja, CV, retencja)",
    // Ścieżka, po której chodzą DANE OSOBOWE osoby z zewnątrz - dlatego stoi
    // przed łapaczem katalogu, a nie w nim.
    patterns: [/^src\/lib\/careers\/(applicationSchema|cvUpload|cvRetention)\.ts$/],
  },
  {
    key: "careers-pipeline",
    name: "Kariera: lejek rekrutacyjny (etapy, decyzje)",
    patterns: [/^src\/lib\/careers\/(recruitmentLayer|recruitmentShared)\.ts$/],
  },
  {
    key: "careers-catalog",
    name: "Kariera: katalog ogłoszeń i warstwa treści strony",
    // Łapacz reszty biblioteki reguł (role, katalog, sekcje strony, statystyki)
    // - świadomie PO wierszach szczegółowych, bo one nadają znaczenie.
    patterns: [/^src\/lib\/careers\//],
  },
  {
    key: "careers-public-ui",
    name: "Kariera: publiczna strona ofert (UI)",
    // Trasa `zatrudniamy` idzie tym samym wierszem co jej komponenty: to jedna
    // powierzchnia produktowa (strona, na którą wchodzi kandydat), a rozbijanie
    // jej na „trasę" i „komponenty" dałoby dwa wiersze, z których żaden nie
    // opisuje niczego, co czytelnik tabeli umie sobie wyobrazić osobno.
    patterns: [/^src\/components\/careers\//, /^src\/routes\/zatrudniamy/],
  },
  {
    key: "careers-admin-hiring",
    name: "Kariera: panel ogłoszeń (/admin/hiring)",
    patterns: [/^src\/routes\/admin\.hiring/],
  },
  {
    key: "careers-admin-inbox",
    name: "Kariera: panel zgłoszeń i dostęp do CV (/admin/careers)",
    patterns: [/^src\/routes\/admin\.careers/],
  },
  {
    key: "jobs-scheduler",
    name: "Zadania tła: harmonogram i tick",
    patterns: [/^src\/lib\/jobs\//, /^src\/routes\/api\/public\/jobs-tick/],
  },
];

// ── MODUŁ 3: SILNIKI TREŚCI (BLOKI + PAGE BUILDER) ─────────────────────────
//
// PO CO TEN WPIS POWSTAŁ. Do tej zmiany moduł 3 NIE MIAŁ taksonomii w kodzie,
// więc `featureForPath` zwracał dla jego plików `null`, a tabela funkcjonalności
// w audycie powstała poza kodem - i jest niesprawdzalna oraz niekompletna.
// RACHUNEK, KTÓRY TO PRZYBIJA (pomiar tego HEAD-a):
//   moduł 3 . . . . . . . . . . . . 467 plików produkcyjnych
//   13 wierszy tabeli audytu . . . . 296 plików
//   poza wszystkimi wierszami  . . . 173 pliki, a w nich 717 z 1026
//                                    niepokrytych linii modułu (69,9%)
// Największe zera modułu stały więc DOKŁADNIE tam, gdzie tabela nie patrzyła:
// całe `components/admin/blocks/**` (93 pliki, w tym 62 formularze edycji
// bloków), 56 plików `lib/builder/**` i warstwa edycji w miejscu na kanwie
// (`Editable.tsx`, 276 linii). Wiersz „CMS: panele właściwości widgetów"
// obiecywał panele, a mierzył 112 plików CAŁEGO edytora buildera - to ta sama
// choroba, przeciw której napisano niezmienniki `check:feature-taxonomy`.
//
// CO SIĘ ZMIENIA WZGLĘDEM TABELI AUDYTU. Wszystkie 13 nazw wierszy jest
// ZACHOWANYCH tam, gdzie nadal opisują zawartość; cztery z nich zmieniają
// liczebność (komentarze przy wierszach mówią, dlaczego), jeden jest ZWĘŻONY
// („panele właściwości widgetów": 112 -> 41), a 25 wierszy jest NOWYCH. Wiersza
// „reszta" nie ma: każdy łapacz katalogu stoi PO wierszach szczegółowych i nosi
// nazwę powierzchni produktowej, którą czytelnik tabeli umie sobie wyobrazić.
//
// KOLEJNOŚĆ ROZSTRZYGANIA MA ZNACZENIE (pierwsze trafienie wygrywa):
//   1. wiersze wyjmujące pojedyncze pliki z katalogów cudzych wierszy
//      (sanityzacja, import, migracja) - inaczej łapacz `^src/lib/builder/`
//      albo `^src/lib/blocks/` zabrałby je wcześniej,
//   2. wiersze `lib/` i `components/` po powierzchniach,
//   3. łapacze katalogów (`admin/blocks/`, `components/blocks/`) na końcu
//      swojej grupy.
export const FEATURES_3 = [
  {
    key: "cms-sanitize",
    name: "CMS: sanityzacja HTML",
    // Wiersz audytu obiecywał 4 pliki, a `src/lib/sanitize*` to tylko trzy.
    // Czwarty to `builder/normalizeRichHtml.ts`: ta sama powierzchnia (HTML
    // wchodzący do treści, parsowany i normalizowany przed zapisem), zasila
    // `RichHtmlField` w panelu i `RichHtmlView` na stronie. Musi stać PRZED
    // wierszami `lib/builder/**`, bo inaczej zabierze go któryś z nich.
    patterns: [/^src\/lib\/sanitize/, /^src\/lib\/builder\/normalizeRichHtml\.ts$/],
  },
  {
    key: "cms-wp-import",
    name: "CMS: import z Gutenberga / WordPressa",
    // Trzy parsery wejściowe z `lib/blocks` są TUTAJ, a nie w rdzeniu bloków:
    // bez nich wiersz nosiłby w nazwie Gutenberga i nie miałby ani jednego
    // pliku Gutenberga. `wordPaste` (wklejka z Worda) i `markdown` to te same
    // drzwi wejściowe co WXR - treść z zewnątrz zamieniana na dokument bloków.
    patterns: [
      /^src\/lib\/wp-import/,
      /^src\/lib\/wordpress-import/,
      /^src\/lib\/blocks\/(gutenberg|markdown|wordPaste)\.ts$/,
    ],
  },
  {
    key: "cms-builder-migrate",
    name: "CMS: migracja treści na page builder (bloki i HTML -> sekcje)",
    // WIERSZ NOWY. Przeniesienie ISTNIEJĄCEJ treści na drzewo sekcji plus
    // weryfikacja wyniku - inna powierzchnia niż import z zewnątrz i inna niż
    // codzienne operacje na dokumencie, więc osobny wiersz.
    patterns: [/^src\/lib\/builder\/migrate\//],
  },
  {
    key: "cms-content-model",
    name: "CMS: warstwa content-model",
    // Stoi przed `contentEngine` celowo: `^src/lib/content\/` nie łapie
    // `content-model/` (ukośnik po `content`), ale rozluźnienie tamtego wzorca
    // w przyszłości opróżniłoby ten wiersz po cichu.
    patterns: [/^src\/lib\/content-model\//],
  },
  {
    key: "cms-content-engine",
    name: "CMS: silnik treści publicznej contentEngine",
    // 20 -> 22. Audyt liczył samo `lib/content/`. `ContentRenderer.tsx` to
    // JEDYNY publiczny punkt wejścia tego silnika (rozdziela treść na trzy
    // strategie: builder / bloki / oczyszczony HTML), a `ContentSkeleton.tsx`
    // to jego stan ładowania w `routes/$.tsx`. Silnik bez punktu wejścia to
    // nie silnik.
    patterns: [/^src\/lib\/content\//, /^src\/components\/content\//],
  },
  {
    key: "cms-sidebar-patterns",
    name: "CMS: builder sidebara + wzorce",
    // `lib/blocks/patterns.ts` to INNE wzorce (kompozycje bloków Gutenberga)
    // i idzie do wiersza wstawiania bloków - złączenie dałoby wiersz o dwóch
    // niepowiązanych bibliotekach.
    patterns: [
      /^src\/lib\/sidebarBuilder\//,
      /^src\/components\/admin\/sidebarBuilder\//,
      /^src\/lib\/patterns\//,
      /^src\/components\/patterns\//,
    ],
  },
  {
    key: "cms-blocks-core",
    name: "CMS: silnik bloków typ Gutenberg - rdzeń",
    // Rdzeń = kontrakt dokumentu blokowego. Wszystko inne w `lib/blocks/` to
    // już konkretna powierzchnia redaktora i ma własny wiersz niżej.
    patterns: [
      /^src\/lib\/blocks\/(schema|types|registry|tree|transforms|merge|nested|variants|migrate)\.tsx?$/,
    ],
  },
  {
    key: "cms-blocks-editing",
    name: "CMS: edycja bloków selekcja, focus, schowek, undo",
    // 6 -> 12. Wiersz audytu nosił w nazwie UNDO i nie miał ani jednego pliku
    // historii: `useBlocksHistory` / `useLocalizedBlocksHistory` żyją
    // w `components/admin/blocks/hooks/`, razem ze schowkiem, selekcją
    // międzyblokową i stosem kanwy. `imagePaste` + `persistImages` to ta sama
    // akcja schowka, tylko kończąca się wgraniem grafiki do biblioteki mediów.
    patterns: [
      /^src\/lib\/blocks\/(selection|selectionDom|crossSelection|focus|clipboard|imagePaste|persistImages)\.ts$/,
      /^src\/components\/admin\/blocks\/hooks\//,
    ],
  },
  {
    key: "cms-blocks-inserter",
    name: "CMS: katalog i wstawianie bloków (inserter, menu slash, wzorce)",
    // WIERSZ NOWY. Moment, w którym redaktor dodaje blok. `search.ts` to
    // wspólne filtrowanie dla insertera I menu slash (tak mówi jego nagłówek),
    // `i18n.ts` to warstwa nazw, które w tym katalogu widać.
    patterns: [
      /^src\/lib\/blocks\/(search|patterns|i18n)\.ts$/,
      /^src\/components\/admin\/blocks\/BlockInserter\.tsx$/,
      /^src\/components\/admin\/blocks\/molecules\/(BlockAppender|SlashMenu)\.tsx$/,
    ],
  },
  {
    key: "cms-blocks-annotations",
    name: "CMS: przypisy, kotwice, osadzenia i podglądy linków w treści",
    // WIERSZ NOWY. To, co redaktor DOKŁADA do zdania, a nie sam blok. Kotwice
    // i przypisy trzymane razem, bo obie klasy defektów są tego samego typu:
    // rozjazd między tym, co emituje renderer, a tym, co liczy spis treści.
    patterns: [
      /^src\/lib\/blocks\/(anchors|footnoteOrigins|footnoteValidation|embed|linkPreview)\.ts$/,
      /^src\/components\/admin\/blocks\/AutoFootnotesPreview\.tsx$/,
    ],
  },
  {
    key: "cms-blocks-inline-format",
    name: "CMS: formatowanie tekstu i mediów w miejscu (paski narzędzi bloku)",
    // WIERSZ NOWY. Pasek nad aktywnym blokiem (wyrównanie, szerokość, padding,
    // tło, anchor) plus warstwa contenteditable pod nim.
    patterns: [
      /^src\/lib\/blocks\/inlineHtml\.ts$/,
      /^src\/components\/admin\/blocks\/(GenericWidgetToolbar|HeadingWidgetToolbar|MediaWidgetToolbar|WordStyleToolbar)\.tsx$/,
      /^src\/components\/admin\/blocks\/atoms\/InlineHtmlEditable\.tsx$/,
    ],
  },
  {
    key: "cms-blocks-edit-forms",
    name: "CMS: formularze edycji pojedynczych bloków",
    // WIERSZ NOWY i największy pojedynczy blok sierot audytu: 62 formularze,
    // po jednym na typ bloku. Żaden nie należał do żadnego wiersza tabeli.
    patterns: [/^src\/components\/admin\/blocks\/edit\//],
  },
  {
    key: "cms-blocks-inspector",
    name: "CMS: inspektor ustawień bloku (panel boczny i kontrolki pól)",
    // WIERSZ NOWY. Prawy panel ustawień plus cztery kontrolki, których używa
    // on i formularze bloków. `AdminCalendar` stoi TU, a nie w kanwie: to
    // kontrolka pola, nie płótno.
    patterns: [
      /^src\/components\/admin\/blocks\/(BlockSidebar|AdminCalendar|AdminColorPicker|AdminDatePicker|AdminSelect)\.tsx$/,
    ],
  },
  {
    key: "cms-blocks-canvas",
    name: "CMS: kanwa edytora bloków (płótno, lista, zagnieżdżanie, przeciąganie)",
    // Łapacz reszty `admin/blocks` - świadomie PO wszystkich wierszach
    // szczegółowych, bo to one nadają znaczenie, a nie katalog. Zostaje realna
    // powierzchnia: płótno, renderer edycji, kontekst edytora, wireframe
    // layoutu wpisu, drzewo bloków, edytor zagnieżdżeń, sortowanie, podgląd
    // kodu i trzy atomy.
    patterns: [/^src\/components\/admin\/blocks\//],
  },
  {
    key: "cms-blocks-public-render",
    name: "CMS: render bloków publiczny",
    patterns: [/^src\/components\/blocks\//],
  },
  {
    key: "cms-builder-widgets-render",
    name: "CMS: widgety buildera - render publiczny",
    // 57 -> 59. `SectionTabsBar` (352 linie) i `TtsPlayerHost` renderują się
    // NA STRONIE PUBLICZNEJ, nie tylko na kanwie - zostawienie ich w warstwie
    // edytorskiej byłoby fałszywą etykietą na publicznym kodzie.
    patterns: [
      /^src\/components\/builder\/organisms\//,
      /^src\/components\/builder\/molecules\/(SectionTabsBar|TtsPlayerHost)\.tsx$/,
    ],
  },
  {
    key: "cms-builder-inline-edit",
    name: "CMS: warstwa edytorska buildera (edycja w miejscu, skróty, schowek)",
    // WIERSZ NOWY - kategoria, której brak wskazał sam audyt. Powierzchnia:
    // redaktor klika w tekst na żywym podglądzie i pisze. `Editable.tsx` to
    // DRUGIE największe zero modułu, `inlineEditContext.tsx` to most z kanwy
    // do `updateWidget` (publiczny renderer tego kontekstu nie podaje, więc
    // widgety zostają tylko do odczytu). Wzorzec celuje w `useBuilder*`, a nie
    // w cały katalog `ui/hooks/`, bo `useGlobalWidgetSync` idzie do widgetów
    // globalnych.
    patterns: [
      /^src\/components\/builder\/(inlineEditContext|molecules\/Editable)\.tsx$/,
      /^src\/components\/admin\/builder\/ui\/hooks\/useBuilder/,
    ],
  },
  {
    key: "cms-builder-schema",
    name: "CMS: page builder typ Elementor - schemat i operacje",
    // 11 -> 12: dołożony `headings.ts` (czy dokument buildera na pewno renderuje
    // `h1`) - to, jak `sectionKind.ts`, czyste zapytanie o drzewo dokumentu,
    // a nie pole panelu.
    patterns: [
      /^src\/lib\/builder\/(schema|schemas|types|operations|parse|registry|clipboard|editTargets|dndMime|sectionKind|revisions|headings)\.tsx?$/,
    ],
  },
  {
    key: "cms-builder-tokens",
    name: "CMS: design tokens / kolory globalne / typografia",
    // 6 -> 7: dołożony `themed.ts` (rozstrzyganie wartości per tryb light/dark).
    // Bez niego wiersz o kolorach nie zawiera reguł wyboru koloru w ciemnym
    // motywie.
    patterns: [
      /^src\/lib\/builder\/(designTokens|globalColors|cssColor|autoInvertColor|liveTypography|typographyCss|themed)\.ts$/,
    ],
  },
  {
    key: "cms-builder-css",
    name: "CMS: generowany CSS sekcji, sidebara i stanów hover",
    // WIERSZ NOWY. Tokeny mówią JAKA wartość, te trzy pliki - JAKI CSS z niej
    // powstaje i gdzie się wstrzykuje. Defekty innej klasy, więc inny wiersz.
    patterns: [/^src\/lib\/builder\/(sectionStyles|sidebarStyles|hoverCss)\.tsx?$/],
  },
  {
    key: "cms-builder-queries",
    name: "CMS: zapytania danych widgetów",
    // 8 -> 17. Samych plików `*Query.ts` jest w `lib/builder/` czternaście,
    // więc audytowa ósemka opisywała mniej niż połowę własnego wiersza.
    // Dołożone: klucze cache, realtime unieważnianie dla sesji redakcyjnych
    // i `usedPostIds` (odsiewanie wpisów już pokazanych przez wcześniejsze
    // widgety tej samej strony) - to warstwa zapytania, nie prezentacji.
    patterns: [
      /^src\/lib\/builder\/\w*Query\.ts$/,
      /^src\/lib\/builder\/(queryKeys|usedPostIds|widgetCacheInvalidation)\.tsx?$/,
    ],
  },
  {
    key: "cms-builder-streaming",
    name: "CMS: strumieniowanie sekcji i wstępne ładowanie ponad zgięciem",
    // WIERSZ NOWY. KIEDY sekcja ma się pojawić, a nie SKĄD bierze dane -
    // regresje są tu wydajnościowe (LCP, podwójne zapytanie), nie treściowe.
    patterns: [
      /^src\/lib\/builder\/(aboveFold|sectionStreaming|useSectionPreload|prefetch)\.tsx?$/,
    ],
  },
  {
    key: "cms-builder-templates",
    name: "CMS: szablony startowe, kity stron i historia szablonu",
    // WIERSZ NOWY. Dialog historii idzie tym samym wierszem co magazyn, który
    // tę historię prowadzi: rozdzielenie na „warstwę" i „panel" dałoby dwa
    // wiersze, z których żaden nie opisuje niczego wyobrażalnego osobno.
    patterns: [
      /^src\/lib\/builder\/(templates|starterTemplates|templateKit|homepageTemplate)\.ts$/,
      /^src\/components\/admin\/builder\/ui\/organisms\/TemplateHistoryDialog\.tsx$/,
    ],
  },
  {
    key: "cms-builder-global-widgets",
    name: "CMS: widgety globalne współdzielone między stronami",
    // WIERSZ NOWY. Widget zapisany raz i osadzony na wielu stronach (węzeł
    // trzyma migawkę dla SSR plus `globalId`, renderer nakłada żywy rekord).
    // Hook synchronizacji stoi tu, mimo że reszta `ui/hooks/` idzie do warstwy
    // edytorskiej - bo to ta sama obietnica: edycja w jednym miejscu propaguje
    // się wszędzie.
    patterns: [
      /^src\/lib\/builder\/globalWidgets\.ts$/,
      /^src\/components\/admin\/builder\/ui\/hooks\/useGlobalWidgetSync\.ts$/,
    ],
  },
  {
    key: "cms-builder-display-rules",
    name: "CMS: reguły wyświetlania sekcji (dostęp, popupy, testy A/B)",
    // WIERSZ NOWY. Trzy niezależne odpowiedzi na jedno pytanie: czy TEN
    // odwiedzający zobaczy TĘ sekcję.
    patterns: [/^src\/lib\/builder\/(accessControl|popups|experiments)\.ts$/],
  },
  {
    key: "cms-builder-dynamic",
    name: "CMS: dane dynamiczne widgetu (referencje treści, tagi, kontekst archiwum, autor)",
    // WIERSZ NOWY. Widget wskazuje na wpis/stronę/kategorię, a dane mają iść
    // na żywo ze źródła zamiast duplikować się w JSON-ie widgetu.
    // `archiveContext.ts` zamyka regresję, w której widget `archive-title`
    // pokazywał realnym czytelnikom zaszytą próbkę „Przykładowe archiwum".
    patterns: [/^src\/lib\/builder\/(contentRefs|dynamicText|archiveContext|authorDisplay)\.ts$/],
  },
  {
    key: "cms-builder-sliders",
    name: "CMS: slidery i karuzele wpisów",
    // WIERSZ NOWY i największe pojedyncze zero modułu: `sliderVariants.tsx` to
    // 1835 linii własnego renderera slidera (bez biblioteki zewnętrznej).
    patterns: [
      /^src\/lib\/builder\/(sliderVariants|sliderOptions|sliderSizes|circularCarousel|progressCarousel|postListCarousel)\.tsx?$/,
    ],
  },
  {
    key: "cms-builder-presets",
    name: "CMS: modele treści widgetów (nagłówki animowane, etykiety sekcji, karty, mapa świata)",
    // WIERSZ NOWY. Czyste modele „treść widgetu -> propsy komponentu", czytane
    // przez trzy strony naraz: renderer publiczny, kanwę buildera i rejestr
    // prefetchu SSR. Jedno miejsce parsowania kluczy magazynowych - tych
    // samych, które porównuje bramka wierności ustawień.
    patterns: [
      /^src\/lib\/builder\/(animatedHeadingVariants|animatedHeadingLinks|sectionLabelVariants|coverOverlayCard|travelRouteCard|worldMapContent|speakerRow|clubHub|socialBrand)\.tsx?$/,
    ],
  },
  {
    key: "cms-builder-images",
    name: "CMS: obrazy widgetów (hero/LCP, miniatury, rozmiary)",
    // WIERSZ NOWY. Obraz, który widz zobaczy pierwszy: preload LCP dla
    // dokumentów buildera (ich hero żyje w drzewie sekcji, więc kontrakt
    // loader->head() z wpisów ich nie obejmował), podmiana miniatury per wpis
    // i wybór rozmiaru wariantu.
    patterns: [/^src\/lib\/builder\/(heroImage|thumbnailOverrides|widgetImageSizes)\.ts$/],
  },
  {
    key: "cms-builder-fields",
    name: "CMS: pola i etykiety widgetów (wartości panelu, pola formularzy, tłumaczenia EN)",
    // WIERSZ NOWY. Co redaktor widzi w polu i co z tego trafia do dokumentu:
    // czysty dostęp do wartości panelu, mapa pól przyjmujących markery
    // przypisów, hybrydowy model pól formularza per widget (nadpisania pól
    // predefiniowanych + `customFields`) i 1345 linii angielskich etykiet dla
    // kopii sterowanej danymi.
    patterns: [
      /^src\/lib\/builder\/(widgetPanelValues|widgetTextFields|formFieldConfig|labelsEn)\.tsx?$/,
    ],
  },
  {
    key: "cms-builder-chrome",
    name: "CMS: chrome witryny w builderze (nagłówek, menu, stopka)",
    // WIERSZ NOWY. Edycja nagłówka/menu/stopki serwisu jako dokumentów
    // buildera - powierzchnia, której redaktor nie myli z treścią strony.
    patterns: [/^src\/lib\/builder\/(chromeDefaults|siteSettingsLiveSync)\.tsx?$/],
  },
  {
    key: "cms-builder-ci",
    name: "CMS: bramka wierności ustawień i diagnostyka buildera",
    // WIERSZ NOWY. To, co pilnuje, że panel i render mówią o tym samym:
    // porównanie DOKŁADNYCH kluczy magazynowych plus koordynator nakładki
    // diagnostycznej (jeden arkusz zamiast ~11 KB na każdą instancję
    // renderera - a na stronie głównej renderer jest zamontowany kilka razy).
    patterns: [/^src\/lib\/builder\/ci\//, /^src\/lib\/builder\/builderDebug\.ts$/],
  },
  {
    key: "cms-builder-widget-props",
    name: "CMS: panele właściwości widgetów",
    // NAZWA ZACHOWANA, WIERSZ ZWĘŻONY: 112 -> 41. Audytowe 112 to był CAŁY
    // katalog `components/admin/builder/**` - z kanwą, nawigatorem, biblioteką
    // widgetów, kontrolkami stylu i skrótami klawiaturowymi w środku. Nazwa
    // obiecywała panele właściwości, a mierzyła cały edytor. Tu zostaje 40
    // edytorów per widget plus kanoniczny `WidgetProperties.tsx` (1751 linii,
    // zakładki Content / Style / Advanced).
    patterns: [
      /^src\/components\/admin\/builder\/ui\/organisms\/widget-properties\//,
      /^src\/components\/admin\/builder\/WidgetProperties\.tsx$/,
    ],
  },
  {
    key: "cms-builder-section-props",
    name: "CMS: właściwości sekcji i kolumn (układ, tło, zakładki)",
    // WIERSZ NOWY, wydzielony z audytowych 112. Pliki w korzeniu katalogu to
    // dwuliniowe re-eksporty do `ui/organisms/` - idą tym samym wierszem co
    // implementacja kanoniczna, żeby shim i implementacja nie rozjechały się
    // na dwa wiersze tabeli.
    patterns: [
      /^src\/components\/admin\/builder\/ui\/organisms\/section-properties\//,
      /^src\/components\/admin\/builder\/ui\/organisms\/ColumnProperties\.tsx$/,
      /^src\/components\/admin\/builder\/(SectionProperties|ColumnProperties)\.tsx$/,
    ],
  },
  {
    key: "cms-builder-controls",
    name: "CMS: kontrolki stylu i treści w panelach buildera",
    // WIERSZ NOWY, wydzielony z audytowych 112. Słownik kontrolek, którym
    // posługują się WSZYSTKIE panele (tło, obramowanie, odstępy, typografia,
    // kolor, link, ikona, animacja, widoczność, dostęp, arkusz danych wykresu,
    // wstawiacz tagów dynamicznych) plus 14 atomów pól.
    patterns: [/^src\/components\/admin\/builder\/ui\/(atoms|molecules)\//],
  },
  {
    key: "cms-builder-canvas",
    name: "CMS: kanwa page buildera (płótno, upuszczanie sekcji, zmiana rozmiaru)",
    // WIERSZ NOWY, wydzielony z audytowych 112. To, co redaktor widzi na
    // środku ekranu i czym manipuluje myszą.
    patterns: [
      /^src\/components\/admin\/builder\/ui\/organisms\/builder\//,
      /^src\/components\/admin\/builder\/ui\/organisms\/(InlineSizeToolbar|EmptyContainerPickerBox)\.tsx$/,
      /^src\/components\/admin\/builder\/Builder\.tsx$/,
    ],
  },
  {
    key: "cms-builder-library",
    name: "CMS: biblioteka widgetów i wybór struktury sekcji",
    // WIERSZ NOWY, wydzielony z audytowych 112. Odpowiednik insertera bloków
    // po stronie buildera: katalog widgetów, podgląd na żywo przed wstawieniem
    // i wybór układu kolumn nowej sekcji.
    patterns: [
      /^src\/components\/admin\/builder\/ui\/organisms\/(WidgetLibrary|StructurePicker|WidgetLivePreview)\.tsx$/,
      /^src\/components\/admin\/builder\/(WidgetLibrary|StructurePicker)\.tsx$/,
    ],
  },
  {
    key: "cms-builder-navigator",
    name: "CMS: nawigator drzewa strony",
    // WIERSZ NOWY, wydzielony z audytowych 112. Drzewo sekcja > kolumna >
    // widget - odpowiednik `BlockListView` po stronie buildera. Osobny panel
    // z własnym stanem zaznaczenia, więc osobny wiersz.
    patterns: [/^src\/components\/admin\/builder\/(ui\/organisms\/)?Navigator\.tsx$/],
  },
];

/** Taksonomia funkcjonalności per moduł. Dziś kompletna dla modułów 3, 16 i 21. */
export const FEATURES = new Map([
  [3, FEATURES_3],
  [16, FEATURES_16],
  [21, FEATURES_21],
]);

/** Klucz funkcjonalności dla ścieżki, albo `null` (moduł bez taksonomii). */
export function featureForPath(path) {
  const { module } = classifyPath(path);
  if (module === null) return null;
  const rows = FEATURES.get(module);
  if (!rows) return null;
  for (const row of rows) {
    for (const pattern of row.patterns) {
      if (pattern.test(path)) return row.key;
    }
  }
  return null;
}

export const FEATURE_NAMES = new Map(
  [...FEATURES.values()].flat().map((row) => [row.key, row.name]),
);

export { MODULE_NAMES };
