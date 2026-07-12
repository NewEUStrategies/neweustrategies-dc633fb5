// Panel superadmina Community — warstwa danych (queries + mutations) dla
// modułów: Chat, Events, Q&A. Współdzielona przez /admin/community/*.
//
// Zasady:
//  - Dostęp do wszystkich rekordów odbywa się dzięki RLS "*_staff_*"
//    (has_role admin | super_admin | editor). Klient używa zwykłego supabase.
//  - Toggle modułów w site_settings.community_modules — globalne włączanie/
//    wyłączanie funkcji app'a.
//  - Metryki w admin_community_stats() (jeden round-trip).
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

export interface CommunityModulesSettings {
  chat_enabled: boolean;
  events_enabled: boolean;
  qa_enabled: boolean;
  polls_enabled: boolean;
  default_message_ttl_seconds: number | null;
}

export const COMMUNITY_MODULES_DEFAULTS: CommunityModulesSettings = {
  chat_enabled: true,
  events_enabled: true,
  qa_enabled: true,
  polls_enabled: true,
  default_message_ttl_seconds: null,
};

export const COMMUNITY_MODULES_KEY = "community_modules";

export interface CommunityStats {
  conversations_total: number;
  messages_last_24h: number;
  events_upcoming: number;
  events_drafts: number;
  qa_sessions_open: number;
  qa_questions_pending: number;
}

