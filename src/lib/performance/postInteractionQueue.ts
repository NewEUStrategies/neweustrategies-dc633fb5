// Priorytetowa kolejka pracy po pierwszej interakcji - jedna na stronę.
//
// PO CO (krytyka planu M11). Na pierwszą interakcję czeka naraz kilka ciężkich
// rzeczy: interaktywny baner zgód (P1.3), wyspy hydratacji (P1.6, P2.2),
// widgety nagłówka (P2.3), nakładki i gtag (P1.1: ~120-300 ms CPU na średnim
// telefonie). Puszczone razem w handlerze albo w jednym `requestIdleCallback`
// lądują w jednym długim zadaniu tuż po dotknięciu - a następne dotknięcie
// płaci za nie w INP (Core Web Vital w CrUX). Ta kolejka ustala KOLEJNOŚĆ i
// TEMPO tej pracy.
//
// KOLEJNOŚĆ. Klasy priorytetu (`QUEUE_PRIORITIES`, od najważniejszej):
//   shell         - interaktywny baner zgód (powłoka SSR jest widoczna od FCP),
//   island-target - wyspa, o której wiadomo, że jest pod palcem / ma fokus,
//   header        - widgety nagłówka,
//   islands       - pozostałe wyspy hydratacji,
//   overlays      - nakładki (popupy, toaster, import `cacheBusting`),
//   analytics     - gtag, zawsze OSTATNI.
// Wpis z `target`, który ZAWIERA cel PIERWSZEJ interakcji strony
// (`getFirstInteraction()`), wskakuje na początek kolejki - przed wszystkie
// klasy; kilka takich wpisów zachowuje między sobą porządek klas. Dalej:
// klasa, potem kolejność dodania. Promocja dotyczy wyłącznie pierwszej
// interakcji: późniejsze dotknięcia niczego nie przestawiają - wyspa pod
// palcem przy kolejnym dotknięciu idzie torem pilnym (niżej). Porządek liczony
// jest w chwili wyjęcia zadania, więc wpis dodany w trakcie opróżniania
// wchodzi na swoje miejsce.
//
// TEMPO. Kolejka opróżnia się JEDNO ZADANIE NA KLATKĘ: `requestAnimationFrame`
// -> `scheduler.postTask(fn, {priority})`, a bez Scheduler API `setTimeout(0)`.
// Priorytet zadania: `user-visible` dla klas `shell`, `island-target` i
// `header` (widoczny interfejs), `background` dla pozostałych. Zadanie
// startuje więc zawsze po handlerach interakcji (callback `onFirstInteraction`
// tylko otwiera kolejkę) i po klatce, która pokazuje ich skutek. Następny krok
// czeka na KONIEC zadania: jeśli zadanie zwróciło promise, kolejka stoi do
// jego rozstrzygnięcia (patrz KONTRAKT ZADANIA), a dopiero potem czeka na
// następną klatkę - przeglądarka między zadaniami maluje i obsługuje wejście,
// a praca asynchroniczna konsumentów (import, hydratacja, ewaluacja gtag.js)
// nie nakłada się na siebie. W karcie w tle rAF nie przychodzi: przy
// `visibilityState === "hidden"` kolejka pomija klatkę, a gdy klatka nie
// przyjdzie mimo widocznej karty, po `FRAME_FALLBACK_MS` idzie dalej bez niej.
//
// STRAŻNIK GESTU (wspólny dla wszystkich wpisów zwykłego toru). Kolejka
// zwalnia się już na `pointerdown`/`keydown`/`touchstart`, ale żaden krok nie
// startuje W TRAKCIE gestu. Podmiana powłoki banera (P1.3) między
// `pointerdown` a `click` gubi kliknięcie: myszą `click` trafia wtedy we
// wspólnego przodka odłączonego przycisku i celu `pointerup`, a Spacja
// aktywuje przycisk dopiero na `keyup` - w nowym przycisku, który nie widział
// `keydown`, więc aktywacji nie ma. Do tego `pointerup`/`click` czekałby na
// zadanie kolejki - dokładnie INP pierwszej interakcji, który kolejka ma
// chronić. Stąd:
//  - wciśnięcie (`pointerdown`, `touchstart`, `keydown` bez autopowtórzenia)
//    wstrzymuje kroki na najwyżej `GESTURE_FALLBACK_MS`;
//  - puszczenie (`pointerup`, `touchend`, `keyup`) czeka już tylko na `click`,
//    też najwyżej `GESTURE_FALLBACK_MS`;
//  - `click`, `pointercancel` i `touchcancel` kończą gest od razu - krok rusza
//    w następnej klatce, po handlerach `click`;
//  - `wheel` i `scroll` niczego nie wstrzymują.
// Zapas zamyka gest, którego koniec nie przyjdzie (zgubiony `pointerup`, długie
// przytrzymanie): e2e P1.1 „`page.mouse.down()` ładuje gtag w ≤ 1 s" nadal
// przechodzi. Cena: przy przytrzymaniu dłuższym niż zapas krok rusza przed
// `pointerup`, a klik w podmienioną już powłokę przepada (odwiedzający klika
// wtedy w interaktywny baner). Nasłuch (capture, passive, tylko
// zdarzenia zaufane) żyje, dopóki kolejka ma wpisy albo czekające promise,
// oraz dopóki detektor ciszy czeka na swój punkt (`watchGestures()` w
// `whenQuiescent.ts`) - więc punkt ciszy, który zapada przy wciśniętym
// przycisku, też czeka na koniec gestu.
//
// TOR PILNY (`release: "urgent"`). Zadanie biegnie w PIERWSZYM MIKROZADANIU po
// `enqueue` - bez klatki, bez strażnika gestu, poza kolejnością klas i tempem.
// Wyłącznie dla otwarcia bramki pod palcem: wyspa (P1.6) zakłada wpis we
// własnym handlerze capture (`ownEvents`: `pointerdown`/`focusin`/`keydown`),
// a powłoka banera (P1.3) - przy kliknięciu z intencją „ustawienia". Powód:
// react-dom 19.2 przy zdarzeniu dyskretnym na odwodnionej granicy próbuje ją
// uwodnić synchronicznie, a gdy granica nadal czeka (`use(bramka)`
// nierozwiązany), woła `stopPropagation()` i NIE dispatchuje zdarzenia
// (`react-dom-client.production.js`, `dispatchEvent`). Bramka musi więc być
// otwarta przed `click`, a zadanie po klatce przychodzi na zajętym telefonie
// często dopiero po `click`. Kontrakt zadania pilnego: TYLKO otworzyć bramkę, czyli
// rozwiązać jej thenable i od razu ustawić na nim `status: "fulfilled"` (inaczej
// `use` zawiesi się jeszcze raz, bo wynik zwykłego promise widzi dopiero w
// mikrozadaniu) albo zacząć import banera. Hydratację planuje React sam. Promise
// zwrócony przez zadanie pilne wstrzymuje zwykły tor jak każdy inny.
//
// ZWOLNIENIE. Wpis z `release: "interaction"` (domyślnie) czeka na pierwszą
// interakcję (`firstInteraction.ts`); wpis z `release: "immediate"` wchodzi do
// opróżniania od razu - tak wpuszcza swoich konsumentów punkt ciszy
// (`whenQuiescent.ts`) i tak mogą wejść wyzwalacze typu IntersectionObserver.
// Wpis czekający na interakcję, której nigdy nie będzie, nie biegnie nigdy -
// zapas ciszy jest decyzją konsumenta (`onQuiescent`).
//
// KONTRAKT ZADANIA. Zadanie zwraca `void` albo promise (`PromiseLike`), który
// rozstrzyga się, gdy ciężka praca konsumenta naprawdę się skończy:
//  - P1.6 (wyspa): po commicie uwodnionej wyspy (efekt warstwy w jej wnętrzu);
//  - P1.3 (baner): po montażu interaktywnego banera;
//  - P1.1 (gtag): na `onload`/`onerror` skryptu gtag.js (ewaluacja skryptu
//    kończy się przed jego `load`).
// Kolejka czeka najwyżej `TASK_SETTLE_CAP_MS`, więc wiszący konsument jej nie
// zatrzyma. Wyjątek i odrzucenie nie zatrzymują kolejki (`reportError`).
//
// KOSZT. Trzy moduły P0.3 razem to ~3,4 KB gzip (pomiar w raporcie poprawki
// P0.3); konsument w entry (P1.1, P1.3) płaci je w zamknięciu boot. SSR: no-op.

