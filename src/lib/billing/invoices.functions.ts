// Server functions panelu faktur (użytkownik - wyłącznie własne dokumenty).
//
//  - `generateMyInvoicePdf` - kopia PDF dokumentu z naszej bazy (działa też,
//    gdy operator nie udostępnił pliku),
//  - `fetchMyCrmCompany` / `importMyCrmCompany` / `pushMyBillingToCrm` -
//    dwukierunkowa wymiana danych nabywcy z kartoteką firm w CRM.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const localeSchema = z.enum(["pl", "en"]);

export const generateMyInvoicePdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { documentId: string; locale: "pl" | "en" }) =>
    z.object({ documentId: z.string().uuid(), locale: localeSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { buildInvoicePdf } = await import("@/lib/billing/invoiceDocument.server");
    return buildInvoicePdf({
      userId: context.userId,
      documentId: data.documentId,
      locale: data.locale,
    });
  });

export const fetchMyCrmCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadCrmCompanyForUser } = await import("@/lib/billing/invoiceCrm.server");
    return loadCrmCompanyForUser(context.userId);
  });

export const importMyCrmCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { importCrmCompanyToBillingProfile } = await import("@/lib/billing/invoiceCrm.server");
    return importCrmCompanyToBillingProfile(context.userId);
  });

export const pushMyBillingToCrm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { pushBillingProfileToCrm } = await import("@/lib/billing/invoiceCrm.server");
    return pushBillingProfileToCrm(context.userId);
  });
