// Selektory Cennika 2.0: drabinka warstw per segment, wybór planu dla
// interwału, matematyka oszczędności rocznej, grupowanie benefitów i FAQ.
import { describe, it, expect } from "vitest";
import type { AccessPlan } from "@/lib/billing/types";
import {
  parseTierBenefits,
  serializeTierBenefits,
  type MembershipTierRow,
  type TierBenefit,
} from "@/lib/billing/tiers";
import type { PricingAudienceRow, PricingFaqItemRow } from "@/lib/pricing/queries";
import {
  benefitDetail,
  benefitText,
  faqForAudience,
  groupBenefits,
  hasBothIntervals,
  intervalPair,
  maxYearlySavingsPct,
  monthlyEquivalentCents,
  pickPlanForInterval,
  plansByTierKey,
  sanitizeAudienceKey,
  sortTiers,
  tiersForAudience,
  yearlySavingsPct,
} from "@/lib/pricing/selectors";

let planSeq = 0;

function makePlan(patch: Partial<AccessPlan>): AccessPlan {
  planSeq += 1;
  return {
    id: `plan-${planSeq}`,
    tenant_id: "t1",
    name_pl: "Plan",
    name_en: "Plan",
    description_pl: null,
    description_en: null,
    price_cents: 1000,
    currency: "PLN",
    interval: "month",
    active: true,
    sort_order: 0,
    features_pl: [],
    features_en: [],
    badge_pl: null,
    badge_en: null,
    highlighted: false,
    trial_days: 0,
    tier_key: null,
    ...patch,
  };
}

let tierSeq = 0;

function makeTier(patch: Partial<MembershipTierRow>): MembershipTierRow {
  tierSeq += 1;
  return {
    id: `tier-${tierSeq}`,
    tenant_id: "t1",
    key: `tier-${tierSeq}`,
    rank: 0,
    name_pl: "Warstwa",
    name_en: "Tier",
    description_pl: null,
    description_en: null,
    benefits: [],
    features: {},
    is_default: false,
    active: true,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    audience_key: null,
    badge_pl: null,
    badge_en: null,
    highlight: false,
    contact_url: null,
    ...patch,
  };
}

function makeAudience(patch: Partial<PricingAudienceRow>): PricingAudienceRow {
  return {
    id: `aud-${patch.key ?? "x"}`,
    tenant_id: "t1",
    key: "individual",
    name_pl: "Dla Ciebie",
    name_en: "For you",
    tagline_pl: null,
    tagline_en: null,
    icon: "user",
    sort_order: 0,
    active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...patch,
  };
}

function makeFaq(patch: Partial<PricingFaqItemRow>): PricingFaqItemRow {
  return {
    id: `faq-${patch.sort_order ?? 0}`,
    tenant_id: "t1",
    audience_key: null,
    question_pl: "Pytanie?",
    question_en: "Question?",
    answer_pl: "Odpowiedź.",
    answer_en: "Answer.",
    sort_order: 0,
    active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...patch,
  };
}

describe("sanitizeAudienceKey", () => {
  it("akceptuje poprawny slug, odrzuca śmieci", () => {
    expect(sanitizeAudienceKey("academic")).toBe("academic");
    expect(sanitizeAudienceKey("team_2-x")).toBe("team_2-x");
    expect(sanitizeAudienceKey("A!")).toBeUndefined();
    expect(sanitizeAudienceKey("a")).toBeUndefined();
    expect(sanitizeAudienceKey(42)).toBeUndefined();
    expect(sanitizeAudienceKey(undefined)).toBeUndefined();
  });
});

