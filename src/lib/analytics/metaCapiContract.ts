// Kontrakt API konwersji Meta (Conversions API, CAPI) - wspólny dla
// przeglądarki i serwera, bez zależności od przeglądarki i od bazy.
//
// PO CO. Każde zdarzenie piksela (także PageView) wychodzi DWA RAZY: z
// przeglądarki (`fbq`) i z naszego serwera (CAPI). Oba egzemplarze niosą ten
// sam `event_name` + `event_id`, więc Meta liczy je raz (deduplikacja do 48 h),
// a zdarzenie zgubione przez bloker reklam albo zamkniętą kartę dociera z
// serwera. To podnosi „pokrycie zdarzeń piksela przez API konwersji".
//
// ZGODA. Kopia serwerowa wychodzi wyłącznie po zgodzie marketingowej -
// przeglądarka sprawdza ją przed kolejkowaniem i przed wysyłką, a serwer
// ponownie z ciasteczka decyzji (`nes_cookie_consent`) i sygnału GPC. Meta nie
// ma ścieżki „bez zgody" dla CAPI, więc brak zgody = brak wysyłki.
//
// DANE. Bez danych osobowych z formularzy: tylko parametry zdarzenia (jak w
// pikselu), identyfikatory przeglądarki Meta `_fbp`/`_fbc` (niehaszowane, jak
// wymaga Meta) oraz adres IP i User-Agent odczytane przez serwer z żądania.
//
// Ten moduł jest bez `zod` (jedzie z kolejką przeglądarki); walidacja wejścia
// serwera żyje w `metaCapiSchema.ts`.
import type { MetaCapiBatch, MetaCapiCustomData } from "./metaCapiSchema";

export type { MetaCapiBatch, MetaCapiCustomData, MetaCapiEvent } from "./metaCapiSchema";

/** Zdarzenia standardowe wysyłane przez piksel i lustrzanie przez CAPI. */
export const META_STANDARD_EVENTS = [
  "PageView",
  "Lead",
  "CompleteRegistration",
  "InitiateCheckout",
  "ViewContent",
  "Search",
  "AddToCart",
  "Purchase",
  "Subscribe",
  "Donate",
  "SubmitApplication",
  "Contact",
  "AddPaymentInfo",
  "AddToWishlist",
  "StartTrial",
  "Schedule",
] as const;

export type MetaStandardEventName = (typeof META_STANDARD_EVENTS)[number];

/** Maksymalna liczba zdarzeń w jednym żądaniu przeglądarki do serwera. */
export const META_CAPI_MAX_BATCH = 10;
/** Meta odrzuca zdarzenia witryny starsze niż 7 dni. */
export const META_CAPI_MAX_AGE_S = 7 * 24 * 60 * 60;
/** Tolerancja zegara przeglądarki „w przyszłość". */
export const META_CAPI_FUTURE_SKEW_S = 5 * 60;
/** Wersja Graph API zgodna z konfiguracją połączenia Meta. */
export const META_GRAPH_VERSION = "v26.0";

/** Identyfikator zdarzenia - ten sam, który dostał `fbq(..., {eventID})`. */
export const META_EVENT_ID_RE = /^[A-Za-z0-9_-]{8,160}$/;
/** `_fbp`: `fb.<subdomain>.<creation ms>.<random>`. */
export const META_FBP_RE = /^fb\.\d\.\d{10,16}\.\d{1,20}$/;
/** `_fbc`: `fb.<subdomain>.<creation ms>.<fbclid>`. */
export const META_FBC_RE = /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_-]{1,500}$/;

// ---------------- Przeglądarka: identyfikatory Meta ----------------

function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * `_fbp`/`_fbc` z ciasteczek piksela. Gdy `_fbc` jeszcze nie powstał (pierwsza
 * odsłona po kliknięciu reklamy), budujemy go z `fbclid` tak, jak robi to
 * piksel. Niepoprawne wartości odpadają - serwer i tak je odrzuci.
 */
export function readMetaBrowserIds(
  cookieHeader: string,
  fbclid: string | null,
  nowMs: number,
): { fbp?: string; fbc?: string } {
  const out: { fbp?: string; fbc?: string } = {};
  const fbp = readCookie(cookieHeader, "_fbp");
  if (fbp && META_FBP_RE.test(fbp)) out.fbp = fbp;
  const fbc = readCookie(cookieHeader, "_fbc");
  if (fbc && META_FBC_RE.test(fbc)) {
    out.fbc = fbc;
  } else if (fbclid) {
    const built = `fb.1.${Math.floor(nowMs)}.${fbclid}`;
    if (META_FBC_RE.test(built)) out.fbc = built;
  }
  return out;
}

