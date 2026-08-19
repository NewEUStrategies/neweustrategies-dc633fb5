// Kanwa buildera i biblioteka widgetów - dwa panele, między którymi operator
// przenosi elementy formularza.
//
// Obie powierzchnie stały na zerze, a niosą trzy rzeczy, których pomyłka jest
// cicha i kosztowna:
//   1. akcje na widgecie (duplikuj / usuń / przenieś) muszą ZATRZYMYWAĆ
//      propagację - inaczej każde kliknięcie „usuń" najpierw zaznacza widget,
//      a operator widzi, że panel właściwości pokazuje coś, czego już nie ma,
//   2. w układzie dwukolumnowym widget musi wylądować w SWOJEJ kolumnie -
//      przypisanie po `col` decyduje o wyglądzie maila u odbiorcy,
//   3. biblioteka pokazuje różne zestawy widgetów w mailu i w popupie
//      (`context`) - widget popupowy w mailu jest martwym elementem.
//
// Oba komponenty żyją w @dnd-kit, więc render idzie przez `DndContext`.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { BuilderCanvas } from "@/components/admin/newsletter/builder/BuilderCanvas";
import { WidgetLibrary } from "@/components/admin/newsletter/builder/WidgetLibrary";
import { makeWidget } from "@/lib/newsletter-builder/defaults";
import { widgetsForContext } from "@/lib/newsletter-builder/registry";
import type { NlWidget } from "@/lib/newsletter-builder/types";

function widget(
  type: Parameters<typeof makeWidget>[0],
  overrides: Partial<NlWidget> = {},
): NlWidget {
  return { ...makeWidget(type), ...overrides } as NlWidget;
}

