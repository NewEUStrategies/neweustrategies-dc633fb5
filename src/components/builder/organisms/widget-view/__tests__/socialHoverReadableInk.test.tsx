// Ikony social - napis na WŁASNYM kolorze podświetlenia (tryb „custom").
//
// Redakcja może ustawić dowolny kolor hovera wiersza. Etykieta i CTA leżą na
// nim, więc tusz napisu jest LICZONY z jasności tła (`readableOn`), a nie
// zgadywany. Dowodzimy:
//  * jasne tło dostaje ciemny tusz, ciemne - biel, a każdy zapis, którego
//    jasności nie da się policzyć bez layoutu (token, `oklch()`, półprzezroczysty
//    kolor), dostaje token motywu zamiast „bieli na ślepo";
//  * gwarantowana podłoga kontrastu z komentarza progu (4,29:1) trzyma się na
//    całym zakresie jasności szarości;
//  * zapisy tego samego koloru w różnych składniach (hex, `rgb()` z przecinkami
//    i spacjami, procenty, `hsl()`) dają TĘ SAMĄ jasność - inaczej ten sam
//    kolor wpisany innym polem panelu dałby inny tusz;
//  * wyrenderowany widget niesie ten tusz w arkuszu instancji i własny kolor
//    w gradiencie wiersza.
//
// Granice: brak - moduł jest czysty, a widget renderujemy prawdziwym
// `renderSimpleWidget` (jak sąsiedni `socialIconsHover.test.tsx`).
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";
import { renderSimpleWidget } from "../SimpleWidgets";
import {
  SB_ROW,
  SOCIAL_HOUSE_GRADIENTS,
  luminance,
  readableOn,
  socialHoverForeground,
  socialHoverGradient,
  type SocialHoverPlan,
} from "../socialHover";

const plan = (over: Partial<SocialHoverPlan> = {}): SocialHoverPlan => ({
  mode: "custom",
  tone: "amber",
  iconMode: "auto",
  rowColor: "",
  iconColor: "",
  ...over,
});

const contrast = (a: number, b: number): number =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

function paint(content: WidgetContent): HTMLElement {
  const node: WidgetNode = { id: "soc-ink", kind: "widget", type: "social-icons", content };
  return render(<>{renderSimpleWidget(node, "pl", undefined, false)}</>).container;
}

describe("readableOn - tusz napisu liczony z jasności tła", () => {
  it("jasne tło dostaje ciemny tusz, ciemne - biel", () => {
    expect(readableOn("#f4f4f4")).toBe("#141414");
    expect(readableOn("#FFD54F")).toBe("#141414");
    expect(readableOn("#1a1a1a")).toBe("#ffffff");
    expect(readableOn("#0A66C2")).toBe("#ffffff");
  });

  it("tło niepoliczalne bez layoutu dostaje token motywu, nie biel", () => {
    for (const bg of [
      "var(--brand)",
      "oklch(0.95 0.02 90)",
      "transparent",
      "currentColor",
      "rgba(255, 255, 255, 0.5)",
      "#ffffff80",
      "#fffff",
      "hsl(0 0 100)",
    ]) {
      expect(readableOn(bg)).toBe("var(--foreground)");
    }
  });

  it("dla każdej szarości wybrany tusz trzyma udowodnioną podłogę 4,29:1", () => {
    const ink = { "#141414": luminance("#141414")!, "#ffffff": 1 };
    for (let v = 0; v <= 255; v += 5) {
      const bg = `rgb(${v}, ${v}, ${v})`;
      const chosen = readableOn(bg) as keyof typeof ink;
      expect(contrast(luminance(bg)!, ink[chosen])).toBeGreaterThanOrEqual(4.29);
    }
  });
});

describe("luminance - ten sam kolor w każdej składni panelu", () => {
  it("hex, rgb() z przecinkami i spacjami, procenty i hsl() dają tę samą jasność", () => {
    const ref = luminance("#ff8000")!;
    for (const same of [
      "rgb(255, 128, 0)",
      "rgb(255 128 0)",
      "RGB(255 128 0 / 1)",
      "rgba(255, 128, 0, 100%)",
      "  #FF8000  ",
      "#ff8000ff",
      "hsl(30.1176deg 100% 50%)",
    ]) {
      expect(luminance(same)).toBeCloseTo(ref, 3);
    }
    expect(luminance("rgb(100% 0% 0%)")).toBeCloseTo(luminance("#f00")!, 6);
  });

  it("kanały poza zakresem są przycinane jak w CSS", () => {
    expect(luminance("rgb(300, -20, 0)")).toBe(luminance("rgb(255, 0, 0)"));
  });

  it("kolor półprzezroczysty i zapis niepełny nie mają jasności", () => {
    expect(luminance("rgb(0 0 0 / 0.99)")).toBeNull();
    expect(luminance("#0008")).toBeNull();
    expect(luminance("rgb(1, 2)")).toBeNull();
    expect(luminance("rgb(1, 2, 3, 1, 5)")).toBeNull();
    expect(luminance("rgb(a, b, c)")).toBeNull();
  });
});

describe("tryb „custom” - tusz i gradient z własnego koloru", () => {
  it("bez własnego koloru: gradient domowy i biały napis", () => {
    expect(socialHoverGradient(plan(), "facebook")).toBe(SOCIAL_HOUSE_GRADIENTS.amber);
    expect(socialHoverForeground(plan())).toBe("#ffffff");
  });

  it("z własnym kolorem: gradient z tego koloru i tusz z jego jasności", () => {
    const p = plan({ rowColor: "#f4f4f4", tone: "ember" });
    expect(socialHoverGradient(p, "youtube")).toBe(
      "linear-gradient(135deg, #f4f4f4 0%, color-mix(in oklab, #f4f4f4 72%, #120A06) 100%)",
    );
    expect(socialHoverForeground(p)).toBe("#141414");
  });

  it.each([
    ["#f4f4f4", "#141414"],
    ["#1a1a1a", "#ffffff"],
    ["var(--brand)", "var(--foreground)"],
  ])("widget z kolorem %s pisze etykietę tuszem %s", (rowHoverColor, ink) => {
    const container = paint({
      facebook: "https://facebook.com/nes",
      layout: "list",
      rowHover: "custom",
      rowHoverColor,
    });
    const css = [...container.querySelectorAll("style")].map((s) => s.textContent).join("");
    expect(css).toContain(`{color:${ink}}`);
    const row = container.querySelector(`.${SB_ROW}`) as HTMLElement;
    expect(row.style.getPropertyValue("--sb-grad")).toContain(rowHoverColor);
  });
});
