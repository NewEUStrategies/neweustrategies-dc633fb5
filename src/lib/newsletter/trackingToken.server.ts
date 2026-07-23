// Token trackingu newslettera (open/click) - ODDZIELNY od tokenu wypisu.
//
// Wcześniej pixel/link trackingowy niósł `unsubscribe_token` subskrybenta (ten
// sam, który wypisuje). URL-e trackingu wyciekają strukturalnie (logi proxy
// pocztowych, nagłówek Referer, przesłane dalej maile, historia przeglądarki),
// więc posiadacz takiego URL-a mógł POST-ować /unsubscribe i wypisać odbiorcę
// (griefing) - konflacja identyfikatora telemetrycznego z tokenem AKCJI.
//
// Teraz token trackingu to podpisana HMAC-em para (kampania, subskrybent):
//   token = "<subscriberId>.<sigHex>",  sig = HMAC-SHA256(secret, `${campaignId}:${subscriberId}`)
// Jest per-kampania, weryfikowalny serwerowo i NIE da się nim wypisać
// (unsubscribe dalej wymaga osobnego unsubscribe_token). Wyciek tokenu trackingu
// pozwala co najwyżej sfałszować zdarzenie open/click, nie wypisać odbiorcy.
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIG_HEX_LEN = 32; // 16 bajtów (128 bitów) - w zupełności wystarcza jako tag.

/**
 * Sekret HMAC. Wyłącznie prawdziwe sekrety serwerowe - NIE klucz publiczny
 * (publishable) ani stała, żeby tokenów nie dało się odtworzyć poza serwerem.
 * SUPABASE_SERVICE_ROLE_KEY jest zawsze obecny server-side, więc podpis jest
 * dostępny nawet bez skonfigurowanego SESSION_SECRET.
 */
function getSecret(): string {
  return process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function computeSig(campaignId: string, subscriberId: string): string {
  return bytesToHex(
    hmac(sha256, utf8ToBytes(getSecret()), utf8ToBytes(`${campaignId}:${subscriberId}`)),
  ).slice(0, SIG_HEX_LEN);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/** Podpisany, per-kampania token trackingu dla danego subskrybenta. */
export function signTrackingToken(campaignId: string, subscriberId: string): string {
  return `${subscriberId}.${computeSig(campaignId, subscriberId)}`;
}

/**
 * Weryfikuje token trackingu wobec campaignId. Zwraca subscriberId, jeśli
 * podpis jest ważny (porównanie w stałym czasie), inaczej null. Tokeny starych
 * kampanii (format hex unsubscribe_token) nie przejdą - tracking degraduje się
 * łagodnie (telemetria best-effort), a wypis pozostaje na osobnym tokenie.
 */
export function verifyTrackingToken(campaignId: string, token: string | null): string | null {
  if (!token || !UUID_RE.test(campaignId)) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const subscriberId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!UUID_RE.test(subscriberId)) return null;
  if (sig.length !== SIG_HEX_LEN || !/^[a-f0-9]+$/i.test(sig)) return null;
  const expected = computeSig(campaignId, subscriberId);
  return constantTimeEqual(sig.toLowerCase(), expected) ? subscriberId : null;
}
