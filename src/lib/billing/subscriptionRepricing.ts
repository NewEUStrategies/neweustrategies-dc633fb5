// Przeniesienie TRWAJĄCYCH subskrypcji na cenę katalogu v6.2 - reguły czyste.
//
// DECYZJA WŁAŚCICIELA (18.10.2026): obecni subskrybenci Członka, Członka Pro
// i Zespołu (59/590, 129/1290, 99 zł) płacą NIŻSZĄ cenę v6.2 (39/390,
// 119/1190, 89 zł) od najbliższego odnowienia. Synchronizacja katalogu zakłada
// nowe ceny z tym samym `lookup_key`, ale subskrypcje zostają na starych,
// zarchiwizowanych obiektach ceny - operator nigdy nie przenosi ich sam. Robi
// to dopiero akcja admina (panel /admin/billing): podgląd, potem wykonanie.
//
// TEN MODUŁ ROZSTRZYGA, NIE WYKONUJE. Wejście to żywy stan subskrypcji
// sprowadzony do kilku pól (pozycje, harmonogram, status) i aktywne ceny
// katalogu; wyjście - decyzja „przenieś / pomiń, bo…" z kwotami, MRR i datą
// pierwszej faktury po nowej cenie. Tę samą funkcję woła podgląd (bez
// zapisu) i wykonanie (na stanie odczytanym tuż przed mutacją), więc to, co
// admin widział, jest dokładnie tym, co się stanie.
//
// AKCJA NIGDY NIE PODNOSI CENY. Klient na tańszej cenie historycznej (rabat
// wpisany kiedyś ręcznie w panelu operatora, cena promocyjna) zostaje przy
// swojej - `would_increase`. Decyzja właściciela mówi o obniżce, a podwyżka
// bez zawiadomienia z wyprzedzeniem byłaby zmianą warunków umowy.
//
// Moduł czysty (bez Stripe i bazy) - współdzielą go serwer i panel.
import { catalogEntryByPriceId, type PlanBillingInterval } from "@/lib/billing/catalog";

/** Kampania przeceny - klucz w dzienniku `subscription_price_migrations`. */
export const REPRICING_CAMPAIGN = "pricing_v62" as const;

/**
 * Literał, który admin MUSI przepisać, żeby wykonać przeniesienie. Podgląd jest
 * domyślny; wykonanie bez tego pola serwer odrzuca (`confirmation_required`).
 */
export const REPRICING_CONFIRM = "OBNIZ-CENY-V62" as const;

/**
 * Ceny katalogu objęte decyzją 2 (Członek, Członek Pro, Zespół). Student,
 * kadra akademicka i Partner Biznesowy NIE: ich kwoty v6.2 się nie zmieniły
 * albo produkt wycofano ze sprzedaży z zachowaniem ceny obecnych klientów.
 */
export const REPRICE_LOOKUP_KEYS = [
  "plus_monthly",
  "plus_annual",
  "pro_monthly",
  "pro_annual",
  "team_monthly_seat",
] as const;
export type RepriceLookupKey = (typeof REPRICE_LOOKUP_KEYS)[number];

export function isRepriceLookupKey(key: string | null | undefined): key is RepriceLookupKey {
  return (REPRICE_LOOKUP_KEYS as readonly string[]).includes(key ?? "");
}

// --- kształt ceny ------------------------------------------------------------

export interface PriceTierShape {
  /** Górna granica progu (włącznie); `null` = bez granicy. */
  upTo: number | null;
  unitAmount: number | null;
  flatAmount: number | null;
}

/** Cena operatora sprowadzona do tego, z czego liczy się kwota i cykl. */
export interface PriceShape {
  id: string;
  currency: string;
  interval: "day" | "week" | "month" | "year";
  intervalCount: number;
  unitAmount: number | null;
  /** `null` = cena płaska. */
  tiersMode: "volume" | "graduated" | null;
  tiers: PriceTierShape[] | null;
}

