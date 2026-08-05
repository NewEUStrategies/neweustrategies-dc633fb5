// Archiwizacja pozycji katalogu, które zniknęły ze źródła prawdy aplikacji.
//
// Katalog w Stripe jest odtwarzany z `BILLING_CATALOG` + `access_plans`. Gdy
// plan zostanie usunięty z kodu albo wyłączony w bazie (`active = false`),
// jego produkt i cena zostają aktywne w Stripe - można je kupić linkiem, a
// panel Payments pokazuje martwe pozycje. Ten moduł domyka pętlę: aktywne
// pozycje oznaczone naszym `metadata.lovable_external_id`, których nie ma już
// w źródle, są archiwizowane (nigdy kasowane - Stripe wymaga zachowania
// historii transakcji, a i my nigdy nie usuwamy).
//
// Bezpieczniki:
//  - dotykamy wyłącznie pozycji z naszym znacznikiem `metadata.lovable_external_id`
//    (ręcznie założone produkty Stripe zostają nietknięte),
//  - reap nie rusza, jeśli podstawowa synchronizacja miała błąd - awaria API
//    nie może wyglądać jak "plan zniknął ze źródła".
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";

export interface ReapedEntry {
  kind: "product" | "price";
  externalId: string;
  providerId: string;
  reason: "not_in_catalog" | "plan_inactive";
}

export interface ReapInput {
  env: StripeEnv;
  /** `lovable_external_id` cen, które nadal mają odpowiednik w źródle prawdy. */
  expectedPriceIds: ReadonlySet<string>;
  /** `lovable_external_id` produktów, które nadal mają aktywną cenę. */
  expectedProductIds: ReadonlySet<string>;
  /** `lovable_external_id` znane katalogowi, ale z wyłączonym planem w bazie. */
  inactivePriceIds?: ReadonlySet<string>;
}

function externalIdOf(metadata: Record<string, string> | null | undefined): string | null {
  const value = metadata?.["lovable_external_id"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Archiwizuje nasze aktywne produkty i ceny nieobecne w źródle prawdy.
 * Idempotentna: przy spójnym katalogu nie wykonuje żadnego zapisu.
 * Ceny idą pierwsze - Stripe odrzuca archiwizację produktu z aktywną ceną.
 */
export async function reapOrphanCatalogEntries(input: ReapInput): Promise<ReapedEntry[]> {
  const { env, expectedPriceIds, expectedProductIds, inactivePriceIds = new Set<string>() } = input;
  const stripe = createStripeClient(env);
  const reaped: ReapedEntry[] = [];

  const reasonFor = (externalId: string): ReapedEntry["reason"] =>
    inactivePriceIds.has(externalId) ? "plan_inactive" : "not_in_catalog";

  for await (const price of stripe.prices.list({ active: true, limit: 100 })) {
    const externalId = externalIdOf(price.metadata);
    if (!externalId || expectedPriceIds.has(externalId)) continue;
    await stripe.prices.update(price.id, { active: false });
    reaped.push({ kind: "price", externalId, providerId: price.id, reason: reasonFor(externalId) });
  }

  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    const externalId = externalIdOf(product.metadata);
    if (!externalId || expectedProductIds.has(externalId)) continue;
    await stripe.products.update(product.id, { active: false });
    reaped.push({
      kind: "product",
      externalId,
      providerId: product.id,
      reason: reasonFor(externalId),
    });
  }

  return reaped;
}
