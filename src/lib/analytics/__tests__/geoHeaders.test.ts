import { describe, it, expect } from "vitest";
import { countryFromHeaders } from "../geoHeaders";

const h = (init: Record<string, string>) => new Headers(init);

describe("countryFromHeaders - dostawcy", () => {
  it("czyta Cloudflare", () => {
    expect(countryFromHeaders(h({ "cf-ipcountry": "PL" }))).toBe("PL");
  });

  it("czyta Vercela", () => {
    expect(countryFromHeaders(h({ "x-vercel-ip-country": "DE" }))).toBe("DE");
  });

  it("czyta Netlify z obiektu JSON i bierze WYŁĄCZNIE kod kraju", () => {
    const geo = JSON.stringify({
      city: "Bruksela",
      country: { code: "be", name: "Belgium" },
      latitude: 50.85,
    });
    expect(countryFromHeaders(h({ "x-nf-geo": geo }))).toBe("BE");
  });

  it("uszkodzony nagłówek Netlify traktuje jak jego brak", () => {
    expect(countryFromHeaders(h({ "x-nf-geo": "{nie-json" }))).toBeNull();
  });

  it("kolejność zaufania: pierwszy sensowny nagłówek wygrywa", () => {
    expect(countryFromHeaders(h({ "cf-ipcountry": "PL", "x-vercel-ip-country": "DE" }))).toBe("PL");
  });

  it("pomija nagłówek bez kraju i bierze następny", () => {
    expect(countryFromHeaders(h({ "cf-ipcountry": "XX", "x-vercel-ip-country": "FR" }))).toBe("FR");
  });
});

describe("countryFromHeaders - normalizacja", () => {
  it("podnosi do wielkich liter i przycina", () => {
    expect(countryFromHeaders(h({ "cf-ipcountry": " pl " }))).toBe("PL");
  });

  it("brak nagłówków daje null", () => {
    expect(countryFromHeaders(h({}))).toBeNull();
  });
});

describe("countryFromHeaders - zapisy, które NIE są krajem", () => {
  // Mapa rysowałaby państwo, którego nie ma, więc żaden z tych zapisów nie
  // może przejść jako kod kraju.
  it.each(["XX", "ZZ", "T1", "EU", "AP", "A1", "A2", "O1"])("odrzuca %s", (code) => {
    expect(countryFromHeaders(h({ "cf-ipcountry": code }))).toBeNull();
  });

  it("odrzuca zapis o złej długości i nie-litery", () => {
    expect(countryFromHeaders(h({ "cf-ipcountry": "POL" }))).toBeNull();
    expect(countryFromHeaders(h({ "cf-ipcountry": "P" }))).toBeNull();
    expect(countryFromHeaders(h({ "cf-ipcountry": "1_" }))).toBeNull();
    expect(countryFromHeaders(h({ "cf-ipcountry": "" }))).toBeNull();
  });
});
