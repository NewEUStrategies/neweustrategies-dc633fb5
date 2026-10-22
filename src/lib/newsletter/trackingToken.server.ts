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

/**
 * Podpis pojedynczego linku w kampanii: HMAC(secret, `${campaignId}:${subscriberId}:${target}`).
 *
 * Token trackingu (`s`) jest per-subskrybent i mówi tylko KTO kliknął - nie
 * ogranicza DOKĄD prowadzi przekierowanie. Bez dodatkowego podpisu docelowego
 * URL-a /api/public/nl-click byłby otwartym przekierowaniem (phishing z naszej
 * domeny). `k` wiąże adres docelowy z konkretną wysyłką.
 */
export function signTrackingLink(campaignId: string, subscriberId: string, target: string): string {
  return bytesToHex(
    hmac(sha256, utf8ToBytes(getSecret()), utf8ToBytes(`${campaignId}:${subscriberId}:${target}`)),
  ).slice(0, SIG_HEX_LEN);
}

/** Czy `k` to prawidłowy podpis tego dokładnie adresu w tej kampanii. */
export function verifyTrackingLink(
  campaignId: string,
  subscriberId: string,
  target: string,
  sig: string | null,
): boolean {
  if (!sig || sig.length !== SIG_HEX_LEN) return false;
  return constantTimeEqual(sig.toLowerCase(), signTrackingLink(campaignId, subscriberId, target));
}

// ---------------------------------------------------------------------------
// Ścieżki komunikacji (S5): tracking 1:1 per wiadomość.
//
// Kampania ma parę (kampania, subskrybent); mail ścieżki ma JEDNĄ tożsamość -
// `message_id` (= deterministicMessageId("journey:{zapis}:{węzeł}")). Podpisy
// mają własne prefiksy domeny HMAC, więc żaden z nich nie zastąpi drugiego:
//   * `jm:`  - token trackingu (`m=<message_id>.<sig>`) i podpis linku
//              (`jm:<message_id>:<indeks>:<adres>`) - wyciek piksela pozwala
//              co najwyżej sfałszować otwarcie, nie wypisać odbiorcy;
//   * `ju:`  - token wypisu (RFC 8058) - jedyny, który zmienia zgodę.
// ---------------------------------------------------------------------------

const JOURNEY_TRACK_DOMAIN = "jm:";
const JOURNEY_UNSUB_DOMAIN = "ju:";

function journeySig(input: string): string {
  return bytesToHex(hmac(sha256, utf8ToBytes(getSecret()), utf8ToBytes(input))).slice(
    0,
    SIG_HEX_LEN,
  );
}

/** Token trackingu wiadomości ścieżki: `<message_id>.<sig>`. */
export function signJourneyMessageToken(messageId: string): string {
  return `${messageId}.${journeySig(`${JOURNEY_TRACK_DOMAIN}${messageId}`)}`;
}

/** `message_id` z ważnego tokenu trackingu albo `null` (porównanie w stałym czasie). */
export function verifyJourneyMessageToken(token: string | null): string | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const messageId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!UUID_RE.test(messageId)) return null;
  if (sig.length !== SIG_HEX_LEN || !/^[a-f0-9]+$/i.test(sig)) return null;
  return constantTimeEqual(sig.toLowerCase(), journeySig(`${JOURNEY_TRACK_DOMAIN}${messageId}`))
    ? messageId
    : null;
}

/**
 * Podpis linku w mailu ścieżki - wiąże adres DOCELOWY i numer linku z tą
 * wiadomością (ochrona przed otwartym przekierowaniem jak w kampaniach).
 */
export function signJourneyLink(messageId: string, target: string, index: number): string {
  return journeySig(`${JOURNEY_TRACK_DOMAIN}${messageId}:${index}:${target}`);
}

export function verifyJourneyLink(
  messageId: string,
  target: string,
  sig: string | null,
  index: number,
): boolean {
  if (!sig || sig.length !== SIG_HEX_LEN) return false;
  return constantTimeEqual(sig.toLowerCase(), signJourneyLink(messageId, target, index));
}

const JOURNEY_UNSUB_RE = /^j([a-f0-9]{32})([a-f0-9]{32})$/i;

/**
 * Token wypisu ze ścieżki: `j` + `message_id` bez myślników + podpis. Jeden
 * nieprzezroczysty napis, bo przechodzi przez tę samą stronę wypisu co token
 * subskrybenta (`/newsletter/unsubscribe?token=…`) - strona go tylko przekazuje.
 */
export function signJourneyUnsubscribeToken(messageId: string): string {
  return `j${messageId.replace(/-/g, "").toLowerCase()}${journeySig(`${JOURNEY_UNSUB_DOMAIN}${messageId}`)}`;
}

/** `message_id` z ważnego tokenu wypisu ścieżki albo `null`. */
export function verifyJourneyUnsubscribeToken(token: string | null): string | null {
  const match = token ? JOURNEY_UNSUB_RE.exec(token) : null;
  if (!match) return null;
  const hex = match[1].toLowerCase();
  const messageId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return constantTimeEqual(
    match[2].toLowerCase(),
    journeySig(`${JOURNEY_UNSUB_DOMAIN}${messageId}`),
  )
    ? messageId
    : null;
}

/** Czy napis ma kształt tokenu wypisu ścieżki (bez weryfikacji podpisu). */
export function isJourneyUnsubscribeToken(token: string | null): boolean {
  return Boolean(token && JOURNEY_UNSUB_RE.test(token));
}
