// Correlation id od kliknięcia do zdarzenia domenowego.
//
// Frontend generuje uuid i wysyła go nagłówkiem x-correlation-id (wpinany do
// fetch-a klienta Supabase w correlation-fetch.ts); emitery w DB czytają go z
// request.headers i zapisują w domain_events.correlation_id. Dzięki temu:
//   * getCorrelatedEvents(id) zwraca pełny ślad "co się wydarzyło po moim
//     kliknięciu" (explainability + debug),
//   * awaitDomainEvent(id) potwierdza optymistyczne mutacje - brak
//     potwierdzenia w oknie czasowym oznacza rollback (useEventConfirmedMutation).
import { supabase } from "@/integrations/supabase/client";
import type { DomainEventRow } from "./domainEvents";

// Kontekst (generowanie id + stos dla fetch-a) żyje w osobnym module bez
// zależności od klienta Supabase; tu tylko re-eksport dla wygody konsumentów.
export {
  CORRELATION_HEADER,
  currentCorrelationId,
  newCorrelationId,
  runWithCorrelation,
} from "./correlationContext";

// ---------------------------------------------------------------------------
// Tracker: obietnice czekające na zdarzenie z danym correlation_id. Zasilany
// przez każdy strumień zdarzeń (useDomainEventStream). Na timeout robimy
// jeszcze jedno bezpośrednie zapytanie (get_correlated_events) - gdyby
// realtime zgubił ramkę, prawda z bazy nadal wygrywa.
// ---------------------------------------------------------------------------
interface CorrelationWaiter {
  resolve: (event: DomainEventRow) => void;
  reject: (error: Error) => void;
  eventTypes: readonly string[] | null;
  timer: ReturnType<typeof setTimeout>;
}

const waiters = new Map<string, Set<CorrelationWaiter>>();

export class CorrelationTimeoutError extends Error {
  readonly correlationId: string;
  constructor(correlationId: string) {
    super(`No confirming domain event for correlation ${correlationId}`);
    this.name = "CorrelationTimeoutError";
    this.correlationId = correlationId;
  }
}

/** Zasil tracker zdarzeniem widzianym w strumieniu realtime. */
export function feedCorrelationTracker(event: DomainEventRow): void {
  if (!event.correlation_id) return;
  const set = waiters.get(event.correlation_id);
  if (!set) return;
  for (const waiter of [...set]) {
    if (waiter.eventTypes && !waiter.eventTypes.includes(event.event_type)) continue;
    clearTimeout(waiter.timer);
    set.delete(waiter);
    waiter.resolve(event);
  }
  if (set.size === 0) waiters.delete(event.correlation_id);
}

export interface AwaitDomainEventOptions {
  /** Domyślnie 3000 ms - okno potwierdzenia optymistycznej mutacji. */
  timeoutMs?: number;
  /** Zawęź potwierdzenie do konkretnych typów zdarzeń. */
  eventTypes?: readonly string[];
}

export async function awaitDomainEvent(
  correlationId: string,
  options: AwaitDomainEventOptions = {},
): Promise<DomainEventRow> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const eventTypes = options.eventTypes ?? null;

  return new Promise<DomainEventRow>((resolve, reject) => {
    const waiter: CorrelationWaiter = {
      resolve,
      reject,
      eventTypes,
      timer: setTimeout(() => {
        const set = waiters.get(correlationId);
        if (set) {
          set.delete(waiter);
          if (set.size === 0) waiters.delete(correlationId);
        }
        // Ostatnia szansa: realtime mógł zgubić ramkę - spytaj bazę wprost.
        void fetchCorrelatedEvents(correlationId)
          .then((events) => {
            const match = events.find((e) => !eventTypes || eventTypes.includes(e.event_type));
            if (match) resolve(match);
            else reject(new CorrelationTimeoutError(correlationId));
          })
          .catch(() => reject(new CorrelationTimeoutError(correlationId)));
      }, timeoutMs),
    };
    let set = waiters.get(correlationId);
    if (!set) {
      set = new Set();
      waiters.set(correlationId, set);
    }
    set.add(waiter);
  });
}

/** Pełny ślad korelacji z bazy (RPC; RLS decyduje o widoczności). */
export async function fetchCorrelatedEvents(correlationId: string): Promise<DomainEventRow[]> {
  const { data, error } = await supabase.rpc("get_correlated_events", {
    p_correlation_id: correlationId,
  });
  if (error) throw error;
  return data ?? [];
}

/** Liczba oczekujących waiterów - do testów. */
export function pendingCorrelationCount(): number {
  let count = 0;
  for (const set of waiters.values()) count += set.size;
  return count;
}
