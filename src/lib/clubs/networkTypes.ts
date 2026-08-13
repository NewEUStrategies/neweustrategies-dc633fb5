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
import { pickLocalized, type LocaleCode } from "@/lib/i18n/pickLocalized";

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
  "topic" | "author_avatar" | "author_slug" | "author_headline" | "closed_at"
>;

/** Stan ogłoszenia w bazie. `removed` widzi autor i moderacja. */
export const CLUB_NOTICE_STATUSES = ["open", "closed", "removed"] as const;
export type ClubNoticeStatus = (typeof CLUB_NOTICE_STATUSES)[number];

/**
 * Jak ogłoszenie się skończyło - trzy różne fakty, nie jeden.
 *
 * "Załatwione" jest SUKCESEM (ktoś się odezwał i sprawa jest zamknięta),
 * "wygasło" - porażką ciszy, "zdjęte" - decyzją moderacji. Interfejs, który
 * pokazuje je jednym szarym napisem "zamknięte", odbiera autorowi jedyną
 * informację zwrotną, jaką ten moduł produkuje.
 */
export type ClubNoticeOutcome = "open" | "resolved" | "expired" | "removed";

export function noticeOutcome(row: { status: string; is_expired: boolean }): ClubNoticeOutcome {
  if (row.status === "removed") return "removed";
  if (row.status === "closed") return "resolved";
  return row.is_expired ? "expired" : "open";
}

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

/** Wiersz katalogu ekspertów klubu - deklaracja PLUS dorobek w tym klubie. */
export type ClubExpertRow = NullableCols<
  RowOf<Fn["club_experts_list"]["Returns"]>,
  "avatar_url" | "profile_slug" | "headline" | "last_active_at"
>;

/** Obszar z licznikiem osób - chipy filtra na ekranie ekspertów. */
export type ClubExpertiseArea = RowOf<Fn["club_expertise_areas"]["Returns"]>;

/**
 * Dorobek osoby w klubie jako jedna liczba. Wątek waży tyle samo co
 * odpowiedź - to jest świadome: założenie tematu i rozstrzygająca odpowiedź
 * pod cudzym są w klubie deliberacyjnym wkładem tej samej klasy, a ważenie
 * ich różnie zamieniłoby katalog w ranking autorów.
 */
export function expertContribution(row: { thread_count: number; reply_count: number }): number {
  return row.thread_count + row.reply_count;
}

// ---------------------------------------------------------------------------
// 3) Kto będzie na spotkaniu
// ---------------------------------------------------------------------------

export const CLUB_RSVP_PRESENT_STATES = ["going", "maybe"] as const;
export type ClubRsvpPresentState = (typeof CLUB_RSVP_PRESENT_STATES)[number];

export type ClubEventAttendeeRow = NullableCols<
  RowOf<Fn["club_event_attendees"]["Returns"]>,
  "avatar_url" | "profile_slug" | "headline"
>;

/** Pojedyncze spotkanie po slugu - ten sam kształt, co wiersz kalendarza. */
export type ClubEventViewRow = NullableCols<
  RowOf<Fn["club_event_view"]["Returns"]>,
  | "group_id"
  | "thread_id"
  | "anchor_event_id"
  | "description_pl"
  | "description_en"
  | "ends_at"
  | "location"
  | "meeting_url"
  | "capacity"
  | "my_rsvp"
  | "thread_slug"
  | "group_name_pl"
  | "group_name_en"
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
  /** Stanowisko sklejone w bazie ("Dyrektor - MSZ") - może go nie być. */
  headline: string | null;
  role: string;
  joinedAt: string | null;
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
   * PULA, nie lista do wyświetlenia. Baza oddaje do 60 osób uporządkowanych
   * "kto tu właśnie był, potem kto właśnie doszedł"; panel pokazuje z niej
   * sześć - patrz `rotateRosterFaces`.
   */
  faces: ClubRosterFace[];
}

// --- rotacja twarzy -------------------------------------------------------
//
// PO CO ROTOWAĆ. Panel ma sześć miejsc, a klub bywa trzydziestoosobowy.
// Stała szóstka zamienia "skład klubu" w "sześć osób, które piszą najczęściej"
// - a wtedy moduł mówi to samo, co usunięty ranking najaktywniejszych, tylko
// ładniej. Rotacja sprawia, że przez ten sam panel przewija się CAŁY skład.
//
// CO NIE ROTUJE. Osoby aktywne w ostatniej dobie stoją na stałe: to jest
// jedyny sygnał "tu ktoś jest" na całej stronie klubu i wypadnięcie takiej
// osoby z okna zamieniłoby sygnał w loterię. Rotuje wyłącznie ogon.

/** Ile twarzy mieści się w szynie: sześć w jednym rzędzie kolumny 20 rem. */
export const CLUB_ROSTER_FACE_SLOTS = 6;

/**
 * Okno rotacji - sześć godzin. Krócej: skład miga w trakcie jednej sesji
 * czytania. Dłużej: ten sam człowiek przez tydzień widzi tę samą szóstkę
 * i rotacja przestaje istnieć. Cztery zmiany dziennie razem z krokiem
 * o szerokość okna (patrz `rotateRosterFaces`) pokazują dwudziestoosobowy
 * klub w komplecie w ciągu doby.
 */
