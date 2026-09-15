// E-commerce GA4: kwoty w jednostce waluty i kształt `items`.
import { beforeEach, describe, expect, it } from "vitest";

import { bootstrapGa4, resetGa4BootstrapForTests } from "../ga4Client";
import {
  cartItemToGa4Item,
  centsToUnits,
  ga4AddToCart,
  ga4BeginCheckout,
  ga4Purchase,
} from "../ga4Ecommerce";
import type { CartItem } from "@/lib/cart/cartStore";

const POZYCJA: CartItem = {
  id: "e1:t1",
  kind: "event_ticket",
  eventId: "e1",
  ticketTypeId: "t1",
  slug: "szczyt-2026",
  titlePl: "Szczyt 2026",
  titleEn: "Summit 2026",
  ticketNamePl: "Wstęp zwykły",
  ticketNameEn: "Standard",
  priceCents: 24900,
  currency: "PLN",
  addedAt: "2026-01-01T00:00:00.000Z",
};

interface Layered {
  dataLayer?: unknown[];
}

function zdarzenie(nazwa: string): Record<string, unknown> | undefined {
  const wpisy = ((window as Layered).dataLayer ?? []) as unknown[][];
  const wpis = wpisy.find((e) => e[0] === "event" && e[1] === nazwa);
  return wpis?.[2] as Record<string, unknown> | undefined;
}

describe("e-commerce GA4", () => {
  beforeEach(() => {
    resetGa4BootstrapForTests();
    (window as Layered).dataLayer = [];
    bootstrapGa4("G-TEST123");
  });

  it("przelicza grosze na jednostkę waluty", () => {
    expect(centsToUnits(24900)).toBe(249);
    expect(centsToUnits(1)).toBe(0.01);
  });

  it("buduje pozycję GA4 w języku odwiedzającego", () => {
    expect(cartItemToGa4Item(POZYCJA, "en")).toMatchObject({
      item_id: "e1:t1",
      item_name: "Summit 2026",
      item_variant: "Standard",
      price: 249,
      currency: "PLN",
    });
    expect(cartItemToGa4Item(POZYCJA, "pl").item_name).toBe("Szczyt 2026");
  });

  it("wysyła dodanie do koszyka z wartością pozycji", () => {
    ga4AddToCart(cartItemToGa4Item(POZYCJA, "pl"));
    expect(zdarzenie("add_to_cart")).toMatchObject({ value: 249, currency: "PLN" });
  });

  it("sumuje koszyk przy rozpoczęciu kasy", () => {
    ga4BeginCheckout([cartItemToGa4Item(POZYCJA, "pl"), cartItemToGa4Item(POZYCJA, "pl")]);
    expect(zdarzenie("begin_checkout")).toMatchObject({ value: 498, currency: "PLN" });
  });

  it("nie wysyła kasy dla pustego koszyka", () => {
    ga4BeginCheckout([]);
    expect(zdarzenie("begin_checkout")).toBeUndefined();
  });

  it("zawsze podaje transaction_id, żeby GA4 zdeduplikowało zakup", () => {
    ga4Purchase({ transactionId: "txn_1", valueCents: 24900, currency: "PLN" });
    expect(zdarzenie("purchase")).toMatchObject({ transaction_id: "txn_1", value: 249 });
  });
});
