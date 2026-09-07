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
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const TargetSchema = z.object({ userId: z.string().uuid() });

/**
 * Kody błędów tłumaczone w UI (i18n) - handler nigdy nie zwraca surowego,
 * technicznego komunikatu do administratora.
 */
export const ADMIN_ACCOUNT_ERROR = {
  outsideTenant: "ADMIN_ACCOUNT/OUTSIDE_TENANT",
  selfDelete: "ADMIN_ACCOUNT/SELF_DELETE",
  confirmMismatch: "ADMIN_ACCOUNT/CONFIRM_MISMATCH",
  lookupFailed: "ADMIN_ACCOUNT/LOOKUP_FAILED",
  deleteFailed: "ADMIN_ACCOUNT/DELETE_FAILED",
} as const;

/**
 * Granica najemcy sprawdzana jawnie: tenant wywołującego (klient RLS) musi być
 * równy tenantowi konta docelowego (klucz serwisowy). Nie polegamy na samej
 * widoczności RLS, bo brak wiersza może oznaczać zarówno inny tenant, jak i
 * chwilową niedostępność polityki - a admin dostawał wtedy mylący komunikat.
 */
async function assertSameTenant(
  supabase: SupabaseClient<Database>,
  callerId: string,
  targetId: string,
): Promise<{ email: string | null }> {
  const { data: caller, error: callerError } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", callerId)
    .maybeSingle();
  if (callerError) throw new Error(ADMIN_ACCOUNT_ERROR.lookupFailed);
  const callerTenant = caller?.tenant_id ?? null;
  if (!callerTenant) throw new Error(ADMIN_ACCOUNT_ERROR.outsideTenant);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: target, error: targetError } = await supabaseAdmin
    .from("profiles")
    .select("id, email, tenant_id")
    .eq("id", targetId)
    .maybeSingle();
  if (targetError) throw new Error(ADMIN_ACCOUNT_ERROR.lookupFailed);
  if (!target || target.tenant_id !== callerTenant) {
    throw new Error(ADMIN_ACCOUNT_ERROR.outsideTenant);
  }
  return { email: target.email ?? null };
}

type AccountStateInput = {
  bannedUntil: string | null;
  emailConfirmedAt: string | null;
  invitedAt: string | null;
  lastSignInAt: string | null;
  invitationId: string | null;
  invitationStatus: string | null;
  invitationSentAt: string | null;
  invitationAutoAccepted: boolean;
};

export function deriveAccountState(input: AccountStateInput): AdminAccountStatus["state"] {
  if (input.bannedUntil) return "banned";
  const signedInAfterInvitation = Boolean(
    input.lastSignInAt &&
    input.invitationSentAt &&
    new Date(input.lastSignInAt).getTime() - new Date(input.invitationSentAt).getTime() > 30_000,
  );
  const invitationAccepted =
    input.invitationStatus === "accepted" &&
    (!input.invitationAutoAccepted || signedInAfterInvitation);
  if (input.invitationId && !invitationAccepted) return "invited";
  if (!input.emailConfirmedAt) return input.invitedAt ? "invited" : "pending_email";
  return input.lastSignInAt ? "active" : "never_signed_in";
}

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
  invitationSendCount: number;
  /** Skrót stanu dla UI: active | pending_email | invited | banned | never_signed_in | missing */
  state: "active" | "pending_email" | "invited" | "banned" | "never_signed_in" | "missing";
};

export const getUserAccountStatus = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((input: unknown) => TargetSchema.parse(input))
  .handler(async ({ data, context }): Promise<AdminAccountStatus> => {
    // Granica najemcy sprawdzana jawnie (patrz assertSameTenant).
    await assertSameTenant(context.supabase, context.userId, data.userId);

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
        invitationSendCount: 0,
        state: "missing",
      };
    }

    const u = authUser.user;
    const bannedUntil =
      u.banned_until && new Date(u.banned_until).getTime() > Date.now() ? u.banned_until : null;

    let invitationId: string | null = null;
    let invitationStatus: string | null = null;
    let invitationSentAt: string | null = null;
    let invitationAutoAccepted = false;
    let invitationSendCount = 0;
    if (u.email) {
      const { data: inv } = await context.supabase
        .from("user_invitations")
        .select("id, status, sent_at, metadata, send_count")
        .ilike("email", u.email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      invitationId = inv?.id ?? null;
      invitationStatus = inv?.status ?? null;
      invitationSentAt = inv?.sent_at ?? null;
      invitationSendCount = inv?.send_count ?? 0;
      const invitationMetadata = (inv?.metadata ?? {}) as Record<string, unknown>;
      invitationAutoAccepted = invitationMetadata.auto_accept === true;
    }

    const emailConfirmedAt = u.email_confirmed_at ?? null;
    // `auto_accept` zatwierdza przydzielenie konta przez administratora, ale nie
    // oznacza, że odbiorca użył linku aktywacyjnego. Starsze rekordy oznaczone
    // w ten sposób jako `accepted` pozostają zaproszeniem aż do pierwszego
    // logowania wykonanego po wysłaniu wiadomości.
    const state = deriveAccountState({
      bannedUntil,
      emailConfirmedAt,
      invitedAt: u.invited_at ?? null,
      lastSignInAt: u.last_sign_in_at ?? null,
      invitationId,
      invitationStatus,
      invitationSentAt,
      invitationAutoAccepted,
    });
    const effectiveInvitationStatus = state === "invited" ? "sent" : invitationStatus;

    return {
      exists: true,
      email: u.email ?? null,
      emailConfirmed: Boolean(emailConfirmedAt),
      emailConfirmedAt,
      phoneConfirmed: Boolean(u.phone_confirmed_at),
      lastSignInAt: u.last_sign_in_at ?? null,
      createdAt: u.created_at ?? null,
      invitedAt: u.invited_at ?? null,
      bannedUntil,
      providers: Array.isArray(u.app_metadata?.providers)
        ? (u.app_metadata.providers as string[])
        : u.app_metadata?.provider
          ? [String(u.app_metadata.provider)]
          : [],
      hasMfa: (u.factors ?? []).some((f) => f.status === "verified"),
      invitationId,
      invitationStatus: effectiveInvitationStatus,
      invitationSendCount,
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
      throw new Error(ADMIN_ACCOUNT_ERROR.selfDelete);
    }

    const target = await assertSameTenant(context.supabase, context.userId, data.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    const email = authUser?.user?.email ?? target.email ?? null;

    if (!email || email.trim().toLowerCase() !== data.confirmEmail.trim().toLowerCase()) {
      throw new Error(ADMIN_ACCOUNT_ERROR.confirmMismatch);
    }

    const { closeBillingForUser } = await import("@/lib/billing/accountClosure.server");
    await closeBillingForUser(data.userId, email);

    const { retainAccountingEvidence } = await import("@/lib/billing/accountingRetention.server");
    const retention = await retainAccountingEvidence(data.userId);

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (deleteError) {
      console.error("[deleteUserAccount] deleteUser failed", {
        userId: data.userId,
        message: deleteError.message,
      });
      throw new Error(ADMIN_ACCOUNT_ERROR.deleteFailed);
    }

    return {
      ok: true as const,
      retainedEvidence: retention.retainedTotal,
    };
  });
