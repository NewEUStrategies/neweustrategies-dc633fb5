// Regresja: overlay globalnych widgetów NIE może pozostawić surowego shortcode
// `[fn]…[/fn]` w treści renderowanej po hydratacji live payloadu z bazy.
// Pipeline: useGlobalWidgetNode → mergeGlobalIntoInstance → processWidgetFootnotes.
// Kontrakt wyjścia potwierdzamy przez markery <sup class="fn-ref"> z data-fn/title.

import { describe, it, expect } from "vitest";
import { processWidgetFootnotes } from "@/lib/footnotes";
import type { WidgetNode } from "@/lib/builder/types";

function makeTextWidget(html: string): WidgetNode {
  return {
    kind: "widget",
    id: "w-1",
    type: "text",
    content: { html_pl: html },
  } as unknown as WidgetNode;
}

describe("global widget overlay footnotes", () => {
  it("expands [fn]…[/fn] in overlaid text widget to tooltip marker", () => {
    const raw = makeTextWidget("Zdanie z przypisem[fn]Źródło: NBP 2026[/fn].");
    const { widget, notes } = processWidgetFootnotes(raw, "pl");

    const html = String((widget.content as Record<string, unknown>).html_pl);
    expect(html).not.toContain("[fn]");
    expect(html).not.toContain("[/fn]");
    expect(html).toMatch(/<sup class="fn-ref">/);
    expect(html).toMatch(/data-fn="1"/);
    expect(html).toMatch(/title="Źródło: NBP 2026"/);
    expect(html).toMatch(/role="doc-noteref"/);
    expect(notes).toEqual([{ id: 1, html: "Źródło: NBP 2026" }]);
  });

  it("expands footnotes in accordion items after overlay hydration", () => {
    const acc: WidgetNode = {
      kind: "widget",
      id: "w-2",
      type: "accordion",
      content: {
        items: [
          { title_pl: "Tytuł[fn]a[/fn]", content_pl: "Treść[fn]b[/fn]" },
          { title_pl: "Bez", content_pl: "Też[fn]c[/fn]" },
        ],
      },
    } as unknown as WidgetNode;

    const { widget, notes } = processWidgetFootnotes(acc, "pl");
    const items = (widget.content as { items: Array<Record<string, string>> }).items;
    const joined = items.map((i) => `${i.title_pl}|${i.content_pl}`).join("\n");

    expect(joined).not.toContain("[fn]");
    expect(notes.map((n) => n.html)).toEqual(["a", "b", "c"]);
    expect(joined).toMatch(/data-fn="1"/);
    expect(joined).toMatch(/data-fn="3"/);
  });

  it("drops empty [fn][/fn] without consuming a number", () => {
    const raw = makeTextWidget("A[fn]  [/fn] B[fn]realna[/fn]");
    const { widget, notes } = processWidgetFootnotes(raw, "pl");
    const html = String((widget.content as Record<string, unknown>).html_pl);

    expect(notes).toEqual([{ id: 1, html: "realna" }]);
    expect(html).toMatch(/data-fn="1"/);
    expect(html).not.toMatch(/data-fn="2"/);
  });

  it("is idempotent - already-expanded markup is not re-wrapped", () => {
    const raw = makeTextWidget("X[fn]raz[/fn]");
    const first = processWidgetFootnotes(raw, "pl");
    const second = processWidgetFootnotes(first.widget, "pl");
    expect(
      String((second.widget.content as Record<string, unknown>).html_pl),
    ).toBe(String((first.widget.content as Record<string, unknown>).html_pl));
  });
});
