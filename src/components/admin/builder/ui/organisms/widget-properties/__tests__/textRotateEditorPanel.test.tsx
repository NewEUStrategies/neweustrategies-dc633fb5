// TextRotateEditor: panel widgetu „Rotujący tekst" - co redakcja wpisuje i co
// z tego trafia do dokumentu.
//
// Reguły, które ten plik przypina:
//  1. Pole „Teksty (po jednym na linię)" musi dać się WPISAĆ, a nie tylko
//     wkleić. Dokument trzyma listę już przyciętą i bez pustych linii, więc
//     gdy pole pokazywało `lista.join("\n")`, Enter na końcu i spacja na końcu
//     słowa znikały przy każdym naciśnięciu - drugiej pozycji ani tekstu
//     z dwóch słów nie dało się napisać z klawiatury.
//  2. Zapisy idą pod klucze EDYTOWANEJ wersji językowej (`*_pl` / `*_en`),
//     a nie języka interfejsu.
//  3. Dziury i śmieci w treści (puste znaczniki, nie-napisy) nie wysypują
//     panelu i nie pokazują „[object Object]" - panel czyta je tak samo, jak
//     renderer publiczny (`SimpleWidgets`, `case "text-rotate"`).
//
// Atrapy: tylko Radix Select (happy-dom nie otwiera jego warstwy - patrz
// `radixSelectStub`). Słownik jest PRAWDZIWY (nakładka `i18n-builder`
// rejestruje się importem w komponencie), więc asercje mierzą napisy, które
// redakcja widzi w panelu.
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { TextRotateEditor } from "../TextRotateEditor";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

type Content = WidgetNode["content"];

/**
 * Panel w gospodarzu ze STANEM: zapis wraca do panelu jako nowa treść, tak jak
 * w builderze. Bez tego pole kontrolowane nigdy nie pokazałoby skutku zapisu,
 * a reguła 1 dotyczy właśnie tego powrotu.
 */
