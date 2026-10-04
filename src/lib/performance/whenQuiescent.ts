// Jeden globalny punkt ciszy strony: `onQuiescent(task, {priority})`.
//
// PO CO. Część pracy po załadowaniu nie ma wyzwalacza od użytkownika i musi
// mieć zapas „kiedy strona się uspokoi": gtag bez interakcji (P1.1),
// interaktywny baner zgód w ostateczności (P1.3), nakładki i import
// `cacheBusting`, wyspy hydratacji (P1.6, P2.x). Każdy z własnym oknem ciszy
// tworzy KASKADĘ (krytyka planu M11): konsument A startuje, pobiera skrypt, a
// to żądanie przesuwa 5-sekundowe okno konsumenta B; B pobiera swoje i
// przesuwa okno C. gtag strzelałby wtedy zwykle dopiero na limicie. Tutaj
// detektor jest JEDEN na dokument, a konsumenci tylko się w nim zapisują:
// wszyscy zapisani przed punktem ciszy startują w TYM SAMYM punkcie, przez
// `postInteractionQueue` (jedno zadanie na klatkę, w kolejności klas
// priorytetu - gtag ostatni). Punkt jest zatrzaskiem: konsument zapisany po
// nim trafia do kolejki od razu, bez nowego okna.
//
// DEFINICJA CISZY.
//   cisza = max(koniec ostatniego `longtask`, koniec ostatniego LICZONEGO
//               wpisu `resource`, `load`, powrót karty do widoczności)
//   punkt  = widoczna karta, co najmniej QUIESCENCE_MIN_AFTER_LOAD_MS po `load`
//            ORAZ co najmniej QUIESCENCE_WINDOW_MS od ciszy;
//   limit  = QUIESCENCE_CAP_MS po `load` - punkt zapada mimo pracy strony
//            (strona produkująca zadania bez końca nie zagłodzi konsumentów),
//            TAKŻE w karcie ukrytej (werdykt TP-1: karta otwarta w tle i
//            zamknięta bez oglądania też ma wysłać `page_view`).
// `load`, który nie przychodzi (wiszący zasób obcy), zastępuje po
// QUIESCENCE_LOAD_DEADLINE_MS od początku nawigacji ten sam zapas, co w
// `afterPageLoad` i `gtagLoadPolicy`. Sprawdzanie: `setTimeout(max(250,
// brakujący czas))`, nie pętla `requestIdleCallback` (rIC głodzi się na
// zajętym wątku). Ukryta karta: okno stoi (sprawdzamy tylko limit), a po
// powrocie do widoczności liczy się od nowa. Safari nie zna `longtask`: tam
// decyduje cisza zasobów plus minimum po `load`; bez `PerformanceObserver` -
// samo minimum. Strona prerenderowana (Speculation Rules) nie liczy niczego
// przed aktywacją, a `load` sprzed aktywacji liczy się od aktywacji.
//
// IGNOROWANE ZASOBY (nie przesuwają okna):
//  - `initiatorType === "img"` rozpoczęte po `load`: leniwe obrazy i kolejne
//    slajdy autoodtwarzania (co 4,5-5,5 s - bez tego cisza nie zapadłaby nigdy
//    przed limitem); obraz zaczęty PRZED `load` liczy się normalnie;
//  - `/api/public/version` - sondowanie `cacheBusting` (pierwsze ~+8 s);
//  - `/~flock.js` i jego punkt zbiorczy `/~api/analytics` - analityka hostingu
//    wstrzykiwana za naszym Workerem;
//  - domeny Google (tag, kolekcja, reklamy) - gtag po interakcji nie może
//    przesuwać okna pozostałym konsumentom;
//  - wzorce zgłoszone przez konsumentów `registerOwnedRequest(pattern)`.
// Lista jest wąska celowo: zasób zignorowany tutaj, a widoczny dla
// Lighthouse'a, mógłby wpuścić konsumenta do śladu (test z autoodtwarzaniem
// i sondowaniem tutaj, e2e `third-party-quiescence` w P1.1).
//
// UZASADNIENIE 5 s. Okno jest dłuższe niż progi ciszy Lighthouse'a (1 s sieci
// i 1 s CPU po `load`, `core/gather/driver/wait-for-condition.js:409-480`), więc
// praca konsumentów nie trafia do śladu. To klasyczna reguła TTI (5 s bez
// długich zadań i bez żądań), a nie wykrywanie Lighthouse'a: ten sam punkt
// obowiązuje każdego odwiedzającego. Interakcja jest osobnym, wcześniejszym
// sygnałem (`postInteractionQueue`) - o jej użyciu decyduje konsument.
//
// SSR: no-op. Moduł trzyma stan na poziomie modułu (jeden detektor na
// dokument); testy zerują go `__resetQuiescenceForTests()`.

