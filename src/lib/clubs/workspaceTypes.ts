// Discussion Club - kontrakt domenowy przestrzeni roboczej (A28).
//
// Trzy powierzchnie, ktore klub dostal razem z A28: BIBLIOTEKA (dokumenty),
// KALENDARZ (terminy i spotkania) oraz HARMONOGRAM (etapy prac). Czwarta -
// POMIAR - nie ma wlasnych tabel, tylko dwa RPC liczone na zywo.
//
// Slowniki sa wyprowadzone z CHECK-ow w migracji 20260808300000 i sluza za
// JEDYNE zrodlo prawdy dla droplist. Rozjazd CHECK <-> ta tablica oblewa test
// kontraktu, bo droplista z wartoscia spoza CHECK-a to blad, ktory widac
// dopiero przy zapisie - czyli po stracie tego, co uzytkownik wpisal.
import type { Database, Json } from "@/integrations/supabase/types";

// ---------------------------------------------------------------------------
// Slowniki
// ---------------------------------------------------------------------------

/**
 * MATERIALY - to, z czego klub pracuje. `brief` znaczy tu briefing
 * PRZEDSESYJNY i nic wiecej; do A29 ta sama wartosc obslugiwala takze produkt
 * powstajacy PO sesji, przez co nie dalo sie odroznic wejscia od wyjscia.
 */
export const CLUB_SOURCE_KINDS = [
  "brief",
  "analysis",
  "minutes",
  "dataset",
  "position",
  "legal",
  "presentation",
  "other",
] as const;

/**
 * PRODUKTY - to, co klub wytwarza, w kolejnosci cyklu pracy: od notatki po
 * sesji do materialu przeznaczonego do publikacji.
 *
 * Ten podzial nie jest kosmetyka slownika. Klub bez widocznego dorobku czyta
 * sie jak forum niezaleznie od tego, ile analiz naprawde wyprodukowal - a
 * pytanie "co z tego wynika" jest jedynym, ktore odroznia think tank od
 * miejsca, w ktorym ludzie rozmawiaja.
 */
export const CLUB_PRODUCT_KINDS = [
  "discussion_note",
  "policy_brief",
  "scenario",
  "memo",
  "research_agenda",
  "public_insight",
  "decision_memo",
] as const;

/** Rodzaj dokumentu. Odpowiada CHECK-owi `club_documents_kind_check` (A29). */
export const CLUB_DOCUMENT_KINDS = [...CLUB_SOURCE_KINDS, ...CLUB_PRODUCT_KINDS] as const;
export type ClubSourceKind = (typeof CLUB_SOURCE_KINDS)[number];
export type ClubProductKind = (typeof CLUB_PRODUCT_KINDS)[number];
export type ClubDocumentKind = (typeof CLUB_DOCUMENT_KINDS)[number];

/** Czy rodzaj dokumentu jest PRODUKTEM klubu, a nie materialem wejsciowym. */
export function isClubProductKind(kind: string): kind is ClubProductKind {
  return (CLUB_PRODUCT_KINDS as readonly string[]).includes(kind);
}

/**
 * Widocznosc dokumentu jest OSOBNA osia od widocznosci klubu - tak samo, jak
 * widocznosc klubu jest osobna od polityki wstepu (V1 §1.1). Bez tej osi
 * notatka robocza prowadzacego musialaby wyladowac poza klubem.
 */
export const CLUB_DOCUMENT_VISIBILITIES = ["club", "moderators"] as const;
export type ClubDocumentVisibility = (typeof CLUB_DOCUMENT_VISIBILITIES)[number];

export const CLUB_DOCUMENT_STATUSES = ["draft", "published", "archived"] as const;
export type ClubDocumentStatus = (typeof CLUB_DOCUMENT_STATUSES)[number];

export const CLUB_DOCUMENT_LANGUAGES = ["pl", "en", "mixed"] as const;
export type ClubDocumentLanguage = (typeof CLUB_DOCUMENT_LANGUAGES)[number];

/**
 * Rodzaj wpisu w kalendarzu. Roznica miedzy posiedzeniem a koncem konsultacji
 * jest roznica RODZAJU, nie bytu - obie rzeczy maja date i obie odpowiadaja na
 * to samo pytanie czlonka ("co mnie czeka w tym klubie").
 */
