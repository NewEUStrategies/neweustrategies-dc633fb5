// Skróty historii edycji (undo/redo). W hooku tę regułę dało się wywołać
// wyłącznie prawdziwym zdarzeniem `keydown` na `window`, więc żadna z kombinacji
// nie miała testu - w tym `Ctrl+Y`, którego używają redaktorzy przychodzący
// z Worda i który najłatwiej zgubić przy refaktorze warunku.
import { describe, expect, it } from "vitest";
import { historyShortcut, type HistoryKeyEvent } from "../historyShortcut";

function key(overrides: Partial<HistoryKeyEvent> & { key: string }): HistoryKeyEvent {
  return { ctrlKey: false, metaKey: false, shiftKey: false, ...overrides };
}

describe("historyShortcut", () => {
  it("Ctrl+Z i Cmd+Z cofają", () => {
    expect(historyShortcut(key({ key: "z", ctrlKey: true }))).toBe("undo");
    expect(historyShortcut(key({ key: "z", metaKey: true }))).toBe("undo");
  });

  it("Shift+Ctrl+Z i Cmd+Shift+Z ponawiają", () => {
    expect(historyShortcut(key({ key: "z", ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(historyShortcut(key({ key: "z", metaKey: true, shiftKey: true }))).toBe("redo");
  });

  it("Ctrl+Y ponawia (wariant z Windowsa/Worda)", () => {
    expect(historyShortcut(key({ key: "y", ctrlKey: true }))).toBe("redo");
    expect(historyShortcut(key({ key: "y", metaKey: true }))).toBe("redo");
  });

  it("Ctrl+Y z Shiftem nadal ponawia", () => {
    // Shift nie ma znaczenia dla `y` - liczy się tylko dla `z`.
    expect(historyShortcut(key({ key: "y", ctrlKey: true, shiftKey: true }))).toBe("redo");
  });

  it("rozpoznaje WIELKĄ literę (z Shiftem event.key przychodzi jako `Z`)", () => {
    // Bez `toLowerCase()` Shift+Ctrl+Z przestałoby ponawiać - a to najczęstszy
    // sposób wywołania „ponów" na klawiaturze.
    expect(historyShortcut(key({ key: "Z", ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(historyShortcut(key({ key: "Z", ctrlKey: true }))).toBe("undo");
    expect(historyShortcut(key({ key: "Y", ctrlKey: true }))).toBe("redo");
  });

  it("bez modyfikatora to NIE skrót historii", () => {
    // Krytyczne: `null` oznacza „nie wołaj preventDefault()". Zwrócenie akcji
    // dla samego „z" zabrałoby redaktorowi możliwość wpisania litery z.
    expect(historyShortcut(key({ key: "z" }))).toBeNull();
    expect(historyShortcut(key({ key: "y" }))).toBeNull();
    expect(historyShortcut(key({ key: "z", shiftKey: true }))).toBeNull();
  });

  it("inne skróty z modyfikatorem przechodzą dalej do przeglądarki", () => {
    // Zwrócenie akcji tutaj oznaczałoby `preventDefault()` na Ctrl+C / Ctrl+S /
    // Ctrl+A - czyli zabranie redaktorowi kopiowania i zapisu przeglądarki.
    for (const k of ["c", "v", "x", "s", "a", "b", "Enter", "Tab", "ArrowLeft"]) {
      expect(historyShortcut(key({ key: k, ctrlKey: true })), `Ctrl+${k}`).toBeNull();
      expect(historyShortcut(key({ key: k, metaKey: true })), `Cmd+${k}`).toBeNull();
    }
  });

  it("Ctrl i Cmd naciśnięte razem nadal działają", () => {
    expect(historyShortcut(key({ key: "z", ctrlKey: true, metaKey: true }))).toBe("undo");
  });
});
