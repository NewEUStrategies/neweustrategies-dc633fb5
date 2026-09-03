// Runtime heartbeatu sesji podglądu: automatyczne wznowienie połączenia
// iframe'a i powrót do ostatniego stanu bez ręcznego klikania „Reload preview".
//
// Co robi:
//  1) SNAPSHOT - zapamiętuje ostatni stan (trasa + scroll) w sessionStorage,
//     przy każdej nawigacji i przy `pagehide`. Po wymuszonym przeładowaniu
//     przywraca pozycję i trasę, więc użytkownik wraca tam, gdzie był.
//  2) PULS - odpytuje `/api/public/version` (ten sam endpoint co cache-busting,
//     zero nowej powierzchni serwera) z krótkim timeoutem. Wynik karmi czysty
//     automat z `heartbeatMachine.ts`.
//  3) WSKRZESZENIE - gdy puls nie wraca > 30 s, prosimy powłokę podglądu o
//     przebudowę (postMessage), a jeśli to nie pomoże, przeładowujemy dokument
//     z zachowaniem stanu. Gdy puls wróci sam - miękkie odświeżenie danych
//     (`router.invalidate`), bez mrugania UI.
//
// Gdzie działa: tylko w przeglądarce i tylko w kontekstach podglądu (iframe,
// host *.lovable.app z prefiksem podglądu, localhost). Na produkcyjnej domenie
// nie startuje - tam od nieaktualnego bundla jest `cacheBusting.ts`.

import {
  heartbeatStep,
  initialHeartbeatState,
  nextProbeDelayMs,
  type HeartbeatEffect,
  type HeartbeatState,
} from "./heartbeatMachine";

/**
 * Ten moduł potrzebuje z routera DOKŁADNIE dwóch rzeczy: powiadomienia o
 * rozwiązanej nawigacji (moment zapisu snapshotu) i miękkiego odświeżenia.
 * Parametr zawężony do tych dwóch metod (a nie `AnyRouter`) - `AnyRouter`
 * spełnia ten kształt, więc wywołania się nie zmieniają, a moduł daje się
 * przetestować bez stawiania całego routera i bez rzutowań. Ta sama konwencja
 * co `SoftRefreshable` w `cacheBusting.ts` i `RouterLike` w `seo/invalidate.ts`.
 */
export interface PreviewHeartbeatRouter {
  subscribe: (event: "onResolved", listener: () => void) => () => void;
  invalidate: () => unknown;
}

const SNAPSHOT_KEY = "__lov_preview_snapshot";
const RELOAD_GUARD_KEY = "__lov_preview_reloads";
const SNAPSHOT_TTL_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 5_000;
/** Twardy sufit przeładowań na jedną sesję karty - ostatnia zapora przed pętlą. */
const MAX_RELOADS_PER_SESSION = 5;

export interface PreviewSnapshot {
  readonly href: string;
  readonly scrollY: number;
  readonly atMs: number;
}

function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage zablokowany (privacy mode) - heartbeat działa dalej, tracimy
    // wyłącznie odtwarzanie pozycji.
  }
}

export function readPreviewSnapshot(nowMs: number = Date.now()): PreviewSnapshot | null {
  const raw = readStorage(SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const snap = parsed as Partial<PreviewSnapshot>;
    if (typeof snap.href !== "string" || typeof snap.atMs !== "number") return null;
    if (nowMs - snap.atMs > SNAPSHOT_TTL_MS) return null;
    return {
      href: snap.href,
      scrollY: typeof snap.scrollY === "number" ? snap.scrollY : 0,
      atMs: snap.atMs,
    };
  } catch {
    return null;
  }
}

function writeSnapshot(): void {
  writeStorage(
    SNAPSHOT_KEY,
    JSON.stringify({
      href: window.location.href,
      scrollY: window.scrollY,
      atMs: Date.now(),
    } satisfies PreviewSnapshot),
  );
}

/**
 * Czy jesteśmy w kontekście podglądu. Produkcyjna domena publiczna nie
 * potrzebuje tego mechanizmu (i nie chcemy tam dodatkowego ruchu).
 */
export function isPreviewContext(loc: { hostname: string }, inIframe: boolean): boolean {
  // Heartbeat odzyskuje SESJĘ osadzonego podglądu. Sam host deweloperski nie
  // wystarcza: top-level localhost / *.lovable.app nie ma powłoki, która może
  // wznowić iframe, a traktowanie go jak preview kończyło się serią twardych
  // reloadów i dokładało kolejne równoległe renderowania SSR.
  if (!inIframe) return false;
  const host = loc.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (/(^|\.)lovable\.(app|dev)$/.test(host)) return true;
  // Własna domena osadzona w iframe = podgląd w panelu.
  return true;
}

