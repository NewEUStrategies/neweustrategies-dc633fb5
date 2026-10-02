// Server functions podglądu maili transakcyjnych (/admin/newsletter/email-preview).
// Cienki wrapper - logika renderowania w src/lib/email/tx-preview.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";
import { loadTxOverrides } from "@/lib/email/txOverrides.server";
import { renderAllTxEmailPreviews, type TxEmailPreview } from "@/lib/email/tx-preview.server";
import { resolveUserTenantId } from "@/lib/server/userTenant.server";

export type { TxEmailPreview } from "@/lib/email/tx-preview.server";

export const getTxEmailPreviews = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((data: unknown) =>
    z
      .object({
        lang: z.enum(["pl", "en"]).default("pl"),
        firstName: z.string().max(60).nullable().default("Marek"),
        gender: z.enum(["male", "female", "unknown"]).default("unknown"),
      })
      .default({})
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }): Promise<TxEmailPreview[]> => {
    // GRANICA NAJEMCY: podgląd pokazuje nadpisania najemcy WOŁAJĄCEGO - z jego
    // profilu, nigdy z ładunku żądania - czyli tego, do którego panel je
    // zapisuje (polityki INSERT/UPDATE `site_settings`: tenant_id =
    // current_tenant_id()). Samo RLS nie wystarcza: adminowi odczyt zwraca sumę
    // "public read" (najemca hosta) i "admin read" (najemca profilu), więc bez
    // jawnego filtra pod jednym kluczem mogły przyjść DWA wiersze, a podgląd
    // pokazywał treść cudzej redakcji. `resolveUserTenantId` rzuca, gdy profil
    // nie ma najemcy (fail closed), więc brak kontekstu nie zamienia się w brak
    // zakresu.
    const tenantId = await resolveUserTenantId(context.supabase, context.userId);
    const overrides = await loadTxOverrides(context.supabase, tenantId);
    return renderAllTxEmailPreviews(data.lang, data.firstName, data.gender, overrides);
  });
