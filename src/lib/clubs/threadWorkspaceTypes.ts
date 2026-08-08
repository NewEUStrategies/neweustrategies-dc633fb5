// Przestrzen robocza watku (A28) - kontrakt domenowy po stronie klienta.
//
// Ten plik trzyma DWIE rzeczy i nic wiecej:
//   * slowniki wyprowadzone z CHECK-ow migracji A28 - jedyne zrodlo prawdy dla
//     droplist (droplista z wartoscia spoza CHECK-a to blad widoczny dopiero
//     przy zapisie, czyli po stracie tego, co uzytkownik wpisal),
//   * CZYSTE funkcje skladajace surowe wiersze w ksztalty, ktore rysuje widok.
//
// Zero Reacta, zero `supabase` - wszystko tutaj daje sie przetestowac bez
// renderu i bez bazy. To jest ta sama zasada, ktora trzyma `threadDynamics.ts`
// i `stances.ts` poza komponentami.
import type { Database } from "@/integrations/supabase/types";

type Fn = Database["public"]["Functions"];
type RowOf<T> = T extends readonly (infer R)[] ? R : never;

/**
 * Korekta nullowalnosci - to samo, co `NullableCols` w `types.ts` i z tego
 * samego powodu: generator Supabase deklaruje KAZDA kolumne `RETURNS TABLE`
 * jako niepusta, bo Postgres nie deklaruje tam nullowalnosci. Czesc z nich
 * baza realnie zwraca jako NULL (autor w trybie chatham, opis bez tresci,
 * termin bez konca). Bez tej korekty klient jest typowany na dane, ktorych
 * nigdy nie dostanie.
 */
type NullableCols<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };

// ---------------------------------------------------------------------------
// Slowniki (CHECK-i z migracji 20260808300000)
// ---------------------------------------------------------------------------

/** Rodzaj pozycji w bibliotece zrodel watku. */
export const CLUB_DOCUMENT_KINDS = ["document", "dataset", "link", "note", "recording"] as const;
export type ClubDocumentKind = (typeof CLUB_DOCUMENT_KINDS)[number];

/**
 * Rodzaje, ktore MUSZA miec adres. Odpowiada CHECK-owi
 * `club_thread_documents_url_required`: notatka jest jedyna pozycja bez pliku.
 * Formularz czyta te liste, zeby zablokowac zapis PRZED odbiciem z bazy.
 */
export function clubDocumentNeedsUrl(kind: ClubDocumentKind): boolean {
  return kind !== "note";
}

export const CLUB_MILESTONE_KINDS = [
  "milestone",
  "meeting",
  "deadline",
  "publication",
  "vote",
  "consultation",
] as const;
export type ClubMilestoneKind = (typeof CLUB_MILESTONE_KINDS)[number];

export const CLUB_MILESTONE_STATUSES = ["planned", "active", "done", "cancelled"] as const;
export type ClubMilestoneStatus = (typeof CLUB_MILESTONE_STATUSES)[number];

export const CLUB_QUESTION_STATUSES = ["open", "answered", "declined", "hidden"] as const;
export type ClubQuestionStatus = (typeof CLUB_QUESTION_STATUSES)[number];

/** Porzadki kolejki pytan. `unanswered` wynosi pytania bez odpowiedzi na gore -
 *  to ta sama doktryna, co sort `unanswered` na liscie tematow (V1 par. 5.2). */
export const CLUB_QUESTION_SORTS = ["top", "new", "unanswered"] as const;
export type ClubQuestionSort = (typeof CLUB_QUESTION_SORTS)[number];

/** Nazwane relacje miedzy watkami. "Powiazane" bez nazwy relacji to zbior
 *  linkow, z ktorego nie wynika nic. */
export const CLUB_THREAD_RELATIONS = [
  "continues",
  "supersedes",
  "contradicts",
  "supports",
  "duplicates",
  "context",
] as const;
export type ClubThreadRelation = (typeof CLUB_THREAD_RELATIONS)[number];

