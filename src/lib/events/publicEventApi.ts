// Publiczne RPC powierzchni uczestnika: sekcje strony, agenda, zapis na sesję,
// dostęp do transmisji sesji, partnerzy, materiały, zakładki.
//
// JEDEN MODUŁ, BO JEDEN KONTRAKT NAJEMCY. Wszystkie te funkcje ustalają
// najemcę przez `public_tenant_id()` (nagłówek hosta), a nie z argumentu -
// front NIE MA jak podać cudzego najemcy i nie próbuje. Rozbicie ich na sześć
// plików rozproszyłoby tę jedną regułę na sześć miejsc, w których można ją
// zgubić.
//
// GOŚĆ CZYTA, ZALOGOWANY DZIAŁA. `event_sections`, `event_agenda`,
// `event_session_access`, `event_sponsors_public`,
// `event_sponsor_materials_public` i `event_discussions` mają GRANT dla `anon`;
// `event_session_signup`, `event_bookmark_toggle`, `event_bookmarks_mine`
// i `event_attendees` wymagają sesji. Bramki logowania NIE powielamy tutaj -
// odmowa z bazy niesie klucz, a `publicEventErrors` zamienia go w zdanie
// z następnym krokiem.
//
// LISTA UCZESTNIKÓW JEST WYJĄTKIEM OD „GOŚĆ CZYTA” I TO NIE JEST NIEDBALSTWO:
// `event_attendees` ma REVOKE dla `anon`, bo „kto jest na sali” to informacja
// dla ludzi z sali. Hook nie woła jej dla gościa (`enabled`), a komponent
// pokazuje wtedy zaproszenie do zalogowania - nie komunikat o błędzie.
//
// PARSOWANIE STOI PRZY MODELU, NIE PRZY ZAPYTANIU. Ten plik oddaje kształt
// z bazy do modułów `eventSections` / `agendaSurface` / `sponsorsSurface`,
// żeby test modelu nie potrzebował atrapy sieci.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { parseEventSections, type EventSection } from "@/lib/events/eventSections";
import { parseEventAgenda, type AgendaSession } from "@/lib/events/agendaSurface";
import {
  parseSponsorMaterials,
  parseSponsorTiers,
  type PublicSponsorMaterial,
  type PublicSponsorTier,
} from "@/lib/events/sponsorsSurface";

type Fns = Database["public"]["Functions"];

/** Wiersz listy zakładek - kształt WPROST z sygnatury RPC. */
export type BookmarkedEventRow = Fns["event_bookmarks_mine"]["Returns"][number];

export const BOOKMARK_SCOPES = ["upcoming", "past", "all"] as const;
export type BookmarkScope = (typeof BOOKMARK_SCOPES)[number];

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function nullableInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

/* ------------------------------------------------------------- sekcje --- */

export async function fetchEventSections(slug: string): Promise<EventSection[]> {
  const { data, error } = await supabase.rpc("event_sections", { p_slug: slug });
  if (error) throw error;
  return parseEventSections(data);
}

/* --------------------------------------------------------------- menu --- */

/** Wiersz menu wydarzenia - kształt WPROST z sygnatury RPC, nie przepisany. */
export type EventMenuRow = Fns["event_menu"]["Returns"][number];

/**
 * Pozycja menu podstron wydarzenia.
 *
 * `path` JEST CAŁĄ ŚCIEŻKĄ, NIE SLUGIEM. Strona publiczna żyje pod łańcuchem
 * slugów rodziców (`src/routes/$.tsx`), więc RPC składa ją rekurencyjnie
 * w SQL - klient dostaje gotowe „kongres-2026/agenda" i tylko dokleja `/`.
 * Doklejanie ścieżki w kliencie wymagałoby zapytania o każdego rodzica.
 *
 * WIDOCZNOŚĆ JUŻ SIĘ STAŁA. `event_menu` filtruje pozycje po grupach wołającego
 * po stronie bazy, więc tu nie ma pola „dla kogo" i nie ma go po co dodawać:
 * lista, która przyszła, jest listą do narysowania w całości.
 */
