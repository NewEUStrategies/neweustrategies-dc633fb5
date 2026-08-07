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
  type AdminClubModerationItem,
  type AdminClubModerationLogRow,
  type ClubAnchorHit,
  type ClubSearchHit,
  type AdminClubReplyRow,
  type AdminClubThreadRow,
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
  type ClubModerationAction,
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
// Parametr `object`, nie `Record<string, unknown>`: interfejs bez sygnatury
// indeksowej nie jest przypisywalny do Record, a ta funkcja i tak niczego nie
// indeksuje - przepuszcza wejscie przez JSON.
function toJsonPayload(input: object): Json {
  const parsed: unknown = JSON.parse(JSON.stringify(input));
  return parsed as Json;
}

// ---------------------------------------------------------------------------
// Odczyt produktowy
// ---------------------------------------------------------------------------

export interface ClubListPage {
  rows: ClubListRow[];
  total: number;
}

/**
 * Lista klubow. RPC ma teraz limit i offset, bo bez nich liczylo zdolnosci
 * dla KAZDEGO klubu tenantu - klucz lateralny rowny id klubu jest unikatowy,
 * wiec Memoize nie mial czego zapamietac.
 */
export async function fetchClubList(
  params: { limit?: number; offset?: number } = {},
): Promise<ClubListPage> {
  const { data, error } = await supabase.rpc("club_list", {
    p_limit: params.limit ?? 100,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;
  const rows = data ?? [];
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
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
    p_clear_role_expiry: input.clearRoleExpiry ?? false,
  });
  if (error) throw error;
  return data;
}

/**
 * Kasuje grupe. Zwraca liczbe PRZENIESIONYCH watkow, zeby UI mogl powiedziec
 * "grupa usunieta, 12 tematow przeniesiono", a nie samo "gotowe".
 */
export async function deleteClubGroup(params: {
  groupId: string;
  moveToGroupId?: string | null;
}): Promise<number> {
  const { data, error } = await supabase.rpc("admin_club_group_delete", {
    p_group_id: params.groupId,
    p_move_to_group_id: params.moveToGroupId ?? undefined,
  });
  if (error) throw error;
  return typeof data === "number" ? data : 0;
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
    p_title: params.title ?? undefined,
    p_body: params.body ?? undefined,
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

/**
 * `reason` dotyczy WYLACZNIE redakcji cudzego wpisu: RPC zapisuje go wtedy
 * w dzienniku moderacji. Przy wlasnej poprawce parametr jest ignorowany, wiec
 * komponent produktowy moze go po prostu nie podawac.
 */
export async function editClubThread(params: {
  threadId: string;
  // Redakcja moderatorska bywa czesciowa (sam tytul albo samo cialo), wiec
  // oba pola sa opcjonalne - RPC zostawia nietkniete to, czego nie przyslano.
  title?: string;
  body?: string;
  reason?: string | null;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_edit_thread", {
    p_thread_id: params.threadId,
    p_title: params.title ?? "",
    p_body: params.body ?? "",
    p_reason: params.reason ?? undefined,
  });
  if (error) throw error;
  return data === true;
}

