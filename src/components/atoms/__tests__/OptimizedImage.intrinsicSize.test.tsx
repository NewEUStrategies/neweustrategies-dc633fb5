// `OptimizedImage`: prop `intrinsicSize` - naturalny rozmiar pliku jako SAME
// atrybuty `width`/`height`.
//
// CO TEN PLIK DOWODZI. Atom ma dwa różne pojęcia rozmiaru i nie wolno ich
// zlać:
//  - `width` + `height` WYMUSZAJĄ proporcję: dokładają inline `aspect-ratio`
//    na obrazie, zaślepce błędu i opakowaniu efektu hover;
//  - `intrinsicSize` to tylko podpowiedź dla przeglądarki przed pobraniem
//    pliku. Gdyby szła tą samą drogą, nadpisałaby klasy proporcji (wariant
//    "circle" widgetu obrazu = `aspect-square`) i utrwaliła wartość
//    nieaktualną po podmianie pliku.
// Bez propsu znacznik jest dokładnie taki jak przed jego dodaniem.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import { OptimizedImage } from "@/components/atoms/OptimizedImage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SRC = "https://x.example/a.jpg";

describe("OptimizedImage - intrinsicSize", () => {
  it("daje atrybuty width/height bez `aspect-ratio` w stylu obrazu", () => {
    const html = renderToStaticMarkup(
      <OptimizedImage src={SRC} alt="Panel" intrinsicSize={{ width: 1200, height: 675 }} />,
    );

    expect(html).toBe(
      `<img src="${SRC}" alt="Panel" width="1200" height="675" loading="lazy" decoding="async" ` +
        'fetchPriority="auto" class="oi-fade-in"/>',
    );
    expect(html).not.toContain("aspect-ratio");
  });

  it("z efektem hover: opakowanie `.oi-wrap` nie dostaje stylu", () => {
    const html = renderToStaticMarkup(
      <OptimizedImage
        src={SRC}
        alt="Panel"
        hoverEffect="zoom"
        intrinsicSize={{ width: 1200, height: 675 }}
      />,
    );

    expect(html).toMatch(/^<span class="oi-wrap oi-hover-zoom block overflow-hidden"><img /);
    expect(html).toContain(' width="1200" height="675" ');
    expect(html).not.toContain("aspect-ratio");
  });

  it("zaślepka błędu nie dostaje proporcji z naturalnego rozmiaru", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { container } = render(
      <OptimizedImage src={SRC} alt="Panel" intrinsicSize={{ width: 1200, height: 675 }} />,
    );
    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    const fallback = container.querySelector("span") as HTMLSpanElement;
    expect(container.querySelector("img")).toBeNull();
    expect(fallback.getAttribute("role")).toBe("img");
    expect(fallback.style.aspectRatio).toBe("");
  });

  it("jawne width/height dalej wymuszają proporcję i wygrywają z intrinsicSize", () => {
    const html = renderToStaticMarkup(
      <OptimizedImage
        src={SRC}
        alt="Panel"
        width={400}
        height={300}
        hoverEffect="zoom"
        intrinsicSize={{ width: 1200, height: 675 }}
      />,
    );
    const ratio = String(400 / 300);

    expect(html).toContain(' width="400" height="300" ');
    expect(html).not.toContain("1200");
    // Proporcja wymuszona: na obrazie i na opakowaniu efektu hover.
    expect(html.split(`aspect-ratio:${ratio}`)).toHaveLength(3);
  });

  it("bez propsu (także `null` i `undefined`) znacznik jest taki jak przed jego dodaniem", () => {
    const bare = renderToStaticMarkup(<OptimizedImage src={SRC} alt="Panel" />);

    expect(bare).toBe(
      `<img src="${SRC}" alt="Panel" loading="lazy" decoding="async" fetchPriority="auto" ` +
        'class="oi-fade-in"/>',
    );
    expect(
      renderToStaticMarkup(<OptimizedImage src={SRC} alt="Panel" intrinsicSize={null} />),
    ).toBe(bare);
    expect(
      renderToStaticMarkup(<OptimizedImage src={SRC} alt="Panel" intrinsicSize={undefined} />),
    ).toBe(bare);
  });

  it("prop nie przecieka do DOM jako atrybut", () => {
    const { container } = render(
      <OptimizedImage src={SRC} alt="Panel" intrinsicSize={{ width: 350, height: 150 }} />,
    );
    const img = container.querySelector("img") as HTMLImageElement;

    expect(img.getAttributeNames().map((name) => name.toLowerCase())).not.toContain(
      "intrinsicsize",
    );
    expect(img.getAttribute("width")).toBe("350");
    expect(img.getAttribute("height")).toBe("150");
  });
});
