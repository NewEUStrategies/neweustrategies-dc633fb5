// Discussion Club - kontrakt domenowy PRZESTRZENI ROBOCZEJ WATKU (A28).
//
// Warstwa klubu (dokumenty klubu, kalendarz, etapy) mieszka w `workspaceTypes`.
// Tutaj jest warstwa WATKU: zrodla, harmonogram, pytania, glosowania,
// powiazania, uczestnicy, pomiar i szukanie w obrebie jednego watku.
//
// Slowniki sa wyprowadzone wprost z CHECK-ow migracji
// `20260808300000_discussion_clubs_a28_thread_workspace.sql` i sa JEDYNYM
// zrodlem prawdy dla droplist. Wartosc spoza CHECK-a to blad widoczny dopiero
// przy zapisie - czyli po stracie tego, co uzytkownik wpisal.
import type { Database } from "@/integrations/supabase/types";

type Fn = Database["public"]["Functions"];
type RowOf<T> = T extends readonly (infer R)[] ? R : never;

/**
 * Korekta nullowalnosci. Generator Supabase dla `RETURNS TABLE` wypuszcza
 * KAZDA kolumne jako non-null, bo Postgres nie deklaruje tam nullowalnosci.
 */
type NullableCols<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };

// ---------------------------------------------------------------------------
// Slowniki
// ---------------------------------------------------------------------------

/** Rodzaj zrodla w watku. CHECK `club_thread_documents.kind`. */
export const CLUB_THREAD_DOCUMENT_KINDS = [
  "document",
  "dataset",
  "link",
  "note",
  "recording",
] as const;
export type ClubThreadDocumentKind = (typeof CLUB_THREAD_DOCUMENT_KINDS)[number];

/** CHECK `club_thread_milestones.kind`. */
export const CLUB_MILESTONE_KINDS = [
  "milestone",
  "meeting",
  "deadline",
  "publication",
  "vote",
  "consultation",
] as const;
export type ClubMilestoneKind = (typeof CLUB_MILESTONE_KINDS)[number];

/** CHECK `club_thread_milestones.status`. */
export const CLUB_MILESTONE_STATUSES = ["planned", "active", "done", "cancelled"] as const;
export type ClubMilestoneStatus = (typeof CLUB_MILESTONE_STATUSES)[number];

/** CHECK `club_thread_questions.status`. */
export const CLUB_QUESTION_STATUSES = ["open", "answered", "declined", "hidden"] as const;
export type ClubQuestionStatus = (typeof CLUB_QUESTION_STATUSES)[number];

/** Porzadki listy pytan przyjmowane przez `club_thread_questions_list`. */
export const CLUB_QUESTION_SORTS = ["top", "newest", "unanswered"] as const;
export type ClubQuestionSort = (typeof CLUB_QUESTION_SORTS)[number];

/** CHECK `club_thread_links.relation`. */
export const CLUB_THREAD_RELATIONS = [
  "continues",
  "supersedes",
  "contradicts",
  "supports",
  "duplicates",
  "context",
] as const;
export type ClubThreadRelation = (typeof CLUB_THREAD_RELATIONS)[number];

/** Sekcje przeszukiwane przez `club_thread_search`. */
export const CLUB_WORKSPACE_SECTIONS = ["reply", "document", "milestone", "question"] as const;
export type ClubWorkspaceSection = (typeof CLUB_WORKSPACE_SECTIONS)[number];

/** Zakladki przestrzeni roboczej w KOLEJNOSCI, w jakiej stoja na belce. */
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

// ---------------------------------------------------------------------------
// Ksztalty zwracane przez RPC
// ---------------------------------------------------------------------------

export type ClubThreadDocumentRow = NullableCols<
  RowOf<Fn["club_thread_documents_list"]["Returns"]>,
  | "added_by_id"
  | "added_by_name"
  | "added_by_slug"
  | "byte_size"
  | "description"
  | "mime_type"
  | "published_on"
  | "source_label"
  | "url"
>;

export type ClubThreadMilestoneRow = NullableCols<
  RowOf<Fn["club_thread_milestones_list"]["Returns"]>,
  | "description"
  | "ends_at"
  | "event_id"
  | "event_slug"
  | "location"
  | "owner_id"
  | "owner_name"
  | "owner_slug"
  | "url"
>;

export type ClubThreadParticipantRow = NullableCols<
  RowOf<Fn["club_thread_participants"]["Returns"]>,
  | "alias"
  | "avatar_url"
  | "club_role"
  | "display_name"
  | "first_at"
  | "last_at"
  | "profile_slug"
  | "stance"
  | "user_id"
>;

