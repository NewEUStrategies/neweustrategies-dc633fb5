// Biblioteka ikon - data layer (CRUD + bulk upload do bucketu 'media').
import { supabase } from "@/integrations/supabase/client";

export type IconKind = "custom" | "flag" | "brand";
export type IconVariant = "auto" | "light" | "dark" | "default";

export interface IconRow {
  id: string;
  tenant_id: string;
  kind: IconKind;
  name: string;
  label: string | null;
  url_default: string;
  url_light: string;
  url_dark: string;
  default_variant: IconVariant;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface IconDraft {
  kind: IconKind;
  name: string;
  label?: string | null;
  url_default?: string;
  url_light?: string;
  url_dark?: string;
  default_variant?: IconVariant;
  position?: number;
}

export async function listIcons(kind?: IconKind): Promise<IconRow[]> {
  let q = supabase
    .from("icon_library")
    .select("*")
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as IconRow[];
}

export async function upsertIcon(tenantId: string, draft: IconDraft & { id?: string }): Promise<IconRow> {
  const payload = {
    tenant_id: tenantId,
    kind: draft.kind,
    name: draft.name.trim(),
    label: draft.label ?? null,
    url_default: draft.url_default ?? "",
    url_light: draft.url_light ?? "",
    url_dark: draft.url_dark ?? "",
    default_variant: draft.default_variant ?? "auto",
    position: draft.position ?? 0,
  };
  if (draft.id) {
    const { data, error } = await supabase
      .from("icon_library")
      .update(payload)
      .eq("id", draft.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as IconRow;
  }
  const { data, error } = await supabase
    .from("icon_library")
    .upsert(payload, { onConflict: "tenant_id,kind,name" })
    .select("*")
    .single();
  if (error) throw error;
  return data as IconRow;
}

export async function deleteIcon(id: string): Promise<void> {
  const { error } = await supabase.from("icon_library").delete().eq("id", id);
  if (error) throw error;
}

const SLUG_RE = /[^a-z0-9_-]+/g;
export function slugifyIconName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(SLUG_RE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export interface BulkUploadParsed {
  base: string;
  variant: "light" | "dark" | "default";
}

/** Parsuje nazwę pliku: `foo-dark.svg` -> {base:"foo", variant:"dark"}. */
export function parseUploadFilename(filename: string): BulkUploadParsed {
  const noExt = filename.replace(/\.[^.]+$/, "");
  const slug = slugifyIconName(noExt);
  if (/-dark$/.test(slug)) return { base: slug.replace(/-dark$/, ""), variant: "dark" };
  if (/-light$/.test(slug)) return { base: slug.replace(/-light$/, ""), variant: "light" };
  return { base: slug, variant: "default" };
}

export async function uploadIconAsset(
  tenantId: string,
  kind: IconKind,
  file: File,
): Promise<string> {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${tenantId}/icons/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("media")
    .upload(path, file, { cacheControl: "31536000", upsert: false, contentType: file.type });
  if (error) throw error;
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}

export interface BulkResult {
  created: number;
  updated: number;
  errors: { file: string; message: string }[];
}

/** Hurtowy upload - grupuje pliki po base name; `-dark`/`-light` to warianty. */
export async function bulkImportIcons(
  tenantId: string,
  kind: IconKind,
  files: File[],
): Promise<BulkResult> {
  const groups = new Map<string, { default?: File; light?: File; dark?: File }>();
  for (const f of files) {
    const { base, variant } = parseUploadFilename(f.name);
    if (!base) continue;
    const g = groups.get(base) ?? {};
    g[variant] = f;
    groups.set(base, g);
  }
  const result: BulkResult = { created: 0, updated: 0, errors: [] };
  for (const [base, files] of groups) {
    try {
      const [urlDefault, urlLight, urlDark] = await Promise.all([
        files.default ? uploadIconAsset(tenantId, kind, files.default) : Promise.resolve(""),
        files.light ? uploadIconAsset(tenantId, kind, files.light) : Promise.resolve(""),
        files.dark ? uploadIconAsset(tenantId, kind, files.dark) : Promise.resolve(""),
      ]);
      const { data: existing } = await supabase
        .from("icon_library")
        .select("id,url_default,url_light,url_dark")
        .eq("tenant_id", tenantId)
        .eq("kind", kind)
        .eq("name", base)
        .maybeSingle();
      const payload = {
        tenant_id: tenantId,
        kind,
        name: base,
        url_default: urlDefault || existing?.url_default || "",
        url_light: urlLight || existing?.url_light || "",
        url_dark: urlDark || existing?.url_dark || "",
        default_variant: "auto" as IconVariant,
      };
      const { error } = await supabase
        .from("icon_library")
        .upsert(payload, { onConflict: "tenant_id,kind,name" });
      if (error) throw error;
      if (existing) result.updated += 1;
      else result.created += 1;
    } catch (e) {
      result.errors.push({ file: base, message: e instanceof Error ? e.message : "Błąd" });
    }
  }
  return result;
}

/** Zwraca URL ikony z uwzględnieniem trybu kolorystycznego strony. */
export function resolveIconUrl(row: IconRow, mode: "light" | "dark" = "light"): string {
  if (row.default_variant === "light") return row.url_light || row.url_default;
  if (row.default_variant === "dark") return row.url_dark || row.url_default;
  if (row.default_variant === "default") return row.url_default || row.url_light || row.url_dark;
  // auto: dobieramy do trybu
  if (mode === "dark") return row.url_dark || row.url_default || row.url_light;
  return row.url_light || row.url_default || row.url_dark;
}