/** Sekcje wyszukiwarki wewnetrznej - odpowiadaja galeziom UNION w RPC. */
export const CLUB_WORKSPACE_SECTIONS = ["reply", "document", "milestone", "question"] as const;
export type ClubWorkspaceSection = (typeof CLUB_WORKSPACE_SECTIONS)[number];

/**
 * Panele przestrzeni roboczej. Kolejnosc jest KOLEJNOSCIA NA EKRANIE i nie
 * jest przypadkowa: dyskusja stoi pierwsza, bo to ona jest watkiem; dane i
 * szukanie stoja na koncu, bo sa narzedziami do tego, co powstalo wczesniej.
 */
export const CLUB_WORKSPACE_PANELS = [
  "discussion",
  "participants",
  "documents",
  "schedule",
  "questions",
  "polls",
  "links",
  "insights",
  "search",
] as const;
export type ClubWorkspacePanel = (typeof CLUB_WORKSPACE_PANELS)[number];

function narrow<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Nieznana wartosc z nowszej migracji nie moze wywrocic widoku - stad
 *  jawny fallback zamiast rzutowania. */
export function toClubDocumentKind(value: string | null | undefined): ClubDocumentKind {
  return narrow(value ?? null, CLUB_DOCUMENT_KINDS, "document");
}
export function toClubMilestoneKind(value: string | null | undefined): ClubMilestoneKind {
  return narrow(value ?? null, CLUB_MILESTONE_KINDS, "milestone");
}
export function toClubMilestoneStatus(value: string | null | undefined): ClubMilestoneStatus {
  return narrow(value ?? null, CLUB_MILESTONE_STATUSES, "planned");
}
export function toClubQuestionStatus(value: string | null | undefined): ClubQuestionStatus {
  return narrow(value ?? null, CLUB_QUESTION_STATUSES, "open");
}
export function toClubThreadRelation(value: string | null | undefined): ClubThreadRelation {
  return narrow(value ?? null, CLUB_THREAD_RELATIONS, "context");
}
export function toClubWorkspaceSection(value: string | null | undefined): ClubWorkspaceSection {
  return narrow(value ?? null, CLUB_WORKSPACE_SECTIONS, "reply");
}

// ---------------------------------------------------------------------------
// Ksztalty wierszy z RPC
// ---------------------------------------------------------------------------

export type ClubWorkspaceRow = NullableCols<
  RowOf<Fn["club_thread_workspace"]["Returns"]>,
  "next_milestone_at"
>;

export type ClubThreadDocumentRow = NullableCols<
  RowOf<Fn["club_thread_documents_list"]["Returns"]>,
  | "description"
  | "url"
  | "source_label"
  | "published_on"
  | "mime_type"
  | "byte_size"
  | "added_by_id"
  | "added_by_name"
  | "added_by_slug"
>;

export type ClubThreadMilestoneRow = NullableCols<
  RowOf<Fn["club_thread_milestones_list"]["Returns"]>,
  | "description"
  | "ends_at"
  | "location"
  | "url"
  | "event_id"
  | "event_slug"
  | "owner_id"
  | "owner_name"
  | "owner_slug"
>;

export type ClubThreadQuestionRow = NullableCols<
  RowOf<Fn["club_thread_questions_list"]["Returns"]>,
  | "answer_body"
  | "answered_at"
  | "answered_by_id"
  | "answered_by_name"
  | "author_id"
  | "author_name"
  | "author_avatar"
  | "author_slug"
  | "author_alias"
>;

export type ClubThreadParticipantRow = NullableCols<
  RowOf<Fn["club_thread_participants"]["Returns"]>,
  | "user_id"
  | "display_name"
  | "avatar_url"
  | "profile_slug"
  | "alias"
  | "club_role"
  | "stance"
  | "first_at"
  | "last_at"
>;

export type ClubThreadLinkRow = NullableCols<
  RowOf<Fn["club_thread_links_list"]["Returns"]>,
  "note" | "last_reply_at"
>;

export type ClubThreadPollRow = NullableCols<
  RowOf<Fn["club_thread_polls_list"]["Returns"]>,
  "label" | "ends_at"
>;

