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
 * Znacznik „ta karta miała już nawigację". Trzyma DOSŁOWNIE `"1"` - nie ma tu
 * czego skorelować, a `sessionStorage` umiera razem z kartą, więc znacznik nie
 * przeżywa sesji przeglądania i nie jest trwałym identyfikatorem.
 */
const COLD_START_KEY = "nes:vitals:nav-seen";

/** Opisowy kontekst odsłony - liczony RAZ na dokument, patrz `readNavigationContext`. */
interface VitalsNavigationContext {
  navigationType: VitalNavigationType | null;
  deviceMemory: VitalDeviceMemory | null;
  effectiveType: VitalEffectiveType | null;
  coldStart: boolean;
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
}

/**
 * Safety net, not a hot path: with a synchronous drain at every boundary the
 * natural maximum is 5 (FCP+TTFB at init, LCP+CLS+INP at the next boundary).
 * The cap bounds memory when a boundary never arrives, and MUST stay <= the
 * ingest route's own MAX_METRICS or the tail of a batch is silently dropped.
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

const queue: QueuedVital[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Kontekst nawigacji tego DOKUMENTU. Liczony raz, przy pierwszej udanej
 * inicjalizacji, i celowo NIE zerowany przy miękkiej nawigacji: opisuje
 * nawigację, która zbudowała dokument, a nie ścieżkę, na której akurat
 * jesteśmy (tę niesie `url`). Nie zeruje go też teardown zgody - ponowne
 * wyrażenie zgody w tej samej odsłonie nie może ogłosić drugiego „zimnego
 * startu", bo znacznik `COLD_START_KEY` byłby już postawiony i `coldStart`
 * przeskoczyłby z `true` na `false` w połowie tej samej odsłony.
 */
let navContext: VitalsNavigationContext | null = null;

/** Typ nawigacji z Navigation Timing; nieznana wartość -> `null`, nie zgadujemy. */
function readNavigationType(): VitalNavigationType | null {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    const type = nav?.type;
    return NAVIGATION_TYPES.find((known) => known === type) ?? null;
  } catch {
    return null;
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
  return {
    navigationType: readNavigationType(),
    deviceMemory: readDeviceMemory(),
    effectiveType: readEffectiveType(),
    coldStart: readColdStart(),
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

function report(metric: VitalMetric, pathname: string): void {
  if (import.meta.env.DEV) {
    console.debug("[web-vitals]", pathname, metric);
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
 * Opóźnienie każdej interakcji na tej ścieżce, po `interactionId`.
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
const interactionLatencies = new Map<number, number>();

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

/** Zapamiętaj interakcję: jej opóźnieniem jest NAJDŁUŻSZE z jej zdarzeń. */
function addInteraction(interactionId: number, duration: number): void {
  const known = interactionLatencies.get(interactionId);
  if (known === undefined || duration > known) interactionLatencies.set(interactionId, duration);
}

/**
 * Bieżący INP: percentyl opóźnień interakcji (0, dopóki żadnej nie było).
 *
 * Sortowanie biegnie w chwili ZRZUTU, a nie przy każdym wpisie - granic jest
 * kilka na odsłonę, a wpisów `event` tysiące.
 */
function currentInp(): number {
  const count = interactionLatencies.size;
  if (count === 0) return 0;
  const byLatencyDesc = [...interactionLatencies.values()].sort((a, b) => b - a);
  const index = Math.min(count - 1, Math.floor(count / INP_INTERACTIONS_PER_DISCARD));
  return byLatencyDesc[index] ?? 0;
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
  const inpValue = currentInp();
  if (inpValue > inpReported) {
    inpReported = inpValue;
    report({ name: "INP", value: inpValue, rating: rate("INP", inpValue), id: uid() }, pathname);
  }
}

function resetAccumulators(): void {
  lcpValue = 0;
  clsValue = 0;
  clsWindowValue = 0;
  clsWindowStart = 0;
  clsWindowLast = 0;
  clsWindowOpen = false;
  interactionLatencies.clear();
  lcpReported = false;
  clsReported = -1;
  inpReported = 0;
}

/**
 * Notify the reporter that the user navigated (soft nav). Flushes the metrics
 * accumulated for the previous path, then resets counters for the new path.
 * Safe to call with the same path twice.
 */
export function markWebVitalsPage(pathname: string): void {
  if (typeof window === "undefined") return;
  if (pathname === currentPath) return;
  flushCurrent(currentPath);
  // Drain HERE rather than on the timer: a route change is a real batch
  // boundary and the three samples were just enqueued in one sync block.
  drain();
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
        if (e.interactionId) addInteraction(e.interactionId, e.duration);
      }
    });
    inpObs.observe({
      type: "event",
      buffered: true,
      durationThreshold: 40,
    } as PerformanceObserverInit);
    observers.push(inpObs);
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
    // Consent withdrawn: cancel the pending drain and DROP what is buffered.
    // A stray timer firing after teardown would beacon samples AFTER the user
    // revoked analytics consent - exactly what this teardown exists to stop.
    cancelScheduledDrain();
    queue.length = 0;
    (window as Window & { __vitalsInit?: boolean }).__vitalsInit = false;
  };
}