/**
 * Kwota pozycji (cena × ilość) w groszach - `null`, gdy kształtu nie umiemy
 * policzyć jednoznacznie.
 *
 * `volume`: WSZYSTKIE sztuki po stawce progu, który osiągnęła ilość - tak
 * liczy operator i tak zakłada cenę Zespołu synchronizacja katalogu (od 11
 * miejsc 79 zł za każde). `graduated` liczy niższą stawkę tylko od nadwyżki;
 * katalog takich cen nie zakłada, więc odmawiamy zamiast zgadywać.
 */
export function amountForQuantity(price: PriceShape, quantity: number): number | null {
  const qty = Math.max(1, Math.trunc(quantity));
  if (price.tiersMode === null) {
    return typeof price.unitAmount === "number" ? price.unitAmount * qty : null;
  }
  if (price.tiersMode !== "volume" || !price.tiers || price.tiers.length === 0) return null;
  const tier = price.tiers.find((t) => t.upTo === null || qty <= t.upTo);
  if (!tier || (tier.unitAmount === null && tier.flatAmount === null)) return null;
  return (tier.unitAmount ?? 0) * qty + (tier.flatAmount ?? 0);
}

/**
 * Równowartość miesięczna kwoty (MRR) - w groszach, bez zaokrąglenia; sumy
 * zaokrągla `summarizeRepricing`. Rok = 12 miesięcy, tydzień = 52/12, dzień =
 * 365/12 - ta sama konwencja co framing ceny rocznej na /pricing.
 */
export function monthlyEquivalent(
  amount: number,
  price: Pick<PriceShape, "interval" | "intervalCount">,
): number {
  const count = Math.max(1, price.intervalCount);
  switch (price.interval) {
    case "year":
      return amount / (12 * count);
    case "week":
      return (amount * 52) / 12 / count;
    case "day":
      return (amount * 365) / 12 / count;
    default:
      return amount / count;
  }
}

// --- decyzja -----------------------------------------------------------------

/** Pozycja subskrypcji albo fazy harmonogramu. */
export interface RepriceLine {
  /** Czytelny identyfikator ceny (`lookup_key` albo `lovable_external_id`). */
  lookupKey: string | null;
  price: PriceShape;
  quantity: number;
}

export interface RepriceInput {
  status: string;
  pauseCollection: boolean;
  /** Oczekująca, nieopłacona zmiana (upgrade z dopłatą w toku). */
  pendingUpdate: boolean;
  items: readonly RepriceLine[];
  /**
   * Harmonogram dołączony do subskrypcji. `own` = założony przez tę aplikację
   * (metadane `nes_basis` / `nes_ops_rev`: zaplanowany downgrade, zmniejszenie
   * miejsc). `nextLines` = pozycje fazy, która wejdzie przy odnowieniu
   * (`null` = nieczytelna albo jej nie ma), `extraPhases` = po niej są
   * jeszcze kolejne fazy, `finalPhase` = bieżąca faza jest OSTATNIA
   * (zaplanowana zmiana już weszła - harmonogram wisi do końca tej fazy,
   * a o fakturze przy odnowieniu decyduje bieżąca pozycja), `endBehavior` =
   * `end_behavior` harmonogramu u operatora (`release`, `cancel`, ...;
   * `null` = nieczytelne).
   */
  schedule: null | {
    own: boolean;
    nextLines: readonly RepriceLine[] | null;
    extraPhases: boolean;
    finalPhase: boolean;
    endBehavior: string | null;
  };
  /** Aktywne ceny katalogu po `lookup_key` (nowe ceny v6.2). */
  targets: Readonly<Partial<Record<string, PriceShape>>>;
  /** Zaplanowany koniec: `cancel_at_period_end` albo data `cancel_at`. */
  cancelScheduled: boolean;
  /** Unix (s). */
  trialEnd: number | null;
  /** Unix (s) - koniec bieżącego okresu pozycji. */
  periodEnd: number | null;
}

export type RepriceSkip =
  | "status_not_billable"
  | "paused"
  | "pending_update"
  | "multi_item"
  | "schedule_foreign"
  | "cancel_scheduled"
  | "not_repriced_key"
  | "target_price_missing"
  | "already_current"
  | "currency_mismatch"
  | "cycle_mismatch"
  | "unpriceable"
  | "would_increase";