/** Adres źródła bez zapytania i fragmentu - bez parametrów, które mogą nieść dane osobowe. */
export function metaEventSourceUrl(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

// ---------------- Serwer: zgoda i ładunek ----------------

const CONSENT_COOKIE = "nes_cookie_consent";
const CONSENT_VERSION = 2;

/**
 * Czy ciasteczko decyzji niesie zgodę marketingową. Sygnał GPC (nagłówek
 * `Sec-GPC: 1` albo ciasteczko `nes_gpc`) wygrywa, chyba że zgoda została
 * udzielona świadomie przy widocznej nocie o GPC (`gpcOverrideAt`) - ta sama
 * reguła co `hasCategoryConsent` w przeglądarce.
 */
export function hasMarketingConsentCookie(
  cookieHeader: string | null,
  gpcActive: boolean,
): boolean {
  if (!cookieHeader) return false;
  const raw = readCookie(cookieHeader, CONSENT_COOKIE);
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    const record = parsed as {
      version?: unknown;
      categories?: { marketing?: unknown } | null;
      gpcOverrideAt?: unknown;
    };
    if (record.version !== CONSENT_VERSION) return false;
    if (record.categories?.marketing !== true) return false;
    if (gpcActive) {
      const at = record.gpcOverrideAt;
      return typeof at === "number" && Number.isFinite(at) && at > 0;
    }
    return true;
  } catch {
    return false;
  }
}

/** Czas zdarzenia w oknie akceptowanym przez Meta; poza nim - czas serwera. */
export function clampMetaEventTime(eventTime: number, nowS: number): number {
  if (eventTime > nowS + META_CAPI_FUTURE_SKEW_S) return nowS;
  if (eventTime < nowS - META_CAPI_MAX_AGE_S + 60) return nowS;
  return Math.min(eventTime, nowS);
}

export interface MetaCapiRequestContext {
  clientIp: string | null;
  userAgent: string;
  nowS: number;
  testEventCode?: string;
  /** Skróty SHA-256 kluczy dopasowania (zalogowany odwiedzający / kraj). */
  match?: { em?: string; externalId?: string; country?: string };
}

export interface MetaCapiPayload {
  data: Array<{
    event_name: MetaStandardEventName;
    event_time: number;
    event_id: string;
    action_source: "website";
    event_source_url: string;
    user_data: {
      client_user_agent: string;
      client_ip_address?: string;
      fbp?: string;
      fbc?: string;
      em?: string[];
      external_id?: string[];
      country?: string[];
    };
    custom_data?: MetaCapiCustomData;
  }>;
  partner_agent: "lovable";
  test_event_code?: string;
}

/** Ładunek `POST /<pixel>/events` - jeden wpis na zdarzenie przeglądarki. */
export function buildMetaCapiPayload(
  batch: MetaCapiBatch,
  ctx: MetaCapiRequestContext,
): MetaCapiPayload {
  const userData: MetaCapiPayload["data"][number]["user_data"] = {
    client_user_agent: ctx.userAgent,
    ...(ctx.clientIp ? { client_ip_address: ctx.clientIp } : {}),
    ...(batch.fbp ? { fbp: batch.fbp } : {}),
    ...(batch.fbc ? { fbc: batch.fbc } : {}),
    ...(ctx.match?.em ? { em: [ctx.match.em] } : {}),
    ...(ctx.match?.externalId ? { external_id: [ctx.match.externalId] } : {}),
    ...(ctx.match?.country ? { country: [ctx.match.country] } : {}),
  };
  const payload: MetaCapiPayload = {
    data: batch.events.map((event) => {
      const customData = event.custom_data;
      const hasCustom = customData !== undefined && Object.keys(customData).length > 0;
      return {
        event_name: event.event_name,
        event_time: clampMetaEventTime(event.event_time, ctx.nowS),
        event_id: event.event_id,
        action_source: "website" as const,
        event_source_url: event.event_source_url,
        user_data: { ...userData },
        ...(hasCustom ? { custom_data: customData } : {}),
      };
    }),
    partner_agent: "lovable",
  };
  if (ctx.testEventCode) payload.test_event_code = ctx.testEventCode;
  return payload;
}
