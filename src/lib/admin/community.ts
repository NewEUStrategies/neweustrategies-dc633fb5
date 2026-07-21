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

// Typ + domyślne przeniesione do lib/community/modulesSettings (małego modułu
// współdzielonego z chrome) - re-eksport utrzymuje dotychczasowe API admina.
export {
  COMMUNITY_MODULES_DEFAULTS,
  COMMUNITY_MODULES_KEY,
  type CommunityModulesSettings,
} from "@/lib/community/modulesSettings";
import {
  COMMUNITY_MODULES_DEFAULTS,
  COMMUNITY_MODULES_KEY,
  type CommunityModulesSettings,
} from "@/lib/community/modulesSettings";

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
    connections_enabled: raw.connections_enabled !== false,
    events_enabled: raw.events_enabled !== false,
    qa_enabled: raw.qa_enabled !== false,
    polls_enabled: raw.polls_enabled !== false,
    contributor_program_enabled: raw.contributor_program_enabled !== false,
    badges_enabled: raw.badges_enabled !== false,
    push_enabled: raw.push_enabled !== false,
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
    { onConflict: "tenant_id,key" },
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
      "id, tenant_id, kind, created_by, created_at, last_message_at, last_message_kind, last_message_preview, last_message_sender, direct_key, updated_at, message_ttl_seconds, title, theme, wallpaper, quick_emoji, description",
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

export interface CreateQaSessionInput {
  slug: string;
  title_pl: string;
  title_en: string;
  intro_pl?: string;
  intro_en?: string;
  opens_at: string | null;
  closes_at: string | null;
  status: QaSessionStatus;
}

