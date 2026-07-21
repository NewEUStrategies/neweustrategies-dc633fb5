// Ujednolicony realtime per moduł: JEDNA implementacja debouncingu,
// odświeżania świadomego widoczności karty i mapy inwalidacji zapytań.
// Moduł deklaruje tylko swoje agregaty; reguły "zdarzenie -> klucze" żyją
// w eventInvalidationMap.
//
//   useModuleRealtime("crm")   - strona CRM odświeża się po zdarzeniach CRM;
//   useDomainEventInvalidation() - montowane raz globalnie (root) dla
//     zalogowanych: wszystkie zdarzenia widoczne dla użytkownika (RLS tnie
//     strumień) przechodzą przez mapę inwalidacji.
import { useCallback, useEffect, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { subscribeToDomainEvents } from "./useDomainEventStream";
import { invalidationKeysFor } from "./eventInvalidationMap";
import type { DomainAggregateType, DomainEventRow } from "./domainEvents";

export type ModuleRealtimeKey = "content" | "comments" | "chat" | "crm" | "newsletter";

export const MODULE_AGGREGATES: Record<ModuleRealtimeKey, readonly DomainAggregateType[]> = {
  content: ["post"],
  comments: ["comment"],
  chat: ["message"],
  crm: ["crm_lead", "crm_note", "crm_task", "newsletter_subscriber"],
  newsletter: ["newsletter_subscriber"],
};

const DEFAULT_DEBOUNCE_MS = 250;

/**
 * Zbiera klucze do inwalidacji i opróżnia kolejkę z debouncem; przy ukrytej
 * karcie wstrzymuje flush do powrotu widoczności (visibility-aware refresh -
 * nieaktywna karta nie odpytuje API po każdej ramce realtime).
 */
export function useDebouncedInvalidation(
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): (keys: QueryKey[]) => void {
  const qc = useQueryClient();
  const pendingRef = useRef(new Map<string, QueryKey>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending.size === 0) return;
    const keys = [...pending.values()];
    pending.clear();
    for (const queryKey of keys) {
      void qc.invalidateQueries({ queryKey });
    }
  }, [qc]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") flush();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      flush();
    };
  }, [flush]);

  return useCallback(
    (keys: QueryKey[]) => {
      const pending = pendingRef.current;
      for (const key of keys) pending.set(JSON.stringify(key), key);
      if (pending.size === 0) return;
      // Ukryta karta: czekamy na visibilitychange zamiast budzić timerami.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (timerRef.current) return;
      timerRef.current = setTimeout(flush, debounceMs);
    },
    [flush, debounceMs],
  );
}

export interface ModuleRealtimeOptions {
  enabled?: boolean;
  /** Dodatkowa reakcja na każde zdarzenie modułu (poza inwalidacją). */
  onEvent?: (event: DomainEventRow) => void;
}

export function useModuleRealtime(
  moduleKey: ModuleRealtimeKey,
  options: ModuleRealtimeOptions = {},
): void {
  const { enabled = true } = options;
  const { user } = useAuth();
  const uid = user?.id;
  const invalidate = useDebouncedInvalidation();
  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;

  useEffect(() => {
    if (!enabled || !uid) return;
    const unsubscribes = MODULE_AGGREGATES[moduleKey].map((aggregateType) =>
      subscribeToDomainEvents(aggregateType, (event) => {
        invalidate(invalidationKeysFor(event, { userId: uid }));
        onEventRef.current?.(event);
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [moduleKey, enabled, uid, invalidate]);
}

/**
 * Globalny konsument szyny dla zalogowanych - montowany raz w root layout.
 * Jeden kanał (bez filtra agregatu), mapa inwalidacji decyduje, które cache
 * odświeżyć; przy okazji zasila tracker korelacji dla optymistycznych mutacji.
 */
export function useDomainEventInvalidation(): void {
  const { user } = useAuth();
  const uid = user?.id;
  const invalidate = useDebouncedInvalidation();

  useEffect(() => {
    if (!uid) return;
    return subscribeToDomainEvents(undefined, (event) => {
      invalidate(invalidationKeysFor(event, { userId: uid }));
    });
  }, [uid, invalidate]);
}
