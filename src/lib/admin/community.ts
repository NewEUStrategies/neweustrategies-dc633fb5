// Panel superadmina Community - warstwa danych (queries + mutations) dla
// modułów: Chat, Events, Q&A. Współdzielona przez /admin/community/*.
//
// Zasady:
//  - Dostęp do wszystkich rekordów odbywa się dzięki RLS "*_staff_*"
//    (has_role admin | super_admin | editor). Klient używa zwykłego supabase.
//  - Toggle modułów w site_settings.community_modules - globalne włączanie/
//    wyłączanie funkcji app'a.
//  - Metryki w admin_community_stats() (jeden round-trip).
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toJson } from "@/lib/builder/types";

// Typ + domyślne przeniesione do lib/community/modulesSettings (małego modułu
// współdzielonego z chrome) - re-eksport utrzymuje dotychczasowe API admina.
export {
  COMMUNITY_MODULES_DEFAULTS,
  COMMUNITY_MODULES_KEY,
  type CommunityModulesSettings,
} from "@/lib/community/modulesSettings";
import {
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
    expert_requests_enabled: raw.expert_requests_enabled !== false,
    // Kluby są opt-in (domyślnie wyłączone), więc czytamy `=== true`, a nie
    // `!== false` - brak wpisu w site_settings ma znaczyć „wyłączone".
    clubs_enabled: raw.clubs_enabled === true,
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
      value: toJson(next),
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

// Rodzaje wydarzen odwzorowuja CHECK z `20260713093000_events_module.sql`.
// Kolumny `kind`/`status` sa w wygenerowanych typach zwyklym `string`, wiec
// zawezenie musi zyc tutaj - inaczej mapa etykiet nie ma nad czym domykac
// kompletnosci.
export const EVENT_KINDS = [
  "webinar",
  "briefing",
  "roundtable",
  "ama",
  "in_person",
  "hybrid",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_STATUSES = ["draft", "published", "cancelled"] as const;

// Mapy WSKAZUJA KLUCZE i18n, nie napisy. Typ `Record<Enum, string>` wymusza
// pokrycie kazdego wariantu, a test slownika domyka druga polowe kontraktu -
// ze wskazany klucz naprawde istnieje w PL i EN.
export const EVENT_KIND_LABEL_KEYS: Record<EventKind, string> = {
  webinar: "adminCommunityEvents.kinds.webinar",
  briefing: "adminCommunityEvents.kinds.briefing",
  roundtable: "adminCommunityEvents.kinds.roundtable",
  ama: "adminCommunityEvents.kinds.ama",
  in_person: "adminCommunityEvents.kinds.in_person",
  hybrid: "adminCommunityEvents.kinds.hybrid",
};

export const EVENT_STATUS_LABEL_KEYS: Record<EventStatus, string> = {
  draft: "adminCommunityEvents.status.draft",
  published: "adminCommunityEvents.status.published",
  cancelled: "adminCommunityEvents.status.cancelled",
};

export function isEventKind(value: string): value is EventKind {
  return (EVENT_KINDS as readonly string[]).includes(value);
}

export function isEventStatus(value: string): value is EventStatus {
  return (EVENT_STATUSES as readonly string[]).includes(value);
}

// Pelne wiersze wydarzen (z join_url/recording_url) sa poza zasiegiem kolumnowych
// grantow dla anon/authenticated - redakcja czyta je przez funkcje sprawdzajaca role.
export async function fetchAdminEvents(params: {
  status?: EventStatus | "all";
  q?: string;
}): Promise<EventRow[]> {
  const { data, error } = await rpcUntyped("admin_list_events", {
    p_status: params.status && params.status !== "all" ? params.status : null,
    p_q: params.q && params.q.trim().length > 0 ? params.q.trim() : null,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as EventRow[]) : [];
}

export async function fetchAdminEvent(id: string): Promise<EventRow | null> {
  const { data, error } = await rpcUntyped("admin_get_event", { p_id: id });
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? (data as EventRow[]) : [];
  return rows[0] ?? null;
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
    .select("id")
    .single();
  if (error) throw error;
  const row = await fetchAdminEvent(data.id);
  if (!row) throw new Error("event_not_found_after_create");
  return row;
}

export async function runEventReminders(): Promise<number> {
  const { data, error } = await supabase.rpc("run_event_reminders");
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

// ------- Prelegenci wydarzen + profile prelegentow --------
//
// CALA TA SEKCJA IDZIE PRZEZ RPC, a nie przez tabele.
//
// STAN ZASTANY. `fetchEventSpeakers` czytal `event_speakers` wprost, a
// `addEventSpeaker` pisal tam upsertem. Tamta tabela ma `user_id NOT NULL
// REFERENCES auth.users` i `PRIMARY KEY (event_id, user_id)`, wiec ta warstwa
// nie mogla dodac prelegenta BEZ KONTA - a wzorzec ma takich 21 z 21.
//
// TERAZ. Cztery operacje panelu wolaja migracje 20260826180000:
// `admin_event_speakers_list`, `admin_event_speaker_upsert`,
// `admin_event_speaker_remove`, `admin_event_speaker_reorder`. Kazda stoi na
// bramce `assert_event_admin_tenant()` (admin albo super_admin, NIGDY editor).
// Dwa rejestry (nowy `event_speaker_entries` i legacy `event_speakers`) skleja
// SQL, nie klient: sklejanie po stronie panelu znaczyloby dwa zapytania i
// dedublowanie w JS, ktore rozjedzie sie z definicja publicznej projekcji.
//
// Profil prelegenta (nakladka sceniczna) zostaje na utwardzonych RPC
// `admin_*_speaker_profile` z 20260727200000 - bez zmian.

type UntypedRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

// Dostep odroczony do wywolania (klient Supabase to leniwe proxy).
const rpcUntyped: UntypedRpc = (fn, args) => (supabase.rpc as unknown as UntypedRpc)(fn, args);

const strOrEmpty = (v: unknown): string => (typeof v === "string" ? v : "");
const numOrZero = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * Wiersz listy prelegentow wydarzenia.
 *
 * `user_id` I `person_id` sa opcjonalne, ale NIGDY oba naraz puste: podmiotem
 * jest konto platformy ALBO osoba z kartoteki najemcy (CHECK
 * `speaker_profiles_subject_xor`). `speaker_profile_id` jest jedynym
 * identyfikatorem obecnym ZAWSZE - i dlatego jest kluczem Reacta.
 */
export interface EventSpeakerEntry {
  /** `null` dla rzedu legacy `event_speakers` (nie ma go w nowym rejestrze). */
  entry_id: string | null;
  speaker_profile_id: string;
  user_id: string | null;
  person_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  company: string | null;
  email: string | null;
  is_public: boolean;
  sort_order: number;
  /** true = wiersz pochodzi WYLACZNIE ze starego rejestru. */
  is_legacy: boolean;
}

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

function mapSpeakerRow(row: Record<string, unknown>): EventSpeakerEntry {
  return {
    entry_id: strOrNull(row.entry_id),
    speaker_profile_id: strOrEmpty(row.speaker_profile_id),
    user_id: strOrNull(row.user_id),
    person_id: strOrNull(row.person_id),
    display_name: strOrNull(row.display_name),
    avatar_url: strOrNull(row.avatar_url),
    job_title: strOrNull(row.job_title),
    company: strOrNull(row.company),
    email: strOrNull(row.email),
    is_public: row.is_public !== false,
    sort_order: numOrZero(row.sort_order),
    is_legacy: row.is_legacy === true,
  };
}

export async function fetchEventSpeakers(eventId: string): Promise<EventSpeakerEntry[]> {
  const { data, error } = await rpcUntyped("admin_event_speakers_list", {
    p_event_id: eventId,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === "object")
    .map(mapSpeakerRow);
}

/** Dane osoby BEZ konta, zbierane w popupie „Nowy prelegent". */
export interface EventSpeakerPersonInput {
  eventId: string;
  /** Grupa uczestnikow wydarzenia - opcjonalna (u nas rola wynika z rejestru). */
  groupId?: string;
  email?: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  companyText?: string;
  phone?: string;
  socialProfileUrl?: string;
  photoUrl?: string;
  bioPl?: string;
  bioEn?: string;
  headlinePl?: string;
  headlineEn?: string;
  /** Tematy wystapien - chipy na profilu prelegenta. */
  topicsPl?: readonly string[];
  topicsEn?: readonly string[];
  /** Kody jezykow wystapien ('pl', 'en'). */
  languages?: readonly string[];
  /** Nakladka sceniczna widoczna publicznie (opis, nie sama obecnosc). */
  isPublic?: boolean;
}

export interface EventSpeakerUpsertResult {
  entry_id: string | null;
  speaker_profile_id: string | null;
  person_id: string | null;
  user_id: string | null;
}

/**
 * Klucze o wartosci `undefined` NIE WCHODZA do payloadu: SQL czyta
 * `p_payload->>'phone'`, wiec brak klucza znaczy „zostaw jak bylo", a pusty
 * napis po `btrim` -> `NULL` znaczy to samo. Sklejenie obu odebraloby
 * mozliwosc rozroznienia „nie dotykaj" od „wyczysc" przy pierwszym
 * rozszerzeniu tej funkcji.
 */
function speakerPayload(
  input: Record<string, string | boolean | readonly string[] | undefined>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === "") continue;
    // Tablica PUSTA wchodzi do payloadu: `[]` znaczy „wyczysc tematy",
    // a pominiecie klucza znaczy „nie dotykaj kolumny". Odsianie `[]` razem
    // z `undefined` odebraloby mozliwosc usuniecia ostatniego tematu.
    out[key] = Array.isArray(value) ? [...value] : value;
  }
  return out;
}

function mapUpsertResult(data: unknown): EventSpeakerUpsertResult {
  const obj = (data ?? {}) as Record<string, unknown>;
  return {
    entry_id: strOrNull(obj.entry_id),
    speaker_profile_id: strOrNull(obj.speaker_profile_id),
    person_id: strOrNull(obj.person_id),
    user_id: strOrNull(obj.user_id),
  };
}

/** Zaklada OSOBE BEZ KONTA i podpina ja do wydarzenia w jednym zapisie. */
export async function createEventSpeakerPerson(
  input: EventSpeakerPersonInput,
): Promise<EventSpeakerUpsertResult> {
  const { data, error } = await rpcUntyped("admin_event_speaker_upsert", {
    p_payload: speakerPayload({
      event_id: input.eventId,
      group_id: input.groupId,
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      job_title: input.jobTitle,
      company_text: input.companyText,
      phone: input.phone,
      social_profile_url: input.socialProfileUrl,
      photo_url: input.photoUrl,
      bio_pl: input.bioPl,
      bio_en: input.bioEn,
      headline_pl: input.headlinePl,
      headline_en: input.headlineEn,
      topics_pl: input.topicsPl,
      topics_en: input.topicsEn,
      languages: input.languages,
      is_public: input.isPublic,
    }),
  });
  if (error) throw new Error(error.message);
  return mapUpsertResult(data);
}

/** Podpina ISTNIEJACE konto platformy (droplista wyszukiwarki kont). */
export async function addEventSpeaker(
  eventId: string,
  userId: string,
): Promise<EventSpeakerUpsertResult> {
  const { data, error } = await rpcUntyped("admin_event_speaker_upsert", {
    p_payload: { event_id: eventId, user_id: userId },
  });
  if (error) throw new Error(error.message);
  return mapUpsertResult(data);
}

/**
 * Zdejmuje prelegenta z WYDARZENIA. Kartoteka osoby i nakladka sceniczna
 * zostaja - ta sama osoba wystepuje na kolejnych wydarzeniach.
 */
export async function removeEventSpeaker(
  eventId: string,
  target: { speakerProfileId?: string; userId?: string },
): Promise<boolean> {
  const { data, error } = await rpcUntyped("admin_event_speaker_remove", {
    p_payload: speakerPayload({
      event_id: eventId,
      speaker_profile_id: target.speakerProfileId,
      user_id: target.userId,
    }),
  });
  if (error) throw new Error(error.message);
  return data === true;
}

/**
 * Przenumerowanie CALEJ listy w zadanej kolejnosci (sort_order = indeks).
 * Zamiana dwoch wartosci byla by no-op dla rzedow legacy z rownym
 * `sort_order` (DEFAULT 0), a czesciowy zapis zostawialby duplikaty.
 */
export async function setEventSpeakerOrder(
  eventId: string,
  items: readonly EventSpeakerEntry[],
): Promise<number> {
  const { data, error } = await rpcUntyped("admin_event_speaker_reorder", {
    p_payload: {
      event_id: eventId,
      items: items.map((item) => ({
        speaker_profile_id: item.speaker_profile_id,
        user_id: item.user_id,
      })),
    },
  });
  if (error) throw new Error(error.message);
  return numOrZero(data);
}

export interface AdminSpeakerProfile {
  user_id: string;
  headline_pl: string;
  headline_en: string;
  bio_pl: string;
  bio_en: string;
  topics_pl: string[];
  topics_en: string[];
  languages: string[];
  talks_count: number;
  rating: number;
  reviews_count: number;
  is_public: boolean;
  crm_lead_id: string | null;
}

export async function fetchAdminSpeakerProfile(
  userId: string,
): Promise<AdminSpeakerProfile | null> {
  const { data, error } = await rpcUntyped("admin_get_speaker_profile", { p_user_id: userId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return null;
  return {
    user_id: strOrEmpty(row.user_id),
    headline_pl: strOrEmpty(row.headline_pl),
    headline_en: strOrEmpty(row.headline_en),
    bio_pl: strOrEmpty(row.bio_pl),
    bio_en: strOrEmpty(row.bio_en),
    topics_pl: strArr(row.topics_pl),
    topics_en: strArr(row.topics_en),
    languages: strArr(row.languages),
    talks_count: numOrZero(row.talks_count),
    rating: numOrZero(row.rating),
    reviews_count: numOrZero(row.reviews_count),
    is_public: row.is_public !== false,
    crm_lead_id: strOrEmpty(row.crm_lead_id) || null,
  };
}

export interface UpsertSpeakerProfileInput {
  userId: string;
  headlinePl: string;
  headlineEn: string;
  bioPl: string;
  bioEn: string;
  topicsPl: string[];
  topicsEn: string[];
  languages: string[];
  talksCount: number;
  rating: number;
  reviewsCount: number;
  isPublic: boolean;
  /** Most do CRM: lead z tagiem 'speaker' + link crm_lead_id (domyslnie tak). */
  syncCrm: boolean;
}

export interface UpsertSpeakerProfileResult {
  id: string | null;
  crm_lead_id: string | null;
}

export async function upsertAdminSpeakerProfile(
  input: UpsertSpeakerProfileInput,
): Promise<UpsertSpeakerProfileResult> {
  const { data, error } = await rpcUntyped("admin_upsert_speaker_profile", {
    p_user_id: input.userId,
    p_headline_pl: input.headlinePl,
    p_headline_en: input.headlineEn,
    p_bio_pl: input.bioPl,
    p_bio_en: input.bioEn,
    p_topics_pl: input.topicsPl,
    p_topics_en: input.topicsEn,
    p_languages: input.languages,
    p_talks_count: input.talksCount,
    p_rating: input.rating,
    p_reviews_count: input.reviewsCount,
    p_is_public: input.isPublic,
    p_sync_crm: input.syncCrm,
  });
  if (error) throw new Error(error.message);
  const obj = (data ?? {}) as Record<string, unknown>;
  return {
    id: strOrEmpty(obj.id) || null,
    crm_lead_id: strOrEmpty(obj.crm_lead_id) || null,
  };
}

export async function deleteAdminSpeakerProfile(userId: string): Promise<boolean> {
  const { data, error } = await rpcUntyped("admin_delete_speaker_profile", {
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

// ------- Q&A --------

export type QaSessionRow = Database["public"]["Tables"]["qa_sessions"]["Row"];
export type QaSessionStatus = "draft" | "scheduled" | "open" | "answering" | "closed";
/**
 * Wiersz pytania Q&A BEZ `user_id`: kolumna jest odebrana rolom anon/authenticated
 * (anonimowość pytających - RLS filtruje wiersze, nie kolumny), więc `select("*")`
 * na tej tabeli by się nie powiódł. Moderacja nie potrzebuje tożsamości autora.
 */
export type QaQuestionRow = Omit<Database["public"]["Tables"]["qa_questions"]["Row"], "user_id">;

const QA_QUESTION_COLUMNS =
  "id, tenant_id, session_id, author_display, is_anonymous, body, status, answer_body, answered_by, answered_at, created_at, updated_at";
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
    .select(QA_QUESTION_COLUMNS)
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

export interface QaSummaryResult {
  post_id: string;
  slug: string;
  status: "draft" | "published" | "archived";
  questions: number;
}

/**
 * Kompiluje odpowiedziane pytania sesji w dwujęzyczny wpis (szkic lub od razu
 * publikacja) i spina go z sesją przez qa_sessions.post_id. Uprawnienia
 * (staff/host), idempotentny upsert i escaping egzekwuje RPC.
 */
export async function publishQaSessionSummary(
  sessionId: string,
  publish: boolean,
): Promise<QaSummaryResult> {
  const { data, error } = await supabase.rpc("publish_qa_session_summary", {
    p_session_id: sessionId,
    p_publish: publish,
  });
  if (error) throw error;
  // Zwrotka to `Json` (jsonb w bazie) - zawężamy do rekordu przed odczytem pól.
  const obj: Record<string, unknown> =
    data !== null && typeof data === "object" && !Array.isArray(data) ? data : {};
  return {
    post_id: typeof obj.post_id === "string" ? obj.post_id : "",
    slug: typeof obj.slug === "string" ? obj.slug : "",
    status: obj.status === "published" || obj.status === "archived" ? obj.status : "draft",
    questions: typeof obj.questions === "number" ? obj.questions : 0,
  };
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
  const { currentUserIdFromSession } = await import("@/lib/auth/currentUser");
  const uid = await currentUserIdFromSession();
  if (!uid) throw new Error("Not authenticated");
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
      host_user_id: uid,
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
