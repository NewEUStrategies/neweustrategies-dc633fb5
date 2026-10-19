// KONTRAKT PARAMETRÓW URL /admin/paywall (SPEC §2.6: `?tab=…&plan=<id>`).
//
// DLACZEGO LIŚĆ BEZ ŻADNEGO IMPORTU. `validateSearch` zostaje w powłoce trasy,
// a powłoka jedzie w chunku WEJŚCIOWYM każdej strony (splitter TanStacka wynosi
// wyłącznie `component`/`loader`). Jeden import stąd - choćby zod albo stała
// z modułu danych paywalla - wciągnąłby swoje drzewo do pierwszego wejścia
// czytelnika, który panelu nigdy nie otworzy. Test `paywallTabs.test.ts` czyta
// to źródło i pilnuje zera importów (wzór: `lib/revenue/search.ts`).
//
// LISTA JEST ŹRÓDŁEM, TYP Z NIEJ WYNIKA: dopisanie zakładki w jednym miejscu
// rozszerza naraz typ, walidację adresu i pasek zakładek, który po liście
// iteruje.

/** Zakładki paywalla w kolejności paska (hub linkuje do każdej z nich). */
export const PAYWALL_TABS = ["plans", "metering", "overrides", "checkout"] as const;
export type PaywallTabId = (typeof PAYWALL_TABS)[number];

export interface PaywallSearch {
  tab?: PaywallTabId;
  /** Identyfikator planu (UUID, małe litery) - otwiera edytor tego planu. */
  plan?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPaywallTab(raw: unknown): raw is PaywallTabId {
  return typeof raw === "string" && (PAYWALL_TABS as readonly string[]).includes(raw);
}

/**
 * Walidator `validateSearch` trasy `/admin/paywall`.
 *
 * Nieznana wartość daje `undefined` (zakładka domyślna, edytor zamknięty),
 * nigdy wyjątek - link z huba sprzed zmiany nazwy zakładki ma wylądować na
 * stronie, a nie na ekranie błędu.
 *
 * Klucz OBECNY w adresie z wartością odrzuconą wraca jako jawne `undefined`:
 * router składa wynik walidatora z surowym adresem (`{ ...surowy,
 * ...zwalidowany }`), więc pominięty klucz przepuściłby surowe `?tab=x` do
 * komponentu typowanego jako `PaywallTabId` (ten sam wzorzec co
 * `parseRevenueHubSearch`).
 *
 * UUID sprowadzamy do małych liter: baza zwraca identyfikatory małymi
 * literami, a porównanie `plan.id === search.plan` ma trafić także wtedy,
 * gdy ktoś wkleił adres przepisany wielkimi literami.
 */
export function parsePaywallSearch(raw: Record<string, unknown>): PaywallSearch {
  const out: PaywallSearch = {};
  if ("tab" in raw) out.tab = isPaywallTab(raw.tab) ? raw.tab : undefined;
  if ("plan" in raw) {
    out.plan =
      typeof raw.plan === "string" && UUID.test(raw.plan) ? raw.plan.toLowerCase() : undefined;
  }
  return out;
}
