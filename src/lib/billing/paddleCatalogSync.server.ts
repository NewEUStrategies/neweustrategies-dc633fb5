// Automatyczna synchronizacja katalogu produktów i cen u operatora płatności.
//
// Po ponownym podłączeniu integracji (nowe konto operatora, przywrócenie
// środowiska) identyfikatory wewnętrzne znikają, a w aplikacji zostają tylko
// czytelne `external_id`. Ten moduł odtwarza katalog idempotentnie:
// produkt/cena są zakładane, gdy ich brak, a rozjechana kwota, waluta lub
// cykl są korygowane do wartości z `access_plans` (źródło prawdy aplikacji).
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";

import { PADDLE_CATALOG, type PaddlePriceEntry } from "./paddleCatalog";
import type { ReapedEntry } from "./paddleCatalogReap.server";

export type CatalogSyncAction = "created" | "updated" | "ok" | "skipped" | "failed";

export interface CatalogSyncItem {
  priceId: string;
  productId: string;
  product: CatalogSyncAction;
  price: CatalogSyncAction;
  reason?: string;
}

export interface CatalogSyncReport {
  environment: PaddleEnv;
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
}

async function findByExternalId(
  env: PaddleEnv,
  resource: "products" | "prices",
  externalId: string,
): Promise<{ id: string; raw: Record<string, unknown> } | null> {
  const res = await gatewayFetch(
    env,
    `/${resource}?external_id=${encodeURIComponent(externalId)}&status=active`,
  );
  if (!res.ok) throw new Error(`${resource}_lookup_${res.status}`);
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const row = json.data?.[0];
  return row?.id ? { id: String(row.id), raw: row } : null;
}

/**
 * Cykl rozliczeniowy ceny w formacie operatora. API dostawcy zna wyłącznie
 * day/week/month/year, więc interwały aplikacji mapują się na krotności:
 * two_weeks -> week x2, quarter -> month x3.
 */
function billingCycle(entry: PaddlePriceEntry): { interval: string; frequency: number } {
  switch (entry.interval) {
    case "two_weeks":
      return { interval: "week", frequency: 2 };
    case "quarter":
      return { interval: "month", frequency: 3 };
    default:
      return { interval: entry.interval, frequency: 1 };
  }
}

/**
 * Okres próbny z `access_plans.trial_days` w formacie operatora.
 * `null` = plan bez triala; operator wymaga wtedy pominięcia pola przy
 * tworzeniu ceny i jawnego `null` przy jego zdejmowaniu.
 */
function trialPeriod(plan: PlanRow): { interval: "day"; frequency: number } | null {
  const days = Math.max(0, Math.round(plan.trial_days ?? 0));
  return days > 0 ? { interval: "day", frequency: days } : null;
}