/** Wszystkie powody pominięcia - kolejność = kolejność reguł w `repriceDecision`. */
export const REPRICE_SKIP_REASONS: readonly RepriceSkip[] = [
  "status_not_billable",
  "paused",
  "pending_update",
  "multi_item",
  "schedule_foreign",
  "cancel_scheduled",
  "not_repriced_key",
  "target_price_missing",
  "already_current",
  "currency_mismatch",
  "cycle_mismatch",
  "unpriceable",
  "would_increase",
];

export interface RepriceDecision {
  action: "apply" | "skip";
  reason: RepriceSkip | null;
  /** Gdzie zmiana idzie u operatora: pozycja subskrypcji albo fazy harmonogramu. */
  mode: "item" | "schedule" | null;
  lookupKey: string | null;
  /** Cykl z katalogu aplikacji (do dziennika i maila). */
  interval: PlanBillingInterval | null;
  quantity: number;
  fromPriceId: string | null;
  toPriceId: string | null;
  currency: string | null;
  /** Kwota pozycji na NAJBLIŻSZEJ fakturze - przed i po (grosze). */
  currentAmount: number | null;
  newAmount: number | null;
  /** Równowartość miesięczna (grosze, bez zaokrąglenia). */
  currentMrr: number;
  newMrr: number;
  /** ISO: pierwsza faktura po nowej cenie (koniec triala albo okresu). */
  effectiveAt: string | null;
  /** Mail „niższa cena od odnowienia" ma sens tylko przy realnej obniżce. */
  emailEligible: boolean;
}

const BILLABLE_STATUSES = new Set(["active", "trialing"]);

