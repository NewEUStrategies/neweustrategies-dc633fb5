// Pre-warm Supabase Storage image transforms dla wszystkich aktywnych
// crop sizes. Realnie - native `sharp` nie działa w Workers, więc nie
// generujemy nowych plików; zamiast tego HEAD-em odpytujemy
// /render/image/public/... by Supabase zbudował i zcache'ował transform.
// Wynik: lista [media_url, size, ok] - admin widzi raport.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildTransformedImageUrl } from "@/lib/cropSizes";

interface RegenResult {
  media: number;
  sizes: number;
  ok: number;
  failed: number;
  details: Array<{ url: string; size: string; ok: boolean; status?: number }>;
}

export const regenerateThumbnails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    limit: z.number().int().min(1).max(500).default(100),
  }).parse(i ?? {}))
  .handler(async ({ data, context }): Promise<RegenResult> => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
    const tenantId = profile?.tenant_id as string | undefined;
    if (!tenantId) throw new Error("No tenant");

    const [{ data: media }, { data: sizes }] = await Promise.all([
      supabase
        .from("media")
        .select("public_url")
        .eq("tenant_id", tenantId)
        .not("public_url", "is", null)
        .limit(data.limit),
      supabase
        .from("custom_crop_sizes")
        .select("name, width, height")
        .eq("tenant_id", tenantId),
    ]);

    const mediaRows = (media ?? []) as Array<{ public_url: string | null }>;
    const sizeRows = (sizes ?? []) as Array<{ name: string; width: number; height: number }>;

    const details: RegenResult["details"] = [];
    let ok = 0;
    let failed = 0;

    for (const m of mediaRows) {
      const src = m.public_url;
      if (!src) continue;
      for (const s of sizeRows) {
        const url = buildTransformedImageUrl(src, { width: s.width, height: s.height });
        try {
          const res = await fetch(url, { method: "HEAD" });
          const success = res.ok;
          if (success) ok++; else failed++;
          details.push({ url, size: s.name, ok: success, status: res.status });
        } catch {
          failed++;
          details.push({ url, size: s.name, ok: false });
        }
      }
    }

    return {
      media: mediaRows.length,
      sizes: sizeRows.length,
      ok,
      failed,
      details: details.slice(0, 200),
    };
  });
