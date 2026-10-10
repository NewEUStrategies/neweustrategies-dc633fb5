// KOLOR W PLIKU EKSPORTU - tylko `#rrggbb` i `rgba()`.
//
// Przeglądarka oddaje styl obliczony w zapisie, który sama rozumie
// (`oklab(...)`, `color(srgb ...)`, czasem `color-mix(...)`), a silnik maluje
// tokenami (`var(--chart-*)`). Plik SVG otwierają też programy, które tych
// zapisów nie znają - i malują wtedy wypełnienie domyślne, czyli czerń.
// Bramka sprawdza konwersje pojedynczo i CAŁY plik naraz: po
// `svgZWklejonaFarba` nie zostaje ani `oklab(`, ani `color(`, ani
// `color-mix(`, ani `var(`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizujKolor } from "@/lib/charts/exportColor";
import { colorMixOklab } from "@/lib/charts/palette";
import { svgDoPliku, svgZWklejonaFarba } from "@/lib/charts/exportImage";

afterEach(() => {
  vi.restoreAllMocks();
});

const ZAKAZANE = ["oklab(", "oklch(", "color(", "color-mix(", "var("];

/** Odległość dwóch hexów w największym kanale (0..255). */
function roznica(a: string, b: string): number {
  const kan = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [kan(a), kan(b)];
  return Math.max(...x.map((v, i) => Math.abs(v - y[i])));
}

describe("normalizujKolor", () => {
  it("hex i rgb() dają #rrggbb, częściowe krycie - rgba()", () => {
    expect(normalizujKolor("#FA9346")).toBe("#fa9346");
    expect(normalizujKolor("#abc")).toBe("#aabbcc");
    expect(normalizujKolor("rgb(198, 137, 53)")).toBe("#c68935");
    expect(normalizujKolor("rgb(198 137 53)")).toBe("#c68935");
    expect(normalizujKolor("rgba(255, 0, 0, 0.5)")).toBe("rgba(255, 0, 0, 0.5)");
    expect(normalizujKolor("rgb(255 0 0 / 25%)")).toBe("rgba(255, 0, 0, 0.25)");
    expect(normalizujKolor("transparent")).toBe("rgba(0, 0, 0, 0)");
  });

  it("color(srgb ...), oklab() i oklch() schodzą do sRGB", () => {
    expect(normalizujKolor("color(srgb 1 0 0)")).toBe("#ff0000");
    expect(normalizujKolor("color(srgb 0.5 0.5 0.5 / 0.4)")).toBe("rgba(128, 128, 128, 0.4)");
    expect(normalizujKolor("oklab(1 0 0)")).toBe("#ffffff");
    expect(normalizujKolor("oklab(0 0 0)")).toBe("#000000");
    // Czerwień sRGB w OKLCh (L 0,628, C 0,2577, h 29,23).
    expect(
      roznica(normalizujKolor("oklch(0.62796 0.25768 29.2339)") ?? "", "#ff0000"),
    ).toBeLessThanOrEqual(1);
    // Płyta motywu jasnego zapisana jest w arkuszu jako `oklch(1 0 0)`.
    expect(normalizujKolor("oklch(1 0 0)")).toBe("#ffffff");
  });

  it("color-mix(in oklab) liczy się tą samą arytmetyką co bramki palety", () => {
    const wynik = normalizujKolor("color-mix(in oklab, #fa9346 18%, #ffffff)") ?? "";
    expect(wynik).toMatch(/^#[0-9a-f]{6}$/);
    expect(roznica(wynik, colorMixOklab("#fa9346", 18, "#ffffff"))).toBeLessThanOrEqual(1);
    // Mieszanka z przezroczystym: kolor bez zmian, krycie = udział.
    expect(normalizujKolor("color-mix(in oklab, #fa9346 12%, transparent)")).toBe(
      "rgba(250, 147, 70, 0.12)",
    );
  });

  it("var() rozwiązuje się zmiennymi obliczonego stylu, także w środku mieszanki", () => {
    const zmienne: Record<string, string> = {
      "--chart-accent": "#fa9346",
      "--card": "oklch(1 0 0)",
      "--chart-s-alt": "var(--szary)",
      "--szary": "#8794a4",
    };
    const odczyt = (n: string) => zmienne[n] ?? "";
    expect(normalizujKolor("var(--chart-accent)", odczyt)).toBe("#fa9346");
    expect(normalizujKolor("var(--chart-s-alt)", odczyt)).toBe("#8794a4");
    expect(normalizujKolor("var(--brak, #123456)", odczyt)).toBe("#123456");
    const mix = normalizujKolor(
      "color-mix(in oklab, var(--chart-accent) 85%, var(--card))",
      odczyt,
    );
    expect(roznica(mix ?? "", colorMixOklab("#fa9346", 85, "#ffffff"))).toBeLessThanOrEqual(1);
  });

  it("wartości bez koloru wracają bez zmian, nierozwiązywalne - jako null", () => {
    expect(normalizujKolor("none")).toBe("none");
    expect(normalizujKolor('url("#wzor")')).toBe('url("#wzor")');
    expect(normalizujKolor("var(--nie-ma)", () => "")).toBeNull();
    expect(normalizujKolor("lab(50 20 30)")).toBeNull();
    expect(normalizujKolor("")).toBeNull();
  });
});

/** Rysunek w drzewie dokumentu - `getComputedStyle` liczy tylko dla drzewa. */
function rysunek(html: string): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">${html}</svg>`;
  document.body.appendChild(host);
  const svg = host.querySelector("svg");
  if (svg === null) throw new Error("brak svg");
  return svg as SVGSVGElement;
}