import { afterPrerendering, isPrerendering } from "@/lib/prerender";
import { enqueue, type CancelQueuedTask, type QueuePriority } from "./postInteractionQueue";

/** Najwcześniejszy punkt ciszy po `load`, nawet gdy wszystko milczy. */
export const QUIESCENCE_MIN_AFTER_LOAD_MS = 5_000;
/** Wymagana cisza bez długich zadań i bez liczonych zasobów. */
export const QUIESCENCE_WINDOW_MS = 5_000;
/** Limit po `load`: punkt zapada mimo pracy strony, także w ukrytej karcie. */
export const QUIESCENCE_CAP_MS = 20_000;
/** Brak `load` po tylu ms od początku nawigacji = traktujemy jak `load`. */
export const QUIESCENCE_LOAD_DEADLINE_MS = 10_000;
/** Najkrótszy odstęp ponownego sprawdzenia (bez wirowania na jednym zadaniu). */
export const QUIESCENCE_RECHECK_FLOOR_MS = 250;

export interface OnQuiescentOptions {
  /**
   * Klasa priorytetu w `postInteractionQueue`, w której konsument wystartuje
   * w punkcie ciszy (gtag: `"analytics"` - ostatni).
   */
  readonly priority: QueuePriority;
}

/** Odwołuje konsumenta (także już przekazanego kolejce, jeśli nie wystartował). */
export type CancelQuiescent = () => void;

/**
 * Wzorzec żądania należącego do konsumenta: tekst = podciąg pełnego URL-a,
 * `RegExp` = dopasowanie do pełnego URL-a (flaga `g` bez znaczenia).
 */
export type OwnedRequestPattern = string | RegExp;

export type QuiescenceReason = "quiet" | "cap";

/** Zapadnięty punkt ciszy. */
export interface Quiescence {
  /** Chwila na osi `performance.now()`. */
  readonly at: number;
  /** `"quiet"` - okno ciszy; `"cap"` - limit po `load`. */
  readonly reason: QuiescenceReason;
}

interface Consumer {
  readonly task: () => void;
  readonly priority: QueuePriority;
  cancelQueued: CancelQueuedTask | null;
}

interface OwnedRequest {
  readonly pattern: OwnedRequestPattern;
}

/** Ścieżki tego samego originu, które nie przesuwają okna (dokładnie albo jako katalog). */
const IGNORED_SAME_ORIGIN_PATHS = ["/api/public/version", "/~flock.js", "/~api/analytics"];
/** Hosty Google: tag, kolekcja GA4, reklamy (`google.com`, `google.pl`, `google.co.uk`…). */
const GOOGLE_HOST =
  /(^|\.)(googletagmanager\.com|google-analytics\.com|googleadservices\.com|googlesyndication\.com|doubleclick\.net|google\.[a-z]{2,3}(\.[a-z]{2})?)$/i;

const consumers = new Set<Consumer>();
const ownedRequests = new Set<OwnedRequest>();
let reached: Quiescence | null = null;
let stopDetector: (() => void) | null = null;

const noop = (): void => {};

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Koniec `load` z Navigation Timing, gdy dokument był załadowany przed startem detektora. */
function navigationLoadEnd(): number | null {
  try {
    if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
      return null;
    }
    const [navigation] = performance.getEntriesByType("navigation");
    if (
      navigation &&
      "loadEventEnd" in navigation &&
      typeof navigation.loadEventEnd === "number" &&
      navigation.loadEventEnd > 0
    ) {
      return navigation.loadEventEnd;
    }
  } catch {
    // Brak Navigation Timing - wołający bierze „teraz".
  }
  return null;
}

function initiatorTypeOf(entry: PerformanceEntry): string {
  return "initiatorType" in entry && typeof entry.initiatorType === "string"
    ? entry.initiatorType
    : "";
}

