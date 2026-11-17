// CRUD custom crop sizes (tenant-scoped) - część PANELU (`/admin/crop-sizes`).
// Budowanie URL-i wariantów obrazu żyje w `cropSizes.ts`.
//
// OSOBNY MODUŁ, CELOWO (chunk startowy, roadmapa ładowania §9.1 J3).
// `cropSizes.ts` czyta każdy obraz strony, więc siedzi w `app-initial`; CRUD
// woła wyłącznie panel. `cropSizes.ts` NIE importuje stąd niczego - także
// reeksportem.
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
