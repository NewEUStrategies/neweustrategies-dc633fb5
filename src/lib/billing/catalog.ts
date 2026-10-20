// Mapowanie katalogu planów aplikacji (access_plans) na czytelne identyfikatory
// cen u dostawcy płatności. Klucz = `${tier_key}:${interval}` - dzięki temu
// zmiana kwoty po stronie dostawcy nie wymaga migracji, a webhook potrafi
// odwzorować cenę z powrotem na plan w bazie.
//
// Moduł jest czysty (bez zależności serwerowych), więc korzysta z niego zarówno
// przeglądarka (checkout), jak i handler webhooka.

export type PlanBillingInterval = "two_weeks" | "month" | "quarter" | "year" | "one_time";

export interface CatalogPriceEntry {
  /** external_id ceny u dostawcy. */
  priceId: string;
  /** external_id produktu u dostawcy. */
  productId: string;
  tierKey: string;
  interval: PlanBillingInterval;
  /** Ranga do wykrywania upgrade/downgrade (wyższa = wyższy plan). */
  rank: number;
  /** Rozliczenie za miejsce (seat) - checkout pozwala wybrać ilość. */
  perSeat?: boolean;
  /**
   * Cena jednorazowa (bez cyklu rozliczeniowego). Sesja checkoutu wybiera tryb
   * po `price.type`, więc pozycja jednorazowa nie zakłada subskrypcji ani
   * zdarzeń `customer.subscription.*` - patrz `createPlanCheckoutSession`.
   */
  oneTime?: boolean;
  /**
   * Cena rośnie schodkowo z liczbą miejsc: po osiągnięciu progu WSZYSTKIE
   * miejsca liczą się po niższej stawce (`tiers_mode: "volume"` u operatora),
   * nie tylko nadwyżka ponad próg. Wartości progu i stawki są w
   * `access_plans.volume_threshold_seats` / `volume_price_cents`, bo to katalog
   * aplikacji jest źródłem prawdy o kwotach - tutaj stoi wyłącznie deklaracja,
   * że dana cena ma być u operatora założona jako schodkowa.
   */
  volumeTiered?: boolean;
  /**
   * Klucz ceny WYCOFANY z katalogu sprzedaży, ale nadal możliwy na trwającej
   * subskrypcji (np. `plus_yearly` sprzed zmiany nazw na `*_annual`). Takich
   * pozycji nie zna kasa ani webhook (`catalogEntryByPriceId`) - czyta je
   * wyłącznie księga MRR (`ledgerCatalogEntryByPriceId`) i jej lustro SQL.
   */
  legacy?: true;
}

export const BILLING_CATALOG: readonly CatalogPriceEntry[] = [
  {
    priceId: "student_monthly",
    productId: "plan_student",
    tierKey: "student",
    interval: "month",
    rank: 10,
  },
  // Cennik v6.2: stawka studencka 190 zł/rok obok 19 zł/mies. Ten sam produkt
  // (`plan_student`), ranga 11 - przejście z miesięcznej na roczną liczy się
  // jak upgrade z proratą, tak samo jak Członek 30 -> 31. Rangi zostają
  // unikalne, bo po nich `planChangeDirection` rozstrzyga kierunek zmiany.
  {
    priceId: "student_annual",
    productId: "plan_student",
    tierKey: "student",
    interval: "year",
    rank: 11,
  },
  {
    priceId: "educator_monthly",
    productId: "plan_educator",
    tierKey: "educator",
    interval: "month",
    rank: 20,
  },
  {
    priceId: "plus_monthly",
    productId: "plan_plus",
    tierKey: "member",
    interval: "month",
    rank: 30,
  },
  { priceId: "plus_annual", productId: "plan_plus", tierKey: "member", interval: "year", rank: 31 },
  { priceId: "pro_monthly", productId: "plan_pro", tierKey: "pro", interval: "month", rank: 40 },
  { priceId: "pro_annual", productId: "plan_pro", tierKey: "pro", interval: "year", rank: 41 },
  {
    priceId: "team_monthly_seat",
    productId: "plan_team",
    tierKey: "team",
    interval: "month",
    rank: 50,
    perSeat: true,
    // Katalog v6.1: rabat wolumenowy od 11 miejsc. Bez tej flagi operator
    // liczyłby każde miejsce po stawce podstawowej, a rabat z cennika byłby
    // obietnicą bez mechanizmu.
    volumeTiered: true,
  },
  // Decision Lab: miejsce w cyklu dla podmiotu spoza partnerstwa. Produkt
  // jednorazowy, nie próg w drabince - zakup nie nadaje żadnej rangi
  // (`decision_lab` świadomie nie ma odpowiednika w `membership_tiers`).
  {
    priceId: "decision_lab_seat",
    productId: "product_decision_lab",
    tierKey: "decision_lab",
    interval: "one_time",
    rank: 0,
    oneTime: true,
  },
  // Partner Biznesowy: subskrypcja dla firm (zamiast sprzedaży reklam - AUP
  // operatora). Trzy cykle; dłuższy cykl = wyższa ranga (jak plus/pro yearly).
  //
  // WYCOFANY ZE SPRZEDAŻY w cenniku v6.2 (`access_plans.for_sale = false`) -
  // ale wpisy ZOSTAJĄ: webhook odwzorowuje po nich odnowienia trwających
  // subskrypcji (`catalogEntryByPriceId`), a synchronizacja nie archiwizuje
  // cen aktywnych planów. Usunięcie wpisu odcięłoby obecnym klientom dostęp
  // przy najbliższym odnowieniu. Nowy zakup blokuje `planPurchaseRefusal`.
  {
    priceId: "business_2w",
    productId: "plan_business",
    tierKey: "business",
    interval: "two_weeks",
    rank: 60,
  },
  {
    priceId: "business_monthly",
    productId: "plan_business",
    tierKey: "business",
    interval: "month",
    rank: 61,
  },
  {
    priceId: "business_quarterly",
    productId: "plan_business",
    tierKey: "business",
    interval: "quarter",
    rank: 62,
  },
] as const;

