// Kontrakt beaconu lejka wydarzenia: przegladarka -> `/api/public/event-funnel`.
//
// JEDEN PLIK NA OBA KONCE. Klient (`eventFunnelBeacon.ts`) sklada ladunek
// z tych typow, a endpoint waliduje go TA SAMA funkcja - ksztalt nie moze sie
// rozjechac bez czerwonego testu. Baza waliduje wszystko jeszcze raz
// (`event_funnel_track` / `_event_ads_touch`), bo endpoint jest publiczny
// i bez podpisu: tu odrzucamy smieci tanio, zanim dotkna bazy.
//
// IDENTYFIKATOR KLIKNIECIA TYLKO ZE ZGODA. Ladunek bez `ad_consent: true` traci
// `click_id` juz tutaj (rodzaj klikniecia zostaje - to kanal google/cpc).
import type { AdTouchWire } from "@/lib/analytics/adAttribution";

export const EVENT_FUNNEL_ENDPOINT = "/api/public/event-funnel";

export const EVENT_FUNNEL_STEPS = ["visit", "registration_start", "checkout_start"] as const;
export type EventFunnelStep = (typeof EVENT_FUNNEL_STEPS)[number];

/** Maksymalny rozmiar ciala beaconu (bajty) - dotkniecie + klucze to ~1 kB. */
export const EVENT_FUNNEL_MAX_BODY = 4_000;

const SLUG_RE = /^[a-z0-9-]{3,120}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[A-Za-z0-9-]{8,80}$/;
const TOUCH_STRING_MAX = 600;
const TOUCH_KEYS = [
  "landing_path",
  "referrer_host",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gad_source",
  "gad_campaign_id",
  "click_id_type",
  "click_id",
] as const;

export type EventFunnelTouch = { ts: number } & Partial<
  Record<(typeof TOUCH_KEYS)[number], string>
>;

export type EventFunnelBeacon = {
  step: EventFunnelStep;
  slug?: string;
  event_id?: string;
  /** Identyfikator przegladarki (pusty, gdy magazyn trwaly jest zablokowany). */
  visitor: string;
  session: string;
  touch: EventFunnelTouch | null;
  ad_consent: boolean;
  lang?: "pl" | "en";
};

/** Ladunek skladany przez klienta (dotkniecie wprost z `touchWire`, z `null`-ami). */
export type EventFunnelBeaconPayload = Omit<EventFunnelBeacon, "touch"> & {
  touch: AdTouchWire | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTouch(raw: unknown, adConsent: boolean): EventFunnelTouch | null {
  if (!isRecord(raw)) return null;
  const ts = raw.ts;
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return null;
  const touch: EventFunnelTouch = { ts };
  for (const key of TOUCH_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && value !== "" && value.length <= TOUCH_STRING_MAX) {
      touch[key] = value;
    }
  }
  if (!adConsent) delete touch.click_id;
  return touch;
}

/**
 * Ladunek beaconu po walidacji albo `null` (caly beacon odrzucony). Zle
 * dotkniecie nie odrzuca kroku - krok liczy sie jako wejscie bezposrednie.
 */
export function parseEventFunnelBeacon(raw: unknown): EventFunnelBeacon | null {
  if (!isRecord(raw)) return null;
  const step = EVENT_FUNNEL_STEPS.find((candidate) => candidate === raw.step);
  if (step === undefined) return null;
  const slug = typeof raw.slug === "string" && SLUG_RE.test(raw.slug) ? raw.slug : undefined;
  const eventId =
    typeof raw.event_id === "string" && UUID_RE.test(raw.event_id) ? raw.event_id : undefined;
  if (slug === undefined && eventId === undefined) return null;
  const session = typeof raw.session === "string" ? raw.session : "";
  if (!KEY_RE.test(session)) return null;
  const visitor = typeof raw.visitor === "string" && KEY_RE.test(raw.visitor) ? raw.visitor : "";
  const adConsent = raw.ad_consent === true;
  const beacon: EventFunnelBeacon = {
    step,
    visitor,
    session,
    touch: parseTouch(raw.touch, adConsent),
    ad_consent: adConsent,
  };
  if (slug !== undefined) beacon.slug = slug;
  if (eventId !== undefined) beacon.event_id = eventId;
  if (raw.lang === "pl" || raw.lang === "en") beacon.lang = raw.lang;
  return beacon;
}