export async function fetchCommunityStats(): Promise<CommunityStats> {
  const { data, error } = await supabase.rpc("admin_community_stats");
  if (error) throw error;
  const obj = (data ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
  return {
    conversations_total: n(obj.conversations_total),
    messages_last_24h: n(obj.messages_last_24h),
    events_upcoming: n(obj.events_upcoming),
    events_drafts: n(obj.events_drafts),
    qa_sessions_open: n(obj.qa_sessions_open),
    qa_questions_pending: n(obj.qa_questions_pending),
  };
}

export async function fetchCommunityModules(): Promise<CommunityModulesSettings> {
  const { data, error } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", COMMUNITY_MODULES_KEY)
    .maybeSingle();
  if (error) throw error;
  const raw = (data?.value ?? {}) as Record<string, unknown>;
  return {
    chat_enabled: raw.chat_enabled !== false,
    events_enabled: raw.events_enabled !== false,
    qa_enabled: raw.qa_enabled !== false,
    polls_enabled: raw.polls_enabled !== false,
    default_message_ttl_seconds:
      typeof raw.default_message_ttl_seconds === "number" ? raw.default_message_ttl_seconds : null,
  };
}

export async function updateCommunityModules(
  patch: Partial<CommunityModulesSettings>,
): Promise<CommunityModulesSettings> {
  const current = await fetchCommunityModules();
  const next: CommunityModulesSettings = { ...current, ...patch };
  const { error } = await supabase.from("site_settings").upsert(
    {
      key: COMMUNITY_MODULES_KEY,
      value: next as unknown as Json,
    },
    { onConflict: "key" },
  );
  if (error) throw error;
  return next;
}

// ------- Chat / conversations --------

export type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
export type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

export interface ConversationListItem extends ConversationRow {
  participants_count: number;
  messages_count: number;
}

export async function fetchAdminConversations(params: {
  limit?: number;
  search?: string;
}): Promise<ConversationListItem[]> {
  const limit = params.limit ?? 100;
  const query = supabase
    .from("conversations")
    .select(
      "id, tenant_id, kind, created_by, created_at, last_message_at, last_message_kind, last_message_preview, last_message_sender, direct_key, updated_at, message_ttl_seconds, title",
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (params.search && params.search.trim().length > 0) {
    query.ilike("last_message_preview", `%${params.search.trim()}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  const ids = (data ?? []).map((c) => c.id);
  if (ids.length === 0) return [];

  const [participants, messages] = await Promise.all([
    supabase.from("conversation_participants").select("conversation_id").in("conversation_id", ids),
    supabase
      .from("messages")
      .select("conversation_id")
      .in("conversation_id", ids)
      .is("deleted_at", null),
  ]);
  const partMap = new Map<string, number>();
  for (const row of participants.data ?? []) {
    partMap.set(row.conversation_id, (partMap.get(row.conversation_id) ?? 0) + 1);
  }
  const msgMap = new Map<string, number>();
  for (const row of messages.data ?? []) {
    msgMap.set(row.conversation_id, (msgMap.get(row.conversation_id) ?? 0) + 1);
  }
  return (data ?? []).map((c) => ({
    ...c,
    participants_count: partMap.get(c.id) ?? 0,
    messages_count: msgMap.get(c.id) ?? 0,
  }));
}

export async function fetchConversationMessages(conversationId: string): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const { error } = await supabase.from("conversations").delete().eq("id", conversationId);
  if (error) throw error;
}

export async function softDeleteMessage(messageId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_soft_delete_message", { p_message_id: messageId });
  if (error) throw error;
}

export async function purgeExpiredMessages(): Promise<number> {
  const { data, error } = await supabase.rpc("chat_purge_expired_messages");
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

// ------- Events --------

export type EventRow = Database["public"]["Tables"]["events"]["Row"];
export type EventStatus = "draft" | "published" | "cancelled";

export async function fetchAdminEvents(params: {
  status?: EventStatus | "all";
  q?: string;
}): Promise<EventRow[]> {
  const query = supabase.from("events").select("*").order("starts_at", { ascending: false });
  if (params.status && params.status !== "all") query.eq("status", params.status);
  if (params.q && params.q.trim().length > 0) {
    const s = `%${params.q.trim()}%`;
    query.or(`title_pl.ilike.${s},title_en.ilike.${s},slug.ilike.${s}`);
  }
  const { data, error } = await query.limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function updateEventStatus(id: string, status: EventStatus): Promise<void> {
  const { error } = await supabase.from("events").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function updateEvent(
  id: string,
  patch: Partial<Database["public"]["Tables"]["events"]["Update"]>,
): Promise<void> {
  const { error } = await supabase.from("events").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteEvent(id: string): Promise<void> {
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) throw error;
}

export async function createEvent(input: {
  slug: string;
  title_pl: string;
  title_en: string;
  starts_at: string;
  kind?: string;
  visibility?: "public" | "members";
  min_tier_rank?: number;
}): Promise<EventRow> {
  const { data, error } = await supabase
    .from("events")
    .insert({
      slug: input.slug,
      title_pl: input.title_pl,
      title_en: input.title_en,
      starts_at: input.starts_at,
      kind: input.kind ?? "webinar",
      visibility: input.visibility ?? "public",
      min_tier_rank: input.min_tier_rank ?? 0,
      status: "draft",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function runEventReminders(): Promise<number> {
  const { data, error } = await supabase.rpc("run_event_reminders");
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

// ------- Q&A --------

export type QaSessionRow = Database["public"]["Tables"]["qa_sessions"]["Row"];
export type QaSessionStatus = "draft" | "scheduled" | "open" | "answering" | "closed";
export type QaQuestionRow = Database["public"]["Tables"]["qa_questions"]["Row"];
export type QaQuestionStatus = "pending" | "approved" | "rejected" | "answered";

export async function fetchQaSessions(status?: QaSessionStatus | "all"): Promise<QaSessionRow[]> {
  const query = supabase.from("qa_sessions").select("*").order("created_at", { ascending: false });
  if (status && status !== "all") query.eq("status", status);
  const { data, error } = await query.limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function updateQaSession(
  id: string,
  patch: Partial<Database["public"]["Tables"]["qa_sessions"]["Update"]>,
): Promise<void> {
  const { error } = await supabase.from("qa_sessions").update(patch).eq("id", id);
  if (error) throw error;
}

export async function fetchQaQuestions(params: {
  sessionId?: string;
  status?: QaQuestionStatus | "all";
}): Promise<QaQuestionRow[]> {
  const query = supabase
    .from("qa_questions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (params.sessionId) query.eq("session_id", params.sessionId);
  if (params.status && params.status !== "all") query.eq("status", params.status);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function moderateQaQuestion(
  id: string,
  status: QaQuestionStatus,
  answerBody?: string,
): Promise<void> {
  const patch: Partial<Database["public"]["Tables"]["qa_questions"]["Update"]> = { status };
  if (status === "answered" && answerBody !== undefined) {
    patch.answer_body = answerBody;
    patch.answered_at = new Date().toISOString();
  }
  const { error } = await supabase.from("qa_questions").update(patch).eq("id", id);
  if (error) throw error;
}
