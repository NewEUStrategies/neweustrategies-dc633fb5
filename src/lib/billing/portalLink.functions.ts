// Server functions portalu klienta i faktur.
//
// Podział ról:
//  - użytkownik: prosi o mail z wejściem do portalu na własny adres, otwiera
//    portal z tego wejścia (sesja powstaje na żądanie) i pobiera fakturę do
//    transakcji, którą sam opłacił,
//  - administrator: wysyła wejście do portalu ponownie wskazanemu użytkownikowi
//    i pobiera fakturę po samym numerze transakcji (obsługa zgłoszeń) -
//    WYŁĄCZNIE w obrębie własnego najemcy.
//
// SKĄD NAJEMCA. Bramka roli (`requireAdminEditor`) sprawdza rolę w najemcy
// wołającego, ale implementacje pracują kluczem serwisowym (ponad RLS). Do
// 12.10.2026 nic nie łączyło tych dwóch płaszczyzn: edytor najemcy B wysyłał
// linki do portalu kontom najemcy A (i dostawał w odpowiedzi ich adresy), a
// fakturę dowolnej transakcji pobierał bez żadnej kontroli. Teraz najemca jest
// rozwiązywany z PROFILU wołającego (dla panelu dodatkowo konfrontowany
// z hostem żądania - `assertCallerTenantMatchesHost`) i jedzie do implementacji
// jako jedyny legalny zakres. Ładunek nigdy nie niesie najemcy.
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

/** Mail ze stałym wejściem do portalu klienta - na własny adres. */
export const sendMyPortalLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { environment: "sandbox" | "live" }) =>
    z.object({ environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { resolveUserTenantId } = await import("@/lib/server/userTenant.server");
    const { sendPortalLinkEmail } = await import("@/lib/billing/portalLink.server");
    // Własny profil, nie host: użytkownik bywa na cudzej domenie (podgląd,
    // alias), a link ma prowadzić do najemcy, w którym ma konto.
    const tenantId = await resolveUserTenantId(context.supabase, context.userId);
    // Ziarno co 10 minut: przypadkowy dubel kliknięcia nie wysyła dwóch maili,
    // a świadome powtórzenie po chwili już tak.
    const seed = String(Math.floor(Date.now() / 600_000));
    return sendPortalLinkEmail({
      userId: context.userId,
      environment: data.environment,
      tenantId,
      idempotencySeed: seed,
    });
  });

/**
 * Sesja portalu na żądanie - woła ją strona wejścia z maila
 * (`/profile/portal`). Tożsamość WYŁĄCZNIE z sesji: adres z maila nie niesie
 * identyfikatora konta, więc nie ma czego podmienić.
 */
export const openMyBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { environment: "sandbox" | "live" }) =>
    z.object({ environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { resolveUserTenantId } = await import("@/lib/server/userTenant.server");
    const { createPortalLinkForUser } = await import("@/lib/billing/portalLink.server");
    const tenantId = await resolveUserTenantId(context.supabase, context.userId);
    return createPortalLinkForUser(context.userId, data.environment, { tenantId });
  });

/** Ponowna wysyłka wejścia do portalu z panelu administratora - własny najemca. */
export const resendPortalLinkForUser = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .validator((data: { userId: string; environment: "sandbox" | "live" }) =>
    z.object({ userId: z.string().uuid(), environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { assertCallerTenantMatchesHost } = await import("@/lib/server/callerTenant.server");
    const { sendPortalLinkEmail } = await import("@/lib/billing/portalLink.server");
    const tenantId = await assertCallerTenantMatchesHost(context.supabase, context.userId);
    // Administrator wysyła świadomie i zwykle po zgłoszeniu użytkownika -
    // każde kliknięcie ma dać nowy mail, więc ziarno jest unikalne.
    return sendPortalLinkEmail({
      userId: data.userId,
      environment: data.environment,
      tenantId,
      idempotencySeed: `admin:${Date.now()}`,
    });
  });

/** Faktura po numerze transakcji - użytkownik, tylko własne transakcje. */
export const fetchMyInvoiceByTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { transactionId: string; environment: "sandbox" | "live" }) =>
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

/**
 * Faktura po numerze transakcji - panel administratora (obsługa zgłoszeń).
 * Transakcja musi należeć do najemcy wołającego w podanym środowisku.
 */
export const fetchInvoiceByTransactionAsAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .validator((data: { transactionId: string; environment: "sandbox" | "live" }) =>
    z.object({ transactionId: transactionSchema, environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { assertCallerTenantMatchesHost } = await import("@/lib/server/callerTenant.server");
    const { invoiceUrlForTransaction } = await import("@/lib/billing/invoice.server");
    const tenantId = await assertCallerTenantMatchesHost(context.supabase, context.userId);
    return invoiceUrlForTransaction({
      transactionId: data.transactionId,
      environment: data.environment,
      tenantId,
    });
  });
