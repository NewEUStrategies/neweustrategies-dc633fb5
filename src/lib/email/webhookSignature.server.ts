// Weryfikacja podpisu webhooka Resend (standard Svix / Standard Webhooks).
//
// Resend podpisuje każde wywołanie nagłówkami:
//   svix-id        - unikalny identyfikator dostawy (klucz idempotencji),
//   svix-timestamp - unix seconds,
//   svix-signature - lista podpisów "v1,<base64>" rozdzielona spacjami
//                    (kilka wpisów podczas rotacji sekretu).
// Podpisem jest HMAC-SHA256 nad `${id}.${timestamp}.${body}` kluczem będącym
// zdekodowanym base64 sekretem `whsec_...`.
//
// Bez tej weryfikacji endpoint byłby otwartym API do WPISYWANIA DOWOLNEGO
// ADRESU NA LISTĘ WYKLUCZEŃ - ktokolwiek mógłby po cichu odciąć redakcję od
// jej najważniejszych czytelników. Dlatego: podpis obowiązkowy, porównanie w
// stałym czasie, okno tolerancji na timestamp (anty-replay).
import { createHmac, timingSafeEqual } from "node:crypto";

/** Maksymalny wiek dostawy; Svix rekomenduje 5 minut w obie strony. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type VerifyResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: "missing_headers" | "bad_timestamp" | "expired" | "bad_secret" | "invalid_signature";
    };

/**
 * Odczytuje nagłówki podpisu, akceptując oba warianty nazw: prefiks `svix-`
 * (Resend dziś) i bezprefiksowy `webhook-` (Standard Webhooks) - dzięki temu
 * zmiana po stronie dostawcy nie wywala nam potoku.
 */
export function readWebhookHeaders(headers: Headers): WebhookHeaders {
  return {
    id: headers.get("svix-id") ?? headers.get("webhook-id"),
    timestamp: headers.get("svix-timestamp") ?? headers.get("webhook-timestamp"),
    signature: headers.get("svix-signature") ?? headers.get("webhook-signature"),
  };
}

/** Sekret `whsec_<base64>`; akceptujemy też surowy base64 bez prefiksu. */
function secretKey(secret: string): Buffer | null {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

function equalsConstantTime(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Weryfikuje podpis dostawy. `now` wstrzykiwane dla testów (domyślnie zegar).
 * Zwraca identyfikator dostawy - wołający używa go jako klucza idempotencji.
 */
export function verifyWebhookSignature(
  payload: string,
  headers: WebhookHeaders,
  secret: string,
  now: number = Date.now(),
): VerifyResult {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, error: "missing_headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return { ok: false, error: "bad_timestamp" };
  if (Math.abs(Math.floor(now / 1000) - ts) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, error: "expired" };
  }

  const key = secretKey(secret);
  if (!key) return { ok: false, error: "bad_secret" };

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");

  // Nagłówek niesie 1..n podpisów; wystarczy jeden pasujący (rotacja sekretu).
  const provided = signature
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.startsWith("v1,") ? part.slice(3) : part.includes(",") ? "" : part))
    .filter(Boolean);

  if (provided.length === 0) return { ok: false, error: "invalid_signature" };
  const match = provided.some((candidate) => equalsConstantTime(candidate, expected));
  return match ? { ok: true, id } : { ok: false, error: "invalid_signature" };
}
