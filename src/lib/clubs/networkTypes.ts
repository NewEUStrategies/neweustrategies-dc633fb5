// Discussion Club - kontrakt domenowy warstwy SIECIUJACEJ (A32).
//
// Do A31 wlacznie klient modelowal wylacznie TRESC: watek, odpowiedz,
// dokument, termin. Ten plik dokłada byty, ktore opisują LUDZI - ogloszenie
// "szukam / oferuje", zadeklarowaną kompetencję, obecność na spotkaniu, skład
// z sygnałem obecności i członka tygodnia.
//
// Cała zawartość to czysta logika i typy: zero Reacta, zero sieci. Dzięki temu
// reguły, które muszą być identyczne w panelu, w szynie i w widoku wątku
// (co znaczy "świeży", jak skrócić opis do trzech zdań, jak posortować
// ekspertów), mają JEDNO miejsce i własny test jednostkowy.
import type { Database, Json } from "@/integrations/supabase/types";

type Fn = Database["public"]["Functions"];
type RowOf<T> = T extends readonly (infer R)[] ? R : never;

/**
 * Korekta nullowalności - ta sama, co w `types.ts`. Generator Supabase dla
 * `RETURNS TABLE` wypuszcza każdą kolumnę jako non-null, bo Postgres nie
 * deklaruje tam nullowalności. Kolumny wymienione niżej baza REALNIE zwraca
 * jako NULL (obszar nieustawiony, profil bez stanowiska, produkt bez rozmowy),
 * więc bez tej korekty klient jest typowany na dane, których nigdy nie dostanie.
 */
type NullableCols<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };

// ---------------------------------------------------------------------------
// 1) Ogłoszenia "szukam / oferuję"
// ---------------------------------------------------------------------------

/**
 * Dwa rodzaje, nie jeden z flagą. "Szukam" i "oferuję" to przeciwne kierunki
 * tej samej transakcji i czyta się je RÓŻNYMI oczami: pierwszy przegląda ten,
 * kto ma czym pomóc, drugi ten, kto czegoś potrzebuje.
 */
export const CLUB_NOTICE_KINDS = ["seeking", "offering"] as const;
export type ClubNoticeKind = (typeof CLUB_NOTICE_KINDS)[number];

/** Limity z CHECK-ów `club_board_notices_*` - jedyne źródło prawdy dla pola. */
export const CLUB_NOTICE_MIN_LENGTH = 8;
export const CLUB_NOTICE_MAX_LENGTH = 280;
/** Domyślna i maksymalna ważność ogłoszenia (RPC przycina do tego zakresu). */
export const CLUB_NOTICE_DEFAULT_DAYS = 30;
export const CLUB_NOTICE_MAX_DAYS = 90;
/** Limit otwartych ogłoszeń na osobę - ten sam próg, co w RPC. */
export const CLUB_NOTICE_MAX_OPEN = 5;

export type ClubBoardNoticeRow = NullableCols<
  RowOf<Fn["club_board_notices_list"]["Returns"]>,
  "topic" | "author_avatar" | "author_slug" | "author_headline"
>;

export function toClubNoticeKind(value: string): ClubNoticeKind {
  return (CLUB_NOTICE_KINDS as readonly string[]).includes(value)
    ? (value as ClubNoticeKind)
    : "seeking";
}

/**
 * Treść ogłoszenia sprowadzona do jednej linii - dokładnie tak, jak zrobi to
 * baza przy zapisie. Normalizacja stoi TUTAJ, a nie tylko w RPC, żeby licznik
 * znaków pod polem liczył to samo, co ograniczenie, które zaraz zdecyduje
 * o przyjęciu wpisu. Licznik mówiący "279 / 280" nad tekstem, który baza
 * odrzuci, jest gorszy niż brak licznika.
 */
export function normalizeNoticeBody(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function isNoticeBodyValid(input: string): boolean {
  const length = normalizeNoticeBody(input).length;
  return length >= CLUB_NOTICE_MIN_LENGTH && length <= CLUB_NOTICE_MAX_LENGTH;
}

/**
 * Ile dni zostało ważności. Zwraca `0` dla ogłoszenia, które właśnie wygasło -
 * ujemna liczba dni nie jest informacją, tylko usterką do pokazania.
 */
export function noticeDaysLeft(expiresAt: string, now: Date = new Date()): number {
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) return 0;
  const days = Math.ceil((end - now.getTime()) / 86_400_000);
  return days > 0 ? days : 0;
}

/** Ogłoszenie na ostatniej prostej - próg, przy którym warto je odświeżyć. */
export const CLUB_NOTICE_EXPIRING_SOON_DAYS = 3;

export function isNoticeExpiringSoon(expiresAt: string, now: Date = new Date()): boolean {
  const left = noticeDaysLeft(expiresAt, now);
  return left > 0 && left <= CLUB_NOTICE_EXPIRING_SOON_DAYS;
}

