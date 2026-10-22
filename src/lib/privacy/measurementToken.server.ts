// Tokeny linków pomiaru otwarć i kliknięć (I9d-Y2): „Nie mierz moich otwarć
// i kliknięć" (stopka maili, preferencje) i „Zgadzam się na pomiar" (prośba
// o zgodę z panelu newslettera).
//
// WZORZEC `src/lib/newsletter/trackingToken.server.ts` i
// `newsletterKeepToken.server.ts`: HMAC-SHA256 tym samym sekretem serwera
// (`SESSION_SECRET`, awaryjnie klucz roli serwisowej - nigdy klucz publiczny
// ani stała), podpis 32 hex, porównanie w stałym czasie, WŁASNE prefiksy
// domeny HMAC - żaden token trackingu (`jm:`, para kampania:subskrybent),
// wypisu (`ju:`) ani „Chcę dalej otrzymywać" (`nk:`) nie przejdzie jako ten
// i odwrotnie. Podpis nie zawiera adresu e-mail (token jedzie w linku maila).
//
// WYCOFANIE (`mw:`): `w` + rodzaj podmiotu (`s` subskrybent | `l` kontakt CRM
// z maila ścieżki) + identyfikator (32 hex) + podpis = 66 znaków. Bez terminu
// ważności - jak link wypisu: stopka starego maila ma działać zawsze,
// a wycofanie jest idempotentne (powtórka = `already`). Wyciek tokenu
// pozwala co najwyżej WYŁĄCZYĆ pomiar tej osobie - mniej niż token wypisu.
//
// ZGODA (`mc:`): `c` + subskrybent (32 hex) + nonce prośby (32 hex) + termin
// (8 hex, sekundy epoki) + podpis = 105 znaków. Zgoda działa w drugą stronę
// niż wycofanie, więc ma JEDNORAZOWOŚĆ (nonce prośby w bazie,
// `newsletter_measurement_confirm`) i TERMIN (podpis) - link z prośby sprzed
// miesięcy nie udziela zgody w nieskończoność.
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { newsletterMeasurementUrl, type MeasurementLang } from "./measurement";

const WITHDRAW_DOMAIN = "mw:";
const CONFIRM_DOMAIN = "mc:";
const SIG_HEX_LEN = 32;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WITHDRAW_RE = /^w([sl])([a-f0-9]{32})([a-f0-9]{32})$/i;
const CONFIRM_RE = /^c([a-f0-9]{32})([a-f0-9]{32})([a-f0-9]{8})([a-f0-9]{32})$/i;

/** Ważność linku zgody z prośby (dni). Nonce prośby i tak jest jednorazowy. */
export const MEASUREMENT_CONFIRM_TOKEN_TTL_DAYS = 60;

function getSecret(): string {
  return process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function sign(input: string): string {
  return bytesToHex(hmac(sha256, utf8ToBytes(getSecret()), utf8ToBytes(input))).slice(
    0,
    SIG_HEX_LEN,
  );
}

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

/** Podmiot wycofania: subskrybent newslettera albo kontakt CRM (mail ścieżki). */
export type MeasurementSubject =
  { kind: "subscriber"; subscriberId: string } | { kind: "lead"; leadId: string };

function subjectCode(subject: MeasurementSubject): { code: "s" | "l"; id: string } {
  return subject.kind === "subscriber"
    ? { code: "s", id: subject.subscriberId }
    : { code: "l", id: subject.leadId };
}

/** Token „Nie mierz moich otwarć i kliknięć" albo wyjątek przy złych danych. */
export function signMeasurementWithdrawToken(subject: MeasurementSubject): string {
  const { code, id } = subjectCode(subject);
  if (!UUID_RE.test(id)) throw new Error("measurement token: identyfikator musi być UUID");
  const lower = id.toLowerCase();
  return `w${code}${compact(lower)}${sign(`${WITHDRAW_DOMAIN}${code}:${lower}`)}`;
}

/**
 * Adres „Nie mierz moich otwarć i kliknięć" do stopki maila albo `null`, gdy
 * identyfikator podmiotu nie jest UUID - mail wychodzi wtedy bez tej linii
 * (link, który nic nie zrobi, byłby gorszy), zamiast przerywać wysyłkę.
 */
export function measurementOptOutUrl(
  origin: string,
  subject: MeasurementSubject,
  lang?: MeasurementLang,
): string | null {
  const { id } = subjectCode(subject);
  if (!UUID_RE.test(id)) return null;
  return newsletterMeasurementUrl(origin, signMeasurementWithdrawToken(subject), lang);
}

export interface MeasurementConfirmTokenInput {
  subscriberId: string;
  nonce: string;
  expiresAt: Date;
}

/** Token „Zgadzam się na pomiar" (prośba z panelu) albo wyjątek przy złych danych. */
export function signMeasurementConfirmToken(input: MeasurementConfirmTokenInput): string {
  if (!UUID_RE.test(input.subscriberId) || !UUID_RE.test(input.nonce)) {
    throw new Error("measurement token: subscriberId i nonce muszą być UUID");
  }
  const seconds = Math.floor(input.expiresAt.getTime() / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 0xffffffff) {
    throw new Error("measurement token: termin poza zakresem");
  }
  const subscriber = input.subscriberId.toLowerCase();
  const nonce = input.nonce.toLowerCase();
  const expiresHex = seconds.toString(16).padStart(8, "0");
  return `c${compact(subscriber)}${compact(nonce)}${expiresHex}${sign(
    `${CONFIRM_DOMAIN}${subscriber}:${nonce}:${expiresHex}`,
  )}`;
}

export type MeasurementTokenCheck =
  | { ok: true; action: "withdraw"; subject: MeasurementSubject }
  | { ok: true; action: "confirm"; subscriberId: string; nonce: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Weryfikacja bez dostępu do bazy: rodzaj akcji wynika z kształtu i podpisu
 * (domeny HMAC są rozłączne). Najpierw podpis, potem termin - `expired`
 * widzi tylko posiadacz PRAWDZIWEGO linku.
 */
export function verifyMeasurementToken(
  token: string | null | undefined,
  now: Date = new Date(),
): MeasurementTokenCheck {
  if (!token) return { ok: false, reason: "invalid" };
  const withdraw = WITHDRAW_RE.exec(token);
  if (withdraw) {
    const code = withdraw[1].toLowerCase() as "s" | "l";
    const id = expand(withdraw[2]);
    if (!constantTimeEqual(withdraw[3].toLowerCase(), sign(`${WITHDRAW_DOMAIN}${code}:${id}`))) {
      return { ok: false, reason: "invalid" };
    }
    return {
      ok: true,
      action: "withdraw",
      subject:
        code === "s" ? { kind: "subscriber", subscriberId: id } : { kind: "lead", leadId: id },
    };
  }
  const confirm = CONFIRM_RE.exec(token);
  if (!confirm) return { ok: false, reason: "invalid" };
  const subscriberId = expand(confirm[1]);
  const nonce = expand(confirm[2]);
  const expiresHex = confirm[3].toLowerCase();
  if (
    !constantTimeEqual(
      confirm[4].toLowerCase(),
      sign(`${CONFIRM_DOMAIN}${subscriberId}:${nonce}:${expiresHex}`),
    )
  ) {
    return { ok: false, reason: "invalid" };
  }
  const expiresAt = new Date(Number.parseInt(expiresHex, 16) * 1000);
  if (expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, action: "confirm", subscriberId, nonce, expiresAt };
}
