// MAPA INWALIDACJI HUBA „PRZYCHÓD I LEJEK" (SPEC §3.2-3.3, PLAN I0 §2.3).
//
// CO TEN PLIK DOWODZI. Każdy wiersz tabeli synchronizacji z SPEC staje się
// tu jednym przypadkiem: zdarzenie → klucze modułów w RDZENIU (zawierania,
// bo rdzeń ma też starsze klucze) i klucze panelu w ROZSZERZENIU (dokładnie,
// bo cały zbiór pochodzi z kontraktu). Bez tego poszerzenia D5/D6/D8/S1/S2
// są niewidzialne: ekran wygląda poprawnie, tylko druga karta nie odświeża
// się po zmianie w pierwszej - aż do `staleTime` albo F5.
//
// PRZYPIĘCIA LITERAŁÓW. Kilka kluczy rdzenia nie ma fabryki-liścia (fabryka
// mieszka w pliku hooków albo zapytanie stoi w komponencie), więc rdzeń trzyma
// literał. Literał milczy przy rozjeździe - dlatego niżej porównujemy go
// z PRAWDZIWYM kluczem: fabryką (tam, gdzie test może ją zaimportować) albo
// źródłem komponentu.
import { readFileSync } from "node:fs";
import type { QueryKey } from "@tanstack/react-query";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accessKeys, checkoutKeys, meteringKeys } from "@/lib/access/keys";
import { couponKeys } from "@/lib/admin/couponKeys";
import { workflowKeys } from "@/lib/admin/workflowKeys";
import { analyticsCouponsKey, analyticsCouponsPrefixKey } from "@/lib/analytics/queryKeys";
import { permissionMatrixKeys } from "@/lib/authz/permissionMatrixQuery";
import { billingKeys } from "@/lib/billing/keys";
import { applicationInboxKeys } from "@/lib/clubs/adminApplicationsInbox";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { crmKeys } from "@/lib/crm/keys";
import { adsFunnelKeys } from "@/lib/events/useEventAdsFunnel";
import { onsiteKeys } from "@/lib/events/useEventOnsite";
import { registrationKeys } from "@/lib/events/useEventRegistrations";
import { journeyKeys } from "@/lib/journeys/keys";
import { newsletterKeys } from "@/lib/newsletter/keys";
import type { DomainEventRow, DomainEventType } from "@/lib/realtime/domainEvents";
import {
  invalidationKeysFor,
  registerInvalidationExtension,
} from "@/lib/realtime/eventInvalidationMap";
import { ADMIN_HUB_INVALIDATION } from "@/lib/realtime/eventInvalidationMap.admin";
import { isSlowInvalidationKey } from "@/lib/realtime/useModuleRealtime";
import { retentionKeys } from "@/lib/retention/keys";
import { revenueKeys, type RevenueDomain } from "@/lib/revenue/keys";

const TENANT = "11111111-1111-4111-a111-111111111111";
const AGGREGATE = "22222222-2222-4222-a222-222222222222";
const EVENT_ID = "33333333-3333-4333-a333-333333333333";
const CTX = { userId: "44444444-4444-4444-a444-444444444444" };

function eventOf(
  type: DomainEventType,
  payload: Record<string, unknown> = {},
  aggregateId = AGGREGATE,
): DomainEventRow {
  return {
    id: "55555555-5555-4555-a555-555555555555",
    tenant_id: TENANT,
    aggregate_type: type.split(".")[0],
    aggregate_id: aggregateId,
    event_type: type,
    payload: payload as DomainEventRow["payload"],
    correlation_id: null,
    actor_id: null,
    created_at: "2026-10-19T10:00:00.000Z",
  };
}

function isPanelKey(key: QueryKey): boolean {
  return key[0] === "admin-revenue" || (key[0] === "admin" && key[1] === "journeys");
}

/** Odwzorowanie dopasowania TanStack Query: klucz inwalidacji jest PREFIKSEM klucza zapytania. */
function covers(keys: readonly QueryKey[], queryKey: QueryKey): boolean {
  return keys.some((key) => key.every((part, index) => Object.is(queryKey[index], part)));
}

