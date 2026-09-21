// EKSPORT RYSUNKU: farba musi wyjść RAZEM z plikiem.
//
// Defekt, przed którym stoi ten plik, jest cichy: silnik maluje tokenami
// (`fill="var(--chart-3-inner)"`), a wartość tokena mieszka w arkuszu strony.
// Wycięty SVG traci arkusz, więc plik powstaje, pobiera się, ma poprawny
// rozmiar - i jest pusty albo czarny. Żaden typ tego nie widzi.
import { describe, expect, it, vi } from "vitest";
import { svgDoPliku, svgZWklejonaFarba } from "@/lib/charts/exportImage";

/** Rysunek w drzewie dokumentu - `getComputedStyle` liczy tylko dla drzewa. */
function rysunek(html: string): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">${html}</svg>`;
  document.body.appendChild(host);
  const svg = host.querySelector("svg");
  if (svg === null) throw new Error("brak svg");
  return svg as SVGSVGElement;
}

describe("svgZWklejonaFarba", () => {
  it("WKLEJA obliczoną farbę w atrybut, zamiast zostawić odwołanie do arkusza", () => {
    const svg = rysunek(`<rect class="slupek" fill="var(--chart-1)" />`);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          getPropertyValue: (n: string) => (n === "fill" ? "rgb(198, 137, 53)" : ""),
        }) as unknown as CSSStyleDeclaration,
    );
    const klon = svgZWklejonaFarba(svg);
    expect(klon.querySelector("rect")?.getAttribute("fill")).toBe("rgb(198, 137, 53)");
    vi.restoreAllMocks();
  });

  it("NIE wkleja niezrozumianego `var()` w miejsce wartości dosłownej", () => {
    // Przeglądarka, która zmiennej nie rozwiązała, oddaje ją dosłownie.
    // Wklejenie jej w atrybut ZASTĄPIŁOBY wartość, która mogła tam już być -
    // czyli poprawiając eksport, zepsułoby rysunek w pliku.
    const svg = rysunek(`<rect fill="#c68935" />`);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          getPropertyValue: (n: string) => (n === "fill" ? "var(--chart-1)" : ""),
        }) as unknown as CSSStyleDeclaration,
    );
    const klon = svgZWklejonaFarba(svg);
    expect(klon.querySelector("rect")?.getAttribute("fill")).toBe("#c68935");
    vi.restoreAllMocks();
  });

  it("WKLEJA farbę STOPNIA GRADIENTU, bez której pole wychodzi solidną płachtą", () => {
    // Defekt tej samej rodziny, ale gorszy w skutkach niż pusty słupek.
    // Krycie pola pod linią siedzi w `style` (bo jedzie z tokena przez
    // `var()`), a ta funkcja `style` zdejmuje. Bez wklejenia obliczonej
    // wartości stopień zostawał bez koloru i bez krycia - czyli z domyślnym
    // `stop-opacity: 1` - i pole zamalowywało w eksporcie własną linię.
    const svg = rysunek(
      `<defs><linearGradient id="g"><stop offset="0" stop-color="var(--chart-1)" style="stop-opacity:var(--chart-band-1)" /></linearGradient></defs>`,
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          getPropertyValue: (n: string) =>
            n === "stop-color" ? "rgb(198, 137, 53)" : n === "stop-opacity" ? "0.07" : "",
        }) as unknown as CSSStyleDeclaration,
    );
    const stop = svgZWklejonaFarba(svg).querySelector("stop");
    expect(stop?.getAttribute("stop-color")).toBe("rgb(198, 137, 53)");
    expect(stop?.getAttribute("stop-opacity")).toBe("0.07");
    vi.restoreAllMocks();
  });

  it("nie rozsiewa własności stopnia po elementach, których nie dotyczą", () => {
    // `getComputedStyle` odda wartość początkową `stop-color` dla KAŻDEGO
    // elementu rysunku. Dopisana do ścieżek i tekstów nie znaczy nic, a puchnie
    // w każdym eksportowanym pliku.
    const svg = rysunek(`<path d="M0 0 L10 10" />`);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          getPropertyValue: (n: string) => (n === "stop-color" ? "rgb(0, 0, 0)" : ""),
        }) as unknown as CSSStyleDeclaration,
    );
    const path = svgZWklejonaFarba(svg).querySelector("path");
    expect(path?.hasAttribute("stop-color")).toBe(false);
    vi.restoreAllMocks();
  });

  it("zdejmuje klasy i `style`, bo poza stroną wskazują na cudze reguły", () => {
    const svg = rysunek(`<rect class="neh-bar" style="fill:red" />`);
    const klon = svgZWklejonaFarba(svg);
    const rect = klon.querySelector("rect");
    expect(rect?.hasAttribute("class")).toBe(false);
    expect(rect?.hasAttribute("style")).toBe(false);
  });

  it("NIE rusza geometrii - eksport ma odwzorować rysunek, a nie go przeliczyć", () => {
    const svg = rysunek(`<rect x="4" y="8" width="20" height="30" />`);
    const rect = svgZWklejonaFarba(svg).querySelector("rect");
    expect(rect?.getAttribute("x")).toBe("4");
    expect(rect?.getAttribute("width")).toBe("20");
    expect(rect?.getAttribute("height")).toBe("30");
  });

  it("nie zmienia ORYGINAŁU w drzewie strony", () => {
    // Eksport, który po sobie nie sprząta, zostawiłby na stronie rysunek
    // z zamrożoną farbą - i przełączenie motywu przestałoby na niego działać.
    const svg = rysunek(`<rect class="slupek" />`);
    svgZWklejonaFarba(svg);
    expect(svg.querySelector("rect")?.getAttribute("class")).toBe("slupek");
  });

  it("dopisuje przestrzeń nazw, bez której plik nie jest rysunkiem", () => {
    const klon = svgZWklejonaFarba(rysunek(`<rect />`));
    expect(klon.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
  });
});

describe("svgDoPliku", () => {
  it("oddaje plik zadeklarowany jako SVG, z nagłówkiem XML", async () => {
    const blob = svgDoPliku(rysunek(`<rect fill="#000" />`));
    expect(blob.type).toContain("image/svg+xml");
    const tekst = await blob.text();
    expect(tekst.startsWith("<?xml")).toBe(true);
    expect(tekst).toContain("<rect");
  });
});
