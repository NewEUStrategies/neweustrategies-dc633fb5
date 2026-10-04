/**
 * Core Web Vitals reporter (SPA-aware).
 *
 * Uses the native PerformanceObserver API (no extra dependencies) to capture:
 *   - LCP  (Largest Contentful Paint)   - loading performance
 *   - CLS  (Cumulative Layout Shift)    - visual stability
 *   - INP  (Interaction to Next Paint)  - responsiveness (when supported)
 *   - FCP  (First Contentful Paint)     - first paint
 *   - TTFB (Time To First Byte)         - server/network
 *
 * The reporter attributes samples to the pathname the user was on when the
 * metric accumulated - not the pathname at flush time. On soft navigations
 * (SPA route changes) the accumulated LCP/CLS/INP are flushed for the
 * previous path and observers reset, so subpages (kategorie, wpisy, strony
 * statyczne) collect their own samples instead of everything landing on `/`.
 *
 * Values are logged to the console in dev and forwarded via
 * `navigator.sendBeacon` to `/api/public/vitals` in production, BUFFERED into
 * one beacon per flush boundary (see `drain`).
 *
 * FLUSH POLICY - unload safety is the whole design constraint. Every batch
 * boundary drains SYNCHRONOUSLY: soft navigation, `visibilitychange`->hidden
 * and `pagehide` each call `flushCurrent()` and THEN `drain()`. The order is
 * load-bearing: draining first would beacon an empty queue and lose the
 * LCP/CLS/INP that `flushCurrent` is about to enqueue.
 *
 * The timer is NOT a batching window. It exists only because FCP/TTFB are
 * enqueued at init, which has no boundary of its own, so it is zero-delay:
 * that pair leaves on the next macrotask and the window in which a crash can
 * lose it is one task, not seconds. Hidden tabs throttle timers to ~1/min,
 * which is precisely why the hide listeners - never the timer - are the
 * guarantee.
 *
 * KONTEKST NAWIGACJI W ŁADUNKU. Każda próbka niesie dodatkowo `sinceNav`,
 * `navigationType`, `deviceMemory`, `effectiveType` i `coldStart` - pięć pól
 * OPISOWYCH, bez ani jednego identyfikatora, opisanych przy
 * `VitalsNavigationContext` niżej. Bez nich p75 miesza zimne pierwsze wejście
 * z czwartą miękką nawigacją tego samego czytelnika (audyt CWV, F40).
 *
 * STAN CACHE DOKUMENTU I COLO W ŁADUNKU. Próbki PIERWSZEJ trasy dokumentu
 * niosą do trzech pól z nagłówka `Server-Timing` DOKUMENTU
 * (`PerformanceNavigationTiming.serverTiming`): `edgeCache`
 * (HIT/STALE/MISS/BYPASS z `nes-edge`), `edgeLayer` (L1/L2/render
 * z `nes-layer`) i `colo` (kod kolonii Cloudflare z `colo`). Wszystkie są
 * OPCJONALNE - metryki, której nie ma w nagłówku, nie ma też w próbce. Opis
 * przy `VitalsEdgeContext`.
 *
 * ZGRUBNA ATRYBUCJA INP. Próbka INP niesie dodatkowo `inpEvent`,
 * `inpPreHydration`, `inpSinceLoad` i `inpFirst` - typ zdarzenia, stan wyspy
 * hydratacji w chwili zdarzenia, czas względem `load` i znacznik PIERWSZEJ
 * interakcji dokumentu. Opis przy `InteractionRecord`.
 *
 * SŁOWNIKI ŁADUNKU SĄ EKSPORTOWANE (`EDGE_CACHE_STATUSES`, `EDGE_LAYERS`,
 * `INP_EVENT_VALUES`, `MAX_SINCE_LOAD_MS`, kontrakt `data-island-state`):
 * walidacja ingestu i wyspy hydratacji mają brać je stąd, a nie przepisywać.
 *
 * DEFINICJE CLS I INP SĄ TE SAME, CO W BRAMCE CI. Obie metryki liczymy tak,
 * jak liczy je specyfikacja Web Vitals (a za nią Chrome, CrUX i Lighthouse):
 * CLS to MAKSIMUM Z OKIEN SESYJNYCH (patrz `CLS_SESSION_GAP_MS`), a INP to
 * WYSOKI PERCENTYL opóźnień interakcji (patrz `INP_INTERACTIONS_PER_DISCARD`).
 * Bez tego RUM i bramka `cumulative-layout-shift <= 0.1` z `lighthouserc.json`
 * mierzyłyby INNE WIELKOŚCI pod tymi samymi nazwami, a progi
 * `VITAL_THRESHOLDS` (CLS `[0.1, 0.25]`, INP `[200, 500]`) - progi okna
 * sesyjnego i percentyla - oceniałyby liczby, których nie opisują.
 */

import { rateVital, type VitalName, type VitalRating } from "@/lib/observability/vitalsThresholds";
// Import the transport from the module that owns it - directly, NOT through
// `@/lib/observability`, which imports this file (that barrel would be a cycle).
import { sendBeaconPayload, vitalsEndpoint } from "@/lib/observability/report";
// Wyłącznie typy (wymazywane przy kompilacji): listy statusów i warstw NES Edge
// Cache mają jedno źródło, a reporter nie dociąga do grafu klienta ani modułu
// polityki cache, ani potoku `Server-Timing`.
import type { NesCacheStatus } from "@/lib/http/documentCache";
import type { NesCacheLayer } from "@/lib/http/ssrTiming";

interface VitalMetric {
  name: Extract<VitalName, "LCP" | "CLS" | "INP" | "FCP" | "TTFB">;
  value: number;
  rating: VitalRating;
  id: string;
}

function rate(name: VitalMetric["name"], v: number): VitalMetric["rating"] {
  return rateVital(name, v);
}

