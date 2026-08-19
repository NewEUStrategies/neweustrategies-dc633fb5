// Reguły dokumentu buildera - wyciągnięte z 900-linijkowego komponentu, żeby
// dały się sprawdzić inaczej niż przeciąganiem myszą.
//
// Każdy blok pilnuje pomyłki, która NIE wywala aplikacji:
//   * przenoszenie widgetu, które gubi element albo wstawia go o jedno miejsce
//     dalej, niż operator upuścił,
//   * wyjście z dwóch kolumn, które zostawia „col: 1" - kanwa POMIJA taki
//     widget i operator widzi, że element zniknął,
//   * duplikat sekcji z powtórzonymi identyfikatorami - dwa elementy zaznaczają
//     się i patchują razem,
//   * zaczep pierwszego dokumentu, który gubi klauzulę RODO albo pole zgody.
import { describe, it, expect } from "vitest";
import * as rules from "@/components/admin/newsletter/builder/builderDoc";
import { makeSection, makeWidget, buildDefaultDoc } from "@/lib/newsletter-builder/defaults";
import { defaultNewsletterSettings } from "@/hooks/useNewsletterSettings";
import type { NlDoc, NlSection, NlWidget } from "@/lib/newsletter-builder/types";

/** Widget o znanym identyfikatorze - testy mówią o konkretnych elementach. */
function w(id: string, col?: 0 | 1): NlWidget {
  return { ...makeWidget("heading"), id, ...(col === undefined ? {} : { col }) } as NlWidget;
}

function section(id: string, widgets: NlWidget[] = [], extra: Partial<NlSection> = {}): NlSection {
  return { ...makeSection(widgets), id, ...extra };
}

function doc(sections: NlSection[]): NlDoc {
  return { version: 1, variant: "inline", sections };
}

/** Deterministyczny generator identyfikatorów - kopie muszą być rozpoznawalne. */
function ids(prefix = "new") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/** Widgety sekcji po identyfikatorze - czytelny zapis oczekiwanego układu. */
function layout(d: NlDoc): Record<string, string[]> {
  return Object.fromEntries(d.sections.map((s) => [s.id, s.widgets.map((x) => x.id)]));
}