function inDnd(ui: React.ReactElement) {
  return render(<DndContext>{ui}</DndContext>);
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// KANWA
// ---------------------------------------------------------------------------
describe("BuilderCanvas - układ jednokolumnowy", () => {
  const handlers = () => ({
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onDuplicate: vi.fn(),
  });

  function mount(widgets: NlWidget[], overrides: Record<string, unknown> = {}) {
    const cb = handlers();
    inDnd(
      <BuilderCanvas
        sectionId="sec-1"
        widgets={widgets}
        lang="pl"
        selectedId={null}
        {...cb}
        {...overrides}
      />,
    );
    return cb;
  }

  it("pusta kanwa zaprasza do upuszczenia widgetu", () => {
    const { container } = inDnd(
      <BuilderCanvas
        sectionId="sec-1"
        widgets={[]}
        lang="pl"
        selectedId={null}
        {...handlers()}
      />,
    );

    expect(screen.getByText("Upusc widget tutaj")).toBeTruthy();
    // Zaproszenie stoi w obszarze o minimalnej wysokości - inaczej pusta sekcja
    // nie miałaby gdzie przyjąć upuszczonego widgetu.
    expect(container.querySelector('[class*="min-h-"]')).toBeTruthy();
  });

  it("zaproszenie jest tłumaczone", () => {
    const cb = handlers();
    inDnd(<BuilderCanvas sectionId="sec-1" widgets={[]} lang="en" selectedId={null} {...cb} />);

    expect(screen.getByText("Drop widget here")).toBeTruthy();
    expect(screen.queryByText("Upusc widget tutaj")).toBeNull();
  });

  it("renderuje podgląd każdego widgetu sekcji", () => {
    mount([
      widget("heading", { id: "w1", text: { pl: "Tytuł", en: "Title" } } as Partial<NlWidget>),
      widget("submit", { id: "w2", label: { pl: "Zapisz", en: "Save" } } as Partial<NlWidget>),
    ]);

    expect(screen.getByText("Tytuł")).toBeTruthy();
    expect(screen.getByText("Zapisz")).toBeTruthy();
  });

  it("klik w widget ZAZNACZA go", () => {
    const cb = mount([widget("heading", { id: "w1" })]);

    fireEvent.click(screen.getByLabelText("Przenies").closest("div")!);

    expect(cb.onSelect).toHaveBeenCalledWith("w1");
    // Zaznaczenie to NIE usunięcie ani duplikat.
    expect(cb.onRemove).not.toHaveBeenCalled();
  });

  it("DUPLIKOWANIE nie zaznacza przy okazji widgetu", () => {
    const cb = mount([widget("heading", { id: "w1" })]);

    fireEvent.click(screen.getByLabelText("Duplikuj"));

    expect(cb.onDuplicate).toHaveBeenCalledWith("w1");
    // Bez zatrzymania propagacji panel właściwości pokazywałby stan po kliknięciu.
    expect(cb.onSelect).not.toHaveBeenCalled();
  });

  it("USUNIĘCIE też nie zaznacza - inaczej panel pokazuje coś, czego nie ma", () => {
    const cb = mount([widget("heading", { id: "w1" })]);

    fireEvent.click(screen.getByLabelText("Usun"));

    expect(cb.onRemove).toHaveBeenCalledWith("w1");
    expect(cb.onSelect).not.toHaveBeenCalled();
  });

  it("uchwyt przenoszenia nie zaznacza widgetu", () => {
    const cb = mount([widget("heading", { id: "w1" })]);

    fireEvent.click(screen.getByLabelText("Przenies"));

    expect(cb.onSelect).not.toHaveBeenCalled();
    // ...i tym bardziej niczego nie usuwa.
    expect(cb.onRemove).not.toHaveBeenCalled();
  });

  it("etykiety akcji są tłumaczone", () => {
    const cb = handlers();
    inDnd(
      <BuilderCanvas
        sectionId="sec-1"
        widgets={[widget("heading", { id: "w1" })]}
        lang="en"
        selectedId={null}
        {...cb}
      />,
    );

    expect(screen.getByLabelText("Duplicate")).toBeTruthy();
    expect(screen.getByLabelText("Remove")).toBeTruthy();
    expect(screen.getByLabelText("Move")).toBeTruthy();
  });

  it("ZAZNACZONY widget jest wyróżniony obramowaniem", () => {
    const cb = handlers();
    const { container } = inDnd(
      <BuilderCanvas
        sectionId="sec-1"
        widgets={[widget("heading", { id: "w1" })]}
        lang="pl"
        selectedId="w1"
        {...cb}
      />,
    );

    expect(container.innerHTML).toContain("ring-primary");
    // Zaznaczony jest DOKŁADNIE jeden widget.
    expect(container.querySelectorAll('[class*="ring-primary"]')).toHaveLength(1);
  });

  it("niezaznaczony widget nie ma pierścienia zaznaczenia", () => {
    const { container } = render(
      <DndContext>
        <BuilderCanvas
          sectionId="sec-1"
          widgets={[widget("heading", { id: "w1" })]}
          lang="pl"
          selectedId="inny"
          {...handlers()}
        />
      </DndContext>,
    );

    expect(container.innerHTML).not.toContain("ring-primary");
    // Widget nadal jest w kanwie - brak pierścienia to nie brak elementu.
    expect(screen.getByLabelText("Przenies")).toBeTruthy();
  });

  it("w układzie jednokolumnowym widgety przypisane do kolumny są POMIJANE", () => {
    mount([
      widget("heading", { id: "w1", text: { pl: "Widoczny", en: "Visible" } } as Partial<NlWidget>),
      widget("heading", {
        id: "w2",
        col: 1,
        text: { pl: "Ukryty", en: "Hidden" },
      } as Partial<NlWidget>),
    ]);

    expect(screen.getByText("Widoczny")).toBeTruthy();
    expect(screen.queryByText("Ukryty")).toBeNull();
  });
});

describe("BuilderCanvas - układ dwukolumnowy", () => {
  function mountTwoCols(widgets: NlWidget[]) {
    const cb = { onSelect: vi.fn(), onRemove: vi.fn(), onDuplicate: vi.fn() };
    const utils = inDnd(
      <BuilderCanvas
        sectionId="sec-1"
        widgets={widgets}
        lang="pl"
        layout="1-1"
        selectedId={null}
        {...cb}
      />,
    );
    return { ...utils, ...cb };
  }

  it("pokazuje dwie nazwane kolumny", () => {
    const { container } = mountTwoCols([]);

    expect(screen.getByText("Kolumna 1")).toBeTruthy();
    expect(screen.getByText("Kolumna 2")).toBeTruthy();
    // Dokładnie dwa obszary upuszczania, nie trzeci „wspólny".
    expect(container.querySelectorAll(".border-dashed")).toHaveLength(2);
  });

  it("widget BEZ przypisania trafia do pierwszej kolumny", () => {
    const { container } = mountTwoCols([
      widget("heading", { id: "w1", text: { pl: "Pierwszy", en: "First" } } as Partial<NlWidget>),
    ]);

    const columns = container.querySelectorAll(".border-dashed");
    expect(columns[0]?.textContent).toContain("Pierwszy");
    expect(columns[1]?.textContent).not.toContain("Pierwszy");
  });

  it("widget przypisany do DRUGIEJ kolumny trafia do drugiej", () => {
    const { container } = mountTwoCols([
      widget("heading", {
        id: "w2",
        col: 1,
        text: { pl: "Drugi", en: "Second" },
      } as Partial<NlWidget>),
    ]);

    const columns = container.querySelectorAll(".border-dashed");
    expect(columns[1]?.textContent).toContain("Drugi");
    expect(columns[0]?.textContent).not.toContain("Drugi");
  });

  it("puste kolumny zapraszają do upuszczenia niezależnie", () => {
    const { container } = mountTwoCols([]);

    expect(screen.getAllByText("Upusc widget tutaj")).toHaveLength(2);
    expect(container.querySelectorAll(".border-dashed")).toHaveLength(2);
  });

  it("nazwy kolumn są tłumaczone", () => {
    inDnd(
      <BuilderCanvas
        sectionId="sec-1"
        widgets={[]}
        lang="en"
        layout="1-1"
        selectedId={null}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );

    expect(screen.getByText("Column 1")).toBeTruthy();
    expect(screen.getByText("Column 2")).toBeTruthy();
    expect(screen.queryByText("Kolumna 1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BIBLIOTEKA
// ---------------------------------------------------------------------------
describe("WidgetLibrary", () => {
  function mount(props: Record<string, unknown> = {}) {
    const onAdd = vi.fn();
    inDnd(<WidgetLibrary lang="pl" onAdd={onAdd} {...props} />);
    return onAdd;
  }

  it("ma nagłówek biblioteki, tłumaczony", () => {
    mount();
    expect(screen.getByText("Biblioteka widgetow")).toBeTruthy();
    cleanup();

    mount({ lang: "en" });
    expect(screen.getByText("Widget library")).toBeTruthy();
  });

  it("grupuje karty po grupach rejestru", () => {
    mount();

    expect(screen.getByText("Tresc")).toBeTruthy();
    expect(screen.getByText("Pola formularza")).toBeTruthy();
    // Nagłówki grup NIE są przyciskami - klik w nagłówek nie dodaje widgetu.
    expect(screen.getByText("Tresc").closest("button")).toBeNull();
  });

  it("nazwy grup są tłumaczone", () => {
    mount({ lang: "en" });

    expect(screen.getByText("Content")).toBeTruthy();
    expect(screen.getByText("Form fields")).toBeTruthy();
    expect(screen.queryByText("Pola formularza")).toBeNull();
  });

  it("renderuje kartę dla KAŻDEGO widgetu dostępnego w kontekście", () => {
    mount({ context: "newsletter" });

    const expected = widgetsForContext("newsletter");
    // Karty to przyciski; nagłówki grup nie są przyciskami.
    expect(screen.getAllByRole("button")).toHaveLength(expected.length);
    expect(expected.length).toBeGreaterThan(0);
  });

  it("KONTEKST POPUPU pokazuje inny zestaw niż mail", () => {
    mount({ context: "popup" });
    const popupCount = screen.getAllByRole("button").length;
    cleanup();

    mount({ context: "newsletter" });
    const newsletterCount = screen.getAllByRole("button").length;

    expect(popupCount).not.toBe(newsletterCount);
    expect(popupCount).toBe(widgetsForContext("popup").length);
  });

  it("domyślnym kontekstem jest newsletter", () => {
    mount();

    expect(screen.getAllByRole("button")).toHaveLength(widgetsForContext("newsletter").length);
    // Widget wyłącznie popupowy nie może się pokazać w domyślnym kontekście.
    expect(screen.queryByText("Licznik czasu")).toBeNull();
  });

  it("klik w kartę dodaje widget jej TYPU", () => {
    const onAdd = mount();

    const heading = widgetsForContext("newsletter").find((w) => w.type === "heading");
    fireEvent.click(screen.getByText(heading!.labelPl).closest("button")!);

    expect(onAdd).toHaveBeenCalledWith("heading", undefined);
    // Jedno kliknięcie to jeden widget.
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("karta PRESETU dodaje widget razem z presetem", () => {
    const onAdd = mount();

    const preset = widgetsForContext("newsletter").find((w) => w.preset && w.id);
    expect(preset).toBeDefined();
    fireEvent.click(screen.getByText(preset!.labelPl).closest("button")!);

    expect(onAdd).toHaveBeenCalledWith(preset!.type, preset!.preset);
  });

  it("etykiety kart idą za językiem", () => {
    mount({ lang: "en" });

    const heading = widgetsForContext("newsletter").find((w) => w.type === "heading");
    expect(screen.getByText(heading!.labelEn)).toBeTruthy();
    expect(screen.queryByText(heading!.labelPl)).toBeNull();
  });
});
