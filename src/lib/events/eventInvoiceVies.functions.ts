// Weryfikacja numeru VAT UE nabywcy szkicu faktury w VIES (INV-12).
//
// Transport: bramka i podmiot zapytania w bazie
// (`admin_event_invoice_vies_subject`, klient uzytkownika), wynik zapisuje
// serwer kluczem uslugowym (`_event_invoice_vies_record`) - panel nie moze
// sam oglosic "numer wazny". Plik zawiera WYLACZNIE deklaracje (wymog
// tss-serverfn-split).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ invoiceId: z.string().uuid() });

export const verifyEventInvoiceVies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { verifyInvoiceBuyerVies } = await import("@/lib/events/eventInvoiceVies.server");
    return verifyInvoiceBuyerVies(context.supabase, data.invoiceId);
  });