async function syncOne(
  env: PaddleEnv,
  entry: PaddlePriceEntry,
  plan: PlanRow | undefined,
): Promise<CatalogSyncItem> {
  const item: CatalogSyncItem = {
    priceId: entry.priceId,
    productId: entry.productId,
    product: "ok",
    price: "ok",
  };

  if (!plan || plan.active === false) {
    // Bez lokalnego planu nie znamy kwoty - nie zgadujemy jej po stronie operatora.
    item.product = "skipped";
    item.price = "skipped";
    item.reason = "no_local_plan";
    return item;
  }

  const name = plan.name_pl || plan.name_en || entry.tierKey;
  const amount = String(Math.max(0, Math.round(plan.price_cents ?? 0)));
  const currency = (plan.currency || "PLN").toUpperCase();
  const trial = trialPeriod(plan);

  // 1. Produkt
  let product = await findByExternalId(env, "products", entry.productId);
  if (!product) {
    const res = await gatewayFetch(env, "/products", {
      method: "POST",
      body: JSON.stringify({
        name,
        tax_category: "standard",
        description: plan.description_pl ?? undefined,
        custom_data: { external_id: entry.productId },
      }),
    });
    if (!res.ok) throw new Error(`product_create_${res.status}:${await res.text()}`);
    const json = (await res.json()) as { data?: { id?: string } };
    if (!json.data?.id) throw new Error("product_create_no_id");
    product = { id: String(json.data.id), raw: {} };
    item.product = "created";
  }

  // 2. Cena
  const price = await findByExternalId(env, "prices", entry.priceId);
  if (!price) {
    const res = await gatewayFetch(env, "/prices", {
      method: "POST",
      body: JSON.stringify({
        product_id: product.id,
        description: `${name} (${entry.interval})`,
        unit_price: { amount, currency_code: currency },
        billing_cycle: billingCycle(entry),
        // Okres próbny jest własnością ceny u operatora - bez tego pola
        // checkout obciąża od razu, mimo `trial_days` w planie.
        ...(trial ? { trial_period: trial } : {}),
        quantity: entry.perSeat ? { minimum: 1, maximum: 500 } : { minimum: 1, maximum: 1 },
        custom_data: { external_id: entry.priceId },
      }),
    });
    if (!res.ok) throw new Error(`price_create_${res.status}:${await res.text()}`);
    item.price = "created";
    return item;
  }

  // 3. Korekta rozjechanej kwoty/waluty - checkout musi pobierać tyle, ile
  // pokazuje cennik w aplikacji.
  const unit = (price.raw.unit_price ?? {}) as { amount?: string; currency_code?: string };
  const remoteTrial = (price.raw.trial_period ?? null) as {
    interval?: string;
    frequency?: number;
  } | null;
  const trialDrifted =
    (trial?.frequency ?? null) !== (remoteTrial?.frequency ?? null) ||
    (trial?.interval ?? null) !== (remoteTrial?.interval ?? null);
  const priceDrifted =
    unit.amount !== amount || (unit.currency_code ?? "").toUpperCase() !== currency;

  if (priceDrifted || trialDrifted) {
    const res = await gatewayFetch(env, `/prices/${price.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        unit_price: { amount, currency_code: currency },
        // Jawny `null` zdejmuje trial, gdy plan przestał go oferować.
        trial_period: trial,
      }),
    });
    if (!res.ok) throw new Error(`price_update_${res.status}:${await res.text()}`);
    item.price = "updated";
  }

  return item;
}

/**
 * Odtwarza katalog u operatora na podstawie `access_plans` + `PADDLE_CATALOG`.
 * Idempotentna: powtórne wywołanie na spójnym katalogu nic nie zmienia.
 */
export async function syncPaddleCatalog(env: PaddleEnv = "sandbox"): Promise<CatalogSyncReport> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("access_plans")
    .select(
      "tier_key, interval, price_cents, currency, name_pl, name_en, description_pl, trial_days, active",
    );
  const plans = (data ?? []) as PlanRow[];

  const planFor = (entry: PaddlePriceEntry): PlanRow | undefined =>
    plans.find((p) => p.tier_key === entry.tierKey && (p.interval ?? "month") === entry.interval) ??
    plans.find((p) => p.tier_key === entry.tierKey);

  const items: CatalogSyncItem[] = [];
  for (const entry of PADDLE_CATALOG) {
    try {
      items.push(await syncOne(env, entry, planFor(entry)));
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
  // katalogu lub `access_plans.active = false`), znikają z oferty operatora.
  // Robimy to wyłącznie po czystym przebiegu - błąd API nie może zostać
  // odczytany jako "plan zniknął".
  let archived: ReapedEntry[] = [];
  if (failed === 0) {
    const expectedPriceIds = new Set<string>();
    const expectedProductIds = new Set<string>();
    const inactivePriceIds = new Set<string>();
    for (const entry of PADDLE_CATALOG) {
      const plan = planFor(entry);
      if (plan && plan.active !== false) {
        expectedPriceIds.add(entry.priceId);
        expectedProductIds.add(entry.productId);
      } else {
        inactivePriceIds.add(entry.priceId);
      }
    }
    try {
      const { reapOrphanCatalogEntries } = await import("./paddleCatalogReap.server");
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
 * Samonaprawa wywoływana z checkoutu, gdy cena nie istnieje u operatora -
 * typowy objaw restartu integracji. Uruchamiamy najwyżej jedną synchronizację
 * naraz, żeby równoległe zakupy nie zasypały API operatora.
 */
export async function healCatalogOnce(env: PaddleEnv): Promise<void> {
  if (!healingRun) {
    healingRun = syncPaddleCatalog(env).finally(() => {
      healingRun = null;
    });
  }
  await healingRun;
}