import { getFirstInteraction, onFirstInteraction } from "./firstInteraction";

/** Klasy priorytetu od najważniejszej; indeks = ranga. */
export const QUEUE_PRIORITIES = [
  "shell",
  "island-target",
  "header",
  "islands",
  "overlays",
  "analytics",
] as const;

export type QueuePriority = (typeof QUEUE_PRIORITIES)[number];

/** Kiedy wpis może wejść do opróżniania (ZWOLNIENIE i TOR PILNY w nagłówku). */
export type QueueRelease = "interaction" | "immediate" | "urgent";

/**
 * Zadanie kolejki. Zwrócony promise wstrzymuje kolejkę do swojego
 * rozstrzygnięcia, najdłużej `TASK_SETTLE_CAP_MS` (KONTRAKT ZADANIA). Unia
 * typów funkcji, a nie `() => void | PromiseLike`, żeby dalej pasowały
 * zadania zwracające cokolwiek innego (`() => list.push(x)`) - jak przy
 * dawnym `() => void`; kolejka czeka wyłącznie na zwrócony thenable.
 */
export type QueuedTask = (() => void) | (() => PromiseLike<unknown>);

export interface EnqueueOptions {
  /** Klasa priorytetu (patrz `QUEUE_PRIORITIES`); na torze pilnym bez wpływu na kolejność. */
  readonly priority: QueuePriority;
  /**
   * Korzeń DOM, którego dotyczy zadanie (wyspa, powłoka banera). Gdy pierwsza
   * interakcja trafiła w jego wnętrze, wpis wskakuje na początek kolejki.
   */
  readonly target?: Node | null;
  /**
   * `"interaction"` (domyślnie) - czeka na pierwszą interakcję;
   * `"immediate"` - opróżniany od razu, nadal jedno zadanie na klatkę;
   * `"urgent"` - pierwsze mikrozadanie, tylko otwarcie bramki pod palcem.
   */
  readonly release?: QueueRelease;
}

