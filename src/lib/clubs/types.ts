// Discussion Club - kontrakt domenowy po stronie klienta.
//
// Slowniki sa wyprowadzone z CHECK-ow w bazie i sluza za JEDYNE zrodlo prawdy
// dla dropList w panelu. Gdy CHECK w migracji sie zmieni, a te tablice nie,
// test kontraktu (src/lib/clubs/__tests__/clubContract.test.ts) oblewa - bo
// droplista z wartoscia spoza CHECK-a to blad, ktory widac dopiero przy
// zapisie, czyli po stracie tego, co uzytkownik wpisal.
import type { Database } from "@/integrations/supabase/types";

/** Widocznosc klubu. Osobna os od polityki wstepu - patrz V1 §1.1. */
export const CLUB_VISIBILITIES = ["public", "members", "private", "secret"] as const;
export type ClubVisibility = (typeof CLUB_VISIBILITIES)[number];

/** Polityka wstepu. Kombinacja public + invite jest poprawna i czesta. */
export const CLUB_JOIN_POLICIES = ["open", "request", "invite"] as const;
export type ClubJoinPolicy = (typeof CLUB_JOIN_POLICIES)[number];

/** Tryb atrybucji wypowiedzi (regula Chatham House). */
export const CLUB_ATTRIBUTION_MODES = ["attributed", "chatham", "anonymous_allowed"] as const;
export type ClubAttributionMode = (typeof CLUB_ATTRIBUTION_MODES)[number];

/** Kto zaklada temat. Domyslnie moderators - przejscie na members to decyzja
 *  produktowa w droplistcie, nie zmiana architektury (V2 §0). */
export const CLUB_POST_POLICIES = ["members", "moderators", "staff_only"] as const;
export type ClubPostPolicy = (typeof CLUB_POST_POLICIES)[number];

/** Tryb moderacji. trusted = premoderacja tylko ponizej progu reputacji. */
export const CLUB_MODERATION_MODES = ["post", "pre", "trusted"] as const;
export type ClubModerationMode = (typeof CLUB_MODERATION_MODES)[number];

export const CLUB_STATUSES = ["draft", "active", "archived"] as const;
export type ClubStatus = (typeof CLUB_STATUSES)[number];

export const CLUB_GROUP_STATUSES = ["draft", "scheduled", "active", "frozen", "archived"] as const;
export type ClubGroupStatus = (typeof CLUB_GROUP_STATUSES)[number];

/** Rola W KLUBIE. Osobna os od public.app_role - nigdy ich nie mieszac. */
export const CLUB_MEMBER_ROLES = ["lead", "moderator", "member", "observer"] as const;
export type ClubMemberRole = (typeof CLUB_MEMBER_ROLES)[number];

export const CLUB_MEMBER_STATUSES = ["active", "pending", "invited", "banned", "left"] as const;
export type ClubMemberStatus = (typeof CLUB_MEMBER_STATUSES)[number];

export const CLUB_NOTIFY_LEVELS = ["all", "mentions", "digest", "none"] as const;
export type ClubNotifyLevel = (typeof CLUB_NOTIFY_LEVELS)[number];

/**
 * Kody powodu z club_capabilities().reason. UI mapuje kod na zdanie ORAZ na
 * wlasciwa akcje - dlatego to jest domkniety slownik, a nie wolny tekst.
 * Zbior musi odpowiadac galeziom w migracji 20260808090000.
 */
export const CLUB_ACCESS_REASONS = [
  "not_found",
  "auth_required",
  "not_member",
  "tier_too_low",
  "group_frozen",
  "not_open_yet",
  "window_closed",
  "archived",
  "banned",
  "pre_moderation",
] as const;
export type ClubAccessReason = (typeof CLUB_ACCESS_REASONS)[number];

/** Rola efektywna zwracana przez club_capabilities - rola klubowa albo brak. */
export type ClubEffectiveRole = ClubMemberRole | "non_member" | "banned";

