// Mostek nazw i parametrów: wewnętrzne zdarzenia -> słownik GA4.
import { describe, expect, it } from "vitest";

import { redactPii } from "@/lib/observability/redact";
import {
  ga4EventName,
  ga4EventParams,
  sanitizeGa4EventName,
  type InternalEventShape,
} from "../ga4EventMap";

/** Zdarzenie wyszukiwania tak, jak składa je `track()` z `trackSearch`. */
const base: InternalEventShape = {
  type: "search",
  name: "internal_search",
  entityType: "search_query",
  entityId: null,
  meta: {},
  path: "/search",
  lang: "pl",
};

describe("mostek zdarzeń GA4", () => {
  it("mapuje nasze zdarzenia na nazwy rekomendowane przez GA4", () => {
    expect(ga4EventName("internal_search")).toBe("search");
    expect(ga4EventName("signup_completed")).toBe("sign_up");
    expect(ga4EventName("post_view")).toBe("view_item");
    expect(ga4EventName("pricing_contact_click")).toBe("generate_lead");
  });

  it("przepuszcza nieznane zdarzenia po sanityzacji", () => {
    expect(ga4EventName("moje-własne zdarzenie")).toBe("moje_w_asne_zdarzenie");
  });

  it("gwarantuje nazwę zgodną z wymogami GA4", () => {
    expect(sanitizeGa4EventName("123start")).toBe("e_123start");
    expect(sanitizeGa4EventName("!!!")).toBe("custom_event");
    expect(sanitizeGa4EventName("a".repeat(60)).length).toBe(40);
  });

  it("przepisuje frazę wyszukiwania na search_term", () => {
    const params = ga4EventParams({
      type: "interaction",
      name: "internal_search",
      entityType: "search",
      entityId: "bezpieczeństwo",
      meta: {},
      path: "/szukaj",
      lang: "pl",
    });
    expect(params.search_term).toBe("bezpieczeństwo");
    expect(params.page_path).toBe("/szukaj");
  });

  it("odrzuca parametry nieskalarne, bo GA4 ich nie przyjmuje", () => {
    const params = ga4EventParams({
      type: "interaction",
      name: "cta_click",
      entityType: null,
      entityId: null,
      meta: { interval: "yearly", zagniezdzone: { a: 1 }, licznik: 3 },
      path: "/cennik",
      lang: "en",
    });
    expect(params.interval).toBe("yearly");
    expect(params.licznik).toBe(3);
    expect(params.zagniezdzone).toBeUndefined();
  });
});

