// Publiczne fetchery Community konsumowane przez route'y produktowe.
// Wszystko przez publikowalny klient (RLS: policies "* public read").
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
  join_url: string | null;
  recording_url: string | null;
  kind: string;
  capacity: number | null;
  status: string;
  chatham_house: boolean;
  cover_url: string | null;
  host_user_id: string | null;
}

export async function fetchPublicEvents(): Promise<PublicEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, slug, title_pl, title_en, description_pl, description_en, starts_at, ends_at, timezone, location, join_url, recording_url, kind, capacity, status, chatham_house, cover_url, host_user_id",
    )
    .eq("status", "published")
    .order("starts_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as PublicEvent[];
}

export async function fetchPublicEventBySlug(slug: string): Promise<PublicEvent | null> {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, slug, title_pl, title_en, description_pl, description_en, starts_at, ends_at, timezone, location, join_url, recording_url, kind, capacity, status, chatham_house, cover_url, host_user_id",
    )
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as PublicEvent | null;
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
    options: Array.isArray(row.options)
      ? (row.options as Array<{ pl: string; en: string }>)
      : [],
  })) as PublicPoll[];
}

export interface PollVoteCounts {
  poll_id: string;
  counts: number[];
  my_choice: number | null;
  total: number;
}

export async function fetchPollVotes(pollIds: string[], me: string | null): Promise<Map<string, PollVoteCounts>> {
  if (pollIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("poll_votes")
    .select("poll_id, option_idx, user_id")
    .in("poll_id", pollIds);
  if (error) throw error;
  const map = new Map<string, PollVoteCounts>();
  for (const id of pollIds) {
    map.set(id, { poll_id: id, counts: [], my_choice: null, total: 0 });
  }
  for (const row of data ?? []) {
    const entry = map.get(row.poll_id as string);
    if (!entry) continue;
    const idx = Number(row.option_idx ?? 0);
    entry.counts[idx] = (entry.counts[idx] ?? 0) + 1;
    entry.total += 1;
    if (me && row.user_id === me) entry.my_choice = idx;
  }
  return map;
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
    .select("id, slug, title_pl, title_en, intro_pl, intro_en, status, opens_at, closes_at, host_user_id")
    .neq("status", "draft")
    .order("opens_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as PublicQaSession[];
}

export async function fetchPublicQaSessionBySlug(slug: string): Promise<PublicQaSession | null> {
  const { data, error } = await supabase
    .from("qa_sessions")
    .select("id, slug, title_pl, title_en, intro_pl, intro_en, status, opens_at, closes_at, host_user_id")
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
}

export async function fetchPublicQaQuestions(sessionId: string): Promise<PublicQaQuestion[]> {
  const { data, error } = await supabase
    .from("qa_questions")
    .select(
      "id, session_id, author_display, is_anonymous, body, status, answer_body, answered_at, created_at",
    )
    .eq("session_id", sessionId)
    .in("status", ["approved", "answered"])
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as PublicQaQuestion[];
}

export async function fetchQaQuestionVotes(questionIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (questionIds.length === 0) return map;
  const { data, error } = await supabase
    .from("qa_question_votes")
    .select("question_id")
    .in("question_id", questionIds);
  if (error) throw error;
  for (const row of data ?? []) {
    const id = row.question_id as string;
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}