/** Usuwa wpis, jeśli jeszcze nie wystartował; bezpieczne do wielokrotnego wołania. */
export type CancelQueuedTask = () => void;

/** Ile najdłużej czekamy na klatkę w widocznej karcie, zanim pójdziemy bez niej. */
export const FRAME_FALLBACK_MS = 1_000;
/** Najdłuższe wstrzymanie kroku przez gest: od wciśnięcia albo od puszczenia bez `click`. */
export const GESTURE_FALLBACK_MS = 300;
/** Najdłużej czekamy na promise zadania, zanim kolejka pójdzie dalej. */
export const TASK_SETTLE_CAP_MS = 2_000;

type TaskPriority = "user-visible" | "background";

/**
 * Scheduler API (Chrome 94+). TS 5.9 `lib.dom` go nie zna, stąd lokalny,
 * minimalny interfejs zamiast rzutowania przez `unknown`.
 */
interface TaskScheduler {
  postTask(callback: () => void, options: { priority: TaskPriority }): Promise<unknown>;
}

interface SchedulerScope {
  scheduler?: TaskScheduler;
}

interface Entry {
  readonly task: QueuedTask;
  readonly rank: number;
  readonly target: Node | null;
  readonly seq: number;
  released: boolean;
}

/** Faza gestu niesiona przez zdarzenie (STRAŻNIK GESTU w nagłówku). */
type GesturePhase = "press" | "release" | "end";

