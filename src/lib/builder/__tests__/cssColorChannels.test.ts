// Wspólny parser kanałów koloru (`parseColorChannels`) - podstawa odwracania
// koloru w dark mode (`autoInvertColor`, ramka widgetu) i tuszu napisu na
// podświetleniu ikon social (`luminance`/`readableOn`).
//
// Dowodzimy, że ten sam kolor zapisany w KAŻDEJ składni, którą przepuszcza
// `safeWidgetColor` i którą da się policzyć bez layoutu, daje te same kanały -
// inaczej ten sam kolor wybrany innym polem panelu (hex, RGB, HSL) odwracałby
// się w dark mode inaczej. Zapisy niepoliczalne muszą dawać `null` („nie wiem"),
// a nie zgadnięty kolor.
//
// Moduł jest czysty - bez granic do mockowania.
import { describe, expect, it } from "vitest";
import { parseColorChannels } from "../cssColor";

const rgb = (value: string) => {
  const c = parseColorChannels(value);
  return c && [Math.round(c.r), Math.round(c.g), Math.round(c.b), Number(c.a.toFixed(3))];
};

describe("parseColorChannels - ta sama barwa w każdej składni", () => {
  it.each([
    [0, [255, 0, 0]],
    [60, [255, 255, 0]],
    [120, [0, 255, 0]],
    [180, [0, 255, 255]],
    [240, [0, 0, 255]],
    [300, [255, 0, 255]],
    [-120, [0, 0, 255]],
    [480, [0, 255, 0]],
  ])("hsl() z odcieniem %s daje kanały barwy podstawowej", (hue, channels) => {
    expect(rgb(`hsl(${hue} 100% 50%)`)).toEqual([...channels, 1]);
    expect(rgb(`hsl(${hue}deg, 100%, 50%)`)).toEqual([...channels, 1]);
  });

  it("nasycenie i jasność spoza 0-100% są przycinane jak w CSS", () => {
    expect(rgb("hsl(0 150% 50%)")).toEqual([255, 0, 0, 1]);
    expect(rgb("hsl(0 0% 120%)")).toEqual([255, 255, 255, 1]);
  });

  it("alfa jako liczba i jako procent, w każdej rodzinie zapisu", () => {
    expect(rgb("#ff000080")).toEqual([255, 0, 0, 0.502]);
    expect(rgb("#f008")).toEqual([255, 0, 0, 0.533]);
    expect(rgb("rgb(255 0 0 / 50%)")).toEqual([255, 0, 0, 0.5]);
    expect(rgb("rgba(255, 0, 0, .25)")).toEqual([255, 0, 0, 0.25]);
    expect(rgb("hsla(0, 100%, 50%, 40%)")).toEqual([255, 0, 0, 0.4]);
  });

  it("wielkość liter i białe znaki wokół zapisu nie zmieniają wyniku", () => {
    expect(rgb("  #FF0000 ")).toEqual(rgb("#f00"));
    expect(rgb("RGB(255,0,0)")).toEqual(rgb("#f00"));
    expect(rgb("HSL(0, 100%, 50%)")).toEqual(rgb("#f00"));
  });

  it("nazwa koloru, którą whitelist przepuszcza do `style`, ma kanały", () => {
    expect(rgb("red")).toEqual([255, 0, 0, 1]);
    expect(rgb(" Red ")).toEqual(rgb("#f00"));
    expect(rgb("rebeccapurple")).toEqual(rgb("#663399"));
  });
});

describe("parseColorChannels - zapisy niepoliczalne lokalnie", () => {
  it.each([
    "",
    "var(--brand)",
    "transparent",
    "oklch(0.6 0.2 30)",
    "color(srgb 1 0 0)",
    "#ff00f",
    "#12",
    "#gg0000",
    "rgb(255, 0)",
    "rgb(255, 0, 0, 1, 1)",
    "rgb(255, x, 0)",
    "rgb(255, 0, 0, abc)",
    "hsl(0, 100, 50)",
    "hsl(red, 100%, 50%)",
    "hsl(0, 100%)",
    "rgb(calc(1), 0, 0)",
  ])("%j daje null zamiast zgadniętego koloru", (value) => {
    expect(parseColorChannels(value)).toBeNull();
  });
});
