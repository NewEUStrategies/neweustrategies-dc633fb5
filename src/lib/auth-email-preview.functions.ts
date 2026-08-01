// Server functions podglądu maili autoryzacyjnych (/admin/newsletter/email-preview).
// Cienki wrapper - logika renderowania w src/lib/email/auth-preview.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";
import { renderAllAuthEmailPreviews, type AuthEmailPreview } from "@/lib/email/auth-preview.server";

export type { AuthEmailPreview } from "@/lib/email/auth-preview.server";

export const getAuthEmailPreviews = createServerFn({ method: "GET" })
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
  .handler(async ({ data }): Promise<AuthEmailPreview[]> =>
    renderAllAuthEmailPreviews(data.lang, data.firstName, data.gender),
  );
