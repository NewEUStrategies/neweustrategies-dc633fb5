// `resolvePaywallOffer` - jedna reguła oferty ściany dla artykułu, symulatora
// czytelnika (S7) i testów (AD-16). Macierz: persona × reguła, lustro bramki
// SQL `has_content_access` (members / próg rangi / plany wskazane /
// premium_content) i filtrów katalogu (for_sale, pricing_visible, cta_mode).
import { describe, expect, it, vi } from "vitest";
import { accessPlan, accessRule } from "@/test/paywall/fixtures";
import {
  needsPaywallOffer,
  paywallHitReason,
  recordPaywallHit,
  resolvePaywallOffer,
  type OfferTier,
  type PaywallViewer,
} from "@/lib/access/paywallOffer";

const h = vi.hoisted(() => ({ rpc: vi.fn(), visitor: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args: unknown) => h.rpc(name, args) },
}));
vi.mock("@/lib/access/paywallHits.functions", () => ({
  recordPaywallHitVisitor: (input: unknown) => h.visitor(input),
}));

const TIERS: OfferTier[] = [
  { key: "free", rank: 0, name_pl: "Bezpłatny", features: {} },
  { key: "plus", rank: 1, name_pl: "Plus", features: { premium_content: true } },
  { key: "pro", rank: 2, name_pl: "Pro", features: { premium_content: true } },
  { key: "decision_lab", rank: 3, name_pl: "Decision Lab", features: { premium_content: true } },
];

const PLUS_M = accessPlan({ id: "plus-m", tier_key: "plus", price_cents: 4900 });
const PLUS_Y = accessPlan({
  id: "plus-y",
  tier_key: "plus",
  price_cents: 39900,
  interval: "year",
  sort_order: 2,
});
const PRO_M = accessPlan({ id: "pro-m", tier_key: "pro", price_cents: 9900, sort_order: 3 });
const LAB = accessPlan({ id: "lab", tier_key: "decision_lab", price_cents: 0, sort_order: 4 });
const CATALOG = [PLUS_M, PLUS_Y, PRO_M, LAB];

const guest: PaywallViewer = { signedIn: false, tierRank: 0 };
const member: PaywallViewer = { signedIn: true, tierRank: 0, tierKey: "free" };
const plus: PaywallViewer = { signedIn: true, tierRank: 1, tierKey: "plus" };
const pro: PaywallViewer = { signedIn: true, tierRank: 2, tierKey: "pro" };
const orgMember: PaywallViewer = { ...member, org: { name: "Fundacja X" } };

describe("resolvePaywallOffer - macierz person (P14)", () => {
  it("gość na treści płatnej widzi ceny i ścieżkę rejestracja -> kasa", () => {
    const offer = resolvePaywallOffer(accessRule({ mode: "paid" }), TIERS, CATALOG, guest);
    expect(offer.ctaKind).toBe("signup_then_checkout");
    expect(offer.plans.map((p) => p.id)).toEqual(["plus-m", "plus-y", "pro-m"]);
    // Rekomendacja = najtańszy w przeliczeniu na miesiąc: roczny Plus (33,25/mies.).
    expect(offer.recommendedPlan?.id).toBe("plus-y");
    expect(offer.reason).toBe("paid");
  });

  it("gość na members bez progu: rejestracja, bez katalogu", () => {
    const rule = accessRule({ mode: "members" });
    expect(needsPaywallOffer(rule)).toBe(false);
    expect(resolvePaywallOffer(rule, TIERS, CATALOG, guest).ctaKind).toBe("register");
  });

  it("zarejestrowany bez planu: kasa (checkout)", () => {
    const offer = resolvePaywallOffer(accessRule({ mode: "paid" }), TIERS, CATALOG, member);
    expect(offer.ctaKind).toBe("checkout");
  });

  it("ranga za niska na members z progiem: upgrade do warstwy progu, nie logowanie", () => {
    const rule = accessRule({ mode: "members", min_tier_rank: 2 });
    expect(needsPaywallOffer(rule)).toBe(true);
    const offer = resolvePaywallOffer(rule, TIERS, CATALOG, plus);
    expect(offer.ctaKind).toBe("upgrade");
    expect(offer.requiredTier?.key).toBe("pro");
    expect(offer.plans.map((p) => p.id)).toEqual(["pro-m"]);
    expect(offer.reason).toBe("tier_rank");
  });

  it("z planem spełniającym regułę: dostęp (treść czeka na serwer), bez sprzedaży", () => {
    const rule = accessRule({ mode: "members", min_tier_rank: 2 });
    expect(resolvePaywallOffer(rule, TIERS, CATALOG, pro).ctaKind).toBe("granted");
    // Legacy `paid` bez progu: premium_content warstwy czytelnika.
    expect(resolvePaywallOffer(accessRule({ mode: "paid" }), TIERS, CATALOG, plus).ctaKind).toBe(
      "granted",
    );
  });

  it("członek organizacji bez miejsca: kontakt z organizacją", () => {
    const offer = resolvePaywallOffer(accessRule({ mode: "paid" }), TIERS, CATALOG, orgMember);
    expect(offer.ctaKind).toBe("contact_org");
    expect(offer.orgName).toBe("Fundacja X");
    // Zakup prywatny zostaje jako opcja.
    expect(offer.plans.length).toBeGreaterThan(0);
  });

  it("plan na zapytanie: wyłącznie plany na zapytanie -> contact_sales", () => {
    const rule = accessRule({ mode: "members", min_tier_rank: 3 });
    const offer = resolvePaywallOffer(rule, TIERS, CATALOG, member);
    expect(offer.ctaKind).toBe("contact_sales");
    expect(offer.enquiryPlan?.id).toBe("lab");
    expect(offer.plans).toEqual([]);
    expect(resolvePaywallOffer(rule, TIERS, CATALOG, guest).ctaKind).toBe("contact_sales");
  });

  it("hasło: brak oferty, powód password", () => {
    const offer = resolvePaywallOffer(accessRule({ mode: "password" }), TIERS, CATALOG, member);
    expect(offer.ctaKind).toBe("none");
    expect(offer.reason).toBe("password");
    expect(paywallHitReason(accessRule({ mode: "password" }))).toBe("password");
  });
});

