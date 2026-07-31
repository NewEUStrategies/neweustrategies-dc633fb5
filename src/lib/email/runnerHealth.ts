// Stan zdrowia automatu wysyłki - czysty moduł bez I/O.
//
// „Włączony" to nie to samo co „działa". Runner ma trzy niezależne sygnały
// (przełącznik, adres, telemetria ostatniego ticku), a operator potrzebuje
// JEDNEJ odpowiedzi. Rozstrzyganie żyje tutaj, żeby panel i test mówiły
// dokładnie to samo i żeby komponent kafla eksportował już tylko komponenty.

export type RunnerState = "running" | "idle" | "misconfigured" | "disabled" | "error";

/** Wynik ostatniej próby ticku zapisany przez `invoke_jobs_tick()`. */
export type RunnerTickStatus = "dispatched" | "skipped" | "error" | null;

/** Minimalny kontrakt wejściowy - tylko pola, które rozstrzygają stan. */
export interface RunnerHealthInput {
  enabled: boolean;
  /** Adres, którego cron NAPRAWDĘ użyje (konfiguracja albo domena tenanta). */
  effective_base_url: string;
  last_tick_at: string | null;
  last_tick_status: RunnerTickStatus;
}

/**
 * Kolejność rozstrzygania odpowiada kolejności przyczyn:
 *
 *   1. wyłączony - stan nadrzędny, reszta pól nic wtedy nie znaczy,
 *   2. brak adresu - cron nie ma gdzie zapukać, więc „nie było ticku" jest
 *      tylko skutkiem, nie diagnozą,
 *   3. błąd ostatniej próby - konkretna, naprawialna przyczyna,
 *   4. brak ticku albo tick pominięty (np. brak pg_net) - włączony, ale bezczynny,
 *   5. tick dotarł - działa.
 */
export function resolveRunnerState(settings: RunnerHealthInput | null | undefined): RunnerState {
  if (!settings || !settings.enabled) return "disabled";
  if (!settings.effective_base_url) return "misconfigured";
  if (settings.last_tick_status === "error") return "error";
  if (!settings.last_tick_at) return "idle";
  return settings.last_tick_status === "skipped" ? "idle" : "running";
}
