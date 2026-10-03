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
//
// REDAKCJA PRZED WYJŚCIEM DO GOOGLE. Kopia zdarzenia wychodzi z `track()`
// ZANIM zadziała bramka zgody (Consent Mode advanced: pingi bez cookies niosą
// nazwę i parametry zdarzenia), a komplet redaktorów stał wyłącznie na
// serwerze first-party (`api/public/track.ts`), który redagował TYLKO własną
// kopię. Zmierzone przed naprawą: fraza `jan@example.com` szła do GA4 jako
// `item_id` i `search_term`, `page_path` jako `/search?q=jan%40example.com`,
// a e-mail na granicy 100 znaków w `meta` jako `…jan.kowal` - cięcie przed
// redakcją ucinało domenę, więc wzorzec e-maila już nie trafiał. Dlatego
// tutaj: te same redaktory co na serwerze, policzone RAZ, a cięcie dopiero po
// nich.
//
// DLACZEGO TUTAJ, A NIE W `ga4Event`. Przez `ga4Event` idzie też `send_to`
// konwersji Google Ads (`AW-<9-12 cyfr>/<etykieta>`), a 9-cyfrowy identyfikator
// konta wygląda dla reguły telefonu jak numer - konwersje przestałyby
// trafiać na konto. Tekst odwiedzającego dociera do GA4 wyłącznie tą kopią i
// przez `page_location` w `ga4PageView`.
//
// ŚWIADOMIE BEZ REDAKCJI: `item_category` (nasza stała) i klucze `meta` (nasz
// kod) - jak `event_name` po stronie serwera, to klucze grupowania raportów.

import { redactMeta, redactPii, redactQueryPii } from "@/lib/observability/redact";
import type { Ga4Params } from "./ga4Client";
import { redactTrackedPath } from "./redactTrackedUrl";

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

/** Limit długości wartości parametru zdarzenia w GA4 (dłuższe GA4 ucina samo). */
const GA4_VALUE_MAX = 100;

/**
 * Wartości nieskalarne (obiekty, tablice) nie mają sensu jako parametr GA4.
 * Cięcie dopiero po redakcji - wołający podaje wartość już zredagowaną.
 */
function scalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") return value.slice(0, GA4_VALUE_MAX);
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
 *
 * Kształty `const entityId = redactPii(`, `const meta = redactMeta(` i
 * `page_path: redactQueryPii(` czyta dosłownie bramka redakcji telemetrii
 * (`src/lib/ci/telemetryRedaction.ts`, rejestr wyjść do GA4) - nie zamieniać
 * ich na wyrażenie warunkowe przed nawiasem.
 *
 * `meta` wołającego zostaje nietknięte: ten sam obiekt jedzie potem beaconem do
 * naszego serwera, który redaguje go sam.
 */
export function ga4EventParams(event: InternalEventShape): Ga4Params {
  const entityId = redactPii(event.entityId);
  const meta = redactMeta(event.meta);
  const params: Ga4Params = {
    // `redactTrackedPath` domyka też JAWNĄ ścieżkę wołającego (`track({ path })`),
    // która dotąd szła surowa; na ścieżce z `currentPath()` jest idempotentne.
    page_path: redactQueryPii(redactTrackedPath(event.path)) || undefined,
    language: event.lang || undefined,
  };
  if (event.entityType) params.item_category = event.entityType;
  if (entityId) params.item_id = scalar(entityId);
  if (event.name === "internal_search" && entityId) params.search_term = scalar(entityId);

  for (const [key, raw] of Object.entries(meta)) {
    const value = scalar(raw);
    if (value === undefined) continue;
    params[sanitizeGa4EventName(key)] = value;
  }
  return params;
}
