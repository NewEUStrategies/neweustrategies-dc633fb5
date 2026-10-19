// Dwa panele, w których zapis zależy od drobnych reguł odczytu:
//
//  1. ETYKIETA SEKCJI - pola rozmiaru („14px", „1.5rem", puste = auto).
//     Strzałki krokują liczbę o 1 i ZACHOWUJĄ jednostkę, trzymają się
//     zakresu pola (odstępy do 96, rozmiary do 200, minimum 6), a goła liczba
//     dostaje „px" dopiero przy wyjściu z pola - w trakcie pisania pole nie
//     może dopisywać jednostki pod kursorem.
//  2. MEGA MENU - kolumna. Rodzaj spoza listy jest kolumną linków (tak czyta
//     go `MegaMenu`); wcześniej panel nie pokazywał dla niej ŻADNYCH pól.
//     Liczba wpisów kolumny kategorii idzie przez tę samą klamrę 1-8 co
//     widok (liczba zapisana napisem też się liczy). Edycja nagłówka i linku
//     kolumny nie rusza jej identyfikatora ani rodzaju (NAPRAWIONE 2026-10-18).
//
// Granice: atrapy Radix Select/Switch, i18n jako echo klucza, Supabase
// (łańcuch z `@/test/supabaseChain`: kategorie i strony dla pickerów).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { SectionLabelEditor } from "../SectionLabelEditor";
import { MegaMenuEditor } from "../MegaMenuEditor";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.current.from(table) },
}));

type Editor = typeof SectionLabelEditor | typeof MegaMenuEditor;

