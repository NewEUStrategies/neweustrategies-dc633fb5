// Kontrakt kopii serwerowej zdarzeń piksela X (X Conversion API).
//
// Każde zdarzenie wysłane z przeglądarki (`twq('event', id, { conversion_id })`)
// idzie też z serwera z TYM SAMYM `conversion_id`, więc X liczy parę raz.
// Moduł czysty (bez DOM, sieci i sekretów): wspólny dla przeglądarki
// (kolejka), walidacji granicy serwera i budowy ładunku.
import { X_EVENT_ID_RE, X_PIXEL_ID_RE } from "./xPixelId";

export { X_EVENT_ID_RE, X_PIXEL_ID_RE };

export const X_CAPI_API_VERSION = "12";
export const X_CAPI_MAX_BATCH = 10;
/** `conversion_id` przeglądarki: litery, cyfry i `_-.:` (identyfikatory zamówień i UUID). */
export const X_CONVERSION_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
/** Identyfikator kliknięcia reklamy X (parametr `twclid`). */
export const X_TWCLID_RE = /^[A-Za-z0-9_-]{8,512}$/;
/** Zdarzenia starsze niż 7 dni X odrzuca - nie wysyłamy ich wcale. */
export const X_CAPI_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface XCapiEvent {
  event_id: string;
  conversion_id: string;
  /** Moment zdarzenia w przeglądarce (ms od epoki). */
  occurred_at: number;
  event_source_url: string;
  value?: number;
  currency?: string;
}

export interface XCapiBatch {
  events: XCapiEvent[];
  twclid?: string;
}

/** Adres strony zdarzenia: tylko http(s), bez fragmentu; inaczej null. */
export function xEventSourceUrl(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    const out = url.toString();
    return out.length <= 2048 ? out : null;
  } catch {
    return null;
  }
}

function readCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/**
 * `twclid` z adresu strony wejścia, a gdy go nie ma - z ciasteczka `_twclid`,
 * które zapisuje piksel X (JSON `{"twclid":"…"}` albo sama wartość).
 */
export function readXClickId(cookieHeader: string, landingHref: string | null): string | undefined {
  if (landingHref) {
    try {
      const value = new URL(landingHref).searchParams.get("twclid");
      if (value && X_TWCLID_RE.test(value)) return value;
    } catch {
      /* nieczytelny adres */
    }
  }
  const raw = readCookie(cookieHeader, "_twclid");
  if (!raw) return undefined;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* zostaje surowa wartość */
  }
  try {
    const parsed: unknown = JSON.parse(decoded);
    if (parsed && typeof parsed === "object") {
      const value = (parsed as { twclid?: unknown }).twclid;
      return typeof value === "string" && X_TWCLID_RE.test(value) ? value : undefined;
    }
  } catch {
    /* nie JSON */
  }
  return X_TWCLID_RE.test(decoded) ? decoded : undefined;
}

export interface XCapiContext {
  clientIp: string | null;
  userAgent: string;
  nowMs: number;
  /** Zdarzenia, które ten najemca ma skonfigurowane - tylko te wychodzą. */
  allowedEventIds: ReadonlySet<string>;
}

export interface XCapiConversion {
  conversion_time: string;
  event_id: string;
  conversion_id: string;
  event_source_url: string;
  value?: string;
  price_currency?: string;
  identifiers: Array<Record<string, string>>;
}

/**
 * Ładunek `POST /12/measurement/conversions/<piksel>`. Odrzuca zdarzenia
 * spoza konfiguracji najemcy, zbyt stare i z przyszłości. Identyfikatory:
 * `twclid` (gdy jest) oraz para IP + User-Agent - bez danych kontaktowych.
 */
export function buildXCapiPayload(
  batch: XCapiBatch,
  ctx: XCapiContext,
): { conversions: XCapiConversion[] } {
  const identifier: Record<string, string> = { user_agent: ctx.userAgent };
  if (ctx.clientIp) identifier["ip_address"] = ctx.clientIp;
  if (batch.twclid) identifier["twclid"] = batch.twclid;
  const conversions: XCapiConversion[] = [];
  for (const event of batch.events) {
    if (!ctx.allowedEventIds.has(event.event_id)) continue;
    const age = ctx.nowMs - event.occurred_at;
    if (age > X_CAPI_MAX_AGE_MS || age < -60_000) continue;
    const conversion: XCapiConversion = {
      conversion_time: new Date(Math.min(event.occurred_at, ctx.nowMs)).toISOString(),
      event_id: event.event_id,
      conversion_id: event.conversion_id,
      event_source_url: event.event_source_url,
      identifiers: [{ ...identifier }],
    };
    if (event.value !== undefined && event.currency) {
      conversion.value = event.value.toFixed(2);
      conversion.price_currency = event.currency;
    }
    conversions.push(conversion);
  }
  return { conversions };
}
