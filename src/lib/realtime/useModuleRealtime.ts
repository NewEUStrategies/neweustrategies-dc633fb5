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

export type ModuleRealtimeKey = "content" | "comments" | "chat" | "crm" | "newsletter" | "club";

export const MODULE_AGGREGATES: Record<ModuleRealtimeKey, readonly DomainAggregateType[]> = {
  content: ["post"],
  comments: ["comment"],
  chat: ["message"],
  crm: ["crm_lead", "crm_note", "crm_task", "newsletter_subscriber"],
  newsletter: ["newsletter_subscriber"],
  // Watek dyskusyjny jest z definicji wieloosobowy i synchroniczny: dwie osoby
  // czytajace ten sam watek musza widziec te sama tresc bez F5. Tabele club_*
  // maja RLS deny-all, wiec postgres_changes na nich nie dostarczylby nic -
  // szyna zdarzen jest tu jedynym kanalem.
  club: ["club_thread", "club_reply", "club_member"],
};

const DEFAULT_DEBOUNCE_MS = 250;

/**
 * Okno WOLNEGO PASA. Agregaty huba przychodu i statystyki ścieżek to drogie
 * zapytania (RPC liczące okno po księdze MRR, zdarzeniach, wysyłkach), a ich
 * źródła zmieniają się seriami: import CSV, tick silnika ścieżek, burza
 * webhooków. Przeliczenie po każdej ramce realtime kosztuje bazę, a czytelnik
 * wykresu nie odróżni świeżości 250 ms od 5 s. Listy i szczegóły zostają na
 * szybkim pasie - tam opóźnienie widać od razu.
 */
export const SLOW_INVALIDATION_MS = 5_000;

/**
 * Klucz wolnego pasa: każdy agregat huba (`["admin-revenue", …]`) i
 * statystyki ścieżek (`["admin", "journeys", "stats", …]`). Lista ścieżek,
 * edytor i kontakty w ścieżce NIE są wolne - to ekrany, na których admin
 * właśnie coś zmienił.
 */
export function isSlowInvalidationKey(key: QueryKey): boolean {
  return (
    key[0] === "admin-revenue" ||
    (key[0] === "admin" && key[1] === "journeys" && key[2] === "stats")
  );
}

/** Pas kolejki: zaległe klucze (deduplikacja po treści) i jego jedyny timer. */
interface InvalidationLane {
  readonly pending: Map<string, QueryKey>;
  timer: ReturnType<typeof setTimeout> | null;
}

function createLane(): InvalidationLane {
  return { pending: new Map(), timer: null };
}

/**
 * Zbiera klucze do inwalidacji i opróżnia kolejkę z debouncem; przy ukrytej
 * karcie wstrzymuje flush do powrotu widoczności (visibility-aware refresh -
 * nieaktywna karta nie odpytuje API po każdej ramce realtime).
 *
 * DWA PASY, DWA TIMERY. Klucze `isSlowInvalidationKey` czekają `slowMs`,
 * reszta `debounceMs` - wspólny timer albo opóźniałby listy o 5 s, albo
 * odświeżał agregaty co 250 ms. Timer pasa NIE jest przesuwany kolejnymi
 * zdarzeniami (okno liczy się od pierwszego), więc ciągła seria nie odkłada
 * odświeżenia w nieskończoność. Powrót karty na pierwszy plan i odmontowanie
 * opróżniają OBA pasy od razu - wolny pas nie może zgubić zaległości.
 */
export function useDebouncedInvalidation(
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
  slowMs: number = SLOW_INVALIDATION_MS,
): (keys: QueryKey[]) => void {
  const qc = useQueryClient();
  const fastRef = useRef(createLane());
  const slowRef = useRef(createLane());

  const flushLane = useCallback(
    (lane: InvalidationLane) => {
      if (lane.timer !== null) {
        clearTimeout(lane.timer);
        lane.timer = null;
      }
      if (lane.pending.size === 0) return;
      const keys = [...lane.pending.values()];
      lane.pending.clear();
      for (const queryKey of keys) {
        void qc.invalidateQueries({ queryKey });
      }
    },
    [qc],
  );

  const flush = useCallback(() => {
    flushLane(fastRef.current);
    flushLane(slowRef.current);
  }, [flushLane]);

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
      const fast = fastRef.current;
      const slow = slowRef.current;
      for (const key of keys) {
        (isSlowInvalidationKey(key) ? slow : fast).pending.set(JSON.stringify(key), key);
      }
      // Ukryta karta: czekamy na visibilitychange zamiast budzić timerami.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const schedule = (lane: InvalidationLane, ms: number) => {
        if (lane.pending.size === 0 || lane.timer !== null) return;
        lane.timer = setTimeout(() => flushLane(lane), ms);
      };
      schedule(fast, debounceMs);
      schedule(slow, slowMs);
    },
    [flushLane, debounceMs, slowMs],
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