export type ClubWorkspaceSearchRow = NullableCols<
  RowOf<Fn["club_thread_search"]["Returns"]>,
  "title" | "snippet" | "author_label"
>;

export type ClubThreadInsightRow = RowOf<Fn["club_thread_insights"]["Returns"]>;

// ---------------------------------------------------------------------------
// Spis tresci przestrzeni
// ---------------------------------------------------------------------------

/**
 * Liczniki paneli w formie znormalizowanej. `null` z RPC (brak prawa odczytu)
 * sprowadzamy do zer z zamknietymi uprawnieniami - dokladnie jak
 * `NO_CLUB_CAPABILITIES`. Widok, ktory dostaje zera zamiast `undefined`, nie
 * musi miec galezi "jeszcze nie wiem" w kazdym miejscu.
 */
export interface ClubWorkspaceSummary {
  documents: number;
  milestones: number;
  upcoming: number;
  questions: number;
  openQuestions: number;
  polls: number;
  openPolls: number;
  links: number;
  participants: number;
  replies: number;
  nextMilestoneAt: string | null;
  canContribute: boolean;
  canCurate: boolean;
}

export const EMPTY_WORKSPACE_SUMMARY: ClubWorkspaceSummary = {
  documents: 0,
  milestones: 0,
  upcoming: 0,
  questions: 0,
  openQuestions: 0,
  polls: 0,
  openPolls: 0,
  links: 0,
  participants: 0,
  replies: 0,
  nextMilestoneAt: null,
  canContribute: false,
  canCurate: false,
};

export function toWorkspaceSummary(row: ClubWorkspaceRow | null | undefined): ClubWorkspaceSummary {
  if (!row) return EMPTY_WORKSPACE_SUMMARY;
  return {
    documents: Number(row.document_count) || 0,
    milestones: Number(row.milestone_count) || 0,
    upcoming: Number(row.upcoming_count) || 0,
    questions: Number(row.question_count) || 0,
    openQuestions: Number(row.open_question_count) || 0,
    polls: Number(row.poll_count) || 0,
    openPolls: Number(row.open_poll_count) || 0,
    links: Number(row.link_count) || 0,
    participants: Number(row.participant_count) || 0,
    replies: Number(row.reply_count) || 0,
    nextMilestoneAt: row.next_milestone_at,
    canContribute: row.can_contribute === true,
    canCurate: row.can_curate === true,
  };
}

/**
 * Liczba, ktora ma stanac przy zakladce. Zwraca `null`, gdy nie ma czego
 * pokazac - odznaka z zerem to szum, ktory uczy czytelnika ignorowac odznaki
 * w ogole, wiec przestaja dzialac tam, gdzie niosa informacje.
 *
 * `discussion` i `search` nie maja licznika z rozmyslu: liczba odpowiedzi stoi
 * w naglowku sekcji, a wyszukiwarka nie ma zawartosci wlasnej.
 */
export function panelBadge(
  panel: ClubWorkspacePanel,
  summary: ClubWorkspaceSummary,
): number | null {
  const value = ((): number => {
    switch (panel) {
      case "participants":
        return summary.participants;
      case "documents":
        return summary.documents;
      case "schedule":
        return summary.milestones;
      case "questions":
        return summary.questions;
      case "polls":
        return summary.polls;
      case "links":
        return summary.links;
      case "discussion":
      case "insights":
      case "search":
        return 0;
    }
  })();
  return value > 0 ? value : null;
}

/**
 * Panele, ktore maja stac na belce. Pusty panel BEZ prawa dopisania niczego
 * jest slepa uliczka - czytelnik klika, widzi "brak pozycji" i nie ma co
 * z tym zrobic. Panel pusty, ale ZAPISYWALNY, zostaje: to jest zaproszenie
 * do wniesienia pierwszej pozycji, czyli dokladnie ta interakcja, dla ktorej
 * przestrzen robocza powstala.
 *
 * `discussion`, `insights` i `search` stoja zawsze - dyskusja jest watkiem,
 * a dane i szukanie dzialaja na tym, co juz jest.
 */
