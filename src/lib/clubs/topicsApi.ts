// Dostęp do katalogu obszarów tematycznych klubów (RPC).
//
// Odczyt publiczny idzie przez `club_topics_active` - anon też go widzi, bo
// etykiety obszarów są treścią huba. Zapis wyłącznie przez RPC z bramką
// `assert_admin_tenant()`, żeby panel nie polegał na samym RLS.
import { supabase } from "@/integrations/supabase/client";
import type { ClubTopicAdminRow, ClubTopicOption } from "@/lib/clubs/topicCatalog";
import { sortTopics } from "@/lib/clubs/topicCatalog";

export async function fetchActiveClubTopics(): Promise<ClubTopicOption[]> {
  const { data, error } = await supabase.rpc("club_topics_active");
  if (error) throw error;
  return sortTopics(
    (data ?? []).map((row) => ({
      key: row.key,
      label_pl: row.label_pl,
      label_en: row.label_en,
      sort_order: Number(row.sort_order),
    })),
  );
}

export async function fetchAdminClubTopics(): Promise<ClubTopicAdminRow[]> {
  const { data, error } = await supabase.rpc("admin_club_topics_list");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    key: row.key,
    label_pl: row.label_pl,
    label_en: row.label_en,
    sort_order: Number(row.sort_order),
    is_active: row.is_active,
    is_system: row.is_system,
    clubs_count: Number(row.clubs_count),
    threads_count: Number(row.threads_count),
  }));
}

export interface ClubTopicUpsertInput {
  id?: string | null;
  key: string;
  labelPl: string;
  labelEn: string;
  sortOrder: number;
  isActive: boolean;
}

export async function upsertClubTopic(input: ClubTopicUpsertInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_club_topic_upsert", {
    _id: input.id ?? undefined,
    _key: input.key,
    _label_pl: input.labelPl,
    _label_en: input.labelEn,
    _sort_order: input.sortOrder,
    _is_active: input.isActive,
  });
  if (error) throw error;
  return String(data);
}

export async function setClubTopicActive(id: string, isActive: boolean): Promise<boolean> {
  const { error } = await supabase.rpc("admin_club_topic_set_active", {
    _id: id,
    _is_active: isActive,
  });
  if (error) throw error;
  return true;
}

export async function deleteClubTopic(id: string): Promise<boolean> {
  const { error } = await supabase.rpc("admin_club_topic_delete", { _id: id });
  if (error) throw error;
  return true;
}