export const CLUB_ROSTER_ROTATION_MS = 6 * 60 * 60 * 1000;

/** Numer okna rotacji dla podanej chwili. Wydzielone, bo test nie ma zegara. */
export function rosterRotationTick(nowMs: number): number {
  return Math.floor(nowMs / CLUB_ROSTER_ROTATION_MS);
}

/**
 * Sześć twarzy z puli: aktywni przypięci, reszta w oknie przesuwanym.
 *
 * Kolejność WEWNĄTRZ obu części zostaje taka, jaką dała baza - dzięki temu
 * rotacja nie miesza porządku "kto tu był ostatnio", tylko wybiera, kogo
 * z ogona pokazać w tym oknie.
 *
 * OKNO PRZESUWA SIĘ O SWOJĄ SZEROKOŚĆ, nie o jedną pozycję. To jest różnica
 * między rotacją a pełzaniem: przy dwudziestoosobowym ogonie i sześciu
 * miejscach krok jednopozycyjny pokazuje w ciągu doby DZIEWIĘĆ osób (0-5,
 * 1-6, 2-7, 3-8), bo kolejne okna nachodzą na siebie w pięciu szóstych.
 * Krok o szerokość okna dzieli ogon na rozłączne kawałki i pokazuje w tym
 * samym czasie wszystkich dwudziestu.
 */
export function rotateRosterFaces(
  faces: readonly ClubRosterFace[],
  slots: number,
  tick: number,
): ClubRosterFace[] {
  if (slots <= 0) return [];
  if (faces.length <= slots) return [...faces];

  const pinned = faces.filter((face) => face.isActive).slice(0, slots);
  const pinnedIds = new Set(pinned.map((face) => face.userId));
  const tail = faces.filter((face) => !pinnedIds.has(face.userId));

  const free = slots - pinned.length;
  if (free <= 0 || tail.length === 0) return pinned;

  // Modulo dwustronne: `tick` bywa ujemny dla dat sprzed epoki, a ujemny
  // indeks tablicy dałby `undefined` w środku listy twarzy.
  const offset = (((tick * free) % tail.length) + tail.length) % tail.length;
  const window: ClubRosterFace[] = [];
  for (let i = 0; i < free && i < tail.length; i += 1) {
    const face = tail[(offset + i) % tail.length];
    if (face !== undefined) window.push(face);
  }
  return [...pinned, ...window];
}

// ---------------------------------------------------------------------------
// 5) Poznaj członka
// ---------------------------------------------------------------------------

export type ClubSpotlightRow = NullableCols<
  RowOf<Fn["club_member_spotlight_current"]["Returns"]>,
  "avatar_url" | "profile_slug" | "headline" | "bio_pl" | "bio_en" | "blurb_pl" | "blurb_en"
>;

/** Wiersz archiwum przedstawień - wyłącznie przypięcia redakcyjne. */
export type ClubSpotlightHistoryRow = NullableCols<
  RowOf<Fn["club_member_spotlight_history"]["Returns"]>,
  "avatar_url" | "profile_slug" | "headline" | "blurb_pl" | "blurb_en"
>;

/** Ile zdań pokazuje moduł. Trzy - tyle mieści się w szynie bez zwijania. */
export const CLUB_SPOTLIGHT_SENTENCES = 3;

/** Poniedziałek tygodnia zawierającego podaną datę - w czasie LOKALNYM.
 *
 *  Rotacja i przypięcie liczą tydzień w bazie (UTC), ale formularz redakcji
 *  pokazuje datę czytelnikowi, więc musi mówić o JEGO tygodniu. RPC i tak
 *  normalizuje wartość do poniedziałku, więc rozjazd o kilka godzin na
 *  granicy stref nie ma prawa niczego zepsuć. */
export function mondayOf(date: Date): string {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay(): 0 = niedziela. Poniedziałek jako początek tygodnia ISO.
  const shift = (local.getDay() + 6) % 7;
  local.setDate(local.getDate() - shift);
  const month = `${local.getMonth() + 1}`.padStart(2, "0");
  const day = `${local.getDate()}`.padStart(2, "0");
  return `${local.getFullYear()}-${month}-${day}`;
}

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
export function spotlightBlurb(row: ClubSpotlightRow, lang: LocaleCode): string {
  // Blurb redakcyjny BEZ fallbacku na drugi język - i to jest decyzja, nie
  // przeoczenie: trzy zdania napisane po polsku pokazane angielskiemu
  // czytelnikowi są gorsze niż jego własne bio w jego języku, a to jest
  // dokładnie punkt 2 poniżej.
  const curated = row[`blurb_${lang}`];
  if (curated !== null && curated.trim() !== "") return firstSentences(curated);

  // Punkty 2 i 3 to dosłownie polityka `pickLocalized`: język interfejsu,
  // potem drugi język, przy czym ciąg samych spacji liczy się jako brak.
  const bio = pickLocalized(row, "bio", lang);
  if (bio !== "") return firstSentences(bio);

  return row.headline ?? "";
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
      headline: toText(entry["headline"]),
      role: toText(entry["role"]) ?? "member",
      joinedAt: toText(entry["joined_at"]),
      isNew: toFlag(entry["is_new"]),
      isActive: toFlag(entry["is_active"]),
      topics: toStringArray(entry["topics"]),
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