export function visiblePanels(summary: ClubWorkspaceSummary): ClubWorkspacePanel[] {
  return CLUB_WORKSPACE_PANELS.filter((panel) => {
    switch (panel) {
      case "discussion":
      case "insights":
      case "search":
        return true;
      case "participants":
        return summary.participants > 0;
      case "documents":
      case "questions":
        return (panelBadge(panel, summary) ?? 0) > 0 || summary.canContribute;
      case "schedule":
      case "polls":
      case "links":
        return (panelBadge(panel, summary) ?? 0) > 0 || summary.canCurate;
    }
  });
}

// ---------------------------------------------------------------------------
// Harmonogram: grupowanie i kalendarz
// ---------------------------------------------------------------------------

export interface ScheduleGroup {
  /** `past` | `today` | `upcoming` - trzy kubelki, nie dwanascie miesiecy. */
  key: "past" | "today" | "upcoming";
  items: ClubThreadMilestoneRow[];
}

/**
 * Dzieli harmonogram wzgledem CHWILI ODNIESIENIA. Chwila jest parametrem,
 * a nie `Date.now()` w srodku, z dwoch powodow: test nie ma jak przesunac
 * zegara, a render serwerowy i klient musza dostac ten sam podzial (inaczej
 * hydracja przerysowuje liste bez powodu).
 *
 * Kolejnosc kubelkow jest odwrotna do chronologii: "dzis" i "wkrotce" na
 * gorze, przeszlosc na dole. Harmonogram odpowiada na pytanie "co dalej",
 * a nie "co bylo".
 */
export function groupSchedule(rows: readonly ClubThreadMilestoneRow[], now: Date): ScheduleGroup[] {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const past: ClubThreadMilestoneRow[] = [];
  const today: ClubThreadMilestoneRow[] = [];
  const upcoming: ClubThreadMilestoneRow[] = [];

  for (const row of rows) {
    const starts = new Date(row.starts_at).getTime();
    if (Number.isNaN(starts)) continue;
    // Termin wieloDNIOWY, ktory jeszcze trwa, nalezy do "dzis" - inaczej
    // trwajace konsultacje ladowaly w przeszlosci w dniu ich rozpoczecia + 1.
    const ends = row.ends_at !== null ? new Date(row.ends_at).getTime() : starts;
    if (ends < dayStart.getTime()) past.push(row);
    else if (starts < dayEnd.getTime()) today.push(row);
    else upcoming.push(row);
  }

  const groups: ScheduleGroup[] = [
    { key: "today", items: today },
    { key: "upcoming", items: upcoming },
    // Przeszlosc od najnowszej: ostatnie ustalenie jest wazniejsze niz
    // pierwsze spotkanie sprzed pol roku.
    { key: "past", items: [...past].reverse() },
  ];
  return groups.filter((group) => group.items.length > 0);
}

export interface CalendarCell {
  /** Data w formacie YYYY-MM-DD - stabilny klucz i wartosc `dateTime`. */
  iso: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  items: ClubThreadMilestoneRow[];
}

/** Zwraca YYYY-MM-DD w czasie LOKALNYM. `toISOString()` przeliczylby na UTC
 *  i przesunal date o dobe dla wszystkiego przed 01:00 czasu srodkowoeuropejskiego. */
export function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Siatka miesiaca: pelne tygodnie od PONIEDZIALKU. Poniedzialek, a nie
 * niedziela, bo taki jest tydzien w PL i w instytucjach UE - a kalendarz
 * zaczynajacy sie od niedzieli przy polskim interfejsie czyta sie jak blad.
 *
 * Zwraca zawsze wielokrotnosc 7, wiec siatka nie skacze miedzy miesiacami
 * o 5 i 6 rzedow... a scislej: skacze, ale przewidywalnie i bez dziur.
 */
