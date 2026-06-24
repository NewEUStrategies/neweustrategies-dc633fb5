// CRUD + helpers dla custom crop sizes (tenant-scoped).
// Używane przez admin route oraz przez OptimizedImage/lightbox do
// generowania URL-i wariantów obrazu (Supabase Storage transforms).
import { supabase } from "@/integrations/supabase/client";

export interface CropSize {
  id: string;
  tenant_id: string;
  name: string;
  ratio_w: number;
  ratio_h: number;
  width: number;
  height: number;
  position: number;
}

export type CropSizeDraft = Omit<CropSize, "id" | "tenant_id">;

export async function listCropSizes(tenantId?: string): Promise<CropSize[]> {
  let q = supabase
    .from("custom_crop_sizes")
    .select("id, tenant_id, name, ratio_w, ratio_h, width, height, position")
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CropSize[];
}

export async function upsertCropSize(
  tenantId: string,
  draft: CropSizeDraft & { id?: string },
): Promise<CropSize> {
  const payload = { tenant_id: tenantId, ...draft };
  const { data, error } = await supabase
    .from("custom_crop_sizes")
    .upsert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as CropSize;
}

export async function deleteCropSize(id: string): Promise<void> {
  const { error } = await supabase.from("custom_crop_sizes").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Build a transformed image URL.
 * - Works for Supabase Storage public URLs (https://<host>/storage/v1/object/public/<bucket>/<path>).
 * - Switches to /render/image/public/... with width/height/resize query params.
 * - For non-Supabase URLs (CDN/external), appends `?w=&h=` so userland CDN
 *   can pick it up; harmless query params otherwise.
 */
export function buildTransformedImageUrl(
  src: string,
  size: { width: number; height: number; resize?: "cover" | "contain" | "fill" },
): string {
  if (!src) return src;
  const resize = size.resize ?? "cover";
  try {
    const url = new URL(src);
    if (url.pathname.includes("/storage/v1/object/public/")) {
      url.pathname = url.pathname.replace(
        "/storage/v1/object/public/",
        "/storage/v1/render/image/public/",
      );
      url.searchParams.set("width", String(size.width));
      url.searchParams.set("height", String(size.height));
      url.searchParams.set("resize", resize);
      url.searchParams.set("quality", "80");
      return url.toString();
    }
    url.searchParams.set("w", String(size.width));
    url.searchParams.set("h", String(size.height));
    return url.toString();
  } catch {
    return src;
  }
}
