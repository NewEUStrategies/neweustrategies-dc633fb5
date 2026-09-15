// Mostek nazw i parametrów: wewnętrzne zdarzenia -> słownik GA4.
import { describe, expect, it } from "vitest";

import { ga4EventName, ga4EventParams, sanitizeGa4EventName } from "../ga4EventMap";

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
