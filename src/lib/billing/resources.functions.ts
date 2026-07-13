// Server fn pobrania materiału z biblioteki członkowskiej.
//
// Plik leży w PRYWATNYM buckecie 'member-resources' - klient nie ma do niego
// odczytu. Ścieżka:
//   1. authorize_resource_download (RPC SECURITY DEFINER, wykonany JAKO
//      użytkownik przez klienta z tokenem) egzekwuje: published + ranga
//      warstwy (staff bez bramki) i zapisuje wiersz do resource_downloads
//      (historia uczestnictwa + licznik). Zwraca file_path/name/mime.
//   2. Service role generuje krótkotrwały podpisany URL do pliku.
// Dzięki temu manipulacja po stronie klienta nie omija bramki rangi - o dostęp
// pyta baza, a URL powstaje dopiero po autoryzacji.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const downloadSchema = z.object({ resourceId: z.string().uuid() });

const SIGNED_URL_TTL_SECONDS = 120;

export const downloadMemberResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => downloadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Bramka + log pobrania w jednej podróży (RPC jako użytkownik).
    const { data: rows, error } = await supabase.rpc("authorize_resource_download", {
      p_resource: data.resourceId,
    });
    if (error) {
      // Surowe komunikaty RPC ('resources: tier required' itd.) mapujemy na
      // stabilne kody, żeby UI mógł pokazać właściwy komunikat i18n.
      const msg = error.message || "";
      if (msg.includes("tier required"))
        return { ok: false as const, error: "tier_required" as const };
      if (msg.includes("not found")) return { ok: false as const, error: "not_found" as const };
      if (msg.includes("authentication"))
        return { ok: false as const, error: "auth_required" as const };
      console.error("[resources] authorize failed", error);
      return { ok: false as const, error: "failed" as const };
    }
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.file_path) return { ok: false as const, error: "not_found" as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from("member-resources")
      .createSignedUrl(row.file_path, SIGNED_URL_TTL_SECONDS, { download: row.file_name });
    if (signErr || !signed?.signedUrl) {
      console.error("[resources] sign url failed", signErr);
      return { ok: false as const, error: "failed" as const };
    }
    return { ok: true as const, url: signed.signedUrl, fileName: row.file_name };
  });