const rev = (domain: RevenueDomain): QueryKey => revenueKeys.domainTenant(domain, TENANT);
const MRR_K = [rev("mrr"), rev("churn"), rev("cohorts"), rev("dunning"), rev("snapshot")];
const FUN_K = [rev("funnel"), rev("snapshot")];
const DIAG_K = [rev("diagnostics")];

const sorted = (keys: readonly QueryKey[]) => keys.map((key) => JSON.stringify(key)).sort();

interface Row {
  readonly types: readonly DomainEventType[];
  readonly payload?: Record<string, unknown>;
  /** Klucze modułów, które rdzeń MUSI zawierać. */
  readonly core: readonly QueryKey[];
  /** Klucze panelu - DOKŁADNY zbiór z rozszerzenia. */
  readonly ext: readonly QueryKey[];
}

/** Tabela §2.3 planu I0 (= kolumna „Klucze unieważniane" SPEC §3.2). */
const ROWS: Readonly<Record<string, Row>> = {
  "S1 warstwa": {
    types: ["membership_tier.changed.v1"],
    core: [
      billingKeys.membershipTiers(),
      billingKeys.admin.membershipTiers(),
      billingKeys.currentTierAll(),
      billingKeys.crmLeadMembershipAll(),
      couponKeys.tiers(),
      ["authz", "permission-matrix", "tiers"],
      ["admin-membership-tiers"],
      billingKeys.admin.members(),
      clubKeys.all,
    ],
    ext: [rev("offer"), rev("access"), ...DIAG_K],
  },
  "S1 plan": {
    types: ["access_plan.changed.v1"],
    core: [
      billingKeys.plansActive(),
      billingKeys.admin.plans(),
      billingKeys.admin.monetization(),
      billingKeys.mySubscriptionAll(),
      billingKeys.admin.plansAll(),
      couponKeys.plans(),
      billingKeys.admin.testPlans(),
    ],
    ext: [...MRR_K, rev("offer"), rev("access"), ...DIAG_K],
  },
  "D6 uprawnienie subskrypcyjne": {
    types: [
      "subscription.started.v1",
      "subscription.status_changed.v1",
      "subscription.updated.v1",
      "subscription.renewed.v1",
      "subscription.expired.v1",
    ],
    core: [
      billingKeys.mySubscriptionAll(),
      billingKeys.admin.allUserSubscriptions(),
      billingKeys.admin.stripeSubscriptions(),
      billingKeys.admin.members(),
      clubKeys.all,
    ],
    ext: [...MRR_K, rev("realized")],
  },
  "D6 nadanie warstwy": {
    types: ["membership_grant.granted.v1", "membership_grant.revoked.v1"],
    core: [
      billingKeys.admin.membershipGrants(),
      billingKeys.admin.members(),
      billingKeys.admin.memberBillingAll(),
      billingKeys.admin.monetization(),
      clubKeys.all,
    ],
    ext: [],
  },
  "S2 dokument rozliczeniowy": {
    types: ["billing_document.issued.v1", "billing_document.updated.v1"],
    core: [billingKeys.myBillingDocumentsAll(), billingKeys.admin.monetization()],
    ext: [rev("realized"), rev("snapshot")],
  },
  "D5 wpłata za bilet": {
    types: ["event.registration.payment.v1"],
    payload: { event_id: EVENT_ID },
    core: [
      registrationKeys.event(EVENT_ID),
      billingKeys.admin.monetization(),
      ["admin", "ticket-orders"],
      adsFunnelKeys.event(EVENT_ID),
    ],
    ext: [rev("events"), rev("realized")],
  },
  "zgłoszenia na wydarzenie": {
    types: [
      "event.registration.created.v1",
      "event.registration.decided.v1",
      "event.registration.cancelled.v1",
      "event.registration.promoted.v1",
    ],
    payload: { event_id: EVENT_ID },
    core: [registrationKeys.event(EVENT_ID)],
    ext: [rev("events")],
  },
  "obecność na wydarzeniu": {
    types: ["event.registration.attended.v1"],
    payload: { event_id: EVENT_ID, registration_id: "r1" },
    core: [registrationKeys.event(EVENT_ID), onsiteKeys.event(EVENT_ID)],
    ext: [rev("events")],
  },
  "D8 subskrybent newslettera": {
    types: [
      "newsletter_subscriber.subscribed.v1",
      "newsletter_subscriber.confirmed.v1",
      "newsletter_subscriber.unsubscribed.v1",
      "newsletter_subscriber.resubscribed.v1",
    ],
    core: [
      newsletterKeys.subscribersAll(),
      newsletterKeys.kpis(),
      crmKeys.funnelAll(),
      crmKeys.funnelStats(),
      crmKeys.leadsAll(),
    ],
    ext: FUN_K,
  },
  "D8 lead CRM": {
    types: ["crm_lead.created.v1", "crm_lead.updated.v1"],
    core: [crmKeys.leadsAll(), crmKeys.lead(AGGREGATE), crmKeys.funnelAll(), crmKeys.funnelStats()],
    ext: FUN_K,
  },
  "D8 etap i cykl życia leada": {
    types: ["crm_lead.stage_changed.v1", "crm_lead.lifecycle_changed.v1"],
    core: [
      crmKeys.leadsAll(),
      crmKeys.lead(AGGREGATE),
      crmKeys.leadStageHistory(AGGREGATE),
      crmKeys.funnelAll(),
      crmKeys.funnelStats(),
    ],
    ext: FUN_K,
  },
  "D8 zadanie CRM": {
    types: ["crm_task.created.v1", "crm_task.completed.v1", "crm_task.due.v1"],
    payload: { lead_id: "l1" },
    core: [crmKeys.tasksAll(), crmKeys.lead("l1"), crmKeys.funnelStats()],
    ext: DIAG_K,
  },
  "członkostwo w klubie": {
    types: ["club_member.changed.v1"],
    payload: { club_id: "c1" },
    core: [clubKeys.all, clubKeys.club("c1")],
    ext: [rev("clubs")],
  },
  "rejestracja konta": {
    types: ["account.registered.v1"],
    core: [billingKeys.admin.members(), crmKeys.leadsAll(), crmKeys.funnelStats()],
    ext: FUN_K,
  },
  "paywall i limit": {
    types: ["paywall.hit.v1", "metering.quota_exhausted.v1"],
    core: [crmKeys.leadMeteringAll()],
    ext: [...FUN_K, rev("access")],
  },
  kasa: {
    types: [
      "checkout.started.v1",
      "checkout.completed.v1",
      "checkout.failed.v1",
      "checkout.abandoned.v1",
    ],
    core: [billingKeys.myOrdersAll(), billingKeys.admin.paymentOrders()],
    ext: [...FUN_K, rev("realized")],
  },
  "subskrypcja u operatora": {
    types: [
      "billing_subscription.status_changed.v1",
      "billing_subscription.payment_failed.v1",
      "billing_subscription.payment_recovered.v1",
      "billing_subscription.trial_ending.v1",
    ],
    core: [
      billingKeys.admin.stripeSubscriptions(),
      billingKeys.myStripeSubscriptionAll(),
      billingKeys.crmLeadMembershipAll(),
    ],
    ext: MRR_K,
  },
  "przepływ anulowania": {
    types: ["retention_flow.started.v1", "retention_flow.completed.v1"],
    core: [retentionKeys.admin.feedback()],
    ext: [rev("retention"), rev("churn")],
  },
  "zgłoszenie do klubu": {
    types: ["club_application.submitted.v1", "club_application.decided.v1"],
    core: [
      applicationInboxKeys.all,
      clubKeys.all,
      ["club-applications", "mine"],
      crmKeys.leadsAll(),
    ],
    ext: [rev("clubs")],
  },
  "ustawienia meteringu": {
    types: ["metering_settings.changed.v1"],
    core: [
      meteringKeys.settings(),
      meteringKeys.impactPreviewAll(),
      crmKeys.leadMeteringAll(),
      ["public", "resolved"],
    ],
    ext: [rev("access"), ...DIAG_K],
  },
  "ustawienia kasy": {
    types: ["checkout_settings.changed.v1"],
    core: [checkoutKeys.settings(), billingKeys.admin.monetization()],
    ext: DIAG_K,
  },
  "reguła dostępu": {
    types: ["content_access.changed.v1"],
    payload: { entity_type: "post", entity_id: "p1", mode: "members", op: "update" },
    core: [
      accessKeys.rule("post", "p1"),
      accessKeys.overrides(),
      ["public", "resolved"],
      ["unlocked-body"],
    ],
    ext: [rev("access"), ...DIAG_K],
  },
  "ustawienia newslettera": {
    types: ["newsletter_settings.changed.v1"],
    core: [newsletterKeys.settings()],
    ext: DIAG_K,
  },
  "ustawienia i powody retencji": {
    types: ["retention_settings.changed.v1", "retention_reason.changed.v1"],
    core: [
      retentionKeys.settingsPublic(),
      retentionKeys.reasonsPublic(),
      retentionKeys.admin.settings(),
      retentionKeys.admin.reasons(),
    ],
    ext: DIAG_K,
  },
  "kupon i kampania": {
    types: ["coupon.changed.v1", "coupon_campaign.changed.v1"],
    core: [couponKeys.admin(), couponKeys.campaigns(), analyticsCouponsPrefixKey(TENANT)],
    ext: [rev("offer"), ...DIAG_K],
  },
  "realizacja kuponu": {
    types: ["coupon.redeemed.v1"],
    core: [
      couponKeys.admin(),
      couponKeys.campaigns(),
      analyticsCouponsPrefixKey(TENANT),
      couponKeys.redemptionsAll(),
    ],
    ext: [rev("offer"), ...DIAG_K, rev("snapshot")],
  },
  "przepis automatyzacji": {
    types: ["workflow_definition.changed.v1"],
    core: [workflowKeys.definitions(), workflowKeys.templates()],
    ext: DIAG_K,
  },
  "ścieżka - definicja (panelowy)": {
    types: ["journey.changed.v1"],
    core: [],
    ext: [journeyKeys.listAll(), journeyKeys.detail(AGGREGATE), ...DIAG_K],
  },
  "ścieżka - statystyki (panelowy)": {
    types: ["journey.stats_changed.v1"],
    core: [],
    ext: [
      journeyKeys.statsFor(AGGREGATE),
      journeyKeys.enrollmentsFor(AGGREGATE),
      journeyKeys.listAll(),
      journeyKeys.forLeadAll(),
    ],
  },
  "dane wejściowe (panelowy)": {
    types: ["revenue_input.changed.v1"],
    core: [],
    ext: [rev("inputs"), rev("economics"), rev("snapshot")],
  },
  "wyciszenie diagnozy (panelowy)": {
    types: ["revenue_diagnostic.snoozed.v1"],
    core: [],
    ext: [revenueKeys.facts(TENANT), revenueKeys.snoozes(TENANT)],
  },
};