export type ClubThreadQuestionRow = NullableCols<
  RowOf<Fn["club_thread_questions_list"]["Returns"]>,
  | "answer_body"
  | "answered_at"
  | "answered_by_id"
  | "answered_by_name"
  | "author_alias"
  | "author_avatar"
  | "author_id"
  | "author_name"
  | "author_slug"
>;

export type ClubThreadLinkRow = NullableCols<
  RowOf<Fn["club_thread_links_list"]["Returns"]>,
  "last_reply_at" | "note"
>;

export type ClubThreadPollRow = NullableCols<
  RowOf<Fn["club_thread_polls_list"]["Returns"]>,
  "ends_at" | "label"
>;

export type ClubThreadInsightRow = RowOf<Fn["club_thread_insights"]["Returns"]>;

/** Sekcja jest zawezana od razu przy odczycie - widok mapuje ja na ikone. */
export type ClubWorkspaceSearchRow = Omit<
  NullableCols<RowOf<Fn["club_thread_search"]["Returns"]>, "author_label" | "snippet" | "title">,
  "section"
> & { section: ClubWorkspaceSection };

export type ClubWorkspaceRow = NullableCols<
  RowOf<Fn["club_thread_workspace"]["Returns"]>,
  "next_milestone_at"
>;

// ---------------------------------------------------------------------------
// Zawezenia slownikowe
//
// SQL nie ma unii literalow, wiec RPC oddaje te pola jako `string`. Zawezamy je
// Z JAWNYM fallbackiem: wartosc z nowszej migracji ma wyladowac w bezpiecznej
// galezi, a nie wywrocic ekran.
// ---------------------------------------------------------------------------

