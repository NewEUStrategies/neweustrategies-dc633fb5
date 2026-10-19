// Animowany nagłówek: kształt spoza katalogu.
//
// Treść widgetu przychodzi z JSON-a (starsze rewizje, import, szablony), więc
// `shape` bywa napisem, którego katalog `ANIMATED_SHAPES` nie zna - literówką,
// usuniętym kształtem albo nie-napisem. Renderer szedł z takim napisem prosto
// do `switch`, który dla nieznanej wartości nie rysował NIC: wyróżnienie
// traciło akcent bez śladu w panelu, bo panel też nie miał czego zaznaczyć.
//
// Reguła: kształt spoza katalogu to kształt domyślny trybu - ten sam, który
// panel wstawia przy przełączeniu trybu (podkreślenie, a w trybach hover
// pierwszy kształt ich rodziny). Asercje porównują to, co widać: nagłówek
// z nieznanym kształtem ma być nie do odróżnienia od nagłówka z domyślnym.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import {
  AnimatedHeadingRender,
  type AnimatedHeadingConfig,
  type AnimatedHeadingShape,
} from "../animatedHeadingVariants";

afterEach(cleanup);

/** Markup nagłówka dla danego zapisu kształtu (pozostała treść stała). */
function drawn(shape: unknown, mode: AnimatedHeadingConfig["mode"] = "highlight") {
  const { container, unmount } = render(
    <AnimatedHeadingRender
      config={{
        mode,
        shape: shape as AnimatedHeadingShape,
        textBefore: "Rozwijamy",
        highlight: "Europę",
        loop: false,
      }}
    />,
  );
  const html = container.innerHTML;
  const hasSvg = container.querySelector("svg") !== null;
  unmount();
  return { html, hasSvg };
}

describe("AnimatedHeadingRender - kształt spoza katalogu", () => {
  it.each([
    ["nieznana nazwa", "wave"],
    ["inna wielkość liter", "Underline"],
    ["nie-napis z importu", 42],
    ["pusty napis", ""],
  ])("%s rysuje domyślne podkreślenie zamiast niczego", (_, shape) => {
    const fallback = drawn(shape);
    expect(fallback.hasSvg).toBe(true);
    expect(fallback.html).toBe(drawn("underline").html);
  });

  it("kształt z katalogu zostaje sobą (koercja nie spłaszcza wyboru redakcji)", () => {
    expect(drawn("circle").hasSvg).toBe(true);
    expect(drawn("circle").html).not.toBe(drawn("underline").html);
    expect(drawn(" circle ").html).toBe(drawn("circle").html);
  });

  it.each([
    ["hover-underline", "hover-line-99", "hover-line-1"],
    ["hover-allsides", "ramka", "hover-allsides-1"],
  ] as const)(
    "tryb %s: nieznany kształt to pierwszy kształt rodziny trybu",
    (mode, unknownShape, familyDefault) => {
      expect(drawn(unknownShape, mode).html).toBe(drawn(familyDefault, mode).html);
      // Rodzina hover nie rysuje SVG - akcent daje efekt najechania, nie kreska.
      expect(drawn(unknownShape, mode).hasSvg).toBe(false);
    },
  );
});