describe("plik eksportu nie niesie zapisów, których inne programy nie czytają", () => {
  it("svgZWklejonaFarba: każdy kolor to #rrggbb albo rgba()", () => {
    const svg = rysunek(
      [
        `<rect data-k="a" fill="var(--chart-accent)" stroke="var(--chart-accent-audit-graphic)" />`,
        `<path data-k="b" fill="color-mix(in oklab, var(--chart-accent) 18%, var(--card))" />`,
        `<circle data-k="c" fill="var(--card)" stroke="oklab(0.5 0.1 -0.05)" />`,
        `<text data-k="d" fill="var(--nieznana)">x</text>`,
        `<defs><linearGradient id="g"><stop data-k="e" offset="0" stop-color="var(--chart-1)" /></linearGradient></defs>`,
      ].join(""),
    );
    // Przeglądarka oddałaby tu styl obliczony w nowych zapisach - podstawiamy
    // dokładnie takie, jakie zwraca Chrome dla `color-mix()` i P3.
    const obliczone: Record<string, Record<string, string>> = {
      a: { fill: "color(srgb 0.98 0.576 0.275)", stroke: "rgb(203, 112, 50)" },
      b: { fill: "oklab(0.957 0.016 0.019)" },
      c: { fill: "oklch(1 0 0)", stroke: "color(display-p3 0.2 0.4 0.6 / 0.5)" },
      d: { fill: "var(--nieznana)" },
      e: { "stop-color": "color-mix(in oklab, rgb(0, 0, 0) 50%, rgb(255, 255, 255))" },
    };
    const zmienne: Record<string, string> = {
      "--chart-accent": "#fa9346",
      "--card": "#ffffff",
      "--chart-1": "#26357a",
    };
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
      const k = el.getAttribute("data-k") ?? "";
      return {
        getPropertyValue: (n: string) => obliczone[k]?.[n] ?? zmienne[n] ?? "",
      } as unknown as CSSStyleDeclaration;
    });
    const klon = svgZWklejonaFarba(svg);
    const plik = klon.outerHTML;
    for (const zakazany of ZAKAZANE) expect(plik, zakazany).not.toContain(zakazany);
    const kolory = [...klon.querySelectorAll("*")].flatMap((el) =>
      ["fill", "stroke", "stop-color"].flatMap((a) => {
        const v = el.getAttribute(a);
        return v === null ? [] : [v];
      }),
    );
    expect(kolory.length).toBeGreaterThan(4);
    for (const kolor of kolory) {
      expect(kolor).toMatch(/^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [\d.]+\)|none)$/);
    }
    // Kolor nierozwiązywalny znika, zamiast zostać zapisem z `var()`.
    expect(klon.querySelector("[data-k='d']")?.hasAttribute("fill")).toBe(false);
    expect(klon.querySelector("[data-k='a']")?.getAttribute("stroke")).toBe("#cb7032");
  });

  it("svgDoPliku: tło płyty zapisane w OKLCh wychodzi jako #rrggbb", async () => {
    const blob = svgDoPliku(rysunek(`<rect fill="#000" />`), { background: "oklch(1 0 0)" });
    const tekst = await blob.text();
    expect(tekst).toContain('fill="#ffffff"');
    for (const zakazany of ZAKAZANE) expect(tekst, zakazany).not.toContain(zakazany);
  });
});