function parseUrl(name: string): URL | null {
  try {
    return new URL(name, window.location.href);
  } catch {
    return null;
  }
}

function isOwnedRequest(name: string): boolean {
  for (const { pattern } of ownedRequests) {
    // `search` ignoruje `lastIndex`, więc wzorzec z flagą `g` nie „pamięta" stanu.
    if (typeof pattern === "string" ? name.includes(pattern) : name.search(pattern) !== -1) {
      return true;
    }
  }
  return false;
}

/** Czy wpis `resource` NIE przesuwa okna ciszy (lista w nagłówku pliku). */
function isIgnoredResource(entry: PerformanceEntry, loadedAt: number | null): boolean {
  if (loadedAt !== null && initiatorTypeOf(entry) === "img" && entry.startTime >= loadedAt) {
    return true;
  }
  const url = parseUrl(entry.name);
  if (url) {
    if (
      url.origin === window.location.origin &&
      IGNORED_SAME_ORIGIN_PATHS.some(
        (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
      )
    ) {
      return true;
    }
    if (GOOGLE_HOST.test(url.hostname)) return true;
  }
  return isOwnedRequest(entry.name);
}

/**
 * Obserwator jednego typu wpisu (`buffered` - wpisy sprzed startu też się
 * liczą). Typ nieobsługiwany (Safari: `longtask`) albo brak API = no-op.
 */
function observeEntries(
  type: "longtask" | "resource",
  onEntry: (entry: PerformanceEntry) => void,
): () => void {
  if (typeof PerformanceObserver === "undefined") return noop;
  const supported: ReadonlyArray<string> | undefined = PerformanceObserver.supportedEntryTypes;
  if (supported && !supported.includes(type)) return noop;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) onEntry(entry);
    });
    observer.observe({ type, buffered: true });
    return () => observer.disconnect();
  } catch {
    // Silnik bez danego typu wpisu rzuca przy `observe` - cisza z definicji.
    return noop;
  }
}

function handOff(consumer: Consumer): void {
  consumer.cancelQueued = enqueue(consumer.task, {
    priority: consumer.priority,
    release: "immediate",
  });
}

function reach(reason: QuiescenceReason): void {
  if (reached) return;
  reached = { at: now(), reason };
  stopDetector?.();
  stopDetector = null;
  const waiting = [...consumers];
  consumers.clear();
  for (const consumer of waiting) handOff(consumer);
}

/** Uruchamia jedyny detektor ciszy dokumentu; zwraca funkcję go zatrzymującą. */
function startDetector(): () => void {
  const cleanups: Array<() => void> = [];
  let stopped = false;
  let timer = 0;
  let loadedAt: number | null = null;
  let lastLongTaskEnd = Number.NEGATIVE_INFINITY;
  let lastResourceEnd = Number.NEGATIVE_INFINITY;
  let visibleAt = Number.NEGATIVE_INFINITY;

  const arm = (delay: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(check, Math.max(0, delay));
  };

  function check(): void {
    if (stopped || loadedAt === null) return;
    const t = now();
    const sinceLoad = t - loadedAt;
    const capLeft = QUIESCENCE_CAP_MS - sinceLoad;
    if (document.visibilityState === "hidden") {
      // Okno stoi, limit biegnie.
      if (capLeft <= 0) reach("cap");
      else arm(capLeft);
      return;
    }
    const quietSince = Math.max(loadedAt, lastLongTaskEnd, lastResourceEnd, visibleAt);
    const sinceQuiet = t - quietSince;
    if (sinceLoad >= QUIESCENCE_MIN_AFTER_LOAD_MS && sinceQuiet >= QUIESCENCE_WINDOW_MS) {
      reach("quiet");
      return;
    }
    if (capLeft <= 0) {
      reach("cap");
      return;
    }
    const missing = Math.max(
      QUIESCENCE_MIN_AFTER_LOAD_MS - sinceLoad,
      QUIESCENCE_WINDOW_MS - sinceQuiet,
    );
    arm(Math.min(Math.max(QUIESCENCE_RECHECK_FLOOR_MS, missing), capLeft));
  }

  const markLoaded = (at: number) => {
    if (stopped || loadedAt !== null) return;
    loadedAt = at;
    // Pierwsze sprawdzenie nigdy synchronicznie: obserwatory oddają wpisy
    // `buffered` asynchronicznie, a przed minimum i tak nic nie zapadnie.
    arm(Math.max(QUIESCENCE_RECHECK_FLOOR_MS, QUIESCENCE_MIN_AFTER_LOAD_MS - (now() - at)));
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") return;
    // Powrót do karty: okno liczy się od nowa.
    visibleAt = now();
    check();
  };

  const begin = (activatedAt: number) => {
    if (stopped) return;
    if (document.readyState === "complete") {
      markLoaded(Math.max(navigationLoadEnd() ?? now(), activatedAt));
    } else {
      const onLoad = () => markLoaded(now());
      window.addEventListener("load", onLoad, { once: true });
      const origin = Number.isFinite(activatedAt) ? activatedAt : 0;
      const deadline = window.setTimeout(
        onLoad,
        Math.max(0, QUIESCENCE_LOAD_DEADLINE_MS - (now() - origin)),
      );
      cleanups.push(() => {
        window.removeEventListener("load", onLoad);
        window.clearTimeout(deadline);
      });
    }
    cleanups.push(
      observeEntries("longtask", (entry) => {
        lastLongTaskEnd = Math.max(lastLongTaskEnd, entry.startTime + entry.duration);
      }),
      observeEntries("resource", (entry) => {
        if (isIgnoredResource(entry, loadedAt)) return;
        lastResourceEnd = Math.max(lastResourceEnd, entry.startTime + entry.duration);
      }),
    );
    document.addEventListener("visibilitychange", onVisibilityChange);
    cleanups.push(() => document.removeEventListener("visibilitychange", onVisibilityChange));
  };

  const prerendering = isPrerendering();
  cleanups.push(afterPrerendering(() => begin(prerendering ? now() : Number.NEGATIVE_INFINITY)));

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    while (cleanups.length) cleanups.pop()?.();
  };
}

