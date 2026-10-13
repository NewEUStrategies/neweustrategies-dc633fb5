// Automatyczna synchronizacja katalogu produktów i cen w Stripe.
//
// Po ponownym podłączeniu integracji (nowe konto Stripe, przywrócenie
// środowiska) identyfikatory wewnętrzne znikają, a w aplikacji zostają tylko
// czytelne identyfikatory (`lookup_key` ceny, `metadata.lovable_external_id`
// produktu). Ten moduł odtwarza katalog idempotentnie: produkt/cena są
// zakładane, gdy ich brak, a rozjechana kwota, waluta, cykl, kształt ceny
// (progi, przekształcanie ilości) lub trial są korygowane do wartości
// z `access_plans` (źródło prawdy aplikacji) - dokładnie to, czego kasa
// wymaga przed sesją (`catalogPriceMismatch`).
//
// JEDNO ŹRÓDŁO PRAWDY: PLANY NAJEMCY DOMYŚLNEGO. Katalog operatora jest JEDEN
// na instalację - `lookup_key` (`plus_monthly`, `pro_annual`...) nie niesie
// najemcy, a każdy najemca ma własne wiersze `access_plans` z tym samym
// `tier_key`/`interval`. Odczyt bez filtra najemcy i `plans.find(...)` brały
// pierwszy z brzegu wiersz DOWOLNEGO najemcy: edytor najemcy B zmieniał
// kwotę, synchronizacja przepisywała cenę wszystkim (zamówienie A zapisywało
// cenę A, operator pobierał cenę B), a plan wyłączony w jednym najemcy
// archiwizował cenę całej instalacji. Źródłem jest więc wyłącznie najemca
// `tenants.is_default` - ten, z którego cennika powstały dzisiejsze ceny,
// więc żaden `lookup_key` nie zmienia się przy tej naprawie. Pozostali
// najemcy sprzedają po cenie wspólnej albo wcale: kasa przed sesją porównuje
// kwotę zamówienia z ceną operatora (`catalogPriceMismatch`) i odmawia przy
// rozjeździe. Osobne `lookup_key` per najemca odrzuciliśmy świadomie - webhook
// mapuje cenę na plan po samym kluczu (`catalogEntryByPriceId`), więc zmiana
// klucza ceny oznaczałaby migrację żywych subskrypcji.
import type Stripe from "stripe";

import { getStripeClient, type StripeEnv } from "@/lib/stripe.server";

import {
  BILLING_CATALOG,
  catalogCycleMismatch,
  catalogRecurringFor,
  type CatalogPriceEntry,
} from "./catalog";
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

/** Wiersz `access_plans` w kształcie czytanym przez synchronizację i odcisk cennika. */
export interface CatalogSourcePlan {
  id?: string | null;
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
  sort_order?: number | null;
  created_at?: string | null;
}

type PlanRow = CatalogSourcePlan;

const SOURCE_PLAN_COLUMNS =
  "id, tier_key, interval, price_cents, currency, name_pl, name_en, description_pl, trial_days, active, volume_threshold_seats, volume_price_cents, sort_order, created_at";

/**
 * Plany źródła prawdy katalogu: WYŁĄCZNIE najemca domyślny instalacji.
 *
 * Błąd odczytu i brak najemcy domyślnego RZUCAJĄ - to nie jest pusty cennik.
 * Pusta lista po awarii dawałaby przebieg bez porażek, po którym sprzątanie
 * archiwizowałoby u operatora całą ofertę.
 */
export async function loadCatalogSourcePlans(): Promise<CatalogSourcePlan[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .eq("is_default", true)
    .maybeSingle();
  if (tenantError) {
    throw new Error(`catalog sync: default tenant lookup failed: ${tenantError.message}`);
  }
  const tenantId = (tenant as { id?: string } | null)?.id;
  if (!tenantId) throw new Error("catalog sync: default tenant missing");

  const { data, error } = await supabaseAdmin
    .from("access_plans")
    .select(SOURCE_PLAN_COLUMNS)
    .eq("tenant_id", tenantId);
  // Błąd odczytu (timeout, RLS) NIE jest pustym cennikiem. Potraktowany jak
  // brak planów dawał przebieg bez porażek, po którym sprzątanie archiwizowało
  // u operatora CAŁĄ ofertę, a stan integracji zapisywał `ok`. Rzut trafia do
  // wołających (`runEnsure`, panel), które zapisują go jako porażkę.
  if (error) throw new Error(`catalog sync: access_plans lookup failed: ${error.message}`);
  return (data ?? []) as CatalogSourcePlan[];
}

