// Polityka dociągania gtag.js - KIEDY wolno wpuścić ~90 KB obcego originu.
//
// PO CO. PSI produkcji pokazał dwa skrypty Google (GA4 + miejsce docelowe
// Google Ads): ~367 KB transferu i ~580 ms głównego wątku na mobile. Do
// 2026-10-02 dociągał je `afterPageLoad(…, 2000)` (load -> klatka -> bezczynność
// z limitem 2 s). Na telefonie, gdzie interaktywność przychodzi późno, to okno
// nadal wypadało W ŚRODKU hydratacji i pierwszej interakcji: skrypt lądował w
// oknie liczonym do TBT i cofał ciche okno TTI. Polecenia (zgoda domyślna,
// `config`, odsłony) nie są tym dotknięte - czekają w `window.dataLayer`,
// natywnej kolejce gtag.js, więc odroczenie skryptu nie gubi zdarzeń, DOPÓKI
// skrypt w końcu dojedzie.
//
// POLITYKA: ładujemy przy NAJWCZEŚNIEJSZYM z trzech sygnałów.
//  (a) pierwsza interakcja odwiedzającego (pointerdown / keydown / touchstart /
//      scroll) - nasłuch pasywny i w fazie capture (handler, który zatrzymuje
//      propagację, nie ukryje interakcji). Samo dociągnięcie schodzi PO
//      obsłudze tej interakcji i po następnej klatce (rAF -> setTimeout 0), żeby
//      nie wydłużyć jej INP;
//  (b) jawna decyzja o zgodzie - wołający podaje subskrypcję w
//      `onDecision` (w aplikacji: `subscribeConsentChange` + `hasConsentDecision`
//      z `@/lib/ads/consent`). Decyzja z banera jest zwykle też interakcją (a),
//      ale decyzja z innej karty (zdarzenie `storage`) nie - a odwiedzający,
//      który ją podjął, chce być mierzony;
//  (c) bezczynność: po `load` czekamy co najmniej `QUIET_AFTER_LOAD_MS`, a
//      potem na okres bez długich zadań (`PerformanceObserver` typu `longtask`,
//      cisza `LONG_TASK_QUIET_MS`) w `requestIdleCallback`. Twardy limit
//      `LOAD_CAP_MS` po `load` gwarantuje, że wizyta bez interakcji (odbicie,
//      ale z czytaniem) też zdąży zaraportować `page_view`.
//
// ŚWIADOMY KOMPROMIS. Odwiedzający, który wychodzi PRZED pierwszą interakcją
// i PRZED progiem bezczynności (zwykle 2-8 s po `load`), nie wyśle `page_view`.
// To realna strata części odbić w GA4 - przyjęta w zamian za to, że żaden
// odwiedzający nie płaci ~580 ms głównego wątku za pomiar w chwili, gdy
// próbuje zacząć czytać albo kliknąć. Dawna reguła „2 s po load" też gubiła
// najkrótsze wizyty; nowa przesuwa próg dalej, ale tylko dla kart, które
// niczego nie dotknęły.
//
// Moduł jest czysty: żadnego stanu modułowego, wszystkie zależności to globalne
// API przeglądarki czytane leniwie (SSR dostaje no-op). Testy: fałszywe zegary
// plus symulowane interakcje i długie zadania.

/** Pierwsza możliwa chwila dociągnięcia po `load`, gdy nikt niczego nie dotknął. */
export const QUIET_AFTER_LOAD_MS = 2_000;
/** Minimalna cisza bez długich zadań, zanim skrypt wejdzie na główny wątek. */
export const LONG_TASK_QUIET_MS = 1_500;
/** Twardy limit po `load` - po nim ładujemy mimo długich zadań (odbicia muszą raportować). */
export const LOAD_CAP_MS = 8_000;
/**
 * Gdy `load` nie przychodzi (wiszący zasób obcy), traktujemy dokument jak
 * załadowany po tym czasie - ten sam zapas, co w `afterPageLoad`.
 */
export const LOAD_DEADLINE_MS = 10_000;
/**
 * Ile najdłużej czekamy na klatkę po interakcji. rAF w karcie w tle nie
 * przychodzi wcale; decyzja z innej karty nie może przez to utknąć na zawsze.
 */
const YIELD_CAP_MS = 1_000;

const INTERACTION_EVENTS = ["pointerdown", "keydown", "touchstart", "scroll"] as const;

export type CancelGtagLoad = () => void;

export interface GtagLoadPolicyOptions {
  /**
   * Subskrypcja jawnej decyzji o zgodzie: wołający daje funkcję, która woła
   * `fire` po KAŻDEJ decyzji (idempotencja jest po naszej stronie) i zwraca
   * funkcję odpinającą nasłuch.
   */
  onDecision?: (fire: () => void) => () => void;
}

