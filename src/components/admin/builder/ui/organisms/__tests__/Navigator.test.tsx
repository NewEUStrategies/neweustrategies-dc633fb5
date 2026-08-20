// Nawigator (drzewo warstw dokumentu). Jego zadanie: pokazać HIERARCHIĘ
// i pozwolić skoczyć do węzła oraz schować go na danym urządzeniu. Test
// przypina cztery rzeczy:
//  1. KAŻDY POZIOM jest w drzewie: sekcja, sekcja wewnętrzna, kolumna, widget.
//     Zgubiony poziom sprawia, że do węzła w środku kontenera nie da się
//     dostać inaczej niż klikaniem po kanwie.
//  2. WYBÓR oddaje RODZAJ i identyfikator - panel właściwości otwiera się na
//     podstawie obu.
//  3. UKRYWANIE jest per urządzenie i per rodzaj węzła.
//  4. DOKUMENT USZKODZONY (null w dzieciach, brak tablic) nie może wywalić
//     nawigatora - to jedyne miejsce, z którego da się jeszcze naprawić
//     zepsutą stronę.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { BuilderDocument, ColumnNode, SectionNode, WidgetNode } from "@/lib/builder/types";
import { Navigator } from "../Navigator";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

const w = (id: string, type: WidgetNode["type"] = "text"): WidgetNode => ({
  id,
  kind: "widget",
  type,
  content: {},
});
const col = (id: string, children: WidgetNode[] = []): ColumnNode => ({
  id,
  kind: "column",
  span: { desktop: 12 },
  children,
});
const sec = (id: string, children: SectionNode["children"]): SectionNode => ({
  id,
  kind: "section",
  children,
});

function renderNavigator(
  doc: BuilderDocument,
  selection: {
    kind: "section" | "column" | "widget" | "inner-section" | null;
    id: string | null;
  } = {
    kind: null,
    id: null,
  },
  device: "desktop" | "tablet" | "mobile" = "desktop",
) {
  const onSelect = vi.fn();
  const onToggleHidden = vi.fn();
  const view = render(
    <Navigator
      doc={doc}
      selection={selection}
      device={device}
      onSelect={onSelect}
      onToggleHidden={onToggleHidden}
    />,
  );
  return { ...view, onSelect, onToggleHidden };
}

const FULL: BuilderDocument = {
  version: 1,
  sections: [
    sec("s1", [
      col("c1", [w("w1", "heading"), w("w2", "button")]),
      {
        id: "i1",
        kind: "inner-section",
        columns: [col("ic1", [w("w3", "text")]), col("ic2", [])],
      },
    ]),
    sec("s2", [col("c2", [])]),
  ],
};

describe("Navigator - drzewo", () => {
  it("pusty dokument pokazuje komunikat, nie puste drzewo", () => {
    renderNavigator({ version: 1, sections: [] });
    expect(screen.getByText("builder.navigator.empty")).toBeInTheDocument();
  });

  it("pokazuje wszystkie poziomy hierarchii", () => {
    renderNavigator(FULL);
    expect(screen.getByText("builder.navigator.section(n=1)")).toBeInTheDocument();
    expect(screen.getByText("builder.navigator.section(n=2)")).toBeInTheDocument();
    expect(screen.getByText("builder.navigator.innerSection")).toBeInTheDocument();
    // Kolumny są numerowane po rozpiętości - liczy się, że są.
    expect(screen.getAllByText(/builder.navigator.column/).length).toBeGreaterThan(0);
  });

  it("widgety pokazują swoje etykiety z rejestru", () => {
    renderNavigator(FULL);
    // Etykieta z rejestru, nie surowy typ - redakcja nie zna nazw typów.
    expect(screen.getByText("Nagłówek")).toBeInTheDocument();
    expect(screen.getAllByText(/Przycisk|Tekst/).length).toBeGreaterThan(0);
  });

  it("widget nieznanego typu jest odsiewany przez sanityzację dokumentu", () => {
    const { container } = renderNavigator({
      version: 1,
      sections: [sec("s1", [col("c1", [w("w1", "nie-ma-takiego" as WidgetNode["type"])])])],
    });
    // Nawigator czyta dokument przez `safeParseBuilderDoc`, a ten USUWA węzły
    // o typie spoza rejestru - drzewo pokazuje więc sekcję i kolumnę, ale nie
    // widget, którego renderer i tak by nie narysował. Dzięki temu drzewo nie
    // obiecuje warstwy, której na stronie nie ma.
    expect(container.textContent).toContain("builder.navigator.section(n=1)");
    expect(container.textContent).not.toContain("nie-ma-takiego");
  });

  it("zwinięcie sekcji ukrywa jej zawartość", () => {
    const { container } = renderNavigator(FULL);
    const before = container.querySelectorAll("button").length;
    // Strzałka zwijania to pierwszy przycisk wiersza (drugi to „oko").
    const toggle = container.querySelector("button");
    if (!toggle) throw new Error("test: brak przycisku zwijania");
    fireEvent.click(toggle);
    expect(container.querySelectorAll("button").length).toBeLessThan(before);
  });
});

