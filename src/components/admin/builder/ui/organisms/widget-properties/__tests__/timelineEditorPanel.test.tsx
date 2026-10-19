// TimelineEditor: oś czasu - lista mieszana z nagłówków daty i wpisów.
//
// Reguły, które ten plik przypina:
//  1. Dwa rodzaje pozycji mają RÓŻNE pola: nagłówek daty ma tylko datę w danej
//     wersji językowej, wpis - ikonę, tytuł, opis i autora akcji. Pozycja bez
//     typu (albo z typem spoza zestawu) jest wpisem, tak jak w rendererze.
//  2. Typ ikony wpisu decyduje, KTÓRE pole źródła ikony widać (awatar,
//     inicjały, nazwa ikony Lucide) - pole dla innego typu zapisywałoby
//     wartość, której renderer przy tym typie nie czyta.
//  3. Przenoszenie na krańcach listy nie zapisuje niczego; w środku zamienia
//     sąsiadów, nie gubiąc ani nie dublując pozycji.
//
// Atrapy: tylko Radix Select (happy-dom nie otwiera warstwy). Słownik jest
// PRAWDZIWY - asercje mierzą napisy, które widzi redakcja.
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { TimelineEditor } from "../TimelineEditor";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

type Content = WidgetNode["content"];
type Row = Record<string, Json>;

function renderEditor(initial: Content, lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<Content>(initial);
    return (
      <TimelineEditor
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
  const entries = (): Row[] =>
    (written.filter(([k]) => k === "entries").at(-1)?.[1] ?? []) as Row[];
  return { ...view, written, entries };
}

function fieldUnder(label: string, index = 0): HTMLInputElement & HTMLSelectElement {
  const node = screen.getAllByText(label, { selector: "label" })[index];
  const field = node?.parentElement?.querySelector("input, textarea, select");
  if (!field) throw new Error(`test: brak pola #${index} pod etykietą „${label}"`);
  return field as HTMLInputElement & HTMLSelectElement;
}

const heading = (date: string): Row => ({ type: "heading", date_pl: date, date_en: date });
const entry = (title: string, over: Row = {}): Row => ({
  type: "item",
  iconType: "avatar",
  avatar: "",
  initials: "?",
  iconName: "FileText",
  titleIconName: "",
  title_pl: title,
  title_en: title,
  desc_pl: "",
  desc_en: "",
  actorName: "",
  actorAvatar: "",
  actorInitials: "",
  actorHref: "",
  ...over,
});

afterEach(cleanup);

describe("TimelineEditor - dodawanie pozycji", () => {
  it("pusta oś pokazuje stan pusty, a „+ Dodaj” seeduje pełny wpis", () => {
    const { entries } = renderEditor({});
    expect(screen.getByText("Lista jest pusta.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Dodaj" }));
    expect(entries()).toEqual([entry("Nowe wydarzenie", { title_en: "New event" })]);
  });

  it("„+ Dodaj datę” dopisuje nagłówek daty na KOŃCU listy", () => {
    const { entries } = renderEditor({ entries: [entry("A")] });
    fireEvent.click(screen.getByRole("button", { name: "+ Dodaj datę" }));
    expect(entries()).toEqual([
      entry("A"),
      { type: "heading", date_pl: "Nowa data", date_en: "New date" },
    ]);
  });

  it("„+ Dodaj wpis” dopisuje wpis na końcu, nie ruszając istniejących", () => {
    const { entries } = renderEditor({ entries: [heading("2026")] });
    fireEvent.click(screen.getByRole("button", { name: "+ Dodaj wpis" }));
    expect(entries()).toHaveLength(2);
    expect(entries()[0]).toEqual(heading("2026"));
    expect(entries()[1]).toMatchObject({ type: "item", title_pl: "Nowe wydarzenie" });
  });
});