export async function editClubReply(params: {
  replyId: string;
  body: string;
  reason?: string | null;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_edit_reply", {
    p_reply_id: params.replyId,
    p_body: params.body,
    p_reason: params.reason ?? undefined,
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

export async function fetchClubStanceSummary(threadId: string): Promise<ClubStanceSummaryRow[]> {
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

// ---------------------------------------------------------------------------
// Etap A7: koordynacja w panelu
// ---------------------------------------------------------------------------

export interface AdminThreadsPage {
  rows: AdminClubThreadRow[];
  total: number;
}

export async function fetchAdminClubThreads(params: {
  clubId: string;
  groupId?: string | null;
  status?: string | null;
  kind?: string | null;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminThreadsPage> {
  const search = params.search?.trim();
  const { data, error } = await supabase.rpc("admin_club_threads", {
    p_club_id: params.clubId,
    p_group_id: params.groupId ?? undefined,
    p_status: params.status ?? undefined,
    p_kind: params.kind ?? undefined,
    p_search: search && search.length > 0 ? search : undefined,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;
  const rows = data ?? [];
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

export async function fetchAdminClubReplies(params: {
  threadId: string;
  limit?: number;
  offset?: number;
}): Promise<AdminClubReplyRow[]> {
  const { data, error } = await supabase.rpc("admin_club_replies", {
    p_thread_id: params.threadId,
    p_limit: params.limit ?? 100,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;
  return data ?? [];
}

/** `authorId: null` = publikacja pod wlasnym nazwiskiem admina. */
export async function adminCreateClubThread(params: {
  groupId: string;
  title: string;
  body: string;
  authorId?: string | null;
  kind?: ClubThreadKind;
  pinned?: boolean;
}): Promise<{ threadId: string; threadSlug: string }> {
  const { data, error } = await supabase.rpc("admin_club_thread_create", {
    p_group_id: params.groupId,
    p_title: params.title,
    p_body: params.body,
    p_author_id: params.authorId ?? undefined,
    p_kind: params.kind ?? "discussion",
    p_pinned: params.pinned ?? false,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("clubs: thread not created");
  return { threadId: row.thread_id, threadSlug: row.thread_slug };
}

export async function adminCreateClubReply(params: {
  threadId: string;
  body: string;
  authorId?: string | null;
  parentId?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("admin_club_reply_create", {
    p_thread_id: params.threadId,
    p_body: params.body,
    p_author_id: params.authorId ?? undefined,
    p_parent_id: params.parentId ?? undefined,
  });
  if (error) throw error;
  return data;
}

export async function moderateClubTarget(params: {
  targetType: "thread" | "reply";
  targetId: string;
  action: ClubModerationAction;
  reason?: string | null;
}): Promise<boolean> {
  // `restore` ma osobne RPC: musi wiedziec, do jakiego statusu wrocic.
  if (params.action === "restore") {
    const { data, error } = await supabase.rpc("admin_club_restore", {
      p_target_type: params.targetType,
      p_target_id: params.targetId,
      p_reason: params.reason ?? undefined,
    });
    if (error) throw error;
    return data === true;
  }
  const { data, error } = await supabase.rpc("club_moderate", {
    p_target_type: params.targetType,
    p_target_id: params.targetId,
    p_action: params.action,
    p_reason: params.reason ?? undefined,
  });
  if (error) throw error;
  return data === true;
}

/** Zwraca liczbe wpisow, ktore FAKTYCZNIE przeszly - UI mowi "zmieniono 47 z 50". */
export async function bulkModerateClubTargets(params: {
  targetType: "thread" | "reply";
  targetIds: string[];
  action: ClubModerationAction;
  reason?: string | null;
}): Promise<number> {
  const { data, error } = await supabase.rpc("admin_club_bulk_moderate", {
    p_target_type: params.targetType,
    p_target_ids: params.targetIds,
    p_action: params.action,
    p_reason: params.reason ?? undefined,
  });
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

export async function bulkSetClubMemberRole(params: {
  clubId: string;
  userIds: string[];
  role: ClubMemberRole;
}): Promise<number> {
  const { data, error } = await supabase.rpc("admin_club_bulk_member_role", {
    p_club_id: params.clubId,
    p_user_ids: params.userIds,
    p_role: params.role,
  });
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

export async function moveClubThread(params: {
  threadId: string;
  groupId: string;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_club_thread_move", {
    p_thread_id: params.threadId,
    p_group_id: params.groupId,
  });
  if (error) throw error;
  return data === true;
}

/**
 * Wyszukiwanie pelnotekstowe po watkach. Zwraca WYLACZNIE to, do czego wolajacy
 * ma dostep - filtr siedzi w RPC (club_capabilities per watek), wiec klient
 * nie musi (i nie moze) go powtarzac.
 */
export async function searchClubThreads(params: {
  query: string;
  clubId?: string | null;
  limit?: number;
}): Promise<ClubSearchHit[]> {
  const query = params.query.trim();
  if (query.length < 2) return [];
  const { data, error } = await supabase.rpc("club_search", {
    p_query: query,
    p_club_id: params.clubId ?? undefined,
    p_limit: params.limit ?? 20,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Watki powiazane z kotwica (akt prawny, wydarzenie, wpis). To jest szew
 * miedzymodulowy: strona aktu pyta klub o dyskusje na swoj temat, nie znajac
 * modelu klubu.
 */
export async function fetchClubThreadsForAnchor(params: {
  anchorType: string;
  anchorId: string;
  limit?: number;
}): Promise<ClubAnchorHit[]> {
  const { data, error } = await supabase.rpc("club_threads_for_anchor", {
    p_anchor_type: params.anchorType,
    p_anchor_id: params.anchorId,
    p_limit: params.limit ?? 5,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Liczniki do plakietki przy zakladce "Kluby dyskusyjne". Jeden RPC zamiast
 * sumowania po liscie klubow: moderacja tresci i prosby o dostep to dwie
 * osobne kolejki, a plakietka ma pokazac, ze COS czeka, zanim ktokolwiek
 * wejdzie w liste.
 */
export async function fetchClubPendingCounts(): Promise<{
  moderationPending: number;
  joinRequests: number;
}> {
  const { data, error } = await supabase.rpc("admin_club_pending_counts");
  if (error) throw error;
  const row = data?.[0];
  return {
    moderationPending: row?.moderation_pending ?? 0,
    joinRequests: row?.join_requests ?? 0,
  };
}

export interface AdminClubModerationPage {
  rows: AdminClubModerationItem[];
  total: number;
}

/** Kolejka zwraca PODGLAD tresci (500 znakow) i jest stronicowana - pelna
 *  tresc czyta sie w podgladzie watku, nie z listy decyzyjnej. */
export async function fetchClubModerationQueue(params: {
  clubId: string;
  limit?: number;
  offset?: number;
}): Promise<AdminClubModerationPage> {
  const { data, error } = await supabase.rpc("admin_club_moderation_queue", {
    p_club_id: params.clubId,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;
  const rows = data ?? [];
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

export async function fetchClubModerationLog(params: {
  clubId: string;
  limit?: number;
}): Promise<AdminClubModerationLogRow[]> {
  const { data, error } = await supabase.rpc("admin_club_moderation_log", {
    p_club_id: params.clubId,
    p_limit: params.limit ?? 100,
  });
  if (error) throw error;
  return data ?? [];
}

export async function banClubMember(params: {
  clubId: string;
  userId: string;
  banned: boolean;
  reason?: string | null;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_ban_member", {
    p_club_id: params.clubId,
    p_user_id: params.userId,
    p_banned: params.banned,
    p_reason: params.reason ?? undefined,
  });
  if (error) throw error;
  return data === true;
}

/** Ujawnienie autora anonimowej wypowiedzi. Powod jest OBOWIAZKOWY. */
export async function revealClubAuthor(params: {
  targetType: "thread" | "reply";
  targetId: string;
  reason: string;
}): Promise<{ authorId: string; displayName: string; profileSlug: string | null } | null> {
  const { data, error } = await supabase.rpc("club_moderator_reveal_author", {
    p_target_type: params.targetType,
    p_target_id: params.targetId,
    p_reason: params.reason,
  });
  if (error) throw error;
  const row = data?.[0];
  return row
    ? { authorId: row.author_id, displayName: row.display_name, profileSlug: row.profile_slug }
    : null;
}
