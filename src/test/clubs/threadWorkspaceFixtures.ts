// Wiersze RPC PRZESTRZENI ROBOCZEJ WĄTKU (A28) - fabryki dla testów paneli.
//
// DLACZEGO OSOBNY PLIK, A NIE `clubs/fixtures.ts`. Tamten moduł podmienia
// KLIENTA Supabase (`clubSupabaseMock`) i trzyma stan uwierzytelnienia, więc
// import go po to, by dostać jeden wiersz, wciąga do pliku testowego atrapę
// warstwy danych, której panel nie używa. Tu nie ma żadnego stanu ani atrapy -
// wyłącznie kształty.
//
// Kształty są 1:1 z `Database["public"]["Functions"][...]["Returns"]` (przez
// aliasy z `threadWorkspaceTypes`/`networkTypes`), świadomie BEZ rzutowań `as`:
// rozjazd kolumny w migracji wychodzi wtedy na typach w KAŻDYM teście, który
// wiersza używa, a nie dopiero w runtime.
//
// TEN PLIK NIE IMPORTUJE NICZEGO, CO DOCHODZI DO `react-i18next` - fabryki
// `vi.mock` bywają jego konsumentem, a taki import domyka cykl inicjalizacji
// i zawiesza kolekcję pliku testowego (patrz nagłówek `@/test/i18nStub`).
import type { ClubAnchorHit } from "@/lib/clubs/types";
import type { ClubThreadExpertRow } from "@/lib/clubs/networkTypes";
import type {
  ClubThreadDocumentRow,
  ClubThreadInsightRow,
  ClubThreadLinkRow,
  ClubThreadMilestoneRow,
  ClubThreadParticipantRow,
  ClubThreadPollRow,
  ClubThreadQuestionRow,
  ClubWorkspaceSearchRow,
} from "@/lib/clubs/threadWorkspaceTypes";

/** Stabilna chwila odniesienia dla całego modułu wątku. */
export const WS_BASE_ISO = "2026-08-18T10:00:00.000Z";

/** `WS_BASE_ISO` przesunięty o N minut (dodatnio = w przyszłość). */
export function wsIsoOffset(minutes: number, from: string = WS_BASE_ISO): string {
  return new Date(new Date(from).getTime() + minutes * 60_000).toISOString();
}

export function threadDocumentRow(
  overrides: Partial<ClubThreadDocumentRow> = {},
): ClubThreadDocumentRow {
  return {
    id: "doc-1",
    kind: "document",
    title: "Analiza rynku mocy",
    description: null,
    url: "https://example.test/analiza.pdf",
    mime_type: "application/pdf",
    byte_size: 20480,
    source_label: null,
    published_on: null,
    is_primary: false,
    sort_order: 0,
    can_edit: true,
    created_at: WS_BASE_ISO,
    added_by_id: "user-member",
    added_by_name: "Anna Nowak",
    added_by_slug: "anna-nowak",
    ...overrides,
  };
}

export function threadMilestoneRow(
  overrides: Partial<ClubThreadMilestoneRow> = {},
): ClubThreadMilestoneRow {
  return {
    id: "milestone-1",
    kind: "meeting",
    status: "planned",
    title: "Posiedzenie zespołu",
    description: null,
    starts_at: WS_BASE_ISO,
    ends_at: null,
    all_day: false,
    location: null,
    url: null,
    event_id: null,
    event_slug: null,
    owner_id: null,
    owner_name: null,
    owner_slug: null,
    sort_order: 0,
    can_edit: true,
    created_at: WS_BASE_ISO,
    ...overrides,
  };
}