/**
 * Zapisuje `task` w jedynym punkcie ciszy strony. W punkcie (albo od razu,
 * jeśli już zapadł) zadanie trafia do `postInteractionQueue` z podanym
 * priorytetem i biegnie najwyżej raz - jedno zadanie na klatkę, w kolejności
 * klas. Zapis NIE uruchamia osobnego okna: wszyscy konsumenci dzielą jeden
 * detektor, więc żądania jednego nie przesuwają punktu pozostałym.
 *
 * Zwraca funkcję odwołującą (cleanup efektu). Na serwerze no-op.
 */
export function onQuiescent(task: () => void, options: OnQuiescentOptions): CancelQuiescent {
  if (typeof window === "undefined" || typeof document === "undefined") return noop;
  const consumer: Consumer = { task, priority: options.priority, cancelQueued: null };
  if (reached) {
    handOff(consumer);
  } else {
    consumers.add(consumer);
    stopDetector ??= startDetector();
  }
  return () => {
    // Detektor biegnie dalej, nawet gdy nikt już nie czeka: punkt ciszy jest
    // własnością dokumentu (zatrzask), a remount albo podwójny efekt StrictMode
    // nie może zaczynać okna od nowa.
    consumers.delete(consumer);
    consumer.cancelQueued?.();
    consumer.cancelQueued = null;
  };
}

/**
 * Zgłasza żądania konsumenta, które NIE mają przesuwać okna ciszy (np. gtag
 * rejestruje własne URL-e, zanim wstrzyknie skrypt po interakcji). Zwraca
 * funkcję wycofującą wzorzec. Na serwerze no-op.
 */
export function registerOwnedRequest(pattern: OwnedRequestPattern): () => void {
  if (typeof window === "undefined") return noop;
  const owned: OwnedRequest = { pattern };
  ownedRequests.add(owned);
  return () => {
    ownedRequests.delete(owned);
  };
}

/** Zapadnięty punkt ciszy albo `null` (jeszcze nie zapadł, nikt nie czeka, SSR). */
export function getQuiescence(): Quiescence | null {
  return reached;
}

/** Tylko testy: zatrzymuje detektor i zeruje konsumentów, wzorce i zatrzask. */
export function __resetQuiescenceForTests(): void {
  stopDetector?.();
  stopDetector = null;
  for (const consumer of consumers) consumer.cancelQueued?.();
  consumers.clear();
  ownedRequests.clear();
  reached = null;
}
