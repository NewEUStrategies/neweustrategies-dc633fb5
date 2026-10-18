// AnimatedHeadingEditor: panel nagłówka animowanego - tryb, kształt, teksty,
// słowa rotacji i linki fragmentów.
//
// Reguły, które ten plik przypina:
//  1. Tryb wyznacza RODZINĘ kształtów (hover-podkreślenie, hover-ramka, reszta).
//     Zmiana trybu na rodzinę, do której bieżący kształt nie należy, musi
//     podmienić kształt na pierwszy z nowej rodziny - inaczej renderer
//     dostaje parę, której nie umie narysować, a panel nie pokazuje żadnego
//     zaznaczonego kafelka.
//  2. Słowa rotacji da się WPISAĆ (Enter, spacja na końcu) - te same zasady,
//     co w `LineListTextarea`. Starszy zapis jednym napisem z liniami (renderer
//     go czyta) panel też musi pokazać, bo inaczej wstawienie znacznika
//     dynamicznego nadpisywało niewidoczną listę jednym słowem.
//  3. Dziury i śmieci w treści czytane jak w rendererze: pusty znacznik/tryb
//     to „nie ustawiono", nie-napis w tekście to pustka - panel się nie wysypuje.
//
// Atrapy: Radix Select (happy-dom nie otwiera warstwy), `LinkPicker` (szuka
// wpisów w bazie przez react-query - ma własne testy w `pickers.test.tsx`)
// i `DynamicTagInserter` (popover z katalogiem znaczników). Z dwóch ostatnich
// zostaje tu tylko to, co panel z nimi robi: KTÓRY klucz dostaje wynik.
// Słownik jest PRAWDZIWY - asercje mierzą napisy, które widzi redakcja.
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { ANIMATED_SHAPES } from "@/lib/builder/animatedHeadingVariants";
import { AnimatedHeadingEditor } from "../AnimatedHeadingEditor";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("../../../molecules/DynamicTagInserter", () => ({
  DynamicTagInserter: ({ onInsert }: { onInsert: (token: string) => void }) => (
    <button type="button" data-testid="wstaw-znacznik" onClick={() => onInsert("{post.title}")} />
  ),
}));
vi.mock("../../../molecules/LinkPicker", () => ({
  LinkPicker: ({
    value,
    onChange,
  }: {
    value?: { url: string };
    onChange: (link: { url: string; kind: string } | undefined) => void;
  }) => (
    <span data-testid="link-picker" data-url={value?.url ?? ""}>
      <button type="button" onClick={() => onChange({ url: "/o-nas", kind: "page" })}>
        ustaw
      </button>
      <button type="button" onClick={() => onChange(undefined)}>
        usuń
      </button>
    </span>
  ),
}));

type Content = WidgetNode["content"];

