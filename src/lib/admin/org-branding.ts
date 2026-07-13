// Upload assetów brandingu organizacji do bucketu `media` z prefixem
// `org-branding/${orgId}/`. Reużywamy istniejącego publicznego bucketu, żeby
// nie mnożyć uprawnień - wpisy widoczne tylko przez URL, ścieżka zawiera
// znacznik czasu (nie da się jej odgadnąć). Zapisy chronione politykami RLS
// bucketu `media`.
import { supabase } from "@/integrations/supabase/client";

export const BRAND_BUCKET = "media";

export type LogoSlot =
  | "logo_h_light"
  | "logo_h_dark"
  | "logo_v_light"
  | "logo_v_dark"
  | "logo_favicon";

const ALLOWED_MIME = ["image/svg+xml", "image/png", "image/webp", "image/jpeg", "image/x-icon"];
const MAX_BYTES = 2 * 1024 * 1024;

export function validateLogoFile(file: File): string | null {
  if (!ALLOWED_MIME.includes(file.type)) {
    return "invalid-mime";
  }
  if (file.size > MAX_BYTES) {
    return "too-large";
  }
  return null;
}

export function buildLogoPath(orgId: string, slot: LogoSlot, file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  return `org-branding/${orgId}/${slot}-${Date.now()}.${ext}`;
}

export async function uploadOrgLogo(
  orgId: string,
  slot: LogoSlot,
  file: File,
): Promise<string> {
  const err = validateLogoFile(file);
  if (err === "invalid-mime") throw new Error("invalid-mime");
  if (err === "too-large") throw new Error("too-large");
  const path = buildLogoPath(orgId, slot, file);
  const { error } = await supabase.storage.from(BRAND_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
    cacheControl: "3600",
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BRAND_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export interface OrgBrandingPatch {
  brand_primary?: string | null;
  brand_accent?: string | null;
  brand_ink?: string | null;
  logo_h_light?: string | null;
  logo_h_dark?: string | null;
  logo_v_light?: string | null;
  logo_v_dark?: string | null;
  logo_favicon?: string | null;
}

export async function updateOrgBranding(orgId: string, patch: OrgBrandingPatch): Promise<void> {
  const { error } = await supabase.from("member_organizations").update(patch).eq("id", orgId);
  if (error) throw error;
}
