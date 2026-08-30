// Czysty model karty trasy: skracanie licznika i klucz pamięci polubienia.
//
// Wzorzec, który odwzorowujemy, skracał liczby wyrażeniem
// `(num / 1000).toFixed(1).replace(/\.0$/, "") + "K"` i NIE bronił się przed
// wartością spoza zakresu. Panel pozwala wpisać liczbę startową ręcznie, więc
// „-1" albo pusta wartość dojechałaby do licznika jako „-1"/„NaN" - te
// przypadki są tu przypięte razem z zachowaniem wzorca dla wartości poprawnych.
import { describe, it, expect } from "vitest";
import { formatLikes, travelRouteLikeKey, TRAVEL_ROUTE_CARD_DEFAULTS } from "../travelRouteCard";
import { WIDGET_SCHEMAS } from "../schemas";
import { WIDGETS } from "../registry";

describe("formatLikes", () => {
  it("zostawia liczby poniżej tysiąca bez zmian", () => {
    expect(formatLikes(0)).toBe("0");
    expect(formatLikes(7)).toBe("7");
    expect(formatLikes(999)).toBe("999");
  });

  it("skraca tysiące dokładnie jak wzorzec", () => {
    expect(formatLikes(1000)).toBe("1K");
    expect(formatLikes(1527)).toBe("1.5K");
    // Wzorzec pokazywał tu „1000K" - patrz komentarz `formatLikes`.
    expect(formatLikes(999_949)).toBe("999.9K");
    expect(formatLikes(999_999)).toBe("1M");
  });

  it("skraca miliony i ucina zbędne zero po przecinku", () => {
    expect(formatLikes(1_000_000)).toBe("1M");
    expect(formatLikes(1_240_000)).toBe("1.2M");
    expect(formatLikes(2_000_000)).toBe("2M");
  });

  it("nigdy nie zwraca NaN ani liczby ujemnej", () => {
    expect(formatLikes(-1)).toBe("0");
    expect(formatLikes(Number.NaN)).toBe("0");
    expect(formatLikes(Number.POSITIVE_INFINITY)).toBe("0");
    expect(formatLikes(12.9)).toBe("12");
  });
});

describe("travelRouteLikeKey", () => {
  it("daje osobny klucz każdej karcie", () => {
    expect(travelRouteLikeKey("w-1")).not.toBe(travelRouteLikeKey("w-2"));
  });

  it("jest przestrzenią nazw aplikacji, nie gołym id", () => {
    expect(travelRouteLikeKey("w-1")).toBe("nes:travel-route-like:w-1");
  });
});

describe("wartości domyślne są jednym źródłem prawdy", () => {
  const schema = WIDGET_SCHEMAS["travel-route-card"] ?? [];
  const defaults = WIDGETS.find((w) => w.type === "travel-route-card")?.defaults() ?? {};

  it.each([
    ["overlayAlpha", TRAVEL_ROUTE_CARD_DEFAULTS.overlayAlpha],
    ["minHeight", TRAVEL_ROUTE_CARD_DEFAULTS.minHeight],
    ["radius", TRAVEL_ROUTE_CARD_DEFAULTS.radius],
    ["maxWidth", TRAVEL_ROUTE_CARD_DEFAULTS.maxWidth],
    ["distanceSizePx", TRAVEL_ROUTE_CARD_DEFAULTS.distanceSizePx],
  ])("panel, paleta i molekuła mówią to samo o `%s`", (key, value) => {
    expect(schema.find((f) => f.key === key)?.default).toBe(value);
    expect(defaults[key]).toBe(value);
  });

  it("świeżo wstawiona karta nie niesie treści przykładowej", () => {
    for (const key of ["title_pl", "title_en", "author_pl", "author_en", "distance", "image"]) {
      expect(defaults[key]).toBe("");
    }
    expect(defaults.likes).toBe(0);
  });
});