export interface EventMenuItem {
  id: string;
  pageId: string;
  labelPl: string;
  labelEn: string;
  /** Nazwa ikony kebab-case dla `DynamicIcon`; `null` = pozycja bez ikony. */
  icon: string | null;
  /** `#RRGGBB` na tło ikony; `null` = kolor z motywu. */
  color: string | null;
  /** Pełna ścieżka strony BEZ wiodącego ukośnika. */
  path: string;
  sortOrder: number;
  /**
   * `event_pages.module` - znacznik pozycji modułowej (`participants`,
   * `speakers`, `partners`, `agenda`, `discussions`); `null` = zwykła podstrona
   * założona ręcznie w studiu.
   *
   * PO CO FRONT GO POTRZEBUJE. Pozycja modułowa ma w serwisie trasę dedykowaną
   * (`/events/<slug>/<module>`), która pod dokumentem strony CMS dokłada dane
   * z bazy - listę uczestników, siatkę prelegentów, program. Pozycja zwykła
   * takiej trasy nie ma i prowadzi tam, gdzie prowadziła zawsze: pod ścieżkę
   * strony w trasie splat. Bez tego pola front nie umiałby ich rozróżnić
   * i musiałby zgadywać po sluggu, czyli po napisie, który redaktor może
   * zmienić.
   */
  module: string | null;
}

/**
 * Wiersze RPC -> model menu. Generowane typy `RETURNS TABLE` opisują każdą
 * kolumnę jako non-null, a `icon`, `color` i własna etykieta są w bazie
 * nullowalne - dlatego przechodzą przez `text()`, a nie wprost do modelu.
 * Pozycja bez ścieżki wypada: odnośnik do `/` nie jest podstroną wydarzenia.
 */
function parseEventMenu(rows: readonly EventMenuRow[] | null): EventMenuItem[] {
  if (rows === null) return [];
  const out: EventMenuItem[] = [];
  for (const row of rows) {
    const path = text(row.path);
    if (path === null) continue;
    out.push({
      id: text(row.id) ?? "",
      pageId: text(row.page_id) ?? "",
      labelPl: text(row.label_pl) ?? "",
      labelEn: text(row.label_en) ?? "",
      icon: text(row.icon),
      color: text(row.color),
      path: path.replace(/^\/+/, ""),
      sortOrder: nullableInt(row.sort_order) ?? 0,
      // Kolumna jest w bazie nullowalna (znacznik ma tylko pięć pozycji
      // modułowych), a generowany typ `RETURNS TABLE` opisuje ją jako non-null -
      // dlatego przechodzi przez `text()` tak samo jak ikona i kolor.
      module: text(row.module),
    });
  }
  // Baza sortuje, ale kolejność jest częścią kontraktu widoku - domykamy ją
  // tutaj, żeby test komponentu nie zależał od porządku z sieci.
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.labelPl.localeCompare(b.labelPl));
}

export async function fetchEventMenu(slug: string): Promise<EventMenuItem[]> {
  const { data, error } = await supabase.rpc("event_menu", { p_slug: slug });
  if (error) throw error;
  return parseEventMenu(data);
}

/* ------------------------------------------------------------- agenda --- */

export async function fetchEventAgenda(slug: string): Promise<AgendaSession[]> {
  const { data, error } = await supabase.rpc("event_agenda", { p_slug: slug });
  if (error) throw error;
  return parseEventAgenda(data);
}

export interface SessionSignupResult {
  /** Stan PO operacji - ustala go SQL pod blokadą wiersza sesji, nie klient. */
  status: "registered" | "waitlist" | "cancelled";
  /** Czy rezygnacja wpuściła kogoś z rezerwy (komunikat dla uczestnika). */
  promoted: boolean;
  registered: number;
  seatsLeft: number | null;
}

function signupStatusOf(value: unknown): SessionSignupResult["status"] {
  const raw = text(value);
  if (raw === "registered" || raw === "waitlist" || raw === "cancelled") return raw;
  // Nieznana odpowiedź czytana jako rezygnacja: to jedyny stan, który nie
  // obiecuje uczestnikowi miejsca, którego może nie mieć.
  return "cancelled";
}

