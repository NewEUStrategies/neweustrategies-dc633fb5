// Wiersze przestrzeni roboczej klubu i wpisy ściany - atomy testowe HUBA.
//
// PO CO OSOBNY PLIK OBOK `fixtures.ts`. Tamten plik trzyma wiersze RPC
// KATALOGU klubu (`club_list`, `club_view`, `club_groups_list`, wątki,
// moderacja). Hub czyta dodatkowo cztery zapytania kontekstowe - dokumenty,
// kalendarz, harmonogram i ścianę - a ich wiersze mają po ~30 kolumn. Wklejone
// do testu ręcznie byłyby trzydziestoma liniami szumu na każdy przypadek,
// a przez `as ClubDocumentRow` przestałyby pilnować kontraktu z migracją.
//
// Kształty jadą 1:1 z `Database["public"]["Functions"][...]["Returns"]` przez
// aliasy z `workspaceTypes.ts` i `postTypes.ts` - świadomie BEZ rzutowań, więc
// zmiana kolumny w migracji wychodzi na typach w KAŻDYM teście, który wiersza
// używa, a nie dopiero w przeglądarce.
import { CLUB_BASE_ISO, CLUB_IDS } from "@/test/clubs/fixtures";
import type { ClubPostRow } from "@/lib/clubs/postTypes";
import type { ClubDocumentRow, ClubEventRow, ClubMilestoneRow } from "@/lib/clubs/workspaceTypes";

/** Data bez strefy (`YYYY-MM-DD`) wyliczona z `CLUB_BASE_ISO` - `due_on` nie ma godziny. */
export const CLUB_BASE_DAY = CLUB_BASE_ISO.slice(0, 10);

/** Wiersz `club_documents_list` - materiał biblioteki klubu. */
export function clubDocumentRow(overrides: Partial<ClubDocumentRow> = {}): ClubDocumentRow {
  return {
    id: "document-1",
    club_id: CLUB_IDS.club,
    slug: "raport-energetyczny",
    title_pl: "Raport energetyczny",
    title_en: "Energy report",
    summary_pl: null,
    summary_en: null,
    kind: "report",
    language: "pl",
    status: "published",
    visibility: "club",
    file_url: "https://pliki.example/raport.pdf",
    file_size: 2048,
    mime_type: "application/pdf",
    external_url: null,
    version: null,
    source_label: null,
    download_count: 3,
    group_id: CLUB_IDS.group,
    group_name_pl: "Dyskusje",
    group_name_en: "Discussions",
    thread_id: null,
    thread_slug: null,
    uploader_name: "Anna Nowak",
    published_at: CLUB_BASE_ISO,
    pinned_at: null,
    created_at: CLUB_BASE_ISO,
    updated_at: CLUB_BASE_ISO,
    can_manage: false,
    total_count: 1,
    ...overrides,
  };
}

/** Wiersz `club_events_list` - termin w kalendarzu klubu. */
export function clubEventRow(overrides: Partial<ClubEventRow> = {}): ClubEventRow {
  return {
    id: "event-1",
    club_id: CLUB_IDS.club,
    slug: "posiedzenie-wrzesniowe",
    title_pl: "Posiedzenie wrześniowe",
    title_en: "September sitting",
    description_pl: null,
    description_en: null,
    kind: "meeting",
    status: "scheduled",
    starts_at: CLUB_BASE_ISO,
    ends_at: null,
    all_day: false,
    location: null,
    meeting_url: null,
    capacity: null,
    going_count: 2,
    rsvp_enabled: true,
    my_rsvp: null,
    anchor_event_id: null,
    group_id: null,
    group_name_pl: null,
    group_name_en: null,
    thread_id: null,
    thread_slug: null,
    created_at: CLUB_BASE_ISO,
    can_manage: false,
    ...overrides,
  };
}

/** Wiersz `club_milestones_list` - etap harmonogramu klubu. */
export function clubMilestoneRow(overrides: Partial<ClubMilestoneRow> = {}): ClubMilestoneRow {
  return {
    id: "milestone-1",
    club_id: CLUB_IDS.club,
    slug: "konsultacje",
    title_pl: "Konsultacje",
    title_en: "Consultations",
    description_pl: null,
    description_en: null,
    state: "active",
    progress: 40,
    order_index: 1,
    starts_on: CLUB_BASE_DAY,
    due_on: CLUB_BASE_DAY,
    thread_id: null,
    thread_slug: null,
    created_at: CLUB_BASE_ISO,
    can_manage: false,
    ...overrides,
  };
}

/** Wiersz `club_posts_list` - wpis ściany klubu (A31). */
export function clubPostRow(overrides: Partial<ClubPostRow> = {}): ClubPostRow {
  return {
    id: "post-1",
    club_id: CLUB_IDS.club,
    group_id: null,
    group_name_pl: null,
    group_name_en: null,
    thread_id: null,
    thread_slug: null,
    thread_title: null,
    author_id: CLUB_IDS.member,
    author_name: "Anna Nowak",
    author_avatar: null,
    author_slug: "anna-nowak",
    body: "Krótka notatka z posiedzenia.",
    attachments: [],
    like_count: 1,
    liked_by_me: false,
    can_manage: false,
    created_at: CLUB_BASE_ISO,
    edited_at: null,
    total_count: 1,
    ...overrides,
  };
}