// ---------------------------------------------------------------------------
// 2) Eksperci wątku
// ---------------------------------------------------------------------------

export type ClubThreadExpertRow = NullableCols<
  RowOf<Fn["club_thread_experts"]["Returns"]>,
  "avatar_url" | "profile_slug" | "headline" | "topic"
>;

/** Maksymalna liczba deklaracji kompetencji na osobę i klub (limit z RPC). */
export const CLUB_EXPERTISE_MAX = 12;

// ---------------------------------------------------------------------------
// 3) Kto będzie na spotkaniu
// ---------------------------------------------------------------------------

export const CLUB_RSVP_PRESENT_STATES = ["going", "maybe"] as const;
export type ClubRsvpPresentState = (typeof CLUB_RSVP_PRESENT_STATES)[number];

export type ClubEventAttendeeRow = NullableCols<
  RowOf<Fn["club_event_attendees"]["Returns"]>,
  "avatar_url" | "profile_slug" | "headline"
>;

export function toRsvpPresentState(value: string): ClubRsvpPresentState {
  return value === "maybe" ? "maybe" : "going";
}

// ---------------------------------------------------------------------------
// 4) Skład z sygnałem obecności
// ---------------------------------------------------------------------------

/** Jedna twarz w składzie. Przychodzi jako jsonb - patrz `parseRosterFaces`. */
export interface ClubRosterFace {
  userId: string;
  name: string;
  avatarUrl: string | null;
  slug: string | null;
  role: string;
  /** Dołączył w ciągu ostatnich 7 dni. */
  isNew: boolean;
  /** Odezwał się w ciągu ostatnich 24 godzin. */
  isActive: boolean;
  topics: string[];
}

export interface ClubRosterSignal {
  membersTotal: number;
  new7d: number;
  active24h: number;
  active7d: number;
  /**
   * Czternaście dni, od najstarszego. Słupek to liczba RÓŻNYCH OSÓB, które
   * odezwały się danego dnia - nie liczba wpisów. To jest cała różnica między
   * pulsem klubu a licznikiem treści: jedna osoba pisząca dziesięć razy i
   * dziesięć osób po razie dają identyczny licznik wpisów i opisują dwa
   * zupełnie różne kluby.
   */
  peopleSeries: number[];
  faces: ClubRosterFace[];
}

/** Czy szereg niesie jakikolwiek ruch - iskra z samych zer to plama, nie wykres. */
export function hasPeopleMovement(series: readonly number[]): boolean {
  return series.some((value) => value > 0);
}

// ---------------------------------------------------------------------------
// 5) Poznaj członka
// ---------------------------------------------------------------------------

export type ClubSpotlightRow = NullableCols<
  RowOf<Fn["club_member_spotlight_current"]["Returns"]>,
  "avatar_url" | "profile_slug" | "headline" | "bio_pl" | "bio_en" | "blurb_pl" | "blurb_en"
>;

/** Ile zdań pokazuje moduł. Trzy - tyle mieści się w szynie bez zwijania. */
export const CLUB_SPOTLIGHT_SENTENCES = 3;

/**
 * Skróty, po których kropka NIE kończy zdania.
 *
 * Lista jest krótka i celowo dwujęzyczna: biogramy w tym produkcie brzmią
 * "pracował m.in. w MON" i "advised e.g. the Council", a cięcie po "m.in."
 * daje fragment, który wygląda na awarię edytora. Poza listą działa reguła
 * ogólna (człon 1-2 liter pisany małą literą), która łapie drugą kropkę
 * w "m.in." i pierwszą w "e.g." bez wymieniania każdego wariantu.
 */
const SENTENCE_ABBREVIATIONS: ReadonlySet<string> = new Set([
  // polskie
  "np",
  "tzw",
  "itp",
  "itd",
  "ok",
  "ws",
  "tj",
  "dr",
  "prof",
  "mgr",
  "inż",
  "hab",
  "red",
  "str",
  "nr",
  "ul",
  "św",
  "por",
  "zob",
  "wg",
  // angielskie
  "eg",
  "ie",
  "etc",
  "mr",
  "ms",
  "mrs",
  "vs",
  "cf",
  "approx",
  "dept",
]);

/** Ostatni człon wyrazowy przed kropką - bez znaków interpunkcyjnych. */
function tokenBefore(text: string, dotIndex: number): string {
  let start = dotIndex;
  while (start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1])) start -= 1;
  return text.slice(start, dotIndex);
}

/**
 * Pierwsze N zdań tekstu. Granicę zdania wyznacza kropka, znak zapytania albo
 * wykrzyknik, po którym idzie spacja lub koniec tekstu - z wyjątkiem kropki
 * kończącej skrót.
 *
 * Dlaczego nie przycięcie po znakach: opis ucięty w połowie słowa i domknięty
 * wielokropkiem czyta się jak awaria, a nie jak skrót. Zdania kończą się tam,
 * gdzie autor je skończył - i to jest jedyne cięcie, którego nie widać.
 *
 * Tekst bez ani jednej granicy zdania (jedno długie zdanie, notka bez kropki)
 * wraca w CAŁOŚCI: lepiej pokazać cztery linijki niż uciąć w losowym miejscu.
 */