function uid(): string {
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * KONTEKST NAWIGACJI - pola OPISOWE próbki, bez ani jednego identyfikatora.
 *
 * PO CO. Audyt CWV (docs/AUDYT_CWV_ZIMNE_OTWARCIE_2026-09-20.md, F40 i wiersz
 * 0.3 „Fali 0") nazwał lukę: p75 liczone po wszystkich wierszach MIESZA dwie
 * różne populacje. Zimne pierwsze wejście (pusty cache HTTP, zimny izolat
 * Workera, telefon na 3G) i czwarta miękka nawigacja tego samego czytelnika
 * trafiają dziś do jednego worka, więc mediana „poprawia się" wraz z długością
 * sesji, a dokładnie ten ogon, dla którego p75 się liczy, znika w uśrednieniu.
 * Pięć poniższych pól pozwala ROZCIĄĆ tę populację po stronie zapytania, nie
 * dokładając ani jednego nowego wymiaru osobowego.
 *
 * ZERO NOWYCH IDENTYFIKATORÓW - TO JEST OGRANICZENIE, NIE PREFERENCJA. Żadne
 * z tych pól nie wyróżnia osoby ani urządzenia: `navigationType` ma cztery
 * wartości, `deviceMemory` cztery progi, `effectiveType` cztery klasy łącza,
 * `coldStart` dwie, a `sinceNav` jest czasem względem startu TEJ nawigacji,
 * więc nie sklei dwóch odsłon. Nie ma tu `id` odsłony, sesji ani urządzenia -
 * ingest i tak nie zapisuje `id` metryki (patrz komentarz przy `lcpReported`),
 * a wprowadzenie stabilnego klucza zamieniłoby anonimową telemetrię czasową
 * w profilowanie i unieważniło podstawę, na której ten pomiar stoi.
 *
 * ZGODA. Ten moduł startuje WYŁĄCZNIE zza bramki zgody analitycznej
 * (`initObservability` w `src/lib/observability/index.ts`), a jej cofnięcie
 * rozłącza obserwery i KASUJE bufor (teardown na końcu pliku). Rozszerzenie
 * ładunku NICZEGO w tym nie zmienia: nowe pola jadą tą samą, zgodową drogą.
 * Wysyłka anonimowych metryk czasowych BEZ zgody jest w audycie decyzją DPO
 * i celowo NIE jest tu zaimplementowana.
 */
const NAVIGATION_TYPES = ["navigate", "reload", "back_forward", "prerender"] as const;
type VitalNavigationType = (typeof NAVIGATION_TYPES)[number];

/**
 * PROGI PAMIĘCI URZĄDZENIA. `navigator.deviceMemory` jest z definicji zgrubne
 * (spec dopuszcza 0,25/0,5/1/2/4/8 i CELOWO ucina na 8 GB, żeby nie było
 * wektorem odcisku palca), ale i tak kubełkujemy je do czterech wartości:
 * próbka ma odróżniać telefon od stacji roboczej, a nie opisywać egzemplarz.
 * Kubełkujemy W DÓŁ - urządzenie z 0,5 GB należy do klasy „1 GB i mniej",
 * bo zaokrąglenie w górę wpisałoby najsłabszy sprzęt do mocniejszej klasy
 * i zamazało dokładnie ten ogon, przez który ta kolumna powstaje.
 */
const DEVICE_MEMORY_BUCKETS = [8, 4, 2, 1] as const;
type VitalDeviceMemory = (typeof DEVICE_MEMORY_BUCKETS)[number];

/** Klasy łącza z Network Information API - cztery wartości ze specyfikacji. */
const EFFECTIVE_TYPES = ["slow-2g", "2g", "3g", "4g"] as const;
type VitalEffectiveType = (typeof EFFECTIVE_TYPES)[number];

/**
 * Statusy NES Edge Cache, które może nieść `nes-edge;desc=...`. `satisfies`
 * odrzuca przy kompilacji status, którego serwer (`NesCacheStatus`) nie zna;
 * NOWY status serwera trzeba dopisać tu ręcznie - do tego czasu próbka
 * z takim dokumentem po prostu nie ma pola `edgeCache`.
 */
export const EDGE_CACHE_STATUSES = [
  "HIT",
  "STALE",
  "MISS",
  "BYPASS",
] as const satisfies readonly NesCacheStatus[];
type VitalEdgeCache = (typeof EDGE_CACHE_STATUSES)[number];

/**
 * Warstwa, która podała dokument (`nes-layer;desc=...`, P0.4). `satisfies`
 * jak przy statusach: warstwy, której serwer (`NesCacheLayer`) nie emituje,
 * nie ma na liście - inaczej kolumna `edge_layer` utrwalałaby w CHECK-u
 * wartość, której nikt nie wysyła. Stąd bez `L3`: jeśli trzecia warstwa
 * (R11) kiedyś powstanie, dopisuje się ją po obu stronach i w migracji.
 */
export const EDGE_LAYERS = ["L1", "L2", "render"] as const satisfies readonly NesCacheLayer[];
type VitalEdgeLayer = (typeof EDGE_LAYERS)[number];

/** Kod kolonii Cloudflare: trzy litery kodu lotniska (PRG, WAW, FRA). */
const COLO_RE = /^[A-Z]{3}$/;

/**
 * Ile metryk `Server-Timing` w ogóle przeglądamy. Sami wystawiamy ich do
 * dziewięciu w dwóch nagłówkach, które przeglądarka łączy w jedną listę:
 * potok dokumentu (`nes-edge`, `ssr`, `db`, `nes-age`, `edge-routing`,
 * `nes-layer`) i dopisek wejścia Workera (`server-init`, `app`, `colo`).
 * Limit jest pasem bezpieczeństwa na nagłówek napompowany po drodze.
 */
const MAX_SERVER_TIMING_ENTRIES = 32;

/**
 * STAN CACHE DOKUMENTU, WARSTWA I COLO - trzy pola OPISOWE z nagłówka
 * `Server-Timing` dokumentu, który przeglądarka wystawia w
 * `PerformanceNavigationTiming.serverTiming` (dokument ma to samo
 * pochodzenie co strona, więc `Timing-Allow-Origin` nie jest potrzebny).
 *
 * PO CO. TTFB, LCP i INP realnych czytelników lądują dziś w jednym worku,
 * a MISS w kolonii kosztuje sekundy TTFB (render i szeregowe fale bazy),
 * podczas gdy HIT - ułamek sekundy. Bez podziału po `edgeCache` p75 TTFB
 * mówi więcej o udziale MISS niż o szybkości strony, a bez `colo` nie widać,
 * KTÓRA kolonia jest zimna (plan PSI 85/95, P0.6; raport measurement M7).
 *
 * POLA OPCJONALNE, BEZ TWARDEJ ZALEŻNOŚCI. `nes-edge` wystawia dziś
 * `buildServerTimingValue` (`src/lib/http/ssrTiming.ts`), a `nes-layer`
 * i `colo` dokłada dopiero P0.4 - do tego czasu ich po prostu nie ma.
 * Brak metryki = brak pola w próbce, a nie `null`: ładunek nie rośnie
 * o klucze bez informacji (budżet `MAX_BODY` ingestu, patrz `MAX_METRICS`),
 * a dla ingestu brak pola znaczy to samo co `null`.
 *
 * LISTY DOZWOLONYCH, NIE KOPIA NAPISU. Nagłówek ustawia nasz serwer, ale
 * pośrednik po drodze (proxy, inny hosting, rozszerzenie) może go zmienić,
 * a pole przepisywane „jak leci" byłoby kanałem dowolnego napisu do bazy.
 * Wartość spoza listy (albo spoza wzorca kodu kolonii) odpada do braku pola.
 * Wielkość liter normalizujemy (`l1` -> `L1`, `prg` -> `PRG`), bo to ta sama
 * informacja; przy zdublowanej metryce wygrywa PIERWSZA - nasz potok stawia
 * `nes-edge` na początku nagłówka.
 *
 * WYŁĄCZNIE PIERWSZA TRASA DOKUMENTU. Stan cache opisuje dokument, ale LCP,
 * CLS i INP trasy SPA nie mają z tym dokumentem nic wspólnego - routing
 * klienta nie pyta kolonii o HTML. Pola gasi więc pierwsza miękka nawigacja
 * (`markWebVitalsPage`, razem z `coldStart`). Bez tego podział „INP/CLS per
 * HIT/MISS" mieszałby populacje, a po stronie zapytania nie dałoby się ich
 * rozdzielić: `coldStart=false` mają i trasy miękkie, i ciepłe twarde
 * wejścia, a `navigationType` opisuje dokument. Obciążenie jest to samo co
 * przy `coldStart`: zgoda wyrażona dopiero na trzeciej trasie da próbki tej
 * trasy z polami dokumentu.
 *
 * DOKUMENT Z LOKALNEGO CACHE PRZEGLĄDARKI - BEZ PÓL. Przy nawigacji historią
 * bez bfcache Chrome potrafi podać dokument z dysku bez walidacji (mimo
 * `no-cache`), a `serverTiming` jest wtedy ODTWORZONY z zapisanej
 * odpowiedzi: TTFB ~0, `edgeCache` z pierwotnego pobrania (np. MISS). Taka
 * próbka zaniżałaby p75 TTFB dla MISS, więc dokument, który w tej
 * nawigacji nie przeszedł przez sieć (`transferSize === 0` przy niezerowym
 * `decodedBodySize`), nie dostaje żadnego z trzech pól.
 *
 * ZERO IDENTYFIKATORÓW. Kolonia to kod lotniska centrum danych - ten sam,
 * który i tak jest publiczny w sufiksie `cf-ray` - i opisuje region, z
 * którego obsłużono dokument, nie osobę. Wiek wpisu (`nes-age`) i koszt bazy
 * (`db`) świadomie NIE jadą: podział HIT/MISS per colo ich nie potrzebuje,
 * a każdy kolejny klucz to bajty w każdej próbce.
 *
 * `BYPASS` BYWA ATRYBUTEM OSOBOWYM. NES Edge Cache omija cache m.in. przy ciasteczku
 * sesji `sb-*` i nagłówku `authorization` (`planDocumentCache`,
 * `src/lib/http/documentCache.ts`). Dziś sesja Supabase żyje w
 * `localStorage`, więc `BYPASS` na ścieżce publicznej to głównie
 * nieobsługiwane zapytanie - ale gdy sesja trafi do ciasteczka, `BYPASS` stanie
 * się pośrednikiem stanu zalogowania i u nielicznych redaktorów, razem ze
 * ścieżką i czasem, zawęzi populację. To nie identyfikator, ale panel ma
 * pokazywać wyłącznie agregaty z progiem minimalnej liczności, a notatka DPO
 * telemetrii RUM musi to wymieniać.
 *
 * INGEST. `/api/public/vitals` składa wiersz z białej listy kolumn, więc pola
 * trafią do `web_vitals` dopiero razem z kolumnami. Trasa, migracja i typy
 * to pozycja P1.0b planu PSI 85/95 (`faza2/PLAN-FALE-1-2.md`), która
 * walidację bierze ze słowników eksportowanych z tego pliku. Zewnętrzny
 * kolektor (`VITE_OBSERVABILITY_ENDPOINT`) dostaje pola od razu.
 */
interface VitalsEdgeContext {
  edgeCache?: VitalEdgeCache;
  edgeLayer?: VitalEdgeLayer;
  colo?: string;
}

/**
 * Znacznik „ta karta miała już nawigację". Trzyma DOSŁOWNIE `"1"` - nie ma tu
 * czego skorelować, a `sessionStorage` umiera razem z kartą, więc znacznik nie
 * przeżywa sesji przeglądania i nie jest trwałym identyfikatorem.
 */
const COLD_START_KEY = "nes:vitals:nav-seen";

/**
 * Opisowy kontekst odsłony - liczony RAZ na dokument (`readNavigationContext`).
 * Jedyne pola, które potem się zmieniają, to `coldStart` i `edge`: oba gasi
 * pierwsza miękka nawigacja (patrz `navContext`).
 */
interface VitalsNavigationContext {
  navigationType: VitalNavigationType | null;
  deviceMemory: VitalDeviceMemory | null;
  effectiveType: VitalEffectiveType | null;
  coldStart: boolean;
  /**
   * Stan cache dokumentu z `Server-Timing` - opisuje DOKUMENT, ale tylko jego
   * PIERWSZĄ trasę: gaśnie (`{}`) razem z `coldStart` (patrz `VitalsEdgeContext`).
   */
  edge: VitalsEdgeContext;
}

/** `navigator` z dwoma polami spoza standardowych typów DOM (oba opcjonalne). */
interface NavigatorWithHints extends Navigator {
  deviceMemory?: number;
  connection?: { effectiveType?: string };
}

/** One buffered sample, in the wire shape the ingest route reads. */
interface QueuedVital extends VitalMetric {
  url: string;
  ts: number;
  /**
   * Milisekundy od startu nawigacji do CHWILI ZGŁOSZENIA tej próbki
   * (`performance.now()`, czyli zegar liczony od `timeOrigin`).
   *
   * To NIE jest duplikat `value`: LCP o wartości 2 100 ms zgłoszone przy
   * `sinceNav` 2 300 należy do pierwszego malowania, a to samo LCP zgłoszone
   * przy `sinceNav` 180 000 pochodzi z miękkiej nawigacji po trzech minutach
   * czytania - i tylko pierwsze opisuje zimne wejście.
   */
  sinceNav?: number;
  navigationType?: VitalNavigationType | null;
  deviceMemory?: VitalDeviceMemory | null;
  effectiveType?: VitalEffectiveType | null;
  coldStart?: boolean;
  /** Stan cache dokumentu - patrz `VitalsEdgeContext`; brak pola = nieznany. */
  edgeCache?: VitalEdgeCache;
  edgeLayer?: VitalEdgeLayer;
  colo?: string;
  /** Wyłącznie próbka INP - patrz `InteractionRecord`; brak pola = nieznane. */
  inpEvent?: VitalInpEvent;
  inpPreHydration?: boolean;
  inpSinceLoad?: number;
  /** Wyłącznie `true`: brak pola = interakcja nie pierwsza albo nieznana. */
  inpFirst?: true;
}

/**
 * Safety net, not a hot path: with a synchronous drain at every boundary the
 * natural maximum is 5 (FCP+TTFB at init, LCP+CLS+INP at the next boundary).
 * The cap bounds memory when a boundary never arrives, and MUST stay <= the
 * ingest route's own MAX_METRICS or the tail of a batch is silently dropped.
 *
 * BUDŻET BAJTÓW. Ingest odrzuca ciało dłuższe niż `MAX_BODY` (8 000 znaków,
 * `src/routes/api/public/vitals.ts`) w całości, więc najgorsza próbka razy
 * ten limit musi się w nim mieścić - ze ścieżką przyciętą do `MAX_PATH`, ze
 * wszystkimi polami kontekstu, stanu cache i atrybucji INP naraz. Pilnuje
 * tego test „najgorszy batch mieści się w MAX_BODY" (dziś 7 229 znaków:
 * 901 na próbkę z kompletem pól, `inpFirst` i najdłuższymi zapisami liczb,
 * razy osiem). Zapas to ~770 znaków - kolejne pole w KAŻDEJ próbce trzeba
 * policzyć razy osiem.
 */
const MAX_METRICS = 8;
/** Coalescing window for the init-time FCP/TTFB pair only - see the docblock. */
const FLUSH_DELAY_MS = 0;
/**
 * Mirrors the ingest route's `slice(0, 512)`. Batching introduces a failure
 * mode single sends did not have - one oversized sample can push the body past
 * the server's MAX_BODY and take the WHOLE batch down - so the client bounds
 * the only unbounded field itself.
 */
const MAX_PATH = 512;

/**
 * OKNO SESYJNE CLS - przerwa, która je ZAMYKA. Specyfikacja Web Vitals grupuje
 * przesunięcia w okna: kolejne przesunięcie należy do bieżącego okna, dopóki
 * od poprzedniego minęło MNIEJ niż 1 s i od pierwszego w oknie mniej niż 5 s
 * (`CLS_SESSION_MAX_MS`). Metryką jest MAKSIMUM sum z okien - nie suma z
 * całego życia strony. Różnica nie jest kosmetyczna dla SPA: dwa niezależne
 * skupiska po 0,06 rozdzielone minutą to CLS 0,06 („good"), a nie 0,12
 * („needs-improvement"), więc długa sesja z sumą bez ograniczeń
 * SYSTEMATYCZNIE przeszacowuje metrykę - tym bardziej, im dłużej czytelnik
 * zostaje na stronie.
 */
const CLS_SESSION_GAP_MS = 1_000;
/** Maksymalny czas życia jednego okna sesyjnego CLS - druga granica ze spec. */
const CLS_SESSION_MAX_MS = 5_000;
/**
 * PERCENTYL INP - jedna odrzucona interakcja na każde 50. Specyfikacja nie
 * bierze najgorszej interakcji, a tę na pozycji `floor(liczba / 50)` w liście
 * uporządkowanej malejąco (przy 150 interakcjach odpadają trzy najgorsze,
 * przy mniej niż 50 - żadna, czyli tam percentyl DEGENERUJE do maksimum).
 * Powód: bez tego JEDEN wyjątkowy przypadek (zablokowany wątek przy
 * pierwszym kliknięciu, zimny cache, przełączenie karty w trakcie renderu)
 * definiuje metrykę całej odsłony - 600 ms wobec 50 ms, jakie czuje
 * użytkownik przez pozostałe 147 interakcji.
 */
const INP_INTERACTIONS_PER_DISCARD = 50;

/**
 * Typy zdarzeń, które `inpEvent` przepisuje dosłownie - pięć zdarzeń, które
 * Event Timing łączy w interakcje wskaźnika i klawiatury. Wszystko inne to
 * `"other"`: atrybucja ma być zgrubna, a kolumna - zamkniętą listą.
 */
const INP_EVENT_TYPES = ["pointerdown", "pointerup", "click", "keydown", "keyup"] as const;
type VitalInpEvent = (typeof INP_EVENT_TYPES)[number] | "other";
/** Komplet wartości `inpEvent` w ładunku - słownik walidacji ingestu (P1.0b). */
export const INP_EVENT_VALUES: readonly VitalInpEvent[] = [...INP_EVENT_TYPES, "other"];

/**
 * KONTRAKT `data-island-state` Z P1.6 (`HydrationIsland`) - jedno źródło dla
 * obu stron. Reporter czyta atrybut przez `closest()` w chwili
 * `pointerdown`/`keydown` (`onInteractionStart`) i rozpoznaje WYŁĄCZNIE
 * wartości z `ISLAND_STATES`. Pole `inpPreHydration` działa więc tylko wtedy,
 * gdy wyspa:
 *   1. renderuje atrybut JUŻ W HTML SSR, z wartością `pending`, na elemencie
 *      OBEJMUJĄCYM jej interaktywne potomki. Bez otoczki `closest()` nie ma
 *      czego znaleźć, a atrybut ustawiony dopiero w efekcie na kliencie gubi
 *      dokładnie interakcje sprzed hydratacji, dla których pole istnieje;
 *   2. przełącza go na `hydrated` dopiero po commicie granicy, nie przy
 *      wyzwoleniu bramki;
 *   3. nie wprowadza trzeciego stanu (np. `hydrating`) - nieznaną wartość
 *      reporter świadomie zamienia na brak pola.
 *
 * WIĄZANIE BEZ KOSZTU W CHUNKU WYSPY. Kod wyspy importuje stąd WYŁĄCZNIE typy
 * (`import type { IslandStateAttributes } from "@/lib/webVitals"`). Są
 * wymazywane, więc reporter nie trafia do grafu wyspy, a literówka w nazwie
 * atrybutu albo trzecia wartość w wyspie jest błędem kompilacji. Import
 * WARTOŚCI z tego modułu w kodzie wyspy wciągnąłby leniwy reporter do jej
 * chunku. Testy wyspy (SSR HTML z `pending` na otoczce, przejście na
 * `hydrated` po commicie) mogą importować `ISLAND_STATE_ATTR` i
 * `ISLAND_STATES` normalnie.
 */
export const ISLAND_STATE_ATTR = "data-island-state";
export const ISLAND_STATES = ["pending", "hydrated"] as const;
export type IslandState = (typeof ISLAND_STATES)[number];
/** Atrybut otoczki wyspy w kształcie propsów JSX (`<div {...attributes}>`). */
export type IslandStateAttributes = { readonly [K in typeof ISLAND_STATE_ATTR]: IslandState };
const ISLAND_SELECTOR = `[${ISLAND_STATE_ATTR}]`;
/**
 * Stan wyspy -> `inpPreHydration`. `Record` po `IslandState` wymusza decyzję
 * dla każdej wartości słownika - nowy stan bez niej nie skompiluje się.
 */
const PRE_HYDRATION_BY_STATE: Readonly<Record<IslandState, boolean>> = {
  pending: true,
  hydrated: false,
};

/** Zdarzenia OTWIERAJĄCE interakcję - na nich zapisujemy stan wyspy. */
const INTERACTION_START_EVENTS = ["pointerdown", "keydown"] as const;
/** Pierścień ostatnich startów interakcji - obserwer łączy je po czasie. */
const INTERACTION_STARTS_KEPT = 8;
/**
 * Najdłuższa przerwa między zapisanym startem a początkiem interakcji, jaką
 * jeszcze uznajemy za TĘ SAMĄ interakcję. Gdy wpis `pointerdown` jest krótszy
 * niż próg obserwera (40 ms), najwcześniejszym wpisem interakcji jest `click`
 * - przychodzi po czasie trzymania palca, czyli zwykle po ułamku sekundy.
 * Pięć sekund mieści długie przytrzymanie; dłuższa przerwa znaczy, że start
 * tej interakcji przepadł (np. przed zgodą) i rekord jest z innej.
 */
const INTERACTION_START_MAX_GAP_MS = 5_000;
/** Tolerancja porównania `timeStamp` zdarzenia ze `startTime` wpisu (zgrubnienie zegara). */
const INTERACTION_START_TOLERANCE_MS = 1;
/** Granica `inpSinceLoad`: doba, jak `sinceNav` w ingeście - dalej to już nie atrybucja. */
export const MAX_SINCE_LOAD_MS = 24 * 60 * 60 * 1_000;

const queue: QueuedVital[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Kontekst nawigacji tego DOKUMENTU - plus jedna flaga, która gaśnie wcześniej
 * niż dokument. Liczony raz, przy pierwszej udanej inicjalizacji.
 *
 * TRZY POLA OPISUJĄ DOKUMENT I MIĘKKA NAWIGACJA ICH NIE RUSZA.
 * `navigationType`, `deviceMemory` i `effectiveType` mówią o nawigacji, która
 * ZBUDOWAŁA dokument, a nie o ścieżce, na której akurat jesteśmy (tę niesie
 * `url`): przejście między trasami SPA nie zmienia ani typu tamtej nawigacji,
 * ani pamięci urządzenia, ani klasy łącza.
 *
 * `coldStart` JEST CZWARTY I GAŚNIE Z PIERWSZĄ MIĘKKĄ NAWIGACJĄ. Na zimno
 * otwiera się DOKUMENT, ale zimna jest w nim tylko PIERWSZA trasa - druga
 * i każda następna dostaje ciepły cache, wczytany JS i gotowy izolat. Gdyby
 * flaga trzymała się całego dokumentu, `WHERE cold_start` zlepiałoby zimne
 * pierwsze wejście z drugą, trzecią i czwartą nawigacją SPA tego samego
 * czytelnika, czyli z dokładnie tą populacją, od której ta kolumna ma je
 * ODCIĄĆ (audyt CWV, F40). `sinceNav` tego nie naprawia u odbiorcy, który
 * grupuje po samym booleanie. Zgaszenie siedzi w `markWebVitalsPage`, PO
 * zrzucie metryk poprzedniej trasy.
 *
 * STAN CACHE DOKUMENTU (`edge`) GAŚNIE RAZEM Z `coldStart`, w tym samym
 * miejscu: opisuje dokument, ale wpływa wyłącznie na metryki jego pierwszej
 * trasy (`VitalsEdgeContext`).
 *
 * TEARDOWN ZGODY KONTEKSTU NIE ZERUJE (stąd `??=` w `initWebVitals`) - i to
 * działa w obie strony. Ponowna zgoda w tej samej odsłonie nie może ogłosić
 * drugiego „zimnego startu": przeliczenie dałoby `false`, bo znacznik
 * `COLD_START_KEY` byłby już postawiony, więc jedna odsłona raportowałaby się
 * raz jako zimna, raz jako ciepła. Nie może też cofnąć zgaszenia - po miękkiej
 * nawigacji flaga jest `false` i ponowna inicjalizacja NIE wraca do `true`.
 */
let navContext: VitalsNavigationContext | null = null;

/** Wpis Navigation Timing dokumentu; brak API albo rzut -> `undefined`. */
function readNavigationEntry(): PerformanceNavigationTiming | undefined {
  try {
    return performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  } catch {
    return undefined;
  }
}

/** Typ nawigacji z Navigation Timing; nieznana wartość -> `null`, nie zgadujemy. */
function readNavigationType(
  nav: PerformanceNavigationTiming | undefined,
): VitalNavigationType | null {
  const type = nav?.type;
  return NAVIGATION_TYPES.find((known) => known === type) ?? null;
}

/**
 * Stan cache dokumentu, warstwa i colo z `serverTiming` wpisu nawigacji.
 * Każda niepewność (brak pola, nie-tablica, wpis bez napisu, wartość spoza
 * listy) kończy się BRAKIEM pola - nigdy rzutem: opis próbki nie może
 * zepsuć samego pomiaru.
 */
function readEdgeContext(nav: PerformanceNavigationTiming | undefined): VitalsEdgeContext {
  const edge: VitalsEdgeContext = {};
  if (servedFromLocalCache(nav)) return edge;
  let list: unknown;
  try {
    // Typ DOM obiecuje tablicę, ale nie każdy silnik wystawia to pole,
    // a atrapy wpisu w testach i polifille - wcale.
    list = nav?.serverTiming;
  } catch {
    return edge;
  }
  if (!Array.isArray(list)) return edge;
  const entries: readonly unknown[] = list.slice(0, MAX_SERVER_TIMING_ENTRIES);
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const name = "name" in entry ? entry.name : undefined;
    const description = "description" in entry ? entry.description : undefined;
    if (typeof name !== "string" || typeof description !== "string") continue;
    const desc = description.trim();
    if (name === "nes-edge" && edge.edgeCache === undefined) {
      const status = desc.toUpperCase();
      const known = EDGE_CACHE_STATUSES.find((candidate) => candidate === status);
      if (known !== undefined) edge.edgeCache = known;
    } else if (name === "nes-layer" && edge.edgeLayer === undefined) {
      const layer = desc.toLowerCase();
      const known = EDGE_LAYERS.find((candidate) => candidate.toLowerCase() === layer);
      if (known !== undefined) edge.edgeLayer = known;
    } else if (name === "colo" && edge.colo === undefined) {
      const code = desc.toUpperCase();
      if (COLO_RE.test(code)) edge.colo = code;
    }
  }
  return edge;
}

/**
 * Czy dokument w tej nawigacji NIE przeszedł przez sieć: zero bajtów transferu
 * przy niepustym ciele, czyli cache HTTP przeglądarki. `serverTiming` jest
 * wtedy odtworzony z zapisanej odpowiedzi (patrz `VitalsEdgeContext`). Zero
 * w OBU polach (silnik, który ich nie wystawia, ochrona przed odciskiem
 * palca) nie jest dowodem cache'u i pól nie gasi.
 */
function servedFromLocalCache(nav: PerformanceNavigationTiming | undefined): boolean {
  try {
    return (
      nav?.transferSize === 0 && typeof nav.decodedBodySize === "number" && nav.decodedBodySize > 0
    );
  } catch {
    return false;
  }
}

/** Próg pamięci urządzenia (kubełek W DÓŁ) albo `null`, gdy przeglądarka nie podaje. */
function readDeviceMemory(): VitalDeviceMemory | null {
  // STRAŻNIK `navigator`, nie ozdobnik. Ten moduł jest osiągalny z grafu
  // serwera (`observability/index.ts`), a `initWebVitals` woła ten kod ZANIM
  // dojdzie do jakiegokolwiek `report()` - czyli przed strażnikiem, który
  // chroni bufor. Bez tej linii pierwsze dotknięcie modułu po stronie serwera
  // rzucałoby `TypeError`, i to w kodzie, którego jedynym zadaniem jest
  // opisanie próbki.
  if (typeof navigator === "undefined") return null;
  const raw = (navigator as NavigatorWithHints).deviceMemory;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  // Lista jest malejąca, więc pierwszy próg <= wartości to kubełek w dół.
  // Wartość dodatnia poniżej 1 GB (spec dopuszcza 0,25 i 0,5) nie trafia
  // w żaden próg i domyka ją gałąź `raw > 0 ? 1`. Zero i wartość ujemna to
  // nie „bardzo słabe urządzenie", tylko brak pomiaru - stąd `null`.
  return DEVICE_MEMORY_BUCKETS.find((bucket) => raw >= bucket) ?? (raw > 0 ? 1 : null);
}

/** Klasa łącza z Network Information API; brak API albo nieznana klasa -> `null`. */
function readEffectiveType(): VitalEffectiveType | null {
  if (typeof navigator === "undefined") return null; // patrz `readDeviceMemory`
  const raw = (navigator as NavigatorWithHints).connection?.effectiveType;
  return EFFECTIVE_TYPES.find((known) => known === raw) ?? null;
}

/**
 * Czy to PIERWSZE wejście w tej karcie.
 *
 * Odpowiedź dotyczy DOKUMENTU. Zawężenie flagi do pierwszej TRASY tego
 * dokumentu robi `markWebVitalsPage`, gasząc `coldStart` w `navContext`.
 *
 * Mechanizm: brak znacznika w `sessionStorage` = nikt w tej karcie jeszcze nie
 * nawigował, więc dokument otwarto na zimno. Znacznik stawiamy od razu, więc
 * każde kolejne wczytanie w tej samej karcie zgłosi `false`.
 *
 * `sessionStorage` RZUCA, a nie zwraca `null`, gdy przeglądarka blokuje
 * magazyn (tryb prywatny Safari, polityka „zablokuj dane witryn", iframe
 * z partycjonowaniem). Rzut jest tu przechwytywany i sprowadzony do `false`:
 * zakładamy wtedy „to nie jest zimne wejście", bo fałszywe `true` ZAWYŻYŁOBY
 * populację zimnych wejść przy każdej odsłonie takiego czytelnika, a to
 * właśnie ta populacja ma być mierzona.
 *
 * ZNANE OBCIĄŻENIE, ŚWIADOME: znacznik stawiamy dopiero po zgodzie
 * analitycznej (ten moduł startuje zza jej bramki), więc czytelnik, który
 * zgodził się dopiero na trzeciej podstronie, zostanie policzony jako zimne
 * wejście. Alternatywa - pisanie do magazynu przed zgodą - jest gorsza:
 * magazyn nieistotny dla działania serwisu wymaga zgody tak samo jak beacon.
 */
function readColdStart(): boolean {
  try {
    if (typeof sessionStorage === "undefined") return false; // patrz `readDeviceMemory`
    if (sessionStorage.getItem(COLD_START_KEY) !== null) return false;
    sessionStorage.setItem(COLD_START_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

function readNavigationContext(): VitalsNavigationContext {
  const nav = readNavigationEntry();
  return {
    navigationType: readNavigationType(nav),
    deviceMemory: readDeviceMemory(),
    effectiveType: readEffectiveType(),
    coldStart: readColdStart(),
    edge: readEdgeContext(nav),
  };
}

/** Milisekundy od startu nawigacji; brak `performance` -> brak pola, nie zero. */
function elapsedSinceNavigation(): number | null {
  try {
    const now = performance.now();
    return Number.isFinite(now) && now >= 0 ? Math.round(now) : null;
  } catch {
    return null;
  }
}

function cancelScheduledDrain(): void {
  if (flushTimer === null) return;
  clearTimeout(flushTimer);
  flushTimer = null;
}

/** Send everything buffered as ONE beacon. No-op on an empty queue. */
function drain(): void {
  cancelScheduledDrain();
  if (queue.length === 0) return;
  // Splice before the transport check: there is no retry channel, so holding
  // samples an environment cannot send would only grow the buffer forever.
  const metrics = queue.splice(0, queue.length);
  // ONE beacon transport for the whole app (`sendBeaconPayload`): it already
  // guards a missing `navigator.sendBeacon` and swallows a throwing one, so
  // reporting still cannot break the page. `vitalsEndpoint()` keeps the RUM
  // fallback (`/api/public/vitals`) while honouring the shared external sink.
  sendBeaconPayload(vitalsEndpoint(), { metrics });
}

function scheduleDrain(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    drain();
  }, FLUSH_DELAY_MS);
}

/** Zgrubna atrybucja próbki INP w kształcie ładunku - patrz `InteractionRecord`. */
interface InpAttribution {
  inpEvent: VitalInpEvent;
  inpPreHydration?: boolean;
  inpSinceLoad?: number;
  inpFirst?: true;
}

function report(metric: VitalMetric, pathname: string, inp?: InpAttribution): void {
  if (import.meta.env.DEV) {
    if (inp === undefined) console.debug("[web-vitals]", pathname, metric);
    else console.debug("[web-vitals]", pathname, metric, inp);
    return;
  }
  // This module is reachable from the server graph (observability/index.ts).
  // Without this guard an SSR-side report() would push into a module-scope
  // array that never drains - a cross-request leak, not merely a memory one.
  if (typeof navigator === "undefined") return;
  const sample: QueuedVital = { ...metric, url: pathname.slice(0, MAX_PATH), ts: Date.now() };
  // Kontekst dokładamy TYLKO wtedy, gdy został policzony (czyli po
  // `initWebVitals`). Brak pola jest dla ingestu tym samym co `null`, więc
  // próbka bez kontekstu nadal jest pełnoprawną próbką - nie wysyłamy zer,
  // które udawałyby pomiar.
  if (navContext !== null) {
    const sinceNav = elapsedSinceNavigation();
    if (sinceNav !== null) sample.sinceNav = sinceNav;
    sample.navigationType = navContext.navigationType;
    sample.deviceMemory = navContext.deviceMemory;
    sample.effectiveType = navContext.effectiveType;
    sample.coldStart = navContext.coldStart;
    // Pola stanu cache - wyłącznie te, które nagłówek faktycznie podał.
    // Kopiowane polem po polu z jawnej listy, nie spreadem: do ładunku
    // trafia tylko to, co ten plik nazwał.
    const { edge } = navContext;
    if (edge.edgeCache !== undefined) sample.edgeCache = edge.edgeCache;
    if (edge.edgeLayer !== undefined) sample.edgeLayer = edge.edgeLayer;
    if (edge.colo !== undefined) sample.colo = edge.colo;
  }
  if (inp !== undefined) {
    sample.inpEvent = inp.inpEvent;
    if (inp.inpPreHydration !== undefined) sample.inpPreHydration = inp.inpPreHydration;
    if (inp.inpSinceLoad !== undefined) sample.inpSinceLoad = inp.inpSinceLoad;
    if (inp.inpFirst === true) sample.inpFirst = true;
  }
  queue.push(sample);
  if (queue.length >= MAX_METRICS) {
    drain();
    return;
  }
  scheduleDrain();
}

interface LayoutShiftEntry extends PerformanceEntry {
  hadRecentInput: boolean;
  value: number;
}

interface EventTimingEntry extends PerformanceEntry {
  interactionId?: number;
}

/**
 * ZGRUBNA ATRYBUCJA INP - jedna interakcja i cztery pola OPISOWE, które jej
 * próbka INP niesie w ładunku. Bez identyfikatorów: ani selektora celu, ani
 * tekstu, ani `interactionId` (licznik przeglądarki, zbędny po stronie bazy).
 *
 * PO CO. Plan PSI 85/95 przenosi pracę z okna ładowania na PIERWSZĄ
 * interakcję (kolejka po interakcji P0.3, wyspy hydratacji P1.6/P2.2/P2.3,
 * interaktywność banera zgód P1.3). Lighthouse tego nie zobaczy, a realny
 * czytelnik zapłaci to w INP - te pola mają odróżnić regres „przez pracę
 * przeniesioną na interakcję" od zwykłego wolnego handlera:
 *   - `inpEvent` - typ PIERWSZEGO z najdłuższych wpisów `event` interakcji,
 *     z listy `INP_EVENT_TYPES`, inaczej `"other"`. To „pierwsze zdarzenie
 *     najwolniejszej klatki", NIE handler, który wykonał pracę: wpisy jednej
 *     interakcji wysłane w tym samym zadaniu (`pointerup` i `click`) kończą
 *     się przy TYM SAMYM malowaniu, `duration` jest zaokrąglane do 8 ms,
 *     więc wcześniejszy wpis ma czas >= późniejszego, a remis wygrywa
 *     pierwszy. Tapnięcie raportuje więc zwykle `pointerup`/`pointerdown`,
 *     nawet gdy całą pracę robi handler `click` - `GROUP BY inp_event` dzieli
 *     interakcje na wskaźnik i klawiaturę, a nie wskazuje winnego zdarzenia;
 *   - `inpPreHydration` - czy interakcja ZACZĘŁA SIĘ na wyspie, która nie
 *     była jeszcze uwodniona (`data-island-state="pending"` najbliższej
 *     wyspy celu); `false` = wyspa była już `hydrated`; brak pola = cel poza
 *     wyspą albo start interakcji nieznany (np. sprzed zgody, z bufora);
 *   - `inpSinceLoad` - ms od startu zdarzenia `load` dokumentu do początku
 *     interakcji; UJEMNE = interakcja przed `load` (patrz `msSinceLoad`);
 *   - `inpFirst` - `true`, gdy to PIERWSZA interakcja DOKUMENTU (nie trasy);
 *     brak pola = późniejsza albo nieznana. Kolejka po interakcji (P0.3:
 *     powłoka zgód P1.3, wyspy, gtag P1.1) robi swoją pracę przy pierwszej
 *     interakcji, kiedykolwiek ona nastąpi. `inpSinceLoad` tego nie wydzieli
 *     (pierwsza interakcja 30 s po `load` i dziesiąta w tej samej chwili są
 *     nieodróżnialne), a `inpPreHydration` widzi wyłącznie wyspy, nie powłokę
 *     zgód ani gtag. Opis przy `firstInteractionStart`.
 *
 * DLACZEGO STAN WYSPY CZYTAMY W CHWILI ZDARZENIA, A NIE W OBSERWERZE. Wpis
 * `event` dociera do obserwera PO następnym malowaniu, a interakcja na
 * nieuwodnionej wyspie jest właśnie tym, co ją uwadnia - w obserwerze wyspa
 * bywa już `hydrated`, tym częściej, im dłuższa była interakcja. Odczyt
 * w obserwerze wpisywałby więc najgorsze przypadki do „po hydratacji".
 * Dlatego pasywny nasłuch `pointerdown`/`keydown` w fazie CAPTURE na
 * `window` (pierwszy w ścieżce zdarzenia, przed nasłuchem wyspy na jej
 * korzeniu) zapisuje stan w pierścieniu `interactionStarts`, a obserwer
 * łączy go z interakcją po czasie: `startTime` wpisu `event` to `timeStamp`
 * zdarzenia. Start zapisujemy przy KAŻDYM naciśnięciu użytkownika, także
 * poza wyspą - inaczej interakcja spoza wyspy dziedziczyłaby stan
 * poprzedniej - ale nie przy zdarzeniu syntetycznym (`isTrusted`).
 *
 * KOSZT. Jeden `closest()` na naciśnięcie (mikrosekundy) i pierścień ośmiu
 * rekordów; zero pracy, dopóki nikt nie klika.
 */
interface InteractionRecord {
  /** `interactionId` przeglądarki - tylko do dopasowania `first-input`, nie do ładunku. */
  id: number;
  /** Opóźnienie interakcji = najdłuższy z jej wpisów `event`. */
  latency: number;
  /** Typ pierwszego z najdłuższych wpisów - patrz `inpEvent` wyżej. */
  eventType: VitalInpEvent;
  /** Najwcześniejszy `startTime` wpisów tej interakcji = jej początek. */
  start: number;
  /** Stan wyspy w chwili początku interakcji; `null` = poza wyspą / nieznany. */
  preHydration: boolean | null;
  /**
   * `timeStamp` zdarzenia otwierającego (`pointerdown`/`keydown`) dopasowanego
   * z pierścienia; `null` = nieznany. Różni się od `start`, gdy otwierający
   * wpis był krótszy niż próg obserwera i najwcześniejszym wpisem jest `click`.
   */
  openedAt: number | null;
}

/** Start interakcji zapisany w chwili zdarzenia (`onInteractionStart`). */
interface InteractionStart {
  at: number;
  preHydration: boolean | null;
}

const interactionStarts: InteractionStart[] = [];

/** Typ zdarzenia z zamkniętej listy albo `"other"`. */
function inpEventType(name: string): VitalInpEvent {
  return INP_EVENT_TYPES.find((known) => known === name) ?? "other";
}

/** Stan najbliższej wyspy celu: `pending` -> true, `hydrated` -> false, reszta -> null. */
function islandStateOf(target: EventTarget | null): boolean | null {
  if (typeof Element === "undefined" || !(target instanceof Element)) return null;
  try {
    const state = target.closest(ISLAND_SELECTOR)?.getAttribute(ISLAND_STATE_ATTR);
    // Słownik P1.6 to dokładnie `ISLAND_STATES`. Nieznanej wartości nie
    // zgadujemy w żadną stronę - fałszywe `false` ukryłoby regres, a fałszywe
    // `true` przypisałoby go wyspom.
    const known = ISLAND_STATES.find((candidate) => candidate === state);
    return known === undefined ? null : PRE_HYDRATION_BY_STATE[known];
  } catch {
    return null;
  }
}

function onInteractionStart(event: Event): void {
  // Wyłącznie naciśnięcia użytkownika. `dispatchEvent` biblioteki między
  // `pointerdown` a `click` przesunąłby dopasowanie po czasie na rekord,
  // który nie opisuje żadnego gestu (`isTrusted === false`).
  if (!event.isTrusted) return;
  interactionStarts.push({ at: event.timeStamp, preHydration: islandStateOf(event.target) });
  if (interactionStarts.length > INTERACTION_STARTS_KEPT) interactionStarts.shift();
}

/**
 * Zapisany start interakcji zaczętej w `start`: najpóźniejszy rekord nie
 * późniejszy niż `start` (pierścień jest chronologiczny), o ile nie jest
 * starszy niż `INTERACTION_START_MAX_GAP_MS`; inaczej `null`.
 */
function startRecordAt(start: number): InteractionStart | null {
  for (let index = interactionStarts.length - 1; index >= 0; index -= 1) {
    const record = interactionStarts[index];
    if (record === undefined || record.at > start + INTERACTION_START_TOLERANCE_MS) continue;
    return start - record.at <= INTERACTION_START_MAX_GAP_MS ? record : null;
  }
  return null;
}

/**
 * PIERWSZA INTERAKCJA DOKUMENTU (`inpFirst`). Najwcześniejszy znany początek
 * interakcji w tym DOKUMENCIE: minimum z wpisu `first-input` i z każdego
 * wpisu `event` z `interactionId`. `first-input` jest buforowany BEZ progu
 * czasu, więc widzi także interakcję sprzed zgody i krótszą niż 40 ms, której
 * wpisów `event` obserwer nie dostanie nigdy (bufor typu `event` trzyma tylko
 * wpisy >= 104 ms, a na żywo obowiązuje próg 40 ms).
 *
 * ŻYJE DŁUŻEJ NIŻ TRASA. `resetAccumulators` (miękka nawigacja) go nie
 * zeruje: druga trasa nie ma własnej „pierwszej interakcji", a kliknięcie,
 * które wywołało miękką nawigację, dociera do obserwera już po niej. Zeruje
 * go teardown zgody, a ponowna inicjalizacja odzyskuje go z bufora
 * `first-input`.
 *
 * DOPASOWANIE (`isFirstInteraction`). Gdy wpis `first-input` niesie
 * `interactionId` (> 0), decyduje równość identyfikatorów. Inaczej decyduje
 * czas, z tolerancją `INTERACTION_START_TOLERANCE_MS`: z tym minimum musi się
 * zgadzać początek interakcji (`start`) albo jej zdarzenie otwierające
 * z pierścienia (`openedAt` - gdy `pointerdown` był krótszy niż próg
 * i najwcześniejszym wpisem jest `click`). Niepewność kończy się brakiem
 * pola, nie zgadywaniem.
 */
let firstInteractionStart: number | null = null;
/** `interactionId` wpisu `first-input`, gdy przeglądarka go podaje (> 0). */
let firstInteractionId: number | null = null;

function noteDocumentInteraction(start: number): void {
  if (!Number.isFinite(start)) return;
  if (firstInteractionStart === null || start < firstInteractionStart) {
    firstInteractionStart = start;
  }
}

function noteFirstInput(entry: EventTimingEntry): void {
  noteDocumentInteraction(entry.startTime);
  const id = entry.interactionId;
  if (typeof id === "number" && id > 0) firstInteractionId = id;
}

function isFirstInteraction(record: InteractionRecord): boolean {
  if (firstInteractionId !== null) return record.id === firstInteractionId;
  const first = firstInteractionStart;
  if (first === null) return false;
  const near = (at: number): boolean => Math.abs(at - first) <= INTERACTION_START_TOLERANCE_MS;
  return near(record.start) || (record.openedAt !== null && near(record.openedAt));
}

/**
 * Ms od startu `load` dokumentu do `start`; ujemne = przed `load`.
 *
 * `load` JESZCZE NIE NASTĄPIŁ (`loadEventStart === 0` w chwili zrzutu, np.
 * miękka nawigacja kliknięta w trakcie ładowania na wolnym telefonie):
 * odniesieniem jest TERAZ, bo `load` będzie najwcześniej teraz. Wynik jest
 * wtedy ujemny jak prawdziwa wartość, tylko co do modułu jej dolną granicą -
 * zapytanie „interakcje przed `load`" (`< 0`) i każdy próg dodatni klasyfikują
 * taką próbkę poprawnie, a pominięcie pola wycięłoby z rozkładu właśnie
 * interakcje z czasu bootu. Brak Navigation Timing = brak pola, nie zgadujemy.
 */
function msSinceLoad(start: number): number | null {
  const loadStart = readNavigationEntry()?.loadEventStart;
  if (typeof loadStart !== "number" || !Number.isFinite(loadStart) || loadStart < 0) return null;
  const reference = loadStart > 0 ? loadStart : elapsedSinceNavigation();
  if (reference === null) return null;
  const delta = Math.round(start - reference);
  return Number.isFinite(delta) && Math.abs(delta) <= MAX_SINCE_LOAD_MS ? delta : null;
}

function inpAttribution(record: InteractionRecord): InpAttribution {
  const attribution: InpAttribution = { inpEvent: record.eventType };
  if (record.preHydration !== null) attribution.inpPreHydration = record.preHydration;
  const sinceLoad = msSinceLoad(record.start);
  if (sinceLoad !== null) attribution.inpSinceLoad = sinceLoad;
  // Liczone przy ZRZUCIE, nie przy wpisie: buforowany `first-input` może
  // dotrzeć po pierwszym wpisie `event` i dopiero wtedy obniżyć minimum.
  if (isFirstInteraction(record)) attribution.inpFirst = true;
  return attribution;
}

// Per-page accumulators. Reset on soft navigation via `markWebVitalsPage`.
let currentPath = "/";
let lcpValue = 0;
/** RAPORTOWANY CLS: maksimum z sum okien sesyjnych widzianych na tej ścieżce. */
let clsValue = 0;
/** Suma przesunięć BIEŻĄCEGO okna sesyjnego. */
let clsWindowValue = 0;
/** `startTime` pierwszego i ostatniego przesunięcia bieżącego okna. */
let clsWindowStart = 0;
let clsWindowLast = 0;
/** Czy okno jest otwarte - osobna flaga, bo 0 jest poprawną sumą okna. */
let clsWindowOpen = false;
/**
 * Każda interakcja na tej ścieżce, po `interactionId` - jej opóźnienie
 * i zgrubna atrybucja (`InteractionRecord`).
 *
 * GRUPOWANIE JEST CZĘŚCIĄ DEFINICJI, nie optymalizacją: jedna interakcja
 * (pointerdown, pointerup, click) daje KILKA wpisów `event` z tym samym
 * `interactionId`, a jej opóźnieniem jest najdłuższy z nich. Liczenie wpisów
 * zamiast interakcji zawyżałoby mianownik percentyla i odrzucało za dużo.
 *
 * Mapa rośnie o jeden wpis na interakcję i jest czyszczona przy miękkiej
 * nawigacji (`resetAccumulators`) - jej rozmiar ogranicza więc liczba gestów
 * w obrębie JEDNEJ odsłony, nie długość sesji.
 */
const interactions = new Map<number, InteractionRecord>();

// CO JUŻ ZOSTAŁO ZARAPORTOWANE dla `currentPath` - stan PER METRYKA, nie jedna
// wspólna zapadka.
//
// DEFEKT, KTÓRY TO ZASTĘPUJE. Stała tu jedna flaga `flushed`: pierwszy flush
// ustawiał ją na `true`, a czyściło ją wyłącznie `resetAccumulators()`, wołane
// tylko z `markWebVitalsPage` (nawigacja miękka). Przebieg, który to gubi:
// czytelnik wchodzi na artykuł -> przełącza kartę (`visibilitychange` ->
// hidden) -> flush, zapadka zamknięta -> wraca i czyta dalej TĘ SAMĄ stronę
// (CLS rośnie przy każdym doładowanym obrazku, INP przy każdej interakcji) ->
// zamyka kartę (`pagehide`) -> `flushCurrent` wychodzi w pierwszej linii.
// Wszystko, co narosło po pierwszym przełączeniu karty, przepadało W CISZY, a
// ścieżka zostawała głucha na stałe (kolejne cykle ukrycia też nie raportują).
//
// LCP jest jednorazowe z definicji (największe malowanie jest finalne) - i tam
// zapadka była POPRAWNA. CLS (maksimum z okien sesyjnych) i INP (percentyl
// opóźnień interakcji) narastają w trakcie odsłony i nie mogą dzielić z nim
// jednej flagi.
//
// DLACZEGO WARTOŚĆ SKUMULOWANA, A NIE PRZYROST. Wiersz w `web_vitals` niesie
// WŁASNĄ ocenę good/needs-improvement/poor (`rate()` niżej), a
// `aggregateVitals` liczy p75 po SUROWYCH wierszach i ufa tej ocenie
// (`src/lib/observability/aggregate.ts`). Ingest nie zapisuje `id`, więc nic po
// stronie serwera nie umie scalić wierszy jednej odsłony. Przyrost byłby zatem
// fragmentem, którego nie da się ocenić: strona o realnym CLS 0,4 („poor")
// rozbita na cztery przyrosty po 0,1 dałaby CZTERY wiersze „good" i ZERO
// „poor", a prawdziwa wartość nie pojawiłaby się w populacji p75 ani razu -
// czyli zniknąłby dokładnie ten ogon rozkładu, dla którego p75 się liczy.
// Wartość skumulowana, wysyłana PONOWNIE TYLKO GDY UROSŁA, kładzie w bazie
// zawsze największą, finalną liczbę. Koszt, świadomie przyjęty: odsłona z
// dwoma flushami zostawia dwa wiersze CLS (np. 0,05 i 0,11), więc `count`
// zawyża liczbę odsłon, a p75 dostaje kilka próbek z dolnej strony. To błąd
// mniejszy niż gubienie maksimum - a warunek „tylko gdy urosło" nie pozwala
// serii ukryć/powrotów zalać ingestu identycznymi wierszami.
//
// INP A WARUNEK „TYLKO GDY UROSŁO". Percentyl - inaczej niż maksimum - może
// SPAŚĆ w trakcie odsłony: przekroczenie 50. interakcji przesuwa wskaźnik na
// drugą najgorszą i wartość maleje. Wysyłamy nadal wyłącznie wzrost, więc w
// bazie zostaje najwyższy percentyl, jaki ta odsłona kiedykolwiek miała.
// Świadomy wybór: dosłanie SPADKU dołożyłoby wiersz „good" do tej samej
// odsłony i zjechałoby p75 w dół - dokładnie ta strata ogona, przed którą
// broni akapit wyżej.
let lcpReported = false;
/** Ostatnio zaraportowany CLS; -1 znaczy „jeszcze nic", bo 0 jest poprawną wartością. */
let clsReported = -1;
/** Ostatnio zaraportowany INP; 0 jest naturalnym „jeszcze nic" (INP > 0 zawsze). */
let inpReported = 0;

/**
 * Dołóż przesunięcie do bieżącego okna sesyjnego albo otwórz nowe.
 *
 * Przesunięcia PO ŚWIEŻEJ INTERAKCJI (`hadRecentInput`) tu nie docierają, więc
 * nie wpływają ani na sumę okna, ani na jego granice czasowe - zgodnie ze
 * specyfikacją są dla CLS niebyłe.
 */
function addLayoutShift(value: number, startTime: number): void {
  const continuesWindow =
    clsWindowOpen &&
    startTime - clsWindowLast < CLS_SESSION_GAP_MS &&
    startTime - clsWindowStart < CLS_SESSION_MAX_MS;
  if (continuesWindow) {
    clsWindowValue += value;
    clsWindowLast = startTime;
  } else {
    clsWindowOpen = true;
    clsWindowValue = value;
    clsWindowStart = startTime;
    clsWindowLast = startTime;
  }
  // Metryką jest MAKSIMUM z okien, więc raportowana wartość nigdy nie maleje -
  // to ona (a nie suma bieżącego okna) jest wartością SKUMULOWANĄ odsłony.
  if (clsWindowValue > clsValue) clsValue = clsWindowValue;
}

/**
 * Zapamiętaj interakcję: jej opóźnieniem jest NAJDŁUŻSZE z jej zdarzeń, typem
 * zdarzenia - typ pierwszego z najdłuższych (remis nie przepisuje typu),
 * a początkiem - najwcześniejszy wpis.
 */
function addInteraction(interactionId: number, entry: EventTimingEntry): void {
  noteDocumentInteraction(entry.startTime);
  const known = interactions.get(interactionId);
  if (known === undefined) {
    const opening = startRecordAt(entry.startTime);
    interactions.set(interactionId, {
      id: interactionId,
      latency: entry.duration,
      eventType: inpEventType(entry.name),
      start: entry.startTime,
      preHydration: opening?.preHydration ?? null,
      openedAt: opening?.at ?? null,
    });
    return;
  }
  if (entry.duration > known.latency) {
    known.latency = entry.duration;
    known.eventType = inpEventType(entry.name);
  }
  if (entry.startTime < known.start) {
    const opening = startRecordAt(entry.startTime);
    known.start = entry.startTime;
    known.preHydration = opening?.preHydration ?? null;
    known.openedAt = opening?.at ?? null;
  }
}

/**
 * Interakcja wyznaczająca bieżący INP: percentyl opóźnień (`null`, dopóki
 * żadnej nie było). Atrybucja opisuje TĘ interakcję, nie ostatnią.
 *
 * Sortowanie biegnie w chwili ZRZUTU, a nie przy każdym wpisie - granic jest
 * kilka na odsłonę, a wpisów `event` tysiące.
 */
function currentInpInteraction(): InteractionRecord | null {
  const count = interactions.size;
  if (count === 0) return null;
  const byLatencyDesc = [...interactions.values()].sort((a, b) => b.latency - a.latency);
  const index = Math.min(count - 1, Math.floor(count / INP_INTERACTIONS_PER_DISCARD));
  return byLatencyDesc[index] ?? null;
}

function flushCurrent(pathname: string): void {
  if (lcpValue > 0 && !lcpReported) {
    lcpReported = true;
    report({ name: "LCP", value: lcpValue, rating: rate("LCP", lcpValue), id: uid() }, pathname);
  }
  // Only report CLS if any shift was observed or LCP fired (avoid flooding 0s).
  if (clsValue > clsReported && (clsValue > 0 || lcpValue > 0)) {
    clsReported = clsValue;
    report({ name: "CLS", value: clsValue, rating: rate("CLS", clsValue), id: uid() }, pathname);
  }
  const inp = currentInpInteraction();
  if (inp !== null && inp.latency > inpReported) {
    const inpValue = inp.latency;
    inpReported = inpValue;
    report(
      { name: "INP", value: inpValue, rating: rate("INP", inpValue), id: uid() },
      pathname,
      inpAttribution(inp),
    );
  }
}

function resetAccumulators(): void {
  lcpValue = 0;
  clsValue = 0;
  clsWindowValue = 0;
  clsWindowStart = 0;
  clsWindowLast = 0;
  clsWindowOpen = false;
  // Pierścień startów (`interactionStarts`) zostaje: kliknięcie, które wywołało
  // tę miękką nawigację, dociera do obserwera PO niej i potrzebuje swojego startu.
  // Pierwsza interakcja (`firstInteractionStart`) też zostaje - opisuje DOKUMENT.
  interactions.clear();
  lcpReported = false;
  clsReported = -1;
  inpReported = 0;
}

/**
 * Notify the reporter that the user navigated (soft nav). Flushes the metrics
 * accumulated for the previous path, then resets counters for the new path.
 * Safe to call with the same path twice.
 *
 * Ta funkcja jest też JEDYNYM miejscem, w którym gaśnie `coldStart`: zimna
 * jest pierwsza trasa dokumentu, nie cały dokument (patrz `navContext`).
 */
export function markWebVitalsPage(pathname: string): void {
  if (typeof window === "undefined") return;
  if (pathname === currentPath) return;
  flushCurrent(currentPath);
  // Drain HERE rather than on the timer: a route change is a real batch
  // boundary and the three samples were just enqueued in one sync block.
  drain();
  // ZIMNY START GAŚNIE DOKŁADNIE TUTAJ: PO zrzucie poprzedniej trasy, PRZED
  // pierwszą próbką nowej. `report()` KOPIUJE kontekst do próbki w chwili
  // zgłoszenia, więc wszystko, co `flushCurrent` wyżej zakolejkowało, ma już
  // wpisane `coldStart` poprzedniej trasy (dla pierwszej: `true`) i ta linia
  // tego nie przepisuje; zgaszenie flagi WYŻEJ kazałoby jedynej naprawdę
  // zimnej trasie zaraportować się jako ciepła. Tak samo i z tego samego
  // powodu gaśnie stan cache dokumentu (`edge`): oba opisują wyłącznie
  // pierwszą trasę. Pozostałe trzy pola opisują DOKUMENT i urządzenie, więc
  // miękka nawigacja ich nie zmienia.
  if (navContext !== null) {
    navContext = { ...navContext, coldStart: false, edge: {} };
  }
  currentPath = pathname;
  resetAccumulators();
}

export function initWebVitals(): () => void {
  const noop = () => {};
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return noop;
  if ((window as Window & { __vitalsInit?: boolean }).__vitalsInit) return noop;
  (window as Window & { __vitalsInit?: boolean }).__vitalsInit = true;

  currentPath = location.pathname;

  // Kontekst nawigacji MUSI powstać tutaj, a nie przy pierwszym `report()`:
  // `coldStart` czyta i STAWIA znacznik w `sessionStorage`, więc policzony
  // leniwie zwracałby „zimne wejście" dla dokumentu, który zdążył już zrobić
  // twardą nawigację. `??=` sprawia, że ponowna zgoda w tej samej odsłonie
  // nie przelicza kontekstu (patrz komentarz przy deklaracji).
  navContext ??= readNavigationContext();

  // Rejestr obserwerow do rozlaczenia przy teardownie (cofniecie zgody RODO).
  const observers: PerformanceObserver[] = [];

  // LCP - keep last entry per page.
  try {
    const lcpObs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) lcpValue = last.startTime;
    });
    lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
    observers.push(lcpObs);
  } catch {
    /* unsupported */
  }

  // CLS - maksimum z okien sesyjnych, bez przesunięć po świeżej interakcji.
  try {
    const clsObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as LayoutShiftEntry[]) {
        if (!e.hadRecentInput) addLayoutShift(e.value, e.startTime);
      }
    });
    clsObs.observe({ type: "layout-shift", buffered: true });
    observers.push(clsObs);
  } catch {
    /* unsupported */
  }

  // INP - percentyl opóźnień interakcji; wpisy bez `interactionId` (czyste
  // zdarzenia, np. pointermove) nie są interakcjami i nie wchodzą do puli.
  try {
    const inpObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as EventTimingEntry[]) {
        // `first-input` NIE wchodzi do puli INP (ta zostaje przy progu 40 ms):
        // wyznacza wyłącznie pierwszą interakcję dokumentu dla `inpFirst`.
        if (e.entryType === "first-input") noteFirstInput(e);
        else if (e.interactionId) addInteraction(e.interactionId, e);
      }
    });
    inpObs.observe({
      type: "event",
      buffered: true,
      durationThreshold: 40,
    } as PerformanceObserverInit);
    observers.push(inpObs);
    // Pierwsza interakcja dokumentu (`firstInteractionStart`). Osobny `try`:
    // brak typu `first-input` nie może zabrać pomiaru INP - zostaje wtedy
    // najwcześniejszy zaobserwowany wpis `event`.
    try {
      inpObs.observe({ type: "first-input", buffered: true });
    } catch {
      /* unsupported */
    }
  } catch {
    /* unsupported */
  }

  // Flush accumulators on tab hide / page unload. `pagehide` covers bfcache
  // navigations that skip `visibilitychange`.
  const onHide = () => {
    if (document.visibilityState === "hidden" || document.visibilityState === undefined) {
      flushCurrent(currentPath);
      drain();
    }
  };
  const onPageHide = () => {
    flushCurrent(currentPath);
    drain();
  };
  addEventListener("visibilitychange", onHide);
  addEventListener("pagehide", onPageHide);
  // Start interakcji dla atrybucji INP (`InteractionRecord`): CAPTURE na
  // `window`, żeby stan wyspy przeczytać PRZED jej własnym nasłuchem;
  // pasywnie, bo nasłuch niczego nie blokuje ani nie odwołuje.
  for (const type of INTERACTION_START_EVENTS) {
    addEventListener(type, onInteractionStart, { capture: true, passive: true });
  }

  // FCP + TTFB from Paint / Navigation Timing - only meaningful on the initial
  // hard load. Attribute to whatever the initial pathname is.
  try {
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    if (fcp) {
      report(
        { name: "FCP", value: fcp.startTime, rating: rate("FCP", fcp.startTime), id: uid() },
        currentPath,
      );
    }
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    if (nav) {
      const ttfb = nav.responseStart;
      report({ name: "TTFB", value: ttfb, rating: rate("TTFB", ttfb), id: uid() }, currentPath);
    }
  } catch {
    /* unsupported */
  }

  // Teardown: cofniecie zgody analitycznej musi FAKTYCZNIE zatrzymac pomiar -
  // rozlaczamy obserwery, zdejmujemy listenery flush i zwalniamy flage, zeby
  // ponowne wyrazenie zgody moglo re-zainicjalizowac web-vitals.
  return () => {
    for (const obs of observers) {
      try {
        obs.disconnect();
      } catch {
        /* ignore */
      }
    }
    removeEventListener("visibilitychange", onHide);
    removeEventListener("pagehide", onPageHide);
    for (const type of INTERACTION_START_EVENTS) {
      removeEventListener(type, onInteractionStart, { capture: true });
    }
    // Starty zapisane przed cofnięciem zgody nie mogą opisać interakcji po niej.
    // Pierwszą interakcję ponowna inicjalizacja odzyska z bufora `first-input`.
    interactionStarts.length = 0;
    firstInteractionStart = null;
    firstInteractionId = null;
    // Consent withdrawn: cancel the pending drain and DROP what is buffered.
    // A stray timer firing after teardown would beacon samples AFTER the user
    // revoked analytics consent - exactly what this teardown exists to stop.
    cancelScheduledDrain();
    queue.length = 0;
    (window as Window & { __vitalsInit?: boolean }).__vitalsInit = false;
  };
}
