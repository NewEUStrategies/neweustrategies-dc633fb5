// Server functions portalu klienta i faktur.
//
// Podział ról:
//  - użytkownik: prosi o link do portalu na własny mail i o fakturę do
//    transakcji, którą sam opłacił,
//  - administrator: wysyła link ponownie wskazanemu użytkownikowi i pobiera
//    fakturę po samym numerze transakcji (obsługa zgłoszeń).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminEditor } from "@/integrations/supabase/require-staff";
import { normalizeTransactionId, TRANSACTION_ID_PATTERN } from "@/lib/billing/transactionId";

const envSchema = z.enum(["sandbox", "live"]);
const transactionSchema = z
  .string()
  .trim()
  .transform(normalizeTransactionId)
  .refine((v) => TRANSACTION_ID_PATTERN.test(v), { message: "invalid_transaction" });

/** Mail z jednorazowym linkiem do portalu klienta - na własny adres. */
export const sendMyPortalLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: "sandbox" | "live" }) =>
    z.object({ environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { sendPortalLinkEmail } = await import("@/lib/billing/portalLink.server");
    // Ziarno co 10 minut: przypadkowy dubel kliknięcia nie wysyła dwóch maili,
    // a świadome powtórzenie po chwili już tak (poprzedni link bywa zużyty).
    const seed = String(Math.floor(Date.now() / 600_000));
    return sendPortalLinkEmail({
      userId: context.userId,
      environment: data.environment,
      idempotencySeed: seed,
    });
  });

/** Ponowna wysyłka linku do portalu z panelu administratora. */
export const resendPortalLinkForUser = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .inputValidator((data: { userId: string; environment: "sandbox" | "live" }) =>
    z.object({ userId: z.string().uuid(), environment: envSchema }).parse(data),
  )
  .handler(async ({ data }) => {
    const { sendPortalLinkEmail } = await import("@/lib/billing/portalLink.server");
    // Administrator wysyła świadomie i zwykle po zgłoszeniu użytkownika -
    // każde kliknięcie ma dać świeży link, więc ziarno jest unikalne.
    return sendPortalLinkEmail({
      userId: data.userId,
      environment: data.environment,
      idempotencySeed: `admin:${Date.now()}`,
    });
  });

/** Faktura po numerze transakcji - użytkownik, tylko własne transakcje. */
export const fetchMyInvoiceByTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { transactionId: string; environment: "sandbox" | "live" }) =>
    z.object({ transactionId: transactionSchema, environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { invoiceUrlForTransaction } = await import("@/lib/billing/invoice.server");
    return invoiceUrlForTransaction({
      transactionId: data.transactionId,
      environment: data.environment,
      userId: context.userId,
    });
  });

/** Faktura po numerze transakcji - panel administratora (obsługa zgłoszeń). */
export const fetchInvoiceByTransactionAsAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .inputValidator((data: { transactionId: string; environment: "sandbox" | "live" }) =>
    z.object({ transactionId: transactionSchema, environment: envSchema }).parse(data),
  )
  .handler(async ({ data }) => {
    const { invoiceUrlForTransaction } = await import("@/lib/billing/invoice.server");
    return invoiceUrlForTransaction({
      transactionId: data.transactionId,
      environment: data.environment,
      userId: null,
    });
  });
