// Skróty klawiszowe kanwy buildera. Hak nie ma własnego stanu - jego CAŁA
// treść to mapowanie klawiszy na akcje, więc test jest tabelą po klawiszach.
//
// Trzy reguły, które trzeba pilnować, bo ich naruszenie kosztuje redakcję
// utraconą pracę:
//  1. COFANIE I ZAPIS DZIAŁAJĄ WSZĘDZIE, także w polu tekstowym panelu.
//     Pozostałe skróty NIE MOGĄ przechwytywać pisania - Ctrl+C w polu tekstowym
//     ma kopiować tekst, nie widget.
//  2. ZAZNACZENIE WIELOKROTNE MA PIERWSZEŃSTWO. Gdy pasek pokazuje „5
//     zaznaczonych”, Delete musi usunąć pięć widgetów, nie jeden „aktywny”.
//  3. KAŻDY RODZAJ ZAZNACZENIA MA SWOJĄ AKCJĘ. Ctrl+D na kolumnie duplikuje
//     kolumnę, nie sekcję.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import type { Selection } from "../../organisms/builder";
import { useBuilderShortcuts } from "../useBuilderShortcuts";

type Params = Parameters<typeof useBuilderShortcuts>[0];

function handlers() {
  return {
    setSelection: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    pasteFromClipboard: vi.fn(),
    duplicateSection: vi.fn(),
    duplicateColumn: vi.fn(),
    duplicateWidget: vi.fn(),
    askRemoveSection: vi.fn(),
    askRemoveColumn: vi.fn(),
    askRemoveWidget: vi.fn(),
    moveSection: vi.fn(),
    onSave: vi.fn(),
    onToggleNavigator: vi.fn(),
    onBulkDelete: vi.fn(),
    onBulkDuplicate: vi.fn(),
    onClearMulti: vi.fn(),
  };
}

type Handlers = ReturnType<typeof handlers>;

function setup(
  selection: Selection = { kind: "widget", id: "w1" },
  extra: Partial<Params> = {},
): Handlers {
  const h = handlers();
  renderHook(() => useBuilderShortcuts({ selection, ...h, ...extra }));
  return h;
}

/** Pole tekstowe w DOM - cel zdarzenia dla testów „nie przechwytuj pisania”. */
function textInput(): HTMLInputElement {
  const input = document.createElement("input");
  document.body.appendChild(input);
  return input;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("useBuilderShortcuts - cofanie, ponawianie, zapis", () => {
  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
  ])("%s+Z cofa", (_label, mod) => {
    const h = setup();
    fireEvent.keyDown(window, { key: "z", ...mod });
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.redo).not.toHaveBeenCalled();
  });

  it.each([
    ["Ctrl+Y", { key: "y", ctrlKey: true }],
    ["Ctrl+Shift+Z", { key: "z", ctrlKey: true, shiftKey: true }],
  ])("%s ponawia", (_label, event) => {
    const h = setup();
    fireEvent.keyDown(window, event);
    expect(h.redo).toHaveBeenCalledTimes(1);
    expect(h.undo).not.toHaveBeenCalled();
  });

  it("Ctrl+S zapisuje", () => {
    const h = setup();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(h.onSave).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+S bez obsługi zapisu nie robi nic", () => {
    const h = setup({ kind: "widget", id: "w1" }, { onSave: undefined });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(h.onSave).not.toHaveBeenCalled();
  });

  it.each([
    ["cofanie", { key: "z", ctrlKey: true }, "undo"],
    ["ponawianie", { key: "y", ctrlKey: true }, "redo"],
    ["zapis", { key: "s", ctrlKey: true }, "onSave"],
  ] as const)("%s działa TAKŻE w polu tekstowym", (_label, event, key) => {
    const h = setup();
    fireEvent.keyDown(textInput(), event);
    expect(h[key]).toHaveBeenCalledTimes(1);
  });

  it("wielka litera klawisza też działa", () => {
    const h = setup();
    fireEvent.keyDown(window, { key: "Z", ctrlKey: true });
    expect(h.undo).toHaveBeenCalledTimes(1);
  });

  it("zdarzenie bez klawisza jest ignorowane", () => {
    const h = setup();
    fireEvent.keyDown(window, { key: "", ctrlKey: true });
    expect(h.undo).not.toHaveBeenCalled();
  });
});