// ---------------------------------------------------------------------------
// Ksztalty zwracane przez RPC. Wyprowadzone z wygenerowanego kontraktu, zeby
// rozjazd migracja <-> klient wychodzil przy kompilacji, a nie w przegladarce.
// ---------------------------------------------------------------------------
type Fn = Database["public"]["Functions"];

type RowOf<T> = T extends readonly (infer R)[] ? R : never;

export type ClubCapabilitiesRow = RowOf<Fn["club_capabilities"]["Returns"]>;
export type ClubListRow = RowOf<Fn["club_list"]["Returns"]>;
export type ClubViewRow = RowOf<Fn["club_view"]["Returns"]>;
export type ClubGroupRow = RowOf<Fn["club_groups_list"]["Returns"]>;
export type ClubMemberRow = RowOf<Fn["club_members_list"]["Returns"]>;
export type ClubMembershipRow = RowOf<Fn["club_my_memberships"]["Returns"]>;
export type AdminClubRow = RowOf<Fn["admin_club_list"]["Returns"]>;
export type AdminClubDetailRow = RowOf<Fn["admin_club_get"]["Returns"]>;
export type AdminClubGroupRow = RowOf<Fn["admin_club_groups"]["Returns"]>;
export type AdminClubStatsRow = RowOf<Fn["admin_club_stats"]["Returns"]>;

/**
 * Zdolnosci w formie znormalizowanej. RPC zwraca `reason` jako `string` (bo
 * SQL nie ma unii literalow), a tutaj zawezamy go do slownika - z jawnym
 * fallbackiem, zeby nieznany kod z nowszej migracji nie wywrocil interfejsu.
 */
export interface ClubCapabilities {
  canRead: boolean;
  canPostThread: boolean;
  canReply: boolean;
  canReact: boolean;
  canModerate: boolean;
  canManage: boolean;
  canInvite: boolean;
  canSeeMembers: boolean;
  canRevealAuthor: boolean;
  effectiveRole: ClubEffectiveRole;
  reason: ClubAccessReason | null;
}

/** Zdolnosci calkowicie zamkniete - stan wyjsciowy zanim RPC odpowie. */
export const NO_CLUB_CAPABILITIES: ClubCapabilities = {
  canRead: false,
  canPostThread: false,
  canReply: false,
  canReact: false,
  canModerate: false,
  canManage: false,
  canInvite: false,
  canSeeMembers: false,
  canRevealAuthor: false,
  effectiveRole: "non_member",
  reason: null,
};

function isAccessReason(value: string | null): value is ClubAccessReason {
  return value !== null && (CLUB_ACCESS_REASONS as readonly string[]).includes(value);
}

function isEffectiveRole(value: string | null): value is ClubEffectiveRole {
  return (
    value === "non_member" ||
    value === "banned" ||
    (value !== null && (CLUB_MEMBER_ROLES as readonly string[]).includes(value))
  );
}

/**
 * Normalizacja wiersza z club_capabilities. Czysta funkcja - testowalna bez
 * bazy i bez Reacta, co jest calym sensem trzymania jej tutaj.
 */
export function toClubCapabilities(row: ClubCapabilitiesRow | null | undefined): ClubCapabilities {
  if (!row) return NO_CLUB_CAPABILITIES;
  const reason = row.reason ?? null;
  const role = row.effective_role ?? null;
  return {
    canRead: row.can_read === true,
    canPostThread: row.can_post_thread === true,
    canReply: row.can_reply === true,
    canReact: row.can_react === true,
    canModerate: row.can_moderate === true,
    canManage: row.can_manage === true,
    canInvite: row.can_invite === true,
    canSeeMembers: row.can_see_members === true,
    canRevealAuthor: row.can_reveal_author === true,
    effectiveRole: isEffectiveRole(role) ? role : "non_member",
    // Nieznany kod traktujemy jak brak powodu: interfejs pokaze ogolna
    // odmowe zamiast surowego stringa z bazy.
    reason: isAccessReason(reason) ? reason : null,
  };
}

// ---------------------------------------------------------------------------
// Dziedziczenie ustawien grupy
// ---------------------------------------------------------------------------

