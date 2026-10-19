// KATALOG ZDARZEŃ HUBA „PRZYCHÓD I LEJEK" - 34 typy zamrożone w I0 (SPEC §4.5).
//
// CO SIĘ DZIEJE BEZ TEGO TESTU. Emitery tych typów wchodzą w siedmiu
// wycinkach równoległych (S1-S7), a każdy z nich pisze nazwę zdarzenia
// literałem w SQL. Bramka `domainEventCatalog.test.ts` złapie emiter bez
// wpisu w katalogu - ale dopiero w gałęzi wycinka. Zmiana nazwy albo zgubiony
// wpis w katalogu przed scaleniem emitera nie oblałby niczego: mapa
// inwalidacji zwracałaby `[]`, a hub w drugiej karcie po cichu przestałby się
// odświeżać. Lista niżej jest KONTRAKTEM - przepisana ręcznie z SPEC, nie
// wyliczona z katalogu.
//
// CYFRY W CZŁONACH SĄ ZAKAZANE: skaner emiterów (`domainEventCatalog.test.ts`,
// `/'([a-z_]+(?:\.[a-z_]+)+\.v\d+)'/`) nie dopasowałby takiego literału, więc
// emiter byłby dla bramki niewidzialny.
import { describe, expect, it } from "vitest";
import { DOMAIN_AGGREGATE_TYPES, DOMAIN_EVENT_TYPES } from "@/lib/realtime/domainEvents";
import { eventInvalidationMap } from "@/lib/realtime/eventInvalidationMap";

/** [typ, agregat] - agregat nie zawsze jest pierwszym członem (`event.registration.*`). */
const HUB_EVENTS: readonly (readonly [type: string, aggregate: string])[] = [
  ["account.registered.v1", "account"],
  ["newsletter_subscriber.resubscribed.v1", "newsletter_subscriber"],
  ["paywall.hit.v1", "paywall"],
  ["metering.quota_exhausted.v1", "metering"],
  ["checkout.started.v1", "checkout"],
  ["checkout.completed.v1", "checkout"],
  ["checkout.failed.v1", "checkout"],
  ["checkout.abandoned.v1", "checkout"],
  ["billing_subscription.status_changed.v1", "billing_subscription"],
  ["billing_subscription.payment_failed.v1", "billing_subscription"],
  ["billing_subscription.payment_recovered.v1", "billing_subscription"],
  ["billing_subscription.trial_ending.v1", "billing_subscription"],
  ["subscription.renewed.v1", "subscription"],
  ["subscription.expired.v1", "subscription"],
  ["retention_flow.started.v1", "retention_flow"],
  ["retention_flow.completed.v1", "retention_flow"],
  ["club_application.submitted.v1", "club_application"],
  ["club_application.decided.v1", "club_application"],
  ["event.registration.attended.v1", "event_registration"],
  ["metering_settings.changed.v1", "metering_settings"],
  ["checkout_settings.changed.v1", "checkout_settings"],
  ["newsletter_settings.changed.v1", "newsletter_settings"],
  ["retention_settings.changed.v1", "retention_settings"],
  ["content_access.changed.v1", "content_access"],
  ["retention_reason.changed.v1", "retention_reason"],
  ["coupon.changed.v1", "coupon"],
  ["coupon_campaign.changed.v1", "coupon_campaign"],
  ["coupon.redeemed.v1", "coupon"],
  ["workflow_definition.changed.v1", "workflow_definition"],
  ["crm_lead.lifecycle_changed.v1", "crm_lead"],
  ["journey.changed.v1", "journey"],
  ["journey.stats_changed.v1", "journey"],
  ["revenue_input.changed.v1", "revenue_input"],
  ["revenue_diagnostic.snoozed.v1", "revenue_diagnostic"],
];

/** Agregaty dopisane w I0 - pozostałe typy huba siedzą na istniejących. */
const HUB_AGGREGATES: readonly string[] = [
  "account",
  "paywall",
  "metering",
  "checkout",
  "billing_subscription",
  "retention_flow",
  "club_application",
  "journey",
  "revenue_input",
  "revenue_diagnostic",
  "metering_settings",
  "checkout_settings",
  "content_access",
  "newsletter_settings",
  "retention_settings",
  "retention_reason",
  "coupon",
  "coupon_campaign",
  "workflow_definition",
];

/** Kształt nazwy BEZ cyfr w członach (poza numerem wersji). */
const HUB_EVENT_NAME = /^[a-z_]+(\.[a-z_]+)+\.v\d+$/;
/** Dokładnie wyrażenie skanera emiterów z `domainEventCatalog.test.ts`. */
const EMITTER_SCANNER = /'([a-z_]+(?:\.[a-z_]+)+\.v\d+)'/;

const catalog = new Set<string>(DOMAIN_EVENT_TYPES);
const aggregates = new Set<string>(DOMAIN_AGGREGATE_TYPES);

describe("katalog zdarzeń huba (I0)", () => {
  it("zamrożona lista ma 34 różne typy i 19 różnych agregatów", () => {
    expect(HUB_EVENTS).toHaveLength(34);
    expect(new Set(HUB_EVENTS.map(([type]) => type)).size).toBe(34);
    expect(HUB_AGGREGATES).toHaveLength(19);
    expect(new Set(HUB_AGGREGATES).size).toBe(19);
  });

  it("każdy typ huba jest w katalogu szyny", () => {
    expect(HUB_EVENTS.map(([type]) => type).filter((type) => !catalog.has(type))).toEqual([]);
  });

  it.each(HUB_EVENTS.map(([type]) => type))(
    "%s: nazwa bez cyfr w członach, widoczna dla skanera emiterów",
    (type) => {
      expect(type).toMatch(HUB_EVENT_NAME);
      // Skaner czyta literał SQL w apostrofach - sprawdzamy na tej samej formie.
      expect(`emit_domain_event('${type}', …)`.match(EMITTER_SCANNER)?.[1]).toBe(type);
    },
  );

  it("każdy typ huba ma regułę w RDZENIU mapy (także typy czysto panelowe)", () => {
    // Rdzeń musi być kompletny: `Record<DomainEventType, …>` pilnuje tego
    // w typach, a ten test - w runtime, gdyby ktoś zawęził typ mapy.
    const rules = eventInvalidationMap as Partial<Record<string, unknown>>;
    expect(HUB_EVENTS.filter(([type]) => typeof rules[type] !== "function")).toEqual([]);
  });

  it("19 agregatów huba jest w katalogu agregatów", () => {
    expect(HUB_AGGREGATES.filter((aggregate) => !aggregates.has(aggregate))).toEqual([]);
  });

  it("agregat każdego typu huba jest w katalogu (filtry strumieni modułów)", () => {
    expect(HUB_EVENTS.filter(([, aggregate]) => !aggregates.has(aggregate))).toEqual([]);
  });

  it("katalog typów i agregatów nie ma duplikatów", () => {
    expect(new Set(DOMAIN_EVENT_TYPES).size).toBe(DOMAIN_EVENT_TYPES.length);
    expect(new Set(DOMAIN_AGGREGATE_TYPES).size).toBe(DOMAIN_AGGREGATE_TYPES.length);
  });
});
