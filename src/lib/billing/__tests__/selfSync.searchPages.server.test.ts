// Wyszukiwanie subskrypcji operatora po `metadata.userId` - STRONICOWANIE.
//
// `searchSubscriptionsByUserId` ma dwóch wołających: samoobsługową
// synchronizację (jedna strona) i zamknięcie konta (`accountClosure.server`,
// kilka stron). Przy zamknięciu konta pominięta strona to subskrypcja, która
// dalej obciąża kartę po usunięciu konta, a pętla bez granicy - żądanie,
// które nigdy się nie kończy. Ten plik przypina oba końce: kursor kolejnej
// strony jedzie do operatora, a odczyt kończy się na granicy stron albo na
// odpowiedzi bez kursora.
//
// Granica atrapowana: klient operatora (sam `subscriptions.search`).
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { searchSubscriptionsByUserId } from "@/lib/billing/selfSync.server";

const USER = "4b1c2d3e-0000-4000-8000-00000000abcd";

interface SearchPage {
  data: Array<{ id: string }>;
  has_more: boolean;
  next_page: string | null;
}

/** Klient operatora z kolejką stron wyszukiwania (każde wywołanie bierze następną). */
function stripeWithPages(pages: SearchPage[]) {
  const search = vi.fn(async () => {
    const page = pages.shift();
    if (!page) throw new Error("test: wyszukiwanie poprosiło o stronę, której nie ma");
    return page;
  });
  return { stripe: { subscriptions: { search } } as unknown as Stripe, search };
}

const page = (ids: string[], next: string | null): SearchPage => ({
  data: ids.map((id) => ({ id })),
  has_more: next !== null,
  next_page: next,
});

describe("searchSubscriptionsByUserId - stronicowanie", () => {
  it("idzie kursorem operatora przez kolejne strony i oddaje wszystko w kolejności", async () => {
    const { stripe, search } = stripeWithPages([
      page(["sub_a", "sub_b"], "cursor_2"),
      page(["sub_c"], "cursor_3"),
      page(["sub_d"], null),
    ]);

    const found = await searchSubscriptionsByUserId(stripe, USER, { limit: 2, maxPages: 5 });

    expect(found.map((sub) => sub.id)).toEqual(["sub_a", "sub_b", "sub_c", "sub_d"]);
    expect(search.mock.calls).toEqual([
      [{ query: `metadata['userId']:'${USER}'`, limit: 2 }],
      [{ query: `metadata['userId']:'${USER}'`, limit: 2, page: "cursor_2" }],
      [{ query: `metadata['userId']:'${USER}'`, limit: 2, page: "cursor_3" }],
    ]);
  });

  it("odczyt jest OGRANICZONY liczbą stron - nawet gdy operator ma ich więcej", async () => {
    const { stripe, search } = stripeWithPages([
      page(["sub_a"], "cursor_2"),
      page(["sub_b"], "cursor_3"),
      page(["sub_c"], "cursor_4"),
    ]);

    const found = await searchSubscriptionsByUserId(stripe, USER, { limit: 1, maxPages: 2 });

    expect(found.map((sub) => sub.id)).toEqual(["sub_a", "sub_b"]);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("`has_more` bez kursora kończy odczyt zamiast prosić o stronę `undefined`", async () => {
    const { stripe, search } = stripeWithPages([
      { data: [{ id: "sub_a" }], has_more: true, next_page: null },
    ]);

    const found = await searchSubscriptionsByUserId(stripe, USER, { maxPages: 3 });

    expect(found.map((sub) => sub.id)).toEqual(["sub_a"]);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("domyślnie JEDNA strona po 20 - samoobsługowa synchronizacja nie przegląda całego konta", async () => {
    const { stripe, search } = stripeWithPages([page(["sub_a"], "cursor_2")]);

    const found = await searchSubscriptionsByUserId(stripe, USER);

    expect(found.map((sub) => sub.id)).toEqual(["sub_a"]);
    expect(search.mock.calls).toEqual([[{ query: `metadata['userId']:'${USER}'`, limit: 20 }]]);
  });

  it("granica stron poniżej jednej i tak czyta pierwszą stronę", async () => {
    const { stripe, search } = stripeWithPages([page(["sub_a"], "cursor_2")]);

    expect(
      (await searchSubscriptionsByUserId(stripe, USER, { maxPages: 0 })).map((s) => s.id),
    ).toEqual(["sub_a"]);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("błąd operatora na DALSZEJ stronie wychodzi do wołającego - nie ma połowicznego „nic więcej”", async () => {
    // Zamknięcie konta traktuje wyjątek jako niewiadomą (`search:<env>`
    // w `failed`); połknięty błąd udawałby, że reszty subskrypcji nie ma.
    const search = vi
      .fn()
      .mockResolvedValueOnce(page(["sub_a"], "cursor_2"))
      .mockRejectedValueOnce(new Error("rate_limit"));
    const stripe = { subscriptions: { search } } as unknown as Stripe;

    await expect(searchSubscriptionsByUserId(stripe, USER, { maxPages: 3 })).rejects.toThrow(
      "rate_limit",
    );
  });
});