// ---------------------------------------------------------------------------
describe("wyszukiwanie w dokumencie", () => {
  const d = doc([section("s1", [w("a"), w("b")]), section("s2", [w("c")])]);

  it("znajduje widget razem z numerem jego sekcji", () => {
    expect(rules.findWidgetLocation(d, "c")).toEqual({ sectionIdx: 1, widgetIdx: 0 });
    expect(rules.findWidgetLocation(d, "b")).toEqual({ sectionIdx: 0, widgetIdx: 1 });
  });

  it("nieznany widget to NULL, a nie indeks -1", () => {
    // -1 zadziałałoby jak „ostatni element" i patch trafiłby w niewinny widget.
    expect(rules.findWidgetLocation(d, "nie-ma")).toBeNull();
    expect(rules.widgetById(d, "nie-ma")).toBeNull();
  });

  it("oddaje widget po identyfikatorze, a brak zaznaczenia to NULL", () => {
    expect(rules.widgetById(d, "b")?.id).toBe("b");
    expect(rules.widgetById(d, null)).toBeNull();
  });

  it("oddaje sekcję po identyfikatorze", () => {
    expect(rules.sectionById(d, "s2")?.id).toBe("s2");
    expect(rules.sectionById(d, "s9")).toBeNull();
    expect(rules.sectionById(d, null)).toBeNull();
  });

  it("indeks sekcji liczy się od zera", () => {
    expect(rules.findSectionIdx(d, "s1")).toBe(0);
    expect(rules.findSectionIdx(d, "s9")).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
describe("rozwiązywanie celu upuszczenia", () => {
  const d = doc([section("sec-uuid-1", [w("a"), w("b", 1)])]);

  it("obszar sekcji bez kolumny", () => {
    expect(rules.resolveDropTarget(d, "sec-sec-uuid-1-drop")).toEqual({
      sectionId: "sec-uuid-1",
      col: null,
      overWidgetIdx: null,
    });
    // Myślniki UUID-a nie mogą się zjeść z sufiksem „-drop".
    expect(rules.resolveDropTarget(d, "sec-sec-uuid-1-drop")!.sectionId).toContain("uuid-1");
  });

  it("obszar PIERWSZEJ i DRUGIEJ kolumny", () => {
    expect(rules.resolveDropTarget(d, "sec-sec-uuid-1-col-0").col).toBe(0);
    expect(rules.resolveDropTarget(d, "sec-sec-uuid-1-col-1").col).toBe(1);
  });

  it("identyfikator sekcji Z MYŚLNIKAMI nie jest ucinany", () => {
    // UUID ma myślniki; niezachłanny wzorzec rozwiązałby „sec-a-b-col-1" na
    // sekcję „a" i widget wylądowałby w zupełnie innym miejscu dokumentu.
    const target = rules.resolveDropTarget(d, "sec-sec-uuid-1-col-1");

    expect(target.sectionId).toBe("sec-uuid-1");
    expect(target.col).toBe(1);
  });

  it("upuszczenie NA WIDGET daje jego sekcję, kolumnę i indeks", () => {
    expect(rules.resolveDropTarget(d, "b")).toEqual({
      sectionId: "sec-uuid-1",
      col: 1,
      overWidgetIdx: 1,
    });
    // Widget bez przypisania to kolumna 0, nie „brak kolumny" - upuszczenie na
    // niego musi wskazać PIERWSZĄ kolumnę, inaczej element wróciłby do wspólnej
    // puli i w układzie dwukolumnowym zniknął z kanwy.
    expect(rules.resolveDropTarget(d, "a")).toEqual({
      sectionId: "sec-uuid-1",
      col: 0,
      overWidgetIdx: 0,
    });
  });

  it("widget bez przypisanej kolumny liczy się jako pierwsza", () => {
    expect(rules.resolveDropTarget(d, "a").col).toBe(0);
    expect(rules.resolveDropTarget(d, "a").overWidgetIdx).toBe(0);
  });

  it("obszar nieznany daje cel PUSTY - upuszczenie nic nie zmienia", () => {
    expect(rules.resolveDropTarget(d, "cokolwiek")).toEqual({
      sectionId: null,
      col: null,
      overWidgetIdx: null,
    });
    expect(rules.resolveDropTarget(d, "sec-bez-sufiksu").sectionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("styl i obraz sekcji", () => {
  it("styl DOKŁADA się do istniejącego, nie zastępuje go", () => {
    const d = doc([section("s1", [], { style: { bg: "#000", paddingY: 20 } })]);

    const next = rules.applySectionStyle(d, "s1", { paddingY: 40 });

    expect(next.sections[0]!.style).toEqual({ bg: "#000", paddingY: 40 });
    // Wejście zostaje nietknięte - patch oddaje nowy dokument.
    expect(d.sections[0]!.style).toEqual({ bg: "#000", paddingY: 20 });
  });

  it("styl da się ustawić sekcji, która go jeszcze nie miała", () => {
    // Sekcje z dokumentów zapisanych starszą wersją buildera nie mają bloku
    // stylu - pierwszy patch musi go założyć, a nie wywalić się na `undefined`.
    const d = doc([{ id: "s1", widgets: [] }]);

    expect(rules.applySectionStyle(d, "s1", { gap: 8 }).sections[0]!.style).toEqual({ gap: 8 });
    expect(d.sections[0]!.style).toBeUndefined();
  });

  it("patch nie rusza POZOSTAŁYCH sekcji", () => {
    const d = doc([section("s1"), section("s2", [], { style: { bg: "#fff" } })]);

    const next = rules.applySectionStyle(d, "s1", { bg: "#000" });

    expect(next.sections[1]).toBe(d.sections[1]);
    expect(next.sections[0]).not.toBe(d.sections[0]);
  });

  it("obraz sekcji zakładany od zera dostaje POZYCJĘ - nigdy jej nie brakuje", () => {
    const d = doc([section("s1")]);

    const next = rules.applySectionMedia(d, "s1", { url: "https://example.test/a.png" });

    expect(next.sections[0]!.media).toEqual({
      url: "https://example.test/a.png",
      position: "left",
    });
    // Bez pozycji renderer nie wiedziałby, z której strony ustawić grafikę.
    expect(next.sections[0]!.media!.position).toBeDefined();
  });

  it("patch obrazu zachowuje adres, gdy zmienia się tylko opis", () => {
    const d = doc([
      section("s1", [], { media: { url: "https://example.test/a.png", position: "right" } }),
    ]);

    const next = rules.applySectionMedia(d, "s1", { alt: "Opis" });

    expect(next.sections[0]!.media).toEqual({
      url: "https://example.test/a.png",
      position: "right",
      alt: "Opis",
    });
    // Pozycja NIE wraca do domyślnej „left" tylko dlatego, że patch jej nie nosi.
    expect(next.sections[0]!.media!.position).toBe("right");
  });

  it("NULL usuwa obraz sekcji", () => {
    const d = doc([
      section("s1", [], { media: { url: "https://example.test/a.png", position: "left" } }),
    ]);

    expect(rules.applySectionMedia(d, "s1", null).sections[0]!.media).toBeNull();
    expect(d.sections[0]!.media).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("przełączanie układu sekcji", () => {
  it("wejście w dwie kolumny nadaje brakującym widgetom PIERWSZĄ kolumnę", () => {
    const d = doc([section("s1", [w("a"), w("b", 1)])]);

    const next = rules.applySectionLayout(d, "s1", "1-1");

    expect(next.sections[0]!.widgets.map((x) => x.col)).toEqual([0, 1]);
    expect(next.sections[0]!.layout).toBe("1-1");
  });

  it("wyjście na jedną kolumnę CZYŚCI przypisania - inaczej widget znika z kanwy", () => {
    // Kanwa w układzie jednokolumnowym pomija widgety z ustawionym `col`.
    const d = doc([section("s1", [w("a", 1), w("b", 1)], { layout: "1-1" })]);

    const next = rules.applySectionLayout(d, "s1", "single");

    expect(next.sections[0]!.widgets.every((x) => x.col === undefined)).toBe(true);
    expect(next.sections[0]!.layout).toBe("single");
  });

  it("przełączenie nie mutuje dokumentu wejściowego - cofanie musi działać", () => {
    const d = doc([section("s1", [w("a", 1)], { layout: "1-1" })]);

    rules.applySectionLayout(d, "s1", "single");

    expect(d.sections[0]!.widgets[0]!.col).toBe(1);
    expect(d.sections[0]!.layout).toBe("1-1");
  });
});

// ---------------------------------------------------------------------------
describe("dodawanie, usuwanie i przesuwanie sekcji", () => {
  it("nowa sekcja ląduje ZARAZ ZA wskazaną", () => {
    const d = doc([section("s1"), section("s2")]);

    const next = rules.insertSection(d, section("nowa"), "s1");

    expect(next.sections.map((s) => s.id)).toEqual(["s1", "nowa", "s2"]);
  });

  it("bez wskazania sekcja ląduje na KOŃCU", () => {
    const d = doc([section("s1"), section("s2")]);

    expect(rules.insertSection(d, section("nowa")).sections.map((s) => s.id)).toEqual([
      "s1",
      "s2",
      "nowa",
    ]);
    expect(d.sections).toHaveLength(2);
  });

  it("wskazanie nieznanej sekcji też kończy się na końcu, a nie utratą sekcji", () => {
    const d = doc([section("s1")]);

    const next = rules.insertSection(d, section("nowa"), "nie-ma");

    expect(next.sections.map((s) => s.id)).toEqual(["s1", "nowa"]);
  });

  it("OSTATNIEJ sekcji nie wolno usunąć", () => {
    // Dokument bez sekcji nie ma gdzie trzymać widgetów - builder pokazałby
    // pustą kanwę bez możliwości dodania czegokolwiek.
    const d = doc([section("s1")]);

    expect(rules.canRemoveSection(d)).toBe(false);
    expect(rules.removeSection(d, "s1").sections).toHaveLength(1);
  });

  it("przy dwóch sekcjach usunięcie przechodzi", () => {
    const d = doc([section("s1"), section("s2")]);

    expect(rules.canRemoveSection(d)).toBe(true);
    expect(rules.removeSection(d, "s1").sections.map((s) => s.id)).toEqual(["s2"]);
  });

  it("kopia sekcji dostaje NOWY identyfikator - i to samo każdy widget w środku", () => {
    const d = doc([section("s1", [w("a"), w("b")])]);

    const next = rules.duplicateSection(d, "s1", ids());

    expect(next.sections.map((s) => s.id)).toEqual(["s1", "new-1"]);
    expect(next.sections[1]!.widgets.map((x) => x.id)).toEqual(["new-2", "new-3"]);
  });

  it("kopia zachowuje styl i układ oryginału", () => {
    const d = doc([section("s1", [w("a", 1)], { layout: "1-1", style: { bg: "#000" } })]);

    const copy = rules.duplicateSection(d, "s1", ids()).sections[1]!;

    expect(copy.layout).toBe("1-1");
    expect(copy.style).toEqual({ bg: "#000" });
  });

  it("duplikowanie nieznanej sekcji nie dokłada niczego", () => {
    const d = doc([section("s1")]);

    expect(rules.duplicateSection(d, "nie-ma", ids())).toBe(d);
    expect(d.sections).toHaveLength(1);
  });

  it("sekcja przesuwa się w górę i w dół", () => {
    const d = doc([section("s1"), section("s2"), section("s3")]);

    expect(rules.moveSection(d, "s2", -1).sections.map((s) => s.id)).toEqual(["s2", "s1", "s3"]);
    expect(rules.moveSection(d, "s2", 1).sections.map((s) => s.id)).toEqual(["s1", "s3", "s2"]);
  });

  it("na krańcach przesuwanie nic nie robi - sekcja nie wypada z dokumentu", () => {
    const d = doc([section("s1"), section("s2")]);

    expect(rules.moveSection(d, "s1", -1).sections.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(rules.moveSection(d, "s2", 1).sections.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("przesuwanie nieznanej sekcji nie rusza dokumentu", () => {
    const d = doc([section("s1"), section("s2")]);

    expect(rules.moveSection(d, "nie-ma", 1)).toBe(d);
    expect(d.sections).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
describe("budowanie widgetu do wstawienia", () => {
  it("bez presetu oddaje widget fabryczny", () => {
    const base = makeWidget("field.email");

    const built = rules.buildWidget(section("s1"), base);

    expect(built.type).toBe("field.email");
    expect(built.id).toBe(base.id);
  });

  it("preset NADPISUJE wartości, ale nie identyfikator ani typ", () => {
    // Wspólny `id` dla wszystkich wariantów `field.text` sprawiłby, że imię i
    // nazwisko zaznaczają się i patchują razem.
    const base = makeWidget("field.text");

    const built = rules.buildWidget(section("s1"), base, {
      preset: { name: "firstName", id: "podszywka", type: "submit" } as Partial<NlWidget>,
    });

    expect(built).toMatchObject({ id: base.id, type: "field.text" });
    expect((built as { name?: string }).name).toBe("firstName");
  });

  it("w JEDNEJ kolumnie widget NIE dostaje przypisania kolumny", () => {
    const built = rules.buildWidget(section("s1"), makeWidget("heading"), { col: 1 });

    // Zostawione „col: 1" sprawia, że kanwa jednokolumnowa POMIJA widget i
    // operator widzi, że dodany element zniknął.
    expect(built.col).toBeUndefined();
    expect("col" in built).toBe(false);
  });

  it("w dwóch kolumnach widget dostaje wskazaną kolumnę", () => {
    const target = section("s1", [], { layout: "1-1" });

    expect(rules.buildWidget(target, makeWidget("heading"), { col: 1 }).col).toBe(1);
    expect(rules.buildWidget(target, makeWidget("heading")).col).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("wstawianie, usuwanie i duplikowanie widgetów", () => {
  it("bez indeksu widget ląduje na końcu sekcji", () => {
    const d = doc([section("s1", [w("a")])]);

    const next = rules.insertWidget(d, "s1", w("nowy"));

    expect(layout(next)).toEqual({ s1: ["a", "nowy"] });
    expect(layout(d)).toEqual({ s1: ["a"] });
  });

  it("indeks wskazuje pozycję wstawienia", () => {
    const d = doc([section("s1", [w("a"), w("b")])]);

    expect(layout(rules.insertWidget(d, "s1", w("nowy"), 1))).toEqual({
      s1: ["a", "nowy", "b"],
    });
    // Indeks 0 wstawia na sam początek.
    expect(layout(rules.insertWidget(d, "s1", w("nowy"), 0))).toEqual({
      s1: ["nowy", "a", "b"],
    });
  });

  it("indeks poza zakresem jest PRZYCINANY, a nie zostawia dziury", () => {
    const d = doc([section("s1", [w("a")])]);

    expect(layout(rules.insertWidget(d, "s1", w("x"), 99))).toEqual({ s1: ["a", "x"] });
    expect(layout(rules.insertWidget(d, "s1", w("y"), -5))).toEqual({ s1: ["y", "a"] });
  });

  it("wstawienie do nieznanej sekcji nie tworzy sekcji-widma", () => {
    const d = doc([section("s1")]);

    const next = rules.insertWidget(d, "nie-ma", w("x"));

    expect(next.sections).toHaveLength(1);
    expect(next.sections[0]!.widgets).toHaveLength(0);
  });

  it("usunięcie wycina TYLKO wskazany widget, także z dalszej sekcji", () => {
    const d = doc([section("s1", [w("a"), w("b")]), section("s2", [w("c")])]);

    expect(layout(rules.removeWidget(d, "b"))).toEqual({ s1: ["a"], s2: ["c"] });
    expect(layout(rules.removeWidget(d, "c"))).toEqual({ s1: ["a", "b"], s2: [] });
  });

  it("usunięcie nieznanego widgetu nie rusza dokumentu", () => {
    const d = doc([section("s1", [w("a")])]);

    expect(rules.removeWidget(d, "nie-ma")).toBe(d);
    expect(d.sections[0]!.widgets).toHaveLength(1);
  });

  it("kopia widgetu ląduje ZARAZ ZA oryginałem, z nowym identyfikatorem", () => {
    const d = doc([section("s1", [w("a"), w("b")])]);

    const next = rules.duplicateWidget(d, "a", ids());

    expect(layout(next)).toEqual({ s1: ["a", "new-1", "b"] });
    // Kopia niesie treść oryginału, nie świeży widget domyślny.
    expect(rules.widgetById(next, "new-1")!.type).toBe(rules.widgetById(d, "a")!.type);
  });

  it("kopia zachowuje treść oryginału", () => {
    const heading = { ...makeWidget("heading"), id: "a", text: { pl: "Tytuł", en: "Title" } };
    const d = doc([section("s1", [heading as NlWidget])]);

    const copy = rules.duplicateWidget(d, "a", ids()).sections[0]!.widgets[1]!;

    expect((copy as { text?: unknown }).text).toEqual({ pl: "Tytuł", en: "Title" });
    expect(copy.id).not.toBe("a");
  });

  it("duplikowanie nieznanego widgetu nie dokłada niczego", () => {
    const d = doc([section("s1", [w("a")])]);

    expect(rules.duplicateWidget(d, "nie-ma", ids())).toBe(d);
    expect(d.sections[0]!.widgets).toHaveLength(1);
  });

  it("patch widgetu zmienia TYLKO ten widget", () => {
    const d = doc([section("s1", [w("a"), w("b")])]);

    const next = rules.patchWidget(d, "a", {
      text: { pl: "Nowy", en: "New" },
    } as Partial<NlWidget>);

    expect((next.sections[0]!.widgets[0] as { text?: unknown }).text).toEqual({
      pl: "Nowy",
      en: "New",
    });
    expect(next.sections[0]!.widgets[1]).toBe(d.sections[0]!.widgets[1]);
  });

  it("patch nieznanego widgetu nie rusza dokumentu", () => {
    const d = doc([section("s1", [w("a")])]);

    expect(rules.patchWidget(d, "nie-ma", {} as Partial<NlWidget>)).toBe(d);
    expect(d.sections[0]!.widgets[0]!.id).toBe("a");
  });
});

// ---------------------------------------------------------------------------
describe("przenoszenie widgetu", () => {
  it("w obrębie sekcji wstawia PRZED element, nad którym puszczono mysz", () => {
    const d = doc([section("s1", [w("a"), w("b"), w("c")])]);

    const next = rules.moveWidget(d, "c", { sectionId: "s1", col: null, overWidgetIdx: 1 });

    expect(layout(next)).toEqual({ s1: ["a", "c", "b"] });
    // Liczba widgetów bez zmian - przeniesienie nie kopiuje i nie gubi.
    expect(next.sections[0]!.widgets).toHaveLength(3);
  });

  it("przeniesienie w obrębie sekcji NIE gubi ani nie dubluje widgetu", () => {
    const d = doc([section("s1", [w("a"), w("b"), w("c")])]);

    const next = rules.moveWidget(d, "a", { sectionId: "s1", col: null, overWidgetIdx: 2 });

    expect(next.sections[0]!.widgets).toHaveLength(3);
    expect(new Set(next.sections[0]!.widgets.map((x) => x.id)).size).toBe(3);
  });

  it("cel bez wskazanego elementu oznacza KONIEC sekcji", () => {
    const d = doc([section("s1", [w("a"), w("b")])]);

    const next = rules.moveWidget(d, "a", { sectionId: "s1", col: null, overWidgetIdx: null });

    expect(layout(next)).toEqual({ s1: ["b", "a"] });
    expect(next.sections[0]!.widgets).toHaveLength(2);
  });

  it("przeniesienie do INNEJ sekcji zabiera widget ze źródła", () => {
    const d = doc([section("s1", [w("a"), w("b")]), section("s2", [w("c")])]);

    const next = rules.moveWidget(d, "a", { sectionId: "s2", col: null, overWidgetIdx: null });

    expect(layout(next)).toEqual({ s1: ["b"], s2: ["c", "a"] });
    // Suma widgetów w całym dokumencie zostaje ta sama.
    expect(next.sections.flatMap((x) => x.widgets)).toHaveLength(3);
  });

  it("przeniesienie do sekcji dwukolumnowej ustawia WSKAZANĄ kolumnę", () => {
    const d = doc([section("s1", [w("a")]), section("s2", [], { layout: "1-1" })]);

    const next = rules.moveWidget(d, "a", { sectionId: "s2", col: 1, overWidgetIdx: null });

    expect(next.sections[1]!.widgets[0]!.col).toBe(1);
    expect(layout(next)).toEqual({ s1: [], s2: ["a"] });
  });

  it("bez wskazanej kolumny widget zachowuje swoją poprzednią", () => {
    const d = doc([
      section("s1", [w("a", 1)], { layout: "1-1" }),
      section("s2", [], { layout: "1-1" }),
    ]);

    const next = rules.moveWidget(d, "a", { sectionId: "s2", col: null, overWidgetIdx: null });

    expect(next.sections[1]!.widgets[0]!.col).toBe(1);
    expect(layout(next)).toEqual({ s1: [], s2: ["a"] });
  });

  it("przeniesienie do sekcji JEDNOKOLUMNOWEJ czyści przypisanie kolumny", () => {
    // Zostawione „col: 1" sprawiłoby, że kanwa pominie widget i operator
    // zobaczy, że element zniknął po upuszczeniu.
    const d = doc([section("s1", [w("a", 1)], { layout: "1-1" }), section("s2")]);

    const next = rules.moveWidget(d, "a", { sectionId: "s2", col: 1, overWidgetIdx: null });

    expect(next.sections[1]!.widgets[0]!.col).toBeUndefined();
    expect(next.sections[0]!.widgets).toHaveLength(0);
  });

  it("cel BEZ sekcji nie rusza dokumentu - widget nie ginie", () => {
    const d = doc([section("s1", [w("a")])]);

    expect(rules.moveWidget(d, "a", { sectionId: null, col: null, overWidgetIdx: null })).toBe(d);
    expect(d.sections[0]!.widgets).toHaveLength(1);
  });

  it("nieznana sekcja docelowa nie rusza dokumentu", () => {
    const d = doc([section("s1", [w("a")])]);

    expect(rules.moveWidget(d, "a", { sectionId: "nie-ma", col: null, overWidgetIdx: 0 })).toBe(d);
    expect(layout(d)).toEqual({ s1: ["a"] });
  });

  it("nieznany widget przenoszony nie rusza dokumentu", () => {
    const d = doc([section("s1", [w("a")])]);

    expect(rules.moveWidget(d, "nie-ma", { sectionId: "s1", col: null, overWidgetIdx: 0 })).toBe(d);
    expect(d.sections[0]!.widgets).toHaveLength(1);
  });

  it("wskazany element, którego już nie ma w celu, oznacza koniec sekcji", () => {
    // Indeks może wskazywać widget, który po usunięciu ze źródła jest tym samym
    // przenoszonym elementem - wtedy wstawiamy na końcu, a nie w losowym miejscu.
    const d = doc([section("s1", [w("a")])]);

    const next = rules.moveWidget(d, "a", { sectionId: "s1", col: null, overWidgetIdx: 0 });

    expect(layout(next)).toEqual({ s1: ["a"] });
    expect(next.sections[0]!.widgets).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("styl okna popupu", () => {
  it("patch dokłada się do istniejącego stylu", () => {
    const d: NlDoc = { ...doc([section("s1")]), popup: { layout: "stacked", radius: 16 } };

    const next = rules.applyPopupStyle(d, { radius: 4 });

    expect(next.popup).toEqual({ layout: "stacked", radius: 4 });
    expect(d.popup).toEqual({ layout: "stacked", radius: 16 });
  });

  it("dokument BEZ bloku stylu dostaje go przy pierwszym patchu", () => {
    const d = doc([section("s1")]);

    expect(rules.applyPopupStyle(d, { bg: "#000" }).popup).toEqual({ bg: "#000" });
    expect(d.popup).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("szerokość podglądu i podpisy", () => {
  it("popup na desktopie ma szerokość produkcyjną, a układ z grafiką - szerszą", () => {
    expect(rules.canvasWidthFor("popup", "desktop", "stacked")).toBe(520);
    expect(rules.canvasWidthFor("popup", "desktop", "split")).toBe(880);
    expect(rules.canvasWidthFor("popup", "desktop", "showcase")).toBe(880);
  });

  it("popup na tablecie i telefonie ma stałe szerokości niezależne od układu", () => {
    expect(rules.canvasWidthFor("popup", "tablet", "split")).toBe(560);
    expect(rules.canvasWidthFor("popup", "mobile", "split")).toBe(360);
  });

  it("formularz inline na desktopie zajmuje CAŁĄ szerokość", () => {
    // Stała szerokość znaczyłaby, że operator układa treść na innej szerokości,
    // niż zobaczy odbiorca.
    expect(rules.canvasWidthFor("inline", "desktop", null)).toBe("100%");
    expect(rules.canvasWidthFor("inline", "tablet", null)).toBe(720);
    expect(rules.canvasWidthFor("inline", "mobile", null)).toBe(380);
  });

  it("nazwy urządzeń są takie same w obu językach", () => {
    expect(rules.deviceLabel("desktop")).toBe("Desktop");
    expect(rules.deviceLabel("tablet")).toBe("Tablet");
    expect(rules.deviceLabel("mobile")).toBe("Mobile");
  });

  it("podpis szerokości podaje piksele albo mówi, że to pełna szerokość", () => {
    expect(rules.canvasSizeLabel(520, "pl")).toBe("520px");
    expect(rules.canvasSizeLabel("100%", "pl")).toBe("pelna szerokosc");
    expect(rules.canvasSizeLabel("100%", "en")).toBe("full width");
  });
});

// ---------------------------------------------------------------------------
describe("zaczep pierwszego dokumentu z ustawień", () => {
  const settings = defaultNewsletterSettings();

  it("przepisuje treść z ustawień do zaczepu", () => {
    const seed = rules.docSeedFromSettings("inline", {
      ...settings,
      heading_pl: "Nagłówek",
      heading_en: "Heading",
      description_pl: "Opis",
      description_en: "Description",
    });

    expect(seed.heading).toEqual({ pl: "Nagłówek", en: "Heading" });
    expect(seed.description).toEqual({ pl: "Opis", en: "Description" });
  });

  it("KLAUZULA RODO trafia do zaczepu w obu wariantach", () => {
    // Bez tego przepisania operator zaczyna od formularza bez informacji o
    // przetwarzaniu danych i najczęściej tego nie zauważy.
    const withPolicy = {
      ...settings,
      policy_html_pl: "<p>Informacja</p>",
      policy_html_en: "<p>Notice</p>",
    };

    expect(rules.docSeedFromSettings("inline", withPolicy).policyHtml).toEqual({
      pl: "<p>Informacja</p>",
      en: "<p>Notice</p>",
    });
    expect(rules.docSeedFromSettings("popup", withPolicy).policyHtml).toEqual({
      pl: "<p>Informacja</p>",
      en: "<p>Notice</p>",
    });
  });

  it("wariant INLINE nie bierze etykiety przycisku z popupu", () => {
    const seed = rules.docSeedFromSettings("inline", {
      ...settings,
      popup_cta_pl: "Popupowy",
      popup_cta_en: "Popup",
    });

    expect(seed.submitLabel).toEqual({ pl: "Zapisz sie", en: "Subscribe" });
    // Wariant inline nie dostaje też stylu okna popupu.
    expect(seed.popupStyle).toBeUndefined();
  });

  it("wariant POPUP bierze etykietę przycisku z ustawień popupu", () => {
    const seed = rules.docSeedFromSettings("popup", {
      ...settings,
      popup_cta_pl: "Zapisuję się",
      popup_cta_en: "Sign me up",
    });

    expect(seed.submitLabel).toEqual({ pl: "Zapisuję się", en: "Sign me up" });
    // Etykieta popupu wygrywa nad etykietą formularza inline.
    expect(seed.submitLabel).not.toEqual({ pl: "Zapisz sie", en: "Subscribe" });
  });

  it("okładka, zgoda i styl okna są WYŁĄCZNIE popupowe", () => {
    const full = {
      ...settings,
      popup_cover_url: "https://example.test/cover.png",
      popup_require_terms: true,
      popup_terms_html_pl: "<p>Zgoda</p>",
      popup_terms_html_en: "<p>Consent</p>",
    };

    const inline = rules.docSeedFromSettings("inline", full);
    expect(inline).toMatchObject({ coverUrl: null, requireTerms: false, popupStyle: undefined });
    expect(inline.termsHtml).toEqual({ pl: null, en: null });
  });

  it("popup przenosi okładkę i treść zgody", () => {
    const seed = rules.docSeedFromSettings("popup", {
      ...settings,
      popup_cover_url: "https://example.test/cover.png",
      popup_require_terms: true,
      popup_terms_html_pl: "<p>Zgoda</p>",
      popup_terms_html_en: "<p>Consent</p>",
    });

    expect(seed).toMatchObject({
      coverUrl: "https://example.test/cover.png",
      requireTerms: true,
    });
    expect(seed.termsHtml).toEqual({ pl: "<p>Zgoda</p>", en: "<p>Consent</p>" });
  });

  it("wyłączona zgoda w popupie nie tworzy checkboxa mimo obecnej treści", () => {
    const seed = rules.docSeedFromSettings("popup", {
      ...settings,
      popup_require_terms: false,
      popup_terms_html_pl: "<p>Zgoda</p>",
      popup_terms_html_en: null,
    });

    expect(seed.requireTerms).toBe(false);
    expect(buildDefaultDoc("popup", seed).sections[0]!.widgets.map((x) => x.type)).not.toContain(
      "field.checkbox",
    );
  });

  it("styl okna przenosi WSZYSTKIE kolory, promień, układ i grafikę boczną", () => {
    const seed = rules.docSeedFromSettings("popup", {
      ...settings,
      popup_bg_color: "#0a0a0a",
      popup_text_color: "#ffffff",
      popup_muted_color: "#888888",
      popup_accent_color: "#f97316",
      popup_accent_text_color: "#000000",
      popup_overlay_color: "rgba(0,0,0,0.7)",
      popup_border_radius_px: 24,
      popup_layout: "split",
      popup_side_image_url: "https://example.test/side.png",
    });

    expect(seed.popupStyle).toEqual({
      bg: "#0a0a0a",
      fg: "#ffffff",
      muted: "#888888",
      accent: "#f97316",
      accentFg: "#000000",
      overlay: "rgba(0,0,0,0.7)",
      radius: 24,
      layout: "split",
      sideImage: "https://example.test/side.png",
    });
    // Promień jest liczbą, nie napisem z „px" - renderer dokłada jednostkę sam.
    expect(typeof seed.popupStyle!.radius).toBe("number");
  });

  it("zaczep składa się w dokument, który przechodzi walidację", () => {
    const seed = rules.docSeedFromSettings("popup", {
      ...settings,
      popup_require_terms: true,
      popup_terms_html_pl: "<p>Zgoda</p>",
      popup_terms_html_en: "<p>Consent</p>",
      policy_html_pl: "<p>Informacja</p>",
      policy_html_en: "<p>Notice</p>",
    });

    const built = buildDefaultDoc("popup", seed);
    const types = built.sections[0]!.widgets.map((x) => x.type);

    expect(types).toContain("field.checkbox");
    expect(types).toContain("field.email");
  });
});
