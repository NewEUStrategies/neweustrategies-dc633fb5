// Trzy edytory list „karuzelowych": karuzela okrężna, karuzela z paskiem
// postępu i chmura logo. Wspólny kontrakt, który tu przypinamy:
//
//  1. LISTA. Dodanie dopisuje NA KOŃCU element z kompletem kluczy obu języków
//     (pozycja dodana w EN nie może zostawić polskiej wersji bez tytułu),
//     strzałki zamieniają SĄSIADÓW, a na krańcach listy nie zapisują niczego
//     (brak pustego kroku historii), usunięcie zabiera wskazany element.
//     Edycja pola pisze klucz języka panelu i nie rusza reszty elementu.
//  2. CZAS / PRĘDKOŚĆ. Panel pokazuje wartość PO klamrze renderera (1000-30000
//     ms, 8-180 s) i nie walczy z pisaniem: wyczyszczenie pola nie wpisuje
//     wartości domyślnej, a liczba spoza zakresu klampuje się dopiero przy
//     zatwierdzeniu. Wcześniej panel pokazywał np. 50 ms, a strona kręciła
//     co sekundę.
//  3. PRZEŁĄCZNIKI czytane jak w widoku (`getBool`): "false" / 0 z importu to
//     wyłączone - wcześniej panel pokazywał je jako włączone.
//
// Granice: i18n jako atrapa echa klucza (asercje widzą klucz i parametry),
// react-query z pomocnika repo. Reszta (atomy, schemat, klamry) jest prawdziwa.
import { describe, it, expect, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { CircularCarouselEditor } from "../CircularCarouselEditor";
import { ProgressCarouselEditor } from "../ProgressCarouselEditor";
import { LogoCloudEditor } from "../LogoCloudEditor";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

type Editor = (props: {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}) => ReactNode;

/** Oprawa ze stanem: zapis wraca do edytora jak na kanwie. */
function renderStateful(Editor: Editor, initial: WidgetNode["content"], lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetNode["content"]>(initial);
    return (
      <Editor
        c={content}
        lang={lang}
        setContent={(k, v) => {
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

/** `PropField` nie wiąże etykiety z kontrolką - szukamy w jej opakowaniu. */
function fieldsOf(label: string): Array<HTMLInputElement | HTMLTextAreaElement> {
  return screen
    .getAllByText(label, { selector: "label" })
    .map((el) => el.parentElement?.querySelector<HTMLInputElement>("input, textarea"))
    .filter((el): el is HTMLInputElement => !!el);
}

const LISTS = [
  {
    name: "karuzela okrężna",
    Editor: CircularCarouselEditor,
    key: "items",
    seed: [
      { id: "a", title_pl: "A", title_en: "A-en" },
      { id: "b", title_pl: "B", title_en: "B-en" },
      { id: "c", title_pl: "C", title_en: "C-en" },
    ],
    added: {
      id: "card-4",
      href: "",
      tag_pl: "",
      tag_en: "",
      title_pl: "Karta 4",
      title_en: "Card 4",
      desc_pl: "",
      desc_en: "",
    },
  },
  {
    name: "karuzela z postępem",
    Editor: ProgressCarouselEditor,
    key: "items",
    seed: [
      { value: "a", title_pl: "A" },
      { value: "b", title_pl: "B" },
      { value: "c", title_pl: "C" },
    ],
    added: {
      value: "slide-4",
      img: "",
      href: "",
      title_pl: "Slajd 4",
      title_en: "Slide 4",
      desc_pl: "",
      desc_en: "",
    },
  },
  {
    name: "chmura logo",
    Editor: LogoCloudEditor,
    key: "logos",
    seed: [{ label: "A" }, { label: "B" }, { label: "C" }],
    added: { label: "Brand 4", src: "", href: "", alt: "" },
  },
] as const;

const order = (value: Json | undefined): unknown[] =>
  ((value ?? []) as Array<Record<string, unknown>>).map((x) => x.id ?? x.value ?? x.label);

describe.each(LISTS)("$name - lista", ({ Editor, key, seed, added }) => {
  const content = (): WidgetNode["content"] => ({ [key]: seed.map((x) => ({ ...x })) });

  it("sam render niczego nie zapisuje", () => {
    const { written } = renderStateful(Editor, content());
    expect(written).toEqual([]);
  });

  it("dodanie dopisuje na końcu element z kluczami obu języków", () => {
    const { last } = renderStateful(Editor, content(), "en");
    fireEvent.click(screen.getByRole("button", { name: /common\.add/ }));
    const list = last(key) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(4);
    expect(list.slice(0, 3)).toEqual(seed);
    expect(list[3]).toEqual(added);
  });

  // Identyfikator elementu: `id` / `value` w karuzelach, nazwa w chmurze logo.
  const ids = (...letters: string[]) => letters.map((x) => (key === "logos" ? x.toUpperCase() : x));

  it("strzałka w dół zamienia element z następnym, w górę - z poprzednim", () => {
    const { last } = renderStateful(Editor, content());
    fireEvent.click(screen.getAllByRole("button", { name: "↓" })[0]!);
    expect(order(last(key))).toEqual(ids("b", "a", "c"));
    fireEvent.click(screen.getAllByRole("button", { name: "↑" })[2]!);
    expect(order(last(key))).toEqual(ids("b", "c", "a"));
  });

  it("strzałki na krańcach listy nie zapisują niczego", () => {
    const { written } = renderStateful(Editor, content());
    fireEvent.click(screen.getAllByRole("button", { name: "↑" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "↓" }).at(-1)!);
    expect(written).toEqual([]);
  });

  it("usunięcie zabiera wskazany element, nie pierwszy", () => {
    const { last } = renderStateful(Editor, content());
    fireEvent.click(screen.getAllByRole("button", { name: "builder.common.delete" })[1]!);
    expect(order(last(key))).toEqual(ids("a", "c"));
  });

  it("pusta lista pokazuje stan pusty zamiast ramek", () => {
    renderStateful(Editor, { [key]: "nie-tablica" });
    expect(screen.getByText("builder.listShell.empty")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "builder.common.delete" })).toBeNull();
  });
});

describe("edycja pól elementu pisze klucz języka panelu i nie rusza reszty", () => {
  it("karuzela okrężna: tag, tytuł, opis i link karty w EN", () => {
    const { last } = renderStateful(
      CircularCarouselEditor,
      { items: [{ id: "a", title_pl: "Tytuł", title_en: "Title", tag_pl: "Tag" }] },
      "en",
    );
    fireEvent.change(fieldsOf("builder.circularCarouselEditor.tag(lang=EN)")[0]!, {
      target: { value: "Badge" },
    });
    fireEvent.change(fieldsOf("builder.circularCarouselEditor.title(lang=EN)")[0]!, {
      target: { value: "New title" },
    });
    fireEvent.change(fieldsOf("builder.circularCarouselEditor.desc(lang=EN)")[0]!, {
      target: { value: "Opis EN" },
    });
    fireEvent.change(fieldsOf("builder.circularCarouselEditor.href")[0]!, {
      target: { value: "/raport" },
    });
    expect(last("items")).toEqual([
      {
        id: "a",
        title_pl: "Tytuł",
        title_en: "New title",
        tag_pl: "Tag",
        tag_en: "Badge",
        desc_en: "Opis EN",
        href: "/raport",
      },
    ]);
  });

  it("karuzela z postępem: obraz, tytuł, opis i link slajdu w PL", () => {
    const { last } = renderStateful(ProgressCarouselEditor, {
      items: [{ value: "s1", title_en: "Bridge" }],
    });
    fireEvent.change(fieldsOf("builder.progressCarouselEditor.img")[0]!, {
      target: { value: "https://cdn.test/a.jpg" },
    });
    fireEvent.change(fieldsOf("builder.progressCarouselEditor.title(lang=PL)")[0]!, {
      target: { value: "Most" },
    });
    fireEvent.change(fieldsOf("builder.progressCarouselEditor.desc(lang=PL)")[0]!, {
      target: { value: "Opis" },
    });
    fireEvent.change(fieldsOf("builder.progressCarouselEditor.href")[0]!, {
      target: { value: "/most" },
    });
    expect(last("items")).toEqual([
      {
        value: "s1",
        title_en: "Bridge",
        img: "https://cdn.test/a.jpg",
        title_pl: "Most",
        desc_pl: "Opis",
        href: "/most",
      },
    ]);
  });

  it("chmura logo: nazwa, adres logo, link i tekst alternatywny", () => {
    const { last } = renderStateful(LogoCloudEditor, { logos: [{ label: "Alfa" }] });
    fireEvent.change(fieldsOf("builder.logoCloudEditor.label")[0]!, {
      target: { value: "Alfa SA" },
    });
    fireEvent.change(fieldsOf("builder.logoCloudEditor.src")[0]!, {
      target: { value: "https://cdn.test/alfa.svg" },
    });
    fireEvent.change(fieldsOf("builder.logoCloudEditor.href")[0]!, {
      target: { value: "https://alfa.test" },
    });
    fireEvent.change(fieldsOf("builder.logoCloudEditor.alt")[0]!, {
      target: { value: "Logo Alfa" },
    });
    expect(last("logos")).toEqual([
      {
        label: "Alfa SA",
        src: "https://cdn.test/alfa.svg",
        href: "https://alfa.test",
        alt: "Logo Alfa",
      },
    ]);
  });

  it.each([
    ["karuzela okrężna", CircularCarouselEditor, "builder.circularCarouselEditor.heading(lang=EN)"],
    [
      "karuzela z postępem",
      ProgressCarouselEditor,
      "builder.progressCarouselEditor.heading(lang=EN)",
    ],
    ["chmura logo", LogoCloudEditor, "builder.logoCloudEditor.heading(lang=EN)"],
  ] as const)("%s: nagłówek zapisuje się pod kluczem języka panelu", (_n, Editor, label) => {
    const { written } = renderStateful(Editor, { heading_pl: "Partnerzy" }, "en");
    fireEvent.change(fieldsOf(label)[0]!, { target: { value: "Partners" } });
    expect(written).toEqual([["heading_en", "Partners"]]);
  });
});

describe("czas i prędkość: panel pokazuje wartość po klamrze renderera", () => {
  const TIMINGS = [
    {
      name: "interwał karuzeli okrężnej",
      Editor: CircularCarouselEditor,
      key: "autoPlayInterval",
      label: "builder.circularCarouselEditor.interval",
      fallback: "4000",
      below: [50, "1000"],
      above: [99_999, "30000"],
      typed: "2500",
    },
    {
      name: "czas slajdu karuzeli z postępem",
      Editor: ProgressCarouselEditor,
      key: "duration",
      label: "builder.progressCarouselEditor.duration",
      fallback: "5000",
      below: [10, "1000"],
      above: [60_000, "30000"],
      typed: "7000",
    },
    {
      name: "prędkość chmury logo",
      Editor: LogoCloudEditor,
      key: "speedSeconds",
      label: "builder.logoCloudEditor.speed",
      fallback: "40",
      below: [3, "8"],
      above: [900, "180"],
      typed: "60",
    },
  ] as const;

  describe.each(TIMINGS)("$name", ({ Editor, key, label, fallback, below, above, typed }) => {
    const input = () => screen.getByRole("textbox", { name: label }) as HTMLInputElement;

    it("bez wartości pokazuje domyślną renderera", () => {
      renderStateful(Editor, {});
      expect(input().value).toBe(fallback);
    });

    it.each([
      ["za małą", below],
      ["za dużą", above],
    ] as const)("%s wartość z dokumentu pokazuje po klamrze", (_l, [raw, shown]) => {
      const { written } = renderStateful(Editor, { [key]: raw });
      expect(input().value).toBe(shown);
      // Sam odczyt nie poprawia dokumentu - to robi dopiero redakcja.
      expect(written).toEqual([]);
    });

    it("wartość w zakresie zapisuje się od razu jako liczba", () => {
      const { written } = renderStateful(Editor, {});
      fireEvent.focus(input());
      fireEvent.change(input(), { target: { value: typed } });
      expect(written).toEqual([[key, Number(typed)]]);
    });

    it("wyczyszczenie pola nie wpisuje wartości domyślnej, a blur przywraca dokument", () => {
      const { written } = renderStateful(Editor, { [key]: Number(typed) });
      fireEvent.focus(input());
      fireEvent.change(input(), { target: { value: "" } });
      expect(input().value).toBe("");
      fireEvent.blur(input());
      expect(input().value).toBe(typed);
      expect(written).toEqual([]);
    });

    it("liczba spoza zakresu klampuje się przy zatwierdzeniu", () => {
      const { written } = renderStateful(Editor, {});
      fireEvent.focus(input());
      fireEvent.change(input(), { target: { value: String(above[0]) } });
      // W trakcie pisania nic nie idzie do dokumentu - to może być dopiero
      // początek liczby.
      expect(written).toEqual([]);
      fireEvent.keyDown(input(), { key: "Enter" });
      expect(written).toEqual([[key, Number(above[1])]]);
    });
  });
});

describe("przełączniki czytają treść tak jak widok", () => {
  const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

  it('karuzela okrężna: napis „false" i zero z importu to wyłączone', () => {
    renderStateful(CircularCarouselEditor, {
      autoPlay: "false",
      showDots: 0,
      showArrows: "no",
    });
    expect(box("builder.circularCarouselEditor.autoPlay").checked).toBe(false);
    expect(box("builder.circularCarouselEditor.showDots").checked).toBe(false);
    expect(box("builder.circularCarouselEditor.showArrows").checked).toBe(false);
    // Brak wartości = domyślnie włączone, jak w rendererze.
    expect(box("builder.circularCarouselEditor.showCounter").checked).toBe(true);
  });

  it("karuzela okrężna: klik zapisuje boolean pod właściwym kluczem", () => {
    const { written } = renderStateful(CircularCarouselEditor, {});
    fireEvent.click(box("builder.circularCarouselEditor.showCounter"));
    fireEvent.click(box("builder.circularCarouselEditor.autoPlay"));
    fireEvent.click(box("builder.circularCarouselEditor.showDots"));
    fireEvent.click(box("builder.circularCarouselEditor.showArrows"));
    expect(written).toEqual([
      ["showCounter", false],
      ["autoPlay", false],
      ["showDots", false],
      ["showArrows", false],
    ]);
  });

  it('karuzela z postępem: „true" włącza układ pionowy, „0" chowa opis', () => {
    const { written } = renderStateful(ProgressCarouselEditor, {
      vertical: "true",
      showDesc: "0",
    });
    expect(box("builder.progressCarouselEditor.vertical").checked).toBe(true);
    expect(box("builder.progressCarouselEditor.showDesc").checked).toBe(false);
    fireEvent.click(box("builder.progressCarouselEditor.vertical"));
    fireEvent.click(box("builder.progressCarouselEditor.showDesc"));
    expect(written).toEqual([
      ["vertical", false],
      ["showDesc", true],
    ]);
  });

  it("karuzela z postępem: domyślnie poziomo i z opisem", () => {
    renderStateful(ProgressCarouselEditor, {});
    expect(box("builder.progressCarouselEditor.vertical").checked).toBe(false);
    expect(box("builder.progressCarouselEditor.showDesc").checked).toBe(true);
  });

  it("chmura logo: trzy przełączniki domyślnie włączone, klik zapisuje false", () => {
    const { written } = renderStateful(LogoCloudEditor, {});
    for (const key of ["pauseOnHover", "fadeEdges", "grayscale"] as const) {
      const el = box(`builder.logoCloudEditor.${key}`);
      expect(el.checked).toBe(true);
      fireEvent.click(el);
    }
    expect(written).toEqual([
      ["pauseOnHover", false],
      ["fadeEdges", false],
      ["grayscale", false],
    ]);
  });
});
