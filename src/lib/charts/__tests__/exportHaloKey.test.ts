// EKSPORT: OBWÓDKA NAPISU POD LITERĄ I KLUCZ W PLIKU SVG.
//
// DWA CICHE DEFEKTY TEGO SAMEGO PLIKU.
//   1. Liczba w łuku tarczy pod paletą ról ma obwódkę płyty (3 px) z
//      `paint-order: stroke` z ARKUSZA. Eksport zdejmuje klasy i `style`
//      i wkleja tylko własności z listy - bez `paint-order` plik wracał do
//      kolejności domyślnej, czyli obwódka malowała się NA cyfrach i zamiast
//      udziałów były plamy w kolorze płyty.
//   2. Klucz tarczy (tabela HTML pod rysunkiem) jechał wyłącznie do PNG.
//      Plik SVG pierścienia pod paletą ról miał stopnie szarości bez nazw.
import { afterEach, describe, expect, it, vi } from "vitest";
import { svgDoPliku, svgZWklejonaFarba, type WpisKlucza } from "@/lib/charts/exportImage";

afterEach(() => {
  vi.restoreAllMocks();
});

const ZAKAZANE = ["oklab(", "oklch(", "color(", "color-mix(", "var("];

/** Rysunek w drzewie dokumentu - `getComputedStyle` liczy tylko dla drzewa. */
function rysunek(html: string, wymiary = 'width="200" height="100"'): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" ${wymiary}>${html}</svg>`;
  document.body.appendChild(host);
  const svg = host.querySelector("svg");
  if (svg === null) throw new Error("brak svg");
  return svg as SVGSVGElement;
}

/** Styl obliczony podstawiony słownikiem: reszta własności jest pusta. */
function stylObliczony(wartosci: Record<string, string>): void {
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        getPropertyValue: (n: string) => wartosci[n] ?? "",
      }) as unknown as CSSStyleDeclaration,
  );
}

async function tekstPliku(blob: Blob): Promise<string> {
  return await blob.text();
}

describe("obwódka napisu w eksporcie", () => {
  it("`paint-order` z arkusza jedzie do pliku jako atrybut", () => {
    const svg = rysunek(
      `<text class="neh-arc-label" data-halo="true" fill="var(--chart-ink)">42%</text>`,
    );
    stylObliczony({
      fill: "rgb(20, 19, 19)",
      stroke: "rgb(255, 255, 255)",
      "stroke-width": "3px",
      "stroke-linejoin": "round",
      "paint-order": "stroke",
    });
    const tekst = svgZWklejonaFarba(svg).querySelector("text");
    expect(tekst?.getAttribute("paint-order")).toBe("stroke");
    expect(tekst?.getAttribute("stroke")).toBe("#ffffff");
    expect(tekst?.getAttribute("stroke-width")).toBe("3px");
    // Klasy i `style` znikają - kolejność musi przeżyć bez nich.
    expect(tekst?.hasAttribute("class")).toBe(false);
  });

  it("atrybut `paint-order` zastany w rysunku przeżywa klonowanie", () => {
    const svg = rysunek(`<text data-halo="true" paint-order="stroke">42%</text>`);
    stylObliczony({});
    expect(svgZWklejonaFarba(svg).querySelector("text")?.getAttribute("paint-order")).toBe(
      "stroke",
    );
  });

  it("kolejność domyślna (`normal`) nie jest dopisywana do każdego znacznika", () => {
    const svg = rysunek(`<rect width="10" height="10" />`);
    stylObliczony({ "paint-order": "normal" });
    expect(svgZWklejonaFarba(svg).querySelector("rect")?.hasAttribute("paint-order")).toBe(false);
  });
});