/**
 * Plan źródła dla pozycji katalogu - dokładnie ta para (tier, cykl).
 *
 * Bez zapasowego „pierwszego planu tego progu": pozycja kwartalna bez planu
 * kwartalnego dostawała kwotę planu miesięcznego (cena u operatora w innym
 * cyklu za inną kwotę). Brak planu = pozycja pominięta i zarchiwizowana.
 *
 * Kilka planów tej samej pary w jednym najemcy to stan dopuszczalny; wybór
 * jest powtarzalny i ten sam co w webhooku (`resolvePlanForPrice`): aktywny,
 * potem `sort_order`, `created_at`, `id`. Wyłączony duplikat nie może więc
 * zarchiwizować ceny aktywnego planu.
 */
export function catalogPlanForEntry(
  plans: readonly CatalogSourcePlan[],
  entry: CatalogPriceEntry,
): CatalogSourcePlan | undefined {
  const candidates = plans.filter(
    (p) => p.tier_key === entry.tierKey && (p.interval ?? "month") === entry.interval,
  );
  const text = (v: string | null | undefined) => v ?? "";
  return [...candidates].sort(
    (a, b) =>
      Number(b.active !== false) - Number(a.active !== false) ||
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      text(a.created_at).localeCompare(text(b.created_at)) ||
      text(a.id).localeCompare(text(b.id)),
  )[0];
}

/** Kod podatkowy dla treści cyfrowych/oprogramowania SaaS - wspólny dla całego katalogu. */
const DIGITAL_SERVICE_TAX_CODE = "txcd_10103000";

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

/**
 * Kwotowa część parametrów ceny: płaska albo schodkowa. Rozdzielona od reszty,
 * bo ten sam kształt trafia i do zakładania ceny, i do jej odtwarzania po
 * dryfie - a wszystko poza kwotą (produkt, waluta, `lookup_key`, cykl) jest
 * w obu miejscach wspólne.
 */
type StripePriceShape =
  | { billing_scheme: "tiered"; tiers_mode: "volume"; tiers: Stripe.PriceCreateParams.Tier[] }
  | { unit_amount: number };

/**
 * Czy zdalna cena schodkowa odpowiada progom wyliczonym z katalogu. Opłata
 * stała progu (`flat_amount`) też jest częścią kwoty - kasa doliczy ją do
 * obciążenia (`stripePriceAmountFor`), a katalog jej nie zakłada.
 */
function tiersMatch(
  remote: Stripe.Price.Tier[] | undefined,
  expected: Stripe.PriceCreateParams.Tier[],
): boolean {
  if (!remote || remote.length !== expected.length) return false;
  return expected.every((want, i) => {
    const got = remote[i];
    if (!got) return false;
    const wantUpTo = want.up_to === "inf" ? null : Number(want.up_to);
    return (
      (got.up_to ?? null) === wantUpTo &&
      (got.unit_amount ?? null) === want.unit_amount &&
      (got.flat_amount ?? 0) === 0
    );
  });
}

/**
 * Kształt ceny, którego kasa nie umie policzyć jednoznacznie albo który
 * zmienia obciążenie niezależnie od kwoty: przekształcanie ilości, kwota
 * wpisywana przez klienta i schodki w trybie innym niż `volume` (`graduated`
 * liczy niższą stawkę tylko od nadwyżki). Kasa odmawia takiej ceny
 * (`unverifiable_amount` / `amount`), więc synchronizacja musi ją odtworzyć -
 * inaczej plan byłby niekupowalny do ręcznej interwencji u operatora.
 */
