// Automatyczna synchronizacja katalogu produktów i cen w Stripe.
//
// Po ponownym podłączeniu integracji (nowe konto Stripe, przywrócenie
// środowiska) identyfikatory wewnętrzne znikają, a w aplikacji zostają tylko
// czytelne identyfikatory (`lookup_key` ceny, `metadata.lovable_external_id`
// produktu). Ten moduł odtwarza katalog idempotentnie: produkt/cena są
// zakładane, gdy ich brak, a rozjechana kwota, waluta, cykl lub trial są
// korygowane do wartości z `access_plans` (źródło prawdy aplikacji).
import type Stripe from "stripe";

import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";

import { BILLING_CATALOG, type CatalogPriceEntry } from "./catalog";
import type { ReapedEntry } from "./catalogReap.server";

export type CatalogSyncAction = "created" | "updated" | "ok" | "skipped" | "failed";

export interface CatalogSyncItem {
  priceId: string;
  productId: string;
  product: CatalogSyncAction;
  price: CatalogSyncAction;
  reason?: string;
}

export interface CatalogSyncReport {
  environment: StripeEnv;
  ranAt: string;
  items: CatalogSyncItem[];
  /** Pozycje zarchiwizowane, bo zniknęły ze źródła prawdy. */
  archived: ReapedEntry[];
  created: number;
  updated: number;
  failed: number;
}

interface PlanRow {
  tier_key: string | null;
  interval: string | null;
  price_cents: number | null;
  currency: string | null;
  name_pl: string | null;
  name_en: string | null;
  description_pl: string | null;
  trial_days: number | null;
  active: boolean | null;
  volume_threshold_seats: number | null;
  volume_price_cents: number | null;
}

/** Kod podatkowy dla treści cyfrowych/oprogramowania SaaS - wspólny dla całego katalogu. */
const DIGITAL_SERVICE_TAX_CODE = "txcd_10103000";

/**
 * Cykl rozliczeniowy ceny w słowniku Stripe. Stripe zna wyłącznie
 * day/week/month/year, więc interwały aplikacji mapują się na krotności:
 * two_weeks -> week x2, quarter -> month x3.
 */
function billingCycle(entry: CatalogPriceEntry): {
  interval: Stripe.PriceCreateParams.Recurring.Interval;
  interval_count: number;
} | null {
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

/**
 * Progi wolumenowe ceny. Zwraca `null`, gdy plan ich nie ma - wtedy cena jest
 * płaska (`unit_amount`).
 *
 * `tiers_mode: "volume"` znaczy u operatora: WSZYSTKIE jednostki liczą się po
 * stawce progu, który zamówienie osiągnęło. Dokładnie to obiecuje katalog
 * („rabat wolumenowy od 11 miejsc: 79 zł za miejsce"), w odróżnieniu od
 * `graduated`, gdzie po niższej stawce szłaby wyłącznie nadwyżka ponad próg.
 */
function volumeTiersFor(
  entry: CatalogPriceEntry,
  plan: PlanRow,
  amount: number,
): Stripe.PriceCreateParams.Tier[] | null {
  if (!entry.volumeTiered) return null;
  const threshold = plan.volume_threshold_seats;
  const tierAmount = plan.volume_price_cents;
  if (
    typeof threshold !== "number" ||
    typeof tierAmount !== "number" ||
    threshold < 2 ||
    tierAmount < 0
  ) {
    return null;
  }
  return [
    { up_to: threshold - 1, unit_amount: amount },
    { up_to: "inf", unit_amount: Math.max(0, Math.round(tierAmount)) },
  ];
}

/** Czy zdalna cena schodkowa odpowiada progom wyliczonym z katalogu. */
function tiersMatch(
  remote: Stripe.Price.Tier[] | undefined,
  expected: Stripe.PriceCreateParams.Tier[],
): boolean {
  if (!remote || remote.length !== expected.length) return false;
  return expected.every((want, i) => {
    const got = remote[i];
    if (!got) return false;
    const wantUpTo = want.up_to === "inf" ? null : Number(want.up_to);
    return (got.up_to ?? null) === wantUpTo && (got.unit_amount ?? null) === want.unit_amount;
  });
}

/** Okres próbny z `access_plans.trial_days` - `null` oznacza plan bez triala. */
function trialDaysForPlan(plan: PlanRow): number | null {
  const days = Math.max(0, Math.round(plan.trial_days ?? 0));
  return days > 0 ? days : null;
}

function metadataFor(externalId: string, trialDays: number | null): Record<string, string> {
  return {
    lovable_external_id: externalId,
    ...(trialDays ? { trial_days: String(trialDays) } : {}),
  };
}

async function findProductByExternalId(
  stripe: Stripe,
  externalId: string,
): Promise<Stripe.Product | null> {
  const res = await stripe.products.search({
    query: `active:'true' AND metadata['lovable_external_id']:'${externalId}'`,
    limit: 1,
  });
  return res.data[0] ?? null;
}

async function findPriceByLookupKey(
  stripe: Stripe,
  lookupKey: string,
): Promise<Stripe.Price | null> {
  // `tiers` NIE przychodzi domyślnie - bez rozwinięcia cena schodkowa
  // wyglądałaby jak cena bez progów i sync odtwarzałby ją w kółko.
  const res = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
    expand: ["data.tiers"],
  });
  return res.data[0] ?? null;
}

