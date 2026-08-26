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
// `event_session_access`, `event_sponsors_public` i
// `event_sponsor_materials_public` mają GRANT dla `anon`; `event_session_signup`,
// `event_bookmark_toggle` i `event_bookmarks_mine` wymagają sesji. Bramki
// logowania NIE powielamy tutaj - odmowa z bazy niesie klucz, a `publicEventErrors`
// zamienia go w zdanie z następnym krokiem.
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