let unregister: () => void = () => undefined;
beforeAll(() => {
  unregister = registerInvalidationExtension(ADMIN_HUB_INVALIDATION);
});
afterAll(() => unregister());

function keysOf(type: DomainEventType, payload?: Record<string, unknown>, aggregateId?: string) {
  return invalidationKeysFor(eventOf(type, payload, aggregateId), CTX);
}

describe("mapa huba: rdzeń modułów + rozszerzenie panelu (tabela §2.3)", () => {
  const cases = Object.entries(ROWS).flatMap(([name, row]) =>
    row.types.map((type) => [`${name}: ${type}`, type, row] as const),
  );

  it.each(cases)("%s", (_name, type, row) => {
    const keys = keysOf(type, row.payload);
    const core = keys.filter((key) => !isPanelKey(key));
    const ext = keys.filter(isPanelKey);

    for (const key of row.core) expect(core, JSON.stringify(key)).toContainEqual(key);
    if (row.core.length === 0) expect(core).toEqual([]);
    expect(sorted(ext)).toEqual(sorted(row.ext));
  });

  it("zgłoszenie bez `created`/`decided`/… (`updated`) nie dotyka panelu - tabela go nie wymienia", () => {
    expect(
      keysOf("event.registration.updated.v1", { event_id: EVENT_ID }).filter(isPanelKey),
    ).toEqual([]);
  });
});

