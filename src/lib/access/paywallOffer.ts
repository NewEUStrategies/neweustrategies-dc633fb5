// OFERTA PAYWALLA CZYTELNIKA (SPEC AD-16, P14): jedna czysta reguła
// `resolvePaywallOffer()` dla trzech konsumentów - ściany w artykule,
// symulatora czytelnika w hubie (S7, `Paywall preview`) i testów.
//
// DEFEKT. Ściana pokazywała plany wyłącznie zalogowanemu i wyłącznie z listy
// `plan_ids` reguły: gość na treści płatnej nie widział ani jednej ceny,
// a zalogowany z rangą za niską na treści `members` z progiem dostawał
// komunikat bez żadnego CTA (ślepy zaułek lejka). Symulator musiałby te same
// decyzje powtórzyć osobno - i rozjechałby się z produkcją.
//
// ZMIANA. Reguła lustrzana do bramki SQL `has_content_access`:
//   * `members` bez progu - wystarczy konto (gość: rejestracja);
//   * próg rangi (`min_tier_rank` > 0) - plan warstwy z rangą >= progu;
//   * `paid` z `plan_ids` - wskazane plany (wybór redakcji);
//   * `paid` bez planów i bez progu - warstwy z `premium_content`.
// Plany: aktywne, `for_sale !== false`, warstwa z `pricing_visible !== false`;
// plany na zapytanie (`isEnquiryOnlyPlan`, warstwa `cta_mode = contact`) dają
// `contact_sales`, warstwa `cta_mode = none` nie ma CTA. Rekomendacja =
// najtańszy plan w przeliczeniu na miesiąc (remis: kolejność redakcyjna).
//
// BUDŻET `public`. Ściana importuje ten moduł przez `import()` dopiero po
// pierwszym renderze (plan B karty S3), a dane - katalog planów, warstwy,
// warstwę i organizację czytelnika - pobiera tymi samymi funkcjami co cennik
// i profil (`fetchActivePlans`, `fetchMembershipTiers`, `fetchCurrentTier`,
// `fetchMyOrganization`), więc nie dokłada drugiej kopii zapytań.
import type { AccessPlan, ContentAccessRule } from "@/hooks/useContentAccess";
import { isEnquiryOnlyPlan } from "@/lib/billing/enquiryPlans";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";

export type PaywallCtaKind =
  | "signup_then_checkout"
  | "checkout"
  | "upgrade"
  | "contact_org"
  | "contact_sales"
  | "register"
  | "granted"
  | "none";

/** Powód uderzenia w ścianę - biała lista `record_paywall_hit` (SQL). */
export type PaywallHitReason =
  "members" | "paid" | "tier_rank" | "password" | "quota" | "registration";

/** Warstwa w kształcie wiersza `membership_tiers` (kolumny, których reguła używa). */
export interface OfferTier {
  key: string;
  rank: number;
  name_pl?: string | null;
  name_en?: string | null;
  features?: unknown;
  pricing_visible?: boolean | null;
  cta_mode?: string | null;
}

/** Czytelnik: z sesji i RPC (produkcja) albo z persony symulatora (`preview`). */
export interface PaywallViewer {
  signedIn: boolean;
  /** Ranga warstwy w najemcy treści (0 = bez planu). */
  tierRank: number;
  tierKey?: string | null;
  /** Organizacja członkowska, przez którą czytelnik ma (albo miał) miejsce. */
  org?: { name: string } | null;
}

export interface PaywallOffer {
  ctaKind: PaywallCtaKind;
  reason: PaywallHitReason;
  requiredTier: OfferTier | null;
  /** Plany do kupienia przez kasę, w kolejności redakcyjnej. */
  plans: AccessPlan[];
  recommendedPlan: AccessPlan | null;
  /** Plan na zapytanie (formularz zamiast kasy) - cel `contact_sales`. */
  enquiryPlan: AccessPlan | null;
  /** Nazwa organizacji dla `contact_org`. */
  orgName: string | null;
}

type OfferRule = Pick<ContentAccessRule, "mode" | "plan_ids" | "min_tier_rank">;

/** Miesiące okresu - do porównania cen różnych interwałów. */
const MONTHS: Record<AccessPlan["interval"], number> = {
  two_weeks: 12 / 26,
  month: 1,
  quarter: 3,
  year: 12,
  one_time: 12,
};

function hasPremium(tier: OfferTier | undefined): boolean {
  const features = tier?.features;
  return (
    typeof features === "object" &&
    features !== null &&
    (features as Record<string, unknown>).premium_content === true
  );
}

export function paywallHitReason(rule: OfferRule): PaywallHitReason {
  if (rule.mode === "password") return "password";
  if ((rule.min_tier_rank ?? 0) > 0) return "tier_rank";
  return rule.mode === "members" ? "members" : "paid";
}

/** Czy oferta wymaga katalogu planów (gość na `members` bez progu - nie). */
export function needsPaywallOffer(rule: OfferRule): boolean {
  return rule.mode === "paid" || (rule.mode === "members" && (rule.min_tier_rank ?? 0) > 0);
}