function renderEditor(initial: Content, lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<Content>(initial);
    return (
      <TextRotateEditor
        c={content}
        lang={lang}
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  const view = render(<Host />);
  const last = (key: string): Json | undefined => written.filter(([k]) => k === key).at(-1)?.[1];
  return { ...view, written, last };
}

/** Pole spod etykiety `PropField` (etykieta i kontrolka są rodzeństwem). */
function fieldUnder(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const box = screen.getByText(label, { selector: "label" }).parentElement;
  const field = box?.querySelector<HTMLInputElement>("input, textarea, select");
  if (!field) throw new Error(`test: brak pola pod etykietą „${label}"`);
  return field;
}

const textsField = (lang = "PL") =>
  fieldUnder(`Teksty (${lang}, po jednym na linię)`) as HTMLTextAreaElement;

afterEach(cleanup);

describe("TextRotateEditor - lista rotujących tekstów", () => {
  it("Enter na końcu ostatniej pozycji zostaje w polu i nie zmienia dokumentu", () => {
    const { written } = renderEditor({ texts_pl: ["szybko"] });
    const field = textsField();
    fireEvent.change(field, { target: { value: "szybko\n" } });
    // Pusta linia nie jest pozycją listy - dokument się nie zmienia, ale
    // redaktor MUSI widzieć nową linię, bo zaraz w niej pisze.
    expect(field.value).toBe("szybko\n");
    expect(written).toEqual([]);

    fireEvent.change(field, { target: { value: "szybko\nłatwo" } });
    expect(written.at(-1)).toEqual(["texts_pl", ["szybko", "łatwo"]]);
    expect(field.value).toBe("szybko\nłatwo");
  });

  it("spacja na końcu słowa nie znika - da się napisać tekst z dwóch słów", () => {
    const { last } = renderEditor({ texts_pl: [] });
    const field = textsField();
    fireEvent.change(field, { target: { value: "bez" } });
    fireEvent.change(field, { target: { value: "bez " } });
    expect(field.value).toBe("bez ");
    fireEvent.change(field, { target: { value: "bez barier" } });
    expect(last("texts_pl")).toEqual(["bez barier"]);
  });

  it("zapisuje pozycje przycięte, bez pustych linii", () => {
    const { last } = renderEditor({ texts_pl: [] });
    fireEvent.change(textsField(), { target: { value: "  szybko \n\n  łatwo\n" } });
    expect(last("texts_pl")).toEqual(["szybko", "łatwo"]);
  });

  it("zmiana treści z zewnątrz (np. cofnięcie) wypiera szkic redaktora", () => {
    // Szkic żyje tylko tak długo, jak znaczy TO SAMO co dokument. Gdy dokument
    // zmieni się spoza pola, pole musi pokazać dokument, a nie stary szkic.
    function Host() {
      const [content, setContent] = useState<Content>({ texts_pl: ["a"] });
      return (
        <>
          <button type="button" onClick={() => setContent({ texts_pl: ["x", "y"] })}>
            cofnij
          </button>
          <TextRotateEditor
            c={content}
            lang="pl"
            setContent={(k, v) => setContent((prev) => ({ ...prev, [k]: v }))}
          />
        </>
      );
    }
    render(<Host />);
    fireEvent.change(textsField(), { target: { value: "a\n" } });
    expect(textsField().value).toBe("a\n");
    fireEvent.click(screen.getByRole("button", { name: "cofnij" }));
    expect(textsField().value).toBe("x\ny");
  });

  it("starsza treść zapisana jednym napisem z liniami jest czytana jako lista", () => {
    renderEditor({ texts_pl: "szybko\n  łatwo \n\n" });
    expect(textsField().value).toBe("szybko\nłatwo");
  });

  it("wersja angielska bez własnej listy pokazuje polską, a zapis trafia do `texts_en`", () => {
    // Tak samo czyta renderer (`texts_en ?? texts_pl`) - panel pokazuje to, co
    // strona angielska faktycznie rotuje.
    const { last } = renderEditor({ texts_pl: ["szybko", 7 as unknown as string] }, "en");
    const field = textsField("EN");
    expect(field.value).toBe("szybko");
    fireEvent.change(field, { target: { value: "fast" } });
    expect(last("texts_en")).toEqual(["fast"]);
    expect(last("texts_pl")).toBeUndefined();
  });

  it("pusta lista daje podgląd z przykładowych słów edytowanej wersji językowej", () => {
    renderEditor({ texts_en: [], tag: "h3", before_en: "Build" }, "en");
    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading.textContent).toContain("Build");
    expect(heading.textContent).toContain("fast");
  });
});