const GESTURE_PHASES: Readonly<Record<string, GesturePhase>> = {
  pointerdown: "press",
  touchstart: "press",
  keydown: "press",
  pointerup: "release",
  touchend: "release",
  keyup: "release",
  click: "end",
  pointercancel: "end",
  touchcancel: "end",
};

const LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };
/** Klasy do `header` włącznie (`shell`, `island-target`, `header`) schodzą jako `user-visible`. */
const LAST_USER_VISIBLE_RANK = QUEUE_PRIORITIES.indexOf("header");

const entries: Entry[] = [];
let sequence = 0;
/** Czy pierwsza interakcja już zaszła; jej cel czytamy z `firstInteraction` przy każdym wyborze. */
let interacted = false;
let stopWaitingForInteraction: (() => void) | null = null;
let cancelStep: (() => void) | null = null;
/** Zaplanowany krok czeka na koniec gestu (koniec gestu planuje go od nowa). */
let stepAwaitsGesture = false;
/** Zadania (zwykłe i pilne), na których promise kolejka jeszcze czeka. */
let settling = 0;
/** Stan strażnika gestu. */
let pressed = false;
let heldUntil = 0;
let tracking = false;
/** Zewnętrzne prośby o nasłuch gestów (`watchGestures`). */
let gestureWatchers = 0;
/** Pokolenie stanu: reset testu unieważnia spóźnione mikrozadania i limity. */
let generation = 0;

const noop = (): void => {};

function report(error: unknown): void {
  if (typeof reportError === "function") reportError(error);
  else console.error(error);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function handleGesture(event: Event): void {
  // Zdarzenie wysłane skryptem (`dispatchEvent`, `element.click()`) nie jest
  // gestem odwiedzającego. `=== false`: atrapy DOM bez `isTrusted` przechodzą.
  if (event.isTrusted === false) return;
  const phase = GESTURE_PHASES[event.type];
  if (phase === "press") {
    // Autopowtórzenie trzymanego klawisza nie przedłuża wstrzymania.
    if ("repeat" in event && event.repeat === true) return;
    pressed = true;
    heldUntil = performance.now() + GESTURE_FALLBACK_MS;
  } else if (phase === "release") {
    // Puszczenie bez zapisanego wciśnięcia (np. `touchend` po `pointercancel`
    // przewijania) nie zapowiada żadnego `click`.
    if (!pressed) return;
    pressed = false;
    heldUntil = performance.now() + GESTURE_FALLBACK_MS;
  } else {
    pressed = false;
    heldUntil = 0;
    if (stepAwaitsGesture) replanStep();
  }
}

/** Nasłuch gestów żyje, dopóki ktoś może jeszcze uruchomić krok. */
function syncGestureTracking(): void {
  const wanted = gestureWatchers > 0 || entries.length > 0 || settling > 0;
  if (wanted === tracking) return;
  tracking = wanted;
  for (const type of Object.keys(GESTURE_PHASES)) {
    if (wanted) window.addEventListener(type, handleGesture, LISTENER_OPTIONS);
    else window.removeEventListener(type, handleGesture, LISTENER_OPTIONS);
  }
  if (!wanted) {
    pressed = false;
    heldUntil = 0;
  }
}

/**
 * Jeden krok: następna klatka (o ile karta jest widoczna), potem zadanie
 * `postTask` z podanym priorytetem. Zwraca funkcję odwołującą krok.
 */
function afterFrame(priority: TaskPriority, run: () => void): () => void {
  let cancelled = false;
  let posted = false;
  let frame = 0;
  let fallback = 0;
  const post = () => {
    if (cancelled || posted) return;
    posted = true;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(fallback);
    const go = () => {
      if (!cancelled) run();
    };
    const scheduler = (globalThis as typeof globalThis & SchedulerScope).scheduler;
    if (scheduler && typeof scheduler.postTask === "function") {
      scheduler.postTask(go, { priority }).then(undefined, report);
    } else {
      window.setTimeout(go, 0);
    }
  };
  if (document.visibilityState === "hidden" || typeof window.requestAnimationFrame !== "function") {
    post();
  } else {
    frame = window.requestAnimationFrame(post);
    fallback = window.setTimeout(post, FRAME_FALLBACK_MS);
  }
  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(fallback);
  };
}