export async function submitSessionSignup(input: {
  sessionId: string;
  status: "registered" | "cancelled";
}): Promise<SessionSignupResult> {
  const { data, error } = await supabase.rpc("event_session_signup", {
    p_payload: { session_id: input.sessionId, status: input.status } as Json,
  });
  if (error) throw error;
  const row = record(data);
  return {
    status: signupStatusOf(row.status),
    promoted: row.promoted === true,
    registered: nullableInt(row.registered) ?? 0,
    seatsLeft: nullableInt(row.seats_left),
  };
}

export interface SessionAccess {
  canStream: boolean;
  canWatch: boolean;
  reason: string;
  /** Adres transmisji wraca WYŁĄCZNIE dla uprawnionego - inaczej `null`. */
  streamUrl: string | null;
  recordingUrl: string | null;
  chathamHouse: boolean;
}

export async function fetchSessionAccess(sessionId: string): Promise<SessionAccess> {
  const { data, error } = await supabase.rpc("event_session_access", { _session_id: sessionId });
  if (error) throw error;
  const row = record(data);
  return {
    canStream: row.can_stream === true,
    canWatch: row.can_watch === true,
    reason: text(row.reason) ?? "not_found",
    streamUrl: text(row.stream_url),
    recordingUrl: text(row.recording_url),
    chathamHouse: row.chatham_house === true,
  };
}

/* ---------------------------------------------------------- partnerzy --- */

export async function fetchEventSponsors(slug: string): Promise<PublicSponsorTier[]> {
  const { data, error } = await supabase.rpc("event_sponsors_public", { p_slug: slug });
  if (error) throw error;
  return parseSponsorTiers(data);
}

export async function fetchEventSponsorMaterials(slug: string): Promise<PublicSponsorMaterial[]> {
  const { data, error } = await supabase.rpc("event_sponsor_materials_public", { p_slug: slug });
  if (error) throw error;
  return parseSponsorMaterials(data);
}

/* --------------------------------------------------------- uczestnicy --- */

/**
 * Powód, dla którego lista uczestnika nie przyszła. `null` = przyszła.
 *
 * DWA POWODY, DWA RÓŻNE NASTĘPNE KROKI - i dlatego to nie jest jedno pole
 * „pusto”: `requester_not_participating` znaczy „zapisz się”, a `chatham_house`
 * znaczy „nazwisk nie będzie i to jest cała odpowiedź”. Trzeciego powodu tu nie
 * ma, bo brak sesji baza zgłasza wyjątkiem, nie polem (patrz nagłówek pliku).
 */
export const ATTENDEE_BLOCK_REASONS = ["requester_not_participating", "chatham_house"] as const;
export type AttendeeBlockReason = (typeof ATTENDEE_BLOCK_REASONS)[number];

/** Etykieta grupy zapisu - kolor jest z bazy, nie z motywu. */
export interface AttendeeGroupTag {
  id: string;
  namePl: string;
  nameEn: string;
  color: string | null;
}

/** Grupa wydarzenia z licznikiem osób NA LIŚCIE (nie wszystkich zapisanych). */
export interface AttendeeGroupCount extends AttendeeGroupTag {
  count: number;
}

/**
 * Jedna osoba na liście uczestników.
 *
 * `name` jest zawsze niepuste - składa je SQL (nazwa wyświetlana profilu, potem
 * imię i nazwisko profilu, na końcu kartoteka wydarzenia), więc front nie ma
 * tu żadnej gałęzi do podjęcia. Adresu poczty ani telefonu w tym kształcie
 * NIE MA i nie wolno go dołożyć: dane kontaktowe należą do ścieżki zgody
 * partnerskiej, nie do listy uczestników.
 */
export interface AttendeeEntry {
  registrationId: string;
  name: string;
  jobTitle: string | null;
  company: string | null;
  avatarUrl: string | null;
  profileSlug: string | null;
  groups: AttendeeGroupTag[];
}

export interface AttendeeDirectory {
  blocked: AttendeeBlockReason | null;
  /** Reguła Chatham House tego wydarzenia - front mówi o niej wprost. */
  chathamHouse: boolean;
  myRegistrationId: string | null;
  /** Czy JA jestem widoczny dla innych: `myDiscoverable && !myOptOut`. */
  myListed: boolean;
  /** Dźwignia PLATFORMOWA (`profiles.discoverable`) - poza tą stroną. */
  myDiscoverable: boolean;
  /** Dźwignia TEGO ZAPISU (`event_registrations.directory_opt_out`). */
  myOptOut: boolean;
  totalCount: number;
  rows: AttendeeEntry[];
  groups: AttendeeGroupCount[];
}

