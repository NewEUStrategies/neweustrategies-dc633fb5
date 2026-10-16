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

// Dodanie i edycja to OSOBNE zapytania, nie upsert po (tenant_id, key): upsert
// nie odróżniał dodania od nadpisania cudzej definicji (klucz dodany w innej
// karcie po wczytaniu listy) ani edycji od wskrzeszenia definicji usuniętej
// w innej karcie. Lista na ekranie bywa sprzed minut, więc rozstrzyga baza w tym
// samym poleceniu. Odmowa to stan ekranu, nie awaria - wraca jako wynik; sieć
// i RLS przy INSERT lecą wyjątkiem (UPDATE zablokowany przez RLS kończy się
// BEZ błędu - patrz `updateCustomMetaDef`).
export type AddCustomMetaDefResult = { ok: true } | { ok: false; reason: "key_taken" };
export type UpdateCustomMetaDefResult =
  { ok: true } | { ok: false; reason: "deleted" | "forbidden" };

/** Pola, które wolno zmienić w edycji. Klucz jest niezmienny - pod nim wpisy trzymają wartości. */
export type CustomMetaDefPatch = Pick<CustomMetaDef, "label_pl" | "label_en" | "icon" | "position">;

const UNIQUE_VIOLATION = "23505";

/**
 * Dodaje NOWĄ definicję zwykłym INSERT. Klucz zajęty choćby chwilę wcześniej
 * odrzuca `UNIQUE (tenant_id, key)`, a cudza definicja zostaje nietknięta.
 * `id` nie wysyłamy (`gen_random_uuid()`), więc 23505 znaczy tylko „klucz zajęty”.
 */
export async function addCustomMetaDef(
  def: Omit<CustomMetaDef, "id">,
): Promise<AddCustomMetaDefResult> {
  // Kolumny jawnie: szerszy obiekt (np. cały wiersz z `id`) przeszedłby kontrolę
  // typów, a wstawienie z `id` usuniętego wiersza to znowu wskrzeszenie.
  const { error } = await supabase.from("post_custom_meta_defs").insert({
    tenant_id: def.tenant_id,
    key: def.key,
    label_pl: def.label_pl,
    label_en: def.label_en,
    icon: def.icon,
    position: def.position,
  });
  if (error?.code === UNIQUE_VIOLATION) return { ok: false, reason: "key_taken" };
  if (error) throw error;
  return { ok: true };
}

/**
 * Zmienia ISTNIEJĄCĄ definicję po `id`. UPDATE niczego nie wstawia, ale zero
 * zmienionych wierszy ma dwie przyczyny: definicji już nie ma (usunięta w innej
 * karcie) albo RLS nie pozwala jej zmienić - autor wchodzi do panelu i czyta
 * listę publicznego tenanta, a zapis to polityka admina/redaktora.
 * Klucz i tenant nie jadą w ładunku - edycja nie zmieni tożsamości wiersza.
 */
export async function updateCustomMetaDef(
  id: string,
  patch: CustomMetaDefPatch,
): Promise<UpdateCustomMetaDefResult> {
  const { data, error } = await supabase
    .from("post_custom_meta_defs")
    .update({
      label_pl: patch.label_pl,
      label_en: patch.label_en,
      icon: patch.icon,
      position: patch.position,
    })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (data.length > 0) return { ok: true };
  // Jedno zapytanie, tylko na ścieżce odmowy: widoczny wiersz to brak prawa
  // zapisu, a nie usunięcie - komunikat „usunięta” radził dodać ją ponownie.
  const { data: visible, error: probeError } = await supabase
    .from("post_custom_meta_defs")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (probeError) throw probeError;
  return { ok: false, reason: visible ? "forbidden" : "deleted" };
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