export function resolvePaywallOffer(
  rule: OfferRule,
  tiers: readonly OfferTier[],
  plans: readonly AccessPlan[],
  viewer: PaywallViewer,
): PaywallOffer {
  const minRank = Math.max(0, rule.min_tier_rank ?? 0);
  const tierOf = new Map(tiers.map((tier) => [tier.key, tier]));
  const tierFor = (plan: AccessPlan) => tierOf.get(plan.tier_key ?? "");
  const requiredTier =
    minRank > 0
      ? ([...tiers].sort((a, b) => a.rank - b.rank).find((tier) => tier.rank >= minRank) ?? null)
      : null;
  const offer: PaywallOffer = {
    ctaKind: "none",
    reason: paywallHitReason(rule),
    requiredTier,
    plans: [],
    recommendedPlan: null,
    enquiryPlan: null,
    orgName: viewer.org?.name ?? null,
  };
  if (rule.mode !== "paid" && rule.mode !== "members") return offer;

  const targeted = rule.mode === "paid" ? rule.plan_ids : [];
  const grants = (plan: AccessPlan) =>
    targeted.length > 0
      ? targeted.includes(plan.id)
      : minRank > 0
        ? (tierFor(plan)?.rank ?? 0) >= minRank
        : rule.mode === "paid" && hasPremium(tierFor(plan));
  const visible = plans.filter(
    (plan) =>
      plan.active &&
      plan.for_sale !== false &&
      tierFor(plan)?.pricing_visible !== false &&
      tierFor(plan)?.cta_mode !== "none" &&
      grants(plan),
  );
  const enquiry = (plan: AccessPlan) =>
    isEnquiryOnlyPlan(plan) || tierFor(plan)?.cta_mode === "contact";
  offer.plans = visible.filter((plan) => !enquiry(plan));
  offer.enquiryPlan = visible.find(enquiry) ?? null;
  offer.recommendedPlan =
    [...offer.plans].sort(
      (a, b) =>
        a.price_cents / MONTHS[a.interval] - b.price_cents / MONTHS[b.interval] ||
        a.sort_order - b.sort_order,
    )[0] ?? null;

  const needsPlan = rule.mode === "paid" || minRank > 0;
  const fallback: PaywallCtaKind = offer.plans.length
    ? viewer.tierRank > 0
      ? "upgrade"
      : "checkout"
    : offer.enquiryPlan
      ? "contact_sales"
      : "none";
  if (!viewer.signedIn) {
    offer.ctaKind = !needsPlan
      ? "register"
      : offer.plans.length
        ? "signup_then_checkout"
        : offer.enquiryPlan
          ? "contact_sales"
          : "register";
    return offer;
  }
  // Ta sama drabinka co `has_content_access`: zalogowany, który regułę
  // spełnia, czeka tylko na treść z serwera (np. webhook po zakupie).
  const granted = !needsPlan
    ? true
    : minRank > 0
      ? viewer.tierRank >= minRank
      : hasPremium(tierOf.get(viewer.tierKey ?? ""));
  offer.ctaKind = granted ? "granted" : viewer.org ? "contact_org" : fallback;
  return offer;
}

/** Dane oferty z bazy + rozstrzygnięcie. Rzuca, gdy katalog się nie wczytał. */
export async function loadPaywallOffer(
  rule: OfferRule,
  signedIn: boolean,
  persona: PaywallViewer | null,
): Promise<PaywallOffer> {
  const [{ fetchActivePlans }, tiersModule] = await Promise.all([
    import("@/lib/billing/queries"),
    import("@/lib/billing/tiers"),
  ]);
  // Warstwa i organizacja czytelnika to dodatek: ich błąd nie zabiera oferty,
  // czytelnik dostaje wtedy ścieżkę jak bez planu.
  const readViewer = async (): Promise<PaywallViewer> => {
    if (persona) return persona;
    if (!signedIn) return { signedIn: false, tierRank: 0 };
    const [tier, org] = await Promise.all([
      tiersModule.fetchCurrentTier().catch(() => null),
      import("@/lib/billing/membership").then((m) => m.fetchMyOrganization()).catch(() => null),
    ]);
    return {
      signedIn: true,
      tierRank: tier?.rank ?? 0,
      tierKey: tier?.key ?? null,
      org: org ? { name: org.name } : null,
    };
  };
  const [plans, tiers, viewer] = await Promise.all([
    fetchActivePlans(),
    tiersModule.fetchMembershipTiers(),
    readViewer(),
  ]);
  return resolvePaywallOffer(rule, tiers as OfferTier[], plans as AccessPlan[], viewer);
}

export interface PaywallHitInput {
  entityType: "post" | "page" | "media" | "club";
  entityId: string;
  reason: PaywallHitReason;
  requiredTierKey: string | null;
  variant: string;
}

/**
 * Pomiar serwerowy uderzenia w ścianę (`record_paywall_hit`): bez zgody
 * analitycznej (podstawa: umowa, licznik bez identyfikatora przeglądarki)
 * i BEZ wpływu na ścianę - każdy błąd jest połykany.
 */
export async function recordPaywallHit(signedIn: boolean, hit: PaywallHitInput): Promise<void> {
  try {
    if (signedIn) {
      const { supabase } = await import("@/integrations/supabase/client");
      await (supabase as unknown as RpcCallable).rpc("record_paywall_hit", {
        p_entity_type: hit.entityType,
        p_entity_id: hit.entityId,
        p_reason: hit.reason,
        p_required_tier_key: hit.requiredTierKey,
        p_variant: hit.variant,
      });
      return;
    }
    const { recordPaywallHitVisitor } = await import("./paywallHits.functions");
    await recordPaywallHitVisitor({ data: hit });
  } catch {
    // Pomiar nigdy nie psuje ściany.
  }
}
