// Archiwizacja pozycji katalogu, które zniknęły ze źródła prawdy aplikacji.
//
// Katalog u operatora płatności jest odtwarzany z `BILLING_CATALOG` + `access_plans`.
// Gdy plan zostanie usunięty z kodu albo wyłączony w bazie (`active = false`),
// jego produkt i cena zostają po stronie operatora i nadal widnieją jako
// aktywne - można je kupić linkiem, a panel Payments pokazuje martwe pozycje.
// Ten moduł domyka pętlę: aktywne pozycje oznaczone naszym `external_id`,
// których nie ma już w źródle, są archiwizowane (nigdy kasowane - operator
// wymaga zachowania historii transakcji).
//
// Bezpieczniki:
//  - dotykamy wyłącznie pozycji z naszym znacznikiem `custom_data.external_id`
//    (ręcznie założone produkty operatora zostają nietknięte),
//  - reap nie rusza, jeśli podstawowa synchronizacja miała błąd - awaria API
//    nie może wyglądać jak "plan zniknął ze źródła".
import { gatewayFetch, type StripeEnv } from "@/lib/stripe.server";

export interface ReapedEntry {
  kind: "product" | "price";
  externalId: string;
  providerId: string;
  reason: "not_in_catalog" | "plan_inactive";
}

interface ProviderRow {
  id?: unknown;
  status?: unknown;
  product_id?: unknown;
  custom_data?: unknown;
}

/** Nasz znacznik własności - ustawiany przy tworzeniu pozycji przez sync. */
function externalIdOf(row: ProviderRow): string | null {
  const custom = row.custom_data;
  if (!custom || typeof custom !== "object") return null;
  const value = (custom as Record<string, unknown>).external_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function listActive(env: StripeEnv, resource: "products" | "prices"): Promise<ProviderRow[]> {
  const rows: ProviderRow[] = [];
  let after: string | null = null;
  // Twardy limit stron - katalog jest mały, a pętla nie może zawisnąć na
  // niespodziewanej paginacji operatora.
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ status: "active", per_page: "100" });
    if (after) query.set("after", after);
    const res = await gatewayFetch(env, `/${resource}?${query.toString()}`);
    if (!res.ok) throw new Error(`${resource}_list_${res.status}`);
    const json = (await res.json()) as {
      data?: ProviderRow[];
      meta?: { pagination?: { has_more?: boolean; next?: string } };
    };
    const data = json.data ?? [];
    rows.push(...data);
    const pagination = json.meta?.pagination;
    const last = data[data.length - 1];
    if (!pagination?.has_more || !last?.id) break;
    after = String(last.id);
  }
  return rows;
}

async function archive(
  env: StripeEnv,
  resource: "products" | "prices",
  providerId: string,
): Promise<void> {
  const res = await gatewayFetch(env, `/${resource}/${providerId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "archived" }),
  });
  if (!res.ok) throw new Error(`${resource}_archive_${res.status}:${await res.text()}`);
}

export interface ReapInput {
  env: StripeEnv;
  /** `external_id` cen, które nadal mają odpowiednik w źródle prawdy. */
  expectedPriceIds: ReadonlySet<string>;
  /** `external_id` produktów, które nadal mają aktywną cenę. */
  expectedProductIds: ReadonlySet<string>;
  /** `external_id` znane katalogowi, ale z wyłączonym planem w bazie. */
  inactivePriceIds?: ReadonlySet<string>;
}

/**
 * Archiwizuje nasze aktywne produkty i ceny nieobecne w źródle prawdy.
 * Idempotentna: przy spójnym katalogu nie wykonuje żadnego zapisu.
 * Ceny idą pierwsze - operator odrzuca archiwizację produktu z aktywną ceną.
 */
export async function reapOrphanCatalogEntries(input: ReapInput): Promise<ReapedEntry[]> {
  const { env, expectedPriceIds, expectedProductIds, inactivePriceIds = new Set<string>() } = input;
  const reaped: ReapedEntry[] = [];

  const reasonFor = (externalId: string): ReapedEntry["reason"] =>
    inactivePriceIds.has(externalId) ? "plan_inactive" : "not_in_catalog";

  const prices = await listActive(env, "prices");
  for (const row of prices) {
    const externalId = externalIdOf(row);
    const providerId = typeof row.id === "string" ? row.id : null;
    if (!externalId || !providerId || expectedPriceIds.has(externalId)) continue;
    await archive(env, "prices", providerId);
    reaped.push({ kind: "price", externalId, providerId, reason: reasonFor(externalId) });
  }

  const products = await listActive(env, "products");
  for (const row of products) {
    const externalId = externalIdOf(row);
    const providerId = typeof row.id === "string" ? row.id : null;
    if (!externalId || !providerId || expectedProductIds.has(externalId)) continue;
    await archive(env, "products", providerId);
    reaped.push({ kind: "product", externalId, providerId, reason: reasonFor(externalId) });
  }

  return reaped;
}
