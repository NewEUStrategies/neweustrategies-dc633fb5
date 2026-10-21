// Wiersze warstw członkostwa w kształcie `membership_tiers` (flagi i benefity)
// dla testów zakładki Oferta. Bez JSX - moduł bywa czytany z fabryk `vi.mock`.

/**
 * Warstwy: Plus obiecuje briefingi, których nie włącza (konflikt „broken"),
 * i bibliotekę bez bramki (konflikt „decorative"); Pro ma komplet, a nagrania
 * włącza bez obietnicy („silent").
 */
export const TIER_ROWS = [
  {
    id: "tier-plus",
    key: "plus",
    rank: 1,
    name_pl: "Plus",
    name_en: "Plus",
    active: true,
    pricing_visible: true,
    updated_at: "2026-10-01T10:00:00.000000+00:00",
    features: { premium_content: true, member_library: true },
    benefits: [
      { pl: "Analizy premium", en: "Premium analyses", capability_key: "premium_content" },
      { pl: "Briefingi Pro", en: "Pro briefings", capability_key: "pro_briefings" },
      { pl: "Biblioteka", en: "Library", capability_key: "member_library" },
    ],
  },
  {
    id: "tier-pro",
    key: "pro",
    rank: 2,
    name_pl: "Pro",
    name_en: "Pro",
    active: true,
    pricing_visible: true,
    updated_at: "2026-10-01T10:00:00.000000+00:00",
    features: { premium_content: true, pro_briefings: true, recordings: true },
    benefits: [
      { pl: "Analizy premium", en: "Premium analyses", capability_key: "premium_content" },
      { pl: "Briefingi Pro", en: "Pro briefings", capability_key: "pro_briefings" },
    ],
  },
] as const;
