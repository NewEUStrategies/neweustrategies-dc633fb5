/** Map untrusted provider failures to a small, translated public vocabulary. */
export function publicAuthError(error: unknown) {
  const record = typeof error === "object" && error !== null ? error : {};
  const code = "code" in record && typeof record.code === "string" ? record.code : "";
  const message = "message" in record && typeof record.message === "string" ? record.message : "";
  const value = `${code} ${message}`.toLowerCase();
  if (/rate_limit|too many|over_email_send_rate_limit/.test(value)) return "rateLimited";
  if (/invalid_credentials|invalid login credentials/.test(value)) return "invalidCredentials";
  if (/email_not_confirmed|email not confirmed/.test(value)) return "emailNotConfirmed";
  if (/user_already_exists|email_exists|user already registered/.test(value)) return "emailInUse";
  if (/weak_password|password should be|password.*too short/.test(value)) return "weakPassword";
  if (/signup_disabled|signups? (is |are )?disabled/.test(value)) return "signupDisabled";
  if (/invalid_input|email_address_invalid/.test(value)) return "invalidInput";
  return "unavailable";
}
