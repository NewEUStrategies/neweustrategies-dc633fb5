// Discussion Club - warstwa dostepu do danych.
//
// Kazda funkcja to jedno wywolanie RPC. Zero zapytan tabelarycznych: tabele
// modulu nie maja grantow dla klienta, wiec `supabase.from("clubs")` zwrocilby
// pusty zbior nawet dla admina. To jest celowe - cala autoryzacja zyje w
// SECURITY DEFINER, a nie w tym pliku.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  groupReactions,
  toClubCapabilities,
  type AdminClubListFilters,
  type AdminClubDetailRow,
  type AdminClubGroupRow,
  type AdminClubInvitationRow,
  type AdminClubInviteLinkRow,
  type AdminClubRow,
  type AdminClubStatsRow,
  type ClubCapabilities,
  type ClubGroupRow,
  type ClubGroupUpsertInput,
  type ClubListRow,
  type ClubMemberRow,
  type ClubInviteLinkInput,
  type ClubMemberRole,
  type ClubMemberStatus,
  type ClubMemberUpsertInput,
  type ClubMembershipRow,
  type ClubMyInvitationRow,
  type ClubReactionKind,
  type ClubReactionTally,
  type ClubReactionTarget,
  type ClubReplyRow,
  type ClubReplySort,
  type ClubStance,
  type ClubStanceSummaryRow,
  type ClubSubscriptionState,
  type ClubThreadKind,
  type ClubThreadListRow,
  type ClubThreadSort,
  type ClubThreadViewRow,
  type ClubNotifyLevel,
  type ClubUpsertInput,
  type ClubViewRow,
} from "./types";

/**
 * Wejscia mutacji ida do RPC jako jsonb. Konwersja przez ten helper zamiast
 * przez `as unknown as Json`: obiekt patcha ma wylacznie pola serializowalne,
 * wiec przejscie przez JSON.parse(JSON.stringify(...)) jest zarowno poprawne
 * typowo, jak i odsiewa `undefined` - a wlasnie brak klucza znaczy w tym
 * kontrakcie "nie ruszaj pola".
 */
function toJsonPayload(input: Record<string, unknown>): Json {
  const parsed: unknown = JSON.parse(JSON.stringify(input));
  return parsed as Json;
}

// ---------------------------------------------------------------------------
// Odczyt produktowy
// ---------------------------------------------------------------------------

export async function fetchClubList(): Promise<ClubListRow[]> {
  const { data, error } = await supabase.rpc("club_list");
  if (error) throw error;
  return data ?? [];
}

/** Karta klubu po slugu. `null` = klub nie istnieje albo jest niewidoczny
 *  (secret bez dostepu) - interfejs pokazuje 404, nie 403. */