/**
 * Wartosc ustawienia grupy wraz z informacja, czy pochodzi z klubu.
 * Baza rozwiazuje dziedziczenie i zwraca oba pola (kolumny *_inherited),
 * wiec klient NIE powtarza reguly - tylko ja prezentuje.
 */
export interface InheritedSetting<T> {
  value: T;
  inherited: boolean;
}

export interface ClubGroupSettings {
  visibility: InheritedSetting<ClubVisibility>;
  whoCanPost: InheritedSetting<ClubPostPolicy>;
  moderationMode: InheritedSetting<ClubModerationMode>;
  minTierRank: InheritedSetting<number>;
  attributionMode: InheritedSetting<ClubAttributionMode>;
}

function narrow<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Ksztalt strukturalny wspolny dla obu projekcji grupy (produktowej
 * club_groups_list i administracyjnej admin_club_groups). Dzieki temu jedna
 * funkcja obsluguje oba wiersze bez rzutowania - roznia sie polami spoza
 * dziedziczenia (can_read, reason), ktorych ta funkcja i tak nie czyta.
 */
export interface GroupInheritanceFields {
  visibility: string | null;
  visibility_inherited: boolean;
  who_can_post: string | null;
  who_can_post_inherited: boolean;
  moderation_mode: string | null;
  moderation_mode_inherited: boolean;
  min_tier_rank: number | null;
  min_tier_rank_inherited: boolean;
  attribution_mode: string | null;
  attribution_mode_inherited: boolean;
}

/** Wyciaga z wiersza grupy pieciopolowy zestaw ustawien z flaga dziedziczenia. */
export function toGroupSettings(row: GroupInheritanceFields): ClubGroupSettings {
  return {
    visibility: {
      value: narrow(row.visibility, CLUB_VISIBILITIES, "members"),
      inherited: row.visibility_inherited === true,
    },
    whoCanPost: {
      value: narrow(row.who_can_post, CLUB_POST_POLICIES, "moderators"),
      inherited: row.who_can_post_inherited === true,
    },
    moderationMode: {
      value: narrow(row.moderation_mode, CLUB_MODERATION_MODES, "trusted"),
      inherited: row.moderation_mode_inherited === true,
    },
    minTierRank: {
      value: typeof row.min_tier_rank === "number" ? row.min_tier_rank : 0,
      inherited: row.min_tier_rank_inherited === true,
    },
    attributionMode: {
      value: narrow(row.attribution_mode, CLUB_ATTRIBUTION_MODES, "attributed"),
      inherited: row.attribution_mode_inherited === true,
    },
  };
}

// ---------------------------------------------------------------------------
// Wejscia mutacji
// ---------------------------------------------------------------------------

/**
 * Patch klubu. Pole nieobecne = "nie ruszaj" (RPC czyta obecnosc klucza
 * operatorem ?), pole ustawione na null = "wyczysc". Dlatego typy opcjonalnych
 * tekstow to `string | null`, a nie `string | undefined`.
 */
export interface ClubUpsertInput {
  id?: string;
  slug?: string;
  name_pl?: string;
  name_en?: string;
  tagline_pl?: string | null;
  tagline_en?: string | null;
  description_pl?: string | null;
  description_en?: string | null;
  icon?: string;
  accent_color?: string | null;
  cover_image_url?: string | null;
  visibility?: ClubVisibility;
  join_policy?: ClubJoinPolicy;
  min_tier_rank?: number;
  attribution_mode?: ClubAttributionMode;
  who_can_post?: ClubPostPolicy;
  moderation_mode?: ClubModerationMode;
  policy_area?: string | null;
  rules_pl?: string | null;
  rules_en?: string | null;
  status?: ClubStatus;
}

/**
 * Patch grupy. Pusty string w polu ustawienia oznacza "dziedzicz z klubu" -
 * tak samo jak NULL. Droplista dziedziczenia wysyla wlasnie pusty string,
 * bo Radix Select nie potrafi przechowac wartosci null.
 */