describe("TextRotateEditor - tekst statyczny i kolory", () => {
  it("tekst przed i po zapisuje się pod kluczami edytowanej wersji językowej", () => {
    const { last } = renderEditor({ before_en: "Build", after_en: "" }, "en");
    fireEvent.change(fieldUnder("Przed (EN)"), { target: { value: "Grow" } });
    fireEvent.change(fieldUnder("Po (EN)"), { target: { value: "with us." } });
    expect(last("before_en")).toBe("Grow");
    expect(last("after_en")).toBe("with us.");
    expect(last("before_pl")).toBeUndefined();
    // Podgląd idzie za zapisem: tekst przed i po stoi w nagłówku.
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toMatch(/^Grow.*with us\.$/);
  });

  it("wartość nie-tekstowa w treści nie pokazuje „[object Object]”", () => {
    renderEditor({ before_pl: { x: 1 } as unknown as Json, after_pl: 5 as unknown as Json });
    expect((fieldUnder("Przed (PL)") as HTMLInputElement).value).toBe("");
    expect((fieldUnder("Po (PL)") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain("[object Object]");
  });

  it.each([
    ["Kolor tekstu statycznego", "color"],
    ["Kolor akcentu", "accentColor"],
  ])("„%s” zapisuje wpisany kolor, a wyczyszczony - PUSTY napis", (label, key) => {
    const { last } = renderEditor({ texts_pl: ["a"], color: "#111111", accentColor: "#222222" });
    const field = fieldUnder(label);
    fireEvent.change(field, { target: { value: "#123456" } });
    expect(last(key)).toBe("#123456");
    // Pusty napis to „bez nadpisania". `undefined` zniknąłby przy zapisie
    // dokumentu, a widget zostałby ze starym kolorem.
    fireEvent.change(field, { target: { value: "" } });
    expect(last(key)).toBe("");
  });

  it("brak koloru akcentu pokazuje domyślny pomarańcz, a statyczny zostaje pusty", () => {
    const { container } = renderEditor({ texts_pl: ["a"] });
    const accent = container.querySelector<HTMLElement>("span.inline-block[style]");
    expect(accent?.style.color.toLowerCase()).toMatch(/^(#fa9346|rgb\(250, 147, 70\))$/);
    expect(screen.getByRole("heading", { level: 2 }).getAttribute("style")).toBeNull();
  });
});

describe("TextRotateEditor - znacznik, wyrównanie i animacja", () => {
  it.each([
    ["Znacznik HTML", "tag", "h4"],
    ["Wyrównanie", "align", "right"],
    ["Podział", "splitBy", "words"],
    ["Kierunek staggeru", "staggerFrom", "center"],
  ])("lista „%s” zapisuje wybraną opcję pod kluczem %s", (label, key, value) => {
    const { last } = renderEditor({ texts_pl: ["a"] });
    fireEvent.change(fieldUnder(label), { target: { value } });
    expect(last(key)).toBe(value);
  });

  it("wybrany znacznik zmienia poziom nagłówka w podglądzie", () => {
    renderEditor({ texts_pl: ["a"] });
    fireEvent.change(fieldUnder("Znacznik HTML"), { target: { value: "h5" } });
    expect(screen.getByRole("heading", { level: 5 })).toBeTruthy();
  });

  it("pusty znacznik w treści nie wysypuje panelu - podgląd bierze H2 jak renderer", () => {
    // `getStr(c, "tag") || "h2"` w rendererze - pusty napis to „nie ustawiono".
    // Panel czytał go dosłownie i próbował utworzyć element o pustej nazwie.
    renderEditor({ texts_pl: ["a"], tag: "", align: "", splitBy: "", staggerFrom: "" });
    expect(screen.getByRole("heading", { level: 2 })).toBeTruthy();
    expect((fieldUnder("Znacznik HTML") as HTMLSelectElement).value).toBe("h2");
    expect((fieldUnder("Wyrównanie") as HTMLSelectElement).value).toBe("left");
    expect((fieldUnder("Podział") as HTMLSelectElement).value).toBe("characters");
    expect((fieldUnder("Kierunek staggeru") as HTMLSelectElement).value).toBe("first");
  });

  it.each([
    ["Pętla", "loop"],
    ["Auto-rotacja", "auto"],
  ])("„%s” zapisuje wartość logiczną, a brak klucza znaczy „tak”", (label, key) => {
    const { last } = renderEditor({ texts_pl: ["a"] });
    const select = fieldUnder(label) as HTMLSelectElement;
    expect(select.value).toBe("on");
    fireEvent.change(select, { target: { value: "off" } });
    expect(last(key)).toBe(false);
    fireEvent.change(select, { target: { value: "on" } });
    expect(last(key)).toBe(true);
  });

  it.each([
    ["Interwał (ms)", "rotationInterval", "3000", 3000, 2200],
    ["Czas animacji (ms)", "transitionMs", "600", 600, 450],
    // Stagger 0 to POPRAWNE ustawienie (wszystkie znaki naraz) - pusta wartość
    // nie może wracać do 30 ms.
    ["Stagger (ms)", "staggerDurationMs", "45", 45, 0],
  ])(
    "pole „%s” zapisuje liczbę, a pustka lub śmieci wracają do %s",
    (label, key, typed, expected, fallback) => {
      const { last } = renderEditor({ texts_pl: ["a"] });
      const field = fieldUnder(label);
      fireEvent.change(field, { target: { value: typed } });
      expect(last(key)).toBe(expected);
      fireEvent.change(field, { target: { value: "" } });
      expect(last(key)).toBe(fallback);
      expect(Number.isNaN(last(key) as number)).toBe(false);
    },
  );

  it("liczby zapisane w treści pokazują się w polach, brak klucza - wartości domyślne", () => {
    renderEditor({ texts_pl: ["a"], rotationInterval: 5000 });
    expect((fieldUnder("Interwał (ms)") as HTMLInputElement).value).toBe("5000");
    expect((fieldUnder("Stagger (ms)") as HTMLInputElement).value).toBe("30");
    expect((fieldUnder("Czas animacji (ms)") as HTMLInputElement).value).toBe("450");
  });
});
