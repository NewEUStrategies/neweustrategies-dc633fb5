// Publiczne fetchery Community konsumowane przez route'y produktowe.
// Odczyty list przez publikowalny klient (RLS: policies "* public read");
// zapisy i dane wrażliwe WYŁĄCZNIE przez utwardzone RPC (rate limity, limit
// miejsc pod FOR UPDATE, bramki warstw, anti-anchoring ankiet, anonimowość
// Chatham House) - nigdy bezpośrednimi insertami do tabel.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { edgeTtlCache } from "@/lib/ssrCache";

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
  /** Kiedy rejestracja otwiera się dla wszystkich (NULL = od publikacji). */
  rsvp_opens_at: string | null;
  /** Ranga warstwy z pierwszeństwem rejestracji przed rsvp_opens_at. */
  early_rsvp_rank: number | null;
  /** Cena biletu w groszach/centach; NULL lub 0 = wydarzenie bezpłatne. */
  ticket_price_cents: number | null;
  ticket_currency: string;
  /** onsite/online/hybrid - format wydarzenia (kolumna `events.format`). */
  format: string;
  /** hidden/teaser/full - ile widzi niezapisany (bramkę egzekwuje baza). */
  guest_mode: string;
  street_address: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  /** youtube/vimeo; NULL = wydarzenie bez nagłówka wideo. */
  video_header_platform: string | null;
  video_header_id: string | null;
  /** Hashtag BEZ krzyżyka - `#` dokłada prezentacja, patrz eventGeneralDraft. */
  social_hashtag: string | null;
  support_email: string | null;
  /** Języki TREŚCI wydarzenia (ISO 639-1), nie języki interfejsu. */
  languages: string[];
  /** Branding wydarzenia; kształt waliduje `eventBrandingFromJson`. */
  branding: Json;
  /** list/grid - prezentacja menu podstron wydarzenia. */
  pages_display_mode: string;
  published_at: string | null;
}

// ── DLACZEGO TA LISTA JEST DŁUŻSZA NIŻ KIEDYŚ ──────────────────────────────
// join_url/recording_url są odcięte grantem kolumnowym (SELECT bez tych
// kolumn dla anon/authenticated) - jedyną ścieżką jest RPC get_event_access.
//
// Reszta kolumn niżej (adres strukturalny, nagłówek wideo, hashtag, języki
// treści, branding, tryb prezentacji podstron) czekała na GRANT, a nie na ten
// plik: `events` ma JAWNĄ allowlistę kolumn czytelnych dla `anon`
// i `authenticated` (migracja 20260803191905), a kolumna dopisana ALTER-em
// NIE wchodzi do niej sama - `SELECT` na nią kończył się odmową uprawnień,
// mimo że panel ją zapisywał. Grant przyrostowy per kolumna nadaje migracja
// `20260826120000_event_pages_and_public_columns.sql`. TA PUŁAPKA WRÓCI przy
// następnej kolumnie: dopisanie pola tutaj bez `GRANT SELECT (kolumna)` daje
// stronę, która przestaje się wczytywać w całości, a nie pole, które jest puste.
const EVENT_COLUMNS =
  "id, slug, title_pl, title_en, description_pl, description_en, starts_at, ends_at, timezone, location, kind, capacity, status, chatham_house, cover_url, host_user_id, visibility, min_tier_rank, rsvp_opens_at, early_rsvp_rank, ticket_price_cents, ticket_currency, format, guest_mode, street_address, city, region, postal_code, country, video_header_platform, video_header_id, social_hashtag, support_email, languages, branding, pages_display_mode, published_at";

async function fetchPublicEvents(): Promise<PublicEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("status", "published")
    .order("starts_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as PublicEvent[];
}

// Klucz identyczny po stronie loadera SSR i klienta ORAZ zarejestrowany w
// lib/realtime/eventInvalidationMap - zmiana wiersza events unieważnia listę
// na żywo, więc nie wolno go tu rozjechać z mapą inwalidacji.
const PUBLIC_EVENTS_QUERY_KEY = ["public-events"] as const;

