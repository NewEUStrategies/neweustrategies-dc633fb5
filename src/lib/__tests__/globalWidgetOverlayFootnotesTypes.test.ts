// Regresja: overlay globalnych widgetów rozwija `[fn]…[/fn]` w tych typach
// widgetów, które renderują treść jako HTML (`WIDGET_TEXT_FIELDS`), i NIE
// rusza pól renderowanych jako węzeł tekstowy - inaczej czytelnik zobaczyłby
// dosłowny `<sup class="fn-ref">…`. Kontrakt markera: SAMODZIELNY
// (src/test/footnoteMarker.ts).

import { describe, it, expect } from "vitest";
import { createCounter, processWidgetFootnotes } from "@/lib/footnotes";
import { hasMarker } from "@/test/footnoteMarker";
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
  it("text: html_pl + html_en (fallback) dzielą licznik widgetu", () => {
    const raw = widget("text", {
      html_pl: "Akapit[fn]p1[/fn] i[fn]p2[/fn]",
      html_en: "Paragraph[fn]p3[/fn]",
    });
    const { widget: out, notes } = processWidgetFootnotes(raw, "pl");

    expect(notes.map((n) => n.id)).toEqual([1, 2, 3]);
    expect(notes.map((n) => n.html)).toEqual(["p1", "p2", "p3"]);
    expect(hasMarker(html(out, "html_pl"), 1)).toBe(true);
    expect(hasMarker(html(out, "html_pl"), 2)).toBe(true);
    expect(hasMarker(html(out, "html_en"), 3)).toBe(true);
    for (const key of ["html_pl", "html_en"] as const) {
      expect(html(out, key)).not.toContain("[fn]");
      expect(html(out, key)).toMatch(/role="note"/);
    }
  });

  it("accordion: numeracja stabilna w odpowiedziach `a_*` wielu itemów", () => {
    const raw: WidgetNode = {
      kind: "widget",
      id: "acc",
      type: "accordion",
      content: {
        items: [
          { q_pl: "A", a_pl: "AA[fn]a-c[/fn] plus[fn]a-c2[/fn]" },
          { q_pl: "B", a_pl: "BB[fn]b-c[/fn]" },
          { q_pl: "C", a_pl: "CC[fn]c-c[/fn]" },
        ],
      },
    } as unknown as WidgetNode;

    const { widget: out, notes } = processWidgetFootnotes(raw, "pl");
    const items = (out.content as { items: Array<Record<string, string>> }).items;
    const joined = items.map((i) => `${i.q_pl}|${i.a_pl}`).join("\n");

    expect(joined).not.toContain("[fn]");
    expect(notes.map((n) => n.html)).toEqual(["a-c", "a-c2", "b-c", "c-c"]);
    for (const n of [1, 2, 3, 4]) expect(hasMarker(joined, n)).toBe(true);
  });

  it("tabs: panel zakładki (`html_*`) rozwija przypisy, etykieta nie", () => {
    const raw = widget("tabs", {
      items: [
        { label_pl: "Zakładka[fn]nie[/fn]", html_pl: "Treść[fn]t1[/fn]" },
        { label_pl: "Druga", html_pl: "Więcej[fn]t2[/fn]" },
      ],
    });
    const { widget: out, notes } = processWidgetFootnotes(raw, "pl");
    const items = (out.content as { items: Array<Record<string, string>> }).items;

    expect(notes.map((n) => n.html)).toEqual(["t1", "t2"]);
    expect(items[0]?.label_pl).toBe("Zakładka[fn]nie[/fn]");
    expect(hasMarker(items[0]?.html_pl ?? "", 1)).toBe(true);
    expect(hasMarker(items[1]?.html_pl ?? "", 2)).toBe(true);
  });

  it("interactive-circle + team-member: opisy i biogram są polami HTML", () => {
    const col = createCounter(1);
    const circle = processWidgetFootnotes(
      widget(
        "interactive-circle",
        { desc_pl: "Opis[fn]d1[/fn]", items: [{ desc_pl: "Element[fn]d2[/fn]" }] },
        "ic",
      ),
      "pl",
      col,
    );
    const member = processWidgetFootnotes(
      widget("team-member", { name_pl: "Jan[fn]nie[/fn]", bio_pl: "Biogram[fn]b1[/fn]" }, "tm"),
      "pl",
      col,
    );

    expect(member.notes.map((n) => n.html)).toEqual(["d1", "d2", "b1"]);
    expect(hasMarker(html(circle.widget, "desc_pl"), 1)).toBe(true);
    const circleItems = (circle.widget.content as { items: Array<Record<string, string>> }).items;
    expect(hasMarker(circleItems[0]?.desc_pl ?? "", 2)).toBe(true);
    expect(hasMarker(html(member.widget, "bio_pl"), 3)).toBe(true);
    // `name_*` renderuje się jako tekst - shortcode zostaje nietknięty.
    expect(html(member.widget, "name_pl")).toBe("Jan[fn]nie[/fn]");
  });

  it("widgety spoza mapy (cta, image, rated-list) pozostają nietknięte", () => {
    // Fail-safe niezmiennika `WIDGET_TEXT_FIELDS`: pola renderowane jako tekst
    // nie mogą dostać markera, bo pokazałby się dosłownie.
    for (const type of ["cta", "image", "rated-list"] as const) {
      const raw = widget(type, { title_pl: "T[fn]x[/fn]", caption_pl: "C[fn]y[/fn]" }, type);
      const { widget: out, notes } = processWidgetFootnotes(raw, "pl");
      expect(notes).toEqual([]);
      expect(html(out, "title_pl")).toBe("T[fn]x[/fn]");
      expect(html(out, "caption_pl")).toBe("C[fn]y[/fn]");
    }
  });
});