export const CLUB_EVENT_KINDS = [
  "meeting",
  "briefing",
  "deadline",
  "consultation",
  "publication",
  "vote",
  "workshop",
  "other",
] as const;
export type ClubEventKind = (typeof CLUB_EVENT_KINDS)[number];

export const CLUB_EVENT_STATUSES = ["scheduled", "cancelled", "done"] as const;
export type ClubEventStatus = (typeof CLUB_EVENT_STATUSES)[number];

/** Trzy stany obecnosci: "moze" jest prawdziwa odpowiedzia i nie wolno jej
 *  wypchnac do braku wiersza, bo to kasuje informacje. */
export const CLUB_RSVP_STATES = ["going", "maybe", "declined"] as const;
export type ClubRsvpState = (typeof CLUB_RSVP_STATES)[number];

export const CLUB_MILESTONE_STATES = ["planned", "active", "done", "blocked", "cancelled"] as const;
export type ClubMilestoneState = (typeof CLUB_MILESTONE_STATES)[number];

// ---------------------------------------------------------------------------
// Ksztalty zwracane przez RPC
// ---------------------------------------------------------------------------
type Fn = Database["public"]["Functions"];

type RowOf<T> = T extends readonly (infer R)[] ? R : never;

/**
 * Korekta nullowalnosci - ta sama, co w `types.ts`. Generator Supabase dla
 * `RETURNS TABLE` wypuszcza KAZDA kolumne jako non-null, bo Postgres nie
 * deklaruje tam nullowalnosci. Bez tej korekty klient jest typowany na dane,
 * ktorych nigdy nie dostanie, a `?? null` w kodzie wyglada jak martwa galaz.
 */
type NullableCols<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };

export type ClubDocumentRow = NullableCols<
  RowOf<Fn["club_documents_list"]["Returns"]>,
  | "group_id"
  | "thread_id"
  | "summary_pl"
  | "summary_en"
  | "file_url"
  | "file_size"
  | "mime_type"
  | "external_url"
  | "version"
  | "source_label"
  | "published_at"
  | "pinned_at"
  | "thread_slug"
  | "group_name_pl"
  | "group_name_en"
  | "uploader_name"
>;

export type ClubEventRow = NullableCols<
  RowOf<Fn["club_events_list"]["Returns"]>,
  | "group_id"
  | "thread_id"
  | "anchor_event_id"
  | "description_pl"
  | "description_en"
  | "ends_at"
  | "location"
  // `meeting_url` jest nullowalne NIE tylko dlatego, ze bywa niepodane:
  // projekcja RPC zeruje je kazdemu, kto nie jest uczestnikiem.
  | "meeting_url"
  | "capacity"
  | "my_rsvp"
  | "thread_slug"
  | "group_name_pl"
  | "group_name_en"
>;

export type ClubMilestoneRow = NullableCols<
  RowOf<Fn["club_milestones_list"]["Returns"]>,
  "thread_id" | "description_pl" | "description_en" | "starts_on" | "due_on" | "thread_slug"
>;

export type ClubActivityPoint = RowOf<Fn["club_activity_series"]["Returns"]>;

/** Mediana jest NULL, gdy zaden watek nie doczekal sie odpowiedzi - to jest
 *  stan mowiacy o klubie, a nie brak danych do ukrycia. */
export type ClubWorkspaceStatsRow = NullableCols<
  RowOf<Fn["club_workspace_stats"]["Returns"]>,
  "median_first_reply_hours"
>;

// ---------------------------------------------------------------------------
// Przekroje jsonb -> ksztalty domenowe
//
// RPC oddaje przekroje jako jsonb, bo maja ZMIENNA liczbe wierszy. Parsowanie
// idzie przez straznikow typu, a nie przez rzutowanie: dane z bazy trafiaja
// wprost do wykresu, wiec pojedyncze pole innego typu wywracaloby ekran.
// ---------------------------------------------------------------------------

export interface ClubKindSlice {
  key: string;
  count: number;
}

