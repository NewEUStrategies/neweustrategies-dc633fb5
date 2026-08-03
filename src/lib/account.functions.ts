// Server functions dla operacji na własnym koncie użytkownika (RODO).
// Uwierzytelnienie przez requireSupabaseAuth (token = własny użytkownik);
// twarde usunięcie idzie przez service role, bo klient nie ma prawa kasować
// wierszy auth.users.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DeleteAccountSchema = z.object({
  // Potwierdzenie hasłem = re-uwierzytelnienie tuż przed nieodwracalną akcją.
  password: z.string().min(1).max(200),
});

/**
 * Nieodwracalnie usuwa konto bieżącego użytkownika po ponownym potwierdzeniu
 * hasła. Kasowanie auth.users kaskaduje (ON DELETE CASCADE) na profiles,
 * bookmarks, follows, wyniki quizu itd. Zwraca się dopiero po faktycznym
 * usunięciu, żeby klient mógł wyczyścić sesję.
 *
 * Kolejność kroków jest częścią kontraktu i nie wolno jej zamienić:
 *   1. re-uwierzytelnienie hasłem,
 *   2. anulowanie subskrypcji u operatora (inaczej karta byłaby dalej
 *      obciążana za dostęp, którego już nie ma),
 *   3. anonimizacja zamówień (dowody księgowe muszą przeżyć konto -
 *      art. 74 ust. 2 uor w związku z art. 17 ust. 3 lit. b RODO),
 *   4. dopiero teraz `deleteUser`.
 * Każdy z kroków 2-3 rzuca przy awarii i przerywa usuwanie.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => DeleteAccountSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;

    const email = typeof claims.email === "string" ? claims.email : null;
    if (!email) {
      throw new Error("Nie można potwierdzić tożsamości konta.");
    }

    // Re-uwierzytelnienie: weryfikujemy hasło zanim skasujemy cokolwiek.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email,
      password: data.password,
    });
    if (reauthError) {
      throw new Error("Nieprawidłowe hasło.");
    }

    // Najpierw pieniądze: aktywna subskrypcja musi zostać anulowana u
    // operatora, zanim skasujemy konto - inaczej klient płaciłby dalej za
    // dostęp, którego już nie ma. Błąd tutaj przerywa usuwanie.
    const { closeBillingForUser } = await import("@/lib/billing/accountClosure.server");
    await closeBillingForUser(userId, email);

    // Potem księgi: zamówienia tracą dane osobowe, ale zostają jako dowód
    // (FK jest `ON DELETE SET NULL`, więc samo `deleteUser` już ich nie
    // zabiera - ten krok dokłada redakcję e-maila, metadanych i pseudonim).
    // Rzuca przy awarii; konto zostaje, bo dowodów nie da się odtworzyć.
    const { retainAccountingEvidence } = await import("@/lib/billing/accountingRetention.server");
    const retention = await retainAccountingEvidence(userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      throw new Error(`Nie udało się usunąć konta: ${deleteError.message}`);
    }

    // `retainedOrders` wraca do UI, żeby komunikat po usunięciu mówił wprost,
    // ile dowodów księgowych zostało w systemie - obowiązek informacyjny
    // z art. 12 RODO realizuje się liczbą, nie ogólnikiem.
    return { ok: true as const, retainedOrders: retention.retained };
  });

const ChangeEmailSchema = z.object({
  email: z.string().email().max(320),
  // Potwierdzenie hasłem = re-uwierzytelnienie przed zmianą adresu logowania
  // (spójnie z usuwaniem konta i zmianą hasła).
  password: z.string().min(1).max(200),
});

/**
 * Rozpoczyna zmianę adresu e-mail konta po ponownym potwierdzeniu hasła.
 * Supabase wysyła link potwierdzający na nowy adres; zmiana wchodzi w życie
 * dopiero po kliknięciu w niego.
 */
export const changeMyEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ChangeEmailSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, claims } = context;

    const currentEmail = typeof claims.email === "string" ? claims.email : null;
    if (!currentEmail) {
      throw new Error("Nie można potwierdzić tożsamości konta.");
    }
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: currentEmail,
      password: data.password,
    });
    if (reauthError) {
      throw new Error("Nieprawidłowe hasło.");
    }

    const { error } = await supabase.auth.updateUser({ email: data.email });
    if (error) {
      throw new Error(error.message);
    }
    return { ok: true as const };
  });
