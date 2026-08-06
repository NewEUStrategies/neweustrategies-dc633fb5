// Podmiot limitu żądań dla publicznych endpointów - bez surowego IP w bazie.
//
// Publiczne bramki (darowizna bez konta, formularze) muszą mieć kubełek per
// dzwoniący, ale `rate_limits` nie jest miejscem na dane osobowe: wyciek tej
// tabeli nie może dać listy adresów IP ani identyfikatorów kont. Zapisujemy
// więc solony skrót, dokładnie jak strażnik logowania
// (`auth/bruteforce.functions.ts`).
//
// SHA-256 z `@noble/hashes` (a nie `node:crypto`) - ta sama biblioteka, której
// używa lektor kanoniczny: działa w każdym runtime, w którym stoi worker.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { clientIpFromHeaders } from "@/lib/http/rateLimit";

const SALT = () =>
  process.env.SESSION_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "rate-subject-fallback-salt";

/** `kind:hash` - prefiks zostaje jawny, żeby dało się czytać metryki scope'u. */
function hashedRateSubject(kind: string, raw: string): string {
  return `${kind}:${bytesToHex(sha256(utf8ToBytes(`${SALT()}|${kind}|${raw}`))).slice(0, 32)}`;
}

/**
 * Podmiot limitu dla bieżącego żądania: zalogowany użytkownik ma własny kubełek
 * (nie dzieli go z NAT-em biura), anonim - kubełek per adres.
 * `cf-connecting-ip` wygrywa z `x-forwarded-for`, bo za Cloudflare tylko on
 * jest nagłówkiem, którego klient nie podrobi.
 */
export function requestRateSubject(
  headers: Headers | null | undefined,
  userId?: string | null,
): string {
  if (userId) return hashedRateSubject("user", userId);
  if (!headers) return hashedRateSubject("ip", "unknown");
  const ip = headers.get("cf-connecting-ip")?.trim() || clientIpFromHeaders(headers);
  return hashedRateSubject("ip", ip);
}
