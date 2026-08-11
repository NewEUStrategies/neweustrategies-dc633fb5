// Słownik progów planu dla klubów dyskusyjnych.
//
// W bazie `clubs.min_tier_rank` jest liczbą (rangą planu z `membership_tiers`),
// ale administrator nie powinien musieć znać rang - wybiera plan z listy.
// Rangi odpowiadają wpisom w `public.membership_tiers`.
//
// Słownik obejmuje CAŁY katalog cenowy powyżej progu Plus (`20260722230000…`:
// pro 20, vip 25, corporate 30, partner 40, partner_general 50,
// presidents_circle 60). Wcześniej kończył się na 25, więc klub z progiem 30
// wyświetlał się jako „VIP" i ponowny wybór tej samej pozycji z droplisty cicho
// obniżał próg do 25 - wpuszczając VIP-ów do klubu zastrzeżonego dla Enterprise.
//
// Jeden wpis na RANGĘ, nie na klucz katalogu: rangę 0 nosi `reader`, rangę 10
// `member`, `student` i `educator`, rangę 20 także `ngo`, a rangę 25 także
// `team`. Nazwy `free`/`plus` są tu handlowymi etykietami rang 0 i 10, żeby
// odwzorowanie ranga -> pozycja droplisty pozostało jednoznaczne. Rangi 5
// (`supporter`) nie ma świadomie - nie jest progiem, na którym ktokolwiek
// bramkuje klub, a jej dodanie zmieniłoby znaczenie istniejących progów 0-9.
export const CLUB_PLAN_TIERS = [
  "free",
  "plus",
  "pro",
  "vip",
  "corporate",
  "partner",
  "partner_general",
  "presidents_circle",
] as const;

export type ClubPlanTier = (typeof CLUB_PLAN_TIERS)[number];

// Kolejność wpisów = kolejność rosnąca rang; `planTierFromRank` przechodzi
// `CLUB_PLAN_TIERS` po kolei, więc rozsypanie tej kolejności psuje wybór progu.
export const CLUB_PLAN_TIER_RANK: Record<ClubPlanTier, number> = {
  free: 0,
  plus: 10,
  pro: 20,
  vip: 25,
  corporate: 30,
  partner: 40,
  partner_general: 50,
  presidents_circle: 60,
};

/** Domyślny próg planu dla nowego klubu. */
export const DEFAULT_CLUB_PLAN_TIER: ClubPlanTier = "pro";
export const DEFAULT_CLUB_MIN_TIER_RANK = CLUB_PLAN_TIER_RANK[DEFAULT_CLUB_PLAN_TIER];

/**
 * Ranga -> plan. Ranga spoza słownika (np. 35 z ręcznego grantu) degraduje się
 * do najbliższego niższego progu, żeby droplista zawsze pokazywała spójną
 * wartość zamiast pustego pola.
 *
 * Degradacja jest jednokierunkowa i dlatego NIE wolno zapisywać wyświetlanej
 * wartości bez zmiany wyboru - miejsce zapisu (`ClubAccessTab`) porównuje rangę
 * przed emisją `onChange`.
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
