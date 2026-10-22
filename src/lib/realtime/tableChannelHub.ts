// Wspólny hub kanałów Realtime (postgres_changes) - jedna implementacja
// zamiast kanału per hook. Kanały są współdzielone per (schema, table, event,
// filter) i zliczane referencyjnie na poziomie modułu: niezależnie od liczby
// subskrybentów (dzwonek, dock, strona) istnieje dokładnie jeden websocketowy
// kanał na daną specyfikację - handlery są rozgłaszane lokalnie.
//
// SSR-safe: subskrypcje wolno zakładać tylko w efektach (przeglądarka);
// na serwerze subscribeToTable jest no-opem zwracającym pusty unsubscribe.
//
// STAN KANAŁU (I9, Z-S7-05). `.subscribe(status)` supabase-js zgłasza
// `SUBSCRIBED`, `CHANNEL_ERROR`, `TIMED_OUT` i `CLOSED`; hub zapamiętuje
// ostatni stan żywego kanału i powiadamia słuchaczy, żeby ekran mógł
// powiedzieć „aktualizacje na żywo wstrzymane" zamiast cicho pokazywać
// liczby, których żadne zdarzenie już nie odświeży. Stan zamkniętego przez
// nas kanału (ostatni unsubscribe) nie jest awarią i znika razem z wpisem.
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type TableChangeEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

export interface TableSubscriptionSpec {
  table: string;
  schema?: string;
  /** Domyślnie "*" - wszystkie operacje. */
  event?: TableChangeEvent;
  /** Filtr PostgREST, np. `user_id=eq.<uuid>`. */
  filter?: string;
}

export type TableChangeRow = Record<string, unknown>;
export type TableChangeHandler = (payload: RealtimePostgresChangesPayload<TableChangeRow>) => void;

/** Stan kanału zgłaszany przez `.subscribe(status)` supabase-js. */
export type TableChannelStatus = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";

interface HubEntry {
  channel: RealtimeChannel;
  handlers: Set<TableChangeHandler>;
  table: string;
  /** `null` = kanał jeszcze nie zgłosił stanu (łączy się). */
  status: TableChannelStatus | null;
}

const entries = new Map<string, HubEntry>();
const statusListeners = new Set<() => void>();

const CHANNEL_STATUSES: readonly string[] = ["SUBSCRIBED", "TIMED_OUT", "CLOSED", "CHANNEL_ERROR"];

function isChannelStatus(value: string): value is TableChannelStatus {
  return CHANNEL_STATUSES.includes(value);
}

function notifyStatus(): void {
  for (const listener of statusListeners) listener();
}

function specKey(spec: TableSubscriptionSpec): string {
  return [spec.schema ?? "public", spec.table, spec.event ?? "*", spec.filter ?? ""].join("|");
}

/**
 * Subskrybuje zmiany tabeli przez współdzielony kanał. Zwraca unsubscribe;
 * ostatni subskrybent zamyka kanał.
 */
export function subscribeToTable(
  spec: TableSubscriptionSpec,
  handler: TableChangeHandler,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const key = specKey(spec);
  let entry = entries.get(key);
  if (!entry) {
    // Losowy sufiks nazwy: ponowne użycie tej samej nazwy kanału zwraca już
    // zasubskrybowaną instancję, która odrzuca nowe callbacki `.on()`
    // (StrictMode double-mount, remount po wylogowaniu).
    const channelName = `hub:${key}:${Math.random().toString(36).slice(2, 10)}`;
    const created: HubEntry = {
      channel: supabase.channel(channelName),
      handlers: new Set(),
      table: spec.table,
      status: null,
    };
    created.channel
      .on(
        "postgres_changes",
        {
          event: (spec.event ?? "*") as "*",
          schema: spec.schema ?? "public",
          table: spec.table,
          ...(spec.filter ? { filter: spec.filter } : {}),
        },
        (payload: RealtimePostgresChangesPayload<TableChangeRow>) => {
          for (const h of created.handlers) h(payload);
        },
      )
      .subscribe((status: string) => {
        // Stan przychodzi też po naszym `removeChannel` (CLOSED) - liczy się
        // wyłącznie kanał, który wciąż jest w hubie.
        if (entries.get(key) !== created || !isChannelStatus(status)) return;
        created.status = status;
        notifyStatus();
      });
    entries.set(key, created);
    entry = created;
  }

  entry.handlers.add(handler);

  return () => {
    const current = entries.get(key);
    if (!current) return;
    current.handlers.delete(handler);
    if (current.handlers.size === 0) {
      entries.delete(key);
      void supabase.removeChannel(current.channel);
      // Zamknięty kanał z awarią nie może dalej zgłaszać „wstrzymane".
      if (current.status !== null && current.status !== "SUBSCRIBED") notifyStatus();
    }
  };
}

/**
 * Czy któryś żywy kanał tabeli jest przerwany (błąd, przekroczony czas,
 * zamknięcie po stronie serwera). Kanał, który jeszcze się łączy, nie jest
 * przerwany - inaczej każde wejście na ekran mrugałoby banerem.
 */
export function tableChannelsInterrupted(table: string): boolean {
  for (const entry of entries.values()) {
    if (entry.table === table && entry.status !== null && entry.status !== "SUBSCRIBED") {
      return true;
    }
  }
  return false;
}

/** Słuchacz zmian stanu kanałów (`useSyncExternalStore`). Zwraca wypisanie. */
export function subscribeToChannelStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/** Liczba aktywnych współdzielonych kanałów - do testów i diagnostyki. */
export function activeChannelCount(): number {
  return entries.size;
}
