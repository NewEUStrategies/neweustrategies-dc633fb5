// Czysty automat stanów heartbeatu sesji podglądu.
//
// Kontekst: iframe podglądu potrafi stracić połączenie z sandboxem (sandbox
// uśpiony, przebudowa po merge, restart dev servera). Aplikacja żyje wtedy
// dalej w pamięci, ale każdy fetch pada, a panel zostaje na „Updating"/
// „Previewing" aż ktoś ręcznie kliknie „Reload preview". Ten automat zamienia
// tamten ręczny klik w deterministyczną regułę: po STUCK_MS nieudanych
// pulsów uznajemy sesję za utraconą i sami próbujemy ją wskrzesić, a gdy puls
// wróci - decydujemy, czy wystarczy miękkie odświeżenie danych, czy trzeba
// przeładować dokument (nowy build = inne chunki, stary dokument jest martwy).
//
// Logika jest wydzielona z runtime'u (`sessionHeartbeat.ts`), bo to ona niesie
// ryzyko pętli przeładowań - i tylko jako funkcja czysta daje się przetestować
// bez timerów i bez `window`.

/** Puls nie wraca tyle czasu -> sesja uznana za utraconą (wymóg: 30 s). */
export const STUCK_MS = 30_000;
/** Odstęp między kolejnymi próbami wskrzeszenia, żeby nie wpaść w pętlę. */
export const RECOVERY_COOLDOWN_MS = 30_000;
/** Twardy limit prób - dalej zostawiamy stronę użytkownikowi. */
export const MAX_RECOVERY_ATTEMPTS = 5;
/** Odstęp pulsu przy zdrowej sesji. */
export const HEALTHY_INTERVAL_MS = 10_000;
/** Najkrótszy i najdłuższy odstęp przy sesji podejrzanej (backoff). */
export const PROBE_MIN_MS = 2_000;
export const PROBE_MAX_MS = 8_000;

export type HeartbeatPhase = "online" | "degraded" | "lost";

export interface HeartbeatState {
  readonly phase: HeartbeatPhase;
  readonly consecutiveFailures: number;
  /** Znacznik pierwszej porażki bieżącej serii. */
  readonly failingSinceMs: number | null;
  readonly lastOkMs: number | null;
  readonly buildId: string | null;
  readonly recoveryAttempts: number;
  readonly lastRecoveryAtMs: number | null;
}

export type HeartbeatAction =
  | { readonly type: "ok"; readonly atMs: number; readonly buildId: string | null }
  | { readonly type: "fail"; readonly atMs: number };

export type HeartbeatEffect =
  | { readonly kind: "none" }
  | { readonly kind: "soft-refresh"; readonly reason: string }
  | { readonly kind: "reload"; readonly reason: string }
  | { readonly kind: "ask-parent"; readonly reason: string };

export interface HeartbeatTransition {
  readonly state: HeartbeatState;
  readonly effect: HeartbeatEffect;
}

export const initialHeartbeatState: HeartbeatState = {
  phase: "online",
  consecutiveFailures: 0,
  failingSinceMs: null,
  lastOkMs: null,
  buildId: null,
  recoveryAttempts: 0,
  lastRecoveryAtMs: null,
};

function recoveryAllowed(state: HeartbeatState, atMs: number): boolean {
  if (state.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) return false;
  if (state.lastRecoveryAtMs === null) return true;
  return atMs - state.lastRecoveryAtMs >= RECOVERY_COOLDOWN_MS;
}

/**
 * Jeden krok automatu. Zwraca nowy stan i efekt do wykonania przez runtime.
 *
 * Reguły:
 *  - `ok` po serii porażek: puls wrócił. Zmieniony build = przeładowanie
 *    dokumentu (chunki starego builda już nie istnieją); ten sam build =
 *    tylko miękkie odświeżenie danych, bez mrugania UI.
 *  - `fail` przez >= STUCK_MS: sesja utracona. Najpierw prosimy powłokę
 *    podglądu o przebudowę (`ask-parent`), a każda kolejna próba po
 *    cooldownie to już przeładowanie dokumentu z zachowaniem stanu.
 */
export function heartbeatStep(state: HeartbeatState, action: HeartbeatAction): HeartbeatTransition {
  if (action.type === "ok") {
    const recovered = state.phase !== "online" || state.consecutiveFailures > 0;
    const buildChanged =
      state.buildId !== null && action.buildId !== null && action.buildId !== state.buildId;
    const next: HeartbeatState = {
      phase: "online",
      consecutiveFailures: 0,
      failingSinceMs: null,
      lastOkMs: action.atMs,
      buildId: action.buildId ?? state.buildId,
      // Zdrowy puls kasuje budżet prób - kolejna awaria startuje od zera.
      recoveryAttempts: 0,
      lastRecoveryAtMs: null,
    };
    if (buildChanged) {
      return { state: next, effect: { kind: "reload", reason: "build-changed" } };
    }
    if (recovered) {
      return { state: next, effect: { kind: "soft-refresh", reason: "session-restored" } };
    }
    return { state: next, effect: { kind: "none" } };
  }

  const failingSinceMs = state.failingSinceMs ?? action.atMs;
  const elapsed = action.atMs - failingSinceMs;
  const stuck = elapsed >= STUCK_MS;
  const base: HeartbeatState = {
    ...state,
    phase: stuck ? "lost" : "degraded",
    consecutiveFailures: state.consecutiveFailures + 1,
    failingSinceMs,
  };

  if (!stuck || !recoveryAllowed(state, action.atMs)) {
    return { state: base, effect: { kind: "none" } };
  }

  const attempt = state.recoveryAttempts + 1;
  const next: HeartbeatState = {
    ...base,
    recoveryAttempts: attempt,
    lastRecoveryAtMs: action.atMs,
  };
  // Pierwsza próba jest nieinwazyjna: powłoka podglądu może przebudować
  // iframe sama, bez gubienia stanu aplikacji. Dopiero gdy to nie pomoże,
  // przeładowujemy dokument (stan odtwarzamy ze snapshotu).
  return attempt === 1
    ? { state: next, effect: { kind: "ask-parent", reason: "session-stuck" } }
    : { state: next, effect: { kind: "reload", reason: `session-stuck-retry-${attempt}` } };
}

/** Odstęp do następnego pulsu: gęsto, gdy coś jest nie tak; rzadko, gdy zdrowo. */
export function nextProbeDelayMs(state: HeartbeatState): number {
  if (state.consecutiveFailures === 0) return HEALTHY_INTERVAL_MS;
  const backoff = PROBE_MIN_MS * 2 ** (state.consecutiveFailures - 1);
  return Math.min(backoff, PROBE_MAX_MS);
}
