// Mostek nazw: wewnętrzny silnik analityki (`./track.ts`) -> słownik GA4.
//
// DLACZEGO MAPA, A NIE PRZEPISANIE NAZW. Nasze zdarzenia są nazwane pod
// raporty admina (`pricing_signup_click`) i tak siedzą w `analytics_events`.
// GA4 rozumie natomiast swoje zdarzenia rekomendowane (`sign_up`,
// `begin_checkout`, `search`, `view_item`) - tylko one wpadają do gotowych
// raportów i konwersji. Mapa tłumaczy jedno na drugie w jednym pliku, bez
// dotykania istniejących wywołań w komponentach.
//
// Nazwy nieobjęte mapą jadą do GA4 jako zdarzenie własne (custom event) po
// sanityzacji do dozwolonego zestawu znaków - GA4 przyjmuje wyłącznie
// [A-Za-z0-9_] i maks. 40 znaków.

import type { Ga4Params } from "./ga4Client";

/** Nazwy rekomendowane przez GA4 dla naszych zdarzeń biznesowych. */
const NAME_MAP: Record<string, string> = {
  page_view: "page_view",
  internal_search: "search",
  pricing_signup_click: "sign_up_intent",
  pricing_checkout_click: "begin_checkout_intent",
  pricing_contact_click: "generate_lead",
  pricing_interval_change: "select_item",
  newsletter_signup: "join_group",
  // Konwersje przeniesione z WordPressa (patrz `./conversions.ts`).
  form_submit: "generate_lead",
  strategy_click: "select_content",
  signup_completed: "sign_up",
  login_completed: "login",
  post_view: "view_item",
  page_view_entity: "view_item",
  author_view: "view_item",
  expert_view: "view_item",
  tag_view: "view_item_list",
  category_view: "view_item_list",
};

/** GA4 dopuszcza wyłącznie litery, cyfry i podkreślenia; maks. 40 znaków. */
export function sanitizeGa4EventName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safe = cleaned || "custom_event";
  return /^[A-Za-z]/.test(safe) ? safe.slice(0, 40) : `e_${safe}`.slice(0, 40);
}

export function ga4EventName(internalName: string): string {
  return NAME_MAP[internalName] ?? sanitizeGa4EventName(internalName);
}

/** Wartości nieskalarne (obiekty, tablice) nie mają sensu jako parametr GA4. */
function scalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") return value.slice(0, 100);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return undefined;
}

export interface InternalEventShape {
  type: string;
  name: string;
  entityType: string | null;
  entityId: string | null;
  meta: Record<string, unknown>;
  path: string;
  lang: string;
}

/**
 * Parametry GA4 dla zdarzenia wewnętrznego. Klucz `search_term` jest wymagany
 * przez raport „Wyszukiwanie w witrynie", więc frazę przepisujemy jawnie.
 */
export function ga4EventParams(event: InternalEventShape): Ga4Params {
  const params: Ga4Params = {
    page_path: event.path || undefined,
    language: event.lang || undefined,
  };
  if (event.entityType) params.item_category = event.entityType;
  if (event.entityId) params.item_id = event.entityId;
  if (event.name === "internal_search" && event.entityId) params.search_term = event.entityId;

  for (const [key, raw] of Object.entries(event.meta)) {
    const value = scalar(raw);
    if (value === undefined) continue;
    params[sanitizeGa4EventName(key)] = value;
  }
  return params;
}