function normalizeInterval(interval: string | null | undefined): PlanBillingInterval {
  if (
    interval === "two_weeks" ||
    interval === "quarter" ||
    interval === "year" ||
    interval === "one_time"
  ) {
    return interval;
  }
  return "month";
}

/**
 * Znajdź cenę dostawcy dla planu z `access_plans` - WYŁĄCZNIE po parze
 * (tier, cykl).
 *
 * BEZ ZAPASOWEGO „PIERWSZEGO WPISU TEGO PROGU". Dawny fallback
 * `find((e) => e.tierKey === tier)` dobierał planowi bez własnej pozycji
 * katalogu (np. kwartalny Pro) cenę MIESIĘCZNĄ tego progu: kasa zakładała
 * subskrypcję miesięczną, zamówienie mówiło o kwartale, a webhook odwzorowywał
 * cenę z powrotem na inny plan. Brak pozycji to brak oferty - wołający odmawia
 * (`plan_price_missing`), zamiast obciążać kartę inną kwotą w innym cyklu.
 */
export function catalogPriceForPlan(plan: {
  tier_key?: string | null;
  interval?: string | null;
}): CatalogPriceEntry | null {
  const tier = plan.tier_key ?? "";
  if (!tier) return null;
  const interval = normalizeInterval(plan.interval);
  return BILLING_CATALOG.find((e) => e.tierKey === tier && e.interval === interval) ?? null;
}

/**
 * Pozycja katalogu dla DOKŁADNEJ pary (warstwa, cykl) planu - wersja dla kasy
 * (audyt PAY-01, przegląd 0.1; wycena `catalogPlanQuote`).
 *
 * Różnica wobec `catalogPriceForPlan`: cykl spoza słownika albo jego brak NIE
 * jest czytany jako miesiąc. `catalogPriceForPlan` zostaje przy tej
 * normalizacji dla odczytów sprzed kolumny `interval`; kasa nie może zgadywać -
 * plan z cyklem, którego katalog nie zna, dostałby cenę miesięczną, a operator
 * obciążałby co miesiąc za coś, co zamówienie opisuje inaczej.
 */
export function exactCatalogEntryForPlan(plan: {
  tier_key?: string | null;
  interval?: string | null;
}): CatalogPriceEntry | null {
  const tier = plan.tier_key ?? "";
  const interval = plan.interval ?? "";
  if (!tier || !interval) return null;
  return BILLING_CATALOG.find((e) => e.tierKey === tier && e.interval === interval) ?? null;
}

/** Cykl rozliczeniowy w słowniku operatora (Stripe zna tylko day/week/month/year). */
export interface CatalogRecurring {
  interval: "week" | "month" | "year";
  interval_count: number;
}

/**
 * Cykl ceny u operatora dla pozycji katalogu. Interwały aplikacji mapują się
 * na krotności: two_weeks -> week x2, quarter -> month x3. `null` = cena
 * jednorazowa (bez cyklu).
 *
 * JEDNA FUNKCJA DLA ZAKŁADANIA I DLA KONTROLI. Synchronizacja zakłada cenę
 * z tym cyklem, a kasa przed sesją sprawdza, że cena pod `lookup_key` ma
 * dokładnie ten cykl - dwie kopie mapowania to dwa różne słowniki.
 */
