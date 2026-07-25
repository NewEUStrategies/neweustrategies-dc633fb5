// Regresja: overlay globalnych widgetów rozwija `[fn]…[/fn]` w różnych typach
// widgetów redakcyjnych (callout/CTA, accordion, podpis obrazka, tabelaryczna
// rated-list). Kontrakt taki sam jak `globalWidgetOverlayFootnotes` -
// markery `<sup class="fn-ref">` z `data-fn`/`title`/`role="doc-noteref"`
// i sekwencyjna numeracja w kolejności występowania w dokumencie.

import { describe, it, expect } from "vitest";
import { createCounter, processWidgetFootnotes } from "@/lib/footnotes";
import type { WidgetNode } from "@/lib/builder/types";

function widget<T extends Record<string, unknown>>(
  type: WidgetNode["type"],
  content: T,
  id = "w",
): WidgetNode {
  return { kind: "widget", id, type, content } as unknown as WidgetNode;
}

function html(w: WidgetNode, key: string): string {
  return String((w.content as Record<string, unknown>)[key] ?? "");
}

describe("global widget overlay footnotes - widget-type coverage", () => {
  it("callout (cta): title + description + text share document counter", () => {
    const raw = widget("cta", {
      title_pl: "Wezwanie[fn]t1[/fn]",
      description_pl: "Opis[fn]d1[/fn] z [fn]d2[/fn]",
      text_pl: "CTA[fn]x1[/fn]",
    });
    const { widget: out, notes } = processWidgetFootnotes(raw, "pl");

    expect(notes.map((n) => n.id)).toEqual([1, 2, 3, 4]);
    expect(notes.map((n) => n.html)).toEqual(["t1", "d1", "d2", "x1"]);
    expect(html(out, "title_pl")).toMatch(/data-fn="1"/);
    expect(html(out, "description_pl")).toMatch(/data-fn="2"/);
    expect(html(out, "description_pl")).toMatch(/data-fn="3"/);
    expect(html(out, "text_pl")).toMatch(/data-fn="4"/);
    for (const key of ["title_pl", "description_pl", "text_pl"] as const) {
      expect(html(out, key)).not.toContain("[fn]");
      expect(html(out, key)).toMatch(/role="doc-noteref"/);
    }
  });

  it("accordion: numeracja stabilna w polach title/content wielu itemów", () => {
    const raw: WidgetNode = {
      kind: "widget",
      id: "acc",
      type: "accordion",
      content: {
        items: [
          { title_pl: "A[fn]a-t[/fn]", content_pl: "AA[fn]a-c[/fn]" },
          { title_pl: "B", content_pl: "BB[fn]b-c[/fn]" },
          { title_pl: "C[fn]c-t[/fn]", content_pl: "CC" },
        ],
      },
    } as unknown as WidgetNode;

    const { widget: out, notes } = processWidgetFootnotes(raw, "pl");
    const items = (out.content as { items: Array<Record<string, string>> }).items;
    const joined = items.map((i) => `${i.title_pl}|${i.content_pl}`).join("\n");

    expect(joined).not.toContain("[fn]");
    expect(notes.map((n) => n.html)).toEqual(["a-t", "a-c", "b-c", "c-t"]);
    for (const n of [1, 2, 3, 4]) {
      expect(joined).toMatch(new RegExp(`data-fn="${n}"`));
    }
  });

  it("image caption: [fn] w podpisie obrazka rozwija się do tooltipa", () => {
    const raw = widget("image", {
      caption_pl: "Wykres 1[fn]źródło: NBP[/fn] - dane wstępne.",
      caption_en: "Chart 1[fn]source: NBP[/fn].",
    });
    const { widget: out, notes } = processWidgetFootnotes(raw, "pl");

    expect(html(out, "caption_pl")).not.toContain("[fn]");
    // Fallback do drugiego języka też jest przetwarzany, żeby przełącznik
    // języka nie odsłonił surowego shortcodu.
    expect(html(out, "caption_en")).not.toContain("[fn]");
    expect(notes.map((n) => n.html)).toEqual(["źródło: NBP", "source: NBP"]);
    expect(html(out, "caption_pl")).toMatch(/title="źródło: NBP"/);
    expect(html(out, "caption_pl")).toMatch(/data-fn="1"/);
  });

  it("rated-list (tabelaryczna): title + description każdego wiersza numerowane w kolejności", () => {
    const raw: WidgetNode = {
      kind: "widget",
      id: "rl",
      type: "rated-list",
      content: {
        items: [
          { title_pl: "Wiersz 1[fn]r1-t[/fn]", description_pl: "opis 1[fn]r1-d[/fn]" },
          { title_pl: "Wiersz 2[fn]r2-t[/fn]", description_pl: "opis 2" },
          { title_pl: "Wiersz 3", description_pl: "opis 3[fn]r3-d[/fn]" },
        ],
      },
    } as unknown as WidgetNode;

    const { widget: out, notes } = processWidgetFootnotes(raw, "pl");
    const items = (out.content as { items: Array<Record<string, string>> }).items;

    expect(notes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5]);
    expect(notes.map((n) => n.html)).toEqual(["r1-t", "r1-d", "r2-t", "r3-d"].concat([]));
    // Sanity: numeracja odpowiada kolejności title→description w wierszu.
    expect(items[0].title_pl).toMatch(/data-fn="1"/);
    expect(items[0].description_pl).toMatch(/data-fn="2"/);
    expect(items[1].title_pl).toMatch(/data-fn="3"/);
    expect(items[2].description_pl).toMatch(/data-fn="4"/);
    for (const it of items) {
      expect(`${it.title_pl}|${it.description_pl}`).not.toContain("[fn]");
    }
  });

  it("wspólny licznik między callout + image caption + accordion + rated-list", () => {
    const col = createCounter(1);
    const cta = processWidgetFootnotes(
      widget("cta", { title_pl: "T[fn]cta[/fn]" }, "w-cta"),
      "pl",
      col,
    );
    const img = processWidgetFootnotes(
      widget("image", { caption_pl: "C[fn]img[/fn]" }, "w-img"),
      "pl",
      col,
    );
    const acc = processWidgetFootnotes(
      {
        kind: "widget",
        id: "w-acc",
        type: "accordion",
        content: { items: [{ title_pl: "A[fn]acc[/fn]", content_pl: "" }] },
      } as unknown as WidgetNode,
      "pl",
      col,
    );
    const rl = processWidgetFootnotes(
      {
        kind: "widget",
        id: "w-rl",
        type: "rated-list",
        content: { items: [{ title_pl: "R[fn]rl[/fn]", description_pl: "" }] },
      } as unknown as WidgetNode,
      "pl",
      col,
    );

    expect(html(cta.widget, "title_pl")).toMatch(/data-fn="1"/);
    expect(html(img.widget, "caption_pl")).toMatch(/data-fn="2"/);
    const accItems = (acc.widget.content as { items: Array<Record<string, string>> }).items;
    const rlItems = (rl.widget.content as { items: Array<Record<string, string>> }).items;
    expect(accItems[0].title_pl).toMatch(/data-fn="3"/);
    expect(rlItems[0].title_pl).toMatch(/data-fn="4"/);
    // Ostatni zwrot niesie skumulowany zbiór.
    expect(rl.notes.map((n) => n.html)).toEqual(["cta", "img", "acc", "rl"]);
  });
});