describe("degradacja przy uszkodzonym payloadzie", () => {
  it('wpłata za bilet bez `event_id` unieważnia CAŁY lejek reklam, nie `[…, ""]`', () => {
    const keys = keysOf("event.registration.payment.v1", {});
    expect(keys).toContainEqual(adsFunnelKeys.all);
    expect(keys).not.toContainEqual([...adsFunnelKeys.all, ""]);
  });

  it('reguła dostępu bez pól encji unieważnia wszystkie reguły, nigdy `rule("", "")`', () => {
    for (const payload of [{}, { entity_type: "post" }, { entity_id: "p1" }]) {
      const keys = keysOf("content_access.changed.v1", payload);
      expect(keys).toContainEqual(accessKeys.ruleAll());
      expect(keys.filter((key) => key[0] === "content_access" && key.length > 1)).toEqual([]);
    }
  });

  it('ścieżka bez identyfikatora degraduje do korzenia ścieżek, nie do `detail("")`', () => {
    for (const type of ["journey.changed.v1", "journey.stats_changed.v1"] as const) {
      const keys = keysOf(type, {}, "");
      expect(keys, type).toContainEqual(journeyKeys.root());
      expect(keys, type).not.toContainEqual(journeyKeys.detail(""));
      expect(keys, type).not.toContainEqual(journeyKeys.statsFor(""));
    }
  });
});

