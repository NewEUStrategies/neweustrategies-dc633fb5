// Zdarzenia standardowe piksela Meta (Lead, CompleteRegistration,
// InitiateCheckout, ViewContent) - jedyna droga wysyłki zdarzeń poza PageView.
//
// ZGODA. Zdarzenie wychodzi WYŁĄCZNIE, gdy: (1) odwiedzający ma zgodę
// marketingową, (2) `window.fbq` istnieje - piksel uruchamia tylko
// `ConsentScriptInjector` po tej zgodzie. Wycofanie zgody zatrzymuje wysyłkę
// bez przeładowania strony (`fbq('consent','revoke')` + ta bramka).
//
// MOMENT. Lead i CompleteRegistration wołamy PO potwierdzeniu zapisu przez
// serwer (te same miejsca co cele Google Ads), nigdy na samo kliknięcie.
//
// DANE. Bez danych osobowych: tylko wartość, waluta, identyfikatory treści
// i kategoria. Każde zdarzenie ma własny `eventID` - gdy kiedyś dojdzie
// wysyłka serwerowa (Conversions API), ten sam ID pozwoli Meta zdeduplikować.
import { hasCategoryConsent } from "@/lib/ads/consent";

export type MetaStandardEvent =
  | "Lead"
  | "CompleteRegistration"
  | "InitiateCheckout"
  | "ViewContent";

export interface MetaEventParams {
  value?: number;
  currency?: string;
  content_ids?: readonly string[];
  content_category?: string;
  num_items?: number;
}

type FbqFn = (...args: unknown[]) => void;

const CURRENCY_RE = /^[A-Z]{3}$/;
const MAX_CONTENT_IDS = 20;
const MAX_TEXT = 100;

function readFbq(): FbqFn | null {
  if (typeof window === "undefined") return null;
  const candidate: unknown = (window as Window & { fbq?: unknown }).fbq;
  return typeof candidate === "function" ? (candidate as FbqFn) : null;
}

function clip(value: string): string {
  return value.trim().slice(0, MAX_TEXT);
}

/** Czyści parametry: odrzuca niepoprawne kwoty, waluty i puste identyfikatory. */
export function sanitizeMetaParams(params: MetaEventParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof params.value === "number" && Number.isFinite(params.value) && params.value >= 0) {
    out["value"] = Math.round(params.value * 100) / 100;
  }
  const currency = params.currency?.trim().toUpperCase();
  if (currency && CURRENCY_RE.test(currency)) out["currency"] = currency;
  if (out["value"] !== undefined && out["currency"] === undefined) delete out["value"];
  const ids = (params.content_ids ?? [])
    .map(clip)
    .filter((id) => id.length > 0)
    .slice(0, MAX_CONTENT_IDS);
  if (ids.length > 0) out["content_ids"] = ids;
  if (params.content_category) {
    const category = clip(params.content_category);
    if (category) out["content_category"] = category;
  }
  if (typeof params.num_items === "number" && Number.isInteger(params.num_items) && params.num_items > 0) {
    out["num_items"] = params.num_items;
  }
  return out;
}

/** Unikalny identyfikator zdarzenia (deduplikacja przeglądarka/serwer). */
export function newMetaEventId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${clip(prefix).replace(/[^A-Za-z0-9_-]/g, "_")}_${random}`;
}

/**
 * Wysyła zdarzenie standardowe do piksela Meta. Zwraca `true`, gdy zdarzenie
 * zostało przekazane do `fbq`; `false`, gdy bramka zgody/piksela je zatrzymała.
 */
export function trackMetaEvent(
  name: MetaStandardEvent,
  params: MetaEventParams = {},
  eventId?: string,
): boolean {
  if (!hasCategoryConsent("marketing")) return false;
  const fbq = readFbq();
  if (!fbq) return false;
  try {
    fbq("track", name, sanitizeMetaParams(params), { eventID: eventId ?? newMetaEventId(name) });
    return true;
  } catch {
    return false;
  }
}