/** Okres próbny zapisany w metadanych ceny - odczyt dla checkoutu. */
export async function trialDaysForPrice(env: StripeEnv, priceId: string): Promise<number | null> {
  const stripe = createStripeClient(env);
  const price = await findPriceByLookupKey(stripe, priceId);
  const raw = price?.metadata?.["trial_days"];
  const days = raw ? Number(raw) : NaN;
  return Number.isFinite(days) && days > 0 ? days : null;
}

async function syncOne(
  stripe: Stripe,
  entry: CatalogPriceEntry,
  plan: PlanRow | undefined,
): Promise<CatalogSyncItem> {
  const item: CatalogSyncItem = {
    priceId: entry.priceId,
    productId: entry.productId,
    product: "ok",
    price: "ok",
  };

  if (!plan || plan.active === false) {
    // Bez lokalnego planu nie znamy kwoty - nie zgadujemy jej po stronie Stripe.
    item.product = "skipped";
    item.price = "skipped";
    item.reason = "no_local_plan";
    return item;
  }

  const name = plan.name_pl || plan.name_en || entry.tierKey;
  const amount = Math.max(0, Math.round(plan.price_cents ?? 0));
  const currency = (plan.currency || "PLN").toLowerCase();
  const trialDays = trialDaysForPlan(plan);

  // 1. Produkt
  let product = await findProductByExternalId(stripe, entry.productId);
  if (!product) {
    product = await stripe.products.create({
      name,
      description: plan.description_pl ?? undefined,
      tax_code: DIGITAL_SERVICE_TAX_CODE,
      metadata: { lovable_external_id: entry.productId },
    });
    item.product = "created";
  }

  // 2. Cena
  const recurring = billingCycle(entry);
  const tiers = volumeTiersFor(entry, plan, amount);
  // Kształt ceny jest jeden dla założenia i dla korekty - inaczej cena
  // odtworzona po dryfie kwoty gubiłaby progi wolumenowe.
  const shape: Stripe.PriceCreateParams = tiers
    ? { billing_scheme: "tiered", tiers_mode: "volume", tiers }
    : { unit_amount: amount };

  const price = await findPriceByLookupKey(stripe, entry.priceId);
  if (!price) {
    await stripe.prices.create({
      product: product.id,
      currency,
      ...shape,
      ...(recurring ? { recurring } : {}),
      lookup_key: entry.priceId,
      nickname: `${name} (${entry.interval})`,
      metadata: metadataFor(entry.priceId, trialDays),
    });
    item.price = "created";
    return item;
  }

  // 3. Korekta rozjechanej kwoty/waluty/triala - checkout musi pobierać tyle,
  // ile pokazuje cennik w aplikacji.
  const remoteTrialRaw = price.metadata?.["trial_days"];
  const remoteTrialDays = remoteTrialRaw ? Number(remoteTrialRaw) : null;
  const currencyDrifted = (price.currency ?? "").toLowerCase() !== currency;
  // Cena schodkowa nie ma `unit_amount` - porównujemy progi. Zmiana kształtu
  // (płaska <-> schodkowa) też jest dryfem: przejście progu wolumenowego
  // z konfiguracji do katalogu musi przełożyć się na cenę u operatora.
  const amountDrifted = tiers
    ? price.billing_scheme !== "tiered" || !tiersMatch(price.tiers ?? undefined, tiers)
    : price.billing_scheme === "tiered" || (price.unit_amount ?? 0) !== amount;
  const trialDrifted = (trialDays ?? null) !== (remoteTrialDays ?? null);

  if (amountDrifted || currencyDrifted) {
    // Stripe nie pozwala zmienić kwoty istniejącej ceny - zakładamy nową
    // z tym samym `lookup_key` (przenoszonym automatycznie), a starą
    // archiwizujemy zamiast kasować (zachowanie historii transakcji).
    await stripe.prices.create({
      product: product.id,
      currency,
      ...shape,
      ...(recurring ? { recurring } : {}),
      lookup_key: entry.priceId,
      transfer_lookup_key: true,
      nickname: `${name} (${entry.interval})`,
      metadata: metadataFor(entry.priceId, trialDays),
    });
    await stripe.prices.update(price.id, { active: false });
    item.price = "updated";
  } else if (trialDrifted) {
    await stripe.prices.update(price.id, {
      metadata: metadataFor(entry.priceId, trialDays),
    });
    item.price = "updated";
  }

  return item;
}