describe("useBuilderShortcuts - schowek", () => {
  it.each([
    ["Ctrl+C", "c", "copySelection"],
    ["Ctrl+X", "x", "cutSelection"],
    ["Ctrl+V", "v", "pasteFromClipboard"],
  ] as const)("%s wywołuje swoją akcję", (_label, key, fn) => {
    const h = setup();
    fireEvent.keyDown(window, { key, ctrlKey: true });
    expect(h[fn]).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Ctrl+C", "c", "copySelection"],
    ["Ctrl+X", "x", "cutSelection"],
    ["Ctrl+V", "v", "pasteFromClipboard"],
  ] as const)("%s w polu tekstowym NIE rusza widgetów", (_label, key, fn) => {
    const h = setup();
    fireEvent.keyDown(textInput(), { key, ctrlKey: true });
    // Redaktor kopiujący fragment tekstu w panelu nie kopiuje widgetu.
    expect(h[fn]).not.toHaveBeenCalled();
  });

  it("skróty pomijają też pola contentEditable", () => {
    const h = setup();
    const div = document.createElement("div");
    div.contentEditable = "true";
    Object.defineProperty(div, "isContentEditable", { value: true });
    document.body.appendChild(div);
    fireEvent.keyDown(div, { key: "c", ctrlKey: true });
    expect(h.copySelection).not.toHaveBeenCalled();
  });
});

describe("useBuilderShortcuts - duplikowanie i usuwanie", () => {
  it.each([
    ["sekcja", "section", "duplicateSection"],
    ["kolumna", "column", "duplicateColumn"],
    ["widget", "widget", "duplicateWidget"],
  ] as const)("Ctrl+D duplikuje właściwy rodzaj: %s", (_label, kind, fn) => {
    const h = setup({ kind, id: "x1" });
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(h[fn]).toHaveBeenCalledWith("x1");
  });

  it("Ctrl+D bez zaznaczenia nic nie duplikuje", () => {
    const h = setup({ kind: null, id: null });
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(h.duplicateSection).not.toHaveBeenCalled();
    expect(h.duplicateWidget).not.toHaveBeenCalled();
  });

  it("Ctrl+D na sekcji wewnętrznej nie ma akcji", () => {
    const h = setup({ kind: "inner-section", id: "i1" });
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(h.duplicateSection).not.toHaveBeenCalled();
    expect(h.duplicateColumn).not.toHaveBeenCalled();
    expect(h.duplicateWidget).not.toHaveBeenCalled();
  });

  it.each([
    ["sekcja", "section", "askRemoveSection"],
    ["kolumna", "column", "askRemoveColumn"],
    ["widget", "widget", "askRemoveWidget"],
  ] as const)("Delete PYTA o usunięcie właściwego rodzaju: %s", (_label, kind, fn) => {
    const h = setup({ kind, id: "x1" });
    fireEvent.keyDown(window, { key: "Delete" });
    // Skrót nie usuwa wprost - otwiera potwierdzenie. Usunięcie sekcji
    // klawiszem bez pytania było najczęściej zgłaszaną utratą pracy.
    expect(h[fn]).toHaveBeenCalledWith("x1");
  });

  it("Backspace działa jak Delete", () => {
    const h = setup({ kind: "widget", id: "w1" });
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(h.askRemoveWidget).toHaveBeenCalledWith("w1");
  });

  it("Delete bez zaznaczenia nic nie pyta", () => {
    const h = setup({ kind: null, id: null });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(h.askRemoveWidget).not.toHaveBeenCalled();
  });

  it("Delete na sekcji wewnętrznej nie ma akcji", () => {
    const h = setup({ kind: "inner-section", id: "i1" });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(h.askRemoveSection).not.toHaveBeenCalled();
  });
});

