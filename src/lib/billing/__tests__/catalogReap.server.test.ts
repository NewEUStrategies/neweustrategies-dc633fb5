// Sprzątanie katalogu u operatora płatności (`reapOrphanCatalogEntries`).
//
// CO TU MOŻE KOSZTOWAĆ PIENIĄDZE. Ten moduł jako jedyny w aplikacji WYŁĄCZA
// pozycje w Stripe. Dwa kierunki błędu i oba są drogie:
//   1. ZA MAŁO: plan usunięty z kodu albo wyłączony w bazie zostaje aktywny
//      u operatora - da się go kupić starym linkiem, a panel Payments pokazuje
//      martwe pozycje obok żywych. Klient płaci za coś, czego nie ma w ofercie.
//   2. ZA DUŻO: archiwizacja produktu założonego RĘCZNIE w panelu Stripe
//      (bez naszego znacznika `metadata.lovable_external_id`) albo pozycji,
//      która nadal jest w cenniku. Skutek: „cena nie istnieje" w koszyku
//      i zatrzymana sprzedaż do czasu ręcznej naprawy u operatora.
//
// Dlatego dowodzimy, KTÓRE identyfikatory trafiły do `update(..., {active:false})`,
// a nie tylko „czy coś się stało". Kolejność (ceny przed produktami) też jest
// kontraktem: Stripe odrzuca archiwizację produktu z aktywną ceną.
//
// Atrapa stoi WYŁĄCZNIE na granicy SDK operatora (`getStripeClient`). Listy
// zwracamy jako asynchronicznie iterowalne - dokładnie tak, jak automatyczna
// paginacja SDK (`for await`), więc moduł biegnie bez żadnych podmian logiki.
import { beforeEach, describe, expect, it, vi } from "vitest";

const stripe = vi.hoisted(() => ({
  envs: [] as string[],
  prices: [] as Array<{ id: string; metadata: Record<string, string> | null }>,
  products: [] as Array<{ id: string; metadata: Record<string, string> | null }>,
  /** Parametry `list` - dowód, że czytamy WYŁĄCZNIE aktywne pozycje. */
  listCalls: [] as Array<{ kind: "price" | "product"; params: unknown }>,
  /** Każdy zapis do operatora, w kolejności wykonania. */
  updates: [] as Array<{ kind: "price" | "product"; id: string; payload: unknown }>,
  /** Identyfikator ceny, której archiwizację operator odrzuca. */
  rejectPriceUpdate: null as string | null,
}));

vi.mock("@/lib/stripe.server", () => {
  const asyncList = <T>(rows: T[]) => ({
    [Symbol.asyncIterator]: async function* () {
      for (const row of rows) yield row;
    },
  });
  return {
    getStripeClient: (env: string) => {
      stripe.envs.push(env);
      return {
        prices: {
          list: (params: unknown) => {
            stripe.listCalls.push({ kind: "price", params });
            return asyncList(stripe.prices);
          },
          update: (id: string, payload: unknown) => {
            if (id === stripe.rejectPriceUpdate) {
              return Promise.reject(new Error(`No such price: '${id}'`));
            }
            stripe.updates.push({ kind: "price", id, payload });
            return Promise.resolve({ id });
          },
        },
        products: {
          list: (params: unknown) => {
            stripe.listCalls.push({ kind: "product", params });
            return asyncList(stripe.products);
          },
          update: (id: string, payload: unknown) => {
            stripe.updates.push({ kind: "product", id, payload });
            return Promise.resolve({ id });
          },
        },
      };
    },
  };
});

import { reapOrphanCatalogEntries } from "@/lib/billing/catalogReap.server";

/** Pozycja oznaczona naszym znacznikiem - jedyny rodzaj, który wolno ruszyć. */
const tagged = (id: string, externalId: string) => ({
  id,
  metadata: { lovable_external_id: externalId },
});

beforeEach(() => {
  stripe.envs = [];
  stripe.prices = [];
  stripe.products = [];
  stripe.listCalls = [];
  stripe.updates = [];
  stripe.rejectPriceUpdate = null;
});