function narrow<T extends string>(dict: readonly T[], value: string, fallback: T): T {
  return (dict as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function toClubDocumentKind(value: string | undefined | null): ClubThreadDocumentKind {
  return value === undefined || value === null
    ? "document"
    : narrow(CLUB_THREAD_DOCUMENT_KINDS, value, "document");
}

export function toClubMilestoneKind(value: string | undefined | null): ClubMilestoneKind {
  return value === undefined || value === null
    ? "milestone"
    : narrow(CLUB_MILESTONE_KINDS, value, "milestone");
}

export function toClubMilestoneStatus(value: string | undefined | null): ClubMilestoneStatus {
  return value === undefined || value === null
    ? "planned"
    : narrow(CLUB_MILESTONE_STATUSES, value, "planned");
}

export function toClubQuestionStatus(value: string | undefined | null): ClubQuestionStatus {
  return value === undefined || value === null
    ? "open"
    : narrow(CLUB_QUESTION_STATUSES, value, "open");
}

export function toClubThreadRelation(value: string | undefined | null): ClubThreadRelation {
  return value === undefined || value === null
    ? "context"
    : narrow(CLUB_THREAD_RELATIONS, value, "context");
}

export function toClubWorkspaceSection(value: string): ClubWorkspaceSection {
  return narrow(CLUB_WORKSPACE_SECTIONS, value, "reply");
}

/** Tylko notatka moze istniec bez adresu - reszta rodzajow BEZ zrodla jest
 *  pusta obietnica (i tak odbija sie od CHECK-a `..._url_required`). */
export function clubDocumentNeedsUrl(kind: string): boolean {
  return kind !== "note";
}

// ---------------------------------------------------------------------------
// Podsumowanie przestrzeni (belka zakladek)
// ---------------------------------------------------------------------------

export interface ClubWorkspaceSummary {
  threadId: string | null;
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

/** Brak wiersza znaczy "nie wolno czytac watku" - a wiec takze nic dopisac. */
export const EMPTY_WORKSPACE_SUMMARY: ClubWorkspaceSummary = {
  threadId: null,
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

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Number(value) : 0;
}

export function toWorkspaceSummary(row: ClubWorkspaceRow | null): ClubWorkspaceSummary {
  if (row === null) return EMPTY_WORKSPACE_SUMMARY;
  return {
    threadId: row.thread_id,
    documents: count(row.document_count),
    milestones: count(row.milestone_count),
    upcoming: count(row.upcoming_count),
    questions: count(row.question_count),
    openQuestions: count(row.open_question_count),
    polls: count(row.poll_count),
    openPolls: count(row.open_poll_count),
    links: count(row.link_count),
    participants: count(row.participant_count),
    replies: count(row.reply_count),
    nextMilestoneAt: row.next_milestone_at,
    canContribute: row.can_contribute === true,
    canCurate: row.can_curate === true,
  };
}

/** Odznaka na zakladce. Zero nie ma odznaki - "0" to szum, nie informacja.
 *  Dyskusja, dane i szukanie nie licza niczego: pierwsza jest zawsze pelna,
 *  dwie pozostale nie maja zbioru do policzenia. */
export function panelBadge(
  panel: ClubWorkspacePanel,
  summary: ClubWorkspaceSummary,
): number | null {
  const value =
    panel === "participants"
      ? summary.participants
      : panel === "documents"
        ? summary.documents
        : panel === "schedule"
          ? summary.milestones
          : panel === "questions"
            ? summary.openQuestions
            : panel === "polls"
              ? summary.polls
              : panel === "links"
                ? summary.links
                : 0;
  return value > 0 ? value : null;
}

/** Zakladki, ktore maja stac na belce. Pusty panel zostaje TYLKO wtedy, gdy
 *  patrzacy moze go zapelnic - inaczej byłaby to slepa uliczka. */
export function visiblePanels(summary: ClubWorkspaceSummary): ClubWorkspacePanel[] {
  const contribute = summary.canContribute;
  const curate = summary.canCurate;
  const has: Record<ClubWorkspacePanel, boolean> = {
    discussion: true,
    participants: summary.participants > 0,
    documents: summary.documents > 0 || contribute || curate,
    schedule: summary.milestones > 0 || curate,
    questions: summary.questions > 0 || contribute || curate,
    polls: summary.polls > 0 || curate,
    links: summary.links > 0 || curate,
    insights: true,
    search: true,
  };
  return CLUB_WORKSPACE_PANELS.filter((panel) => has[panel]);
}

// ---------------------------------------------------------------------------
// Harmonogram - podzial na dzis / wkrotce / minione
// ---------------------------------------------------------------------------

export type ScheduleGroupKey = "today" | "upcoming" | "past";

export interface ScheduleGroup {
  key: ScheduleGroupKey;
  items: ClubThreadMilestoneRow[];
}

/** Data LOKALNA jako `YYYY-MM-DD`. `toISOString().slice(0,10)` przesuwalby
 *  wieczor o dobe w kazdej strefie na wschod od Greenwich. */
export function toLocalIsoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeOf(value: string | null): number | null {
  if (value === null || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function groupSchedule(rows: readonly ClubThreadMilestoneRow[], now: Date): ScheduleGroup[] {
  const today = toLocalIsoDate(now);
  const stamp = now.getTime();
  const buckets: Record<ScheduleGroupKey, ClubThreadMilestoneRow[]> = {
    today: [],
    upcoming: [],
    past: [],
  };

  for (const row of rows) {
    const start = timeOf(row.starts_at);
    if (start === null) continue;
    const end = timeOf(row.ends_at);
    const spans = end !== null && start <= stamp && end >= stamp;
    const sameDay = toLocalIsoDate(new Date(start)) === today;
    if (sameDay || spans) buckets.today.push(row);
    else if (start > stamp) buckets.upcoming.push(row);
    else buckets.past.push(row);
  }

  const asc = (a: ClubThreadMilestoneRow, b: ClubThreadMilestoneRow) =>
    (timeOf(a.starts_at) ?? 0) - (timeOf(b.starts_at) ?? 0);

  buckets.today.sort(asc);
  buckets.upcoming.sort(asc);
  // Minione od NAJNOWSZYCH: bliska przeszlosc jest wazniejsza od dawnej.
  buckets.past.sort((a, b) => asc(b, a));

  const order: ScheduleGroupKey[] = ["today", "upcoming", "past"];
  return order
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, items: buckets[key] }));
}

// ---------------------------------------------------------------------------
// Siatka miesiaca
// ---------------------------------------------------------------------------

export interface CalendarCell {
  iso: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  items: ClubThreadMilestoneRow[];
}

/** Pelne tygodnie od PONIEDZIALKU - tak wyglada tydzien w PL i w instytucjach
 *  UE, a niepelny pierwszy wiersz lamie nawigacje klawiatura po tabeli. */
export function buildCalendarGrid(
  rows: readonly ClubThreadMilestoneRow[],
  month: Date,
  today: Date,
): CalendarCell[] {
  const byDay = new Map<string, ClubThreadMilestoneRow[]>();
  for (const row of rows) {
    const start = timeOf(row.starts_at);
    if (start === null) continue;
    const key = toLocalIsoDate(new Date(start));
    const bucket = byDay.get(key);
    if (bucket === undefined) byDay.set(key, [row]);
    else bucket.push(row);
  }

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // poniedzialek = 0
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const total = Math.ceil((offset + daysInMonth) / 7) * 7;
  const todayIso = toLocalIsoDate(today);

  const cells: CalendarCell[] = [];
  for (let index = 0; index < total; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const iso = toLocalIsoDate(date);
    cells.push({
      iso,
      day: date.getDate(),
      inMonth: date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear(),
      isToday: iso === todayIso,
      items: byDay.get(iso) ?? [],
    });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Pomiar
// ---------------------------------------------------------------------------

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
  totals: { replies: number; questions: number; documents: number; milestones: number };
  /** Najwyzszy slupek - wysokosci licza sie wobec SZCZYTU, nie wobec sumy. */
  peak: number;
  grandTotal: number;
}

export function toInsightSeries(rows: readonly ClubThreadInsightRow[]): InsightSeries {
  const bars: InsightBar[] = rows.map((row) => {
    const replies = count(row.replies);
    const questions = count(row.questions);
    const documents = count(row.documents);
    const milestones = count(row.milestones);
    return {
      index: count(row.bucket_index),
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
  const grandTotal = totals.replies + totals.questions + totals.documents + totals.milestones;
  return { bars, totals, peak, grandTotal };
}

export interface ContributionBar {
  key: string;
  label: string;
  value: number;
  ratio: number;
}

/** Rozklad wkladu. Udzial liczony wobec SZCZYTU, bo pytanie brzmi "kto niesie
 *  te rozmowe", a nie "jaki procent calosci to jest". */
export function toContributionBars(
  rows: readonly ClubThreadParticipantRow[],
  label: (row: ClubThreadParticipantRow) => string,
  limit = 8,
): ContributionBar[] {
  const bars = rows
    .map((row) => ({
      key: row.participant_key,
      label: label(row),
      value: count(row.reply_count) + count(row.question_count) + count(row.document_count),
    }))
    .filter((bar) => bar.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  const peak = bars.reduce((max, bar) => (bar.value > max ? bar.value : max), 0);
  return bars.map((bar) => ({ ...bar, ratio: peak === 0 ? 0 : bar.value / peak }));
}

// ---------------------------------------------------------------------------
// Szukanie
// ---------------------------------------------------------------------------

export interface SnippetPart {
  text: string;
  hit: boolean;
}

/**
 * Fragment z `ts_headline` przychodzi ze znacznikami `<b>`. Parsujemy go na
 * czesci ZAMIAST wstawiac przez `dangerouslySetInnerHTML`: gdyby tresc szla
 * jako HTML, `<img onerror=...>` z wypowiedzi wykonalby sie w przegladarce.
 */
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
    if (match[1].length > 0) parts.push({ text: match[1], hit: true });
    cursor = match.index + match[0].length;
    match = pattern.exec(snippet);
  }
  if (cursor < snippet.length) parts.push({ text: snippet.slice(cursor), hit: false });
  return parts;
}

export interface SearchGroup {
  section: ClubWorkspaceSection;
  rows: ClubWorkspaceSearchRow[];
}

/** Stala kolejnosc sekcji: dyskusja jest tym, czego szuka sie najczesciej. */
export function groupSearchResults(rows: readonly ClubWorkspaceSearchRow[]): SearchGroup[] {
  const buckets = new Map<ClubWorkspaceSection, ClubWorkspaceSearchRow[]>();
  for (const row of rows) {
    const section = toClubWorkspaceSection(row.section);
    const bucket = buckets.get(section);
    if (bucket === undefined) buckets.set(section, [row]);
    else bucket.push(row);
  }
  return CLUB_WORKSPACE_SECTIONS.filter((section) => (buckets.get(section)?.length ?? 0) > 0).map(
    (section) => ({ section, rows: buckets.get(section) ?? [] }),
  );
}

// ---------------------------------------------------------------------------
// Bledy
//
// RPC mowi literalem (`clubs: forbidden`). Interfejs potrzebuje KODU, zeby
// pokazac zdanie w jezyku uzytkownika - komunikat z bazy nie jest tlumaczony
// i nie ma prawa trafic na ekran.
// ---------------------------------------------------------------------------

export type ClubWorkspaceErrorCode =
  | "auth_required"
  | "forbidden"
  | "not_found"
  | "anonymous_not_allowed"
  | "answer_required"
  | "self_link"
  | "poll_options"
  | "url_required"
  | "unknown";

const ERROR_PATTERNS: readonly [RegExp, ClubWorkspaceErrorCode][] = [
  [/url_required/, "url_required"],
  [/not found/, "not_found"],
  [/anonymous not allowed/, "anonymous_not_allowed"],
  [/answer body required/, "answer_required"],
  [/link thread to itself/, "self_link"],
  [/poll needs/, "poll_options"],
  [/auth required/, "auth_required"],
  [/forbidden/, "forbidden"],
];

function messageOf(error: unknown): string {
  if (error === null || error === undefined) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error) {
    const value = (error as { message: unknown }).message;
    return typeof value === "string" ? value : "";
  }
  return "";
}

export function toClubWorkspaceError(error: unknown): ClubWorkspaceErrorCode {
  const message = messageOf(error).toLowerCase();
  if (message.length === 0) return "unknown";
  for (const [pattern, code] of ERROR_PATTERNS) {
    if (pattern.test(message)) return code;
  }
  return "unknown";
}
