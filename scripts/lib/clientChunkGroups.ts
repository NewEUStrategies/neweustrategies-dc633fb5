// Podział chunków bundla PRZEGLĄDARKI: grupy `output.codeSplitting` Rolldowna (Vite 8).
//
// JEDNO ŹRÓDŁO dla vite.config.ts i vite.smoke.config.ts - oba presety biorą grupy z tego
// modułu, więc boot-test smoke bada dokładnie ten podział, który jedzie na produkcję (parytet:
// src/lib/ci/__tests__/viteChunkParity.test.ts; inwarianty grup na zainstalowanych pakietach
// i na prawdziwym buildzie: clientChunkGroups.test.ts). Grupy WYŁĄCZNIE w środowisku `client`:
// worker zostaje jednym samodzielnym wejściem (komentarz w vite.config.ts - incydent h3-500).
//
// DLACZEGO NIE `manualChunks`. Rolldown przyjmuje go już tylko dla zgodności z Rollupem i robi
// z niego JEDNĄ grupę z funkcją `name`: każda zwrócona nazwa staje się osobną grupą o RÓWNYM
// priorytecie, przetwarzaną w kolejności nazw, a grupa (domyślnie
// `includeDependenciesRecursively: true`) zabiera statyczne zależności swoich modułów - także
// te, które funkcja przypisała do nazwy dalszej w alfabecie. Zmierzone na syntetycznym buildzie
// przy migracji: `vendor-lucide` połykał React przypisany do `vendor-react`, a `legal-links` -
// bibliotekę bootową, przez co wejście importowało `legal-links` statycznie. Do tego `meta`
// `manualChunks` nie ma już `getModuleIds()`, więc dawny klasyfikator `bootVendorSplit.ts`
// wywracał build klienta na pierwszym module radixa albo lucide.
//
// ZASADA PRIORYTETÓW (następczyni zasady domknięcia z incydentu 2026-07-20 - martwa hydratacja
// na KAŻDEJ stronie). Grupa o wyższym `priority` wybiera moduły pierwsza, a moduły, które już
// zabrała, wypadają z pozostałych grup. Grupa musi więc mieć priorytet WYŻSZY niż każda grupa,
// której moduły ją statycznie importują: wtedy żadna grupa nie zabierze cudzego pakietu jako
// swojej zależności, krawędzie między nazwanymi chunkami biegną wyłącznie od niższego priorytetu
// do wyższego, a cykl chunków (przy CJS-interop wywracał kolejność inicjalizacji: "Cannot set
// properties of undefined (setting 'useSyncExternalStore')" i boot padał przed `hydrateRoot`,
// strona zostawała statycznym SSR-em bez żadnego błędu) jest niemożliwy z konstrukcji. Równy
// priorytet = grupy NIEZALEŻNE (remis rozstrzyga kolejność w tablicy). Zależność spoza
// wszystkich grup (tslib, iceberg-js, detect-node-es...) trafia do pierwszej grupy, której moduł
// jej potrzebuje - jak w Rollupie. Test pilnuje zasady na zainstalowanych `package.json`, nie na
// ręcznej liście. Dev i testy jednostkowe tej klasy awarii NIE ŁAPIĄ (w dev nie ma chunków);
// bramki po buildzie: check:chunks (cykle) + boot-test przeglądarkowy na vite.smoke.config.ts.
//
// MAŁE CHUNKI. Rolldown nie ma odpowiednika `experimentalMinChunkSize` Rollupa (opcja jest
// ignorowana z ostrzeżeniem), więc nic nie wkleja już małych modułów leniwych do `index-*` -
// znika cała klasa awarii, przy której przypinaliśmy LegalLinks, sonner, ClubThreadKindIcon
// i listę `ENTRY_MERGED_LUCIDE_IMPORTERS`. Ceną jest więcej drobnych plików (zmierzone na
// Rollupie dla progu 1 B: +59,6 KB gzip OVERALL - scripts/check-bundle-size.ts). Granice, na
// których stoją bramki, wyznaczają nazwane grupy, a nie heurystyka.
//
// DOMKNIĘCIE BOOTU W JEDNYM CHUNKU (`app-initial`, 2026-10-16). Rollup kładł każdy moduł
// statycznie osiągalny z wejścia do chunku wejściowego, także gdy importował go też chunk leniwy
// (ten i tak ładuje się po wejściu). Rolldown tego nie robi: moduł osiągalny z wejścia I z chunku
// leniwego dostaje chunk wspólny, a jego `chunkOptimization` (domyślnie włączone) nie wkleił ich
// z powrotem. Ofiarą był każdy moduł opcji trasy (`src/routes/*.tsx` bez `?tsr-split`): drzewo
// tras importuje go z wejścia, a chunk komponentu trasy - po `Route`. Zmierzone na artefakcie bez
// tej grupy: 337 chunków w domknięciu bootu (Rollup: 10), 772,9 KB gzip (Rollup: 494,1 KB;
// budżet 579 KB). Treści przybyło mało - narzut to ~330 plików kompresowanych osobno, każdy
// z własną listą `__vite__mapDeps` (opcje trasy 0,6 KB, lista preloadu jej komponentu 6 KB),
// a seria `modulepreload` trybu `now` przepełniała nagłówek `Link` (Node: 16 KB na nagłówki,
// „Header overflow" w boot-teście artefaktu). Grupa z tagiem `$initial` i NAJNIŻSZYM priorytetem
// wśród modułów bootu zbiera to, czego nie zabrały grupy vendorowe, w jeden chunk: domknięcie
// 12 chunków, 480,7 KB gzip. Wejście zostaje w `index-*` (wyjątek w `group()`), który importuje
// `app-initial`; to on niesie leniwe `import()` aplikacji, w tym listwy stopki.
import type { Rolldown } from "vite";

