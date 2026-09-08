import { describe, expect, it, vi } from "vitest";

import {
  addCartItem,
  cartItemId,
  cartItemLabel,
  cartTotals,
  parseCart,
  pruneCart,
  removeCartItem,
  readCartStorage,
  writeCartStorage,
  type CartItem,
} from "@/lib/cart/cartStore";

function item(overrides: Partial<CartItem> = {}): CartItem {
  const base: CartItem = {
    id: cartItemId("e1", null),
    kind: "event_ticket",
    eventId: "e1",
    slug: "szczyt-2026",
    titlePl: "Szczyt 2026",
    titleEn: "Summit 2026",
    ticketTypeId: null,
    ticketNamePl: "",
    ticketNameEn: "",
    priceCents: 19900,
    currency: "PLN",
    addedAt: "2026-08-01T10:00:00.000Z",
  };
  return { ...base, ...overrides };
}

describe("cartStore", () => {
  it("ignores non-array storage and non-record items", () => {
    expect(parseCart('{"eventId":"e1"}')).toEqual([]);
    expect(parseCart('[null, 1, "bad", []]')).toEqual([]);
  });
  it("normalizes overflowing prices and absent currency/time in legacy storage", () => {
    expect(parseCart('[{"eventId":"e1","slug":"summit","priceCents":1e400}]')).toEqual([
      expect.objectContaining({
        priceCents: 0,
        currency: "PLN",
        addedAt: "1970-01-01T00:00:00.000Z",
      }),
    ]);
    expect(pruneCart([item({ addedAt: "invalid date" })], new Date("2026-08-02"))).toEqual([]);
  });
  it.each([
    ["en", "Polski", "", "Polski"],
    ["pl", "", "English", "English"],
    ["en", "", "", "szczyt-2026"],
  ] as const)(
    "labels a sparse %s item using the available title or slug",
    (lang, titlePl, titleEn, expected) => {
      expect(cartItemLabel(item({ titlePl, titleEn }), lang)).toBe(expected);
    },
  );
  it("has no browser storage dependency in SSR", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(readCartStorage()).toEqual([]);
      expect(() => writeCartStorage([item()])).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("dodanie tej samej pozycji nie duplikuje wiersza, tylko odświeża cenę", () => {
    const first = addCartItem([], item());
    const second = addCartItem(first, item({ priceCents: 24900 }));
    expect(second).toHaveLength(1);
    expect(second[0].priceCents).toBe(24900);
  });

  it("różne rodzaje wejściówek tego samego wydarzenia to różne pozycje", () => {
    const cart = addCartItem(addCartItem([], item()), item({ ticketTypeId: "vip" }));
    expect(cart).toHaveLength(2);
    expect(cart.map((entry) => entry.id)).toEqual(["e1:default", "e1:vip"]);
  });

  it("usuwanie działa po identyfikatorze pozycji", () => {
    const cart = addCartItem([], item());
    expect(removeCartItem(cart, "e1:default")).toEqual([]);
  });

  it("sumy są rozbite po walucie", () => {
    const cart = [item(), item({ eventId: "e2", currency: "EUR", priceCents: 5000 })].map(
      (entry) => ({
        ...entry,
        id: cartItemId(entry.eventId, entry.ticketTypeId),
      }),
    );
    expect(cartTotals(cart)).toEqual({
      count: 2,
      byCurrency: [
        { currency: "EUR", amountCents: 5000 },
        { currency: "PLN", amountCents: 19900 },
      ],
    });
  });

  it("uszkodzony zapis w przeglądarce daje pusty koszyk, nie wyjątek", () => {
    expect(parseCart("{{nie-json")).toEqual([]);
    expect(parseCart(null)).toEqual([]);
    expect(parseCart('[{"slug":"x"}]')).toEqual([]);
  });

  it("notatki starsze niż 30 dni znikają", () => {
    const now = new Date("2026-09-15T00:00:00.000Z");
    const fresh = item({ addedAt: "2026-09-10T00:00:00.000Z" });
    const stale = item({ eventId: "e2", addedAt: "2026-07-01T00:00:00.000Z" });
    expect(pruneCart([fresh, stale], now)).toEqual([fresh]);
  });

  it("etykieta łączy tytuł z nazwą wejściówki w języku interfejsu", () => {
    const vip = item({ ticketTypeId: "vip", ticketNamePl: "VIP", ticketNameEn: "VIP" });
    expect(cartItemLabel(vip, "pl")).toBe("Szczyt 2026 - VIP");
    expect(cartItemLabel(item(), "en")).toBe("Summit 2026");
  });
});
