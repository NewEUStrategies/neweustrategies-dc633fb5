// Dostęp do katalogu specjalizacji klubów dyskusyjnych (RPC).
//
// Odczyt publiczny idzie przez `club_specializations_public` - anon też go
// widzi, bo siatka specjalizacji jest wizytówką modułu i musi się indeksować.
// Zapis wyłącznie przez RPC z bramką `assert_admin_tenant()`, żeby panel nie
// polegał na samym RLS. Kluby w specjalizacji zwraca osobne RPC, które
// zachowuje dotychczasowe zasady widoczności (anonim - tylko `public`).
import { supabase } from "@/integrations/supabase/client";
import type { ClubListRow } from "@/lib/clubs/types";

export interface ClubSpecializationRow {
  slug: string;
  key: string;
  label_pl: string;
  label_en: string;
  lead_pl: string | null;
  lead_en: string | null;
  desc_pl: string | null;
  desc_en: string | null;
  icon: string;
  sort_order: number;
  club_count: number;
}

export interface ClubSpecializationAdminRow extends Omit<ClubSpecializationRow, "club_count"> {
  id: string;
  is_active: boolean;
  is_system: boolean;
  clubs_count: number;
}

export async function fetchPublicClubSpecializations(): Promise<ClubSpecializationRow[]> {
  const { data, error } = await supabase.rpc("club_specializations_public");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    slug: row.slug,
    key: row.key,
    label_pl: row.label_pl,
    label_en: row.label_en,
    lead_pl: row.lead_pl,
    lead_en: row.lead_en,
    desc_pl: row.desc_pl,
    desc_en: row.desc_en,
    icon: row.icon,
    sort_order: Number(row.sort_order),
    club_count: Number(row.club_count),
  }));
}

export interface ClubSpecializationClubsPage {
  rows: ClubListRow[];
  total: number;
}

export async function fetchClubsBySpecialization(
  slug: string,
  params: { limit?: number; offset?: number } = {},
): Promise<ClubSpecializationClubsPage> {
  const { data, error } = await supabase.rpc("club_list_by_specialization", {
    p_slug: slug,
    p_limit: params.limit ?? 60,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;
  const rows = data ?? [];
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

export async function fetchAdminClubSpecializations(): Promise<ClubSpecializationAdminRow[]> {
  const { data, error } = await supabase.rpc("admin_club_specializations_list");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    key: row.key,
    label_pl: row.label_pl,
    label_en: row.label_en,
    lead_pl: row.lead_pl,
    lead_en: row.lead_en,
    desc_pl: row.desc_pl,
    desc_en: row.desc_en,
    icon: row.icon,
    sort_order: Number(row.sort_order),
    is_active: row.is_active,
    is_system: row.is_system,
    clubs_count: Number(row.clubs_count),
  }));
}

export interface ClubSpecializationUpsertInput {
  id?: string | null;
  slug: string;
  key?: string;
  labelPl: string;
  labelEn: string;
  leadPl?: string;
  leadEn?: string;
  descPl?: string;
  descEn?: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
}

export async function upsertClubSpecialization(
  input: ClubSpecializationUpsertInput,
): Promise<string> {
  const { data, error } = await supabase.rpc("admin_club_specialization_upsert", {
    p_payload: {
      id: input.id ?? null,
      slug: input.slug,
      key: input.key ?? input.slug,
      label_pl: input.labelPl,
      label_en: input.labelEn,
      lead_pl: input.leadPl ?? "",
      lead_en: input.leadEn ?? "",
      desc_pl: input.descPl ?? "",
      desc_en: input.descEn ?? "",
      icon: input.icon,
      sort_order: input.sortOrder,
      is_active: input.isActive,
    },
  });
  if (error) throw error;
  return String(data);
}

export async function setClubSpecializationActive(id: string, isActive: boolean): Promise<boolean> {
  const { error } = await supabase.rpc("admin_club_specialization_set_active", {
    _id: id,
    _is_active: isActive,
  });
  if (error) throw error;
  return true;
}

export async function deleteClubSpecialization(id: string): Promise<boolean> {
  const { error } = await supabase.rpc("admin_club_specialization_delete", { _id: id });
  if (error) throw error;
  return true;
}