function renderEditor(initial: Content, lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<Content>(initial);
    return (
      <AnimatedHeadingEditor
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

function fieldUnder(label: string): HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement {
  const box = screen.getByText(label, { selector: "label" }).parentElement;
  const field = box?.querySelector("input, textarea, select");
  if (!field) throw new Error(`test: brak pola pod etykietą „${label}"`);
  return field as HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement;
}

/** Kafelki kształtów: przyciski z `title` równym etykiecie kształtu. */
const shapeTitles = (): string[] => {
  const labels = new Set(ANIMATED_SHAPES.map((s) => s.label));
  return screen
    .getAllByRole("button")
    .map((b) => b.getAttribute("title") ?? "")
    .filter((title) => labels.has(title));
};
const labelsOf = (prefix: string) =>
  ANIMATED_SHAPES.filter((s) => s.value.startsWith(prefix)).map((s) => s.label);

/** Podgląd na żywo: nagłówek tuż pod podpisem „Podgląd na żywo". */
const livePreview = (): HTMLElement => {
  const box = screen.getByText("Podgląd na żywo").parentElement as HTMLElement;
  return within(box).getByRole("heading");
};

afterEach(cleanup);

describe("AnimatedHeadingEditor - tryb i rodzina kształtów", () => {
  it("tryb „hover - podkreślenie” pokazuje tylko kształty hover-line i podmienia bieżący", () => {
    const { written } = renderEditor({ mode: "highlight", shape: "circle" });
    fireEvent.change(fieldUnder("Tryb animacji"), { target: { value: "hover-underline" } });
    expect(written).toEqual([
      ["mode", "hover-underline"],
      ["shape", "hover-line-1"],
    ]);
    expect(shapeTitles()).toEqual(labelsOf("hover-line-"));
  });

  it("tryb „hover - ramka” pokazuje tylko kształty hover-allsides i podmienia bieżący", () => {
    const { written } = renderEditor({ mode: "highlight", shape: "underline" });
    fireEvent.change(fieldUnder("Tryb animacji"), { target: { value: "hover-allsides" } });
    expect(written).toEqual([
      ["mode", "hover-allsides"],
      ["shape", "hover-allsides-1"],
    ]);
    expect(shapeTitles()).toEqual(labelsOf("hover-allsides-"));
  });

  it("powrót z trybu hover do wyróżnienia wraca do zwykłego podkreślenia", () => {
    const { written } = renderEditor({ mode: "hover-underline", shape: "hover-line-3" });
    fireEvent.change(fieldUnder("Tryb animacji"), { target: { value: "highlight" } });
    expect(written).toEqual([
      ["mode", "highlight"],
      ["shape", "underline"],
    ]);
    const titles = shapeTitles();
    expect(titles).toContain("Okrąg");
    expect(titles.some((t) => labelsOf("hover-").includes(t))).toBe(false);
  });

  it("zmiana trybu w obrębie tej samej rodziny NIE rusza kształtu", () => {
    const { written } = renderEditor({ mode: "highlight", shape: "circle" });
    fireEvent.change(fieldUnder("Tryb animacji"), { target: { value: "rotate" } });
    expect(written).toEqual([["mode", "rotate"]]);
    // Ten sam warunek dla rodziny hover: hover-line-2 zostaje w trybie
    // hover-podkreślenia.
    cleanup();
    const hover = renderEditor({ mode: "hover-underline", shape: "hover-line-2" });
    fireEvent.change(fieldUnder("Tryb animacji"), { target: { value: "hover-underline" } });
    expect(hover.written).toEqual([["mode", "hover-underline"]]);
  });

  it("kliknięcie kafelka zapisuje kształt", () => {
    const { last } = renderEditor({ mode: "highlight", shape: "underline" });
    fireEvent.click(screen.getByRole("button", { name: /Zygzak/ }));
    expect(last("shape")).toBe("zigzag");
  });

  it("pusty tryb, kształt i znacznik czytane są jak w rendererze - panel się nie wysypuje", () => {
    renderEditor({ mode: "", shape: "", tag: "", align: "", highlight_pl: "nas" });
    expect(fieldUnder("Tryb animacji").value).toBe("highlight");
    expect(fieldUnder("Tag HTML").value).toBe("h2");
    expect(fieldUnder("Wyrównanie").value).toBe("left");
    expect(livePreview().tagName).toBe("H2");
  });
});

describe("AnimatedHeadingEditor - teksty i znaczniki dynamiczne", () => {
  it("teksty zapisują się pod kluczami edytowanej wersji językowej", () => {
    const { last } = renderEditor({ mode: "highlight" }, "en");
    fireEvent.change(fieldUnder("Przed tekstem (EN)"), { target: { value: "Join" } });
    fireEvent.change(fieldUnder("Tekst wyróżniony (EN)"), { target: { value: "us" } });
    fireEvent.change(fieldUnder("Za tekstem (EN)"), { target: { value: "today" } });
    expect(last("textBefore_en")).toBe("Join");
    expect(last("highlight_en")).toBe("us");
    expect(last("textAfter_en")).toBe("today");
    expect(last("textBefore_pl")).toBeUndefined();
    const preview = livePreview().textContent ?? "";
    expect(preview).toContain("Join");
    expect(preview).toContain("us");
    expect(preview).toContain("today");
  });

  it("nie-napis w tekście nie wysypuje panelu i nie pokazuje „[object Object]”", () => {
    renderEditor({
      mode: "highlight",
      textBefore_pl: { x: 1 } as unknown as Json,
      highlight_pl: 42 as unknown as Json,
    });
    expect(fieldUnder("Przed tekstem (PL)").value).toBe("");
    expect(fieldUnder("Tekst wyróżniony (PL)").value).toBe("");
    expect(document.body.textContent).not.toContain("[object Object]");
  });

  it("znacznik dynamiczny dokleja się ze spacją, chyba że tekst jest pusty lub kończy się spacją", () => {
    const { last } = renderEditor({ mode: "highlight", textBefore_pl: "Czytaj" });
    const [beforeTag, afterTag, highlightTag] = screen.getAllByTestId("wstaw-znacznik");
    fireEvent.click(beforeTag!);
    expect(last("textBefore_pl")).toBe("Czytaj {post.title}");
    fireEvent.click(afterTag!);
    expect(last("textAfter_pl")).toBe("{post.title}");
    fireEvent.change(fieldUnder("Tekst wyróżniony (PL)"), { target: { value: "o " } });
    fireEvent.click(highlightTag!);
    expect(last("highlight_pl")).toBe("o {post.title}");
  });

  it("podgląd pokazuje wartość znacznika z wpisu przykładowego, a nie surowy znacznik", () => {
    renderEditor({ mode: "highlight", textBefore_pl: "{post.title}", highlight_pl: "x" });
    expect(livePreview().textContent).toContain("Tytuł przykładowego wpisu");
    expect(livePreview().textContent).not.toContain("{post.title}");
  });
});

describe("AnimatedHeadingEditor - słowa rotacji", () => {
  const rotateField = (lang = "PL") =>
    fieldUnder(`Słowa do rotacji (${lang}) - jedno na linię`) as HTMLTextAreaElement;

  it("tryb rotacji zamienia pole wyróżnienia na listę słów", () => {
    renderEditor({ mode: "rotate", rotateWords_pl: ["szybko", "łatwo"] });
    expect(rotateField().value).toBe("szybko\nłatwo");
    expect(screen.queryByText("Tekst wyróżniony (PL)")).toBeNull();
  });

  it("Enter i spacja na końcu zostają w polu, a lista zapisuje się po wpisaniu słowa", () => {
    const { written, last } = renderEditor({ mode: "rotate", rotateWords_pl: ["szybko"] });
    const field = rotateField();
    fireEvent.change(field, { target: { value: "szybko\n" } });
    expect(field.value).toBe("szybko\n");
    fireEvent.change(field, { target: { value: "szybko\nbez " } });
    expect(field.value).toBe("szybko\nbez ");
    fireEvent.change(field, { target: { value: "szybko\nbez barier" } });
    expect(last("rotateWords_pl")).toEqual(["szybko", "bez barier"]);
    expect(written.filter(([k]) => k === "rotateWords_pl")).toHaveLength(2);
  });

  it("starszy zapis jednym napisem z liniami jest widoczny i nie ginie po wstawieniu znacznika", () => {
    const { last } = renderEditor({ mode: "rotate", rotateWords_pl: "szybko\n łatwo \n" });
    expect(rotateField().value).toBe("szybko\nłatwo");
    fireEvent.click(screen.getAllByTestId("wstaw-znacznik").at(-1)!);
    expect(last("rotateWords_pl")).toEqual(["szybko", "łatwo", "{post.title}"]);
  });

  it("wersja angielska edytuje WŁASNĄ listę i nie dziedziczy polskiej w polu", () => {
    const { last } = renderEditor({ mode: "rotate", rotateWords_pl: ["szybko"] }, "en");
    expect(rotateField("EN").value).toBe("");
    fireEvent.change(rotateField("EN"), { target: { value: "fast" } });
    expect(last("rotateWords_en")).toEqual(["fast"]);
  });
});

describe("AnimatedHeadingEditor - czas, pętla i wyrównanie", () => {
  it("tryby hover mają jedno pole czasu z wartością zapasową 300 ms", () => {
    const { last } = renderEditor({ mode: "hover-allsides", shape: "hover-allsides-1" });
    expect(screen.getAllByText("Czas animacji (ms)", { selector: "label" })).toHaveLength(1);
    expect(screen.queryByText("Opóźnienie startu (ms)")).toBeNull();
    expect(screen.queryByText("Pętla", { selector: "label" })).toBeNull();
    const duration = fieldUnder("Czas animacji (ms)");
    fireEvent.change(duration, { target: { value: "450" } });
    expect(last("durationMs")).toBe(450);
    fireEvent.change(duration, { target: { value: "" } });
    expect(last("durationMs")).toBe(300);
  });

  it("wyróżnienie ma czas (zapas 1600), opóźnienie (zero jest poprawne) i pętlę", () => {
    const { last } = renderEditor({ mode: "highlight", durationMs: 2000, delayMs: 500 });
    const duration = fieldUnder("Czas animacji (ms)");
    expect(duration.value).toBe("2000");
    fireEvent.change(duration, { target: { value: "" } });
    expect(last("durationMs")).toBe(1600);
    const delay = fieldUnder("Opóźnienie startu (ms)");
    fireEvent.change(delay, { target: { value: "0" } });
    expect(last("delayMs")).toBe(0);
    const loop = fieldUnder("Pętla");
    expect(loop.value).toBe("on");
    fireEvent.change(loop, { target: { value: "off" } });
    expect(last("loop")).toBe(false);
  });

  it("wyrównanie i znacznik zapisują wybraną opcję", () => {
    const { last } = renderEditor({ mode: "highlight", highlight_pl: "x" });
    fireEvent.change(fieldUnder("Wyrównanie"), { target: { value: "center" } });
    fireEvent.change(fieldUnder("Tag HTML"), { target: { value: "h3" } });
    expect(last("align")).toBe("center");
    expect(last("tag")).toBe("h3");
    expect(livePreview().tagName).toBe("H3");
  });
});

describe("AnimatedHeadingEditor - kolory", () => {
  it("kafelek koloru z palety zapisuje swój kolor jako akcent", () => {
    const { last } = renderEditor({ mode: "highlight" });
    fireEvent.click(screen.getByRole("button", { name: "#22c55e" }));
    expect(last("accentColor")).toBe("#22c55e");
  });

  it.each([
    ["Kolor tekstu statycznego", "color"],
    ["Kolor tekstu animowanego + kształtu", "accentColor"],
  ])("„%s” zapisuje wpisany kolor, a wyczyszczony - PUSTY napis", (label, key) => {
    const { last } = renderEditor({ mode: "highlight", color: "#111111", accentColor: "#222222" });
    fireEvent.change(fieldUnder(label), { target: { value: "#abcdef" } });
    expect(last(key)).toBe("#abcdef");
    fireEvent.change(fieldUnder(label), { target: { value: "" } });
    expect(last(key)).toBe("");
  });
});

describe("AnimatedHeadingEditor - linki fragmentów", () => {
  it("każdy fragment zapisuje link pod własnym kluczem, a usunięcie zapisuje null", () => {
    const { last } = renderEditor({
      mode: "highlight",
      linkHighlight: { url: "/stare", kind: "url" },
    });
    const pickers = screen.getAllByTestId("link-picker");
    expect(pickers).toHaveLength(4);
    // Kolejność sekcji: cały nagłówek, przed, wyróżnienie, po.
    expect(pickers.map((p) => p.getAttribute("data-url"))).toEqual(["", "", "/stare", ""]);
    const keys = ["linkWhole", "linkBefore", "linkHighlight", "linkAfter"];
    pickers.forEach((picker, i) => {
      fireEvent.click(within(picker).getByRole("button", { name: "ustaw" }));
      expect(last(keys[i]!)).toEqual({ url: "/o-nas", kind: "page" });
    });
    fireEvent.click(within(pickers[2]!).getByRole("button", { name: "usuń" }));
    // `null`, nie `undefined`: brak klucza w zapisie zostawiłby stary link.
    expect(last("linkHighlight")).toBeNull();
  });
});
