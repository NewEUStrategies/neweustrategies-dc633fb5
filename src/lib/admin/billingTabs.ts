// KONTRAKT PARAMETRÓW URL /admin/billing (SPEC §2.6:
// `/admin/billing?tab=subscriptions|orders|events&status=`).
//
// DLACZEGO LIŚĆ BEZ ŻADNEGO IMPORTU. `validateSearch` trasy jedzie w powłoce,
// czyli w chunku WEJŚCIOWYM każdej strony; import modułu rozliczeń wciągnąłby
// jego drzewo do pierwszego wejścia czytelnika. Test `billingTabs.test.ts`
// czyta to źródło i pilnuje zera importów (wzór: `lib/revenue/search.ts`).
//
// KONTRAKT Z S2. Zakładki renderuje `AdminBillingPanel` (wycinek S2), który
// dziś trzyma je w `useState`. S1 dostarcza listę, typ i walidator; S2 dodaje
// panelowi propsy `tab` / `onTabChange` / `statusFilter` (PLAN S1 §3.3). Lista
// musi więc mieć DOKŁADNIE wartości `TabsTrigger` panelu.

/** Zakładki rozliczeń w kolejności paska `AdminBillingPanel`. */
export const BILLING_TABS = [
  "subscriptions",
  "orders",
  "tickets",
  "events",
  "diagnostics",
] as const;
export type BillingTabId = (typeof BILLING_TABS)[number];

export interface BillingSearch {
  tab?: BillingTabId;
  /**
   * Filtr statusu listy otwartej zakładki (`active`, `past_due`, `paid`…).
   * Zbiór wartości zależy od zakładki (subskrypcja operatora vs zamówienie),
   * więc liść pilnuje tylko KSZTAŁTU; nieznany status panel traktuje jak
   * „wszystkie".
   */
  status?: string;
}

/** Statusy operatora i zamówień: `snake_case`, małe litery, krótkie. */
const STATUS = /^[a-z][a-z_]{0,31}$/;

export function isBillingTab(raw: unknown): raw is BillingTabId {
  return typeof raw === "string" && (BILLING_TABS as readonly string[]).includes(raw);
}

/**
 * Walidator `validateSearch` trasy `/admin/billing`. Nieznana wartość daje
 * `undefined`; klucz obecny w adresie z wartością odrzuconą wraca jako jawne
 * `undefined`, bo router składa wynik walidatora z surowym adresem (wzorzec
 * `parseRevenueHubSearch`).
 */
export function parseBillingSearch(raw: Record<string, unknown>): BillingSearch {
  const out: BillingSearch = {};
  if ("tab" in raw) out.tab = isBillingTab(raw.tab) ? raw.tab : undefined;
  if ("status" in raw) {
    out.status = typeof raw.status === "string" && STATUS.test(raw.status) ? raw.status : undefined;
  }
  return out;
}