const EVENTS_LIST_SSR_TTL_MS = 60_000;

/**
 * Współdzielone queryOptions listy /events: loader SSR (ensureQueryData) i
 * render klienta widzą ten sam klucz, więc markup listy schodzi z serwera w
 * dehydratowanym cache zamiast dociągać się po hydratacji. Na serwerze odczyt
 * stoi za per-tenantowym TTL cache (edgeTtlCache przezroczyście kluczuje po
 * hoście żądania; izolację danych i tak egzekwuje RLS przez public_tenant_id()),
 * w przeglądarce cache'em jest sam React Query.
 */
export const publicEventsQueryOptions = () =>
  queryOptions({
    queryKey: PUBLIC_EVENTS_QUERY_KEY,
    queryFn: () => edgeTtlCache("public:events-list", EVENTS_LIST_SSR_TTL_MS, fetchPublicEvents),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

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

/**
 * Nagłówek strony wydarzenia - jeden do jednego z sygnaturą RPC
 * `event_page_header` (migracja `20260823170000_event_front_binding.sql`).
 *
 * KSZTAŁT WYPROWADZONY, NIE PRZEPISANY. Wcześniej stała tu ręczna kopia
 * czterdziestu dziewięciu pól z adnotacją, że zniknie w tej samej zmianie,
 * która zaaplikuje migrację. Migracja jest zaaplikowana i generator zna
 * funkcję, więc kopia znika zgodnie z tamtą zapowiedzią - a razem z nią
 * rzutowanie `supabase.rpc as unknown as (...)`, które istniało wyłącznie
 * po to, żeby obejść nieznaną wtedy sygnaturę.
 */
export type EventPageHeader =
  Database["public"]["Functions"]["event_page_header"]["Returns"][number];

/**
 * Nagłówek publicznej strony wydarzenia w JEDNYM wywołaniu.
 *
 * ── DLACZEGO OBOK `fetchPublicEventBySlug`, A NIE ZAMIAST ──────────────────
 * Rozważane były oba warianty. Zastąpienie odrzucone po sprawdzeniu WSZYSTKICH
 * konsumentów typu `PublicEvent` - jest ich pięć i żaden nie czyta nagłówka
 * strony wydarzenia:
 *   * `routes/events.tsx` (lista) - czyta `PublicEvent[]` z jednego zapytania
 *     tabelarycznego; docelowo przechodzi na `events_public_list()`, ale to
 *     osobne zadanie z paginacją i filtrami serwerowymi,
 *   * `lib/queries/programs.ts` + `routes/programs.$slug.tsx` - wydarzenia
 *     programu, znowu lista, nie strona,
 *   * `components/community/AddToCalendar.tsx` - przyjmuje `PublicEvent`
 *     w sygnaturze,
 *   * `routes/events.$slug.tsx` - nadal potrzebuje `host_user_id`, `status`
 *     i `early_rsvp_rank`, których nagłówek NIE ODDAJE (kolejno: dla
 *     `EventGroupButton`, dla `EventGroupButton` i dla plakietki wcześniejszego
 *     dostępu).
 * Zastąpienie zepsułoby więc cztery miejsca, żeby naprawić jedno.
 *
 * ŚCIEŻKĄ DOCELOWĄ JEST TA FUNKCJA i to nie jest kwestia gustu: nagłówek oddaje
 * dziesięć kolumn etapu 1 (`registration_mode`, `registration_flow`,
 * `external_registration_url`, `guest_mode`, `format`, `event_type_id`,
 * `branding`, ...), których zapytanie tabelaryczne DOSTAĆ NIE MOŻE - migracja
 * `20260803191905` odebrała anon i authenticated SELECT na `public.events`
 * i nadała go z jawną allowlistą 29 kolumn, w której tych dziesięciu nie ma.
 * `fetchPublicEventBySlug` żyje wyłącznie do wygaszenia trzech pól wyżej
 * (`get_event_access` i lista mają je oddać w swoich kontraktach).
 *
 * JEDNO WYWOŁANIE = JEDNA CHWILA W CZASIE. Liczba wolnych miejsc, stan zapisów
 * i własny status uczestnika są ze sobą powiązane; policzone trzema zapytaniami
 * dają trzy różne odpowiedzi na to samo pytanie, a wtedy strona pokazuje
 * przycisk, który odmawia. Uzasadnienie po stronie bazy: decyzja D1 w nagłówku
 * migracji `20260823170000_event_front_binding.sql`.
 */
export async function fetchEventPageHeader(slug: string): Promise<EventPageHeader | null> {
  const { data, error } = await supabase.rpc("event_page_header", { p_slug: slug });
  if (error) throw error;
  return data?.[0] ?? null;
}

export interface EventAccess {
  can_join: boolean;
  join_url: string | null;
  can_watch: boolean;
  recording_url: string | null;
  reason: "not_found" | "auth_required" | "tier_required" | "rsvp_required" | "waitlisted" | "ok";
  /** Dlaczego (nie) widać nagrania - benefit warstwy 'recordings' egzekwuje DB. */
  watch_reason: "not_found" | "none" | "auth_required" | "tier_required" | "ok";
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
  waitlist: number;
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

/** Status żądany przez klienta; 'waitlist' nadaje wyłącznie serwer. */
export type RsvpRequestStatus = "going" | "interested" | "cancelled";
export type RsvpOutcomeStatus = RsvpRequestStatus | "waitlist";

export interface RsvpResult {
  status: RsvpOutcomeStatus;
  going: number;
  waitlist: number;
  /** Pozycja FIFO, tylko gdy status='waitlist'. */
  waitlist_position: number | null;
}

function parseRsvpResult(raw: unknown, requested: RsvpRequestStatus): RsvpResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const status = obj.status;
  return {
    status:
      status === "going" ||
      status === "interested" ||
      status === "cancelled" ||
      status === "waitlist"
        ? status
        : requested,
    going: typeof obj.going === "number" ? obj.going : 0,
    waitlist: typeof obj.waitlist === "number" ? obj.waitlist : 0,
    waitlist_position: typeof obj.waitlist_position === "number" ? obj.waitlist_position : null,
  };
}

/**
 * RSVP przez RPC: limit miejsc, bramka warstwy i statusy egzekwowane w DB.
 * Przy komplecie 'going' degraduje się serwerowo do 'waitlist' (kolejka FIFO
 * pod blokadą wiersza wydarzenia) - klient czyta wynik z odpowiedzi.
 */
export async function rsvpEvent(eventId: string, status: RsvpRequestStatus): Promise<RsvpResult> {
  const { data, error } = await supabase.rpc("rsvp_event", {
    p_event_id: eventId,
    p_status: status,
  });
  if (error) throw error;
  return parseRsvpResult(data, status);
}

/** Własna pozycja na liście rezerwowej (NULL poza kolejką); wiersze są owner-only. */
export async function fetchEventWaitlistPosition(eventId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc("get_event_waitlist_position", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return typeof data === "number" ? data : null;
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
  const { data, error } = await supabase.rpc("get_poll_results_bulk", {
    p_poll_ids: pollIds,
  });
  if (error) throw error;
  for (const row of data ?? []) {
    map.set(row.poll_id, parsePollResult(row.result));
  }
  return map;
}

/** Lista publicznych ankiet - klucz współdzielony przez loader SSR /polls
 *  i render strony (hydratacja bez ponownego fetcha). */
export const publicPollsQueryOptions = () =>
  queryOptions({
    queryKey: ["public-polls"],
    queryFn: fetchPublicPolls,
  });

/**
 * Wyniki ankiet dla widocznych poll_ids. Klucz zawiera użytkownika, bo RPC
 * personalizuje odpowiedź (my_vote + anti-anchoring): po zalogowaniu klucz
 * zmienia się z "anon" na uid i klient dociąga własny wariant. Wyniki są
 * CELOWO wyłącznie klienckie (loader ich nie zasiewa) - edge cache nigdy nie
 * zapieka rozkładu głosów, dokładnie jak w bloku poll (PollBlockView).
 */
export const pollResultsQueryOptions = (pollIds: string[], userId: string | null) =>
  queryOptions({
    queryKey: ["public-poll-results", pollIds.join(","), userId ?? "anon"],
    queryFn: () => fetchPollResults(pollIds),
  });

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
  /** Wpis z podsumowaniem sesji (publish_qa_session_summary), gdy istnieje. */
  post_id: string | null;
}

const QA_SESSION_COLUMNS =
  "id, slug, title_pl, title_en, intro_pl, intro_en, status, opens_at, closes_at, host_user_id, post_id";

export async function fetchPublicQaSessions(): Promise<PublicQaSession[]> {
  const { data, error } = await supabase
    .from("qa_sessions")
    .select(QA_SESSION_COLUMNS)
    .neq("status", "draft")
    .order("opens_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as PublicQaSession[];
}

export async function fetchPublicQaSessionBySlug(slug: string): Promise<PublicQaSession | null> {
  const { data, error } = await supabase
    .from("qa_sessions")
    .select(QA_SESSION_COLUMNS)
    .eq("slug", slug)
    .neq("status", "draft")
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as PublicQaSession | null;
}

export interface QaSummaryPostTeaser {
  slug: string;
  title_pl: string;
  title_en: string;
}

/**
 * Teaser opublikowanego podsumowania sesji (RLS: publiczny odczyt tylko
 * opublikowanych wpisów - szkic z redakcyjnej kolejki nie wycieka).
 */
export async function fetchQaSummaryPost(postId: string): Promise<QaSummaryPostTeaser | null> {
  const { data, error } = await supabase
    .from("posts")
    .select("slug, title_pl, title_en")
    .eq("id", postId)
    .eq("status", "published")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as QaSummaryPostTeaser | null;
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
  /** Czy bieżący użytkownik już zagłosował (parytet z ankietami: my_vote). */
  my_vote: boolean;
}

/**
 * Pytania sesji w porządku serwerowym: priorytet Pro > głosy > starszeństwo.
 * user_id nie opuszcza bazy (anonimowość); głosy policzone w jednej podróży.
 */
export async function fetchPublicQaQuestions(sessionId: string): Promise<PublicQaQuestion[]> {
  const { data, error } = await supabase.rpc("list_qa_questions", {
    p_session_id: sessionId,
  });
  if (error) throw error;
  return data ?? [];
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

export interface PublicResource {
  id: string;
  title_pl: string;
  title_en: string;
  description_pl: string | null;
  description_en: string | null;
  category: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  min_tier_rank: number;
  download_count: number;
  created_at: string;
}

// Metadane biblioteki są publiczne (teaser z kłódką); sam plik siedzi
// w prywatnym buckecie i wymaga RPC authorize_resource_download (bramka rangi).
// file_path celowo NIE jest wybierany - klient nie potrzebuje ścieżki.
const RESOURCE_COLUMNS =
  "id, title_pl, title_en, description_pl, description_en, category, file_name, file_size, mime_type, min_tier_rank, download_count, created_at";

export async function fetchLibraryResources(): Promise<PublicResource[]> {
  const { data, error } = await supabase
    .from("member_resources")
    .select(RESOURCE_COLUMNS)
    .eq("published", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as PublicResource[];
}

/** Opublikowane materiały biblioteki - klucz współdzielony przez loader SSR
 *  /library i render strony. Metadane są publiczne (teaser z kłódką); sam
 *  plik i tak wymaga server fn z bramką rangi, więc SSR niczego nie odsłania. */
export const libraryResourcesQueryOptions = () =>
  queryOptions({
    queryKey: ["library-resources"],
    queryFn: fetchLibraryResources,
  });
