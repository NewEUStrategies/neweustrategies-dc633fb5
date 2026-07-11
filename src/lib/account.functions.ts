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
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteAccountSchema.parse(input))
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      throw new Error(`Nie udało się usunąć konta: ${deleteError.message}`);
    }

    return { ok: true as const };
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
  .inputValidator((input: unknown) => ChangeEmailSchema.parse(input))
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
