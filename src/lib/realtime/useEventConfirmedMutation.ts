// Optymistyczne mutacje z rollbackiem potwierdzanym zdarzeniem domenowym.
//
// Wzorzec: mutacja -> natychmiastowa łatka w cache -> jeśli w oknie czasowym
// (domyślnie 3 s) nie przyjdzie potwierdzający domain_event z tym samym
// correlation_id, łatka jest wycofywana i cache odświeżany z serwera.
// Eliminuje to zarówno flicker (optimistic update), jak i "znika po refresh"
// (zapis, który w rzeczywistości nie doszedł do skutku, nie zostaje w cache).
//
// Correlation id wędruje nagłówkiem x-correlation-id (runWithCorrelation ->
// correlation-fetch), a triggery DB zapisują go w domain_events.
import { useRef } from "react";
import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  awaitDomainEvent,
  newCorrelationId,
  runWithCorrelation,
  type AwaitDomainEventOptions,
} from "./correlation";
import type { DomainEventRow, DomainEventType } from "./domainEvents";

export interface MutationCorrelationContext {
  correlationId: string;
}

export interface EventConfirmedMutationOptions<TData, TVariables, TCache> {
  /** Właściwa mutacja - wywoływana wewnątrz runWithCorrelation. */
  mutationFn: (variables: TVariables, ctx: MutationCorrelationContext) => Promise<TData>;
  /** Cache, który łatamy optymistycznie. */
  queryKey: QueryKey;
  /** Czysta funkcja: aktualna wartość cache + zmienne -> wartość optymistyczna. */
  optimisticUpdate: (current: TCache | undefined, variables: TVariables) => TCache | undefined;
  /** Typy zdarzeń uznawane za potwierdzenie (domyślnie: dowolne z tym correlation_id). */
  confirmEventTypes?: readonly DomainEventType[];
  /** Okno na potwierdzenie; po nim rollback. Domyślnie 3000 ms. */
  confirmTimeoutMs?: number;
  /** Dodatkowe klucze do odświeżenia po potwierdzeniu/rollbacku. */
  invalidateKeys?: QueryKey[];
  onConfirmed?: (event: DomainEventRow, variables: TVariables) => void;
  onRolledBack?: (variables: TVariables) => void;
}

interface OptimisticSnapshot<TCache> {
  previous: TCache | undefined;
  correlationId: string;
}

export function useEventConfirmedMutation<TData, TVariables, TCache>(
  options: EventConfirmedMutationOptions<TData, TVariables, TCache>,
): UseMutationResult<TData, Error, TVariables, OptimisticSnapshot<TCache>> {
  const qc = useQueryClient();
  // Correlation id musi powstać w onMutate, a być widoczny w mutationFn -
  // przekazujemy go przez ref (React Query nie daje wspólnego kontekstu
  // między onMutate a mutationFn w tę stronę).
  const correlationRef = useRef<string>("");

  const invalidateAll = (variables: TVariables) => {
    void variables;
    void qc.invalidateQueries({ queryKey: options.queryKey });
    for (const key of options.invalidateKeys ?? []) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };

  return useMutation<TData, Error, TVariables, OptimisticSnapshot<TCache>>({
    onMutate: async (variables) => {
      const correlationId = newCorrelationId();
      correlationRef.current = correlationId;
      await qc.cancelQueries({ queryKey: options.queryKey });
      const previous = qc.getQueryData<TCache>(options.queryKey);
      qc.setQueryData<TCache>(options.queryKey, (current) =>
        options.optimisticUpdate(current, variables),
      );
      return { previous, correlationId };
    },
    mutationFn: (variables) => {
      const correlationId = correlationRef.current || newCorrelationId();
      return runWithCorrelation(correlationId, () =>
        options.mutationFn(variables, { correlationId }),
      );
    },
    onError: (_error, variables, context) => {
      // Serwer odmówił: natychmiastowy rollback do snapshotu.
      if (context) qc.setQueryData<TCache>(options.queryKey, context.previous);
      invalidateAll(variables);
      options.onRolledBack?.(variables);
    },
    onSuccess: (_data, variables, context) => {
      if (!context) return;
      const awaitOptions: AwaitDomainEventOptions = {
        timeoutMs: options.confirmTimeoutMs ?? 3000,
        ...(options.confirmEventTypes ? { eventTypes: options.confirmEventTypes } : {}),
      };
      void awaitDomainEvent(context.correlationId, awaitOptions)
        .then((event) => {
          // Potwierdzone na szynie: cache i tak odświeżamy do prawdy serwera.
          invalidateAll(variables);
          options.onConfirmed?.(event, variables);
        })
        .catch(() => {
          // Brak potwierdzenia: zapis mógł nie zajść - wycofaj łatkę,
          // a prawdę i tak dociągnie invalidacja.
          qc.setQueryData<TCache>(options.queryKey, context.previous);
          invalidateAll(variables);
          options.onRolledBack?.(variables);
        });
    },
  });
}