describe("reapOrphanCatalogEntries - co zostaje zarchiwizowane", () => {
  it("archiwizuje naszą cenę i produkt, których nie ma już w źródle prawdy", async () => {
    stripe.prices = [tagged("price_pro_m", "pro_monthly"), tagged("price_stary", "legacy_monthly")];
    stripe.products = [tagged("prod_pro", "plan_pro"), tagged("prod_stary", "plan_legacy")];

    const reaped = await reapOrphanCatalogEntries({
      env: "live",
      expectedPriceIds: new Set(["pro_monthly"]),
      expectedProductIds: new Set(["plan_pro"]),
    });

    expect(reaped).toEqual([
      {
        kind: "price",
        externalId: "legacy_monthly",
        providerId: "price_stary",
        reason: "not_in_catalog",
      },
      {
        kind: "product",
        externalId: "plan_legacy",
        providerId: "prod_stary",
        reason: "not_in_catalog",
      },
    ]);
    // Archiwizacja, nigdy kasowanie - i tylko pozycje spoza źródła prawdy.
    expect(stripe.updates).toEqual([
      { kind: "price", id: "price_stary", payload: { active: false } },
      { kind: "product", id: "prod_stary", payload: { active: false } },
    ]);
    expect(stripe.envs).toEqual(["live"]);
  });

  it("cena planu WYŁĄCZONEGO w bazie dostaje powód `plan_inactive`, a nie `not_in_catalog`", async () => {
    // Te dwa powody prowadzą do różnych napraw: `plan_inactive` to decyzja
    // w panelu (włącz plan), `not_in_catalog` to zmiana w kodzie. Pomylone
    // wysyłają operatora szukać przyczyny w złym miejscu.
    stripe.prices = [tagged("price_plus_m", "plus_monthly"), tagged("price_x", "usuniety_plan")];

    const reaped = await reapOrphanCatalogEntries({
      env: "sandbox",
      expectedPriceIds: new Set(),
      expectedProductIds: new Set(),
      inactivePriceIds: new Set(["plus_monthly"]),
    });

    expect(reaped.map((r) => [r.providerId, r.reason])).toEqual([
      ["price_plus_m", "plan_inactive"],
      ["price_x", "not_in_catalog"],
    ]);
  });

  it("PRODUKT planu wyłączonego w bazie też dostaje powód `plan_inactive`", async () => {
    // Produkty i ceny mają rozłączne identyfikatory (`plan_pro` vs
    // `pro_monthly`), więc powód produktu nie może pochodzić z listy CEN -
    // wtedy produkt wyłączonego planu zawsze wychodził jako `not_in_catalog`.
    stripe.prices = [tagged("price_pro_m", "pro_monthly")];
    stripe.products = [tagged("prod_pro", "plan_pro"), tagged("prod_x", "usuniety_produkt")];

    const reaped = await reapOrphanCatalogEntries({
      env: "sandbox",
      expectedPriceIds: new Set(),
      expectedProductIds: new Set(),
      inactivePriceIds: new Set(["pro_monthly"]),
      inactiveProductIds: new Set(["plan_pro"]),
    });

    expect(reaped.map((r) => [r.kind, r.providerId, r.reason])).toEqual([
      ["price", "price_pro_m", "plan_inactive"],
      ["product", "prod_pro", "plan_inactive"],
      ["product", "prod_x", "not_in_catalog"],
    ]);
  });

  it("bez listy planów wyłączonych każdy sierota ma powód `not_in_catalog`", async () => {
    stripe.prices = [tagged("price_plus_m", "plus_monthly")];

    const reaped = await reapOrphanCatalogEntries({
      env: "sandbox",
      expectedPriceIds: new Set(),
      expectedProductIds: new Set(),
    });

    expect(reaped).toEqual([
      {
        kind: "price",
        externalId: "plus_monthly",
        providerId: "price_plus_m",
        reason: "not_in_catalog",
      },
    ]);
  });

  it("ceny idą PRZED produktami - Stripe odrzuca archiwizację produktu z aktywną ceną", async () => {
    stripe.prices = [tagged("price_a", "a_monthly"), tagged("price_b", "b_monthly")];
    stripe.products = [tagged("prod_a", "plan_a")];

    await reapOrphanCatalogEntries({
      env: "sandbox",
      expectedPriceIds: new Set(),
      expectedProductIds: new Set(),
    });

    expect(stripe.updates.map((u) => `${u.kind}:${u.id}`)).toEqual([
      "price:price_a",
      "price:price_b",
      "product:prod_a",
    ]);
  });

  it("czyta u operatora WYŁĄCZNIE aktywne pozycje (stronicowanie po 100)", async () => {
    // Bez `active: true` każde wywołanie ponownie „archiwizowałoby" pozycje
    // zarchiwizowane wcześniej - zbędne żądania przy każdej synchronizacji.
    await reapOrphanCatalogEntries({
      env: "sandbox",
      expectedPriceIds: new Set(),
      expectedProductIds: new Set(),
    });

    expect(stripe.listCalls).toEqual([
      { kind: "price", params: { active: true, limit: 100 } },
      { kind: "product", params: { active: true, limit: 100 } },
    ]);
  });
});

