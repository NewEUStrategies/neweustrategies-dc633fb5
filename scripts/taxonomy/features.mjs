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
// Pełna taksonomia jest tu wyłącznie dla MODUŁU 16 - bo to on był przedmiotem
// naprawy. Pozostałe moduły mają w tabelach audytu wiersze, których reguł
// nikt nie opublikował; przepisywanie ich „z pamięci" dałoby liczby wyglądające
// na porównywalne i takimi niebędące. Dopisanie kolejnego modułu to jeden wpis
// w `FEATURES`, a `check:feature-taxonomy` od razu zacznie go pilnować.
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
    patterns: [/^src\/components\/careers\//],
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

/** Taksonomia funkcjonalności per moduł. Dziś kompletna dla modułów 16 i 21. */
export const FEATURES = new Map([
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
