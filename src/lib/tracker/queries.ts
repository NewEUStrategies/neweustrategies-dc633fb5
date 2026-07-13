// Zapytania i hooki trackera legislacyjnego UE (react-query + supabase).
// Publiczne odczyty przechodzą przez RLS (tylko status = 'published'),
// obserwowanie jest owner-only - insert wymaga jawnego tenant_id dossier.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PolicyItem {
  id: string;
  tenant_id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  summary_pl: string | null;
  summary_en: string | null;
  policy_area: string;
  stage: string;
  importance: number;
  reference: string | null;
  source_url: string | null;
  rapporteur: string | null;
  committee: string | null;
  lead_dg: string | null;
  next_milestone_pl: string | null;
  next_milestone_en: string | null;
  next_milestone_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PolicyUpdate {
  id: string;
  item_id: string;
  note_pl: string;
  note_en: string;
  stage_from: string | null;
  stage_to: string | null;
  source_url: string | null;
  happened_on: string;
  created_at: string;
}

export interface PolicyItemFilters {
  area?: string;
  stage?: string;
}

/** Rozmiar okna listy; "pokaż więcej" rośnie o tę wartość (wzorzec bloga). */
export const TRACKER_PAGE_SIZE = 24;

const ITEM_FIELDS =
  "id,tenant_id,slug,title_pl,title_en,summary_pl,summary_en,policy_area,stage,importance," +
  "reference,source_url,rapporteur,committee,lead_dg," +
  "next_milestone_pl,next_milestone_en,next_milestone_at,status," +
  "created_at,updated_at";

const UPDATE_FIELDS =
  "id,item_id,note_pl,note_en,stage_from,stage_to,source_url,happened_on,created_at";

/** Opublikowane dossier: najważniejsze i ostatnio aktualizowane na górze. */
export async function fetchPublishedItems(
  filters: PolicyItemFilters = {},
  limit: number = TRACKER_PAGE_SIZE,
): Promise<PolicyItem[]> {
  let query = supabase
    .from("eu_policy_items")
    .select(ITEM_FIELDS)
    .eq("status", "published")
    .order("importance", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (filters.area) query = query.eq("policy_area", filters.area);
  if (filters.stage) query = query.eq("stage", filters.stage);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as PolicyItem[];
}

/** Pojedyncze opublikowane dossier po slugu (null gdy brak/nieopublikowane). */
export async function fetchItemBySlug(slug: string): Promise<PolicyItem | null> {
  const { data, error } = await supabase
    .from("eu_policy_items")
    .select(ITEM_FIELDS)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as PolicyItem | null;
}

/** Oś czasu dossier - najnowsze wydarzenia na górze. */
export async function fetchUpdates(itemId: string): Promise<PolicyUpdate[]> {
  const { data, error } = await supabase
    .from("eu_policy_updates")
    .select(UPDATE_FIELDS)
    .eq("item_id", itemId)
    .order("happened_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as PolicyUpdate[];
}

/** Publiczne liczniki obserwujących (RPC omija owner-only RLS follows). */
export async function fetchFollowerCounts(itemIds: string[]): Promise<Record<string, number>> {
  if (itemIds.length === 0) return {};
  const { data, error } = await supabase.rpc("get_policy_follower_counts", {
    p_item_ids: itemIds,
  });
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.item_id] = row.followers;
  return counts;
}

/** Identyfikatory dossier obserwowanych przez użytkownika. */
export async function fetchMyFollows(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("eu_policy_follows")
    .select("item_id")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => row.item_id);
}

/**
 * Rozpocznij obserwowanie dossier. RLS wymaga jawnego tenant_id równego
 * tenant_id dossier - przekazujemy go z wiersza itemu. Duplikat (równoległe
 * kliknięcia) jest ignorowany po kodzie 23505, nie po treści komunikatu.
 */
export async function followItem(input: {
  itemId: string;
  userId: string;
  tenantId: string;
}): Promise<void> {
  const { error } = await supabase.from("eu_policy_follows").insert({
    item_id: input.itemId,
    user_id: input.userId,
    tenant_id: input.tenantId,
  });
  if (error && error.code !== "23505") throw error;
}