export function firstSentences(input: string, count = CLUB_SPOTLIGHT_SENTENCES): string {
  const text = input.replace(/\s+/g, " ").trim();
  if (text === "" || count <= 0) return "";

  const boundaries: number[] = [];
  const pattern = /[.!?]+(?=\s|$)/g;
  let match = pattern.exec(text);
  while (match !== null && boundaries.length < count) {
    const token = match[0] === "." ? tokenBefore(text, match.index) : "";
    // Człon 1-2 liter małą literą to prawie zawsze skrót ("m.in.", "e.g.");
    // pełne słowo tej długości kończące zdanie w praktyce nie występuje.
    const isAbbreviation =
      token !== "" &&
      token === token.toLowerCase() &&
      (SENTENCE_ABBREVIATIONS.has(token) || token.length <= 2);
    if (!isAbbreviation) boundaries.push(match.index + match[0].length);
    match = pattern.exec(text);
  }

  if (boundaries.length === 0) return text;
  return text.slice(0, boundaries[boundaries.length - 1]).trim();
}

/**
 * Opis członka tygodnia. Kolejność źródeł jest tezą modułu:
 * 1. blurb redakcyjny - ktoś usiadł i napisał trzy zdania o tej osobie,
 * 2. opis z profilu w JĘZYKU INTERFEJSU,
 * 3. opis z profilu w drugim języku - lepszy niż pusty moduł,
 * 4. stanowisko i firma - ostatnia deska, ale nadal zdanie o człowieku.
 */
export function spotlightBlurb(row: ClubSpotlightRow, isPl: boolean): string {
  const curated = isPl ? row.blurb_pl : row.blurb_en;
  if (curated !== null && curated.trim() !== "") return firstSentences(curated);

  const own = isPl ? row.bio_pl : row.bio_en;
  if (own !== null && own.trim() !== "") return firstSentences(own);

  const other = isPl ? row.bio_en : row.bio_pl;
  if (other !== null && other.trim() !== "") return firstSentences(other);

  return row.headline ?? "";
}

// ---------------------------------------------------------------------------
// 6) Dorobek jako wynik wspólnych rozmów
// ---------------------------------------------------------------------------

export type ClubOutputRow = NullableCols<
  RowOf<Fn["club_output_list"]["Returns"]>,
  | "summary_pl"
  | "summary_en"
  | "file_url"
  | "external_url"
  | "thread_id"
  | "thread_slug"
  | "thread_title"
  | "published_at"
>;

/** Współautor produktu - uczestnik rozmowy, z której produkt wyrósł. */
export interface ClubOutputContributor {
  userId: string;
  name: string;
  avatarUrl: string | null;
  slug: string | null;
}

// ---------------------------------------------------------------------------
// Odczyt jsonb
//
// Wspólny szkielet: przejdź tablicę, odrzuć wpisy, których nie da się
// przeczytać, i NIE przerywaj całego panelu z powodu jednego wiersza. To ta
// sama doktryna, co w `workspaceTypes.mapJsonArray` - jeden zepsuty rekord nie
// ma prawa zabrać z ekranu pozostałych jedenastu.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function toFlag(value: unknown): boolean {
  return value === true;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

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

export function parseRosterFaces(value: Json): ClubRosterFace[] {
  return mapJsonArray(value, (entry) => {
    const userId = toText(entry["user_id"]);
    const name = toText(entry["name"]);
    if (userId === null || name === null) return null;
    return {
      userId,
      name,
      avatarUrl: toText(entry["avatar_url"]),
      slug: toText(entry["slug"]),
      role: toText(entry["role"]) ?? "member",
      isNew: toFlag(entry["is_new"]),
      isActive: toFlag(entry["is_active"]),
      topics: toStringArray(entry["topics"]),
    };
  });
}

export function parseOutputContributors(value: Json): ClubOutputContributor[] {
  return mapJsonArray(value, (entry) => {
    const userId = toText(entry["user_id"]);
    const name = toText(entry["name"]);
    if (userId === null || name === null) return null;
    return {
      userId,
      name,
      avatarUrl: toText(entry["avatar_url"]),
      slug: toText(entry["slug"]),
    };
  });
}

/**
 * Czy panel składu ma co pokazać. Klub, który ukrywa skład, oddaje LICZBY bez
 * twarzy - i to jest poprawny stan, a nie pustka: "dwanaście osób, trzy
 * aktywne dziś" jest informacją nawet bez ani jednego awatara.
 */
export function hasRosterContent(signal: ClubRosterSignal | null): boolean {
  return signal !== null && (signal.membersTotal > 0 || signal.faces.length > 0);
}