function renderStateful(Editor: Editor, initial: WidgetNode["content"], lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetNode["content"]>(initial);
    return (
      <Editor
        c={content}
        lang={lang}
        setContent={(k: string, v: Json) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  const view = renderWithQueryClient(<Host />);
  const last = (key: string) => written.filter(([k]) => k === key).at(-1)?.[1];
  return { ...view, written, last };
}

/** Opakowanie pola o danej etykiecie (`PropField` nie wiąże etykiety). */
const wrapperOf = (label: string): HTMLElement => {
  const el = screen.getAllByText(label, { selector: "label" })[0]?.parentElement;
  if (!el) throw new Error(`test: brak pola „${label}"`);
  return el;
};

beforeEach(() => {
  db.current = supabaseFromStub();
  db.current.setResponse(
    "categories",
    ok([
      { slug: "gospodarka", name_pl: "Gospodarka" },
      { slug: "energia", name_pl: "Energia" },
    ]),
  );
  db.current.setResponse("pages", (chain) =>
    chain.has("maybeSingle")
      ? ok(null)
      : ok([{ id: "pg-1", slug: "o-nas", title_pl: "O nas", title_en: "About" }]),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("SectionLabelEditor - pola rozmiaru", () => {
  const sizeField = (label: string) => {
    const box = wrapperOf(label);
    return {
      input: box.querySelector<HTMLInputElement>("input")!,
      up: within(box).getByRole("button", { name: "builder.sectionLabelEditor.increase" }),
      down: within(box).getByRole("button", { name: "builder.sectionLabelEditor.decrease" }),
    };
  };

  it("strzałka w górę dodaje 1 i zachowuje jednostkę px", () => {
    const { written } = renderStateful(SectionLabelEditor, { gapX: "14px" });
    fireEvent.click(sizeField("builder.sectionLabelEditor.gapX").up);
    expect(written).toEqual([["gapX", "15px"]]);
  });

  // NAPRAWIONE 2026-10-18: zakres pola (px) był przykładany do każdej
  // jednostki, więc „1.5rem" + 1 dawało „6rem" (minimum 6 jako 6 rem = 96 px),
  // a w dół z „1rem" - też „6rem". Teraz rem/em/% krokują o 1 bez klamry px
  // (tylko nie poniżej zera).
  it.each([
    ["w górę", "1.5rem", "up", "2.5rem"],
    ["w dół", "1rem", "down", "0rem"],
    ["w dół poniżej zera", "0.5em", "down", "0em"],
    ["w górę ponad zakres px", "150%", "up", "151%"],
  ] as const)("jednostka względna: krok %s nie przykłada zakresu px", (_l, start, dir, saved) => {
    const { written } = renderStateful(SectionLabelEditor, { gapX: start });
    fireEvent.click(sizeField("builder.sectionLabelEditor.gapX")[dir]);
    expect(written).toEqual([["gapX", saved]]);
  });

  it("bez wartości strzałki liczą od 12 px", () => {
    const { written } = renderStateful(SectionLabelEditor, {});
    fireEvent.click(sizeField("builder.sectionLabelEditor.gapY").down);
    expect(written).toEqual([["gapY", "11px"]]);
  });

  it.each([
    ["odstęp poziomy", "builder.sectionLabelEditor.gapX", "gapX", "96px", "96px"],
    ["rozmiar etykiety", "builder.sectionLabelEditor.size16", "labelSize", "200px", "200px"],
  ] as const)("%s nie wychodzi ponad maksimum pola", (_l, label, key, start, saved) => {
    const { written } = renderStateful(SectionLabelEditor, { [key]: start });
    fireEvent.click(sizeField(label).up);
    expect(written).toEqual([[key, saved]]);
  });

  it('minimum 6: strzałka w dół z „6px" zostaje na 6px', () => {
    const { written } = renderStateful(SectionLabelEditor, { actionSize: "6px" });
    fireEvent.click(sizeField("builder.sectionLabelEditor.size12").down);
    expect(written).toEqual([["actionSize", "6px"]]);
  });

  it('goła liczba zapisuje się w trakcie pisania bez jednostki, a „px" dochodzi przy wyjściu', () => {
    const { written } = renderStateful(SectionLabelEditor, {});
    const { input } = sizeField("builder.sectionLabelEditor.gapX");
    fireEvent.change(input, { target: { value: "14" } });
    expect(written).toEqual([["gapX", "14"]]);
    fireEvent.blur(input);
    expect(written).toEqual([
      ["gapX", "14"],
      ["gapX", "14px"],
    ]);
    expect(input.value).toBe("14px");
  });

  it("wartość z jednostką i puste pole nie są ruszane przy wyjściu", () => {
    const { written } = renderStateful(SectionLabelEditor, { gapX: "2rem" });
    const { input } = sizeField("builder.sectionLabelEditor.gapX");
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(written).toEqual([["gapX", ""]]);
  });
});

describe("MegaMenuEditor - kolumna czytana jak w widoku", () => {
  const LINKS = [{ label_pl: "Pierwszy", label_en: "First", href: "/raz" }];
  const kindSelect = () => {
    const found = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
      s.querySelector('option[value="category"]'),
    );
    if (!found) throw new Error("test: brak listy rodzaju kolumny");
    return found;
  };

  it('nieznany rodzaj kolumny pokazuje pola linków i wybraną opcję „links"', () => {
    renderStateful(MegaMenuEditor, { columns: [{ id: "c-1", kind: "mozaika", links: LINKS }] });
    expect(kindSelect().value).toBe("links");
    expect(screen.getByText("builder.megaMenuEditor.links")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pierwszy")).toBeInTheDocument();
  });

  it.each([
    ['napis „6"', "6", "6"],
    ["za duża", 20, "8"],
    ["zero", 0, "4"],
    ["brak", undefined, "4"],
  ] as const)("liczba wpisów kolumny kategorii: %s pokazuje to, co widok", (_l, raw, shown) => {
    renderStateful(MegaMenuEditor, {
      columns: [
        {
          id: "c-2",
          kind: "category",
          categorySlug: "gospodarka",
          ...(raw === undefined ? {} : { postCount: raw }),
        },
      ],
    });
    const count = wrapperOf("builder.megaMenuEditor.postCount").querySelector("input")!;
    expect(count.value).toBe(shown);
  });

  it("nagłówek kolumny zapisuje klucz języka i zostawia identyfikator i rodzaj", () => {
    const { last } = renderStateful(
      MegaMenuEditor,
      { columns: [{ id: "c-1", kind: "links", title_pl: "Usługi", links: LINKS }] },
      "en",
    );
    const heading = wrapperOf("builder.megaMenuEditor.columnHeading(lang=EN)").querySelector(
      "input",
    )!;
    fireEvent.change(heading, { target: { value: "Services" } });
    expect(last("columns")).toEqual([
      { id: "c-1", kind: "links", title_pl: "Usługi", title_en: "Services", links: LINKS },
    ]);
  });

  it("link nagłówka: własny URL i wybór strony z pickera zapisują ścieżkę", async () => {
    const { last } = renderStateful(MegaMenuEditor, { columns: [{ id: "c-1", links: LINKS }] });
    const box = wrapperOf("builder.megaMenuEditor.headerLink");
    fireEvent.change(within(box).getByPlaceholderText("lub własny URL (np. /o-nas)"), {
      target: { value: "/kontakt" },
    });
    expect((last("columns") as Array<Record<string, unknown>>)[0]?.href).toBe("/kontakt");
    const search = within(box).getByPlaceholderText("builder.picker.bindPage");
    fireEvent.focus(search);
    fireEvent.click(await screen.findByRole("option", { name: /O nas/ }));
    expect((last("columns") as Array<Record<string, unknown>>)[0]?.href).toBe("/o-nas");
  });

  it('kolumna kategorii: wybór kategorii, liczby wpisów i linku „zobacz wszystko"', async () => {
    const { last } = renderStateful(MegaMenuEditor, {
      columns: [{ id: "c-2", kind: "category", categorySlug: "gospodarka", postCount: 4 }],
    });
    const category = await waitFor(() => {
      const found = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
        s.querySelector('option[value="energia"]'),
      );
      if (!found) throw new Error("test: kategorie jeszcze się nie wczytały");
      return found;
    });
    fireEvent.change(category, { target: { value: "energia" } });
    const count = wrapperOf("builder.megaMenuEditor.postCount").querySelector("input")!;
    fireEvent.change(count, { target: { value: "6" } });
    const viewAll = screen.getByPlaceholderText("/category/energia");
    fireEvent.change(viewAll, { target: { value: "/kategoria/energia" } });
    expect(last("columns")).toEqual([
      {
        id: "c-2",
        kind: "category",
        categorySlug: "energia",
        postCount: 6,
        viewAllHref: "/kategoria/energia",
      },
    ]);
  });

  it("usunięcie kolumny zabiera wskazaną, nie pierwszą", () => {
    const { last } = renderStateful(MegaMenuEditor, {
      columns: [
        { id: "c-1", links: LINKS },
        { id: "c-2", links: LINKS },
      ],
    });
    fireEvent.click(screen.getAllByRole("button", { name: "builder.common.delete" })[1]!);
    expect(last("columns")).toEqual([{ id: "c-1", links: LINKS }]);
  });

  it('zmiana rodzaju kolumny zapisuje „category" i pokazuje pola kategorii', () => {
    const { last } = renderStateful(MegaMenuEditor, { columns: [{ id: "c-1", links: LINKS }] });
    fireEvent.change(kindSelect(), { target: { value: "category" } });
    expect((last("columns") as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: "c-1",
      kind: "category",
    });
    expect(screen.getByText("builder.megaMenuEditor.postCount")).toBeInTheDocument();
  });
});
