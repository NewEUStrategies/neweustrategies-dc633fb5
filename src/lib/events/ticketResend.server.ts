// Bramka listy wykluczeń przed ponowną wysyłką biletu.
//
// PO CO. Wydanie biletu rotuje kod QR (i klucz samoobsługi gościa) ZANIM mail
// wyjdzie, a mail na adres z listy wykluczeń nie wyjdzie wcale
// (`sendTxEmail` → `{ ok: false, skipped: "suppressed" }`). Ponowna wysyłka
// do takiego adresu unieważniała więc DZIAŁAJĄCY bilet bez zastępstwa - gość
// odbijał się od bramki z kodem, który jeszcze wczoraj wpuszczał, a przy
// „Wyślij bilety całej grupie" działo się to każdemu wypisanemu gościowi,
// który o nic nie prosił.
//
// PYTAMY TĄ SAMĄ BRAMKĄ, CO POCZTA. `checkSendAllowed` z kategorią
// `transactional` - dokładnie ta decyzja zapada potem w `sendTxEmail`
// (`event_ticket_issued` jest transakcyjny), więc wiersz, który tu przejdzie,
// dostanie mail, a zatrzymany tutaj - i tak by go nie dostał. Pusty adres
// bramka też zatrzymuje: wydanie nie miałoby dokąd wysłać kodu.
//
// FAIL-OPEN jak cała warstwa wykluczeń: awaria odczytu listy przepuszcza
// adres. Gorzej byłoby zablokować ponowną wysyłkę całej grupie z powodu
// chwilowego błędu bazy.
//
// Moduł server-only (klient service_role).
import type { Database } from "@/integrations/supabase/types";

/**
 * Wiersz zakresu z `admin_event_ticket_resend_scope`. ADRES NULL-OWALNY
 * POPRAWIONY: generator opisuje `RETURNS TABLE` jako niepuste, a
 * `event_people.email` bywa pusty (wpis organizatora bez adresu).
 */
export type TicketResendScopeRow = Omit<
  Database["public"]["Functions"]["admin_event_ticket_resend_scope"]["Returns"][number],
  "email"
> & { email: string | null };

/**
 * Identyfikatory wierszy zakresu, na których adres poczta NIE wyśle biletu.
 * Kolejność jak w zakresie. Pusty zakres nie pyta bazy wcale.
 */
export async function suppressedTicketRecipients(
  scope: readonly TicketResendScopeRow[],
): Promise<string[]> {
  if (scope.length === 0) return [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { checkSendAllowed } = await import("@/lib/email/suppression.server");
  const verdicts = await Promise.all(
    scope.map(async (row) => {
      const gate = await checkSendAllowed(supabaseAdmin, {
        email: row.email ?? "",
        category: "transactional",
        tenantId: row.tenant_id,
      });
      return gate.allowed ? null : row.registration_id;
    }),
  );
  return verdicts.filter((id): id is string => id !== null);
}
