// Detektor `h1` a treść zagnieżdżona w listach pozycji.
//
// Widgety z pozycjami (zakładki, akordeon, karuzele tekstowe) trzymają HTML
// w TABLICY obiektów - `items: [{ html_pl: "<h1>…" }]`. Detektor musi zejść do
// każdej pozycji, inaczej strona z `h1` wklejonym w zakładkę dostaje drugi,
// dorysowany `h1` z tytułu (defekt SEO). I odwrotnie: lista pozycji BEZ
// znacznika nie może udawać nagłówka. Bez atrap - funkcja jest czysta.
import { describe, expect, it } from "vitest";
import { widgetRendersTopHeading } from "@/lib/builder/headings";
import type { WidgetContent, WidgetNode, WidgetType } from "@/lib/builder/types";

function widget(type: string, content: WidgetContent): WidgetNode {
  return { id: `w-${type}`, kind: "widget", type: type as WidgetType, content };
}

describe("widgetRendersTopHeading - treść w listach pozycji", () => {
  it("znajduje h1 w HTML drugiej pozycji listy", () => {
    const tabs = widget("tabs", {
      items: [
        { html_pl: "<p>Wstęp</p>" },
        { title_pl: "Raport", html_pl: "<h1>Raport roczny</h1>" },
      ],
    });
    expect(widgetRendersTopHeading(tabs)).toBe(true);
  });

  it("znajduje h1 w liście zagnieżdżonej w liście", () => {
    const accordion = widget("accordion", {
      groups: [{ items: [["<p>a</p>", '<H1 class="x">B</H1>']] }],
    });
    expect(widgetRendersTopHeading(accordion)).toBe(true);
  });

  it("lista pozycji bez znacznika h1 (także z h2 i <h10>) nie jest nagłówkiem", () => {
    const tabs = widget("tabs", {
      items: [{ html_pl: "<h2>Śródtytuł</h2>" }, { html_pl: "<h10>nie tag</h10>" }, 7, null],
    });
    expect(widgetRendersTopHeading(tabs)).toBe(false);
  });
});
