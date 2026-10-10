// KLUCZ EKSPORTU: PRÓBKA KRESKOWANA („brak danych" kartogramu).
//
// Kraje bez danych są na mapie kreskowane. Klucz pliku umiał malować tylko
// płaski kwadrat, więc pozycja „brak danych" wychodziła w PNG i SVG jako
// jeszcze jeden odcień szarości - do pomylenia z klasą skali. Wpis klucza
// niesie teraz kreskowanie, a oba eksporty rysują te same odcinki.
import { afterEach, describe, expect, it, vi } from "vitest";
import { odcinkiKreskowania, svgDoPliku, type WpisKlucza } from "@/lib/charts/exportImage";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function rysunek(): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="10" height="10" /></svg>`;
  document.body.appendChild(host);
  const svg = host.querySelector("svg");
  if (svg === null) throw new Error("brak svg");
  return svg as SVGSVGElement;
}

describe("odcinki kreskowania", () => {
  it("leżą w kwadracie próbki, biegną ukośnie w dół w prawo i mają stały odstęp prostopadły", () => {
    const odcinki = odcinkiKreskowania(20, 40, 10, 3);
    expect(odcinki.length).toBeGreaterThanOrEqual(4);
    for (const [x1, y1, x2, y2] of odcinki) {
      for (const [x, y] of [
        [x1, y1],
        [x2, y2],
      ]) {
        expect(x).toBeGreaterThanOrEqual(20 - 1e-9);
        expect(x).toBeLessThanOrEqual(30 + 1e-9);
        expect(y).toBeGreaterThanOrEqual(40 - 1e-9);
        expect(y).toBeLessThanOrEqual(50 + 1e-9);
      }
      // Kierunek (1, 1): przyrost x równy przyrostowi y.
      expect(x2 - x1).toBeCloseTo(y2 - y1, 9);
      expect(x2 - x1).toBeGreaterThan(0);
    }
    // Odstęp prostopadły między sąsiednimi liniami y - x = c.
    const c = odcinki.map(([x1, y1]) => y1 - x1);
    for (let i = 1; i < c.length; i++) {
      expect((c[i] - c[i - 1]) / Math.SQRT2).toBeCloseTo(3, 9);
    }
  });

  it("odstęp bliski zera nie daje nieskończonej pętli", () => {
    expect(odcinkiKreskowania(0, 0, 10, 0).length).toBeLessThan(40);
  });
});

describe("plik SVG z kluczem kreskowanym", () => {
  it("wpis z kreskowaniem dostaje ścieżkę linii w zapisie przenośnym, inne wpisy nie", async () => {
    const klucz: WpisKlucza[] = [
      { label: "od 1 do 5", color: "rgb(200, 210, 230)", textColor: "rgb(20, 20, 20)" },
      {
        label: "brak danych (kreskowanie)",
        color: "rgb(240, 240, 240)",
        textColor: "rgb(20, 20, 20)",
        kreskowanie: { linia: "rgb(120, 120, 120)", odstep: 3, grubosc: 1 },
      },
    ];
    const plik = await svgDoPliku(rysunek(), { background: "#ffffff", klucz }).text();
    const doc = new DOMParser().parseFromString(
      plik.replace(/^<\?xml[^>]*>\n/, ""),
      "image/svg+xml",
    );
    const grupa = doc.querySelector("[data-export-key]");
    expect(grupa).not.toBeNull();
    const sciezki = grupa?.querySelectorAll("path") ?? [];
    expect(sciezki).toHaveLength(1);
    const kreski = sciezki[0];
    expect(kreski.getAttribute("stroke")).toBe("#787878");
    expect(kreski.getAttribute("stroke-width")).toBe("1");
    expect(kreski.getAttribute("fill")).toBe("none");
    expect(kreski.getAttribute("d")).toMatch(/^M[\d.]+ [\d.]+L[\d.]+ [\d.]+/);
    // Tło próbki zostaje - kreskowanie leży NA kolorze, nie zamiast niego.
    const probki = grupa?.querySelectorAll("rect") ?? [];
    expect([...probki].map((r) => r.getAttribute("fill"))).toEqual(["#c8d2e6", "#f0f0f0"]);
    for (const zakazany of ["oklab(", "color-mix(", "var("]) expect(plik).not.toContain(zakazany);
  });
});
