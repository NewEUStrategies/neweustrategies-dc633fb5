// Start impersonacji super_admin (kroki 1-3 z nagłówka `impersonation.ts`):
// zapis sesji super admina, wymiana sesji przez verifyOtp(magiclink token_hash)
// i flaga banera. Powrót do sesji super admina żyje w `impersonation.ts`.
//
// OSOBNY MODUŁ, CELOWO (chunk startowy, roadmapa ładowania §9.1 J3).
// `impersonation.ts` czyta baner impersonacji w powłoce każdej strony, więc
// siedzi w `app-initial`; start woła wyłącznie panel użytkowników.
// `impersonation.ts` NIE importuje stąd niczego - także reeksportem.
import { supabase } from "@/integrations/supabase/client";
import { startImpersonation, endImpersonation } from "@/lib/admin/impersonation.functions";
import { setImpersonationState } from "@/lib/admin/impersonation";

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
