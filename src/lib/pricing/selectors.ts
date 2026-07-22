// Czyste selektory Cennika 2.0 - cała logika prezentacji cen poza JSX-em,
// testowalna jednostkowo. Zasady (psychologia wyboru a la Netflix/Apple,
// benefity a la NYT/FT) są zakodowane tu, nie rozsiane po komponentach:
//  - drabinka warstw rosnąco po randze (kotwica = highlight w środku),
//  - framing ceny rocznej jako równowartości miesięcznej + realny % zniżki,
//  - segment odbiorcy nigdy nie "gubi" warstw (nieznane klucze -> pierwszy
//    segment), więc redakcyjne literówki nie chowają oferty.
import type { AccessPlan } from "@/lib/billing/types";
import type { MembershipTierRow, TierBenefit } from "@/lib/billing/tiers";
import type { PricingAudienceRow, PricingFaqItemRow } from "./queries";

export type BillingInterval = "month" | "year";

const AUDIENCE_KEY_RE = /^[a-z0-9_-]{2,32}$/;

/** Walidacja parametru ?audience= z URL (deep-link do segmentu). */
export function sanitizeAudienceKey(value: unknown): string | undefined {
  return typeof value === "string" && AUDIENCE_KEY_RE.test(value) ? value : undefined;
}

export function audienceName(
  audience: Pick<PricingAudienceRow, "name_pl" | "name_en">,
  lang: string,
): string {
  return lang === "en"
    ? audience.name_en || audience.name_pl
    : audience.name_pl || audience.name_en;
}

export function audienceTagline(
  audience: Pick<PricingAudienceRow, "tagline_pl" | "tagline_en">,
  lang: string,
): string | null {
  const value =
    lang === "en"
      ? audience.tagline_en || audience.tagline_pl
      : audience.tagline_pl || audience.tagline_en;
  return value && value.trim() ? value : null;
}

export function tierBadge(
  tier: Pick<MembershipTierRow, "badge_pl" | "badge_en">,
  lang: string,
): string | null {
  const value = lang === "en" ? tier.badge_en || tier.badge_pl : tier.badge_pl || tier.badge_en;
  return value && value.trim() ? value : null;
}

/**
 * Tryb CTA karty: 'auto' (checkout/kontakt wg danych), 'contact' (zawsze
 * rozmowa - np. zakup zespołowy per miejsce), 'none' (bez przycisku -
 * poziomy "tylko na zaproszenie"). Nieznane wartości degradują do 'auto'.
 */
export type TierCtaMode = "auto" | "contact" | "none";

export function tierCtaMode(tier: Pick<MembershipTierRow, "cta_mode">): TierCtaMode {
  return tier.cta_mode === "contact" || tier.cta_mode === "none" ? tier.cta_mode : "auto";
}

/** Notka pod ceną (np. "2-20 miejsc", "Preferencyjnie, na fakturę"). */
export function tierPriceNote(
  tier: Pick<MembershipTierRow, "price_note_pl" | "price_note_en">,
  lang: string,
): string | null {
  const value =
    lang === "en"
      ? tier.price_note_en || tier.price_note_pl
      : tier.price_note_pl || tier.price_note_en;
  return value && value.trim() ? value : null;
}

/** Pasek zaufania segmentu ("Faktura · Umowa roczna · Wdrożenie z opiekunem"). */
export function audienceTrust(
  audience: Pick<PricingAudienceRow, "trust_pl" | "trust_en">,
  lang: string,
): string | null {
  const value =
    lang === "en" ? audience.trust_en || audience.trust_pl : audience.trust_pl || audience.trust_en;
  return value && value.trim() ? value : null;
}

/** Rosnąca drabinka wartości: ranga, potem kolejność redakcyjna. */
export function sortTiers(tiers: MembershipTierRow[]): MembershipTierRow[] {
  return [...tiers].sort(
    (a, b) => a.rank - b.rank || a.sort_order - b.sort_order || a.key.localeCompare(b.key),
  );
}

/**
 * Warstwy segmentu. Warstwa bez segmentu (lub ze skasowanym/nieznanym kluczem)
 * trafia do PIERWSZEGO aktywnego segmentu - oferta nigdy nie znika ze strony
 * przez rozjazd danych.
 */
export function tiersForAudience(
  tiers: MembershipTierRow[],
  audiences: PricingAudienceRow[],
  audienceKey: string,
): MembershipTierRow[] {
  const known = new Set(audiences.map((a) => a.key));
  const fallback = audiences[0]?.key;
  return sortTiers(
    tiers.filter((tier) => {
      const effective =
        tier.audience_key && known.has(tier.audience_key) ? tier.audience_key : fallback;
      return effective === audienceKey;
    }),
  );
}

export function plansByTierKey(plans: AccessPlan[]): Map<string, AccessPlan[]> {
  const map = new Map<string, AccessPlan[]>();
  for (const plan of plans) {
    if (!plan.tier_key) continue;
    const list = map.get(plan.tier_key);
    if (list) list.push(plan);
    else map.set(plan.tier_key, [plan]);
  }
  return map;
}

function cheapest(plans: AccessPlan[]): AccessPlan | null {
  if (plans.length === 0) return null;
  return [...plans].sort((a, b) => a.price_cents - b.price_cents)[0];
}

