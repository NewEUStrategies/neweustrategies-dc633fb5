import { supabase } from "@/integrations/supabase/client";

/**
 * True when the current session was established with a password only (aal1) but
 * the account has a verified factor, so it can and should step up to aal2.
 */
export async function isMfaChallengeRequired(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.currentLevel === "aal1" && data.nextLevel === "aal2";
}

/** Id of the first verified TOTP factor on the account, or null if none. */
export async function getVerifiedTotpFactorId(): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return null;
  // listFactors().totp is already the verified TOTP subset.
  return data.totp[0]?.id ?? null;
}

/**
 * Challenge + verify a TOTP factor with a 6-digit code. Resolves on success and
 * (via supabase-js) upgrades the session to aal2; throws the supabase AuthError
 * on failure so callers can surface the message.
 */
export async function verifyTotpCode(factorId: string, code: string): Promise<void> {
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId,
  });
  if (challengeError || !challenge) {
    throw challengeError ?? new Error("MFA challenge failed");
  }
  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) throw verifyError;
}

/**
 * Supabase returns the TOTP QR as SVG markup; some builds already return a
 * `data:` URI. Normalise both into an `<img src>`-ready value.
 */
export function toQrDataUri(qr: string): string {
  return qr.startsWith("data:") ? qr : `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`;
}