/** Cel pierwszej interakcji jako węzeł DOM (albo `null`: brak, `"activation"`, zebrany przez GC). */
function interactionNode(): Node | null {
  if (typeof Node === "undefined") return null;
  const hit = getFirstInteraction()?.target;
  return hit instanceof Node ? hit : null;
}

/** Czy wpis dotyczy korzenia, w którego wnętrze trafiła pierwsza interakcja. */
function isUnderInteraction(entry: Entry, hit: Node | null): boolean {
  return hit !== null && entry.target !== null && entry.target.contains(hit);
}

/** Ujemne, gdy `a` ma zejść przed `b`: trafiony cel, potem klasa, potem kolejność dodania. */
function compare(a: Entry, b: Entry, hit: Node | null): number {
  const hitA = isUnderInteraction(a, hit) ? 0 : 1;
  const hitB = isUnderInteraction(b, hit) ? 0 : 1;
  return hitA - hitB || a.rank - b.rank || a.seq - b.seq;
}

function pickNext(): Entry | undefined {
  const hit = interactionNode();
  let best: Entry | undefined;
  for (const entry of entries) {
    if (!entry.released) continue;
    if (!best || compare(entry, best, hit) < 0) best = entry;
  }
  return best;
}

function remove(entry: Entry): void {
  const index = entries.indexOf(entry);
  if (index === -1) return;
  entries.splice(index, 1);
  // Nikt już nie czeka na interakcję - zwalniamy wspólny nasłuch.
  if (stopWaitingForInteraction && !entries.some((candidate) => !candidate.released)) {
    stopWaitingForInteraction();
    stopWaitingForInteraction = null;
  }
}

/** Promise zadania wstrzymuje kolejkę do rozstrzygnięcia, najdłużej `TASK_SETTLE_CAP_MS`. */
function holdUntilSettled(result: PromiseLike<unknown>): void {
  const owner = generation;
  let done = false;
  settling += 1;
  syncGestureTracking();
  const settle = () => {
    if (done || owner !== generation) return;
    done = true;
    window.clearTimeout(cap);
    settling -= 1;
    syncGestureTracking();
    scheduleStep();
  };
  const cap = window.setTimeout(settle, TASK_SETTLE_CAP_MS);
  Promise.resolve(result).then(settle, (error: unknown) => {
    report(error);
    settle();
  });
}

function run(task: QueuedTask): void {
  let result: unknown;
  try {
    result = task();
  } catch (error) {
    report(error);
    return;
  }
  if (isThenable(result)) holdUntilSettled(result);
}

function runStep(): void {
  const next = pickNext();
  if (next) {
    remove(next);
    run(next.task);
  }
  syncGestureTracking();
  scheduleStep();
}

/** Planuje krok: koniec gestu -> klatka -> zadanie. Zwraca odwołanie planu. */
function planStep(): () => void {
  const held = heldUntil - performance.now();
  if (held > 0) {
    stepAwaitsGesture = true;
    const timer = window.setTimeout(replanStep, held);
    return () => {
      stepAwaitsGesture = false;
      window.clearTimeout(timer);
    };
  }
  const next = pickNext();
  const priority = next && next.rank <= LAST_USER_VISIBLE_RANK ? "user-visible" : "background";
  return afterFrame(priority, () => {
    cancelStep = null;
    // Między planem a startem mogło zacząć się wciśnięcie albo zadanie pilne.
    if (settling > 0) return;
    if (heldUntil > performance.now()) scheduleStep();
    else runStep();
  });
}

