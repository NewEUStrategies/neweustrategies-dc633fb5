// Admin-only newsletter server functions. Uzywane wylacznie z /admin/newsletter.
//
// Zabezpieczenie: `requireStaff` (uwierzytelnienie + rola admin/editor/author).
// Import CSV zapisuje po stronie serwera przez service_role z pominieciem RLS,
// ale w ramach tenanta wywolujacego (tenant_id z profiles). Import respektuje
// idempotencje - istniejacy subskrybent nie jest nadpisywany.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";

const ImportRow = z.object({
  email: z.string().trim().email().max(254),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  displayName: z.string().trim().max(200).optional(),
  language: z.enum(["pl", "en"]).default("pl"),
  status: z.enum(["subscribed", "pending", "unsubscribed"]).default("subscribed"),
  source: z.string().trim().max(120).optional(),
  company: z.string().trim().max(200).optional(),
});

const ImportInput = z.object({
  rows: z.array(ImportRow).min(1).max(5000),
  markSource: z.string().trim().max(120).default("csv-import"),
});

export interface ImportSummary {
  ok: true;
  imported: number;
  skipped: number;
  errors: { email: string; reason: string }[];
}

export const importNewsletterSubscribers = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((data: unknown) => ImportInput.parse(data))
  .handler(async ({ data, context }): Promise<ImportSummary> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // tenant_id wywolujacego z profiles.
    const { data: profile, error: profileErr } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (profileErr || !profile?.tenant_id) {
      throw new Error("Profil bez tenanta - nie mozna importowac.");
    }
    const tenantId = profile.tenant_id;

    // Sprawdz istniejace, zeby nie liczyc ich do "imported".
    const emails = Array.from(new Set(data.rows.map((r) => r.email.toLowerCase())));
    const { data: existing } = await supabaseAdmin
      .from("newsletter_subscribers")
      .select("email")
      .eq("tenant_id", tenantId)
      .in("email", emails);
    const known = new Set((existing ?? []).map((r) => r.email as string));

    const errors: { email: string; reason: string }[] = [];
    let imported = 0;
    let skipped = 0;

    for (const raw of data.rows) {
      const email = raw.email.toLowerCase();
      if (known.has(email)) {
        skipped++;
        continue;
      }
      const displayName =
        raw.displayName || [raw.firstName, raw.lastName].filter(Boolean).join(" ") || null;
      const meta: Record<string, string> = {};
      if (raw.company) meta.company = raw.company;

      const { error } = await supabaseAdmin.from("newsletter_subscribers").insert({
        tenant_id: tenantId,
        email,
        display_name: displayName,
        first_name: raw.firstName ?? null,
        last_name: raw.lastName ?? null,
        language: raw.language,
        status: raw.status,
        source: raw.source ?? data.markSource,
        confirmed_at: raw.status === "subscribed" ? new Date().toISOString() : null,
        meta: Object.keys(meta).length ? meta : null,
      });
      if (error) {
        errors.push({ email, reason: error.message });
      } else {
        imported++;
        known.add(email);
      }
    }

    return { ok: true, imported, skipped, errors };
  });
