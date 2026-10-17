// Kursy NBP przed wystawieniem faktury wydarzenia w walucie obcej (INV-06).
//
// Funkcja serwerowa jest TRANSPORTEM: bramke (`assert_event_admin_tenant()`)
// i liste potrzebnych dni trzyma baza (`admin_event_invoice_fx_needs`,
// wolane klientem uzytkownika), a kurs bierze sie wylacznie z api.nbp.pl.
// Plik zawiera WYLACZNIE deklaracje (wymog tss-serverfn-split); logika
// laduje sie przez `import()` dopiero w obsludze wywolania.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.union([
  z.object({ invoiceIds: z.array(z.string().uuid()).min(1).max(200) }),
  z.object({ eventId: z.string().uuid(), pending: z.literal(true) }),
]);

export const prepareEventInvoiceFx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { prepareEventInvoiceFxRates } = await import("@/lib/events/eventInvoiceFx.server");
    return prepareEventInvoiceFxRates(context.supabase, data);
  });