type Group = Rolldown.CodeSplittingGroup;
type Test = (id: string) => boolean;

/**
 * Priorytety grup w porządku topologicznym grafu pakietów (wyżej = wybiera wcześniej). Kolejność
 * kluczy jest kolejnością zależności: każdy poziom importuje wyłącznie poziomy nad sobą.
 */
export const CHUNK_PRIORITY = {
  /** react, react-dom, scheduler, use-sync-external-store - zależność wszystkich. */
  react: 100,
  /** Biblioteki zależne co najwyżej od vendor-react; wzajemnie niezależne. */
  leaf: 90,
  /** Część bootowa rodzin lucide i radix (`$initial`) - przed resztą swojej rodziny. */
  boot: 80,
  /** Reszta rodzin lucide i radix - importuje część bootową, nigdy odwrotnie. */
  family: 70,
  /** Ciężkie kontrolki radixa - zależą od vendor-radix(-boot). */
  heavyRadix: 60,
  /** `dynamic-icon`: bootowy moduł aplikacji, importowany przez `club-thread-kind-icon`. */
  appBoot: 50,
  /** Leniwe moduły aplikacji zależne wyłącznie od vendorów. */
  app: 40,
  /** `club-thread-kind-icon` importuje `DynamicIcon`. */
  appDependent: 30,
  /**
   * `app-initial`: reszta statycznego domknięcia wejścia (`$initial`) - importuje poziomy bootowe
   * wyżej, nikt z grup go nie importuje. NAJNIŻSZY, bo `$initial` liczy Rolldown przed
   * tree-shakingiem: `Footer.tsx` importuje `LegalLinks` statycznie dla gałęzi SSR, martwej
   * w kliencie, więc listwa też jest `$initial` - grupa `legal-links` musi wybrać pierwsza.
   */
  initial: 20,
} as const;

/**
 * Grupa z nazwą-funkcją, która POMIJA moduł wejściowy.
 *
 * PUŁAPKA (2026-08-06, nadal prawdziwa na Rolldownie - test na buildzie): moduł WEJŚCIOWY
 * przypisany do grupy zapada CAŁĄ grupę z powrotem w chunk wejściowy, bez ostrzeżenia. Dokładnie
 * tak umarł kiedyś `vendor-tanstack`: wejściem klienta jest
 * `@tanstack/react-start/dist/plugin/default-entry/client.tsx`, plik POD /node_modules/@tanstack/,
 * więc szersza reguła przypisywała entry do grupy i ~320 KB (surowo) routera, react-query
 * i start-client-core jechało w `index-*.js` mimo pozornie poprawnej konfiguracji. `test` nie zna
 * grafu, a `name` dostaje kontekst z `getModuleInfo` i jest wołane wyłącznie dla modułów, które
 * przeszły `test` - zwrócone `null` wyjmuje moduł z grupy. `debugName` podpisuje grupę
 * w raporcie czasów bundlera (nazwa jest funkcją).
 */