/**
 * Odtwarza katalog w Stripe na podstawie `access_plans` + `BILLING_CATALOG`.
 * Idempotentna: powtórne wywołanie na spójnym katalogu nic nie zmienia.
 */
export async function syncBillingCatalog(env: StripeEnv = "sandbox"): Promise<CatalogSyncReport> {
  const stripe = createStripeClient(env);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("access_plans")
    .select(
      "tier_key, interval, price_cents, currency, name_pl, name_en, description_pl, trial_days, active, volume_threshold_seats, volume_price_cents",
    );
  const plans = (data ?? []) as PlanRow[];

  const planFor = (entry: CatalogPriceEntry): PlanRow | undefined =>
    plans.find((p) => p.tier_key === entry.tierKey && (p.interval ?? "month") === entry.interval) ??
    plans.find((p) => p.tier_key === entry.tierKey);

  const items: CatalogSyncItem[] = [];
  for (const entry of BILLING_CATALOG) {
    try {
      items.push(await syncOne(stripe, entry, planFor(entry)));
    } catch (err) {
      // Jedna pozycja nie może zatrzymać całej synchronizacji.
      console.error("[payments] catalog sync failed", entry.priceId, err);
      items.push({
        priceId: entry.priceId,
        productId: entry.productId,
        product: "failed",
        price: "failed",
        reason: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const failed = items.filter((i) => i.price === "failed").length;

  // Sprzątanie: pozycje, których nie ma już w źródle prawdy (usunięty wpis
  // katalogu lub `access_plans.active = false`), znikają z oferty Stripe.
  // Robimy to wyłącznie po czystym przebiegu - błąd API nie może zostać
  // odczytany jako "plan zniknął".
  let archived: ReapedEntry[] = [];
  if (failed === 0) {
    const expectedPriceIds = new Set<string>();
    const expectedProductIds = new Set<string>();
    const inactivePriceIds = new Set<string>();
    for (const entry of BILLING_CATALOG) {
      const plan = planFor(entry);
      if (plan && plan.active !== false) {
        expectedPriceIds.add(entry.priceId);
        expectedProductIds.add(entry.productId);
      } else {
        inactivePriceIds.add(entry.priceId);
      }
    }
    try {
      const { reapOrphanCatalogEntries } = await import("./catalogReap.server");
      archived = await reapOrphanCatalogEntries({
        env,
        expectedPriceIds,
        expectedProductIds,
        inactivePriceIds,
      });
    } catch (err) {
      // Sprzątanie jest opcjonalne - nie unieważnia udanej synchronizacji.
      console.error("[payments] catalog reap failed", err);
    }
  }

  return {
    environment: env,
    ranAt: new Date().toISOString(),
    items,
    archived,
    created: items.filter((i) => i.product === "created" || i.price === "created").length,
    updated: items.filter((i) => i.price === "updated").length,
    failed,
  };
}

/** Cache jednokrotnego samo-naprawiania w obrębie instancji workera. */
let healingRun: Promise<CatalogSyncReport> | null = null;

/**
 * Samonaprawa wywoływana z checkoutu, gdy cena nie istnieje w Stripe -
 * typowy objaw restartu integracji. Uruchamiamy najwyżej jedną synchronizację
 * naraz, żeby równoległe zakupy nie zasypały API Stripe.
 */
export async function healCatalogOnce(env: StripeEnv): Promise<void> {
  if (!healingRun) {
    healingRun = syncBillingCatalog(env).finally(() => {
      healingRun = null;
    });
  }
  await healingRun;
}