describe("resolvePaywallOffer - filtry katalogu", () => {
  it("plan_ids reguły zawężają ofertę do wskazanych planów (wybór redakcji)", () => {
    const rule = accessRule({ mode: "paid", plan_ids: ["pro-m"] });
    expect(resolvePaywallOffer(rule, TIERS, CATALOG, member).plans.map((p) => p.id)).toEqual([
      "pro-m",
    ]);
  });

  it("odpadają plany nieaktywne, wycofane ze sprzedaży i warstwy ukryte / bez CTA", () => {
    const tiers: OfferTier[] = [
      { key: "plus", rank: 1, features: { premium_content: true }, pricing_visible: false },
      { key: "pro", rank: 2, features: { premium_content: true }, cta_mode: "none" },
      { key: "max", rank: 3, features: { premium_content: true } },
    ];
    const plans = [
      accessPlan({ id: "a", tier_key: "plus" }),
      accessPlan({ id: "b", tier_key: "pro" }),
      accessPlan({ id: "c", tier_key: "max", active: false }),
      accessPlan({ id: "d", tier_key: "max", for_sale: false }),
      accessPlan({ id: "e", tier_key: "max" }),
    ];
    const offer = resolvePaywallOffer(accessRule({ mode: "paid" }), tiers, plans, member);
    expect(offer.plans.map((p) => p.id)).toEqual(["e"]);
  });

  it("warstwa cta_mode=contact to plan na zapytanie, nie kasa", () => {
    const tiers: OfferTier[] = [{ key: "biz", rank: 2, cta_mode: "contact" }];
    const plans = [accessPlan({ id: "biz-m", tier_key: "biz" })];
    const offer = resolvePaywallOffer(
      accessRule({ mode: "members", min_tier_rank: 2 }),
      tiers,
      plans,
      member,
    );
    expect(offer.ctaKind).toBe("contact_sales");
    expect(offer.enquiryPlan?.id).toBe("biz-m");
  });

  it("brak czegokolwiek do kupienia: gość dostaje rejestrację, zalogowany - nic", () => {
    const rule = accessRule({ mode: "paid", plan_ids: ["nieistniejacy"] });
    expect(resolvePaywallOffer(rule, TIERS, CATALOG, guest).ctaKind).toBe("register");
    expect(resolvePaywallOffer(rule, TIERS, CATALOG, member).ctaKind).toBe("none");
  });

  it("remis ceny miesięcznej rozstrzyga kolejność redakcyjna", () => {
    const plans = [
      accessPlan({ id: "late", tier_key: "plus", price_cents: 4900, sort_order: 5 }),
      accessPlan({ id: "early", tier_key: "plus", price_cents: 4900, sort_order: 1 }),
    ];
    expect(
      resolvePaywallOffer(accessRule({ mode: "paid" }), TIERS, plans, member).recommendedPlan?.id,
    ).toBe("early");
  });
});

describe("recordPaywallHit - pomiar bez wpływu na ścianę", () => {
  const hit = {
    entityType: "post" as const,
    entityId: "00000000-0000-4000-8000-000000000001",
    reason: "paid" as const,
    requiredTierKey: null,
    variant: "default",
  };

  it("konto: literalne RPC z parametrami funkcji SQL", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    await recordPaywallHit(true, hit);
    expect(h.rpc).toHaveBeenCalledWith("record_paywall_hit", {
      p_entity_type: "post",
      p_entity_id: hit.entityId,
      p_reason: "paid",
      p_required_tier_key: null,
      p_variant: "default",
    });
  });

  it("gość: server fn (tożsamość z podpisanego cookie po stronie serwera)", async () => {
    h.visitor.mockResolvedValueOnce(true);
    await recordPaywallHit(false, hit);
    expect(h.visitor).toHaveBeenCalledWith({ data: hit });
  });

  it("błąd RPC i wyjątek transportu są połykane", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom", code: "42501" } });
    await expect(recordPaywallHit(true, hit)).resolves.toBeUndefined();
    h.visitor.mockRejectedValueOnce(new Error("network"));
    await expect(recordPaywallHit(false, hit)).resolves.toBeUndefined();
  });
});