function group(
  name: string,
  priority: number,
  test: RegExp | Test,
  tags?: Rolldown.BuiltinModuleTag[],
): Group {
  return {
    debugName: name,
    name: (id, ctx) => (ctx.getModuleInfo(id)?.isEntry ? null : name),
    test,
    priority,
    ...(tags ? { tags } : {}),
  };
}

/** Ścieżka od OSTATNIEGO `/node_modules/` (pakiet, który naprawdę dostarcza moduł). */
const lastPackagePath = (id: string): string => id.split("/node_modules/").at(-1) ?? "";

const HEAVY_RADIX_RE =
  /^@radix-ui\/react-(select|slider|scroll-area|menu|context-menu|dropdown-menu)\//;

/**
 * Grupa ciężkiej kontrolki radixa (`select`, `slider`, `scroll-area`, `menu` - z nią
 * `context-menu`/`dropdown-menu`, które importują `react-menu`) albo `undefined`. Po OSTATNIM
 * segmencie node_modules - zagnieżdżona kopia prymitywu pod pakietem kontrolki zostaje w rodzinie.
 */
function heavyRadix(id: string): string | undefined {
  if (!id.includes("/node_modules/")) return undefined;
  const pkg = HEAVY_RADIX_RE.exec(lastPackagePath(id))?.[1];
  return pkg?.includes("menu") ? "menu" : pkg;
}

const RADIX_FAMILY_RE =
  /\/node_modules\/(@radix-ui|@floating-ui|aria-hidden|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|get-nonce)\//;

/** Radix i jego sidecary (scroll-lock, aria-hidden, floating-ui) bez ciężkich kontrolek. */
const isRadixFamily: Test = (id) => RADIX_FAMILY_RE.test(id) && heavyRadix(id) === undefined;

const LUCIDE_RE = /\/node_modules\/lucide-react\//;

/** Tylko zod TOP-LEVEL (patrz grupa `vendor-zod`). */
const isTopLevelZod: Test = (id) =>
  /\/node_modules\/zod\//.test(id) && !/\/node_modules\/[^]*?\/node_modules\/zod\//.test(id);

const endsWith =
  (suffix: string): Test =>
  (id) =>
    id.endsWith(suffix);

