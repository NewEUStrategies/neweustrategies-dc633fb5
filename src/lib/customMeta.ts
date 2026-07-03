// Types + queries for global "Custom Meta" definitions (per tenant) and the
// per-post values stored on `posts.custom_meta` (jsonb key -> string value).
// Definitions are publicly readable so renderers on public pages work
// without auth; mutations are scoped to editors/admins via RLS.
import { supabase } from "@/integrations/supabase/client";

export interface CustomMetaDef {
  id: string;
  tenant_id: string;
  key: string;
  label_pl: string;
  label_en: string;
  icon: string;
  position: number;
}

export type CustomMetaValues = Record<string, string>;

export interface CustomMetaItem {
  def: CustomMetaDef;
  value: string;
}

/** Load all definitions (publicly readable). */
export async function listCustomMetaDefs(tenantId?: string | null): Promise<CustomMetaDef[]> {
  let q = supabase
    .from("post_custom_meta_defs")
    .select("id, tenant_id, key, label_pl, label_en, icon, position")
    .order("position", { ascending: true })
    .order("key", { ascending: true });
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CustomMetaDef[];
}

export async function upsertCustomMetaDef(
  def: Omit<CustomMetaDef, "id"> & { id?: string },
): Promise<void> {
  const payload = { ...def };
  const { error } = await supabase
    .from("post_custom_meta_defs")
    .upsert(payload, { onConflict: "tenant_id,key" });
  if (error) throw error;
}

export async function deleteCustomMetaDef(id: string): Promise<void> {
  const { error } = await supabase.from("post_custom_meta_defs").delete().eq("id", id);
  if (error) throw error;
}

/** Pair definitions with the per-post values, preserving definition order. */
export function buildCustomMetaItems(
  defs: readonly CustomMetaDef[],
  values: CustomMetaValues | null | undefined,
): CustomMetaItem[] {
  if (!values) return [];
  const out: CustomMetaItem[] = [];
  for (const d of defs) {
    const v = values[d.key];
    if (typeof v === "string" && v.trim()) out.push({ def: d, value: v.trim() });
  }
  return out;
}

/** Localized label fallback (PL -> EN). */
export function metaLabel(def: CustomMetaDef, lang: "pl" | "en"): string {
  if (lang === "en") return def.label_en || def.label_pl || def.key;
  return def.label_pl || def.label_en || def.key;
}
