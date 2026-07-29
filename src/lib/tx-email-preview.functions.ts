// Server functions podglądu maili transakcyjnych (/admin/newsletter/email-preview).
// Cienki wrapper - logika renderowania w src/lib/email/tx-preview.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";
import { loadTxOverrides } from "@/lib/email/txOverrides.server";
import { renderAllTxEmailPreviews, type TxEmailPreview } from "@/lib/email/tx-preview.server";

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
    const overrides = await loadTxOverrides(context.supabase);
    return renderAllTxEmailPreviews(data.lang, data.firstName, data.gender, overrides);
  });
