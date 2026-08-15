// ProgressCarouselEditor: proporcje kadru i kolor akcentu.
//
// Regresja przypięta tutaj: `ratio` czytał renderer (ProgressCarouselView,
// mapa RATIO_CLASS z pięcioma wartościami) i miał default w palecie, a
// `accentColor` sterował paskiem postępu - żadne z nich nie miało kontrolki
// w panelu, więc jedyną drogą zmiany było ręczne grzebanie w JSON-ie treści.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { Json, WidgetContent } from "@/lib/builder/types";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import { WIDGETS } from "@/lib/builder/registry";
import {
  ProgressCarouselEditor,
  PROGRESS_CAROUSEL_EDITOR_HANDLED_KEYS,
} from "../ProgressCarouselEditor";
import { ProgressCarouselView } from "@/components/builder/organisms/widget-view/ProgressCarouselView";

type Recorded = Array<[string, Json]>;

const SLIDES: WidgetContent = {
  items: [{ value: "s1", img: "https://x/a.jpg", title_pl: "Most", title_en: "Bridge" }],
};

function renderEditor(content: WidgetContent, lang: "pl" | "en" = "pl") {
  const calls: Recorded = [];
  render(
    <ProgressCarouselEditor
      c={content}
      lang={lang}
      setContent={(k: string, v: Json) => {
        calls.push([k, v]);
      }}
    />,
  );
  return calls;
}

/** PropField nie wiąże etykiety z kontrolką przez htmlFor - szukamy po wrapperze. */
function controlFor(label: string): HTMLElement {
  const wrapper = screen.getByText(label).closest("div");
  const control = wrapper?.querySelector<HTMLElement>("input, [role='combobox']");
  if (!control) throw new Error(`Brak kontrolki dla pola "${label}"`);
  return control;
}

afterEach(cleanup);

describe("schemat karuzeli pokrywa to, co czyta renderer", () => {
  const fields = WIDGET_SCHEMAS["progress-carousel"] ?? [];

  it("declares ratio and accentColor", () => {
    expect(fields.map((f) => f.key).sort()).toEqual(["accentColor", "ratio"]);
  });

  it("offers exactly the ratios the renderer can draw", () => {
    const ratio = fields.find((f) => f.key === "ratio");
    expect(ratio?.options?.map((o) => o.value).sort()).toEqual([
      "1/1",
      "16/9",
      "21/9",
      "3/2",
      "4/3",
    ]);
  });

  it("is fully claimed by the editor, so nothing lands in a leftover block twice", () => {
    const unclaimed = fields.filter((f) => !PROGRESS_CAROUSEL_EDITOR_HANDLED_KEYS.has(f.key));
    expect(unclaimed).toEqual([]);
  });

  it("ships palette defaults for both keys", () => {
    const defaults = WIDGETS.find((w) => w.type === "progress-carousel")?.defaults();
    expect(defaults?.ratio).toBe("16/9");
    expect(defaults?.accentColor).toBe("");
  });
});

describe("ProgressCarouselEditor zapisuje wygląd do treści", () => {
  it("commits a ratio picked from the list", () => {
    const calls = renderEditor(SLIDES);
    fireEvent.keyDown(controlFor("Proporcje"), { key: "ArrowDown" });
    fireEvent.click(within(screen.getByRole("listbox")).getByText("1:1 - kwadrat"));
    expect(calls).toEqual([["ratio", "1/1"]]);
  });

  it("commits an accent colour", () => {
    const calls = renderEditor(SLIDES);
    fireEvent.change(controlFor("Kolor akcentu (opcjonalny)"), { target: { value: "#ff0000" } });
    expect(calls.at(-1)).toEqual(["accentColor", "#ff0000"]);
  });

  it("shows the stored ratio instead of resetting it", () => {
    renderEditor({ ...SLIDES, ratio: "21/9" });
    expect(controlFor("Proporcje").textContent).toBe("21:9 - ultrawide cinematic");
  });

  it("keeps the slide list and its settings alongside the new block", () => {
    renderEditor(SLIDES);
    expect(screen.getByText("Proporcje")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://x/a.jpg")).toBeInTheDocument();
  });
});

describe("renderer honoruje zapisany wygląd", () => {
  it("applies the picked ratio class", () => {
    const { container } = render(
      <ProgressCarouselView c={{ ...SLIDES, ratio: "1/1" }} lang="pl" paused />,
    );
    expect(container.querySelector("figure")?.className).toContain("aspect-square");
  });

  it("applies the accent colour as a CSS variable", () => {
    const { container } = render(
      <ProgressCarouselView c={{ ...SLIDES, accentColor: "#ff0000" }} lang="pl" paused />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--progress-carousel-accent")).toBe("#ff0000");
  });

  it("falls back to the brand colour when the accent is empty", () => {
    const { container } = render(
      <ProgressCarouselView c={{ ...SLIDES, accentColor: "" }} lang="pl" paused />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--progress-carousel-accent")).toBe("");
  });
});