export interface ClubGroupSlice {
  id: string;
  // Blizniacze kolumny trzymaja nazwe `_pl`/`_en` (a nie `namePl`/`nameEn`),
  // zeby dzialal na nich kanoniczny `pickLocalized` - inaczej ten jeden
  // przekroj wymagalby wlasnego wyboru jezyka, czyli kolejnej kopii reguly.
  name_pl: string;
  name_en: string;
  count: number;
}

export interface ClubContributorSlice {
  name: string;
  slug: string | null;
  avatarUrl: string | null;
  count: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Wspolny szkielet: przejdz tablice jsonb, odrzuc wpisy, ktorych nie da sie
 *  przeczytac, i nie przerywaj calego przekroju z powodu jednego wiersza. */
function mapJsonArray<T>(value: Json, read: (entry: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const parsed = read(entry);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

export function parseKindBreakdown(value: Json): ClubKindSlice[] {
  return mapJsonArray(value, (entry) => {
    const key = toText(entry["key"]);
    return key === null ? null : { key, count: toCount(entry["count"]) };
  });
}

export function parseGroupBreakdown(value: Json): ClubGroupSlice[] {
  return mapJsonArray(value, (entry) => {
    const id = toText(entry["id"]);
    if (id === null) return null;
    return {
      id,
      name_pl: toText(entry["name_pl"]) ?? "",
      name_en: toText(entry["name_en"]) ?? "",
      count: toCount(entry["count"]),
    };
  });
}

export function parseContributors(value: Json): ClubContributorSlice[] {
  return mapJsonArray(value, (entry) => {
    const name = toText(entry["name"]);
    if (name === null) return null;
    return {
      name,
      slug: toText(entry["slug"]),
      avatarUrl: toText(entry["avatar_url"]),
      count: toCount(entry["count"]),
    };
  });
}

// ---------------------------------------------------------------------------
// Wejscia mutacji
//
// Klucz NIEOBECNY znaczy "nie ruszaj pola" - to jest kontrakt patcha po stronie
// RPC (`p_payload ? 'klucz'`). Dlatego pola sa opcjonalne, a `null` jest
// wartoscia ZNACZACA (wyczysc), nie synonimem pominiecia.
// ---------------------------------------------------------------------------

export interface ClubDocumentUpsertInput {
  id?: string;
  slug?: string;
  title_pl?: string;
  title_en?: string;
  summary_pl?: string | null;
  summary_en?: string | null;
  kind?: ClubDocumentKind;
  group_id?: string | null;
  thread_id?: string | null;
  file_url?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  external_url?: string | null;
  visibility?: ClubDocumentVisibility;
  status?: ClubDocumentStatus;
  language?: ClubDocumentLanguage;
  version?: string | null;
  source_label?: string | null;
  pinned?: boolean;
}

export interface ClubEventUpsertInput {
  id?: string;
  slug?: string;
  title_pl?: string;
  title_en?: string;
  description_pl?: string | null;
  description_en?: string | null;
  kind?: ClubEventKind;
  /** ISO 8601. Wymagane przy tworzeniu - RPC odrzuca wpis bez daty. */
  starts_at?: string;
  ends_at?: string | null;
  all_day?: boolean;
  location?: string | null;
  meeting_url?: string | null;
  status?: ClubEventStatus;
  rsvp_enabled?: boolean;
  capacity?: number | null;
  group_id?: string | null;
  thread_id?: string | null;
  anchor_event_id?: string | null;
}

export interface ClubMilestoneUpsertInput {
  id?: string;
  slug?: string;
  title_pl?: string;
  title_en?: string;
  description_pl?: string | null;
  description_en?: string | null;
  state?: ClubMilestoneState;
  starts_on?: string | null;
  due_on?: string | null;
  progress?: number;
  order_index?: number;
  thread_id?: string | null;
}

// ---------------------------------------------------------------------------
// Zawezenia slownikowe
//
// SQL nie ma unii literalow, wiec RPC oddaje te pola jako `string`. Zawezamy je
// tutaj Z JAWNYM fallbackiem, zeby wartosc z nowszej migracji nie wywrocila
// interfejsu, tylko wyladowala w bezpiecznej galezi.
// ---------------------------------------------------------------------------

function narrow<T extends string>(dict: readonly T[], value: string, fallback: T): T {
  return (dict as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function toDocumentKind(value: string): ClubDocumentKind {
  return narrow(CLUB_DOCUMENT_KINDS, value, "other");
}

export function toDocumentVisibility(value: string): ClubDocumentVisibility {
  return narrow(CLUB_DOCUMENT_VISIBILITIES, value, "club");
}

export function toDocumentStatus(value: string): ClubDocumentStatus {
  return narrow(CLUB_DOCUMENT_STATUSES, value, "published");
}

export function toEventKind(value: string): ClubEventKind {
  return narrow(CLUB_EVENT_KINDS, value, "other");
}

export function toEventStatus(value: string): ClubEventStatus {
  return narrow(CLUB_EVENT_STATUSES, value, "scheduled");
}

export function toMilestoneState(value: string): ClubMilestoneState {
  return narrow(CLUB_MILESTONE_STATES, value, "planned");
}

/** `null` zostaje `null`: brak deklaracji to inna odpowiedz niz "odmawiam". */
export function toRsvpState(value: string | null): ClubRsvpState | null {
  return value === null ? null : narrow(CLUB_RSVP_STATES, value, "maybe");
}

// ---------------------------------------------------------------------------
// Reguly czytelne dla interfejsu
// ---------------------------------------------------------------------------

/**
 * Dokument ma dokladnie jedno zrodlo tresci - plik ALBO link. CHECK w bazie
 * tego pilnuje, ale UI musi wiedziec, KTORY z nich otworzyc, zanim wysle
 * uzytkownika w pusty adres.
 *
 * Parametr jest STRUKTURALNY, a nie `ClubDocumentRow`: ta funkcja czyta dwa
 * pola i nie ma powodu zadac dwudziestu pozostalych. Ksztalt strukturalny
 * zostal, chociaz drugie zrodlo wierszy (`club_output_list`) zniknelo w A34:
 * regula "plik albo link" jest jedna dla wszystkich powierzchni i nie ma
 * powodu wiazac jej z akurat tym RPC, ktore dzisiaj oddaje wiersz.
 */
export function documentHref(row: {
  file_url: string | null;
  external_url: string | null;
}): string | null {
  const file = row.file_url !== null && row.file_url.trim() !== "" ? row.file_url : null;
  const external =
    row.external_url !== null && row.external_url.trim() !== "" ? row.external_url : null;
  return file ?? external;
}

/** Wydarzenie trwa, gdy zaczelo sie i jeszcze sie nie skonczylo. Wpis bez
 *  `ends_at` traktujemy jako punkt w czasie, nie jako wieczne "teraz". */
export function isEventLive(row: ClubEventRow, now: number): boolean {
  if (row.status !== "scheduled") return false;
  const start = Date.parse(row.starts_at);
  if (Number.isNaN(start) || start > now) return false;
  if (row.ends_at === null) return false;
  const end = Date.parse(row.ends_at);
  return !Number.isNaN(end) && end >= now;
}

/** Lista obecnych jest pelna. Wydarzenie bez limitu nie jest pelne NIGDY. */
export function isEventFull(row: ClubEventRow): boolean {
  return row.capacity !== null && row.going_count >= row.capacity;
}

/**
 * Etap jest spozniony, gdy termin minal, a stan nie mowi, ze skonczony.
 * `cancelled` NIE jest spoznieniem - odwolany etap nie ma czego dowozic.
 */
export function isMilestoneOverdue(row: ClubMilestoneRow, today: string): boolean {
  if (row.due_on === null) return false;
  if (row.state === "done" || row.state === "cancelled") return false;
  return row.due_on < today;
}

// ---------------------------------------------------------------------------
// Warstwa WATKU (A28)
//
// Kontrakt przestrzeni roboczej watku mieszka w osobnym module, zeby ten plik
// nie urosl do tysiaca linii. Re-eksport trzyma JEDEN punkt importu dla
// widokow - i tak juz siegaja tu po slowniki klubu.
// ---------------------------------------------------------------------------
export * from "./threadWorkspaceTypes";