export function catalogRecurringFor(entry: CatalogPriceEntry): CatalogRecurring | null {
  // Cena jednorazowa NIE MA cyklu. Bez tej gałęzi `one_time` wpadało w
  // `default` i lądowało u operatora jako subskrypcja miesięczna - miejsce
  // w Decision Labie odnawiałoby się co miesiąc.
  if (entry.oneTime || entry.interval === "one_time") return null;
  switch (entry.interval) {
    case "two_weeks":
      return { interval: "week", interval_count: 2 };
    case "quarter":
      return { interval: "month", interval_count: 3 };
    case "year":
      return { interval: "year", interval_count: 1 };
    default:
      return { interval: "month", interval_count: 1 };
  }
}

/** Minimalny kształt ceny operatora, jakiego potrzebuje kontrola cyklu. */
export interface CatalogPriceCycleShape {
  type?: string | null;
  recurring?: {
    interval?: string | null;
    interval_count?: number | null;
    usage_type?: string | null;
  } | null;
}

/**
 * Czy cena operatora ma INNY cykl niż pozycja katalogu (albo cykl tam, gdzie
 * pozycja jest jednorazowa). Typ ceny musi się zgadzać jawnie - brak `type`
 * to też rozjazd, bo nie wiemy, co operator obciąży.
 *
 * JEDNA KONTROLA DLA KASY I SYNCHRONIZACJI. Kasa przed sesją odmawia ceny
 * w złym cyklu (`catalogPriceMismatch`), a synchronizacja porównywała dotąd
 * tylko kwotę, walutę i trial - cena w złym rytmie (np. miejsce w Decision
 * Labie założone kiedyś jako miesięczna subskrypcja albo kwartał zapisany
 * jako miesiąc × 1) dostawała od synchronizacji „ok" i blokowała każdy zakup
 * planu na zawsze. Ten sam predykat po obu stronach sprawia, że to, co kasa
 * odrzuca, synchronizacja odtwarza.
 *
 * Cena cykliczna musi też rozliczać się ZA ILOŚĆ (`usage_type: licensed`, audyt
 * PAY-01): cena `metered` pod tym samym kluczem nalicza za zgłoszone zużycie,
 * nie za miejsca z pozycji sesji, więc kwota zamówienia nie opisywałaby
 * obciążenia - kasa odmawia, a synchronizacja zakłada cenę od nowa.
 */
export function catalogCycleMismatch(
  price: CatalogPriceCycleShape,
  entry: CatalogPriceEntry,
): boolean {
  const cycle = catalogRecurringFor(entry);
  if (cycle === null) return price.type !== "one_time" || !!price.recurring;
  return (
    price.type !== "recurring" ||
    price.recurring?.interval !== cycle.interval ||
    (price.recurring?.interval_count ?? 1) !== cycle.interval_count ||
    (price.recurring?.usage_type ?? "licensed") !== "licensed"
  );
}

/** Wycena planu z katalogu: pozycja operatora, ilość i kwota PRZED kuponem. */
export interface CatalogPlanQuote {
  entry: CatalogPriceEntry;
  /** Ilość na pozycji sesji (miejsca dla `perSeat`, inaczej zawsze 1). */
  quantity: number;
  /** Stawka za jednostkę po progu wolumenowym. */
  unitCents: number;
  /** `unitCents × quantity` - kwota, którą MUSI dać cena operatora. */
  amountCents: number;
}

/**
 * Górny limit miejsc w jednym zamówieniu planu (zgodny z limitem pozycji sesji).
 * Katalog v6.2 opisuje Zespół jako „3-20 miejsc" - kasa tego zakresu nie
 * egzekwuje (decyzja otwarta), a karta Zespołu prowadzi do rozmowy.
 */
export const MAX_PLAN_SEATS = 100;