export async function fetchClubBySlug(slug: string): Promise<ClubViewRow | null> {
  const { data, error } = await supabase.rpc("club_view", { p_slug: slug });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function fetchClubGroups(clubId: string): Promise<ClubGroupRow[]> {
  const { data, error } = await supabase.rpc("club_groups_list", { p_club_id: clubId });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMyClubMemberships(): Promise<ClubMembershipRow[]> {
  const { data, error } = await supabase.rpc("club_my_memberships");
  if (error) throw error;
  return data ?? [];
}

export interface ClubMembersPage {
  rows: ClubMemberRow[];
  total: number;
}

export async function fetchClubMembers(params: {
  clubId: string;
  status?: ClubMemberStatus | null;
  limit?: number;
  offset?: number;
}): Promise<ClubMembersPage> {
  const { data, error } = await supabase.rpc("club_members_list", {
    p_club_id: params.clubId,
    p_status: params.status ?? "active",
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;
  const rows = data ?? [];
  // total_count jedzie w kazdym wierszu (window function), wiec paginacja nie
  // wymaga drugiego zapytania. Pusta strona = zero wynikow.
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

/** Zdolnosci wolajacego wobec klubu (opcjonalnie w kontekscie grupy). */
export async function fetchClubCapabilities(
  clubId: string,
  groupId?: string | null,
): Promise<ClubCapabilities> {
  const { data, error } = await supabase.rpc("club_capabilities", {
    _club_id: clubId,
    _group_id: groupId ?? undefined,
  });
  if (error) throw error;
  return toClubCapabilities(data?.[0]);
}

// ---------------------------------------------------------------------------
// Panel administracyjny
// ---------------------------------------------------------------------------

export interface AdminClubsPage {
  rows: AdminClubRow[];
  total: number;
}

export async function fetchAdminClubs(filters: AdminClubListFilters): Promise<AdminClubsPage> {
  const search = filters.search?.trim();
  const { data, error } = await supabase.rpc("admin_club_list", {
    p_search: search && search.length > 0 ? search : undefined,
    p_status: filters.status ?? undefined,
    p_visibility: filters.visibility ?? undefined,
    p_limit: filters.limit ?? 50,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw error;
  const rows = data ?? [];
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

/** Zwraca id klubu (nowego albo zaktualizowanego). */
export async function upsertClub(input: ClubUpsertInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_club_upsert", {
    p_payload: toJsonPayload(input),
  });
  if (error) throw error;
  return data;
}

export async function upsertClubGroup(input: ClubGroupUpsertInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_club_group_upsert", {
    p_payload: toJsonPayload(input),
  });
  if (error) throw error;
  return data;
}

/** Kolejnosc grup jednym wywolaniem - nie N zapytan po jednym wierszu. */
export async function reorderClubGroups(clubId: string, groupIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc("admin_club_group_reorder", {
    p_club_id: clubId,
    p_group_ids: groupIds,
  });
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

export async function upsertClubMember(input: ClubMemberUpsertInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_club_member_upsert", {
    p_club_id: input.clubId,
    p_user_id: input.userId,
    p_role: input.role ?? "member",
    p_status: input.status ?? "active",
    p_role_expires_at: input.roleExpiresAt ?? undefined,
  });
  if (error) throw error;
  return data;
}

export async function removeClubMember(clubId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_club_member_remove", {
    p_club_id: clubId,
    p_user_id: userId,
  });
  if (error) throw error;
  return data === true;
}

/** Pelny klub po id - edytor pracuje na id, bo slug moze sie w nim zmieniac. */
export async function fetchAdminClub(clubId: string): Promise<AdminClubDetailRow | null> {
  const { data, error } = await supabase.rpc("admin_club_get", { p_club_id: clubId });
  if (error) throw error;
  return data?.[0] ?? null;
}

/** Wszystkie grupy klubu (takze draft i archived) z rozwiazanym dziedziczeniem. */
export async function fetchAdminClubGroups(clubId: string): Promise<AdminClubGroupRow[]> {
  const { data, error } = await supabase.rpc("admin_club_groups", { p_club_id: clubId });
  if (error) throw error;
  return data ?? [];
}

export async function fetchAdminClubStats(clubId: string): Promise<AdminClubStatsRow | null> {
  const { data, error } = await supabase.rpc("admin_club_stats", { p_club_id: clubId });
  if (error) throw error;
  return data?.[0] ?? null;
}

/** "Podglad jako..." - zdolnosci wskazanej osoby (zakladka Uprawnienia). */
export async function previewClubCapabilities(params: {
  clubId: string;
  groupId?: string | null;
  userId: string;
}): Promise<ClubCapabilities> {
  const { data, error } = await supabase.rpc("admin_club_capabilities_preview", {
    _club_id: params.clubId,
    _user_id: params.userId,
    _group_id: params.groupId ?? undefined,
  });
  if (error) throw error;
  return toClubCapabilities(data?.[0]);
}

// ---------------------------------------------------------------------------
// Etap A2: zaproszenia i samoobsluga czlonkostwa
// ---------------------------------------------------------------------------

/** Sciezka A: zaproszenie osoby, ktora jest juz na platformie. */
export async function inviteClubMember(params: {
  clubId: string;
  userId: string;
  role?: ClubMemberRole;
  message?: string | null;
  groupId?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("club_invite", {
    p_club_id: params.clubId,
    p_user_id: params.userId,
    p_role: params.role ?? "member",
    p_message: params.message ?? undefined,
    p_group_id: params.groupId ?? undefined,
  });
  if (error) throw error;
  return data;
}

/** Sciezka B: zaproszenie e-mailowe przez user_invitations. */
export async function inviteClubMemberByEmail(params: {
  clubId: string;
  email: string;
  role?: Exclude<ClubMemberRole, "lead">;
  groupId?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("club_invite_by_email", {
    p_club_id: params.clubId,
    p_email: params.email,
    p_role: params.role ?? "member",
    p_group_id: params.groupId ?? undefined,
  });
  if (error) throw error;
  return data;
}

/** Sciezka C: token linku jest zwracany RAZ, przy tworzeniu. */
export async function createClubInviteLink(
  input: ClubInviteLinkInput,
): Promise<{ id: string; token: string }> {
  const { data, error } = await supabase.rpc("admin_club_invite_link_create", {
    p_club_id: input.clubId,
    p_label: input.label ?? undefined,
    p_role: input.role ?? "member",
    p_max_uses: input.maxUses ?? undefined,
    p_expires_at: input.expiresAt ?? undefined,
    p_requires_approval: input.requiresApproval ?? false,
    p_group_id: input.groupId ?? undefined,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("clubs: link not created");
  return { id: row.id, token: row.token };
}

export async function revokeClubInviteLink(linkId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_club_invite_link_revoke", {
    p_link_id: linkId,
  });
  if (error) throw error;
  return data === true;
}

export async function fetchClubInviteLinks(clubId: string): Promise<AdminClubInviteLinkRow[]> {
  const { data, error } = await supabase.rpc("admin_club_invite_links", { p_club_id: clubId });
  if (error) throw error;
  return data ?? [];
}

export async function fetchClubInvitations(clubId: string): Promise<AdminClubInvitationRow[]> {
  const { data, error } = await supabase.rpc("admin_club_invitations", { p_club_id: clubId });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMyClubInvitations(): Promise<ClubMyInvitationRow[]> {
  const { data, error } = await supabase.rpc("club_my_invitations");
  if (error) throw error;
  return data ?? [];
}

/** Zwraca status wynikowy: 'active' (klub otwarty) albo 'pending' (na prosbe). */
export async function joinClub(clubId: string): Promise<string> {
  const { data, error } = await supabase.rpc("club_join", { p_club_id: clubId });
  if (error) throw error;
  return typeof data === "string" ? data : "pending";
}

export async function leaveClub(clubId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_leave", { p_club_id: clubId });
  if (error) throw error;
  return data === true;
}

export async function respondClubInvitation(params: {
  invitationId: string;
  accept: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc("club_respond_invitation", {
    p_invitation_id: params.invitationId,
    p_accept: params.accept,
  });
  if (error) throw error;
  return typeof data === "string" ? data : "declined";
}

export async function redeemClubInviteLink(
  token: string,
): Promise<{ clubSlug: string; status: string }> {
  const { data, error } = await supabase.rpc("club_redeem_invite_link", { p_token: token });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("clubs: invalid link");
  return { clubSlug: row.club_slug, status: row.status };
}

export async function setClubNotifyLevel(params: {
  clubId: string;
  level: ClubNotifyLevel;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_set_notify_level", {
    p_club_id: params.clubId,
    p_level: params.level,
  });
  if (error) throw error;
  return data === true;
}

export async function acceptClubRules(clubId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_accept_rules", { p_club_id: clubId });
  if (error) throw error;
  return data === true;
}

// ---------------------------------------------------------------------------
// Etap A3: tematy i odpowiedzi
// ---------------------------------------------------------------------------

export interface ClubThreadsPage {
  rows: ClubThreadListRow[];
  /** Kursor nastepnej strony albo null, gdy to juz koniec. */
  nextCursor: string | null;
}

export async function fetchClubThreads(params: {
  clubId: string;
  groupId?: string | null;
  sort?: ClubThreadSort;
  kind?: ClubThreadKind | null;
  cursor?: string | null;
  limit?: number;
}): Promise<ClubThreadsPage> {
  const limit = params.limit ?? 20;
  const { data, error } = await supabase.rpc("club_threads_list", {
    p_club_id: params.clubId,
    p_group_id: params.groupId ?? undefined,
    // RPC zna dwa porzadki (hot / new); pozostale sorty sa filtrami po
    // stronie klienta nad tym samym zbiorem, wiec nie mnozymy galezi w SQL.
    p_sort: params.sort === "new" ? "new" : "hot",
    p_kind: params.kind ?? undefined,
    p_cursor: params.cursor ?? undefined,
    p_limit: limit,
  });
  if (error) throw error;
  const rows = data ?? [];
  // Krotsza strona niz limit znaczy koniec zbioru - bez dodatkowego zapytania.
  const nextCursor = rows.length === limit ? (rows[rows.length - 1].cursor_value ?? null) : null;
  return { rows, nextCursor };
}

export async function fetchClubThread(params: {
  clubId: string;
  slug: string;
}): Promise<ClubThreadViewRow | null> {
  const { data, error } = await supabase.rpc("club_thread_view", {
    p_club_id: params.clubId,
    p_slug: params.slug,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function fetchClubReplies(params: {
  threadId: string;
  sort?: ClubReplySort;
}): Promise<ClubReplyRow[]> {
  const { data, error } = await supabase.rpc("club_replies_list", {
    p_thread_id: params.threadId,
    p_sort: params.sort ?? "chronological",
  });
  if (error) throw error;
  return data ?? [];
}

export interface CreateThreadResult {
  id: string;
  slug: string;
  /** 'pending' oznacza kolejke premoderacji - UI musi to powiedzieć wprost. */
  status: string;
}

export async function createClubThread(params: {
  groupId: string;
  title: string;
  body: string;
  kind?: ClubThreadKind;
  anonymous?: boolean;
  anchorType?: string | null;
  anchorId?: string | null;
}): Promise<CreateThreadResult> {
  const { data, error } = await supabase.rpc("club_create_thread", {
    p_group_id: params.groupId,
    p_title: params.title,
    p_body: params.body,
    p_kind: params.kind ?? "discussion",
    p_anonymous: params.anonymous ?? false,
    p_anchor_type: params.anchorType ?? undefined,
    p_anchor_id: params.anchorId ?? undefined,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("clubs: thread not created");
  return { id: row.id, slug: row.slug, status: row.status };
}

export async function replyToClubThread(params: {
  threadId: string;
  body: string;
  parentId?: string | null;
  anonymous?: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc("club_reply", {
    p_thread_id: params.threadId,
    p_body: params.body,
    p_parent_id: params.parentId ?? undefined,
    p_anonymous: params.anonymous ?? false,
  });
  if (error) throw error;
  return data;
}

export async function editClubThread(params: {
  threadId: string;
  title: string;
  body: string;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_edit_thread", {
    p_thread_id: params.threadId,
    p_title: params.title,
    p_body: params.body,
  });
  if (error) throw error;
  return data === true;
}

export async function editClubReply(params: {
  replyId: string;
  body: string;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_edit_reply", {
    p_reply_id: params.replyId,
    p_body: params.body,
  });
  if (error) throw error;
  return data === true;
}

/** `replyId: null` cofa oznaczenie i wraca do statusu open. */
export async function resolveClubThread(params: {
  threadId: string;
  replyId: string | null;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_resolve_thread", {
    p_thread_id: params.threadId,
    p_reply_id: params.replyId as string,
  });
  if (error) throw error;
  return data === true;
}

// ---------------------------------------------------------------------------
// Etap A4: reakcje, stanowiska, subskrypcje
// ---------------------------------------------------------------------------

/** Odczyt WSADOWY dla całej widocznej partii - nigdy N+1. */
export async function fetchClubReactions(params: {
  targetType: ClubReactionTarget;
  targetIds: string[];
}): Promise<Map<string, ClubReactionTally[]>> {
  if (params.targetIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc("club_reactions_for", {
    p_target_type: params.targetType,
    p_target_ids: params.targetIds,
  });
  if (error) throw error;
  return groupReactions(data ?? []);
}

export async function reactToClubTarget(params: {
  targetType: ClubReactionTarget;
  targetId: string;
  kind: ClubReactionKind;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_react", {
    p_target_type: params.targetType,
    p_target_id: params.targetId,
    p_kind: params.kind,
  });
  if (error) throw error;
  return data === true;
}

export async function unreactFromClubTarget(params: {
  targetType: ClubReactionTarget;
  targetId: string;
  kind: ClubReactionKind;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_unreact", {
    p_target_type: params.targetType,
    p_target_id: params.targetId,
    p_kind: params.kind,
  });
  if (error) throw error;
  return data === true;
}

export async function fetchClubStanceSummary(
  threadId: string,
): Promise<ClubStanceSummaryRow[]> {
  const { data, error } = await supabase.rpc("club_stance_summary", {
    p_thread_id: threadId,
  });
  if (error) throw error;
  return data ?? [];
}

export async function setClubStance(params: {
  threadId: string;
  stance: ClubStance;
  rationale?: string | null;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_set_stance", {
    p_thread_id: params.threadId,
    p_stance: params.stance,
    p_rationale: params.rationale ?? undefined,
  });
  if (error) throw error;
  return data === true;
}

export async function setClubThreadSubscription(params: {
  threadId: string;
  state: ClubSubscriptionState;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_subscribe_thread", {
    p_thread_id: params.threadId,
    p_state: params.state,
  });
  if (error) throw error;
  return data === true;
}

/** `null` = brak wpisu, czyli domyślny poziom powiadomień klubu. */
export async function fetchMyThreadSubscription(
  threadId: string,
): Promise<ClubSubscriptionState | null> {
  const { data, error } = await supabase.rpc("club_my_subscription", {
    p_thread_id: threadId,
  });
  if (error) throw error;
  return data === "subscribed" || data === "muted" ? data : null;
}
