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
// Wpis z `target`, który ZAWIERA cel pierwszej interakcji (`event.target`),
// wskakuje na początek kolejki - przed wszystkie klasy; kilka takich wpisów
// zachowuje między sobą porządek klas. Dalej: klasa, potem kolejność dodania.
// Porządek liczony jest w chwili wyjęcia zadania, więc wpis dodany w trakcie
// opróżniania wchodzi na swoje miejsce.
//
// TEMPO. Kolejka opróżnia się JEDNO ZADANIE NA KLATKĘ: `requestAnimationFrame`
// -> `scheduler.postTask(fn, {priority: "background"})`, a bez Scheduler API
// `setTimeout(0)`. Zadanie startuje więc zawsze po handlerach interakcji
// (callback `onFirstInteraction` tylko otwiera kolejkę) i po klatce, która
// pokazuje ich skutek; kolejne zadanie czeka na następną klatkę, więc
// przeglądarka między nimi maluje i obsługuje wejście. W karcie w tle rAF nie
// przychodzi: przy `visibilityState === "hidden"` kolejka pomija klatkę, a gdy
// klatka nie przyjdzie mimo widocznej karty, po `FRAME_FALLBACK_MS` idzie dalej
// bez niej.
//
// ZWOLNIENIE. Wpis z `release: "interaction"` (domyślnie) czeka na pierwszą
// interakcję (`firstInteraction.ts`); wpis z `release: "immediate"` wchodzi do
// opróżniania od razu - tak wpuszcza swoich konsumentów punkt ciszy
// (`whenQuiescent.ts`) i tak mogą wejść wyzwalacze typu IntersectionObserver.
// Wpis czekający na interakcję, której nigdy nie będzie, nie biegnie nigdy -
// zapas ciszy jest decyzją konsumenta (`onQuiescent`).
//
// Wyjątek zadania nie zatrzymuje kolejki (`reportError`). SSR: no-op.

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

/** Kiedy wpis może wejść do opróżniania. */
export type QueueRelease = "interaction" | "immediate";

export interface EnqueueOptions {
  /** Klasa priorytetu (patrz `QUEUE_PRIORITIES`). */
  readonly priority: QueuePriority;
  /**
   * Korzeń DOM, którego dotyczy zadanie (wyspa, powłoka banera). Gdy pierwsza
   * interakcja trafiła w jego wnętrze, wpis wskakuje na początek kolejki.
   */
  readonly target?: Node | null;
  /**
   * `"interaction"` (domyślnie) - czeka na pierwszą interakcję;
   * `"immediate"` - opróżniany od razu, nadal jedno zadanie na klatkę.
   */
  readonly release?: QueueRelease;
}

/** Usuwa wpis, jeśli jeszcze nie wystartował; bezpieczne do wielokrotnego wołania. */
export type CancelQueuedTask = () => void;

/** Ile najdłużej czekamy na klatkę w widocznej karcie, zanim pójdziemy bez niej. */
export const FRAME_FALLBACK_MS = 1_000;

/**
 * Scheduler API (Chrome 94+). TS 5.9 `lib.dom` go nie zna, stąd lokalny,
 * minimalny interfejs zamiast rzutowania przez `unknown`.
 */
interface BackgroundTaskScheduler {
  postTask(callback: () => void, options: { priority: "background" }): Promise<unknown>;
}

interface SchedulerScope {
  scheduler?: BackgroundTaskScheduler;
}

interface Entry {
  readonly task: () => void;
  readonly rank: number;
  readonly target: Node | null;
  readonly seq: number;
  released: boolean;
}

const entries: Entry[] = [];
let sequence = 0;
/** Czy pierwsza interakcja już zaszła; jej cel czytamy z `firstInteraction` przy każdym wyborze. */
let interacted = false;
let stopWaitingForInteraction: (() => void) | null = null;
let cancelStep: (() => void) | null = null;

const noop = (): void => {};

function report(error: unknown): void {
  if (typeof reportError === "function") reportError(error);
  else console.error(error);
}

function backgroundScheduler(): BackgroundTaskScheduler | null {
  const scope = globalThis as typeof globalThis & SchedulerScope;
  const scheduler = scope.scheduler;
  return scheduler && typeof scheduler.postTask === "function" ? scheduler : null;
}

/** Zadanie o niskim priorytecie: `postTask(background)`, a bez API `setTimeout(0)`. */
function postBackground(run: () => void): void {
  const scheduler = backgroundScheduler();
  if (scheduler) {
    scheduler.postTask(run, { priority: "background" }).then(undefined, report);
    return;
  }
  window.setTimeout(run, 0);
}

/**
 * Jeden krok: następna klatka (o ile karta jest widoczna), potem zadanie w
 * tle. Zwraca funkcję odwołującą krok.
 */
function afterFrameInBackground(run: () => void): () => void {
  let cancelled = false;
  let posted = false;
  let frame = 0;
  let fallback = 0;
  const post = () => {
    if (cancelled || posted) return;
    posted = true;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(fallback);
    postBackground(() => {
      if (!cancelled) run();
    });
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

function runStep(): void {
  cancelStep = null;
  const next = pickNext();
  if (next) {
    remove(next);
    try {
      next.task();
    } catch (error) {
      report(error);
    }
  }
  scheduleStep();
}

function scheduleStep(): void {
  if (cancelStep || !entries.some((entry) => entry.released)) return;
  cancelStep = afterFrameInBackground(runStep);
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
 * w handlerze interakcji: po klatce, w zadaniu `postTask(background)`, jedno
 * na klatkę, w porządku opisanym w nagłówku pliku. Zwraca funkcję usuwającą
 * wpis (cleanup efektu). Na serwerze no-op.
 */
export function enqueue(task: () => void, options: EnqueueOptions): CancelQueuedTask {
  if (typeof window === "undefined" || typeof document === "undefined") return noop;
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
  if (!entry.released) waitForInteraction();
  scheduleStep();
  return () => remove(entry);
}

/** Tylko testy: odwołuje krok, zdejmuje subskrypcję interakcji i czyści wpisy. */
export function __resetPostInteractionQueueForTests(): void {
  cancelStep?.();
  cancelStep = null;
  stopWaitingForInteraction?.();
  stopWaitingForInteraction = null;
  interacted = false;
  entries.length = 0;
  sequence = 0;
}