interface IdleWindow {
  requestIdleCallback?: (
    callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
    options?: { timeout?: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
}

interface LongTaskLike {
  startTime: number;
  duration: number;
}

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/**
 * Nasłuch długich zadań. Zwraca funkcję czytającą chwilę KOŃCA ostatniego
 * długiego zadania (−∞ gdy żadnego nie było albo API nie istnieje - Safari
 * nie zna `longtask`, więc tam decyduje sama bezczynność i limit) oraz
 * funkcję odpinającą obserwatora.
 */
function observeLongTasks(): { lastEnd: () => number; disconnect: () => void } {
  let lastEnd = Number.NEGATIVE_INFINITY;
  if (typeof PerformanceObserver === "undefined") {
    return { lastEnd: () => lastEnd, disconnect: () => {} };
  }
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as LongTaskLike[]) {
        lastEnd = Math.max(lastEnd, entry.startTime + entry.duration);
      }
    });
    // `buffered` - długie zadania sprzed subskrypcji (hydratacja) też się liczą.
    observer.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
    return { lastEnd: () => lastEnd, disconnect: () => observer.disconnect() };
  } catch {
    // Przeglądarka bez wpisu `longtask` rzuca przy `observe` - cisza z definicji.
    return { lastEnd: () => lastEnd, disconnect: () => {} };
  }
}

/** `requestIdleCallback` z limitem, a bez niego zwykły `setTimeout(limit)`. */
function whenIdleOrAfter(callback: () => void, timeout: number): () => void {
  const w = window as Window & IdleWindow;
  if (typeof w.requestIdleCallback === "function") {
    const handle = w.requestIdleCallback(() => callback(), { timeout });
    return () => w.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, timeout);
  return () => window.clearTimeout(handle);
}

/**
 * Planuje dociągnięcie gtag.js według polityki z nagłówka pliku. `load` biegnie
 * najwyżej raz. Zwrócona funkcja odwołuje WSZYSTKO (nasłuchy, zegary,
 * obserwatora) - wołać w cleanupie efektu.
 */
export function scheduleGtagLoad(
  load: () => void,
  options: GtagLoadPolicyOptions = {},
): CancelGtagLoad {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};

  let settled = false;
  const cleanups: Array<() => void> = [];
  const addCleanup = (fn: () => void) => cleanups.push(fn);
  const cancel: CancelGtagLoad = () => {
    settled = true;
    while (cleanups.length) cleanups.pop()?.();
  };

  const fire = () => {
    if (settled) return;
    cancel();
    load();
  };

  // --- sygnały (a) i (b): zejście po obsłudze interakcji i po klatce ---------
  let yielding = false;
  const fireAfterPaint = () => {
    if (settled || yielding) return;
    yielding = true;
    let frame = 0;
    let after = 0;
    // Zapas na kartę w tle, w której rAF nie przychodzi.
    const cap = window.setTimeout(fire, YIELD_CAP_MS);
    frame = window.requestAnimationFrame(() => {
      after = window.setTimeout(fire, 0);
    });
    addCleanup(() => {
      window.clearTimeout(cap);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(after);
    });
  };

  const listenerOptions: AddEventListenerOptions = { passive: true, capture: true };
  for (const type of INTERACTION_EVENTS) {
    window.addEventListener(type, fireAfterPaint, listenerOptions);
    addCleanup(() => window.removeEventListener(type, fireAfterPaint, listenerOptions));
  }

  if (options.onDecision) {
    addCleanup(options.onDecision(fireAfterPaint));
  }

  // --- sygnał (c): bezczynność po load ----------------------------------------
  const longTasks = observeLongTasks();
  addCleanup(longTasks.disconnect);

  let loadedAt = 0;
  let cancelIdle: () => void = () => {};
  addCleanup(() => cancelIdle());

  const checkQuiet = () => {
    if (settled) return;
    const t = now();
    const sinceLoad = t - loadedAt;
    const sinceLongTask = t - longTasks.lastEnd();
    if (sinceLoad >= LOAD_CAP_MS || sinceLongTask >= LONG_TASK_QUIET_MS) {
      fire();
      return;
    }
    // Główny wątek wciąż pracuje: wracamy, gdy minie wymagana cisza albo limit -
    // cokolwiek pierwsze. Najmniej 50 ms, żeby nie wirować na jednym zadaniu.
    const wait = Math.max(
      50,
      Math.min(LONG_TASK_QUIET_MS - sinceLongTask, LOAD_CAP_MS - sinceLoad),
    );
    cancelIdle = whenIdleOrAfter(checkQuiet, wait);
  };

  let loadStarted = false;
  const onLoaded = () => {
    if (settled || loadStarted) return;
    loadStarted = true;
    window.removeEventListener("load", onLoaded);
    window.clearTimeout(loadDeadline);
    loadedAt = now();
    // Pierwsze podejście dopiero po `QUIET_AFTER_LOAD_MS` (twardy zegar, nie
    // rIC - bezczynność tuż po load to jeszcze ogon hydratacji, czyli dokładnie
    // okno, z którego skrypt zabieramy), a dalej już w pętli bezczynności.
    const first = window.setTimeout(() => {
      cancelIdle = whenIdleOrAfter(checkQuiet, LONG_TASK_QUIET_MS);
    }, QUIET_AFTER_LOAD_MS);
    addCleanup(() => window.clearTimeout(first));
  };

  const loadDeadline = window.setTimeout(onLoaded, LOAD_DEADLINE_MS);
  addCleanup(() => {
    window.clearTimeout(loadDeadline);
    window.removeEventListener("load", onLoaded);
  });
  if (document.readyState === "complete") onLoaded();
  else window.addEventListener("load", onLoaded, { once: true });

  return cancel;
}
