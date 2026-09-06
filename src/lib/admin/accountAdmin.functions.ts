// Administracyjne operacje na CUDZYM koncie: odczyt statusu konta w warstwie
// auth (potwierdzenie e-maila, ostatnie logowanie, blokada, zaproszenie) oraz
// nieodwracalne usunięcie konta.
//
// Autoryzacja: requireAdmin (admin/super_admin w tenancie wywołującego) plus
// twarde sprawdzenie, że konto docelowe należy do tego samego tenanta - klucz
// serwisowy omija RLS, więc granica najemcy musi być sprawdzona jawnie.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";

const TargetSchema = z.object({ userId: z.string().uuid() });

/** Status konta w warstwie uwierzytelniania - do prezentacji w panelu. */
export type AdminAccountStatus = {
  exists: boolean;
  email: string | null;
  emailConfirmed: boolean;
  emailConfirmedAt: string | null;
  phoneConfirmed: boolean;
  lastSignInAt: string | null;
  createdAt: string | null;
  invitedAt: string | null;
  bannedUntil: string | null;
  providers: string[];
  hasMfa: boolean;
  invitationId: string | null;
  invitationStatus: string | null;
  /** Skrót stanu dla UI: active | pending_email | invited | banned | never_signed_in | missing */
  state: "active" | "pending_email" | "invited" | "banned" | "never_signed_in" | "missing";
};

export const getUserAccountStatus = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((input: unknown) => TargetSchema.parse(input))
  .handler(async ({ data, context }): Promise<AdminAccountStatus> => {
    // Granica najemcy: user-scoped klient (RLS) musi widzieć profil celu.
    const { data: target, error: targetError } = await context.supabase
      .from("profiles")
      .select("id")
      .eq("id", data.userId)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!target) throw new Error("Forbidden: user outside tenant");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authUser, error } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (error || !authUser?.user) {
      return {
        exists: false,
        email: null,
        emailConfirmed: false,
        emailConfirmedAt: null,
        phoneConfirmed: false,
        lastSignInAt: null,
        createdAt: null,
        invitedAt: null,
        bannedUntil: null,
        providers: [],
        hasMfa: false,
        invitationId: null,
        invitationStatus: null,
        state: "missing",
      };
    }

    const u = authUser.user;
    const raw = u as unknown as { banned_until?: string | null; invited_at?: string | null };
    const bannedUntil =
      raw.banned_until && new Date(raw.banned_until).getTime() > Date.now()
        ? raw.banned_until
        : null;

    let invitationId: string | null = null;
    let invitationStatus: string | null = null;
    let invitationSentAt: string | null = null;
    let invitationAutoAccepted = false;
    if (u.email) {
      const { data: inv } = await context.supabase
        .from("user_invitations")
        .select("id, status, sent_at, metadata")
        .ilike("email", u.email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      invitationId = inv?.id ?? null;
      invitationStatus = inv?.status ?? null;
      invitationSentAt = inv?.sent_at ?? null;
      const invitationMetadata = (inv?.metadata ?? {}) as Record<string, unknown>;
      invitationAutoAccepted = invitationMetadata.auto_accept === true;
    }

    const emailConfirmedAt = u.email_confirmed_at ?? null;
    const signedInAfterInvitation = Boolean(
      u.last_sign_in_at &&
        invitationSentAt &&
        new Date(u.last_sign_in_at).getTime() > new Date(invitationSentAt).getTime(),
    );
    // `auto_accept` zatwierdza przydzielenie konta przez administratora, ale nie
    // oznacza, że odbiorca użył linku aktywacyjnego. Starsze rekordy oznaczone
    // w ten sposób jako `accepted` pozostają zaproszeniem aż do pierwszego
    // logowania wykonanego po wysłaniu wiadomości.
    const invitationAccepted =
      invitationStatus === "accepted" && (!invitationAutoAccepted || signedInAfterInvitation);
    const hasPendingInvitation = Boolean(invitationId) && !invitationAccepted;
    const effectiveInvitationStatus = hasPendingInvitation ? "sent" : invitationStatus;
    const state: AdminAccountStatus["state"] = bannedUntil
      ? "banned"
      : hasPendingInvitation
        ? "invited"
      : !emailConfirmedAt
        ? raw.invited_at
          ? "invited"
          : "pending_email"
        : u.last_sign_in_at
          ? "active"
          : "never_signed_in";

    return {
      exists: true,
      email: u.email ?? null,
      emailConfirmed: Boolean(emailConfirmedAt),
      emailConfirmedAt,
      phoneConfirmed: Boolean(u.phone_confirmed_at),
      lastSignInAt: u.last_sign_in_at ?? null,
      createdAt: u.created_at ?? null,
      invitedAt: raw.invited_at ?? null,
      bannedUntil,
      providers: Array.isArray(u.app_metadata?.providers)
        ? (u.app_metadata.providers as string[])
        : u.app_metadata?.provider
          ? [String(u.app_metadata.provider)]
          : [],
      hasMfa: (u.factors ?? []).some((f) => f.status === "verified"),
      invitationId,
      invitationStatus: effectiveInvitationStatus,
      state,
    };
  });

const DeleteSchema = z.object({
  userId: z.string().uuid(),
  // Potwierdzenie adresem e-mail - świadome, nieodwracalne działanie.
  confirmEmail: z.string().min(3).max(320),
});

/**
 * Nieodwracalnie usuwa cudze konto. Kolejność jak przy samodzielnym usunięciu:
 * zamknięcie rozliczeń -> anonimizacja dowodów księgowych -> deleteUser.
 * Administrator nie może usunąć samego siebie.
 */
export const deleteUserAccount = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => DeleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (data.userId === context.userId) {
      throw new Error("Nie można usunąć własnego konta z panelu administratora.");
    }

    const { data: target, error: targetError } = await context.supabase
      .from("profiles")
      .select("id, email")
      .eq("id", data.userId)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!target) throw new Error("Forbidden: user outside tenant");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    const email = authUser?.user?.email ?? target.email ?? null;
    if (!email || email.trim().toLowerCase() !== data.confirmEmail.trim().toLowerCase()) {
      throw new Error("Potwierdzenie nie zgadza się z adresem e-mail konta.");
    }

    const { closeBillingForUser } = await import("@/lib/billing/accountClosure.server");
    await closeBillingForUser(data.userId, email);

    const { retainAccountingEvidence } = await import("@/lib/billing/accountingRetention.server");
    const retention = await retainAccountingEvidence(data.userId);

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (deleteError) throw new Error(`Nie udało się usunąć konta: ${deleteError.message}`);

    return {
      ok: true as const,
      retainedEvidence: retention.retainedTotal,
    };
  });
