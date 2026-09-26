// Powiadomienie kupujacych o wystawionych dokumentach (po wystawieniu w studiu).
//
// Ta funkcja serwerowa NIE jest granica bezpieczenstwa - jest transportem:
// autoryzacje robi `admin_event_invoice_notify_payload` wolane klientem
// uzytkownika w `eventInvoiceNotify.server.ts`. Plik zawiera WYLACZNIE
// deklaracje (wymog tss-serverfn-split); logika i wysylka laduja sie przez
// `import()` dopiero w obsludze wywolania.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ invoiceIds: z.array(z.string().uuid()).min(1).max(200) });

export const notifyEventInvoicesIssued = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { notifyIssuedInvoices } = await import("@/lib/events/eventInvoiceNotify.server");
    return notifyIssuedInvoices(context.supabase, data.invoiceIds);
  });
