// Bramka strzałki akcji w etykiecie sekcji (section-label).
//
// PO CO
// Domyślna strzałka akcji ("więcej →") była tekstem z ogonkiem. Zgodnie z
// decyzją projektową strzałka ma być nowoczesna i prosta - sam kąt ">" bez
// ogonka, rysowany wspólnym `AngleChevron` (cienka kreska w pikselach ekranu,
// ten sam znak co para chevronów w wariancie kinetic-signal-notch). Ten plik
// pilnuje: braku tekstu "→", geometrii SVG, cieńszej kreski w wąskiej kolumnie
// oraz posłuszeństwa opcji "chevron" / "long" / "none".
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";

// AppLink woła `useRouter()`. Podmieniamy WYŁĄCZNIE go (ten sam wzorzec co w
// sectionLabelKineticNotch.test.tsx).
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useRouter: () => ({
      navigate: () => Promise.resolve(),
      preloadRoute: () => Promise.resolve(),
    }),
  };
});

import {
  SectionLabelRender,
  SECTION_LABEL_ARROWS,
} from "@/lib/builder/sectionLabelVariants";

type VariantProps = Omit<
  ComponentProps<typeof SectionLabelRender>,
  "variant" | "accent" | "label" | "action"
> & { action?: string | null };

function renderVariant(props: VariantProps = {}) {
  const { action, ...rest } = props;
  return render(
    <SectionLabelRender
      label="Sekcja"
      action={action === null ? "" : "więcej"}
      accent="#FA9346"
      variant="left-bar"
      {...rest}
    />,
  );
}

afterEach(() => cleanup());

describe("strzałka akcji w etykiecie sekcji", () => {
  it("domyślna strzałka to kąt '>' bez ogonka - cienki SVG zamiast tekstu", () => {
    const { container } = renderVariant();
    expect(container.textContent).toContain("więcej");
    expect(container.textContent).not.toContain("\u2192");

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 11 10");
    expect(svg?.getAttribute("stroke-width")).toBe("0.85");

    const line = svg?.querySelector("polyline");
    expect(line?.getAttribute("points")).toBe("2.4 1.8 8.2 5 2.4 8.2");
    expect(line?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });

  it("w wąskiej kolumnie kreska jest jeszcze cieńsza (0,7 px)", () => {
    const { container } = renderVariant({ size: "sm" });
    expect(container.querySelector("svg")?.getAttribute("stroke-width")).toBe("0.7");
  });

  it("opcje chevron i long zachowują tekstowe glify, none zdejmuje znak", () => {
    const chevron = renderVariant({ arrow: "chevron" });
    expect(chevron.container.textContent).toContain("\u203A");
    expect(chevron.container.querySelector("svg")).toBeNull();
    chevron.unmount();

    const long = renderVariant({ arrow: "long" });
    expect(long.container.textContent).toContain("\u27F6");
    long.unmount();

    const none = renderVariant({ arrow: "none" });
    expect(none.container.textContent).toContain("więcej");
    expect(none.container.querySelector("svg")).toBeNull();
    expect(none.container.textContent).not.toContain("\u2192");
    none.unmount();
  });

  it("etykieta opcji w edytorze nie pokazuje już glifu z ogonkiem", () => {
    const arrow = SECTION_LABEL_ARROWS.find((a) => a.value === "arrow");
    expect(arrow?.label).toBe("Strzałka >");
    for (const a of SECTION_LABEL_ARROWS) {
      expect(a.label).not.toContain("\u2192");
ed    }
  });
});