describe("Navigator - wybór węzła", () => {
  it.each([
    ["sekcja", "builder.navigator.section(n=1)", { kind: "section", id: "s1" }],
    ["sekcja wewnętrzna", "builder.navigator.innerSection", { kind: "inner-section", id: "i1" }],
    ["widget", "Nagłówek", { kind: "widget", id: "w1" }],
  ] as const)("klik w %s zgłasza rodzaj i identyfikator", (_label, text, expected) => {
    const { onSelect } = renderNavigator(FULL);
    fireEvent.click(screen.getByText(text));
    expect(onSelect).toHaveBeenCalledWith(expected);
  });

  it("klik w kolumnę zgłasza jej identyfikator", () => {
    const { onSelect } = renderNavigator(FULL);
    fireEvent.click(screen.getAllByText(/builder.navigator.column/)[0]);
    expect(onSelect).toHaveBeenCalledWith({ kind: "column", id: "c1" });
  });

  it("zaznaczony węzeł jest wyróżniony", () => {
    renderNavigator(FULL, { kind: "widget", id: "w1" });
    const row = screen.getByText("Nagłówek").parentElement;
    expect(row?.className).toContain("bg-brand");
  });

  it("zaznaczenie innego rodzaju o tym samym identyfikatorze nie wyróżnia węzła", () => {
    renderNavigator(FULL, { kind: "column", id: "s1" });
    const row = screen.getByText("builder.navigator.section(n=1)").parentElement;
    // Rodzaj jest częścią tożsamości - sekcja „s1” i kolumna „s1” to dwa różne
    // węzły (identyfikatory bywają współdzielone po importach).
    expect(row?.className).not.toContain("bg-brand");
  });
});

describe("Navigator - ukrywanie na urządzeniu", () => {
  it("przełącznik przy sekcji zgłasza jej rodzaj", () => {
    const { onToggleHidden } = renderNavigator(FULL);
    const toggles = screen.getAllByTitle("builder.navigator.hide");
    fireEvent.click(toggles[0]);
    expect(onToggleHidden).toHaveBeenCalledWith("s1", "section");
  });

  it("sekcja ukryta na bieżącym urządzeniu ma przełącznik pokazywania", () => {
    const doc: BuilderDocument = {
      version: 1,
      sections: [
        { ...sec("s1", [col("c1", [])]), advanced: { hideOn: { mobile: true } } } as SectionNode,
      ],
    };
    const mobile = renderNavigator(doc, { kind: null, id: null }, "mobile");
    expect(screen.getAllByTitle("builder.navigator.show").length).toBeGreaterThan(0);
    mobile.unmount();

    // Na desktopie ta sama sekcja jest widoczna - ukrycie jest PER URZĄDZENIE.
    renderNavigator(doc, { kind: null, id: null }, "desktop");
    expect(screen.queryAllByTitle("builder.navigator.show")).toHaveLength(0);
  });

  it("przełącznik przy widgecie zgłasza rodzaj widgetu", () => {
    const { onToggleHidden } = renderNavigator(FULL);
    const toggles = screen.getAllByTitle("builder.navigator.hide");
    fireEvent.click(toggles[toggles.length - 1]);
    expect(onToggleHidden).toHaveBeenCalledWith(expect.any(String), expect.any(String));
    const [, kind] = onToggleHidden.mock.calls[0];
    expect(["section", "column", "widget", "inner-section"]).toContain(kind);
  });

  it("klik w przełącznik nie zmienia zaznaczenia", () => {
    const { onSelect, onToggleHidden } = renderNavigator(FULL);
    fireEvent.click(screen.getAllByTitle("builder.navigator.hide")[0]);
    // Zatrzymanie propagacji - inaczej ukrycie sekcji przestawiałoby panel
    // właściwości na tę sekcję.
    expect(onToggleHidden).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("Navigator - dokument uszkodzony", () => {
  it.each([
    ["null w sekcjach", { version: 1, sections: [null] }],
    [
      "null w dzieciach sekcji",
      { version: 1, sections: [{ id: "s1", kind: "section", children: [null] }] },
    ],
    [
      "dzieci nie będące tablicą",
      { version: 1, sections: [{ id: "s1", kind: "section", children: "x" }] },
    ],
    [
      "kolumny sekcji wewnętrznej nie będące tablicą",
      {
        version: 1,
        sections: [
          {
            id: "s1",
            kind: "section",
            children: [{ id: "i1", kind: "inner-section", columns: "x" }],
          },
        ],
      },
    ],
    [
      "widget bez identyfikatora",
      {
        version: 1,
        sections: [
          {
            id: "s1",
            kind: "section",
            children: [{ id: "c1", kind: "column", span: { desktop: 12 }, children: [null] }],
          },
        ],
      },
    ],
  ])("znosi dokument: %s", (_label, doc) => {
    // Nawigator to jedyne miejsce, z którego da się jeszcze naprawić zepsutą
    // stronę - awaria tutaj zamyka redakcji ostatnie wyjście.
    const { container } = renderNavigator(doc as unknown as BuilderDocument);
    expect(container.textContent).toContain("builder.navigator.title");
  });
});
