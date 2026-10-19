// AnimatedHeadingEditor: zapisany kształt spoza katalogu.
//
// Panel czytał `shape` rzutem typu (`asStr(c.shape) || "underline"`), więc
// napis spoza `ANIMATED_SHAPES` (literówka, usunięty kształt, śmieci z
// importu) nie zaznaczał ŻADNEGO kafelka, a podgląd na żywo nie rysował
// kreski. Strona w tym czasie rysuje kształt domyślny trybu - panel ma
// pokazać dokładnie ten sam wybór: kafelek z ✓ i kreskę w podglądzie.
//
// Odczyt nie jest zapisem: sam render panelu nie może poprawiać dokumentu
// (każdy zapis to wpis w historii i „niezapisane zmiany" bez działania
// redakcji) - dokument zmienia dopiero kliknięcie kafelka.
//
// Atrapy jak w `animatedHeadingEditorPanel.test.tsx`: Radix Select (happy-dom
// nie otwiera warstwy), `LinkPicker` (zapytania do bazy) i `DynamicTagInserter`
// (popover katalogu znaczników). Słownik jest PRAWDZIWY.
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { AnimatedHeadingEditor } from "../AnimatedHeadingEditor";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("../../../molecules/DynamicTagInserter", () => ({
  DynamicTagInserter: () => null,
}));
vi.mock("../../../molecules/LinkPicker", () => ({
  LinkPicker: () => null,
}));

type Content = WidgetNode["content"];

function renderEditor(initial: Content) {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<Content>(initial);
    return (
      <AnimatedHeadingEditor
        c={content}
        lang="pl"
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  render(<Host />);
  return { written };
}

/** Kafelki z ✓ - wybór, który panel pokazuje jako bieżący. */
const checkedTiles = (): string[] =>
  screen
    .getAllByRole("button")
    .filter((b) => b.textContent?.includes("✓"))
    .map((b) => b.getAttribute("title") ?? "");

/** Podgląd na żywo: nagłówek tuż pod podpisem „Podgląd na żywo". */
const livePreview = (): HTMLElement => {
  const box = screen.getByText("Podgląd na żywo").parentElement as HTMLElement;
  return within(box).getByRole("heading");
};

afterEach(cleanup);

describe("AnimatedHeadingEditor - kształt spoza katalogu", () => {
  it.each([
    ["nieznana nazwa", "wave"],
    ["nie-napis z importu", 3 as unknown as Json],
  ])("%s: zaznaczone jest podkreślenie, a podgląd rysuje kreskę - bez zapisu", (_, shape) => {
    const { written } = renderEditor({ mode: "highlight", shape, highlight_pl: "nas" });
    expect(checkedTiles()).toEqual(["Podkreślenie"]);
    expect(livePreview().querySelector("svg")).not.toBeNull();
    expect(written).toEqual([]);
  });

  it("tryb hover - podkreślenie: nieznany kształt rodziny to pierwszy kafelek tej rodziny", () => {
    const { written } = renderEditor({ mode: "hover-underline", shape: "hover-line-99" });
    expect(checkedTiles()).toEqual(["Hover: rozwijana ze środka"]);
    expect(written).toEqual([]);
  });

  it("tryb hover - ramka: nieznany kształt to pierwszy kafelek rodziny allsides", () => {
    const { written } = renderEditor({ mode: "hover-allsides", shape: "ramka" });
    expect(checkedTiles()).toEqual(["Allsides: rogi po przekątnej"]);
    expect(written).toEqual([]);
  });

  it("kliknięcie kafelka zapisuje kształt z katalogu w miejsce nieznanego", () => {
    const { written } = renderEditor({ mode: "highlight", shape: "wave" });
    fireEvent.click(screen.getByRole("button", { name: /Okrąg/ }));
    expect(written).toEqual([["shape", "circle"]]);
    expect(checkedTiles()).toEqual(["Okrąg"]);
  });

  it("kształt z katalogu panel pokazuje bez zmian", () => {
    renderEditor({ mode: "highlight", shape: "zigzag" });
    expect(checkedTiles()).toEqual(["Zygzak"]);
  });
});
