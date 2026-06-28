// Klient impersonacji super_admin.
// 1) zapisuje aktualną sesję super admina w sessionStorage,
// 2) wymienia bieżącą sesję na sesję usera przez verifyOtp(magiclink token_hash),
// 3) ustawia flagę banera + przekierowuje do /profile,
// 4) przywracanie sesji super admina: setSession(original) + zamknięcie audytu.
import { supabase } from "@/integrations/supabase/client";
import { startImpersonation, endImpersonation } from "@/lib/admin/impersonation.functions";

const STORAGE_KEY = "lovable:impersonation";

export interface ImpersonationState {
  sessionId: string;
  targetUserId: string;
  targetLabel: string;
  original: {
    access_token: string;
    refresh_token: string;
  };
}

export function getImpersonationState(): ImpersonationState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ImpersonationState;
  } catch {
    return null;
  }
}

function setImpersonationState(state: ImpersonationState | null) {
  if (typeof window === "undefined") return;
  if (!state) window.sessionStorage.removeItem(STORAGE_KEY);
  else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function impersonateUser(targetUserId: string, targetLabel: string): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) throw new Error("Brak aktywnej sesji - zaloguj się ponownie.");

  const result = await startImpersonation({ data: { targetUserId } });

  const { error: otpErr } = await supabase.auth.verifyOtp({
    token_hash: result.tokenHash,
    type: "magiclink",
  });
  if (otpErr) {
    // best-effort: zamknij audyt
    await endImpersonation({ data: { sessionId: result.sessionId } }).catch(() => undefined);
    throw new Error(otpErr.message);
  }

  setImpersonationState({
    sessionId: result.sessionId,
    targetUserId,
    targetLabel,
    original: {
      access_token: sess.session.access_token,
      refresh_token: sess.session.refresh_token,
    },
  });
}

export async function stopImpersonation(): Promise<void> {
  const state = getImpersonationState();
  if (!state) return;
  try {
    await supabase.auth.setSession(state.original);
  } finally {
    await endImpersonation({ data: { sessionId: state.sessionId } }).catch(() => undefined);
    setImpersonationState(null);
  }
}
