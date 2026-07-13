// Publiczne fetchery Community konsumowane przez route'y produktowe.
// Odczyty list przez publikowalny klient (RLS: policies "* public read");
// zapisy i dane wrażliwe WYŁĄCZNIE przez utwardzone RPC (rate limity, limit
// miejsc pod FOR UPDATE, bramki warstw, anti-anchoring ankiet, anonimowość
// Chatham House) - nigdy bezpośrednimi insertami do tabel.
import { supabase } from "@/integrations/supabase/client";

export interface PublicEvent {
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
  status: string;
  chatham_house: boolean;
  cover_url: string | null;
  host_user_id: string | null;
  visibility: string;
  min_tier_rank: number;
}

// join_url/recording_url są odcięte grantem kolumnowym (SELECT bez tych
// kolumn dla anon/authenticated) - jedyną ścieżką jest RPC get_event_access.
const EVENT_COLUMNS =
  "id, slug, title_pl, title_en, description_pl, description_en, starts_at, ends_at, timezone, location, kind, capacity, status, chatham_house, cover_url, host_user_id, visibility, min_tier_rank";

export async function fetchPublicEvents(): Promise<PublicEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("status", "published")
    .order("starts_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as PublicEvent[];
}

export async function fetchPublicEventBySlug(slug: string): Promise<PublicEvent | null> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as PublicEvent | null;
}

export interface EventAccess {
  can_join: boolean;
  join_url: string | null;
  can_watch: boolean;
  recording_url: string | null;
  reason: "not_found" | "auth_required" | "tier_required" | "rsvp_required" | "ok";
}

/** Serwerowa ocena dostępu (link do transmisji/nagrania, powód odmowy). */
export async function fetchEventAccess(eventId: string): Promise<EventAccess | null> {
  const { data, error } = await supabase.rpc("get_event_access", { p_event_id: eventId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as EventAccess | null;
}

export interface EventRsvpCounts {
  event_id: string;
  going: number;
  interested: number;
}

export async function fetchEventRsvpCounts(
  eventIds: string[],
): Promise<Map<string, EventRsvpCounts>> {
  const map = new Map<string, EventRsvpCounts>();
  if (eventIds.length === 0) return map;
  const { data, error } = await supabase.rpc("get_event_rsvp_counts", {
    p_event_ids: eventIds,
  });
  if (error) throw error;
  for (const row of (data ?? []) as EventRsvpCounts[]) map.set(row.event_id, row);
  return map;
}

/** RSVP przez RPC: limit miejsc, bramka warstwy i statusy egzekwowane w DB. */
export async function rsvpEvent(
  eventId: string,
  status: "going" | "interested" | "cancelled",
): Promise<{ status: string; going: number }> {
  const { data, error } = await supabase.rpc("rsvp_event", {
    p_event_id: eventId,
    p_status: status,
  });
  if (error) throw error;
  return (data ?? { status, going: 0 }) as { status: string; going: number };
}

export interface PublicPoll {
  id: string;
  question_pl: string;
  question_en: string;
  options: Array<{ pl: string; en: string }>;
  status: string;
  ends_at: string | null;
}

export async function fetchPublicPolls(): Promise<PublicPoll[]> {
  const { data, error } = await supabase
    .from("polls")
    .select("id, question_pl, question_en, options, status, ends_at")
    .in("status", ["open", "closed"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    options: Array.isArray(row.options) ? (row.options as Array<{ pl: string; en: string }>) : [],
  })) as PublicPoll[];
}

/**
 * Wynik ankiety wg serwera. Anti-anchoring: dopóki użytkownik nie zagłosuje
 * (a ankieta jest otwarta i nie jest się staffem), visible=false i liczb nie
 * ma - rozkład głosów nie może zakotwiczać wyboru.
 */
export interface PollResults {
  visible: boolean;
  my_vote: number | null;
  total: number;
  counts: number[];
}

function parsePollResult(raw: unknown): PollResults {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    visible: obj.visible === true,
    my_vote: typeof obj.my_vote === "number" ? obj.my_vote : null,
    total: typeof obj.total === "number" ? obj.total : 0,
    counts: Array.isArray(obj.counts) ? (obj.counts as number[]) : [],
  };
}