/** Przestań obserwować dossier (delete owner-only pod RLS). */
export async function unfollowItem(input: { itemId: string; userId: string }): Promise<void> {
  const { error } = await supabase
    .from("eu_policy_follows")
    .delete()
    .eq("item_id", input.itemId)
    .eq("user_id", input.userId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Hooki react-query - wspólna przestrzeń kluczy ["tracker", ...]
// ---------------------------------------------------------------------------

export function usePublishedItems(
  filters: PolicyItemFilters = {},
  limit: number = TRACKER_PAGE_SIZE,
) {
  return useQuery({
    queryKey: ["tracker", "items", filters.area ?? "all", filters.stage ?? "all", limit] as const,
    queryFn: () => fetchPublishedItems(filters, limit),
    staleTime: 60_000,
    // Rosnące okno "pokaż więcej" nie może mrugać do spinnera - trzymaj
    // poprzednią stronę, aż dojedzie szersza.
    placeholderData: (previous: PolicyItem[] | undefined) => previous,
  });
}

/** Wspólne opcje zapytania o dossier - hook i loader SSR (head/JSON-LD)
 *  używają tego samego klucza, więc render nie robi drugiej podróży. */
export function itemBySlugQueryOptions(slug: string) {
  return {
    queryKey: ["tracker", "item", slug] as const,
    queryFn: () => fetchItemBySlug(slug),
    staleTime: 60_000,
  };
}

export function useItemBySlug(slug: string) {
  return useQuery({ ...itemBySlugQueryOptions(slug), enabled: !!slug });
}

export function useItemUpdates(itemId: string | undefined) {
  return useQuery({
    queryKey: ["tracker", "updates", itemId ?? "none"] as const,
    queryFn: () => fetchUpdates(itemId!),
    staleTime: 60_000,
    enabled: !!itemId,
  });
}

export function useFollowerCounts(itemIds: string[]) {
  // Klucz z posortowanych id - stabilny niezależnie od kolejności listy.
  const keyIds = [...itemIds].sort().join(",");
  return useQuery({
    queryKey: ["tracker", "followers", keyIds] as const,
    queryFn: () => fetchFollowerCounts(itemIds),
    staleTime: 60_000,
    enabled: itemIds.length > 0,
  });
}

export function useMyFollows(userId: string | undefined) {
  return useQuery({
    queryKey: ["tracker", "my-follows", userId ?? "anon"] as const,
    queryFn: () => fetchMyFollows(userId!),
    enabled: !!userId,
  });
}

// ---------------------------------------------------------------------------
// Stanowiska państw członkowskich (explorer)
// ---------------------------------------------------------------------------

export interface PolicyPosition {
  item_id: string;
  country_code: string;
  stance: string;
  note_pl: string | null;
  note_en: string | null;
  updated_at: string;
}

const POSITION_FIELDS = "item_id,country_code,stance,note_pl,note_en,updated_at";

/** Stanowiska państw dla dossier (RLS: publiczne tylko dla opublikowanych). */
export async function fetchPositions(itemId: string): Promise<PolicyPosition[]> {
  const { data, error } = await supabase
    .from("eu_policy_positions")
    .select(POSITION_FIELDS)
    .eq("item_id", itemId)
    .order("country_code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as PolicyPosition[];
}

export function useItemPositions(itemId: string | undefined) {
  return useQuery({
    queryKey: ["tracker", "positions", itemId ?? "none"] as const,
    queryFn: () => fetchPositions(itemId!),
    staleTime: 60_000,
    enabled: !!itemId,
  });
}

/** Stanowiska dla wielu dossier naraz (explorer/macierz koalicji). */
export async function fetchPositionsForItems(itemIds: string[]): Promise<PolicyPosition[]> {
  if (itemIds.length === 0) return [];
  const { data, error } = await supabase
    .from("eu_policy_positions")
    .select(POSITION_FIELDS)
    .in("item_id", itemIds);
  if (error) throw error;
  return (data ?? []) as unknown as PolicyPosition[];
}

export function usePositionsForItems(itemIds: string[]) {
  const key = [...itemIds].sort().join(",");
  return useQuery({
    queryKey: ["tracker", "positions-bulk", key] as const,
    queryFn: () => fetchPositionsForItems(itemIds),
    staleTime: 60_000,
    enabled: itemIds.length > 0,
  });
}

// ---------------------------------------------------------------------------
// Powiązane akty (relacje między dossier)
// ---------------------------------------------------------------------------

export const POLICY_RELATIONS = ["related", "amends", "implements", "supersedes"] as const;
export type PolicyRelation = (typeof POLICY_RELATIONS)[number];

export interface RelatedItem {
  related_item_id: string;
  relation: string;
  slug: string;
  title_pl: string;
  title_en: string;
  stage: string;
}

/** Powiązane, opublikowane dossier (RLS wymaga obu stron opublikowanych).
 *  Embed PostgREST po kluczu obcym related_item_id -> eu_policy_items. */
export async function fetchRelatedItems(itemId: string): Promise<RelatedItem[]> {
  const { data, error } = await supabase
    .from("eu_policy_links")
    .select(
      "related_item_id, relation, eu_policy_items!eu_policy_links_related_item_id_fkey(slug,title_pl,title_en,stage,status)",
    )
    .eq("item_id", itemId);
  if (error) throw error;
  type Row = {
    related_item_id: string;
    relation: string;
    eu_policy_items: {
      slug: string;
      title_pl: string;
      title_en: string;
      stage: string;
      status: string;
    } | null;
  };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.eu_policy_items && r.eu_policy_items.status === "published")
    .map((r) => ({
      related_item_id: r.related_item_id,
      relation: r.relation,
      slug: r.eu_policy_items!.slug,
      title_pl: r.eu_policy_items!.title_pl,
      title_en: r.eu_policy_items!.title_en,
      stage: r.eu_policy_items!.stage,
    }));
}

export function useRelatedItems(itemId: string | undefined) {
  return useQuery({
    queryKey: ["tracker", "links", itemId ?? "none"] as const,
    queryFn: () => fetchRelatedItems(itemId!),
    staleTime: 60_000,
    enabled: !!itemId,
  });
}

// ---------------------------------------------------------------------------
// Globalny feed "co się zmieniło" (ostatnie aktualizacje wszystkich dossier)
// ---------------------------------------------------------------------------

export interface RecentUpdate {
  id: string;
  note_pl: string;
  note_en: string;
  stage_from: string | null;
  stage_to: string | null;
  source_url: string | null;
  happened_on: string;
  created_at: string;
  item_slug: string;
  item_title_pl: string;
  item_title_en: string;
  policy_area: string;
}

/** Ostatnie wpisy osi czasu ze WSZYSTKICH opublikowanych dossier.
 *  RLS: eu_policy_updates public read wymaga opublikowanego dossier;
 *  embed !inner odrzuca wpisy dla szkiców. */
export async function fetchRecentUpdates(limit = 40): Promise<RecentUpdate[]> {
  const { data, error } = await supabase
    .from("eu_policy_updates")
    .select(
      "id,note_pl,note_en,stage_from,stage_to,source_url,happened_on,created_at," +
        "eu_policy_items!inner(slug,title_pl,title_en,policy_area,status)",
    )
    .order("happened_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  type Row = {
    id: string;
    note_pl: string;
    note_en: string;
    stage_from: string | null;
    stage_to: string | null;
    source_url: string | null;
    happened_on: string;
    created_at: string;
    eu_policy_items: {
      slug: string;
      title_pl: string;
      title_en: string;
      policy_area: string;
      status: string;
    } | null;
  };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.eu_policy_items && r.eu_policy_items.status === "published")
    .map((r) => ({
      id: r.id,
      note_pl: r.note_pl,
      note_en: r.note_en,
      stage_from: r.stage_from,
      stage_to: r.stage_to,
      source_url: r.source_url,
      happened_on: r.happened_on,
      created_at: r.created_at,
      item_slug: r.eu_policy_items!.slug,
      item_title_pl: r.eu_policy_items!.title_pl,
      item_title_en: r.eu_policy_items!.title_en,
      policy_area: r.eu_policy_items!.policy_area,
    }));
}

export function useRecentUpdates(limit = 40) {
  return useQuery({
    queryKey: ["tracker", "recent-updates", limit] as const,
    queryFn: () => fetchRecentUpdates(limit),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Statystyki trackera (dashboard) - RPC agregujący (same liczby, bez wierszy)
// ---------------------------------------------------------------------------

export interface TrackerStats {
  total: number;
  by_stage: Record<string, number>;
  by_area: Record<string, number>;
}

export async function fetchTrackerStats(): Promise<TrackerStats> {
  const { data, error } = await supabase.rpc("get_tracker_stats");
  if (error) throw error;
  const obj = (data ?? {}) as Partial<TrackerStats>;
  return {
    total: obj.total ?? 0,
    by_stage: obj.by_stage ?? {},
    by_area: obj.by_area ?? {},
  };
}

export function useTrackerStats() {
  return useQuery({
    queryKey: ["tracker", "stats"] as const,
    queryFn: fetchTrackerStats,
    staleTime: 5 * 60_000,
  });
}

/** Toggle obserwowania z invalidacją listy obserwacji i liczników. */
export function useToggleFollowItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      itemId: string;
      userId: string;
      tenantId: string;
      on: boolean;
    }) => {
      if (input.on) {
        await followItem({ itemId: input.itemId, userId: input.userId, tenantId: input.tenantId });
      } else {
        await unfollowItem({ itemId: input.itemId, userId: input.userId });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tracker", "my-follows"] });
      void queryClient.invalidateQueries({ queryKey: ["tracker", "followers"] });
    },
  });
}