describe("prefiksy trafiają w prawdziwe klucze zapytań", () => {
  it("S2: `monetization()` pokrywa rejestr monetyzacji każdego środowiska", () => {
    const keys = keysOf("billing_document.issued.v1");
    for (const env of ["live", "sandbox"]) {
      expect(covers(keys, billingKeys.admin.monetizationLedger(env)), env).toBe(true);
    }
  });

  it("kupony: prefiks najemcy pokrywa analitykę w każdym zakresie dat", () => {
    const keys = keysOf("coupon.redeemed.v1");
    expect(covers(keys, analyticsCouponsKey(TENANT, "2026-01-01", "2026-02-01"))).toBe(true);
    expect(covers(keys, analyticsCouponsKey(TENANT, null, null))).toBe(true);
    expect(covers(keys, couponKeys.redemptions("2026-01-01", null))).toBe(true);
  });

  it("D8: lejek CRM odświeża się przy każdym filtrze ekranu", () => {
    const keys = keysOf("crm_lead.updated.v1");
    expect(covers(keys, crmKeys.funnel({ owner: "me", from: "2026-10-01" }))).toBe(true);
    expect(covers(keys, crmKeys.leads({ page: 2 }))).toBe(true);
  });

  it("newsletter: zmiana ustawień trafia też w projekcję formularzy inline", () => {
    expect(covers(keysOf("newsletter_settings.changed.v1"), newsletterKeys.settingsInline())).toBe(
      true,
    );
  });

  it("hub: dziedzina najemcy pokrywa każde okno i filtr tej dziedziny", () => {
    const range = { period: "month" as const, current: { sinceIso: "a", untilIso: "b" } };
    const keys = keysOf("access_plan.changed.v1");
    expect(covers(keys, revenueKeys.query("mrr", TENANT, range, { currency: "PLN" }))).toBe(true);
    expect(covers(keys, revenueKeys.offerMatrix(TENANT))).toBe(true);
    expect(covers(keys, revenueKeys.facts(TENANT))).toBe(true);
    // …i nie trafia w cudzego najemcę.
    expect(covers(keys, revenueKeys.query("mrr", "inny-najemca", range))).toBe(false);
  });

  it("ścieżki: statystyki pokrywają każde okno i wersję tej ścieżki", () => {
    const keys = keysOf("journey.stats_changed.v1");
    expect(covers(keys, journeyKeys.stats(AGGREGATE, "v1", "a", "b"))).toBe(true);
    expect(covers(keys, journeyKeys.enrollments(AGGREGATE, "n1", "active", 0))).toBe(true);
    expect(covers(keys, journeyKeys.list(TENANT, "active"))).toBe(true);
    expect(covers(keys, journeyKeys.stats("inna-sciezka", null, null, null))).toBe(false);
  });

  it("scenariusz S-A: plan w module → listy natychmiast, agregaty huba wolnym pasem", () => {
    const keys = keysOf("access_plan.changed.v1");
    expect(isSlowInvalidationKey(billingKeys.admin.plansAll())).toBe(false);
    expect(keys.filter(isSlowInvalidationKey)).toEqual(keys.filter(isPanelKey));
    expect(keys.filter(isSlowInvalidationKey).length).toBeGreaterThan(0);
  });
});

