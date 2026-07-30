// Regresja: overlay globalnych widgetów NIE może pozostawić surowego shortcode
// `[fn]…[/fn]` w treści renderowanej po hydratacji live payloadu z bazy.
// Pipeline: useGlobalWidgetNode → mergeGlobalIntoInstance → processWidgetFootnotes.
//
// Kontrakt wyjścia dla tej ścieżki to marker SAMODZIELNY (patrz
// `src/test/footnoteMarker.ts` i `ExpandOptions` w src/lib/footnotes.ts):
// `<sup class="fn-ref"><span title="…" role="note">[N]</span></sup>`.
//
// Pola przetwarzane są wyłącznie te z `WIDGET_TEXT_FIELDS` (tylko pola
// renderowane przez `dangerouslySetInnerHTML`), więc akordeon używa `a_*`,
// nie `content_*`.

import { describe, it, expect } from "vitest";
import { processWidgetFootnotes } from "@/lib/footnotes";
import { hasMarker, standaloneMarker } from "@/test/footnoteMarker";
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
    expect(html).toBe(`Zdanie z przypisem${standaloneMarker(1, "Źródło: NBP 2026")}.`);
    expect(notes).toEqual([{ id: 1, html: "Źródło: NBP 2026" }]);
  });

  it("expands footnotes in accordion answers after overlay hydration", () => {
    const acc: WidgetNode = {
      kind: "widget",
      id: "w-2",
      type: "accordion",
      content: {
        items: [
          { q_pl: "Pytanie", a_pl: "Treść[fn]a[/fn] i[fn]b[/fn]" },
          { q_pl: "Bez", a_pl: "Też[fn]c[/fn]" },
        ],
      },
    } as unknown as WidgetNode;

    const { widget, notes } = processWidgetFootnotes(acc, "pl");
    const items = (widget.content as { items: Array<Record<string, string>> }).items;
    const joined = items.map((i) => `${i.q_pl}|${i.a_pl}`).join("\n");

    expect(joined).not.toContain("[fn]");
    expect(notes.map((n) => n.html)).toEqual(["a", "b", "c"]);
    expect(hasMarker(joined, 1)).toBe(true);
    expect(hasMarker(joined, 3)).toBe(true);
  });

  it("leaves text-rendered fields untouched (fail-safe: shortcode zostaje)", () => {
    // `q_*` akordeonu renderuje się jako węzeł tekstowy w <summary>, więc
    // rozwinięcie markera pokazałoby czytelnikowi dosłowny <sup>.
    const acc: WidgetNode = {
      kind: "widget",
      id: "w-3",
      type: "accordion",
      content: { items: [{ q_pl: "Tytuł[fn]t[/fn]", a_pl: "Treść" }] },
    } as unknown as WidgetNode;

    const { widget, notes } = processWidgetFootnotes(acc, "pl");
    const items = (widget.content as { items: Array<Record<string, string>> }).items;
    expect(items[0]?.q_pl).toBe("Tytuł[fn]t[/fn]");
    expect(notes).toEqual([]);
  });

  it("drops empty [fn][/fn] without consuming a number", () => {
    const raw = makeTextWidget("A[fn]  [/fn] B[fn]realna[/fn]");
    const { widget, notes } = processWidgetFootnotes(raw, "pl");
    const html = String((widget.content as Record<string, unknown>).html_pl);

    expect(notes).toEqual([{ id: 1, html: "realna" }]);
    expect(hasMarker(html, 1)).toBe(true);
    expect(hasMarker(html, 2)).toBe(false);
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
