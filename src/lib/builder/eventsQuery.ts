// Warstwa danych widgetow wydarzen (event-list / event-countdown). Odczyt
// przez publikowalny klient Supabase - izolacje tenantow zapewnia RLS
// ("events public read": status = published + tenant z public_tenant_id(),
// naglowek x-tenant-host dokleja tenant-host-fetch). Modul jest OSOBNY od
// widokow, zeby rejestr prefetchu SSR widzial te same queryOptions co klient.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetContent } from "@/lib/builder/types";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import { edgeTtlCache } from "@/lib/ssrCache";

export type Lang = "pl" | "en";

/** Publiczne kolumny wydarzenia potrzebne widgetom (bez join_url/recording_url
 *  - te sa odciete grantem kolumnowym i dostepne tylko przez get_event_access). */
export interface EventListRow {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  description_pl: string | null;
  description_en: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string | null;
  location: string | null;
  kind: string;
  capacity: number | null;
  cover_url: string | null;
  visibility: string;
}

const EVENT_LIST_COLUMNS =
  "id, slug, title_pl, title_en, description_pl, description_en, starts_at, ends_at, timezone, location, kind, capacity, cover_url, visibility";

type EventScope = "upcoming" | "past" | "all";

export const EVENT_KINDS = [
  "webinar",
  "briefing",
  "roundtable",
  "ama",
  "in_person",
  "hybrid",
] as const;

export interface EventsListInput {
  scope: EventScope;
  kind: string;
  limit: number;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const numOf = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function safeScope(raw: string): EventScope {
  return raw === "past" || raw === "all" ? raw : "upcoming";
}

function safeKind(raw: string): string {
  return (EVENT_KINDS as readonly string[]).includes(raw) ? raw : "";
}

/** Znormalizowany input listy wydarzen - pochodna wylacznie tresci widgetu.
 *  Celowo BEZ znacznika czasu: klucz zapytania musi byc identyczny miedzy
 *  prefetchem SSR a renderem klienta; "teraz" trafia do queryFn. */
export function eventsListInput(c: WidgetContent): EventsListInput {
  return {
    scope: safeScope(strOf(c.scope)),
    kind: safeKind(strOf(c.kind)),
    limit: Math.max(1, Math.min(50, Math.round(numOf(c.limit, 6)))),
  };
}

async function fetchEventsListRows(input: EventsListInput): Promise<EventListRow[]> {
  const nowIso = new Date().toISOString();
  let q = supabase.from("events").select(EVENT_LIST_COLUMNS).eq("status", "published");
  if (input.scope === "upcoming") {
    q = q.gte("starts_at", nowIso).order("starts_at", { ascending: true });
  } else if (input.scope === "past") {
    q = q.lt("starts_at", nowIso).order("starts_at", { ascending: false });
  } else {
    q = q.order("starts_at", { ascending: false });
  }
  if (input.kind) q = q.eq("kind", input.kind);
  const { data, error } = await q.limit(input.limit);
  if (error) throw error;
  return (data ?? []) as EventListRow[];
}

export const eventsListQueryOptions = (c: WidgetContent, _lang: Lang) => {
  const input = eventsListInput(c);
  return queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.eventList, input] as const,
    queryFn: () =>
      edgeTtlCache(`builder:event-list:${JSON.stringify(input)}`, 60_000, () =>
        fetchEventsListRows(input),
      ),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });
};

/** Pojedyncze wydarzenie po id (event-countdown w trybie "event"). */
async function fetchEventById(eventId: string): Promise<EventListRow | null> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_LIST_COLUMNS)
    .eq("id", eventId)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as EventListRow | null;
}

export const eventByIdQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.eventById, eventId] as const,
    queryFn: () =>
      eventId
        ? edgeTtlCache(`builder:event-by-id:${eventId}`, 60_000, () => fetchEventById(eventId))
        : Promise.resolve(null),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

/** Liczniki RSVP (going/interested) dla kart wydarzen - definerowe RPC,
 *  bo wiersze event_rsvps sa owner-only. */
export interface EventRsvpCount {
  going: number;
  interested: number;
}

async function fetchRsvpCounts(eventIds: string[]): Promise<Map<string, EventRsvpCount>> {
  const out = new Map<string, EventRsvpCount>();
  if (eventIds.length === 0) return out;
  const { data, error } = await supabase.rpc("get_event_rsvp_counts", {
    p_event_ids: eventIds,
  });
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    event_id: string;
    going: number;
    interested: number;
  }>) {
    out.set(row.event_id, {
      going: Math.max(0, row.going ?? 0),
      interested: Math.max(0, row.interested ?? 0),
    });
  }
  return out;
}

export const eventRsvpCountsQueryOptions = (eventIds: string[]) => {
  const ids = Array.from(new Set(eventIds)).sort();
  return queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.eventRsvpCounts, ids] as const,
    queryFn: () => fetchRsvpCounts(ids),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
};