// Kopia do GA4 wychodzi PRZED bramką zgody (Consent Mode advanced), a nasz serwer
// redaguje wyłącznie własną kopię - więc redakcja musi stać tutaj.
describe("mostek zdarzeń GA4 - redakcja PII przed wyjściem do Google", () => {
  it("e-mail wpisany w wyszukiwarkę NIE trafia do GA4", () => {
    const params = ga4EventParams({ ...base, entityId: "jan.kowalski@example.com" });
    expect(params.search_term).toBe("[redacted-email]");
    expect(params.item_id).toBe("[redacted-email]");
    const json = JSON.stringify(params);
    expect(json).not.toContain("@");
    expect(json).not.toContain("jan.kowalski");
  });

  it("telefon we frazie maskowany, reszta frazy zostaje", () => {
    expect(ga4EventParams({ ...base, entityId: "kontakt 600 123 456 biuro" }).search_term).toBe(
      "kontakt [redacted-phone] biuro",
    );
    expect(ga4EventParams({ ...base, entityId: "+48 600 123 456" }).search_term).toBe(
      "[redacted-phone]",
    );
  });

  it("search_term jest DOKŁADNIE zredagowaną frazą (ten sam redaktor co serwer)", () => {
    const fraza = "raport jan@example.org tel. +48 600 123 456 eyJa.b.c";
    const params = ga4EventParams({ ...base, entityId: fraza });
    expect(params.search_term).toBe(redactPii(fraza));
    expect(params.item_id).toBe(params.search_term);
  });

  it("UUID encji i fraza bez PII przechodzą bez zmian", () => {
    const uuid = "3f2b9c1a-7d4e-4a11-9b0c-2e5f8a6d1c93";
    expect(ga4EventParams({ ...base, name: "post_view", entityId: uuid }).item_id).toBe(uuid);
    expect(ga4EventParams({ ...base, entityId: "polityka spójności" }).search_term).toBe(
      "polityka spójności",
    );
  });

  it("meta: e-mail, JWT, telefon redagowane; liczby i flagi zostają", () => {
    const params = ga4EventParams({
      ...base,
      name: "cta_click",
      meta: {
        note: "pisz na jan@example.org",
        token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.s5-abcDEF_012",
        tel: "600-123-456",
        licznik: 3,
        flaga: true,
      },
    });
    expect(params.note).toBe("pisz na [redacted-email]");
    expect(params.token).toBe("[redacted-jwt]");
    expect(params.tel).toBe("[redacted-phone]");
    expect(params.licznik).toBe(3);
    expect(params.flaga).toBe(true);
  });

  it("meta zagnieżdżona nie wychodzi wcale", () => {
    const params = ga4EventParams({
      ...base,
      meta: { ctx: { mail: "x@y.pl" }, lista: ["a@b.co"] },
    });
    expect(params.ctx).toBeUndefined();
    expect(params.lista).toBeUndefined();
    expect(JSON.stringify(params)).not.toContain("@");
  });

  it("cięcie do 100 znaków PO redakcji - e-mail nie przecieka połówką", () => {
    // 84 znaki + adres: przed naprawą `meta.opis` kończył się na
    // „jan.kowalski@exa" - cięcie przed redakcją ucinało domenę, więc wzorzec
    // e-maila już nie trafiał. Po naprawie znacznik (16 znaków) mieści się cały.
    const fraza = `${"x ".repeat(42)}jan.kowalski@example.com`;
    const params = ga4EventParams({ ...base, entityId: fraza, meta: { opis: fraza } });
    for (const value of [params.item_id, params.search_term, params.opis]) {
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeLessThanOrEqual(100);
      expect(value).not.toContain("jan.kowal");
      expect(value).toBe(`${"x ".repeat(42)}[redacted-email]`);
    }
  });

  it("znacznik za granicą 100 znaków może zostać ucięty - adres i tak nie wychodzi", () => {
    const fraza = `${"x ".repeat(45)}jan.kowalski@example.com`;
    const params = ga4EventParams({ ...base, entityId: fraza, meta: { opis: fraza } });
    for (const value of [params.item_id, params.search_term, params.opis]) {
      expect(value).toBe(`${"x ".repeat(45)}[redacted-`);
    }
  });

  it("page_path: fraza w ?q= zredagowana, parametry kampanii nietknięte", () => {
    const params = ga4EventParams({
      ...base,
      path: "/search?q=jan%40example.com&gclid=ABC123&gad_campaignid=987654321&utm_source=google",
    });
    expect(params.page_path).toBe(
      "/search?q=[redacted-email]&gclid=ABC123&gad_campaignid=987654321&utm_source=google",
    );
  });

  it("page_path: jawna ścieżka wołającego z tokenem też maskowana", () => {
    const params = ga4EventParams({
      ...base,
      path: "/tickets/transfer/AbCdEfGhIjKlMnOpQrStUvWxYz012345?t=x#t=y",
    });
    expect(params.page_path).toBe("/tickets/transfer/[redacted]?t=[redacted]");
  });

  it("pusta ścieżka nie daje parametru", () => {
    expect(ga4EventParams({ ...base, path: "" }).page_path).toBeUndefined();
  });

  it("nie mutuje meta wołającego (ten sam obiekt jedzie do beaconu first-party)", () => {
    const meta = { note: "jan@x.pl" };
    ga4EventParams({ ...base, meta });
    expect(meta.note).toBe("jan@x.pl");
  });
});