export function buildCalendarGrid(
  rows: readonly ClubThreadMilestoneRow[],
  month: Date,
  today: Date,
): CalendarCell[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  // getDay(): 0 = niedziela. Przesuniecie na tydzien zaczynajacy sie
  // poniedzialkiem to (dzien + 6) % 7.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(start.getDate() - lead);

  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const total = lead + last.getDate();
  const cellCount = Math.ceil(total / 7) * 7;

  const byDay = new Map<string, ClubThreadMilestoneRow[]>();
  for (const row of rows) {
    const at = new Date(row.starts_at);
    if (Number.isNaN(at.getTime())) continue;
    const key = toLocalIsoDate(at);
    const list = byDay.get(key) ?? [];
    list.push(row);
    byDay.set(key, list);
  }

  const todayIso = toLocalIsoDate(today);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < cellCount; i += 1) {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    const iso = toLocalIsoDate(date);
    cells.push({
      iso,
      day: date.getDate(),
      inMonth: date.getMonth() === month.getMonth(),
      isToday: iso === todayIso,
      items: byDay.get(iso) ?? [],
    });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Dane pod wizualizacje
// ---------------------------------------------------------------------------

/** Jedna kolumna wykresu skumulowanego - cztery rodzaje zdarzen w kubelku. */
export interface InsightBar {
  index: number;
  start: string;
  end: string;
  replies: number;
  questions: number;
  documents: number;
  milestones: number;
  total: number;
}

export interface InsightSeries {
  bars: InsightBar[];
  peak: number;
  totals: { replies: number; questions: number; documents: number; milestones: number };
  /** Suma wszystkich zdarzen - widok rysuje pustke, gdy zero. */
  grandTotal: number;
}

export function toInsightSeries(rows: readonly ClubThreadInsightRow[]): InsightSeries {
  const bars: InsightBar[] = rows.map((row) => {
    const replies = Number(row.replies) || 0;
    const questions = Number(row.questions) || 0;
    const documents = Number(row.documents) || 0;
    const milestones = Number(row.milestones) || 0;
    return {
      index: Number(row.bucket_index) || 0,
      start: row.bucket_start,
      end: row.bucket_end,
      replies,
      questions,
      documents,
      milestones,
      total: replies + questions + documents + milestones,
    };
  });

  const totals = bars.reduce(
    (acc, bar) => ({
      replies: acc.replies + bar.replies,
      questions: acc.questions + bar.questions,
      documents: acc.documents + bar.documents,
      milestones: acc.milestones + bar.milestones,
    }),
    { replies: 0, questions: 0, documents: 0, milestones: 0 },
  );

  const peak = bars.reduce((max, bar) => (bar.total > max ? bar.total : max), 0);
  return {
    bars,
    peak,
    totals,
    grandTotal: totals.replies + totals.questions + totals.documents + totals.milestones,
  };
}

/** Jeden slupek rozkladu wkladu uczestnikow. */
export interface ContributionBar {
  key: string;
  label: string;
  value: number;
  /** Udzial 0..1 wzgledem NAJWIEKSZEGO wkladu, nie wzgledem sumy - slupek ma
   *  porownywac uczestnikow miedzy soba, a nie pokazywac tort. */
  ratio: number;
}

/**
 * Rozklad wkladu. `label` przychodzi z zewnatrz (funkcja etykietujaca), bo
 * zlozenie imienia z aliasu jest decyzja o ANONIMOWOSCI i musi zostac w jednym
 * miejscu (`toAuthorLabel`) - a ta funkcja ma zostac czysta i jezykowo
 * neutralna.
 */
export function toContributionBars(
  rows: readonly ClubThreadParticipantRow[],
  label: (row: ClubThreadParticipantRow) => string,
  limit = 8,
): ContributionBar[] {
  const scored = rows
    .map((row) => ({
      key: row.participant_key,
      label: label(row),
      value:
        (Number(row.reply_count) || 0) +
        (Number(row.question_count) || 0) +
        (Number(row.document_count) || 0),
    }))
    .filter((bar) => bar.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, Math.max(1, limit));

  const peak = scored.reduce((max, bar) => (bar.value > max ? bar.value : max), 0);
  return scored.map((bar) => ({ ...bar, ratio: peak === 0 ? 0 : bar.value / peak }));
}

// ---------------------------------------------------------------------------
// Wyszukiwarka wewnetrzna
// ---------------------------------------------------------------------------

/**
 * `ts_headline` zwraca fragment z podswietleniem w `<b>...</b>`. Do DOM-u tego
 * NIE wstawiamy - `dangerouslySetInnerHTML` na tresci pochodzacej od
 * uzytkownika to wektor XSS, nawet jesli akurat ten generator jest
 * bezpieczny. Rozbijamy fragment na kawalki i podswietlenie robi `<mark>`
 * po stronie Reacta.
 */
export interface SnippetPart {
  text: string;
  hit: boolean;
}

export function parseSnippet(snippet: string | null): SnippetPart[] {
  if (snippet === null || snippet.length === 0) return [];
  const parts: SnippetPart[] = [];
  const pattern = /<b>([\s\S]*?)<\/b>/g;
  let cursor = 0;
  let match = pattern.exec(snippet);
  while (match !== null) {
    if (match.index > cursor) {
      parts.push({ text: snippet.slice(cursor, match.index), hit: false });
    }
    parts.push({ text: match[1], hit: true });
    cursor = match.index + match[0].length;
    match = pattern.exec(snippet);
  }
  if (cursor < snippet.length) parts.push({ text: snippet.slice(cursor), hit: false });
  // Znaczniki inne niz <b> nie powinny wystapic, ale gdyby wystapily -
  // zostaja tekstem, bo nic tu nie renderuje HTML-a.
  return parts.filter((part) => part.text.length > 0);
}

/** Wyniki pogrupowane po sekcji, w kolejnosci `CLUB_WORKSPACE_SECTIONS`.
 *  Czytelnik szuka tresci, ale CZYTA wyniki sekcjami - plaska lista miesza
 *  wypowiedz z terminem i traci kontekst, ktory sekcja niesie za darmo. */
export interface SearchSectionGroup {
  section: ClubWorkspaceSection;
  rows: ClubWorkspaceSearchRow[];
}

export function groupSearchResults(rows: readonly ClubWorkspaceSearchRow[]): SearchSectionGroup[] {
  return CLUB_WORKSPACE_SECTIONS.map((section) => ({
    section,
    rows: rows.filter((row) => toClubWorkspaceSection(row.section) === section),
  })).filter((group) => group.rows.length > 0);
}

// ---------------------------------------------------------------------------
// Kody bledow zapisu
// ---------------------------------------------------------------------------

/**
 * Kody odmowy z RPC przestrzeni roboczej. Ta sama droga, co
 * `toClubInviteError`: baza rzuca STALE literaly po angielsku, klient mapuje
 * je na kod, a dopiero z kodu sklada zdanie w jezyku uzytkownika. Bez tego
 * kazda odmowa konczy sie jednym "nie udalo sie zapisac" - a "brak
 * uprawnien", "adres wymagany" i "anonimowosc niedozwolona" to trzy rozne
 * problemy z trzema roznymi nastepnymi krokami.
 */
export const CLUB_WORKSPACE_ERRORS = [
  "forbidden",
  "not_found",
  "url_required",
  "anonymous_not_allowed",
  "answer_required",
  "self_link",
  "poll_options",
  "auth_required",
  "unknown",
] as const;
export type ClubWorkspaceError = (typeof CLUB_WORKSPACE_ERRORS)[number];

export function toClubWorkspaceError(error: unknown): ClubWorkspaceError {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("anonymous not allowed")) return "anonymous_not_allowed";
  if (message.includes("answer body required")) return "answer_required";
  if (message.includes("cannot link thread to itself")) return "self_link";
  if (message.includes("poll needs 2-8 options")) return "poll_options";
  if (message.includes("auth required")) return "auth_required";
  if (message.includes("not found")) return "not_found";
  if (message.includes("forbidden")) return "forbidden";
  // CHECK bazy na brakujacym adresie nie ma wlasnego komunikatu - rozpoznajemy
  // go po nazwie ograniczenia, ktora Postgres dokleja do bledu 23514.
  if (message.includes("club_thread_documents_url_required")) return "url_required";
  return "unknown";
}