export async function fetchPollResults(pollIds: string[]): Promise<Map<string, PollResults>> {
  const map = new Map<string, PollResults>();
  if (pollIds.length === 0) return map;
  // `as never`: RPC z migracji 20260713200000, jeszcze nie w wygenerowanych
  // typach - do usunięcia przy regeneracji types.ts.
  const { data, error } = await supabase.rpc(
    "get_poll_results_bulk" as never,
    {
      p_poll_ids: pollIds,
    } as never,
  );
  if (error) throw error;
  for (const row of (data ?? []) as unknown as Array<{ poll_id: string; result: unknown }>) {
    map.set(row.poll_id, parsePollResult(row.result));
  }
  return map;
}

/** Głos przez RPC (walidacja opcji i okna czasowego); zwraca świeże wyniki. */
export async function votePoll(pollId: string, optionIdx: number): Promise<PollResults> {
  const { data, error } = await supabase.rpc("vote_poll", {
    p_poll_id: pollId,
    p_option_idx: optionIdx,
  });
  if (error) throw error;
  return parsePollResult(data);
}

export interface PublicQaSession {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  intro_pl: string | null;
  intro_en: string | null;
  status: string;
  opens_at: string | null;
  closes_at: string | null;
  host_user_id: string | null;
}

export async function fetchPublicQaSessions(): Promise<PublicQaSession[]> {
  const { data, error } = await supabase
    .from("qa_sessions")
    .select(
      "id, slug, title_pl, title_en, intro_pl, intro_en, status, opens_at, closes_at, host_user_id",
    )
    .neq("status", "draft")
    .order("opens_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as PublicQaSession[];
}

export async function fetchPublicQaSessionBySlug(slug: string): Promise<PublicQaSession | null> {
  const { data, error } = await supabase
    .from("qa_sessions")
    .select(
      "id, slug, title_pl, title_en, intro_pl, intro_en, status, opens_at, closes_at, host_user_id",
    )
    .eq("slug", slug)
    .neq("status", "draft")
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as PublicQaSession | null;
}

export interface PublicQaQuestion {
  id: string;
  session_id: string;
  author_display: string | null;
  is_anonymous: boolean;
  body: string;
  status: string;
  answer_body: string | null;
  answered_at: string | null;
  created_at: string;
  votes: number;
  /** Autor ma flagę qa_priority (tier Pro) - pytanie w kolejce priorytetowej. */
  is_priority: boolean;
}

/**
 * Pytania sesji w porządku serwerowym: priorytet Pro > głosy > starszeństwo.
 * user_id nie opuszcza bazy (anonimowość); głosy policzone w jednej podróży.
 */
export async function fetchPublicQaQuestions(sessionId: string): Promise<PublicQaQuestion[]> {
  // `as never`: RPC z migracji 20260713200000, jeszcze nie w wygenerowanych
  // typach - do usunięcia przy regeneracji types.ts.
  const { data, error } = await supabase.rpc(
    "list_qa_questions" as never,
    {
      p_session_id: sessionId,
    } as never,
  );
  if (error) throw error;
  return (data ?? []) as unknown as PublicQaQuestion[];
}

/**
 * Pytanie przez RPC: status sesji, rate limit 5/h i bezpieczny author_display
 * (nazwa profilu, nigdy pełny e-mail) egzekwowane serwerowo + powiadomienie
 * hosta sesji.
 */
export async function askQaQuestion(args: {
  sessionId: string;
  body: string;
  anonymous: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc("ask_qa_question", {
    p_session_id: args.sessionId,
    p_body: args.body,
    p_anonymous: args.anonymous,
  });
  if (error) throw error;
  return data as string;
}
