// Strumień zdarzeń domenowych: jeden hook subskrybujący INSERT-y na
// domain_events przez współdzielony tableChannelHub. Moduły nie nasłuchują
// już "swoich" tabel - słuchają zdarzeń domenowych z filtrem po agregacie.
//
// Filtr serwerowy: aggregate_type (jedna kolumna - tyle wspiera
// postgres_changes); aggregate_id doprecyzowujemy po stronie klienta.
// RLS na domain_events i tak tnie strumień per użytkownik (staff widzi
// zdarzenia tenanta, zwykły użytkownik tylko własne).
import { useEffect, useRef } from "react";
import { subscribeToTable } from "./tableChannelHub";
import { feedCorrelationTracker } from "./correlation";
import type { DomainEventRow } from "./domainEvents";

export interface DomainEventStreamOptions {
  /** Np. "crm_lead" - filtr serwerowy; brak = wszystkie zdarzenia. */
  aggregateType?: string;
  /** Doprecyzowanie do jednej encji (filtr kliencki). */
  aggregateId?: string;
  enabled?: boolean;
  onEvent: (event: DomainEventRow) => void;
}

function isDomainEventRow(row: unknown): row is DomainEventRow {
  if (!row || typeof row !== "object") return false;
  const candidate = row as Record<string, unknown>;
  return (
    typeof candidate.event_type === "string" &&
    typeof candidate.aggregate_type === "string" &&
    typeof candidate.aggregate_id === "string"
  );
}

/**
 * Nie-hookowa subskrypcja strumienia zdarzeń (współdzielona przez
 * useDomainEventStream i useModuleRealtime). Zwraca unsubscribe.
 */
export function subscribeToDomainEvents(
  aggregateType: string | undefined,
  onEvent: (event: DomainEventRow) => void,
): () => void {
  return subscribeToTable(
    {
      table: "domain_events",
      event: "INSERT",
      ...(aggregateType ? { filter: `aggregate_type=eq.${aggregateType}` } : {}),
    },
    (payload) => {
      const row = payload.new;
      if (!isDomainEventRow(row)) return;
      // Każde widziane zdarzenie zasila tracker korelacji - potwierdzenia
      // optymistycznych mutacji nie wymagają dodatkowego kanału.
      feedCorrelationTracker(row);
      onEvent(row);
    },
  );
}

export function useDomainEventStream(options: DomainEventStreamOptions): void {
  const { aggregateType, aggregateId, enabled = true } = options;
  // Handler w ref-ie: zmiana callbacku nie może przepinać websocketu.
  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;

  useEffect(() => {
    if (!enabled) return;
    return subscribeToDomainEvents(aggregateType, (row) => {
      if (aggregateId && row.aggregate_id !== aggregateId) return;
      onEventRef.current(row);
    });
  }, [aggregateType, aggregateId, enabled]);
}
