// Wspólny hub kanałów Realtime (postgres_changes) - jedna implementacja
// zamiast kanału per hook. Kanały są współdzielone per (schema, table, event,
// filter) i zliczane referencyjnie na poziomie modułu: niezależnie od liczby
// subskrybentów (dzwonek, dock, strona) istnieje dokładnie jeden websocketowy
// kanał na daną specyfikację - handlery są rozgłaszane lokalnie.
//
// SSR-safe: subskrypcje wolno zakładać tylko w efektach (przeglądarka);
// na serwerze subscribeToTable jest no-opem zwracającym pusty unsubscribe.
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

interface HubEntry {
  channel: RealtimeChannel;
  handlers: Set<TableChangeHandler>;
}

const entries = new Map<string, HubEntry>();

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
    const created: HubEntry = { channel: supabase.channel(channelName), handlers: new Set() };
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
      .subscribe();
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
    }
  };
}

/** Liczba aktywnych współdzielonych kanałów - do testów i diagnostyki. */
export function activeChannelCount(): number {
  return entries.size;
}