function priceShapeDrifted(
  price: Stripe.Price,
  tiers: Stripe.PriceCreateParams.Tier[] | null,
): boolean {
  if (price.transform_quantity || price.custom_unit_amount) return true;
  return !!tiers && price.tiers_mode !== "volume";
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
  const recurring = catalogRecurringFor(entry);
  const tiers = volumeTiersFor(entry, plan, amount);
  // Kształt ceny jest jeden dla założenia i dla korekty - inaczej cena
  // odtworzona po dryfie kwoty gubiłaby progi wolumenowe.
  //
  // Typ celowo WĘŻSZY niż `Stripe.PriceCreateParams`: ten obiekt niesie sam
  // kształt kwoty i jest rozwijany po `currency`, a pełny typ parametrów ma
  // `currency` w sobie - kompilator zgłaszałby wtedy nadpisanie pola (TS2783)
  // i brak wymaganej `currency` w samym kształcie.
  const shape: StripePriceShape = tiers
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

  // 3. Korekta rozjechanej kwoty/waluty/cyklu/kształtu/triala - checkout musi
  // pobierać tyle i w takim rytmie, jak pokazuje cennik w aplikacji. Każda
  // odmowa ceny w kasie (`catalogPriceMismatch`) ma tu swój odpowiednik.
  const remoteTrialRaw = price.metadata?.["trial_days"];
  const remoteTrialDays = remoteTrialRaw ? Number(remoteTrialRaw) : null;
  const currencyDrifted = (price.currency ?? "").toLowerCase() !== currency;
  // Cena schodkowa nie ma `unit_amount` - porównujemy progi. Zmiana kształtu
  // (płaska <-> schodkowa) też jest dryfem: przejście progu wolumenowego
  // z konfiguracji do katalogu musi przełożyć się na cenę u operatora. Cena
  // płaska BEZ `unit_amount` (sama `unit_amount_decimal`) to dryf nawet przy
  // kwocie zero - kasa takiej ceny nie policzy.
  const amountDrifted = tiers
    ? price.billing_scheme !== "tiered" || !tiersMatch(price.tiers ?? undefined, tiers)
    : price.billing_scheme === "tiered" ||
      typeof price.unit_amount !== "number" ||
      price.unit_amount !== amount;
  // Cykl: ta sama kontrola, którą kasa odrzuca cenę przed sesją. Stripe nie
  // pozwala zmienić cyklu istniejącej ceny, więc dryf = nowa cena.
  const cycleDrifted = catalogCycleMismatch(price, entry);
  const shapeDrifted = priceShapeDrifted(price, tiers);
  const trialDrifted = (trialDays ?? null) !== (remoteTrialDays ?? null);

  if (amountDrifted || currencyDrifted || cycleDrifted || shapeDrifted) {
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
 * Odtwarza katalog w Stripe na podstawie `access_plans` najemcy domyślnego
 * + `BILLING_CATALOG`. Idempotentna: powtórne wywołanie na spójnym katalogu
 * nic nie zmienia.
 */
export async function syncBillingCatalog(env: StripeEnv = "sandbox"): Promise<CatalogSyncReport> {
  const stripe = await getStripeClient(env);
  const plans = await loadCatalogSourcePlans();

  const planFor = (entry: CatalogPriceEntry): PlanRow | undefined =>
    catalogPlanForEntry(plans, entry);

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
    const inactiveProductIds = new Set<string>();
    for (const entry of BILLING_CATALOG) {
      const plan = planFor(entry);
      if (plan && plan.active !== false) {
        expectedPriceIds.add(entry.priceId);
        expectedProductIds.add(entry.productId);
      } else {
        inactivePriceIds.add(entry.priceId);
        inactiveProductIds.add(entry.productId);
      }
    }
    // Produkty i ceny mają rozłączne identyfikatory, więc powód archiwizacji
    // produktu potrzebuje własnej listy. Produkt z choćby jedną aktywną ceną
    // (np. `plan_plus` przy wyłączonej cenie rocznej) nie jest produktem
    // wyłączonego planu - zostaje w ofercie.
    for (const productId of expectedProductIds) inactiveProductIds.delete(productId);
    try {
      const { reapOrphanCatalogEntries } = await import("./catalogReap.server");
      archived = await reapOrphanCatalogEntries({
        env,
        expectedPriceIds,
        expectedProductIds,
        inactivePriceIds,
        inactiveProductIds,
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
