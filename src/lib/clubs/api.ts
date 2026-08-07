// Discussion Club - warstwa dostepu do danych.
//
// Kazda funkcja to jedno wywolanie RPC. Zero zapytan tabelarycznych: tabele
// modulu nie maja grantow dla klienta, wiec `supabase.from("clubs")` zwrocilby
// pusty zbior nawet dla admina. To jest celowe - cala autoryzacja zyje w
// SECURITY DEFINER, a nie w tym pliku.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  toClubCapabilities,
  type AdminClubListFilters,
  type AdminClubDetailRow,
  type AdminClubGroupRow,
  type AdminClubRow,
  type AdminClubStatsRow,
  type ClubCapabilities,
  type ClubGroupRow,
  type ClubGroupUpsertInput,
  type ClubListRow,
  type ClubMemberRow,
  type ClubMemberStatus,
  type ClubMemberUpsertInput,
  type ClubMembershipRow,
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
