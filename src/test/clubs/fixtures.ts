// Atomy testowe MODUŁU KLUBÓW DYSKUSYJNYCH - atomic design zastosowany do
// testów, dokładnie jak w `src/test/chat/fixtures.ts` i `src/test/profile`.
//
// DLACZEGO TEN MODUŁ WYGLĄDA INACZEJ NIŻ FIXTURE'Y CZATU. Czat czyta bazę
// ŁAŃCUCHEM PostgREST, więc jego atrapa musi odtworzyć ogniwa. Kluby są
// RPC-ONLY i to jest decyzja architektoniczna zapisana w nagłówku
// `src/lib/clubs/api.ts`: tabele modułu nie mają grantów dla klienta, więc
// `supabase.from("clubs")` oddałby pusty zbiór nawet adminowi. Cała
// autoryzacja żyje w SECURITY DEFINER.
//
// Skutek dla testów jest konkretny: nie ma tu ANI JEDNEGO klientowego filtra
// po tenancie, który dałoby się sprawdzić. Kontraktem, który realnie się psuje,
// jest NAZWA funkcji i NAZWY argumentów - skoro serwer zakresuje po tym, co
// dostanie, to zgubiony `p_club_id` nie wywala niczego, tylko cicho traci
// zawężenie. Taki błąd przechodzi przez `tsc` (obiekt argumentów jest luźny),
// przez przegląd (jedna literówka wśród dwudziestu podobnych wierszy) i przez
// interfejs (lista i tak coś pokazuje).
//
// SPOSÓB UŻYCIA (hoisting `vi.mock` bez rzutowań):
//
//   vi.mock("@/integrations/supabase/client", async () =>
//     (await import("@/test/clubs/fixtures")).clubSupabaseMock);
//   import { clubRpc } from "@/test/clubs/fixtures";
//
// `clubRpc` jest singletonem PLIKU testowego (vitest izoluje graf modułów per
// plik), więc `beforeEach(() => clubRpc.reset())` w zupełności wystarcza.
import {
  supabaseRpcStub,
  supabaseAuthStub,
  type SupabaseAuthStub,
  type SupabaseRpcStub,
} from "@/test/supabase";
import type {
  AdminClubModerationItem,
  AdminClubRow,
  ClubGroupRow,
  ClubListRow,
  ClubMemberRow,
  ClubThreadListRow,
  ClubViewRow,
} from "@/lib/clubs/types";

/**
 * Identyfikatory testowe. Trzymane w jednym miejscu, bo asercje kontraktu
 * argumentów porównują je z tym, co dojechało do RPC - literały rozsypane po
 * plikach dawałyby testy, które przechodzą przy przestawionych argumentach.
 */
export const CLUB_IDS = {
  club: "club-1",
  otherClub: "club-2",
  group: "group-1",
  otherGroup: "group-2",
  thread: "thread-1",
  reply: "reply-1",
  me: "user-me",
  member: "user-member",
  lead: "user-lead",
  invitation: "invitation-1",
  link: "link-1",
  tenant: "tenant-alfa",
} as const;

/** Stabilny znacznik czasu bazowy - testy liczą od niego, nie od `Date.now()`. */
export const CLUB_BASE_ISO = "2026-08-18T10:00:00.000Z";

/** `CLUB_BASE_ISO` przesunięty o N minut (dodatnio = w przyszłość). */
export function clubIsoOffset(minutes: number, from: string = CLUB_BASE_ISO): string {
  return new Date(new Date(from).getTime() + minutes * 60_000).toISOString();
}

// --- atrapa klienta ---------------------------------------------------------

/** Rejestrator RPC dla tego pliku testowego. */
export const clubRpc: SupabaseRpcStub = supabaseRpcStub();

/** Tożsamość widziana przez `supabase.auth` - podmienialna w teście. */
const authState: { userId: string | null } = { userId: CLUB_IDS.me };

/** Ustaw zalogowanego (albo `null` = gość) na potrzeby jednego testu. */
export function setClubAuthUser(userId: string | null): void {
  authState.userId = userId;
}