describe("TimelineEditor - rodzaje pozycji i ich pola", () => {
  it("nagłówek daty ma tylko pole daty edytowanej wersji językowej", () => {
    const { entries } = renderEditor({ entries: [heading("Marzec")] }, "en");
    expect(screen.getByText("Nagłówek daty #1")).toBeTruthy();
    expect(screen.queryByText("Typ ikony")).toBeNull();
    fireEvent.change(fieldUnder("Data (EN)"), { target: { value: "March" } });
    expect(entries()[0]).toEqual({ type: "heading", date_pl: "Marzec", date_en: "March" });
  });

  it("pozycja bez typu albo z nieznanym typem jest wpisem", () => {
    renderEditor({ entries: [{ title_pl: "Bez typu" }, { type: "milestone", title_pl: "Obcy" }] });
    expect(screen.getByText("Wpis #1")).toBeTruthy();
    expect(screen.getByText("Wpis #2")).toBeTruthy();
    expect(fieldUnder("Tytuł (PL)", 1).value).toBe("Obcy");
  });

  it.each([
    ["avatar", "URL awatara", "avatar", "https://cdn.test/a.png"],
    ["initials", "Inicjały (1-2 znaki)", "initials", "JK"],
    ["lucide", "Nazwa ikony Lucide", "iconName", "Flag"],
  ])("typ ikony „%s” pokazuje TYLKO swoje pole źródła i zapisuje je", (type, label, key, value) => {
    const { entries } = renderEditor({ entries: [entry("A", { iconType: type })] });
    const sourceLabels = ["URL awatara", "Inicjały (1-2 znaki)", "Nazwa ikony Lucide"];
    for (const other of sourceLabels.filter((l) => l !== label)) {
      expect(screen.queryByText(other)).toBeNull();
    }
    fireEvent.change(fieldUnder(label), { target: { value } });
    expect(entries()[0]?.[key]).toBe(value);
  });

  it("wpis bez typu ikony pokazuje pole awatara, a zmiana typu zapisuje się we wpisie", () => {
    const { entries } = renderEditor({ entries: [{ type: "item", title_pl: "A" }] });
    const select = fieldUnder("Typ ikony");
    expect(select.value).toBe("avatar");
    expect(screen.getByText("URL awatara")).toBeTruthy();
    fireEvent.change(select, { target: { value: "lucide" } });
    expect(entries()[0]).toEqual({ type: "item", title_pl: "A", iconType: "lucide" });
    expect(screen.getByText("Nazwa ikony Lucide")).toBeTruthy();
  });

  it.each([
    ["Ikona przy tytule (Lucide)", "titleIconName", "FileText"],
    ["Tytuł (EN)", "title_en", "Launch"],
    ["Opis (EN)", "desc_en", "We shipped."],
    ["Autor akcji - imię i nazwisko", "actorName", "Jan Kowalski"],
    ["Autor akcji - URL awatara", "actorAvatar", "https://cdn.test/jk.png"],
    ["Autor akcji - inicjały", "actorInitials", "JK"],
    ["Autor akcji - link (opcjonalnie)", "actorHref", "/author/jan"],
  ])("pole „%s” wpisu zapisuje się pod kluczem %s", (label, key, value) => {
    const { entries } = renderEditor({ entries: [entry("A")] }, "en");
    fireEvent.change(fieldUnder(label), { target: { value } });
    expect(entries()[0]).toEqual(entry("A", { [key]: value }));
  });

  it("edycja drugiej pozycji nie rusza pierwszej", () => {
    const { entries } = renderEditor({ entries: [entry("A"), entry("B")] });
    fireEvent.change(fieldUnder("Tytuł (PL)", 1), { target: { value: "B2" } });
    expect(entries().map((e) => e.title_pl)).toEqual(["A", "B2"]);
  });
});

describe("TimelineEditor - kolejność i usuwanie", () => {
  const three = () => ({ entries: [heading("2025"), entry("A"), entry("B")] });

  it("strzałka w dół zamienia pozycję z następną", () => {
    const { entries } = renderEditor(three());
    fireEvent.click(screen.getAllByRole("button", { name: "↓" })[0]!);
    expect(entries().map((e) => e.type)).toEqual(["item", "heading", "item"]);
    expect(entries()).toHaveLength(3);
  });

  it("strzałka w górę zamienia pozycję z poprzednią", () => {
    const { entries } = renderEditor(three());
    fireEvent.click(screen.getAllByRole("button", { name: "↑" })[2]!);
    expect(entries().map((e) => e.title_pl ?? e.date_pl)).toEqual(["2025", "B", "A"]);
  });

  it("ruch poza krańce listy nie zapisuje niczego", () => {
    const { written } = renderEditor(three());
    fireEvent.click(screen.getAllByRole("button", { name: "↑" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "↓" })[2]!);
    expect(written).toEqual([]);
  });

  it("usunięcie wpisu albo nagłówka daty zostawia pozostałe pozycje w kolejności", () => {
    const { entries } = renderEditor(three());
    fireEvent.click(screen.getAllByRole("button", { name: "Usuń" })[1]!);
    expect(entries()).toEqual([heading("2025"), entry("B")]);
    fireEvent.click(screen.getAllByRole("button", { name: "Usuń" })[0]!);
    expect(entries()).toEqual([entry("B")]);
  });

  it("śmieci w liście (nie-obiekty) nie dostają wierszy i nie wracają do zapisu", () => {
    const { entries } = renderEditor({
      entries: [null, "x", entry("A")] as unknown as Json,
    });
    expect(screen.getByText("Wpis #1")).toBeTruthy();
    expect(screen.queryByText("Wpis #2")).toBeNull();
    fireEvent.change(fieldUnder("Tytuł (PL)"), { target: { value: "A2" } });
    expect(entries()).toEqual([entry("A", { title_pl: "A2" })]);
  });
});
