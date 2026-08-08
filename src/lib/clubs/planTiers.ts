// Słownik progów planu dla klubów dyskusyjnych.
//
// W bazie `clubs.min_tier_rank` jest liczbą (rangą planu z `membership_tiers`),
// ale administrator nie powinien musieć znać rang - wybiera plan z listy.
// Rangi odpowiadają wpisom w `public.membership_tiers`.
export const CLUB_PLAN_TIERS = ["free", "plus", "pro", "vip"] as const;

export type ClubPlanTier = (typeof CLUB_PLAN_TIERS)[number];

export const CLUB_PLAN_TIER_RANK: Record<ClubPlanTier, number> = {
  free: 0,
  plus: 10,
  pro: 20,
  vip: 25,
};

/** Domyślny próg planu dla nowego klubu. */
export const DEFAULT_CLUB_PLAN_TIER: ClubPlanTier = "pro";
export const DEFAULT_CLUB_MIN_TIER_RANK = CLUB_PLAN_TIER_RANK[DEFAULT_CLUB_PLAN_TIER];

/**
 * Ranga -> plan. Ranga spoza słownika (np. 28 z planu partnerskiego)
 * degraduje się do najbliższego niższego progu, żeby droplista zawsze
 * pokazywała spójną wartość zamiast pustego pola.
 */
export function planTierFromRank(rank: number): ClubPlanTier {
  const safe = Number.isFinite(rank) ? rank : 0;
  let match: ClubPlanTier = "free";
  for (const tier of CLUB_PLAN_TIERS) {
    if (safe >= CLUB_PLAN_TIER_RANK[tier]) match = tier;
  }
  return match;
}

export function rankFromPlanTier(tier: ClubPlanTier): number {
  return CLUB_PLAN_TIER_RANK[tier];
}