function currentAuth(): SupabaseAuthStub {
  return supabaseAuthStub(authState.userId);
}

/**
 * Obiekt podawany fabryce `vi.mock` w miejsce modułu klienta. Metody czytają
 * `clubRpc`/`authState` LENIWIE, przy wywołaniu - dzięki temu `reset()`
 * i `setClubAuthUser()` działają między testami bez przeładowywania modułu.
 */
export const clubSupabaseMock = {
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => clubRpc.rpc(name, args),
    auth: {
      getUser: () => currentAuth().getUser(),
      getSession: () => currentAuth().getSession(),
    },
  },
};

/** Sprzątanie między testami: puste odpowiedzi, pusty dziennik, gospodarz zalogowany. */
export function resetClubRpc(userId: string | null = CLUB_IDS.me): void {
  clubRpc.reset();
  authState.userId = userId;
}

// --- wiersze RPC ------------------------------------------------------------
// Kształty 1:1 z `Database["public"]["Functions"][...]["Returns"]` (przez
// aliasy z `src/lib/clubs/types.ts`), więc rozjazd kolumny w migracji wychodzi
// na typach w KAŻDYM teście, który wiersza używa - a nie dopiero w runtime.
// Świadomie BEZ rzutowań `as`: rzutowanie zamieniłoby tę gwarancję w atrapę.

/** Wiersz `club_list` - karta klubu w katalogu (`total_count` z window function). */
export function clubListRow(overrides: Partial<ClubListRow> = {}): ClubListRow {
  return {
    id: CLUB_IDS.club,
    slug: "klub-energetyczny",
    name_pl: "Klub energetyczny",
    name_en: "Energy club",
    tagline_pl: "Energia i klimat",
    tagline_en: "Energy and climate",
    accent_color: "#0f766e",
    icon: "zap",
    cover_image_url: "",
    status: "published",
    visibility: "public",
    join_policy: "request",
    member_count: 42,
    group_count: 3,
    thread_count: 12,
    min_tier_rank: 20,
    policy_area: "energy",
    last_activity_at: CLUB_BASE_ISO,
    can_read: true,
    my_role: "member",
    my_status: "active",
    total_count: 1,
    ...overrides,
  };
}

/** Wiersz `club_view` - karta klubu widziana przez konkretną osobę. */
export function clubViewRow(overrides: Partial<ClubViewRow> = {}): ClubViewRow {
  return {
    id: CLUB_IDS.club,
    slug: "klub-energetyczny",
    name_pl: "Klub energetyczny",
    name_en: "Energy club",
    tagline_pl: "Energia i klimat",
    tagline_en: "Energy and climate",
    description_pl: "Opis",
    description_en: "Description",
    rules_pl: "Zasady",
    rules_en: "Rules",
    accent_color: "#0f766e",
    icon: "zap",
    cover_image_url: "",
    layout: "list",
    status: "published",
    visibility: "public",
    join_policy: "request",
    moderation_mode: "post",
    attribution_mode: "named",
    who_can_post: "members",
    member_count: 42,
    group_count: 3,
    thread_count: 12,
    min_tier_rank: 20,
    policy_area: "energy",
    created_at: CLUB_BASE_ISO,
    last_activity_at: CLUB_BASE_ISO,
    rules_accepted_at: CLUB_BASE_ISO,
    reason: "",
    my_role: "member",
    my_status: "active",
    can_read: true,
    can_invite: false,
    can_manage: false,
    can_moderate: false,
    can_post_thread: true,
    can_reply: true,
    can_see_members: true,
    ...overrides,
  };
}

