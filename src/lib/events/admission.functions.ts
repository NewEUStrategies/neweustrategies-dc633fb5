// Cienkie wrappery serwerowe (tss-serverfn-split) nad wyceną wejściówki/pakietu
// i zakupem pakietu - ekran zakupu NIE woła już tych RPC z przeglądarki.
//
// Powód i okno wdrożenia: `admissionRpc.server.ts` (migracja 20261007120600 -
// sonda kodu z przeglądarki omijała kubełek pudeł po adresie). Wynik wraca
// w kształcie PostgREST (`{ data, error }`), więc `admissionApi.ts` mapuje
// odmowy i błędy tym samym słownikiem co dotąd.
//
// POST, nie GET: ładunek niesie kod rabatowy, a kod w adresie zostałby
// w logach pośredników i historii.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AdmissionRpcResult } from "@/lib/events/admissionRpc.server";

/**
 * Ładunek wyceny - te same klucze, które czyta `event_admission_quote`. Który
 * z dwóch identyfikatorów (dokładnie jeden) rozstrzyga baza nazwanym błędem.
 */
const quoteSchema = z
  .object({
    ticket_type_id: z.string().uuid().optional(),
    package_id: z.string().uuid().optional(),
    coupon_code: z.string().trim().max(64).optional(),
  })
  .strict();

/**
 * Ładunek zakupu pakietu. `.strict()`: klucz spoza listy (np. `company_id`,
 * który baza i tak odrzuca jako `forbidden_field`) nie dochodzi do bazy.
 */
const purchaseSchema = z
  .object({
    package_id: z.string().uuid(),
    buyer_name: z.string().trim().max(500).optional(),
    buyer_email: z.string().trim().max(320).optional(),
    invoice_note: z.string().trim().max(4000).optional(),
    coupon_code: z.string().trim().max(64).optional(),
  })
  .strict();

export const quoteEventAdmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => quoteSchema.parse(input))
  .handler(async ({ data, context }): Promise<AdmissionRpcResult> => {
    const { quoteAdmissionForUser } = await import("@/lib/events/admissionRpc.server");
    return quoteAdmissionForUser(context.supabase, context.userId, data);
  });

export const purchaseEventPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => purchaseSchema.parse(input))
  .handler(async ({ data, context }): Promise<AdmissionRpcResult> => {
    const { purchasePackageForUser } = await import("@/lib/events/admissionRpc.server");
    return purchasePackageForUser(context.supabase, context.userId, data);
  });
