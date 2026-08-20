// WIERSZE RPC warstwy SIECIUJĄCEJ klubu - atomy testowe sześciu ekranów
// (tablica ogłoszeń, katalog ekspertów, spotkanie, poznaj członka, skrzynka
// zaproszeń, katalog elementów).
//
// PO CO OSOBNY MODUŁ, A NIE WIERSZE W `fixtures.ts`. Tamten plik obsługuje
// warstwę danych i panel - jego wiersze opisują klub, dział, wątek i skład.
// Warstwa SIECIUJĄCA (`networkTypes.ts`) dołożyła siedem własnych kształtów,
// z których każdy jest potrzebny w dwóch-trzech plikach testowych ekranów.
// Trzecia kopia wiersza `club_event_view` w trzecim pliku rozjechałaby się przy
// pierwszej zmianie kolumny - dokładnie tak, jak rozjechałyby się trzy kopie
// karty osoby, gdyby nie `ClubPersonCard`.
//
// WSZYSTKIE KSZTAŁTY SĄ TYPOWANE ALIASAMI Z PRODUKCJI (`import type`), więc
// rozjazd kolumny w migracji wychodzi na `tsc` w KAŻDYM teście, który wiersza
// używa. Świadomie bez rzutowań `as`: rzutowanie zamieniłoby tę gwarancję
// w atrapę.
//
// IMPORTY SĄ TYLKO TYPAMI - i to jest warunek, nie oszczędność. Ten moduł
// bywa wołany z WNĘTRZA fabryk `vi.mock`, a fabryka, która dosięgnie
// `react-i18next` (choćby przez pięć poziomów), zakleszcza kolekcję pliku
// testowego. `import type` znika w kompilacji, więc w runtime ten moduł nie
// ciągnie ZA SOBĄ niczego.
//
// ATRAPY KOMPONENTÓW podrzędnych stoją osobno, w `networkScreenStubs.tsx`:
// wiersze RPC i JSX to dwa różne byty, a plik bez JSX-a nie musi się tłumaczyć
// przed regułą `react-refresh`.
import type { ClubMyInvitationRow } from "@/lib/clubs/types";
import type {
  ClubBoardNoticeRow,
  ClubEventAttendeeRow,
  ClubEventViewRow,
  ClubExpertRow,
  ClubExpertiseArea,
  ClubSpotlightHistoryRow,
  ClubSpotlightRow,
} from "@/lib/clubs/networkTypes";

/** Identyfikatory ekranów sieciujących - jedno miejsce dla asercji kontraktu. */
export const NET_IDS = {
  club: "club-1",
  notice: "notice-1",
  otherNotice: "notice-2",
  event: "event-1",
  spotlight: "spotlight-1",
  invitation: "invitation-1",
  me: "user-me",
  member: "user-member",
  otherMember: "user-other",
} as const;

/** Znacznik bazowy ekranów sieciujących - ten sam co `CLUB_BASE_ISO`. */
export const NET_BASE_ISO = "2026-08-18T10:00:00.000Z";

/** `NET_BASE_ISO` przesunięty o N minut (dodatnio = w przyszłość). */
export function netIsoOffset(minutes: number, from: string = NET_BASE_ISO): string {
  return new Date(new Date(from).getTime() + minutes * 60_000).toISOString();
}

const DAY_MINUTES = 24 * 60;

/** `NET_BASE_ISO` przesunięty o N dni - ważność ogłoszeń liczy się w dniach. */
export function netIsoDays(days: number): string {
  return netIsoOffset(days * DAY_MINUTES);
}

// --- wiersze RPC ------------------------------------------------------------

/** Wiersz `club_board_notices_list` - ogłoszenie na tablicy. */
export function boardNoticeRow(overrides: Partial<ClubBoardNoticeRow> = {}): ClubBoardNoticeRow {
  return {
    id: NET_IDS.notice,
    kind: "seeking",
    status: "open",
    body: "Szukam danych o kosztach bilansowania po stronie OSD.",
    topic: "energy",
    author_id: NET_IDS.member,
    author_name: "Anna Nowak",
    author_avatar: null,
    author_slug: "anna-nowak",
    author_headline: "Analityk - NES",
    created_at: NET_BASE_ISO,
    expires_at: netIsoDays(30),
    closed_at: null,
    is_expired: false,
    is_mine: false,
    can_close: false,
    total_count: 1,
    ...overrides,
  };
}