/** Grupy w kolejności priorytetów; przy równym priorytecie kolejność w tablicy jest remisem. */
export const CLIENT_CHUNK_GROUPS: readonly Group[] = [
  // React + `use-sync-external-store`: ten ostatni TUTAJ, nie przy radixie, tanstacku czy
  // react-i18next - rozdzielenie pakietu od jego zależności dało cykl z 2026-07-20. Moduł
  // pomocniczy Rolldowna (`\0rolldown/runtime.js`, interop CJS) nie trafia do żadnej grupy:
  // Rolldown 1.2 wydziela go do własnego chunku `rolldown-runtime` (zmierzone na artefakcie i na
  // fiksturze `clientChunkGroups.test.ts`), który importują wejście i chunki z interopem.
  group(
    "vendor-react",
    CHUNK_PRIORITY.react,
    /\/node_modules\/(react|react-dom|scheduler|use-sync-external-store)\//,
  ),
  // Router + react-query + ich domknięcie spoza vendor-react: seroval / seroval-plugins
  // (serializacja SSR w router-core), cookie-es (router-core), isbot (react-router).
  //
  // ŚWIADOMIE POZA GRUPĄ: rodzina `@tanstack/*start*` (react-start, react-start-client,
  // start-client-core, start-fn-stubs). To RUNTIME BOOTSTRAPU, przez który biegnie droga od modułu
  // wejściowego do `src/router.tsx`. Grupa zabiera statyczne zależności swoich modułów, więc
  // objęłaby cały osiągalny stąd graf APLIKACJI (zmierzone na Rollupie, który robi to samo: entry
  // spadał do 0,2 KB, a vendor-tanstack puchł do 1,59 MB). Bootstrap zostaje w entry, wydzielamy
  // tylko biblioteki liściowe.
  group(
    "vendor-tanstack",
    CHUNK_PRIORITY.leaf,
    /\/node_modules\/(@tanstack\/(react-router|router-core|history|store|react-store|query-core|react-query|router-ssr-query-core|react-router-ssr-query)|seroval|seroval-plugins|cookie-es|isbot)\//,
  ),
  // tslib i iceberg-js (zależności supabase) zostają tu jak w Rollupie; vendor-radix importuje
  // stąd tslib (react-remove-scroll) - krawędź do wyższego priorytetu.
  group("vendor-supabase", CHUNK_PRIORITY.leaf, /\/node_modules\/@supabase\//),
  group(
    "vendor-i18n",
    CHUNK_PRIORITY.leaf,
    /\/node_modules\/(i18next|react-i18next|html-parse-stringify|void-elements)\//,
  ),
  // Silnik archiwów odizolowany od drobnych modułów publicznych: Rollup łączył małe chunki
  // i spakował kiedyś 312-bajtowy stub funkcji serwerowej auth z JSZip, wciągając cały silnik
  // w statyczny graf artykułu. Własna grupa trzyma tę granicę niezależnie od heurystyk.
  group("vendor-jszip", CHUNK_PRIORITY.leaf, /\/node_modules\/jszip\//),
  // Biblioteki bez zależności - własne chunki zamiast zapadania się w chunk wejściowy. zod
  // i tailwind-merge są nadal statycznie osiągalne z entry: bajtów pierwszej wizyty to nie
  // zmniejsza, ale zdejmuje ~230 kB źródeł z NAJWIĘKSZEGO pliku (budżet largest-chunk) i daje
  // trwały cache między deployami. Tylko zod TOP-LEVEL: @tanstack/react-start wozi ZAGNIEŻDŻONĄ
  // kopię zod 4 - mieszanie dwóch wersji w jednym cache-stabilnym chunku sprzęgałoby jego
  // unieważnianie z bumpami frameworka. dompurify (jak sonner niżej) jest od 2026-08-18 poza
  // grafem bootowania (lib/sanitizePure.ts, lib/notify.ts) - nazwany chunk stabilizuje adres,
  // a check:entry-purity pilnuje, żeby nie wrócił.
  group("vendor-zod", CHUNK_PRIORITY.leaf, isTopLevelZod),
  group("vendor-tw-merge", CHUNK_PRIORITY.leaf, /\/node_modules\/tailwind-merge\//),
  group("vendor-dompurify", CHUNK_PRIORITY.leaf, /\/node_modules\/dompurify\//),
  // Ikony w DWÓCH chunkach vendorowych, nie w dziesiątkach plików: bez grupy bundler rozsypuje
  // je na 300-400-bajtowe odpryski (każda ikona współdzielona przez >=2 leniwe chunki dostaje
  // własny) - 45 takich plików kosztowało ~22 KB gzip samego narzutu, bo pliki tej wielkości
  // praktycznie się nie kompresują. Radix + sidecary: entry potrzebuje z tej rodziny TYLKO
  // `react-slot` (components/ui/button.tsx) i react-compose-refs, a płacił 38 KB gzip za dialogi,
  // tooltipy i floating-ui na każdej stronie publicznej.
  //
  // Podział boot/reszta wg osiągalności STATYCZNEJ z wejścia: tag `$initial` liczy Rolldown
  // ("statycznie importowany przez wejście albo należy do jego statycznego łańcucha zależności"),
  // a dla barrela `lucide-react` (pakiet bez efektów ubocznych, re-eksportuje ~1700 ikon)
  // rozwiązuje re-eksporty do faktycznie użytych ikon - ikona tylko re-eksportowana nie jest
  // `$initial` (test na buildzie). To zastępuje ręczne parsowanie nazw importów i listę
  // `ENTRY_MERGED_LUCIDE_IMPORTERS` z dawnego `bootVendorSplit.ts`. Domknięcie: zależności modułu
  // `$initial` też są `$initial`, a grupa bootowa wybiera przed resztą, więc krawędzie biegną
  // wyłącznie reszta -> boot (ikony niebootowe importują `createLucideIcon` z `-boot`).
  group("vendor-lucide-boot", CHUNK_PRIORITY.boot, LUCIDE_RE, ["$initial"]),
  group("vendor-radix-boot", CHUNK_PRIORITY.boot, isRadixFamily, ["$initial"]),
  group("vendor-lucide", CHUNK_PRIORITY.family, LUCIDE_RE),
  group("vendor-radix", CHUNK_PRIORITY.family, isRadixFamily),
  // Ciężkie kontrolki nie są potrzebne nagłówkowi publicznemu - poza wspólnym chunkiem
  // prymitywów. Priorytet NIŻSZY od rodziny, więc ich zależności (popper, floating-ui, prymitywy)
  // zostają w vendor-radix(-boot). Jedyna zależność między nimi: context-menu -> menu, w tej samej
  // grupie (sprawdzone na zainstalowanych `package.json` - test).
  group("vendor-radix-select", CHUNK_PRIORITY.heavyRadix, (id) => heavyRadix(id) === "select"),
  group("vendor-radix-slider", CHUNK_PRIORITY.heavyRadix, (id) => heavyRadix(id) === "slider"),
  group(
    "vendor-radix-scroll-area",
    CHUNK_PRIORITY.heavyRadix,
    (id) => heavyRadix(id) === "scroll-area",
  ),
  group("vendor-radix-menu", CHUNK_PRIORITY.heavyRadix, (id) => heavyRadix(id) === "menu"),
  // `DynamicIcon` renderuje chrome nagłówka (boot) i importuje go `ClubThreadKindIcon`. Bez
  // własnej grupy grupa atomu zabrałaby go jako zależność i wejście importowałoby go z chunku
  // atomu. Moduł wnosi helper preloadu Vite (`\0vite/preload-helper.js`, ma `import()`), więc
  // helper ląduje razem z nim, o ile nie zabrała go wcześniej grupa vendorowa.
  group("dynamic-icon", CHUNK_PRIORITY.appBoot, endsWith("/src/lib/icons/DynamicIcon.tsx")),
  // Listwa prawna stopki (~1 KB): leniwy chunk wyspy stopki, serwer renderuje ją statycznie.
  // Importuje wyłącznie z vendor-react, vendor-tanstack i vendor-i18n. NAZWĘ sprawdza graf
  // artefaktu w e2e/legal-links.boot-home.spec.ts. `import()` dostaje pustą fasadę
  // `LegalLinks-*.js` (dynamiczne wejście w chunku grupy), która reeksportuje ten chunk. Statyczny
  // import z `Footer.tsx` dla gałęzi SSR robi z listwy moduł `$initial`, więc ta grupa MUSI
  // wybierać przed `app-initial` - inaczej kod listwy trafiłby do bootu (test na fiksturze).
  group("legal-links", CHUNK_PRIORITY.app, endsWith("/src/components/footer/LegalLinks.tsx")),
  // Leniwy toaster razem ze swoim SDK (biblioteka sonner importuje wyłącznie react/react-dom).
  // Opakowanie `ui/sonner.tsx` dokłada krawędź do vendor-i18n (etykieta regionu toastów) - też
  // do wyższego priorytetu.
  group(
    "vendor-sonner",
    CHUNK_PRIORITY.app,
    (id) => id.endsWith("/src/components/ui/sonner.tsx") || id.includes("/node_modules/sonner/"),
  ),
  // Atom ikon rodzaju wątku klubu (~1,5 KB, fala 2, 2026-10-05): na Rollupie łączenie małych
  // chunków wkleiło go do wejścia razem z całym `vendor-lucide` (+18 KB gzip w domknięciu bootu
  // każdej strony). Leniwy - poza `$initial`, więc jego ikony spoza zestawu bootowego idą do
  // `vendor-lucide`, który ładuje dopiero ten chunk.
  group(
    "club-thread-kind-icon",
    CHUNK_PRIORITY.appDependent,
    endsWith("/src/components/clubs/atoms/ClubThreadKindIcon.tsx"),
  ),
  // Statyczne domknięcie wejścia poza grupami wyżej (kod aplikacji, moduły opcji tras, runtime
  // bootstrapu Start, drobne pakiety bez grupy) - w JEDEN chunk zamiast setek chunków wspólnych
  // (nagłówek pliku, „DOMKNIĘCIE BOOTU W JEDNYM CHUNKU"). Test łapie każdy moduł, zawęża go tag
  // `$initial`, a wyjątek `group()` zostawia moduł wejściowy w `index-*`. Ostatnia: wybiera
  // dopiero po wszystkich grupach (priorytet przy `CHUNK_PRIORITY.initial`).
  group("app-initial", CHUNK_PRIORITY.initial, () => true, ["$initial"]),
];

/**
 * `output.codeSplitting` środowiska `client` obu presetów. Świeża tablica przy każdym wywołaniu,
 * więc żaden config ani wtyczka nie dostaje referencji do stałej modułu.
 */
export function clientCodeSplitting(): Rolldown.CodeSplittingOptions {
  return { groups: [...CLIENT_CHUNK_GROUPS] };
}
