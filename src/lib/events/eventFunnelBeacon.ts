// Beacon kroku lejka wydarzenia: wizyta, rozpoczecie zapisu, rozpoczecie
// platnosci - kroki ANONIMOWE, ktorych baza sama nie widzi (zapis zgloszenia
// i oplacenie zamowienia baza zna z wlasnych tabel).
//
// BRAMKA ZGODY ANALYTICS, jak w `track()`: bez niej nic nie wychodzi.
// Identyfikator klikniecia jedzie wylacznie przy zgodzie marketingowej
// (`ad_consent`), a bez niej - sam rodzaj klikniecia (kanal google/cpc).
//
// JEDEN KROK RAZ NA SESJE KARTY. Pamiec wyslanych krokow siedzi w
// `sessionStorage` (z zapasem w pamieci modulu, gdy magazyn jest zablokowany);
// baza i tak odrzuca powtorke tej samej sesji (unikalny indeks), wiec to jest
// oszczednosc zapytan, nie jedyna zapora.
//
// IDENTYFIKATORY Z `track.ts`: ta sama sesja i ten sam identyfikator
// przegladarki, co w analityce pierwszej strony - drugi zestaw liczylby te
// sama osobe dwa razy.
import { hasAnalyticsConsent, hasCategoryConsent } from "@/lib/ads/consent";
import { touchWire } from "@/lib/analytics/adAttribution";
import { readAdAttribution } from "@/lib/analytics/adAttributionStore";
import { readAnonId, readSession } from "@/lib/analytics/track";
import {
  EVENT_FUNNEL_ENDPOINT,
  type EventFunnelBeaconPayload,
  type EventFunnelStep,
} from "@/lib/events/eventFunnelWire";
import { sendBeaconPayload } from "@/lib/observability/report";
import {
  browserStorage,
  EVENT_FUNNEL_SENT_STORAGE_KEY,
  readStoredValue,
  writeStoredValue,
} from "@/lib/storageKeys";

export type EventFunnelTarget = { slug: string } | { eventId: string };

const SENT_LIMIT = 50;
const sentInMemory = new Set<string>();

function targetKey(target: EventFunnelTarget): string {
  return "slug" in target ? `slug:${target.slug}` : `id:${target.eventId}`;
}

function readSent(): string[] {
  const raw = readStoredValue(browserStorage("session"), EVENT_FUNNEL_SENT_STORAGE_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function alreadySent(key: string): boolean {
  return sentInMemory.has(key) || readSent().includes(key);
}

function rememberSent(key: string): void {
  sentInMemory.add(key);
  const next = [...readSent().filter((item) => item !== key), key].slice(-SENT_LIMIT);
  writeStoredValue(browserStorage("session"), EVENT_FUNNEL_SENT_STORAGE_KEY, JSON.stringify(next));
}

function pageLang(): "pl" | "en" | undefined {
  const lang = document.documentElement.lang;
  if (lang.startsWith("en")) return "en";
  if (lang.startsWith("pl")) return "pl";
  return undefined;
}

/**
 * Wysyla krok lejka. Zwraca `true`, gdy beacon wyszedl; `false` przy braku
 * zgody, powtorce w sesji albo braku `sendBeacon`. Nigdy nie rzuca.
 */
export function sendEventFunnelStep(step: EventFunnelStep, target: EventFunnelTarget): boolean {
  // `hasAnalyticsConsent()` poza przegladarka (SSR) zwraca false - osobny
  // warunek na `window` bylby martwa galezia.
  if (!hasAnalyticsConsent()) return false;
  const key = `${step}:${targetKey(target)}`;
  if (alreadySent(key)) return false;
  const adConsent = hasCategoryConsent("marketing");
  const attribution = readAdAttribution({ analytics: true, marketing: adConsent }, Date.now());
  const payload: EventFunnelBeaconPayload = {
    step,
    ...("slug" in target ? { slug: target.slug } : { event_id: target.eventId }),
    visitor: readAnonId(),
    session: readSession(),
    touch: attribution === null ? null : touchWire(attribution.last),
    ad_consent: adConsent,
  };
  const lang = pageLang();
  if (lang !== undefined) payload.lang = lang;
  const sent = sendBeaconPayload(EVENT_FUNNEL_ENDPOINT, payload);
  if (sent) rememberSent(key);
  return sent;
}