describe("parse/serializeTierBenefits (format rozszerzony)", () => {
  it("zachowuje detail_* i group_* w obie strony", () => {
    const json = serializeTierBenefits([
      {
        pl: "Analizy premium",
        en: "Premium analyses",
        detail_pl: "Bez limitów.",
        detail_en: "No limits.",
        group_pl: "Treści",
        group_en: "Content",
      },
    ]);
    const parsed = parseTierBenefits(json);
    expect(parsed).toEqual([
      {
        pl: "Analizy premium",
        en: "Premium analyses",
        detail_pl: "Bez limitów.",
        detail_en: "No limits.",
        group_pl: "Treści",
        group_en: "Content",
      },
    ]);
  });

  it("stary format {pl,en} przechodzi bez zmian, puste wiersze odpadają", () => {
    const parsed = parseTierBenefits([
      { pl: "Zakładki", en: "Bookmarks" },
      { pl: "", en: "" },
    ]);
    expect(parsed).toEqual([{ pl: "Zakładki", en: "Bookmarks" }]);
    expect(serializeTierBenefits([{ pl: " ", en: "" }])).toEqual([]);
  });

  it("brakująca wersja językowa dziedziczy z drugiej (także w detalach)", () => {
    const json = serializeTierBenefits([{ pl: "Tylko PL", en: "", detail_pl: "Detal PL" }]);
    expect(json).toEqual([
      { pl: "Tylko PL", en: "Tylko PL", detail_pl: "Detal PL", detail_en: "Detal PL" },
    ]);
  });

  it("puste pola opcjonalne nie trafiają do JSON-a", () => {
    const json = serializeTierBenefits([
      { pl: "A", en: "A", detail_pl: " ", detail_en: "", group_pl: "", group_en: "" },
    ]);
    expect(json).toEqual([{ pl: "A", en: "A" }]);
  });
});

describe("tiersForAudience / sortTiers", () => {
  const audiences = [
    makeAudience({ key: "individual", sort_order: 0 }),
    makeAudience({ key: "business", sort_order: 10 }),
  ];

  it("filtruje po segmencie i sortuje po randze, potem sort_order", () => {
    const tiers = [
      makeTier({ key: "pro", rank: 20, audience_key: "individual" }),
      makeTier({ key: "reader", rank: 0, audience_key: "individual" }),
      makeTier({ key: "corporate", rank: 30, audience_key: "business" }),
      makeTier({ key: "member", rank: 10, audience_key: "individual" }),
    ];
    expect(tiersForAudience(tiers, audiences, "individual").map((t) => t.key)).toEqual([
      "reader",
      "member",
      "pro",
    ]);
    expect(tiersForAudience(tiers, audiences, "business").map((t) => t.key)).toEqual(["corporate"]);
  });

  it("warstwa bez segmentu lub z nieznanym kluczem laduje w pierwszym segmencie", () => {
    const tiers = [
      makeTier({ key: "orphan", rank: 5, audience_key: null }),
      makeTier({ key: "typo", rank: 6, audience_key: "does-not-exist" }),
    ];
    expect(tiersForAudience(tiers, audiences, "individual").map((t) => t.key)).toEqual([
      "orphan",
      "typo",
    ]);
    expect(tiersForAudience(tiers, audiences, "business")).toEqual([]);
  });

  it("remis rang rozstrzyga sort_order", () => {
    const tiers = [
      makeTier({ key: "ngo", rank: 10, sort_order: 50 }),
      makeTier({ key: "student", rank: 10, sort_order: 30 }),
      makeTier({ key: "educator", rank: 10, sort_order: 40 }),
    ];
    expect(sortTiers(tiers).map((t) => t.key)).toEqual(["student", "educator", "ngo"]);
  });
});