describe("reapOrphanCatalogEntries - czego NIE WOLNO ruszyć", () => {
  it("pozycji założonych ręcznie (bez naszego znacznika) nie dotyka nigdy", async () => {
    // Produkty z panelu Stripe (np. jednorazowe faktury sponsorskie) nie mają
    // `lovable_external_id`. Archiwizacja ich zatrzymałaby sprzedaż, o której
    // aplikacja nawet nie wie.
    stripe.prices = [
      { id: "price_reczna_bez_metadanych", metadata: null },
      { id: "price_reczna_inny_klucz", metadata: { kampania: "jesien" } },
    ];
    stripe.products = [{ id: "prod_reczny", metadata: {} }];

    const reaped = await reapOrphanCatalogEntries({
      env: "live",
      expectedPriceIds: new Set(),
      expectedProductIds: new Set(),
    });

    expect(reaped).toEqual([]);
    expect(stripe.updates).toEqual([]);
  });

  it("znacznik pusty albo z samych spacji traktuje jak brak znacznika", async () => {
    // Pusty identyfikator nie wskazuje ŻADNEJ pozycji katalogu, więc nie może
    // być dowodem, że pozycja jest „nasza i osierocona".
    stripe.prices = [tagged("price_pusty", ""), tagged("price_spacje", "   ")];
    stripe.products = [tagged("prod_spacje", "  ")];

    const reaped = await reapOrphanCatalogEntries({
      env: "sandbox",
      expectedPriceIds: new Set(),
      expectedProductIds: new Set(),
    });

    expect(reaped).toEqual([]);
    expect(stripe.updates).toEqual([]);
  });

  it("znacznik z białymi znakami na brzegach jest dopasowany po przycięciu", async () => {
    // Metadane edytowane ręcznie w panelu operatora potrafią złapać spację.
    // Bez przycięcia aktywna cena z cennika zostałaby uznana za sierotę
    // i zarchiwizowana - koszyk pokazałby „cena nie istnieje".
    stripe.prices = [tagged("price_pro_m", " pro_monthly ")];
    stripe.products = [tagged("prod_pro", "plan_pro\n")];

    const reaped = await reapOrphanCatalogEntries({
      env: "sandbox",
      expectedPriceIds: new Set(["pro_monthly"]),
      expectedProductIds: new Set(["plan_pro"]),
    });

    expect(reaped).toEqual([]);
    expect(stripe.updates).toEqual([]);
  });

  it("spójny katalog nie generuje ANI JEDNEGO zapisu (idempotencja)", async () => {
    stripe.prices = [tagged("price_pro_m", "pro_monthly"), tagged("price_pro_y", "pro_annual")];
    stripe.products = [tagged("prod_pro", "plan_pro")];
    const input = {
      env: "sandbox" as const,
      expectedPriceIds: new Set(["pro_monthly", "pro_annual"]),
      expectedProductIds: new Set(["plan_pro"]),
    };

    expect(await reapOrphanCatalogEntries(input)).toEqual([]);
    expect(await reapOrphanCatalogEntries(input)).toEqual([]);
    expect(stripe.updates).toEqual([]);
  });

  it("odmowa operatora przy cenie przerywa sprzątanie, ZANIM ruszy produkty", async () => {
    // Produkt z ceną, której nie udało się zarchiwizować, nadal ma aktywną
    // cenę - próba archiwizacji produktu byłaby odrzucona albo, gorzej,
    // zostawiła cenę bez aktywnego produktu. Błąd idzie do wołającego
    // (`syncBillingCatalog` loguje go i nie unieważnia synchronizacji).
    stripe.prices = [tagged("price_a", "a_monthly"), tagged("price_b", "b_monthly")];
    stripe.products = [tagged("prod_a", "plan_a")];
    stripe.rejectPriceUpdate = "price_a";

    await expect(
      reapOrphanCatalogEntries({
        env: "sandbox",
        expectedPriceIds: new Set(),
        expectedProductIds: new Set(),
      }),
    ).rejects.toThrow("No such price: 'price_a'");
    expect(stripe.updates).toEqual([]);
    expect(stripe.listCalls.map((c) => c.kind)).toEqual(["price"]);
  });
});