describe("useBuilderShortcuts - przesuwanie i nawigator", () => {
  it.each([
    ["w górę", "ArrowUp", -1],
    ["w dół", "ArrowDown", 1],
  ])("Alt+strzałka przesuwa sekcję %s", (_label, key, dir) => {
    const h = setup({ kind: "section", id: "s1" });
    fireEvent.keyDown(window, { key, altKey: true });
    expect(h.moveSection).toHaveBeenCalledWith("s1", dir);
  });

  it("Alt+strzałka na widgecie nie przesuwa sekcji", () => {
    const h = setup({ kind: "widget", id: "w1" });
    fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
    expect(h.moveSection).not.toHaveBeenCalled();
  });

  it("strzałka bez Alt nie przesuwa", () => {
    const h = setup({ kind: "section", id: "s1" });
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(h.moveSection).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+N przełącza nawigator", () => {
    const h = setup();
    fireEvent.keyDown(window, { key: "n", ctrlKey: true, shiftKey: true });
    expect(h.onToggleNavigator).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+N bez Shift nie przełącza nawigatora", () => {
    const h = setup();
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(h.onToggleNavigator).not.toHaveBeenCalled();
  });

  it("Escape czyści zaznaczenie", () => {
    const h = setup();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(h.setSelection).toHaveBeenCalledWith({ kind: null, id: null });
  });

  it("nieobsługiwany klawisz nie robi nic", () => {
    const h = setup();
    fireEvent.keyDown(window, { key: "q" });
    expect(Object.values(h).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });
});

describe("useBuilderShortcuts - zaznaczenie wielokrotne ma pierwszeństwo", () => {
  const multi = new Set(["w1", "w2", "w3"]);

  it("Delete usuwa CAŁE zaznaczenie, nie pojedynczy widget", () => {
    const h = setup({ kind: "widget", id: "w1" }, { multiSelection: multi });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(h.onBulkDelete).toHaveBeenCalledTimes(1);
    // To jest cała treść pierwszeństwa: pasek pokazuje 3, więc Delete nie może
    // usunąć jednego.
    expect(h.askRemoveWidget).not.toHaveBeenCalled();
  });

  it("Backspace też usuwa całe zaznaczenie", () => {
    const h = setup({ kind: "widget", id: "w1" }, { multiSelection: multi });
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(h.onBulkDelete).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+D duplikuje całe zaznaczenie", () => {
    const h = setup({ kind: "widget", id: "w1" }, { multiSelection: multi });
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(h.onBulkDuplicate).toHaveBeenCalledTimes(1);
    expect(h.duplicateWidget).not.toHaveBeenCalled();
  });

  it("Escape czyści zaznaczenie wielokrotne, nie pojedyncze", () => {
    const h = setup({ kind: "widget", id: "w1" }, { multiSelection: multi });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(h.onClearMulti).toHaveBeenCalledTimes(1);
    expect(h.setSelection).not.toHaveBeenCalled();
  });

  it("puste zaznaczenie wielokrotne nie przechwytuje skrótów", () => {
    const h = setup({ kind: "widget", id: "w1" }, { multiSelection: new Set<string>() });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(h.onBulkDelete).not.toHaveBeenCalled();
    expect(h.askRemoveWidget).toHaveBeenCalledWith("w1");
  });

  it.each([
    ["usuwanie", { key: "Delete" }, "onBulkDelete", "askRemoveWidget"],
    ["duplikowanie", { key: "d", ctrlKey: true }, "onBulkDuplicate", "duplicateWidget"],
  ] as const)(
    "bez obsługi masowej %s spada na akcję pojedynczą",
    (_label, event, bulkKey, singleKey) => {
      const h = setup(
        { kind: "widget", id: "w1" },
        { multiSelection: multi, [bulkKey]: undefined },
      );
      fireEvent.keyDown(window, event);
      expect(h[bulkKey]).not.toHaveBeenCalled();
      expect(h[singleKey]).toHaveBeenCalledWith("w1");
    },
  );

  it("bez obsługi czyszczenia Escape spada na czyszczenie pojedyncze", () => {
    const h = setup(
      { kind: "widget", id: "w1" },
      { multiSelection: multi, onClearMulti: undefined },
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(h.setSelection).toHaveBeenCalledWith({ kind: null, id: null });
  });

  it("zaznaczenie wielokrotne nie działa w polu tekstowym", () => {
    const h = setup({ kind: "widget", id: "w1" }, { multiSelection: multi });
    fireEvent.keyDown(textInput(), { key: "Delete" });
    expect(h.onBulkDelete).not.toHaveBeenCalled();
  });
});

describe("useBuilderShortcuts - odmontowanie", () => {
  it("po odmontowaniu nasłuch jest zdjęty", () => {
    const h = handlers();
    const { unmount } = renderHook(() =>
      useBuilderShortcuts({ selection: { kind: "widget", id: "w1" }, ...h }),
    );
    unmount();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    // Bez zdjęcia nasłuchu skróty buildera działałyby na innych ekranach panelu.
    expect(h.undo).not.toHaveBeenCalled();
  });
});