/**
 * Kwota zamówienia planu z katalogu - JEDNA reguła dla obu silników kasy.
 *
 * Ilość: miejsca wyłącznie dla planu rozliczanego za miejsce (`perSeat`);
 * każdy inny plan idzie w jednej sztuce, niezależnie od tego, co przyszło
 * w żądaniu. Wcześniej drugi silnik (`stripeCheckout.functions.ts`) przekazywał
 * ilość z żądania wprost do pozycji sesji przy kwocie zamówienia za jedną
 * sztukę - operator pobierał N × cena, zamówienie zapisywało 1 × cena.
 *
 * Próg wolumenowy (katalog v6.1: Zespół od 11 miejsc po 79 zł) jest w trybie
 * `volume`: po osiągnięciu progu WSZYSTKIE miejsca liczą się niżej - tak samo
 * jak cena schodkowa zakładana przez synchronizację katalogu.
 *
 * Pozycja wyłącznie z DOKŁADNEJ pary (`exactCatalogEntryForPlan`): wycena
 * prowadzi do obciążenia, więc cykl, którego katalog nie zna, nie jest czytany
 * jako miesiąc. Rodzaj zamówienia i tryb sesji dokłada `planCheckoutPricing`
 * (`planPricing.ts`) - ta funkcja liczy wyłącznie pozycję, ilość i kwotę.
 */
export function catalogPlanQuote(
  plan: {
    tier_key?: string | null;
    interval?: string | null;
    price_cents?: number | null;
    volume_threshold_seats?: number | null;
    volume_price_cents?: number | null;
  },
  seats?: number | null,
): CatalogPlanQuote | null {
  const entry = exactCatalogEntryForPlan(plan);
  if (!entry) return null;
  const requested = Number.isFinite(seats) ? Math.trunc(seats as number) : 1;
  const quantity = entry.perSeat ? Math.min(Math.max(requested, 1), MAX_PLAN_SEATS) : 1;
  const baseCents = Math.round(Number(plan.price_cents ?? 0));
  const volumeThreshold = Number(plan.volume_threshold_seats ?? 0);
  const volumeUnit = Math.round(Number(plan.volume_price_cents ?? 0));
  const unitCents =
    entry.perSeat && volumeThreshold >= 2 && quantity >= volumeThreshold ? volumeUnit : baseCents;
  return { entry, quantity, unitCents, amountCents: unitCents * quantity };
}

/**
 * Klucze cen sprzed 2026-08-05 (zmiana `*_yearly` -> `*_annual`). Subskrypcja
 * założona wtedy u operatora dalej odnawia się pod starym kluczem, więc
 * księga MRR musi znać jej warstwę i cykl - inaczej płacący od miesięcy klient
 * miałby MRR „nieznany", a diagnostyka krzyczałaby o cenie spoza katalogu.
 *
 * Osobna lista, a nie wpisy w `BILLING_CATALOG`: kasa nie może sprzedać
 * wycofanego klucza, a `planChangeDirection` porównuje rangi wyłącznie
 * w katalogu sprzedaży. Lustro SQL (`billing_catalog_entry`, migracja
 * 20261020110000) zawiera OBA katalogi - parytet pilnuje
 * `billingCatalogSqlParity.test.ts`.
 */
export const BILLING_CATALOG_LEGACY: readonly CatalogPriceEntry[] = [
  {
    priceId: "plus_yearly",
    productId: "plan_plus",
    tierKey: "member",
    interval: "year",
    rank: 31,
    legacy: true,
  },
  {
    priceId: "pro_yearly",
    productId: "plan_pro",
    tierKey: "pro",
    interval: "year",
    rank: 41,
    legacy: true,
  },
] as const;

/**
 * Pozycja katalogu dla KSIĘGI MRR: katalog sprzedaży, a bez trafienia -
 * wpisy wycofane (`BILLING_CATALOG_LEGACY`). Nie używać w kasie ani
 * w webhooku: tam wycofany klucz ma pozostać „nieznany".
 */
export function ledgerCatalogEntryByPriceId(
  priceId: string | null | undefined,
): CatalogPriceEntry | null {
  if (!priceId) return null;
  return (
    BILLING_CATALOG.find((e) => e.priceId === priceId) ??
    BILLING_CATALOG_LEGACY.find((e) => e.priceId === priceId) ??
    null
  );
}

/** Odwrotne mapowanie: czytelny identyfikator ceny -> wpis katalogu. */
export function catalogEntryByPriceId(
  priceId: string | null | undefined,
): CatalogPriceEntry | null {
  if (!priceId) return null;
  return BILLING_CATALOG.find((e) => e.priceId === priceId) ?? null;
}

/** Kierunek zmiany planu: upgrade rozliczamy od razu, downgrade od nowego okresu. */
export function planChangeDirection(
  fromPriceId: string | null | undefined,
  toPriceId: string | null | undefined,
): "upgrade" | "downgrade" | "same" {
  const from = catalogEntryByPriceId(fromPriceId);
  const to = catalogEntryByPriceId(toPriceId);
  if (!from || !to || from.priceId === to.priceId) return "same";
  return to.rank > from.rank ? "upgrade" : "downgrade";
}