function reloadCount(): number {
  const raw = readStorage(RELOAD_GUARD_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

function reloadRestoringState(reason: string): void {
  if (reloadCount() >= MAX_RELOADS_PER_SESSION) return;
  writeStorage(RELOAD_GUARD_KEY, String(reloadCount() + 1));
  writeSnapshot();
  const snap = readPreviewSnapshot();
  const url = new URL(snap?.href ?? window.location.href);
  url.searchParams.set("_pv", Date.now().toString(36));
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[preview-heartbeat] reload: ${reason}`);
  }
  window.location.replace(url.toString());
}

/** Prośba do powłoki podglądu o wznowienie sesji/przebudowę iframe'a. */
function askParentToReconnect(reason: string): void {
  if (window.parent === window) {
    // Brak powłoki oznacza zwykłą kartę, nie sesję osadzonego preview. Nie
    // przeładowujemy jej: przy chwilowo zajętym dev-serverze utworzyłoby to
    // samonapędzającą się lawinę nowych renderów SSR.
    return;
  }
  try {
    window.parent.postMessage({ type: "lovable:preview-reconnect", reason }, "*");
  } catch {
    reloadRestoringState(reason);
  }
}

function restoreScroll(): void {
  const snap = readPreviewSnapshot();
  if (!snap || snap.scrollY <= 0) return;
  const target = new URL(snap.href);
  if (target.pathname !== window.location.pathname) return;
  // Po hydratacji układ potrafi jeszcze urosnąć (obrazy, lazy widgety),
  // więc próbujemy kilka razy, aż dokument będzie wystarczająco wysoki.
  let tries = 0;
  const tick = () => {
    window.scrollTo({ top: snap.scrollY, behavior: "auto" });
    if (++tries < 6 && Math.abs(window.scrollY - snap.scrollY) > 4) {
      window.setTimeout(tick, 250);
    }
  };
  window.setTimeout(tick, 0);
}

async function probe(signal: AbortSignal): Promise<string | null> {
  const res = await fetch("/api/public/version", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`version ${res.status}`);
  const data = (await res.json()) as { v?: unknown };
  return typeof data?.v === "string" ? data.v : null;
}

let started = false;

/**
 * Startuje heartbeat podglądu. Wielokrotne wywołanie jest no-opem.
 * Zwraca funkcję czyszczącą.
 */
export function startPreviewHeartbeat(router: PreviewHeartbeatRouter): () => void {
  if (typeof window === "undefined" || started) return () => {};
  if (!isPreviewContext(window.location, window.parent !== window)) return () => {};
  started = true;

  let state: HeartbeatState = initialHeartbeatState;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let probeInFlight = false;

  restoreScroll();

  const applyEffect = (effect: HeartbeatEffect) => {
    switch (effect.kind) {
      case "soft-refresh":
        void router.invalidate();
        break;
      case "ask-parent":
        askParentToReconnect(effect.reason);
        break;
      case "reload":
        reloadRestoringState(effect.reason);
        break;
      case "none":
        break;
    }
  };

  const schedule = () => {
    if (disposed) return;
    timer = setTimeout(() => void run(), nextProbeDelayMs(state));
  };

  const run = async () => {
    if (disposed || probeInFlight) return;
    probeInFlight = true;
    const controller = new AbortController();
    // Powód przerwania jest JAWNY: bez niego przeglądarka rzuca „signal is
    // aborted without reason", komunikat nie do odróżnienia od realnej awarii
    // sieci w telemetrii.
    const abort = setTimeout(
      () => controller.abort(new DOMException("preview heartbeat timeout", "TimeoutError")),
      PROBE_TIMEOUT_MS,
    );
    try {
      const buildId = await probe(controller.signal);
      const step = heartbeatStep(state, { type: "ok", atMs: Date.now(), buildId });
      state = step.state;
      applyEffect(step.effect);
    } catch {
      const step = heartbeatStep(state, { type: "fail", atMs: Date.now() });
      state = step.state;
      applyEffect(step.effect);
    } finally {
      probeInFlight = false;
      clearTimeout(abort);
      schedule();
    }
  };

  // Snapshot: przy każdej rozwiązanej nawigacji i przy opuszczaniu dokumentu.
  const unsubscribe = router.subscribe("onResolved", () => writeSnapshot());
  const onPageHide = () => writeSnapshot();
  window.addEventListener("pagehide", onPageHide);

  // Powrót do widoczności = najczęstszy moment, w którym sandbox właśnie
  // wrócił do życia. Sprawdzamy natychmiast, nie czekając na tick.
  const onVisibility = () => {
    if (document.visibilityState !== "visible") {
      writeSnapshot();
      return;
    }
    if (timer) clearTimeout(timer);
    void run();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const onOnline = () => {
    if (timer) clearTimeout(timer);
    void run();
  };
  window.addEventListener("online", onOnline);

  schedule();

  return () => {
    disposed = true;
    started = false;
    if (timer) clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
