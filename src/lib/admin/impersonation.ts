// Klient impersonacji super_admin.
// 1) zapisuje aktualną sesję super admina w sessionStorage,
// 2) wymienia bieżącą sesję na sesję usera przez verifyOtp(magiclink token_hash),
// 3) ustawia flagę banera + przekierowuje do /profile,
// 4) przywracanie sesji super admina: setSession(original) + zamknięcie audytu.
import { supabase } from "@/integrations/supabase/client";
import { startImpersonation, endImpersonation } from "@/lib/admin/impersonation.functions";
import {
  IMPERSONATION_STORAGE_KEY,
  browserStorage,
  readStoredValue,
  removeStoredValue,
  writeStoredValue,
} from "@/lib/storageKeys";

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
    const raw = readStoredValue(browserStorage("session"), IMPERSONATION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ImpersonationState;
  } catch {
    return null;
  }
}

function setImpersonationState(state: ImpersonationState | null) {
  if (typeof window === "undefined") return;
  if (!state) removeStoredValue(browserStorage("session"), IMPERSONATION_STORAGE_KEY);
  else
    writeStoredValue(browserStorage("session"), IMPERSONATION_STORAGE_KEY, JSON.stringify(state));
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

/**
 * Powrót do sesji super admina.
 *
 * FAIL-CLOSED. `setSession` NIE rzuca przy porażce - oddaje `{ error }`
 * (wygasły albo unieważniony refresh token super admina). Wcześniej wynik nie
 * był czytany: stan i baner były czyszczone, a przeglądarka ZOSTAWAŁA
 * zalogowana jako podszywany użytkownik - bez banera, czyli bez żadnego
 * sygnału, że kolejne kliknięcia idą na cudze konto. Teraz nieudany powrót
 * kończy się lokalnym wylogowaniem (`scope: "local"` - tylko ta karta; globalne
 * unieważniłoby WSZYSTKIE sesje podszywanej osoby).
 *
 * Audyt zamyka wyłącznie aktor (`endImpersonation` filtruje po
 * `actor_user_id`), więc da się go zamknąć tylko po UDANYM powrocie; po
 * porażce wiersz zostaje otwarty - i to jest prawda o tym, co się stało.
 */
export async function stopImpersonation(): Promise<void> {
  const state = getImpersonationState();
  if (!state) return;
  let restored = false;
  try {
    const { error } = await supabase.auth.setSession(state.original);
    restored = !error;
  } catch {
    restored = false;
  }
  try {
    if (restored) {
      await endImpersonation({ data: { sessionId: state.sessionId } }).catch(() => undefined);
    } else {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    }
  } finally {
    setImpersonationState(null);
  }
}