describe("klucz w pliku SVG", () => {
  const KLUCZ: WpisKlucza[] = [
    { label: "Niemcy 31%", color: "rgb(250, 147, 70)", textColor: "rgb(20, 19, 19)" },
    { label: "Polska 22%", color: "rgb(62, 76, 94)", textColor: "rgb(20, 19, 19)" },
    { label: "Pozostałe 12%", color: "oklab(0.6 0 0)", textColor: "rgb(20, 19, 19)" },
  ];

  it("bez klucza plik jest samym rysunkiem - jak dotąd", async () => {
    const plik = await tekstPliku(svgDoPliku(rysunek(`<rect fill="#000" />`)));
    expect(plik).not.toContain("data-export-key");
    expect(plik.match(/<svg/g)).toHaveLength(1);
  });

  it("klucz stoi POD rysunkiem: próbka i nazwa dla każdego wpisu", async () => {
    const zrodlo = rysunek(`<rect fill="#000" width="10" height="10" />`);
    const plik = await tekstPliku(
      svgDoPliku(zrodlo, { background: "rgb(255, 255, 255)", klucz: KLUCZ }),
    );
    const doc = new DOMParser().parseFromString(plik, "image/svg+xml");
    const korzen = doc.documentElement;
    expect(korzen.tagName.toLowerCase()).toBe("svg");
    // Rysunek zagnieżdżony bez zmiany, korzeń wyższy o pasek klucza.
    const wnetrze = korzen.querySelector("svg");
    expect(wnetrze).not.toBeNull();
    expect(Number(wnetrze?.getAttribute("height"))).toBeGreaterThan(0);
    expect(Number(korzen.getAttribute("height"))).toBeGreaterThan(
      Number(wnetrze?.getAttribute("height")),
    );
    const grupa = korzen.querySelector("[data-export-key]");
    expect(grupa).not.toBeNull();
    const napisy = [...(grupa?.querySelectorAll("text") ?? [])].map((t) => t.textContent);
    expect(napisy).toEqual(KLUCZ.map((w) => w.label));
    expect(grupa?.querySelectorAll("rect")).toHaveLength(KLUCZ.length);
    // Każda próbka POD rysunkiem, nie na nim.
    for (const r of grupa?.querySelectorAll("rect") ?? []) {
      expect(Number(r.getAttribute("y"))).toBeGreaterThan(Number(wnetrze?.getAttribute("height")));
    }
    // Tło na całym korzeniu (także pod kluczem).
    expect(korzen.firstElementChild?.getAttribute("fill")).toBe("#ffffff");
  });

  it("kolory klucza w zapisie przenośnym - żadnego oklab(, color(, var(", async () => {
    const plik = await tekstPliku(svgDoPliku(rysunek(`<rect fill="#000" />`), { klucz: KLUCZ }));
    for (const z of ZAKAZANE) expect(plik, z).not.toContain(z);
    expect(plik).toContain('fill="#fa9346"');
  });

  it("długi klucz zawija się do szerokości rysunku", async () => {
    const dlugi: WpisKlucza[] = Array.from({ length: 12 }, (_, i) => ({
      label: `Kategoria numer ${i + 1}`,
      color: "rgb(62, 76, 94)",
      textColor: "rgb(20, 19, 19)",
    }));
    const plik = await tekstPliku(svgDoPliku(rysunek(`<rect />`), { klucz: dlugi }));
    const doc = new DOMParser().parseFromString(plik, "image/svg+xml");
    const wiersze = new Set(
      [...doc.querySelectorAll("[data-export-key] text")].map((t) => t.getAttribute("y")),
    );
    expect(wiersze.size).toBeGreaterThan(1);
    // Szerokość pliku to szerokość rysunku na stronie (happy-dom nie mierzy,
    // więc zapas 720 px) - każdy napis zaczyna się w jej obrębie.
    const szer = Number(doc.documentElement.getAttribute("width"));
    expect(szer).toBeGreaterThan(0);
    for (const t of doc.querySelectorAll("[data-export-key] text")) {
      expect(Number(t.getAttribute("x"))).toBeLessThan(szer);
    }
  });
});