export function threadParticipantRow(
  overrides: Partial<ClubThreadParticipantRow> = {},
): ClubThreadParticipantRow {
  return {
    participant_key: "user-member",
    user_id: "user-member",
    display_name: "Anna Nowak",
    alias: null,
    avatar_url: null,
    profile_slug: "anna-nowak",
    club_role: "member",
    stance: null,
    reply_count: 3,
    question_count: 0,
    document_count: 0,
    reactions_received: 1,
    is_thread_author: false,
    first_at: WS_BASE_ISO,
    last_at: WS_BASE_ISO,
    ...overrides,
  };
}

export function threadQuestionRow(
  overrides: Partial<ClubThreadQuestionRow> = {},
): ClubThreadQuestionRow {
  return {
    id: "question-1",
    body: "Jak liczycie koszt bilansowania?",
    status: "open",
    vote_count: 2,
    my_vote: false,
    can_answer: true,
    can_edit: false,
    created_at: WS_BASE_ISO,
    author_id: "user-member",
    author_name: "Anna Nowak",
    author_slug: "anna-nowak",
    author_avatar: null,
    author_alias: null,
    answer_body: null,
    answered_at: null,
    answered_by_id: null,
    answered_by_name: null,
    ...overrides,
  };
}

export function threadLinkRow(overrides: Partial<ClubThreadLinkRow> = {}): ClubThreadLinkRow {
  return {
    id: "link-1",
    thread_id: "thread-2",
    thread_slug: "ciag-dalszy",
    title: "Ciąg dalszy dyskusji",
    kind: "debate",
    status: "open",
    club_slug: "klub-energetyczny",
    club_name_pl: "Klub energetyczny",
    club_name_en: "Energy club",
    relation: "continues",
    direction: "outgoing",
    note: null,
    reply_count: 4,
    last_reply_at: null,
    can_remove: true,
    created_at: WS_BASE_ISO,
    ...overrides,
  };
}

export function threadPollRow(overrides: Partial<ClubThreadPollRow> = {}): ClubThreadPollRow {
  return {
    id: "thread-poll-1",
    poll_id: "poll-1",
    label: null,
    poll_status: "open",
    question_pl: "Czy popierasz reformę?",
    question_en: "Do you support the reform?",
    ends_at: null,
    sort_order: 0,
    can_remove: true,
    created_at: WS_BASE_ISO,
    ...overrides,
  };
}

export function threadInsightRow(
  overrides: Partial<ClubThreadInsightRow> = {},
): ClubThreadInsightRow {
  return {
    bucket_index: 0,
    bucket_start: WS_BASE_ISO,
    bucket_end: wsIsoOffset(60 * 24 * 7),
    replies: 0,
    questions: 0,
    documents: 0,
    milestones: 0,
    ...overrides,
  };
}

export function workspaceSearchRow(
  overrides: Partial<ClubWorkspaceSearchRow> = {},
): ClubWorkspaceSearchRow {
  return {
    section: "reply",
    item_id: "reply-1",
    title: null,
    snippet: "koszt <b>bilansowania</b> w modelu",
    author_label: "Anna Nowak",
    occurred_at: WS_BASE_ISO,
    rank: 0.9,
    ...overrides,
  };
}

export function threadExpertRow(overrides: Partial<ClubThreadExpertRow> = {}): ClubThreadExpertRow {
  return {
    user_id: "user-member",
    display_name: "Anna Nowak",
    avatar_url: null,
    profile_slug: "anna-nowak",
    headline: "Analityczka rynku energii",
    club_role: "member",
    topic: "energy",
    topics: ["energy"],
    in_thread: false,
    pinged_by_me: false,
    ...overrides,
  };
}

export function clubAnchorHit(overrides: Partial<ClubAnchorHit> = {}): ClubAnchorHit {
  return {
    thread_id: "thread-1",
    thread_slug: "rynek-mocy",
    title: "Rynek mocy po 2030",
    kind: "debate",
    club_slug: "klub-energetyczny",
    club_name_pl: "Klub energetyczny",
    club_name_en: "Energy club",
    reply_count: 7,
    last_reply_at: WS_BASE_ISO,
    ...overrides,
  };
}