function isoFromUnix(seconds: number | null): string | null {
  return typeof seconds === "number" && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

/**
 * Ten sam cykl rozliczeń. Krotność porównujemy DOKŁADNIE: cena bez cyklu
 * (jednorazowa, krotność 0) nie może udawać miesięcznej.
 */
function sameCycle(a: PriceShape, b: PriceShape): boolean {
  return a.interval === b.interval && a.intervalCount === b.intervalCount;
}

/**
 * Czy pojedynczą pozycję wolno przepiąć na cenę katalogu: klucz objęty
 * kampanią, cena docelowa istnieje i jest INNA, ta sama waluta i cykl, kwoty
 * policzalne, a nowa nie jest wyższa. Ta sama reguła rozstrzyga pozycję
 * decydującą o fakturze i pozostałe pozycje faz harmonogramu - bieżąca faza
 * zaplanowanego downgrade'u nie może dostać droższej ceny „przy okazji"
 * (po zwolnieniu harmonogramu klient zostałby na niej).
 */
export function linePriceTarget(
  line: RepriceLine,
  targets: Readonly<Partial<Record<string, PriceShape>>>,
): PriceShape | null {
  if (!isRepriceLookupKey(line.lookupKey)) return null;
  const target = targets[line.lookupKey];
  if (!target || target.id === line.price.id) return null;
  if (line.price.currency.toLowerCase() !== target.currency.toLowerCase()) return null;
  if (!sameCycle(line.price, target)) return null;
  const before = amountForQuantity(line.price, line.quantity);
  const after = amountForQuantity(target, line.quantity);
  if (before === null || after === null || after > before) return null;
  return target;
}

function skip(
  reason: RepriceSkip,
  base: Partial<RepriceDecision> & Pick<RepriceDecision, "quantity">,
): RepriceDecision {
  return {
    action: "skip",
    reason,
    mode: null,
    lookupKey: null,
    interval: null,
    fromPriceId: null,
    toPriceId: null,
    currency: null,
    currentAmount: null,
    newAmount: null,
    currentMrr: 0,
    newMrr: 0,
    effectiveAt: null,
    emailEligible: false,
    ...base,
  };
}

/**
 * Decyzja dla jednej subskrypcji. Reguły w kolejności:
 *
 *  1. status inny niż `active`/`trialing` -> `status_not_billable` (zaległa
 *     albo niedokończona płatność wraca do kolejki po odzyskaniu),
 *  2. wstrzymany pobór -> `paused`,
 *  3. oczekująca dopłata -> `pending_update`,
 *  4. więcej niż jedna pozycja -> `multi_item` (subskrypcja z panelu operatora),
 *  5. harmonogram obcy (panel, portal) albo w kształcie, którego nie znamy ->
 *     `schedule_foreign` - do obsługi ręcznej; własny harmonogram przy
 *     zaplanowanym końcu (`cancel_at` / `cancel_at_period_end` albo
 *     `end_behavior: cancel`) -> `cancel_scheduled`: przepisanie faz zapisuje
 *     `end_behavior: release` i otwartą następną fazę, czyli ODWOŁAŁOBY
 *     rezygnację (ta sama reguła, z której zmniejszenie miejsc odmawia
 *     `subscription_canceling`); harmonogram z innym `end_behavior` niż
 *     `release` i `cancel` -> `schedule_foreign`,
 *  6. pozycja DECYDUJĄCA o najbliższej fakturze: przy własnym harmonogramie -
 *     faza, która wejdzie przy odnowieniu (zaplanowany downgrade na Członka
 *     wskazuje STARĄ cenę Członka), a gdy bieżąca faza jest ostatnia
 *     (downgrade już wszedł) - bieżąca pozycja; bez harmonogramu - bieżąca
 *     pozycja,
 *  7. klucz spoza kampanii -> `not_repriced_key`; brak ceny katalogu ->
 *     `target_price_missing`; ta sama cena -> `already_current`,
 *  8. inna waluta / cykl -> `currency_mismatch` / `cycle_mismatch`,
 *  9. kształt niepoliczalny -> `unpriceable`,
 * 10. nowa kwota wyższa -> `would_increase` (akcja nigdy nie podnosi ceny),
 * 11. w pozostałych przypadkach `apply`. Ta sama kwota (Zespół od 11 miejsc:
 *     79 zł przed i po) też jest `apply` - przepięcie na aktualny obiekt ceny
 *     sprawia, że późniejsze zmniejszenie poniżej 11 miejsc liczy 89, a nie
 *     99 zł - ale bez maila, bo kwota się nie zmienia.
 */
export function repriceDecision(input: RepriceInput): RepriceDecision {
  const quantity = input.items[0]?.quantity ?? 1;
  if (!BILLABLE_STATUSES.has(input.status)) return skip("status_not_billable", { quantity });
  if (input.pauseCollection) return skip("paused", { quantity });
  if (input.pendingUpdate) return skip("pending_update", { quantity });
  if (input.items.length !== 1) return skip("multi_item", { quantity });

  let line: RepriceLine = input.items[0];
  let mode: "item" | "schedule" = "item";
  if (input.schedule) {
    const { own, nextLines, extraPhases, finalPhase, endBehavior } = input.schedule;
    // Własny harmonogram w OSTATNIEJ fazie (zaplanowany downgrade albo
    // zmniejszenie miejsc już weszło): operator odłącza go dopiero z końcem
    // tej fazy, a subskrypcja odnawia się wtedy po cenie pozycji - starej,
    // zarchiwizowanej. To nadal nasz harmonogram, nie obcy: decyduje bieżąca
    // pozycja, a zapis przepisuje jedną, bieżącą fazę.
    const readable = finalPhase
      ? own && !nextLines
      : own && !!nextLines && !extraPhases && nextLines.length === 1;
    if (!readable) return skip("schedule_foreign", { quantity });
    // Zaplanowany koniec przy własnym harmonogramie: przepisanie faz
    // (`end_behavior: release`, otwarta faza) odnowiłoby subskrypcję klientowi,
    // który zrezygnował. Cenę bez harmonogramu przepinamy (pozycja nie ruszy
    // daty końca), z harmonogramem - nie.
    if (input.cancelScheduled || endBehavior === "cancel") {
      return skip("cancel_scheduled", { quantity });
    }
    if (endBehavior !== "release") return skip("schedule_foreign", { quantity });
    line = nextLines && !finalPhase ? nextLines[0] : input.items[0];
    mode = "schedule";
  }

  const lookupKey = line.lookupKey;
  const base = {
    quantity: line.quantity,
    lookupKey,
    interval: catalogEntryByPriceId(lookupKey)?.interval ?? null,
    fromPriceId: line.price.id,
    currency: line.price.currency.toUpperCase(),
  };
  if (!isRepriceLookupKey(lookupKey)) return skip("not_repriced_key", base);
  const target = input.targets[lookupKey];
  if (!target) return skip("target_price_missing", base);
  const withTarget = { ...base, toPriceId: target.id };
  if (target.id === line.price.id) {
    const amount = amountForQuantity(target, line.quantity);
    const mrr = amount === null ? 0 : monthlyEquivalent(amount, target);
    return skip("already_current", {
      ...withTarget,
      currentAmount: amount,
      newAmount: amount,
      currentMrr: mrr,
      newMrr: mrr,
    });
  }
  if (line.price.currency.toLowerCase() !== target.currency.toLowerCase()) {
    return skip("currency_mismatch", withTarget);
  }
  if (!sameCycle(line.price, target)) return skip("cycle_mismatch", withTarget);

  const currentAmount = amountForQuantity(line.price, line.quantity);
  const newAmount = amountForQuantity(target, line.quantity);
  if (currentAmount === null || newAmount === null) return skip("unpriceable", withTarget);
  const amounts = { ...withTarget, currentAmount, newAmount };
  if (newAmount > currentAmount) return skip("would_increase", amounts);

  // Trial w toku: pierwsza faktura (już po nowej cenie) przychodzi z końcem
  // triala. Inaczej - z końcem bieżącego, opłaconego okresu.
  const effectiveAt =
    input.status === "trialing" && input.trialEnd
      ? isoFromUnix(input.trialEnd)
      : isoFromUnix(input.periodEnd);
  return {
    ...amounts,
    action: "apply",
    reason: null,
    mode,
    currentMrr: monthlyEquivalent(currentAmount, line.price),
    newMrr: monthlyEquivalent(newAmount, target),
    effectiveAt,
    // Zaplanowany koniec: odnowienia nie będzie, więc mail o „niższej cenie od
    // odnowienia" byłby nieprawdą. Cenę i tak przepinamy - po wznowieniu
    // klient płaci mniej.
    emailEligible: newAmount < currentAmount && !input.cancelScheduled,
  };
}

// --- podsumowanie ------------------------------------------------------------

/**
 * Klucz licznika podsumowania: przeniesienie do wykonania, powód pominięcia
 * albo `already_applied` - subskrypcja przeniesiona we WCZEŚNIEJSZYM
 * przebiegu (wpis `applied` w dzienniku). Dziennik oddaje ją z decyzją
 * `apply` i kwotami sprzed zmiany, ale to nie jest już ruch do zrobienia.
 */
export type RepriceTally = "apply" | "already_applied" | RepriceSkip;

export interface RepricingSummary {
  total: number;
  count: Partial<Record<RepriceTally, number>>;
  /**
   * Przeniesione wcześniej, którym wykonanie ma jeszcze wysłać mail
   * (`pending` / `failed` w dzienniku) - jedyny powód, by ponowić wykonanie
   * bez nowych przeniesień.
   */
  emailRetry: number;
  /** MRR subskrypcji z decyzją `apply` - przed i po (grosze, zaokrąglone). */
  mrrBefore: number;
  mrrAfter: number;
  mrrDelta: number;
  byKey: Record<string, { n: number; before: number; after: number }>;
}

/**
 * Sumy podglądu. MRR liczony WYŁĄCZNIE z decyzji `apply` - to jest wpływ akcji
 * na przychód cykliczny, po cenach katalogowych (bez rabatów i podatku), w
 * ekwiwalencie miesięcznym. Pominięte subskrypcje nie zmieniają przychodu.
 *
 * Wiersze `already_applied` liczą się OSOBNO i poza MRR: ich zmiana weszła
 * w poprzednim przebiegu, więc wliczenie ich do „do przeniesienia" i do
 * różnicy MRR zawyżało wpływ akcji po częściowym albo pełnym wykonaniu
 * (100 subskrypcji i -2 000 zł zamiast 60 i -1 200 zł).
 */
export function summarizeRepricing(
  rows: readonly (Pick<
    RepriceDecision,
    "action" | "reason" | "lookupKey" | "currentMrr" | "newMrr"
  > & { outcome?: RepricingOutcome; emailStatus?: RepricingEmailStatus })[],
): RepricingSummary {
  const count: Partial<Record<RepriceTally, number>> = {};
  const byKey: RepricingSummary["byKey"] = {};
  let before = 0;
  let after = 0;
  let emailRetry = 0;
  for (const row of rows) {
    if (row.outcome === "already_applied") {
      count.already_applied = (count.already_applied ?? 0) + 1;
      if (row.emailStatus === "pending" || row.emailStatus === "failed") emailRetry += 1;
      continue;
    }
    const tally: RepriceTally = row.action === "apply" ? "apply" : (row.reason ?? "unpriceable");
    count[tally] = (count[tally] ?? 0) + 1;
    if (row.action !== "apply") continue;
    before += row.currentMrr;
    after += row.newMrr;
    const key = row.lookupKey ?? "-";
    const slot = byKey[key] ?? { n: 0, before: 0, after: 0 };
    slot.n += 1;
    slot.before += row.currentMrr;
    slot.after += row.newMrr;
    byKey[key] = slot;
  }
  for (const slot of Object.values(byKey)) {
    slot.before = Math.round(slot.before);
    slot.after = Math.round(slot.after);
  }
  const mrrBefore = Math.round(before);
  const mrrAfter = Math.round(after);
  return {
    total: rows.length,
    count,
    emailRetry,
    mrrBefore,
    mrrAfter,
    mrrDelta: mrrAfter - mrrBefore,
    byKey,
  };
}

// --- strona wyniku (kontrakt serwer <-> panel) -------------------------------

export type RepricingMode = "preview" | "execute";

/** Co się stało z subskrypcją w tym przebiegu. */
export type RepricingOutcome =
  /** Podgląd - nic nie zapisano. */
  | "planned"
  /** Wykonanie: cena przepięta u operatora. */
  | "applied"
  /** Dziennik ma już `applied` na tę cenę docelową - bez ruchu u operatora. */
  | "already_applied"
  | "skipped"
  | "failed";

export type RepricingEmailStatus = "pending" | "queued" | "skipped" | "failed" | null;

export interface RepricingRow extends RepriceDecision {
  /** `subscriptions.id` (lustro). */
  subscriptionId: string;
  providerSubscriptionId: string;
  outcome: RepricingOutcome;
  emailStatus: RepricingEmailStatus;
  /** Kod błędu operatora albo odczytu - nigdy treść z danymi klienta. */
  error: string | null;
}

export interface RepricingPage {
  ok: true;
  mode: RepricingMode;
  environment: "sandbox" | "live";
  /**
   * Prewarunki niespełnione (`catalog_not_synced`, `target_price_missing:<key>`,
   * `target_price_mismatch:<key>`) - wykonanie odmawia, podgląd je pokazuje.
   */
  problems: string[];
  rows: RepricingRow[];
  nextCursor: string | null;
  done: boolean;
}

export interface RepricingRun {
  mode: RepricingMode;
  environment: "sandbox" | "live";
  problems: string[];
  rows: RepricingRow[];
  nextCursor: string | null;
  done: boolean;
  summary: RepricingSummary;
}

/** Sklejenie kolejnej strony przebiegu (kursor) - panel liczy sumy z całości. */
export function mergeRepricingPages(
  previous: RepricingRun | null,
  page: RepricingPage,
): RepricingRun {
  const rows = [...(previous?.rows ?? []), ...page.rows];
  const problems = Array.from(new Set([...(previous?.problems ?? []), ...page.problems]));
  return {
    mode: page.mode,
    environment: page.environment,
    problems,
    rows,
    nextCursor: page.nextCursor,
    done: page.done,
    summary: summarizeRepricing(rows),
  };
}
