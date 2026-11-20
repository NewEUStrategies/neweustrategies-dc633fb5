// Podpis webhooków sygnałów - HMAC-SHA256 przez Web Crypto (przeglądarka,
// Node 20+ i workerd bez zależności).
//
// Nagłówek: `X-NES-Signature: t=<unix s>,v1=<hex>`, gdzie podpisywany jest
// napis `${t}.${surowe ciało}`. Odbiorca liczy ten sam HMAC swoim sekretem
// (`whsec_...`), porównuje w czasie stałym i odrzuca znaczniki starsze niż
// 5 minut - to chroni przed powtórzeniem przechwyconego żądania.

export const WEBHOOK_SIGNATURE_HEADER = "X-NES-Signature";
export const WEBHOOK_EVENT_HEADER = "X-NES-Event";
export const WEBHOOK_DELIVERY_HEADER = "X-NES-Delivery";
export const WEBHOOK_SIGNATURE_TOLERANCE_SEC = 300;

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signWebhookBody(
  secret: string,
  body: string,
  timestampSec: number,
): Promise<string> {
  const t = Math.floor(timestampSec);
  return `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`;
}

/** Weryfikacja po stronie odbiorcy (eksport dla dokumentacji i testów kontraktu). */
export async function verifyWebhookSignature(input: {
  secret: string;
  body: string;
  header: string | null | undefined;
  nowSec: number;
  toleranceSec?: number;
}): Promise<boolean> {
  const parts = new Map<string, string>();
  for (const piece of (input.header ?? "").split(",")) {
    const [key, ...rest] = piece.trim().split("=");
    if (key && rest.length > 0) parts.set(key, rest.join("="));
  }
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isFinite(t) || !v1) return false;
  const tolerance = input.toleranceSec ?? WEBHOOK_SIGNATURE_TOLERANCE_SEC;
  if (Math.abs(input.nowSec - t) > tolerance) return false;
  return timingSafeEqual(v1, await hmacHex(input.secret, `${t}.${input.body}`));
}
