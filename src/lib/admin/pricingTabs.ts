// KONTRAKT PARAMETRÓW URL /admin/pricing i /admin/membership (SPEC §2.6:
// `/admin/pricing?tab=audiences|tiers|faq|retention`, `/admin/membership?tier=<key>`).
//
// DLACZEGO LIŚĆ BEZ ŻADNEGO IMPORTU. `validateSearch` obu tras jedzie
// w powłoce, czyli w chunku WEJŚCIOWYM każdej strony; import modułu danych
// cennika wciągnąłby jego drzewo do pierwszego wejścia czytelnika. Test
// `pricingTabs.test.ts` czyta to źródło i pilnuje zera importów (wzór:
// `lib/revenue/search.ts`).
//
// DWIE TRASY W JEDNYM LIŚCIU ŚWIADOMIE: cennik i członkostwo to dwie połowy
// jednej warstwy (marketing vs rdzeń, `syncManifest.ts`) i linkują do siebie
// nawzajem (`LinkedSourceHeader`) - jeden plik trzyma obie listy zakładek
// i jeden kształt klucza warstwy.

/** Zakładki `/admin/pricing` w kolejności paska. */
export const PRICING_TABS = ["audiences", "tiers", "faq", "retention"] as const;
export type PricingTabId = (typeof PRICING_TABS)[number];

/** Zakładki `/admin/membership` w kolejności paska. */
export const MEMBERSHIP_TABS = ["tiers", "mapping", "grants", "orgs"] as const;
export type MembershipTabId = (typeof MEMBERSHIP_TABS)[number];

export interface PricingSearch {
  tab?: PricingTabId;
}

export interface MembershipSearch {
  tab?: MembershipTabId;
  /** Klucz warstwy (`membership_tiers.key`) - otwiera jej edytor. */
  tier?: string;
}

/**
 * Kształt klucza warstwy - ten sam, który wymusza formularz nowej warstwy.
 * Spacje, ukośniki i znaczniki odpadają, zanim trafią do zapytania albo
 * `aria-label`.
 */
const TIER_KEY = /^[a-z0-9_]{1,64}$/;

function oneOf<T extends string>(list: readonly T[], raw: unknown): T | undefined {
  return typeof raw === "string" && (list as readonly string[]).includes(raw)
    ? (raw as T)
    : undefined;
}

export function isPricingTab(raw: unknown): raw is PricingTabId {
  return oneOf(PRICING_TABS, raw) !== undefined;
}

export function isMembershipTab(raw: unknown): raw is MembershipTabId {
  return oneOf(MEMBERSHIP_TABS, raw) !== undefined;
}

/**
 * Walidator `validateSearch` trasy `/admin/pricing`. Nieznana wartość daje
 * `undefined` (zakładka domyślna). Klucz obecny w adresie z wartością
 * odrzuconą wraca jako jawne `undefined`, bo router składa wynik walidatora
 * z surowym adresem - pominięty klucz przepuściłby surowe `?tab=x` do
 * komponentu (wzorzec `parseRevenueHubSearch`).
 */
export function parsePricingSearch(raw: Record<string, unknown>): PricingSearch {
  const out: PricingSearch = {};
  if ("tab" in raw) out.tab = oneOf(PRICING_TABS, raw.tab);
  return out;
}

/**
 * Walidator `validateSearch` trasy `/admin/membership`.
 *
 * Router parsuje adres przez `JSON.parse`, więc `?tier=2026` przychodzi jako
 * LICZBA - to wciąż klucz, który ktoś wkleił, więc wraca jako tekst, zamiast
 * po cichu zamykać dialog warstwy.
 */
export function parseMembershipSearch(raw: Record<string, unknown>): MembershipSearch {
  const out: MembershipSearch = {};
  if ("tab" in raw) out.tab = oneOf(MEMBERSHIP_TABS, raw.tab);
  if ("tier" in raw) {
    const text =
      typeof raw.tier === "string"
        ? raw.tier
        : typeof raw.tier === "number" && Number.isSafeInteger(raw.tier) && raw.tier >= 0
          ? String(raw.tier)
          : undefined;
    out.tier = text !== undefined && TIER_KEY.test(text) ? text : undefined;
  }
  return out;
}
