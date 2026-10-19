// Nawigator warstw: SEKCJA WEWNĘTRZNA i zwijanie niższych poziomów drzewa.
//
// NAPRAWIONE 2026-10-18: wiersz sekcji wewnętrznej miał „oko" bez działania
// (`onToggleHidden={() => {}}`) i zawsze `hidden={false}` - choć dokument
// i operacja `toggleHidden` obsługują rodzaj "inner-section" (kanwa ukrywa ją
// z menu kontekstowego). Redakcja klikała „Ukryj" w nawigatorze i nic się nie
// działo, a sekcja ukryta z kanwy wyglądała w drzewie na widoczną. Ten plik
// przypina kontrakt: wiersz zgłasza (id, "inner-section") i pokazuje stan
// ukrycia na BIEŻĄCYM urządzeniu.
//
// Przy okazji: zwijanie sekcji wewnętrznej i kolumny chowa ich dzieci, a stan
// strzałki jest dostępny jako `aria-expanded`. Słownik przez `i18nStub`
// (napis = klucz), dokument budowany ręcznie - bez innych atrap.
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { BuilderDocument, ColumnNode, WidgetNode } from "@/lib/builder/types";
import { Navigator } from "../Navigator";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

const widget = (id: string): WidgetNode => ({ id, kind: "widget", type: "text", content: {} });
const column = (id: string, children: WidgetNode[] = []): ColumnNode => ({
  id,
  kind: "column",
  span: { desktop: 6 },
  children,
});

function doc(hideOn?: { desktop?: boolean; mobile?: boolean }): BuilderDocument {
  return {
    version: 1,
    sections: [
      {
        id: "s1",
        kind: "section",
        children: [
          {
            id: "i1",
            kind: "inner-section",
            ...(hideOn ? { advanced: { hideOn } } : {}),
            columns: [column("ic1", [widget("w1")]), column("ic2")],
          },
        ],
      },
    ],
  };
}

function renderNavigator(d: BuilderDocument, device: "desktop" | "mobile" = "desktop") {
  const onSelect = vi.fn();
  const onToggleHidden = vi.fn();
  render(
    <Navigator
      doc={d}
      selection={{ kind: null, id: null }}
      device={device}
      onSelect={onSelect}
      onToggleHidden={onToggleHidden}
    />,
  );
  return { onSelect, onToggleHidden };
}

/** Wiersz drzewa po etykiecie (wiersz to rodzic napisu etykiety). */
function row(label: string): HTMLElement {
  const text = screen.getByText(label);
  const found = text.parentElement;
  if (!found) throw new Error(`test: brak wiersza ${label}`);
  return found;
}

describe("Navigator - ukrywanie sekcji wewnętrznej", () => {
  it("„oko” sekcji wewnętrznej zgłasza jej id i rodzaj, bez zmiany zaznaczenia", () => {
    const { onToggleHidden, onSelect } = renderNavigator(doc());
    const inner = row("builder.navigator.innerSection");
    fireEvent.click(within(inner).getByTitle("builder.navigator.hide"));
    expect(onToggleHidden).toHaveBeenCalledWith("i1", "inner-section");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("sekcja ukryta na bieżącym urządzeniu ma przełącznik „Pokaż”", () => {
    renderNavigator(doc({ desktop: true }), "desktop");
    const inner = row("builder.navigator.innerSection");
    expect(within(inner).getByTitle("builder.navigator.show")).toBeTruthy();
  });

  it("ukrycie na INNYM urządzeniu nie zmienia stanu wiersza", () => {
    renderNavigator(doc({ mobile: true }), "desktop");
    const inner = row("builder.navigator.innerSection");
    expect(within(inner).getByTitle("builder.navigator.hide")).toBeTruthy();
  });

  it("„oko” widgetu w sekcji wewnętrznej zgłasza rodzaj widgetu", () => {
    const { onToggleHidden } = renderNavigator(doc());
    const toggles = screen.getAllByTitle("builder.navigator.hide");
    // Kolejność drzewa: sekcja, sekcja wewn., kolumna, widget, kolumna.
    fireEvent.click(toggles[3]);
    expect(onToggleHidden).toHaveBeenCalledWith("w1", "widget");
  });
});

describe("Navigator - zwijanie niższych poziomów", () => {
  it("zwinięcie sekcji wewnętrznej chowa jej kolumny", () => {
    renderNavigator(doc());
    const toggle = within(row("builder.navigator.innerSection")).getByRole("button", {
      expanded: true,
    });
    expect(screen.getAllByText(/builder\.navigator\.column/)).toHaveLength(2);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/builder\.navigator\.column/)).toBeNull();
  });

  it("zwinięcie kolumny chowa jej widgety, sąsiednia kolumna zostaje", () => {
    renderNavigator(doc());
    const before = screen.getAllByTitle("builder.navigator.hide").length;
    const firstColumn = screen.getAllByText(/builder\.navigator\.column/)[0].parentElement;
    if (!firstColumn) throw new Error("test: brak wiersza kolumny");
    fireEvent.click(within(firstColumn).getByRole("button", { expanded: true }));
    // Zniknął dokładnie jeden wiersz (widget w1); obie kolumny są dalej w drzewie.
    expect(screen.getAllByTitle("builder.navigator.hide")).toHaveLength(before - 1);
    expect(screen.getAllByText(/builder\.navigator\.column/)).toHaveLength(2);
  });
});