export async function createQaSession(input: CreateQaSessionInput): Promise<QaSessionRow> {
  const { data: userData, error: uErr } = await supabase.auth.getUser();
  if (uErr || !userData.user) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("qa_sessions")
    .insert({
      slug: input.slug,
      title_pl: input.title_pl,
      title_en: input.title_en,
      intro_pl: input.intro_pl ?? null,
      intro_en: input.intro_en ?? null,
      opens_at: input.opens_at,
      closes_at: input.closes_at,
      status: input.status,
      host_user_id: userData.user.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ------- Polls --------

export type PollRow = Database["public"]["Tables"]["polls"]["Row"];
export type PollStatus = "draft" | "open" | "closed";

export async function fetchAdminPolls(status?: PollStatus | "all"): Promise<PollRow[]> {
  const query = supabase
    .from("polls")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status && status !== "all") query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function updatePollStatus(id: string, status: PollStatus): Promise<void> {
  const { error } = await supabase.from("polls").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function deletePoll(id: string): Promise<void> {
  const { error } = await supabase.from("polls").delete().eq("id", id);
  if (error) throw error;
}

export interface CreatePollInput {
  question_pl: string;
  question_en: string;
  options: Array<{ label_pl: string; label_en: string }>;
  ends_at: string | null;
  status: PollStatus;
}

export async function createPoll(input: CreatePollInput): Promise<PollRow> {
  const { data, error } = await supabase
    .from("polls")
    .insert({
      question_pl: input.question_pl,
      question_en: input.question_en,
      options:
        input.options as unknown as Database["public"]["Tables"]["polls"]["Insert"]["options"],
      ends_at: input.ends_at,
      status: input.status,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchPollResults(pollId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("poll_votes")
    .select("option_idx")
    .eq("poll_id", pollId);
  if (error) throw error;
  const map: Record<string, number> = {};
  for (const row of data ?? []) {
    const key = String(row.option_idx);
    map[key] = (map[key] ?? 0) + 1;
  }
  return map;
}

// ------- Contributors --------

export type ContributorSubmissionRow =
  Database["public"]["Tables"]["contributor_submissions"]["Row"];

// UI/API surface: "pending" | "approved" | "rejected". DB CHECK constraint
// przyjmuje: 'submitted' | 'in_review' | 'accepted' | 'rejected'. Mapowanie
// trzymamy jednostronnie tutaj, żeby konsumenci (routes, engagement snapshot)
// nie znały wewnętrznego enumu bazy.
export type ContributorStatus = "pending" | "approved" | "rejected";
type ContributorDbStatus = "submitted" | "in_review" | "accepted" | "rejected";

const DB_TO_UI: Record<ContributorDbStatus, ContributorStatus> = {
  submitted: "pending",
  in_review: "pending",
  accepted: "approved",
  rejected: "rejected",
};

const UI_TO_DB_ACTION: Record<Exclude<ContributorStatus, "pending">, ContributorDbStatus> = {
  approved: "accepted",
  rejected: "rejected",
};

const UI_TO_DB_FILTER: Record<ContributorStatus, ContributorDbStatus[]> = {
  pending: ["submitted", "in_review"],
  approved: ["accepted"],
  rejected: ["rejected"],
};

/** Row w formacie UI - `status` już zremapowany do 3 kategorii. */
export interface ContributorSubmissionView extends Omit<ContributorSubmissionRow, "status"> {
  status: ContributorStatus;
  db_status: ContributorDbStatus;
}

export async function fetchContributorSubmissions(
  status?: ContributorStatus | "all",
  language?: "pl" | "en" | "all",
): Promise<ContributorSubmissionView[]> {
  const query = supabase
    .from("contributor_submissions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status && status !== "all") query.in("status", UI_TO_DB_FILTER[status]);
  if (language && language !== "all") query.eq("language", language);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r) => {
    const db = r.status as ContributorDbStatus;
    return { ...r, status: DB_TO_UI[db] ?? "pending", db_status: db };
  });
}

export async function reviewContributorSubmission(
  id: string,
  status: Exclude<ContributorStatus, "pending">,
  editorNote?: string,
): Promise<void> {
  const patch: Partial<Database["public"]["Tables"]["contributor_submissions"]["Update"]> = {
    status: UI_TO_DB_ACTION[status],
    reviewed_at: new Date().toISOString(),
  };
  if (editorNote !== undefined) patch.editor_note = editorNote;
  const { error } = await supabase.from("contributor_submissions").update(patch).eq("id", id);
  if (error) throw error;
}

// ------- Badges --------

export type BadgeRow = Database["public"]["Tables"]["profile_badges"]["Row"];

export interface BadgeCatalogEntry {
  key: string;
  labelPl: string;
  labelEn: string;
}

export const BADGE_CATALOG: BadgeCatalogEntry[] = [
  { key: "verified", labelPl: "Zweryfikowany", labelEn: "Verified" },
  { key: "contributor", labelPl: "Współtwórca", labelEn: "Contributor" },
  { key: "expert", labelPl: "Ekspert", labelEn: "Expert" },
  { key: "moderator", labelPl: "Moderator", labelEn: "Moderator" },
  { key: "early_adopter", labelPl: "Wczesny użytkownik", labelEn: "Early adopter" },
  { key: "supporter", labelPl: "Wspierający", labelEn: "Supporter" },
];

export async function fetchBadges(): Promise<BadgeRow[]> {
  const { data, error } = await supabase
    .from("profile_badges")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return data ?? [];
}

export async function grantBadge(userId: string, badge: string, note?: string): Promise<void> {
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!profile?.tenant_id) throw new Error("Cannot resolve tenant for user");
  const { error } = await supabase.from("profile_badges").insert({
    user_id: userId,
    badge,
    note: note ?? null,
    tenant_id: profile.tenant_id,
  });
  if (error) throw error;
}

export async function revokeBadge(id: string): Promise<void> {
  const { error } = await supabase.from("profile_badges").delete().eq("id", id);
  if (error) throw error;
}

// ------- Notifications / Push --------

export interface NotificationStats {
  push_subscriptions_active: number;
  push_subscriptions_failed: number;
  notifications_last_24h: number;
  notifications_unread: number;
  digest_daily_users: number;
  digest_weekly_users: number;
}

export async function fetchNotificationStats(): Promise<NotificationStats> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [subs, subsFailed, last24, unread, digDaily, digWeekly] = await Promise.all([
    supabase
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .is("failed_at", null),
    supabase
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .not("failed_at", "is", null),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    supabase
      .from("notification_preferences")
      .select("user_id", { count: "exact", head: true })
      .eq("email_digest", "daily"),
    supabase
      .from("notification_preferences")
      .select("user_id", { count: "exact", head: true })
      .eq("email_digest", "weekly"),
  ]);
  return {
    push_subscriptions_active: subs.count ?? 0,
    push_subscriptions_failed: subsFailed.count ?? 0,
    notifications_last_24h: last24.count ?? 0,
    notifications_unread: unread.count ?? 0,
    digest_daily_users: digDaily.count ?? 0,
    digest_weekly_users: digWeekly.count ?? 0,
  };
}

export async function cleanupFailedPushSubscriptions(): Promise<number> {
  const { data, error } = await supabase
    .from("push_subscriptions")
    .delete()
    .not("failed_at", "is", null)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

// ------- Engagement overview --------

export interface EngagementUpcomingEvent {
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  starts_at: string;
  going: number;
}

/**
 * Kształt jsonb zwracanego przez RPC get_engagement_overview() (migracja
 * 20260713099000): zdrowie społeczności w jednym round-tripie - liczebność
 * i przyrost, aktywni 7/30 dni (unia realnych działań), lejek subskrypcji
 * z rozkładem warstw, opt-in kanałów oraz puls modułów społeczności.
 */
export interface EngagementOverview {
  members_total: number;
  members_new_30d: number;
  active_7d: number;
  active_30d: number;
  subscriptions_active: number;
  tier_distribution: Record<string, number>;
  push_optin: number;
  digest_optin: number;
  events_upcoming: number;
  rsvps_upcoming: number;
  qa_open_questions: number;
  poll_votes_30d: number;
  submissions_pending: number;
  tracker_follows: number;
  top_upcoming_events: EngagementUpcomingEvent[];
}

export async function fetchEngagementOverview(): Promise<EngagementOverview> {
  const { data, error } = await supabase.rpc("get_engagement_overview");
  if (error) throw error;
  const obj = (data ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

  const tiers: Record<string, number> = {};
  const rawTiers = obj.tier_distribution;
  if (rawTiers && typeof rawTiers === "object" && !Array.isArray(rawTiers)) {
    for (const [key, value] of Object.entries(rawTiers as Record<string, unknown>)) {
      tiers[key] = n(value);
    }
  }

  const events: EngagementUpcomingEvent[] = [];
  if (Array.isArray(obj.top_upcoming_events)) {
    for (const item of obj.top_upcoming_events) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const e = item as Record<string, unknown>;
      if (typeof e.slug !== "string" || typeof e.starts_at !== "string") continue;
      events.push({
        slug: e.slug,
        title_pl: typeof e.title_pl === "string" ? e.title_pl : null,
        title_en: typeof e.title_en === "string" ? e.title_en : null,
        starts_at: e.starts_at,
        going: n(e.going),
      });
    }
  }

  return {
    members_total: n(obj.members_total),
    members_new_30d: n(obj.members_new_30d),
    active_7d: n(obj.active_7d),
    active_30d: n(obj.active_30d),
    subscriptions_active: n(obj.subscriptions_active),
    tier_distribution: tiers,
    push_optin: n(obj.push_optin),
    digest_optin: n(obj.digest_optin),
    events_upcoming: n(obj.events_upcoming),
    rsvps_upcoming: n(obj.rsvps_upcoming),
    qa_open_questions: n(obj.qa_open_questions),
    poll_votes_30d: n(obj.poll_votes_30d),
    submissions_pending: n(obj.submissions_pending),
    tracker_follows: n(obj.tracker_follows),
    top_upcoming_events: events,
  };
}