/**
 * Odpowiedź, której front nie musi rozpoznawać jako braku danych.
 *
 * Stała, a nie literał w komponencie: `useQuery` przez pierwszy render oddaje
 * `undefined`, a ekran z dwiema gałęziami („jeszcze nie ma” i „nie ma nikogo”)
 * rozjeżdża się dokładnie tam, gdzie te dwie gałęzie się różnią.
 */
export const EMPTY_ATTENDEE_DIRECTORY: AttendeeDirectory = {
  blocked: null,
  chathamHouse: false,
  myRegistrationId: null,
  myListed: false,
  myDiscoverable: false,
  myOptOut: false,
  totalCount: 0,
  rows: [],
  groups: [],
};

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function blockReasonOf(value: unknown): AttendeeBlockReason | null {
  const raw = text(value);
  return ATTENDEE_BLOCK_REASONS.find((reason) => reason === raw) ?? null;
}

function parseGroupTag(value: unknown): AttendeeGroupTag | null {
  const row = record(value);
  const id = text(row.id);
  if (id === null) return null;
  return {
    id,
    namePl: text(row.name_pl) ?? "",
    nameEn: text(row.name_en) ?? "",
    color: text(row.color),
  };
}

export function parseAttendeeDirectory(value: unknown): AttendeeDirectory {
  const row = record(value);
  const rows: AttendeeEntry[] = [];
  for (const item of list(row.rows)) {
    const entry = record(item);
    const registrationId = text(entry.registration_id);
    const name = text(entry.name);
    // Wiersz bez identyfikatora albo bez nazwy nie jest osobą, którą można
    // pokazać - a klucz Reacta na indeksie tablicy rozjeżdża listę po każdym
    // przewinięciu strony.
    if (registrationId === null || name === null) continue;
    rows.push({
      registrationId,
      name,
      jobTitle: text(entry.job_title),
      company: text(entry.company),
      avatarUrl: text(entry.avatar_url),
      profileSlug: text(entry.profile_slug),
      groups: list(entry.groups)
        .map(parseGroupTag)
        .filter((tag): tag is AttendeeGroupTag => tag !== null),
    });
  }

  const groups: AttendeeGroupCount[] = [];
  for (const item of list(row.groups)) {
    const tag = parseGroupTag(item);
    if (tag === null) continue;
    groups.push({ ...tag, count: nullableInt(record(item).count) ?? 0 });
  }

  return {
    blocked: blockReasonOf(row.blocked),
    chathamHouse: row.chatham_house === true,
    myRegistrationId: text(row.my_registration_id),
    myListed: row.my_listed === true,
    myDiscoverable: row.my_discoverable === true,
    myOptOut: row.my_opt_out === true,
    totalCount: nullableInt(row.total_count) ?? 0,
    rows,
    groups,
  };
}

export async function fetchEventAttendees(input: {
  slug: string;
  q?: string;
  groupId?: string | null;
  limit: number;
  offset: number;
}): Promise<AttendeeDirectory> {
  const payload: Record<string, Json> = {
    event_slug: input.slug,
    limit: input.limit,
    offset: input.offset,
  };
  // Puste pole wyszukiwania NIE JEST filtrem - wysłane jako `""` kazałoby
  // bazie porównywać każdy wiersz z niczym.
  if (input.q !== undefined && input.q.trim() !== "") payload.q = input.q.trim();
  if (input.groupId !== undefined && input.groupId !== null) payload.group_id = input.groupId;

  const { data, error } = await supabase.rpc("event_attendees", { p_payload: payload });
  if (error) throw error;
  return parseAttendeeDirectory(data);
}