export interface ClubGroupUpsertInput {
  id?: string;
  club_id?: string;
  slug?: string;
  name_pl?: string;
  name_en?: string;
  description_pl?: string | null;
  description_en?: string | null;
  icon?: string | null;
  accent_color?: string | null;
  sort_order?: number;
  visibility?: ClubVisibility | "";
  who_can_post?: ClubPostPolicy | "";
  moderation_mode?: ClubModerationMode | "";
  min_tier_rank?: number | null;
  attribution_mode?: ClubAttributionMode | "";
  opens_at?: string | null;
  closes_at?: string | null;
  status?: ClubGroupStatus;
  anchor_type?: string | null;
  anchor_id?: string | null;
}

export interface ClubMemberUpsertInput {
  clubId: string;
  userId: string;
  role?: ClubMemberRole;
  status?: ClubMemberStatus;
  roleExpiresAt?: string | null;
}

export interface AdminClubListFilters {
  search?: string;
  status?: ClubStatus | null;
  visibility?: ClubVisibility | null;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Etap A2: zaproszenia
// ---------------------------------------------------------------------------

/** Cztery sciezki wejscia do klubu (V2 §3.1). */
export const CLUB_INVITE_CHANNELS = ["direct", "email", "link", "segment"] as const;
export type ClubInviteChannel = (typeof CLUB_INVITE_CHANNELS)[number];

export const CLUB_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "expired",
  "revoked",
] as const;
export type ClubInvitationStatus = (typeof CLUB_INVITATION_STATUSES)[number];

export type ClubMyInvitationRow = RowOf<Fn["club_my_invitations"]["Returns"]>;
export type AdminClubInvitationRow = RowOf<Fn["admin_club_invitations"]["Returns"]>;
export type AdminClubInviteLinkRow = RowOf<Fn["admin_club_invite_links"]["Returns"]>;

export interface ClubInviteLinkInput {
  clubId: string;
  label?: string | null;
  /** Rola `lead` jest tu celowo NIEDOSTEPNA - prowadzacego nadaje sie
   *  imiennie, nie masowo linkiem z newslettera. */
  role?: Exclude<ClubMemberRole, "lead">;
  maxUses?: number | null;
  expiresAt?: string | null;
  requiresApproval?: boolean;
  groupId?: string | null;
}

/**
 * Kody bledow rzucanych przez RPC zaproszen. Mapowane na komunikat, ktory mowi
 * uzytkownikowi, CO ZROBIC - a nie powtarza tresci wyjatku z bazy.
 */
export const CLUB_INVITE_ERRORS = [
  "quota_exceeded",
  "already_member",
  "recently_declined",
  "user_unavailable",
  "elevated_role",
  "link_expired",
  "link_revoked",
  "link_exhausted",
  "invitation_required",
  "tier_too_low",
  "banned",
] as const;
export type ClubInviteError = (typeof CLUB_INVITE_ERRORS)[number];

/**
 * Tlumaczy komunikat wyjatku z Postgresa na kod slownikowy. Baza rzuca teksty
 * po angielsku ("clubs: invite quota exceeded"), a interfejs potrzebuje kodu,
 * z ktorego zlozy zdanie w jezyku uzytkownika. Zero regexpow po polskiej
 * stronie - dopasowanie idzie po stalym fragmencie komunikatu z migracji.
 */
export function toClubInviteError(error: unknown): ClubInviteError | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("invite quota exceeded")) return "quota_exceeded";
  if (message.includes("already a member")) return "already_member";
  if (message.includes("recently declined")) return "recently_declined";
  if (message.includes("user not available")) return "user_unavailable";
  if (message.includes("elevated role requires admin")) return "elevated_role";
  if (message.includes("link expired")) return "link_expired";
  if (message.includes("link revoked")) return "link_revoked";
  if (message.includes("link exhausted")) return "link_exhausted";
  if (message.includes("invitation required")) return "invitation_required";
  if (message.includes("tier too low")) return "tier_too_low";
  if (message.includes("banned")) return "banned";
  return null;
}
