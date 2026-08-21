// Atrapy wierszy KOORDYNACJI W PANELU - ogniwa, których nie ma w `fixtures.ts`.
//
// PO CO OSOBNY PLIK. `fixtures.ts` ma atrapy projekcji PRODUKTOWYCH
// (`clubThreadListRow` z `club_threads_list`), a panel czyta trzy zupełnie inne
// funkcje: `admin_club_threads`, `admin_club_replies` i
// `admin_club_moderation_log`. Kształty się nie pokrywają - projekcja
// administracyjna nie zna kursora ani `is_unread`, zna natomiast `locked_at`,
// `attribution_mode` i sumę `total_count`. Wiersze są typowane aliasami
// z `lib/clubs/types.ts`, więc rozjazd kolumny w migracji wychodzi na typach
// w każdym teście, który ich używa - świadomie BEZ rzutowań `as`.
//
// UWAGA CO DO PUSTEK. `RETURNS TABLE` typuje KAŻDĄ kolumnę jako non-null, choć
// baza oddaje NULL w `pinned_at`, `locked_at`, `posted_by_admin_name`,
// `parent_id` i `reason`. Pustkę reprezentuje więc PUSTY NAPIS - i to jest
// realny powód, dla którego reguły panelu (`adminThreadsBoard.ts`,
// `adminModerationDesk.ts`) traktują `null` i `""` identycznie.
import type {
  AdminClubModerationLogRow,
  AdminClubReplyRow,
  AdminClubThreadRow,
} from "@/lib/clubs/types";
import { CLUB_BASE_ISO, CLUB_IDS } from "./fixtures";

/** Wiersz `admin_club_threads`. Domyślnie: otwarty, nieprzypięty, podpisany. */
export function adminThreadRow(overrides: Partial<AdminClubThreadRow> = {}): AdminClubThreadRow {
  return {
    id: CLUB_IDS.thread,
    slug: "temat-pierwszy",
    title: "Temat pierwszy",
    kind: "discussion",
    status: "open",
    group_id: CLUB_IDS.group,
    group_name_pl: "Dyskusje",
    group_name_en: "Discussions",
    author_id: CLUB_IDS.member,
    author_name: "Anna Nowak",
    attribution_mode: "named",
    is_anonymous: false,
    posted_by_admin_name: "",
    pinned_at: "",
    locked_at: "",
    participant_count: 2,
    reaction_count: 1,
    reply_count: 3,
    created_at: CLUB_BASE_ISO,
    last_reply_at: CLUB_BASE_ISO,
    total_count: 1,
    ...overrides,
  };
}

/** Wiersz `admin_club_replies`. Domyślnie: pierwszy poziom, opublikowany. */
export function adminReplyRow(overrides: Partial<AdminClubReplyRow> = {}): AdminClubReplyRow {
  return {
    id: CLUB_IDS.reply,
    author_id: CLUB_IDS.member,
    author_name: "Anna Nowak",
    body: "Treść odpowiedzi",
    created_at: CLUB_BASE_ISO,
    edited_at: "",
    depth: 0,
    parent_id: "",
    posted_by_admin_name: "",
    is_anonymous: false,
    reaction_count: 0,
    status: "published",
    total_count: 1,
    ...overrides,
  };
}

/** Wiersz `admin_club_moderation_log`. */
export function moderationLogRow(
  overrides: Partial<AdminClubModerationLogRow> = {},
): AdminClubModerationLogRow {
  return {
    id: "log-1",
    action: "approve",
    target_type: "thread",
    target_id: CLUB_IDS.thread,
    moderator_name: "Jan Kowalski",
    reason: "",
    created_at: CLUB_BASE_ISO,
    ...overrides,
  };
}