describe("przypięcia literałów rdzenia do prawdziwych kluczy", () => {
  /** Wiodące napisy literałów `queryKey: [...]` w źródle komponentu. */
  function queryKeyLiterals(path: string): string[][] {
    const source = readFileSync(path, "utf8");
    return [...source.matchAll(/queryKey:\s*\[([^\]]*)\]/g)].map((match) => {
      const out: string[] = [];
      for (const part of match[1].split(",")) {
        const literal = /^\s*"([^"]*)"\s*$/.exec(part);
        if (!literal) break;
        out.push(literal[1]);
      }
      return out;
    });
  }

  it('`["admin", "club-applications"]` = `applicationInboxKeys.all` (skrzynka zgłoszeń)', () => {
    const keys = keysOf("club_application.submitted.v1");
    expect(keys).toContainEqual(applicationInboxKeys.all);
    expect(covers(keys, applicationInboxKeys.counts())).toBe(true);
    expect(covers(keys, applicationInboxKeys.list("all", "pending", ""))).toBe(true);
  });

  it('`["authz", "permission-matrix", "tiers"]` pokrywa kolumny macierzy uprawnień', () => {
    const keys = keysOf("membership_tier.changed.v1");
    expect(covers(keys, permissionMatrixKeys.tenantTiers(TENANT))).toBe(true);
    expect(covers(keys, permissionMatrixKeys.tenantTiers(null))).toBe(true);
  });

  it('`["admin", "ticket-orders"]` pokrywa każde zapytanie `AdminTicketOrdersPanel`', () => {
    const literals = queryKeyLiterals("src/components/admin/billing/AdminTicketOrdersPanel.tsx");
    // Kanarek: skaner musi widzieć zapytania panelu, inaczej test jest pusty.
    expect(literals.length).toBeGreaterThanOrEqual(2);
    const keys = keysOf("event.registration.payment.v1", { event_id: EVENT_ID });
    for (const literal of literals) {
      expect(covers(keys, literal), JSON.stringify(literal)).toBe(true);
    }
  });

  it('`["admin-membership-tiers"]` pokrywa wybór warstwy w `VerificationDomainsCard`', () => {
    const literals = queryKeyLiterals(
      "src/components/admin/community/VerificationDomainsCard.tsx",
    ).filter((literal) => literal[0] === "admin-membership-tiers");
    expect(literals.length).toBeGreaterThanOrEqual(1);
    const keys = keysOf("membership_tier.changed.v1");
    for (const literal of literals) expect(covers(keys, [...literal, TENANT])).toBe(true);
  });

  it('`["club-applications", "mine"]` = historia własnych zgłoszeń na /club/apply', () => {
    const source = readFileSync("src/routes/club.apply.tsx", "utf8");
    const match = /MY_APPLICATIONS_KEY\s*=\s*\[([^\]]*)\]/.exec(source);
    const literal = (match?.[1] ?? "").split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
    expect(literal).toEqual(["club-applications", "mine"]);
    expect(keysOf("club_application.decided.v1")).toContainEqual(literal);
  });

  it("zgłoszenia i moduł na miejscu: klucze z fabryk modułu wydarzeń", () => {
    const keys = keysOf("event.registration.attended.v1", { event_id: EVENT_ID });
    expect(covers(keys, registrationKeys.tickets(EVENT_ID))).toBe(true);
    expect(covers(keys, onsiteKeys.checkpoints(EVENT_ID))).toBe(true);
  });
});