/** Plany cykliczne (miesiąc/rok) - budują karty warstw. */
export function recurringPlans(plans: AccessPlan[]): AccessPlan[] {
  return plans.filter((p) => p.interval === "month" || p.interval === "year");
}

/** Przepustki: dostęp jednorazowy / dzienny / tygodniowy. */
export function passPlans(plans: AccessPlan[]): AccessPlan[] {
  return plans.filter(
    (p) => p.interval === "one_time" || p.interval === "day" || p.interval === "week",
  );
}

/**
 * Plan do pokazania na karcie warstwy dla wybranego interwału. Gdy warstwa
 * nie ma planu w tym interwale, uczciwie pokazujemy najtańszy plan z drugiego
 * (etykieta ceny zawsze podaje realny cykl rozliczenia).
 */
export function pickPlanForInterval(
  plans: AccessPlan[],
  interval: BillingInterval,
): AccessPlan | null {
  const recurring = recurringPlans(plans);
  const exact = cheapest(recurring.filter((p) => p.interval === interval));
  if (exact) return exact;
  return cheapest(recurring);
}

/** Równowartość miesięczna (framing ceny rocznej jak u Netflixa/Apple). */
export function monthlyEquivalentCents(plan: AccessPlan): number | null {
  if (plan.interval === "month") return plan.price_cents;
  if (plan.interval === "year") return Math.round(plan.price_cents / 12);
  return null;
}

/** Realny procent oszczędności rocznej vs 12 x miesięcznie (nigdy wymyślony). */
export function yearlySavingsPct(
  monthly: AccessPlan | null,
  yearly: AccessPlan | null,
): number | null {
  if (!monthly || !yearly) return null;
  if (monthly.currency !== yearly.currency) return null;
  const fullYear = monthly.price_cents * 12;
  if (fullYear <= 0 || yearly.price_cents >= fullYear) return null;
  return Math.round((1 - yearly.price_cents / fullYear) * 100);
}

/** Para plan-miesięczny/plan-roczny dla warstwy (do wyliczeń oszczędności). */
export function intervalPair(plans: AccessPlan[]): {
  month: AccessPlan | null;
  year: AccessPlan | null;
} {
  const recurring = recurringPlans(plans);
  return {
    month: cheapest(recurring.filter((p) => p.interval === "month")),
    year: cheapest(recurring.filter((p) => p.interval === "year")),
  };
}

/** Największa oszczędność roczna w zbiorze planów - badge na przełączniku. */
export function maxYearlySavingsPct(plans: AccessPlan[]): number | null {
  let max: number | null = null;
  for (const list of plansByTierKey(plans).values()) {
    const pair = intervalPair(list);
    const pct = yearlySavingsPct(pair.month, pair.year);
    if (pct !== null && (max === null || pct > max)) max = pct;
  }
  return max;
}

/** Czy w zbiorze planów są oba interwały cykliczne (widoczność przełącznika). */
export function hasBothIntervals(plans: AccessPlan[]): boolean {
  const recurring = recurringPlans(plans);
  return (
    recurring.some((p) => p.interval === "month") && recurring.some((p) => p.interval === "year")
  );
}

export interface BenefitGroup {
  group: string | null;
  items: TierBenefit[];
}

export function benefitText(benefit: TierBenefit, lang: string): string {
  return lang === "en" ? benefit.en || benefit.pl : benefit.pl || benefit.en;
}

export function benefitDetail(benefit: TierBenefit, lang: string): string | null {
  const value =
    lang === "en" ? benefit.detail_en || benefit.detail_pl : benefit.detail_pl || benefit.detail_en;
  return value && value.trim() ? value : null;
}

/**
 * Grupowanie benefitów po nagłówkach sekcji (styl FT). Grupują się wyłącznie
 * KOLEJNE benefity z tym samym nagłówkiem - kolejność redakcyjna z panelu
 * pozostaje nienaruszona.
 */
export function groupBenefits(benefits: TierBenefit[], lang: string): BenefitGroup[] {
  const groups: BenefitGroup[] = [];
  for (const benefit of benefits) {
    const raw =
      lang === "en" ? benefit.group_en || benefit.group_pl : benefit.group_pl || benefit.group_en;
    const label = raw && raw.trim() ? raw.trim() : null;
    const last = groups[groups.length - 1];
    if (last && last.group === label) last.items.push(benefit);
    else groups.push({ group: label, items: [benefit] });
  }
  return groups;
}

export function faqQuestion(item: PricingFaqItemRow, lang: string): string {
  return lang === "en"
    ? item.question_en || item.question_pl
    : item.question_pl || item.question_en;
}

export function faqAnswer(item: PricingFaqItemRow, lang: string): string {
  return lang === "en" ? item.answer_en || item.answer_pl : item.answer_pl || item.answer_en;
}

/** FAQ segmentu: pytania globalne + oznaczone bieżącym segmentem. */
export function faqForAudience(
  items: PricingFaqItemRow[],
  audienceKey: string | null,
): PricingFaqItemRow[] {
  return items.filter((item) => item.audience_key === null || item.audience_key === audienceKey);
}
