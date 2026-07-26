// Strażnik niezmiennika: w mapie wolno trzymać WYŁĄCZNIE pola, które renderer
// wstawia przez `dangerouslySetInnerHTML`.
//
// Dlaczego to jest test, a nie tylko komentarz: pre-pass zamienia `[fn]…[/fn]`
// na `<sup class="fn-ref">…</sup>`. Pole renderowane jako węzeł tekstowy React
// pokaże ten znacznik DOSŁOWNIE - czytelnik zobaczy `<sup class="fn-ref">…`
// jako tekst na stronie. Mapa raz już rozjechała się w obie strony (obejmowała
// etykiety przycisków i nazwy osób, a pomijała `tabs.items[].html` oraz
// `accordion.items[].a`), więc lista jest tu zamrożona wprost - dopisanie
// widgetu wymaga świadomej zmiany testu razem z odsyłaczem do miejsca renderu.
import { describe, it, expect } from "vitest";
import { WIDGET_TEXT_FIELDS, localizedKeys } from "@/lib/builder/widgetTextFields";
import { processWidgetFootnotes } from "@/lib/footnotes";
import type { WidgetNode, WidgetType } from "@/lib/builder/types";

const widget = (type: WidgetType, content: Record<string, unknown>): WidgetNode =>
  ({ id: "w1", kind: "widget", type, content }) as unknown as WidgetNode;

const field = (w: WidgetNode, key: string): string =>
  String((w.content as unknown as Record<string, unknown>)[key] ?? "");

describe("WIDGET_TEXT_FIELDS - niezmiennik 'tylko pola HTML'", () => {
  it("obejmuje dokładnie widgety renderujące treść jako HTML", () => {
    // Każdy wpis odpowiada jednemu `dangerouslySetInnerHTML` w widget-view:
    //   text                -> RichHtmlView
    //   tabs                -> TabsBlock (panel zakładki)
    //   accordion           -> SimpleWidgets (odpowiedź `a_*`)
    //   interactive-circle  -> InteractiveCircleWidget (opis widgetu + elementu)
    //   team-member         -> TeamMemberWidget (biogram)
    expect(Object.keys(WIDGET_TEXT_FIELDS).sort()).toEqual([
      "accordion",
      "interactive-circle",
      "tabs",
      "team-member",
      "text",
    ]);
  });

  it("używa nazw pól zgodnych z rendererami (nie z etykiet panelu)", () => {
    // Regresja: mapa miała `accordion.items[].{title,content,body}`, a renderer
    // czyta `a_*`. Przypisy w akordeonie nie działały mimo "pokrycia".
    expect(WIDGET_TEXT_FIELDS.accordion?.arrays?.[0]).toEqual({
      arrayKey: "items",
      fields: ["a"],
    });
    expect(WIDGET_TEXT_FIELDS.tabs?.arrays?.[0]).toEqual({ arrayKey: "items", fields: ["html"] });
    expect(WIDGET_TEXT_FIELDS["team-member"]?.scalar).toEqual(["bio"]);
    expect(WIDGET_TEXT_FIELDS["interactive-circle"]).toEqual({
      scalar: ["desc"],
      arrays: [{ arrayKey: "items", fields: ["desc"] }],
    });
  });

  it("NIE obejmuje widgetów renderujących tekst (inaczej znacznik byłby widoczny)", () => {
    // Lista pól, które kiedyś były w mapie i produkowałyby widoczne `<sup…>`:
    // button.label / heading.title / section-label / hot-topic-bar /
    // animated-heading / testimonial.author / team-member.name+role / cta /
    // pricing / timeline / image.caption / gallery.caption / video.caption /
    // dark-featured-card / rated-list.
    for (const type of [
      "button",
      "heading",
      "section-label",
      "hot-topic-bar",
      "animated-heading",
      "testimonial",
      "cta",
      "pricing",
      "timeline",
      "image",
      "gallery",
      "video",
      "dark-featured-card",
      "rated-list",
    ] as WidgetType[]) {
      expect(WIDGET_TEXT_FIELDS[type]).toBeUndefined();
    }
  });
});

describe("pre-pass respektuje niezmiennik w praktyce", () => {
  it("etykieta przycisku zostaje NIETKNIĘTA (shortcode zamiast tag soup)", () => {
    const w = widget("button", { label_pl: "Kup[fn] nota [/fn]" });
    const { widget: out, notes } = processWidgetFootnotes(w, "pl");

    // Lepiej pokazać nierozwinięty shortcode niż dosłowny `<sup class="fn-ref">`.
    expect(field(out, "label_pl")).toBe("Kup[fn] nota [/fn]");
    expect(field(out, "label_pl")).not.toContain("<sup");
    expect(notes).toEqual([]);
  });

  it("body zakładki JEST rozwijane (pole HTML)", () => {
    const w = widget("tabs", {
      items: [{ label_pl: "Pierwsza", html_pl: "<p>Treść[fn] nota zakładki [/fn]</p>" }],
    });
    const { widget: out, notes } = processWidgetFootnotes(w, "pl");
    const items = (out.content as unknown as { items: Array<Record<string, string>> }).items;

    expect(items[0].html_pl).toContain('class="fn-ref"');
    expect(items[0].html_pl).toContain("[1]");
    // Etykieta zakładki to przycisk (tekst) - musi zostać nietknięta.
    expect(items[0].label_pl).toBe("Pierwsza");
    expect(notes).toEqual([{ id: 1, html: "nota zakładki" }]);
  });

  it("odpowiedź akordeonu JEST rozwijana, pytanie NIE", () => {
    const w = widget("accordion", {
      items: [
        { q_pl: "Pytanie[fn] nota z pytania [/fn]", a_pl: "<p>Odpowiedź[fn] nota [/fn]</p>" },
      ],
    });
    const { widget: out, notes } = processWidgetFootnotes(w, "pl");
    const items = (out.content as unknown as { items: Array<Record<string, string>> }).items;

    expect(items[0].a_pl).toContain('class="fn-ref"');
    expect(items[0].q_pl).toBe("Pytanie[fn] nota z pytania [/fn]");
    expect(notes).toEqual([{ id: 1, html: "nota" }]);
  });
});

describe("localizedKeys", () => {
  it("stawia bieżący język pierwszy, potem fallback, potem klucz bez sufiksu", () => {
    expect(localizedKeys("html", "pl")).toEqual(["html_pl", "html_en", "html"]);
    expect(localizedKeys("html", "en")).toEqual(["html_en", "html_pl", "html"]);
  });
});