/**
 * Własna obecność na liście - JEDNA dźwignia, ta per wydarzenie.
 *
 * WOŁAMY RPC GIEŁDY, BO KOLUMNA JEST TA SAMA.
 * `event_registrations.directory_opt_out` ma dokładnie jedną drogę zapisu
 * z powierzchni uczestnika (`event_meeting_directory_visibility_set`) i to jest
 * właściwość, której nie chcemy zepsuć drugą funkcją piszącą do tej samej
 * kolumny. Własne opakowanie zamiast importu hooka giełdy jest tu świadome:
 * tamten moduł wciąga do chunka strony wydarzenia całą nakładkę i18n giełdy
 * spotkań, a unieważnia inne klucze cache niż ta strona.
 *
 * `profiles.discoverable` NIE JEST tu ruszane. Zgoda platformowa zapadła
 * w profilu i strona wydarzenia nie ma prawa jej rozszerzać za człowieka -
 * może tylko powiedzieć, że jest wyłączona.
 */
export async function setEventAttendeeVisibility(input: {
  slug: string;
  listed: boolean;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("event_meeting_directory_visibility_set", {
    p_payload: { event_slug: input.slug, listed: input.listed } as Json,
  });
  if (error) throw error;
  return record(data).listed === true;
}

/* ------------------------------------------------------------ dyskusje --- */

/**
 * Stan pozycji „Dyskusje”.
 *
 * `ok` i `not_configured` pochodzą z naszego RPC; pozostałe to WPROST
 * `club_capabilities.reason` modułu klubów - nie tłumaczymy ich na własny
 * słownik stanów, bo drugi słownik znaczyłby drugie źródło prawdy o dostępie.
 * Nieznany stan czytamy jako `no_access`: strona ma wtedy powiedzieć „nie masz
 * tu dostępu”, a nie udawać, że dyskusji nie ma.
 */
export const DISCUSSION_STATES = [
  "ok",
  "not_configured",
  "not_found",
  "auth_required",
  "not_member",
  "banned",
  "not_open_yet",
  "archived",
  "tier_too_low",
  "tier_unknown",
  "no_access",
] as const;
export type DiscussionState = (typeof DISCUSSION_STATES)[number];

export interface DiscussionClub {
  id: string;
  slug: string;
  namePl: string;
  nameEn: string;
  /** Nazwa ikony lucide W PASCAL CASE - tak trzyma ją `clubs.icon`. */
  icon: string | null;
  accentColor: string | null;
}

export interface DiscussionGroup {
  id: string;
  slug: string;
  namePl: string;
  nameEn: string;
  status: string;
}

/**
 * Wątek klubu na stronie wydarzenia.
 *
 * `authorName` JEST `null` W TRYBIE CHATHAM HOUSE i przy wątku anonimowym -
 * decyduje o tym RPC (kaskada wątek -> grupa -> klub), a nie ten komponent.
 * `isAnonymous` mówi, że tak ma być, więc front rysuje etykietę „uczestnik”,
 * zamiast pustego miejsca po nazwisku.
 */
export interface DiscussionThread {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  kind: string;
  status: string;
  isAnonymous: boolean;
  authorName: string | null;
  authorAvatar: string | null;
  authorSlug: string | null;
  replyCount: number;
  participantCount: number;
  pinnedAt: string | null;
  lastReplyAt: string | null;
  createdAt: string | null;
}

export interface EventDiscussions {
  state: DiscussionState;
  club: DiscussionClub | null;
  group: DiscussionGroup | null;
  /** `attributed` | `chatham` | `anonymous_allowed` - tryb grupy albo klubu. */
  attribution: string | null;
  canPost: boolean;
  totalCount: number;
  threads: DiscussionThread[];
}

export const EMPTY_EVENT_DISCUSSIONS: EventDiscussions = {
  state: "not_configured",
  club: null,
  group: null,
  attribution: null,
  canPost: false,
  totalCount: 0,
  threads: [],
};

function discussionStateOf(value: unknown): DiscussionState {
  const raw = text(value);
  return DISCUSSION_STATES.find((state) => state === raw) ?? "no_access";
}

export function parseEventDiscussions(value: unknown): EventDiscussions {
  const row = record(value);
  const clubRow = record(row.club);
  const clubId = text(clubRow.id);
  const clubSlug = text(clubRow.slug);
  const groupRow = record(row.group);
  const groupId = text(groupRow.id);

  const threads: DiscussionThread[] = [];
  for (const item of list(row.threads)) {
    const entry = record(item);
    const id = text(entry.id);
    const slug = text(entry.slug);
    const title = text(entry.title);
    // Bez sluga nie ma odnośnika do wątku, a karta bez odnośnika jest atrapą.
    if (id === null || slug === null || title === null) continue;
    threads.push({
      id,
      slug,
      title,
      excerpt: text(entry.excerpt),
      kind: text(entry.kind) ?? "discussion",
      status: text(entry.status) ?? "open",
      isAnonymous: entry.is_anonymous === true,
      authorName: text(entry.author_name),
      authorAvatar: text(entry.author_avatar),
      authorSlug: text(entry.author_slug),
      replyCount: nullableInt(entry.reply_count) ?? 0,
      participantCount: nullableInt(entry.participant_count) ?? 0,
      pinnedAt: text(entry.pinned_at),
      lastReplyAt: text(entry.last_reply_at),
      createdAt: text(entry.created_at),
    });
  }

  return {
    state: discussionStateOf(row.state),
    // Klub bez identyfikatora ALBO bez sluga jest dla frontu nieużyteczny:
    // trasa wątku (`/club/$clubSlug/t/$threadSlug`) potrzebuje obu.
    club:
      clubId === null || clubSlug === null
        ? null
        : {
            id: clubId,
            slug: clubSlug,
            namePl: text(clubRow.name_pl) ?? "",
            nameEn: text(clubRow.name_en) ?? "",
            icon: text(clubRow.icon),
            accentColor: text(clubRow.accent_color),
          },
    group:
      groupId === null
        ? null
        : {
            id: groupId,
            slug: text(groupRow.slug) ?? "",
            namePl: text(groupRow.name_pl) ?? "",
            nameEn: text(groupRow.name_en) ?? "",
            status: text(groupRow.status) ?? "active",
          },
    attribution: text(row.attribution),
    canPost: row.can_post === true,
    totalCount: nullableInt(row.total_count) ?? 0,
    threads,
  };
}

export async function fetchEventDiscussions(slug: string): Promise<EventDiscussions> {
  const { data, error } = await supabase.rpc("event_discussions", { p_slug: slug });
  if (error) throw error;
  return parseEventDiscussions(data);
}

/* ----------------------------------------------------------- zakładki --- */

export interface BookmarkToggleResult {
  eventId: string;
  bookmarked: boolean;
  bookmarkedAt: string | null;
}

/**
 * Przełącza albo USTAWIA zakładkę.
 *
 * `state` jest opcjonalne celowo: bez niego baza przełącza (jeden klik = jedna
 * decyzja), a z nim ustawia wprost - to potrzebne tam, gdzie dwa widoki tego
 * samego wydarzenia mogą się rozjechać (lista i strona otwarte obok siebie).
 */
export async function toggleEventBookmark(input: {
  eventSlug?: string;
  eventId?: string;
  state?: boolean;
}): Promise<BookmarkToggleResult> {
  const payload: Record<string, Json> = {};
  if (input.eventSlug !== undefined) payload.event_slug = input.eventSlug;
  if (input.eventId !== undefined) payload.event_id = input.eventId;
  if (input.state !== undefined) payload.state = input.state;

  const { data, error } = await supabase.rpc("event_bookmark_toggle", { p_payload: payload });
  if (error) throw error;
  const row = record(data);
  return {
    eventId: text(row.event_id) ?? "",
    bookmarked: row.bookmarked === true,
    bookmarkedAt: text(row.bookmarked_at),
  };
}

export interface BookmarkListPage {
  rows: BookmarkedEventRow[];
  /** Licznik CAŁOŚCI z okna analitycznego - do paginacji, nie `rows.length`. */
  totalCount: number;
}

export async function fetchMyBookmarks(input: {
  scope: BookmarkScope;
  limit: number;
  offset: number;
}): Promise<BookmarkListPage> {
  const { data, error } = await supabase.rpc("event_bookmarks_mine", {
    p_scope: input.scope,
    p_limit: input.limit,
    p_offset: input.offset,
  });
  if (error) throw error;
  const rows = data ?? [];
  return { rows, totalCount: nullableInt(rows[0]?.total_count) ?? rows.length };
}
