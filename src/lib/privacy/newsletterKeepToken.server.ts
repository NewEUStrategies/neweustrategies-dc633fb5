// Token linku „Chcę dalej otrzymywać" w prośbie o potwierdzenie subskrypcji
// (wygaszanie nieaktywnych subskrybentów, I9d-Y1, Z-I9c-08).
//
// WZORZEC `src/lib/newsletter/trackingToken.server.ts`: HMAC-SHA256 tym samym
// sekretem serwera (`SESSION_SECRET`, awaryjnie klucz roli serwisowej - nigdy
// klucz publiczny ani stała), podpis 32 hex, porównanie w stałym czasie,
// WŁASNY prefiks domeny HMAC `nk:` - żaden token trackingu (`jm:`, para
// kampania:subskrybent) ani wypisu (`ju:`) nie przejdzie jako ten i odwrotnie.
//
// CO PODPISUJE. Trójkę (subskrybent, nonce cyklu, termin ważności):
//   * nonce wydaje baza przy założeniu cyklu (`newsletter_sunset_requests`)
//     i kasuje przy pierwszym użyciu (`newsletter_sunset_keep`) - to daje
//     JEDNORAZOWOŚĆ (powtórka = `already`), a nowy cykl = nowy nonce, więc link
//     z poprzedniej prośby niczego nie odnawia;
//   * termin daje WYGAŚNIĘCIE bez zapytania do bazy - GET trasy publicznej
//     sprawdza podpis i termin, niczego nie czytając ani nie zmieniając.
// Podpis nie zawiera adresu e-mail: token jedzie w linku maila (logi bramek
// pocztowych, przekazana wiadomość), więc nie może ujawniać odbiorcy.
//
// KSZTAŁT: jeden nieprzezroczysty napis (jak token wypisu ścieżki `j…`)
//   `k` + subskrybent (32 hex) + nonce (32 hex) + termin (8 hex, sekundy
//   epoki) + podpis (32 hex) = 105 znaków [0-9a-f], bezpieczny w adresie.
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const KEEP_DOMAIN = "nk:";
const SIG_HEX_LEN = 32; // 16 bajtów - jak tokeny trackingu.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEEP_RE = /^k([a-f0-9]{32})([a-f0-9]{32})([a-f0-9]{8})([a-f0-9]{32})$/i;

/** Sekret HMAC - ta sama reguła co tokeny trackingu (serwer, nigdy klient). */
function getSecret(): string {
  return process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function keepSig(subscriberId: string, nonce: string, expiresHex: string): string {
  return bytesToHex(
    hmac(
      sha256,
      utf8ToBytes(getSecret()),
      utf8ToBytes(`${KEEP_DOMAIN}${subscriberId}:${nonce}:${expiresHex}`),
    ),
  ).slice(0, SIG_HEX_LEN);
}

/** Porównanie w stałym czasie (długość podpisu jest stała i jawna). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function compact(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

function expand(hex: string): string {
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface NewsletterKeepTokenInput {
  subscriberId: string;
  nonce: string;
  /** Koniec ważności linku. */
  expiresAt: Date;
}

/** Podpisany token linku albo wyjątek przy złych danych (błąd wywołującego). */
export function signNewsletterKeepToken(input: NewsletterKeepTokenInput): string {
  if (!UUID_RE.test(input.subscriberId) || !UUID_RE.test(input.nonce)) {
    throw new Error("newsletter keep token: subscriberId i nonce muszą być UUID");
  }
  const seconds = Math.floor(input.expiresAt.getTime() / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 0xffffffff) {
    throw new Error("newsletter keep token: termin poza zakresem");
  }
  const subscriber = compact(input.subscriberId);
  const nonce = compact(input.nonce);
  const expiresHex = seconds.toString(16).padStart(8, "0");
  return `k${subscriber}${nonce}${expiresHex}${keepSig(input.subscriberId.toLowerCase(), input.nonce.toLowerCase(), expiresHex)}`;
}

export type NewsletterKeepTokenCheck =
  | { ok: true; subscriberId: string; nonce: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Weryfikacja bez dostępu do bazy. Kolejność ma znaczenie: najpierw podpis,
 * potem termin - `expired` ujawnia się tylko posiadaczowi PRAWDZIWEGO linku
 * (podrobiony token z przeszłą datą to `invalid`, nie wskazówka o formacie).
 */
export function verifyNewsletterKeepToken(
  token: string | null | undefined,
  now: Date = new Date(),
): NewsletterKeepTokenCheck {
  const match = token ? KEEP_RE.exec(token) : null;
  if (!match) return { ok: false, reason: "invalid" };
  const subscriberId = expand(match[1]);
  const nonce = expand(match[2]);
  const expiresHex = match[3].toLowerCase();
  if (!constantTimeEqual(match[4].toLowerCase(), keepSig(subscriberId, nonce, expiresHex))) {
    return { ok: false, reason: "invalid" };
  }
  const expiresAt = new Date(Number.parseInt(expiresHex, 16) * 1000);
  if (expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, subscriberId, nonce, expiresAt };
}

/** Czy napis ma kształt tokenu linku (bez weryfikacji podpisu). */
export function isNewsletterKeepToken(token: string | null | undefined): boolean {
  return Boolean(token && KEEP_RE.test(token));
}