/** Wiersz `club_experts_list` - deklaracja PLUS dorobek w klubie. */
export function expertRow(overrides: Partial<ClubExpertRow> = {}): ClubExpertRow {
  return {
    user_id: NET_IDS.member,
    display_name: "Anna Nowak",
    avatar_url: null,
    profile_slug: "anna-nowak",
    headline: "Analityk - NES",
    club_role: "member",
    topics: ["energy"],
    thread_count: 4,
    reply_count: 8,
    joined_at: NET_BASE_ISO,
    last_active_at: netIsoOffset(-60),
    total_count: 1,
    ...overrides,
  };
}

/** Wiersz `club_expertise_areas` - obszar z licznikiem osób. */
export function expertiseArea(overrides: Partial<ClubExpertiseArea> = {}): ClubExpertiseArea {
  return { topic: "energy", people: 3, ...overrides };
}

/** Wiersz `club_event_view` - jedno spotkanie klubu. */
export function eventViewRow(overrides: Partial<ClubEventViewRow> = {}): ClubEventViewRow {
  return {
    id: NET_IDS.event,
    club_id: NET_IDS.club,
    group_id: null,
    group_name_pl: null,
    group_name_en: null,
    slug: "trilog-gazowy",
    kind: "meeting",
    status: "scheduled",
    title_pl: "Trilog gazowy - przygotowanie stanowiska",
    title_en: "Gas trilogue - position prep",
    description_pl: "Omawiamy stanowisko klubu przed trilogiem.",
    description_en: "We discuss the club position before the trilogue.",
    starts_at: netIsoDays(3),
    ends_at: netIsoOffset(3 * DAY_MINUTES + 90),
    all_day: false,
    location: "Bruksela, Rue Belliard 40",
    meeting_url: "https://spotkanie.example/trilog",
    capacity: 20,
    going_count: 7,
    rsvp_enabled: true,
    my_rsvp: null,
    thread_id: "thread-1",
    thread_slug: "temat-pierwszy",
    anchor_event_id: null,
    can_manage: false,
    created_at: NET_BASE_ISO,
    ...overrides,
  };
}

/** Wiersz `club_event_attendees` - jedna zadeklarowana obecność. */
export function eventAttendeeRow(
  overrides: Partial<ClubEventAttendeeRow> = {},
): ClubEventAttendeeRow {
  return {
    user_id: NET_IDS.member,
    display_name: "Anna Nowak",
    avatar_url: null,
    profile_slug: "anna-nowak",
    headline: "Analityk - NES",
    state: "going",
    is_me: false,
    total_count: 1,
    ...overrides,
  };
}

/** Wiersz `club_member_spotlight_current` - osoba tego tygodnia. */
export function spotlightRow(overrides: Partial<ClubSpotlightRow> = {}): ClubSpotlightRow {
  return {
    user_id: NET_IDS.member,
    display_name: "Anna Nowak",
    avatar_url: null,
    profile_slug: "anna-nowak",
    headline: "Analityk - NES",
    club_role: "member",
    bio_pl: "Pracuje nad rynkiem energii. Doradzała m.in. MKiŚ. Prowadzi seminarium.",
    bio_en: "Works on energy markets.",
    blurb_pl: "Trzy zdania redakcji o Annie. Zna rynek gazu. Pisze o bilansowaniu.",
    blurb_en: "Three editorial sentences about Anna.",
    topics: ["energy", "transport"],
    curated: true,
    week_start: "2026-08-17",
    joined_at: NET_BASE_ISO,
    ...overrides,
  };
}

/** Wiersz `club_member_spotlight_history` - przypięcie redakcyjne w archiwum. */
export function spotlightHistoryRow(
  overrides: Partial<ClubSpotlightHistoryRow> = {},
): ClubSpotlightHistoryRow {
  return {
    id: NET_IDS.spotlight,
    user_id: NET_IDS.otherMember,
    display_name: "Jan Kowalski",
    avatar_url: null,
    profile_slug: "jan-kowalski",
    headline: "Dyrektor - MSZ",
    blurb_pl: "Prowadził negocjacje pakietu.",
    blurb_en: "Led the package negotiations.",
    topics: ["geopolitics"],
    week_start: "2026-08-10",
    is_current: false,
    can_manage: false,
    ...overrides,
  };
}

/** Wiersz `club_my_invitations` - zaproszenie w skrzynce. */
export function myInvitationRow(overrides: Partial<ClubMyInvitationRow> = {}): ClubMyInvitationRow {
  return {
    id: NET_IDS.invitation,
    club_id: NET_IDS.club,
    club_slug: "klub-energetyczny",
    club_name_pl: "Klub energetyczny",
    club_name_en: "Energy club",
    club_icon: "zap",
    club_role: "member",
    inviter_name: "Jan Kowalski",
    message: "Dołącz, przyda się twoja wiedza o bilansowaniu.",
    expires_at: netIsoDays(7),
    created_at: NET_BASE_ISO,
    ...overrides,
  };
}
