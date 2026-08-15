// Rozdzielacz: kanwa buildera musi rysować DOKŁADNIE to, co strona publiczna,
// a kolor wybrany w panelu nie może cicho znikać.
//
// Regresje przypięte tutaj:
//  1. grubość domyślna była rozjechana (schemat 2 / renderer 1 / kanwa min. 2),
//     więc świeży rozdzielacz miał 2px w podglądzie i 1px publicznie,
//  2. renderer akceptował wyłącznie #RGB / #RRGGBB, a AdminColorPicker commituje
//     też transparent, rgb(), hsl(), oklch() i tokeny var() - wszystko poza hexem
//     było po cichu gubione (i odwrotnie: dowolny string NIE może trafić do CSS).
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import { WIDGETS } from "@/lib/builder/registry";
import { renderSimpleWidget } from "../SimpleWidgets";

/** Jedyna grubość domyślna: schemat = paleta = renderer. */
const DIVIDER_DEFAULT_THICKNESS = 2;

function Divider({ content, editable }: { content: WidgetContent; editable: boolean }) {
  const node: WidgetNode = { id: "div-1", kind: "widget", type: "divider", content };
  return <>{renderSimpleWidget(node, "pl", undefined, editable)}</>;
}

function paint(content: WidgetContent, editable: boolean) {
  const { container } = render(<Divider content={content} editable={editable} />);
  return {
    container,
    separator: container.querySelector('[role="separator"]') as HTMLElement,
  };
}

describe("divider - jedna grubość domyślna w panelu, kanwie i na stronie", () => {
  it("uses the same default thickness in the schema, the palette and the renderer", () => {
    const schemaDefault = (WIDGET_SCHEMAS.divider ?? []).find(
      (f) => f.key === "thickness",
    )?.default;
    const paletteDefault = WIDGETS.find((w) => w.type === "divider")?.defaults().thickness;

    expect(schemaDefault).toBe(DIVIDER_DEFAULT_THICKNESS);
    expect(paletteDefault).toBe(DIVIDER_DEFAULT_THICKNESS);
    expect(paint({}, false).separator.style.borderTopWidth).toBe(`${DIVIDER_DEFAULT_THICKNESS}px`);
  });

  it("renders a fresh divider identically in the canvas and on the public page", () => {
    const pub = paint({}, false).separator;
    const canvas = paint({}, true).separator;

    expect(canvas.style.borderTopWidth).toBe(pub.style.borderTopWidth);
    expect(canvas.style.borderTopColor).toBe(pub.style.borderTopColor);
    expect(canvas.style.borderTopColor).toBe("var(--border)");
  });

  it("never thickens a 1px line just because the canvas is editable", () => {
    expect(paint({ thickness: 1 }, true).separator.style.borderTopWidth).toBe("1px");
    expect(paint({ thickness: 1 }, false).separator.style.borderTopWidth).toBe("1px");
  });

  it("enlarges the click target with an invisible layer instead of the line", () => {
    const canvas = paint({ thickness: 1 }, true);
    const hit = canvas.container.querySelector("[data-divider-hit-area]");
    expect(hit).not.toBeNull();
    expect(hit?.getAttribute("aria-hidden")).toBe("true");
    expect(paint({ thickness: 1 }, false).container.querySelector("[data-divider-hit-area]")).toBe(
      null,
    );
  });

  it("keeps the canvas gradient/icon/wave palette identical to the public one", () => {
    for (const editable of [false, true]) {
      const gradient = render(
        <Divider content={{ variant: "gradient" }} editable={editable} />,
      ).container;
      expect(gradient.querySelector(".via-border")).not.toBeNull();
      expect(gradient.querySelector(".via-foreground\\/60")).toBeNull();

      const icon = render(<Divider content={{ variant: "icon" }} editable={editable} />).container;
      expect(icon.querySelector(".border-border")).not.toBeNull();

      const wave = render(<Divider content={{ variant: "wave" }} editable={editable} />).container;
      expect(wave.querySelector("svg")?.getAttribute("class")).toContain("text-border");
    }
  });

  it("clamps a nonsense thickness instead of emitting it into CSS", () => {
    expect(paint({ thickness: 0 }, false).separator.style.borderTopWidth).toBe("1px");
    expect(paint({ thickness: 9000 }, false).separator.style.borderTopWidth).toBe("400px");
    // Liczba w stringu (tak commituje część kontrolek) nie degraduje do domyślnej.
    expect(paint({ thickness: "6" }, false).separator.style.borderTopWidth).toBe("6px");
  });
});

describe("divider - kolor z panelu dociera do CSS", () => {
  it("keeps a transparent divider transparent instead of falling back to the theme border", () => {
    expect(paint({ color: "transparent" }, false).separator.style.borderTopColor).toBe(
      "transparent",
    );
  });

  it("still accepts plain hex", () => {
    expect(paint({ color: "#123456" }, false).separator.style.borderTopColor).toBe("#123456");
  });

  it("falls back to the theme border for a value that is not a color", () => {
    expect(paint({ color: "czerwony" }, false).separator.style.borderTopColor).toBe(
      "var(--border)",
    );
  });

  it("does not let an unsafe string reach the gradient declaration", () => {
    const { container } = render(
      <Divider
        content={{
          variant: "gradient",
          gradientFrom: "#ff0000",
          gradientTo: "blue); background-image: url(javascript:alert(1)",
        }}
        editable={false}
      />,
    );
    expect(container.innerHTML).not.toContain("javascript:");
  });
});