/** Wiersz `club_groups_list` - dział klubu z rozwiązanym dziedziczeniem. */
export function clubGroupRow(overrides: Partial<ClubGroupRow> = {}): ClubGroupRow {
  return {
    id: CLUB_IDS.group,
    club_id: CLUB_IDS.club,
    slug: "dyskusje",
    name_pl: "Dyskusje",
    name_en: "Discussions",
    description_pl: "",
    description_en: "",
    accent_color: "#0f766e",
    icon: "messages-square",
    sort_order: 1,
    status: "published",
    visibility: "public",
    visibility_inherited: true,
    min_tier_rank: 20,
    min_tier_rank_inherited: true,
    moderation_mode: "post",
    moderation_mode_inherited: true,
    attribution_mode: "named",
    attribution_mode_inherited: true,
    who_can_post: "members",
    who_can_post_inherited: true,
    anchor_type: "",
    anchor_id: "",
    opens_at: CLUB_BASE_ISO,
    closes_at: CLUB_BASE_ISO,
    last_activity_at: CLUB_BASE_ISO,
    thread_count: 4,
    can_read: true,
    can_post_thread: true,
    reason: "",
    ...overrides,
  };
}

/** Wiersz `club_members_list`. `total_count` jedzie w KAŻDYM wierszu. */
export function clubMemberRow(overrides: Partial<ClubMemberRow> = {}): ClubMemberRow {
  return {
    user_id: CLUB_IDS.member,
    display_name: "Anna Nowak",
    avatar_url: "",
    slug: "anna-nowak",
    job_title: "Analityk",
    current_company: "NES",
    verified: true,
    role: "member",
    status: "active",
    role_expires_at: "",
    invite_source: "direct",
    joined_at: CLUB_BASE_ISO,
    total_count: 1,
    ...overrides,
  };
}

/** Wiersz `admin_club_list`. */
export function adminClubRow(overrides: Partial<AdminClubRow> = {}): AdminClubRow {
  return {
    id: CLUB_IDS.club,
    slug: "klub-energetyczny",
    name_pl: "Klub energetyczny",
    name_en: "Energy club",
    accent_color: "#0f766e",
    icon: "zap",
    status: "published",
    visibility: "public",
    join_policy: "request",
    moderation_mode: "post",
    attribution_mode: "named",
    who_can_post: "members",
    min_tier_rank: 20,
    policy_area: "energy",
    lead_names: ["Jan Kowalski"],
    member_count: 42,
    group_count: 3,
    thread_count: 12,
    pending_count: 0,
    created_at: CLUB_BASE_ISO,
    last_activity_at: CLUB_BASE_ISO,
    total_count: 1,
    ...overrides,
  };
}

/** Wiersz `club_threads_list`. `cursor_value` niesie kursor następnej strony. */
export function clubThreadListRow(overrides: Partial<ClubThreadListRow> = {}): ClubThreadListRow {
  return {
    id: CLUB_IDS.thread,
    slug: "temat-pierwszy",
    title: "Temat pierwszy",
    excerpt: "Fragment",
    kind: "discussion",
    status: "published",
    topic: "energy",
    icon: null,
    group_id: CLUB_IDS.group,
    group_name_pl: "Dyskusje",
    group_name_en: "Discussions",
    author_id: CLUB_IDS.member,
    author_name: "Anna Nowak",
    author_avatar: null,
    author_slug: "anna-nowak",
    author_alias: null,
    posted_by_admin_name: null,
    is_anonymous: false,
    is_unread: false,
    anchor_type: null,
    anchor_id: null,
    anchor_label: null,
    pinned_at: null,
    reply_count: 3,
    reaction_count: 2,
    insightful_count: 1,
    participant_count: 2,
    hotness: 1.5,
    created_at: CLUB_BASE_ISO,
    last_reply_at: CLUB_BASE_ISO,
    cursor_value: "cursor-1",
    ...overrides,
  };
}

/** Pozycja kolejki premoderacji (`admin_club_moderation_queue`). */
export function moderationItem(
  overrides: Partial<AdminClubModerationItem> = {},
): AdminClubModerationItem {
  return {
    target_type: "thread",
    target_id: CLUB_IDS.thread,
    thread_slug: "temat-pierwszy",
    title: "Zgłoszony temat",
    body: "Fragment treści",
    author_name: "Anna Nowak",
    is_anonymous: false,
    created_at: CLUB_BASE_ISO,
    total_count: 1,
    ...overrides,
  };
}
