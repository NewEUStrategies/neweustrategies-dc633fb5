// Kontrakt autoodtwarzania karuzeli wpisow.
//
// Regresja, ktora tu pilnujemy: `autoplay` bylo polem WYLACZNIE w martwym
// schemacie (`WIDGET_SCHEMAS.carousel`) - panel go nie renderowal, a widok go
// nie czytal. Po naprawie jedna definicja obsluguje edytor i renderer, wiec
// test trzyma obie strony na tej samej wartosci.
import { describe, it, expect } from "vitest";
import {
  CAROUSEL_AUTOPLAY_DEFAULT_MS,
  CAROUSEL_AUTOPLAY_MAX_MS,
  CAROUSEL_AUTOPLAY_MIN_MS,
  carouselAutoplayEnabled,
  carouselAutoplayIntervalMs,
} from "../postListCarousel";
import { WIDGET_SCHEMAS } from "../schemas";

describe("carouselAutoplayEnabled", () => {
  it("jest wylaczone, dopoki redakcja go nie wlaczy", () => {
    expect(carouselAutoplayEnabled({})).toBe(false);
  });

  it("czyta prawdziwy boolean zapisany przez przelacznik panelu", () => {
    expect(carouselAutoplayEnabled({ autoplay: true })).toBe(true);
    expect(carouselAutoplayEnabled({ autoplay: false })).toBe(false);
  });

  it("rozumie historyczny zapis selecta on/off ze starego schematu", () => {
    expect(carouselAutoplayEnabled({ autoplay: "on" })).toBe(true);
    expect(carouselAutoplayEnabled({ autoplay: "off" })).toBe(false);
  });

  it("nie zgaduje przy wartosci spoza kontraktu", () => {
    expect(carouselAutoplayEnabled({ autoplay: "maybe" })).toBe(false);
  });
});

describe("carouselAutoplayIntervalMs", () => {
  it("domyslnie daje wartosc domyslna", () => {
    expect(carouselAutoplayIntervalMs({})).toBe(CAROUSEL_AUTOPLAY_DEFAULT_MS);
  });

  it("akceptuje liczbe zapisana jako string (kontrolki panelu commituja stringi)", () => {
    expect(carouselAutoplayIntervalMs({ autoplayIntervalMs: "7000" })).toBe(7000);
  });

  it("domyka wynik do bezpiecznego zakresu", () => {
    expect(carouselAutoplayIntervalMs({ autoplayIntervalMs: 10 })).toBe(CAROUSEL_AUTOPLAY_MIN_MS);
    expect(carouselAutoplayIntervalMs({ autoplayIntervalMs: 10_000_000 })).toBe(
      CAROUSEL_AUTOPLAY_MAX_MS,
    );
  });

  it("zwraca liczbe calkowita ms", () => {
    expect(carouselAutoplayIntervalMs({ autoplayIntervalMs: 4200.7 })).toBe(4201);
  });
});

describe("martwe schematy post-listy i karuzeli sa usuniete", () => {
  // `WidgetProperties.ContentFields` zwraca `PostListEditor` dla obu typow i
  // NIGDY nie dochodzi do renderu schematu - kazde pole zadeklarowane tutaj
  // bylo obietnica bez pokrycia.
  it.each(["post-list", "carousel"] as const)("%s nie ma schematu sterowanego danymi", (type) => {
    expect(WIDGET_SCHEMAS[type]).toBeUndefined();
  });
});