describe("wybór planu i matematyka oszczędności", () => {
  it("pickPlanForInterval preferuje interwał, spada na najtańszy cykliczny", () => {
    const month = makePlan({ interval: "month", price_cents: 4900 });
    const year = makePlan({ interval: "year", price_cents: 49000 });
    const pass = makePlan({ interval: "one_time", price_cents: 900 });
    expect(pickPlanForInterval([month, year, pass], "year")).toBe(year);
    expect(pickPlanForInterval([month, pass], "year")).toBe(month);
    expect(pickPlanForInterval([pass], "month")).toBeNull();
  });

  it("monthlyEquivalentCents zaokrągla cenę roczną do miesiąca", () => {
    expect(monthlyEquivalentCents(makePlan({ interval: "year", price_cents: 49900 }))).toBe(4158);
    expect(monthlyEquivalentCents(makePlan({ interval: "month", price_cents: 4900 }))).toBe(4900);
    expect(monthlyEquivalentCents(makePlan({ interval: "one_time" }))).toBeNull();
  });

  it("yearlySavingsPct liczy realny rabat i odmawia przy niespójnych danych", () => {
    const month = makePlan({ interval: "month", price_cents: 5000 });
    const year = makePlan({ interval: "year", price_cents: 50000 });
    expect(yearlySavingsPct(month, year)).toBe(17);
    expect(yearlySavingsPct(month, makePlan({ interval: "year", price_cents: 60000 }))).toBeNull();
    expect(
      yearlySavingsPct(month, makePlan({ interval: "year", price_cents: 50000, currency: "EUR" })),
    ).toBeNull();
    expect(yearlySavingsPct(null, year)).toBeNull();
  });

  it("intervalPair i maxYearlySavingsPct agregują po tier_key", () => {
    const plans = [
      makePlan({ tier_key: "member", interval: "month", price_cents: 5000 }),
      makePlan({ tier_key: "member", interval: "year", price_cents: 50000 }),
      makePlan({ tier_key: "pro", interval: "month", price_cents: 10000 }),
      makePlan({ tier_key: "pro", interval: "year", price_cents: 90000 }),
      makePlan({ tier_key: null, interval: "month", price_cents: 100 }),
    ];
    expect(plansByTierKey(plans).size).toBe(2);
    const pair = intervalPair(plans.filter((p) => p.tier_key === "member"));
    expect(pair.month?.price_cents).toBe(5000);
    expect(pair.year?.price_cents).toBe(50000);
    expect(maxYearlySavingsPct(plans)).toBe(25);
    expect(hasBothIntervals(plans)).toBe(true);
    expect(hasBothIntervals(plans.filter((p) => p.interval === "month"))).toBe(false);
  });
});

describe("groupBenefits", () => {
  it("grupuje tylko KOLEJNE benefity o tym samym nagłówku", () => {
    const benefits: TierBenefit[] = [
      { pl: "A", en: "A", group_pl: "Treści", group_en: "Content" },
      { pl: "B", en: "B", group_pl: "Treści", group_en: "Content" },
      { pl: "C", en: "C" },
      { pl: "D", en: "D", group_pl: "Treści", group_en: "Content" },
    ];
    const groups = groupBenefits(benefits, "pl");
    expect(groups.map((g) => [g.group, g.items.length])).toEqual([
      ["Treści", 2],
      [null, 1],
      ["Treści", 1],
    ]);
  });

  it("benefitText/benefitDetail honorują język z fallbackiem", () => {
    const b: TierBenefit = { pl: "Po polsku", en: "", detail_pl: "Detal" };
    expect(benefitText(b, "en")).toBe("Po polsku");
    expect(benefitDetail(b, "en")).toBe("Detal");
    expect(benefitDetail({ pl: "X", en: "X" }, "pl")).toBeNull();
  });
});

describe("faqForAudience", () => {
  it("zwraca pytania globalne + segmentowe, w kolejności wejściowej", () => {
    const items = [
      makeFaq({ sort_order: 10 }),
      makeFaq({ sort_order: 20, audience_key: "academic" }),
      makeFaq({ sort_order: 30, audience_key: "team" }),
    ];
    expect(faqForAudience(items, "academic").map((i) => i.sort_order)).toEqual([10, 20]);
    expect(faqForAudience(items, null).map((i) => i.sort_order)).toEqual([10]);
  });
});
