// Selektory oferty publicznej w cenniku v6.2 (decyzje 3 i 4).
//
// CZEGO PILNUJE:
//   1. `listedTiers` chowa kartę progu z `pricing_visible = false` (Enterprise,
//      Partner Biznesowy), ale NIE zmienia samego progu - filtr musi stać przed
//      `tiersForAudience`, bo ten przerzuca próg bez segmentu do pierwszego.
//   2. `publicOfferPlans` zostawia Decision Lab (karta „na zapytanie") i cenę
//      planu sprzedawanego przez rozmowę (Zespół), a usuwa plany wycofane ze
//      sprzedaży - obecni klienci odnawiają się dalej, ale nowy klient ich nie
//      zobaczy.
//   3. Para studencka v6.2 (19 zł / 190 zł) daje uczciwe „-17%".
import { describe, expect, it } from "vitest";

import type { AccessPlan } from "@/lib/billing/types";
import type { MembershipTierRow } from "@/lib/billing/tiers";
import {
  intervalPair,
  listedTiers,
  publicOfferPlans,
  tiersForAudience,
  yearlySavingsPct,
} from "@/lib/pricing/selectors";
import type { PricingAudienceRow } from "@/lib/pricing/queries";

function tier(key: string, patch: Partial<MembershipTierRow> = {}): MembershipTierRow {
  return {
    id: `tier-${key}`,
    tenant_id: "t1",
    key,
    rank: 10,
    name_pl: key,
    name_en: key,
    description_pl: null,
    description_en: null,
    benefits: [],
    features: {},
    is_default: false,
    active: true,
    sort_order: 0,
    created_at: "2026-10-18T00:00:00Z",
    updated_at: "2026-10-18T00:00:00Z",
    audience_key: "business",
    badge_pl: null,
    badge_en: null,
    highlight: false,
    contact_url: null,
    per_seat: false,
    price_note_pl: null,
    price_note_en: null,
    cta_mode: "auto",
    pricing_visible: true,
    ...patch,
  };
}

function plan(id: string, patch: Partial<AccessPlan> = {}): AccessPlan {
  return {
    id,
    tenant_id: "t1",
    name_pl: id,
    name_en: id,
    description_pl: null,
    description_en: null,
    price_cents: 1900,
    currency: "PLN",
    interval: "month",
    active: true,
    sort_order: 0,
    features_pl: [],
    features_en: [],
    badge_pl: null,
    badge_en: null,
    highlighted: false,
    trial_days: 7,
    tier_key: "student",
    for_sale: true,
    ...patch,
  };
}

const AUDIENCES = [{ key: "individual" }, { key: "business" }] as unknown as PricingAudienceRow[];

describe("listedTiers", () => {
  it("chowa progi z pricing_visible=false, zostawia widoczne i te sprzed kolumny", () => {
    const tiers = [
      tier("partner"),
      tier("corporate", { pricing_visible: false }),
      tier("business", { pricing_visible: false }),
      { ...tier("legacy"), pricing_visible: undefined } as unknown as MembershipTierRow,
    ];
    expect(listedTiers(tiers).map((t) => t.key)).toEqual(["partner", "legacy"]);
  });

  it("ukryty próg bez segmentu NIE wraca do pierwszego segmentu", () => {
    const hidden = tier("corporate", { pricing_visible: false, audience_key: null });
    // Bez filtra selektor segmentu przerzuciłby go do „individual".
    expect(tiersForAudience([hidden], AUDIENCES, "individual")).toHaveLength(1);
    expect(tiersForAudience(listedTiers([hidden]), AUDIENCES, "individual")).toHaveLength(0);
  });
});

describe("publicOfferPlans", () => {
  it("zostawia plany w sprzedaży i Decision Lab, usuwa wycofane", () => {
    const plans = [
      plan("student-m"),
      plan("biz-m", { tier_key: "business", for_sale: false, interval: "month" }),
      plan("dl", { tier_key: "decision_lab", for_sale: false, interval: "one_time" }),
    ];
    expect(publicOfferPlans(plans).map((p) => p.id)).toEqual(["student-m", "dl"]);
  });

  it("plan progu sprzedawanego przez rozmowę zostaje na karcie (Zespół), wycofany nie wraca", () => {
    // Zespół v6.2: „89 zł za miejsce, 3-20 miejsc · rozmowa" - plan poza kasą
    // (`for_sale = false`), ale jego cena stoi na karcie z przyciskiem rozmowy.
    const plans = [
      plan("team-m", { tier_key: "team", for_sale: false, price_cents: 8900 }),
      plan("biz-m", { tier_key: "business", for_sale: false }),
    ];
    const tiers = [
      tier("team", { cta_mode: "contact" }),
      tier("business", { cta_mode: "contact", pricing_visible: false }),
    ];
    expect(publicOfferPlans(plans, tiers).map((p) => p.id)).toEqual(["team-m"]);
    // Powierzchnie z przyciskiem kasy (widżet, paywall) liczą bez progów:
    // planu poza sprzedażą nie pokazują wcale.
    expect(publicOfferPlans(plans)).toEqual([]);
    // Próg z samoobsługowym przyciskiem (`auto`) nie przemyca planu poza kasą.
    expect(publicOfferPlans(plans, [tier("team", { cta_mode: "auto" })])).toEqual([]);
  });
});

describe("para studencka v6.2", () => {
  it("19 zł / mies. i 190 zł / rok -> oszczędność 17%", () => {
    const pair = intervalPair([
      plan("student-m"),
      plan("student-y", { interval: "year", price_cents: 19000 }),
    ]);
    expect(yearlySavingsPct(pair.month, pair.year)).toBe(17);
  });
});