function replanStep(): void {
  cancelStep?.();
  cancelStep = null;
  scheduleStep();
}

function scheduleStep(): void {
  if (cancelStep || settling > 0 || !entries.some((entry) => entry.released)) return;
  cancelStep = planStep();
}

function onInteraction(): void {
  stopWaitingForInteraction = null;
  interacted = true;
  for (const entry of entries) entry.released = true;
  scheduleStep();
}

function waitForInteraction(): void {
  if (stopWaitingForInteraction || interacted) return;
  stopWaitingForInteraction = onFirstInteraction(onInteraction);
}

/**
 * Dodaje zadanie do kolejki po pierwszej interakcji.
 *
 * Zadanie biegnie najwyżej raz, nigdy synchronicznie w wywołaniu `enqueue` ani
 * w handlerze interakcji. Zwykły tor: po końcu gestu i po klatce, w zadaniu
 * `postTask`, jedno na klatkę, w porządku z nagłówka pliku. Tor pilny
 * (`release: "urgent"`): w pierwszym mikrozadaniu. Zwraca funkcję usuwającą
 * wpis (cleanup efektu). Na serwerze no-op.
 */
export function enqueue(task: QueuedTask, options: EnqueueOptions): CancelQueuedTask {
  if (typeof window === "undefined" || typeof document === "undefined") return noop;
  if (options.release === "urgent") {
    const owner = generation;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && owner === generation) run(task);
    });
    return () => {
      cancelled = true;
    };
  }
  // Interakcja mogła już zajść (zapisał ją inny subskrybent) - wtedy wpis
  // wchodzi od razu, bez czekania na mikrozadanie spóźnionego subskrybenta.
  interacted ||= getFirstInteraction() !== null;
  const entry: Entry = {
    task,
    rank: QUEUE_PRIORITIES.indexOf(options.priority),
    target: options.target ?? null,
    seq: sequence++,
    released: options.release === "immediate" || interacted,
  };
  entries.push(entry);
  syncGestureTracking();
  if (!entry.released) waitForInteraction();
  scheduleStep();
  return () => {
    remove(entry);
    syncGestureTracking();
  };
}

/**
 * Utrzymuje nasłuch gestów kolejki także wtedy, gdy nie ma w niej wpisów -
 * detektor ciszy trzyma go do swojego punktu, żeby konsument przekazany
 * przy wciśniętym przycisku poczekał na koniec gestu. Zwraca funkcję
 * zwalniającą (bezpieczną do wielokrotnego wołania). Na serwerze no-op.
 */
export function watchGestures(): () => void {
  if (typeof window === "undefined") return noop;
  const owner = generation;
  let active = true;
  gestureWatchers += 1;
  syncGestureTracking();
  return () => {
    if (!active || owner !== generation) return;
    active = false;
    gestureWatchers -= 1;
    syncGestureTracking();
  };
}

/** Tylko testy: odwołuje krok, zdejmuje subskrypcje i nasłuch gestów, czyści wpisy. */
export function __resetPostInteractionQueueForTests(): void {
  cancelStep?.();
  cancelStep = null;
  stepAwaitsGesture = false;
  stopWaitingForInteraction?.();
  stopWaitingForInteraction = null;
  interacted = false;
  entries.length = 0;
  sequence = 0;
  settling = 0;
  gestureWatchers = 0;
  generation += 1;
  if (typeof window !== "undefined") syncGestureTracking();
  tracking = false;
  pressed = false;
  heldUntil = 0;
}
