// Skróty klawiszowe menedżera mediów. Do 18.08.2026: 0% - 50 linii bez ani
// jednego wywołania.
//
// DLACZEGO TO WAŻNE. Ten hook wisi na `window`, więc jego zasięg jest CAŁA
// strona, a jeden ze skrótów (Delete / Backspace) uruchamia operację
// nieodwracalną. Klasyczna dziura tej klasy hooków to brak wyjątku dla pola
// tekstowego: użytkownik zmienia nazwę pliku, kasuje literę Backspace'em, a
// aplikacja kasuje zaznaczone pliki. Test niżej pilnuje tego wprost.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useMediaKeyboardShortcuts,
  type MediaKeyboardHandlers,
} from "../useMediaKeyboardShortcuts";

type Handlers = MediaKeyboardHandlers;

function makeHandlers(overrides: Partial<Handlers> = {}): Handlers {
  return {
    hasSelection: true,
    singleSelectionId: "a",
    canPaste: true,
    selectAll: vi.fn(),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    paste: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    requestDeleteSelection: vi.fn(),
    beginRename: vi.fn(),
    closeContextMenu: vi.fn(),
    clearSelection: vi.fn(),
    ...overrides,
  };
}

interface KeyOptions {
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  /** Nazwa taga, na którym stoi fokus (INPUT / TEXTAREA / DIV). */
  tag?: string;
}

/** Wysyła zdarzenie klawiatury na `window` z fokusem na wskazanym tagu. */
function press(key: string, opts: KeyOptions = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: opts.meta ?? false,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    cancelable: true,
    bubbles: true,
  });
  const target = document.createElement(opts.tag ?? "div");
  document.body.appendChild(target);
  target.dispatchEvent(event);
  target.remove();
  return event;
}

let cleanup: (() => void) | null = null;

function mount(overrides: Partial<Handlers> = {}) {
  const handlers = makeHandlers(overrides);
  const view = renderHook((props: Handlers) => useMediaKeyboardShortcuts(props), {
    initialProps: handlers,
  });
  cleanup = view.unmount;
  return { handlers, view };
}

beforeEach(() => {
  cleanup = null;
});

afterEach(() => {
  cleanup?.();
});

describe("useMediaKeyboardShortcuts - fokus w polu tekstowym", () => {
  it("Delete NIE kasuje, gdy fokus stoi w polu tekstowym", () => {
    // To jest ta dziura: zmiana nazwy pliku odbywa się w <input>, a Delete
    // bez wyjątku skasowałby zaznaczone pliki zamiast znaku.
    const { handlers } = mount();
    press("Delete", { tag: "input" });
    expect(handlers.requestDeleteSelection).not.toHaveBeenCalled();
  });

  it("Backspace NIE kasuje, gdy fokus stoi w obszarze tekstowym", () => {
    const { handlers } = mount();
    press("Backspace", { tag: "textarea" });
    expect(handlers.requestDeleteSelection).not.toHaveBeenCalled();
  });

  it("Cmd+A z pola tekstowego zaznacza TEKST, nie pliki", () => {
    const { handlers } = mount();
    press("a", { meta: true, tag: "input" });
    expect(handlers.selectAll).not.toHaveBeenCalled();
  });

  it("Escape z pola tekstowego nie czyści zaznaczenia plików", () => {
    const { handlers } = mount();
    press("Escape", { tag: "input" });
    expect(handlers.clearSelection).not.toHaveBeenCalled();
  });
});

describe("useMediaKeyboardShortcuts - zaznaczanie i schowek", () => {
  it("Cmd+A zaznacza wszystko i blokuje domyślne zachowanie przeglądarki", () => {
    const { handlers } = mount();
    const event = press("a", { meta: true });
    expect(handlers.selectAll).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Ctrl+A działa tak samo jak Cmd+A", () => {
    const { handlers } = mount();
    press("a", { ctrl: true });
    expect(handlers.selectAll).toHaveBeenCalledTimes(1);
  });

  it("Cmd+C kopiuje TYLKO przy niepustym zaznaczeniu", () => {
    const withSel = mount();
    press("c", { meta: true });
    expect(withSel.handlers.copySelection).toHaveBeenCalledTimes(1);
    cleanup?.();

    const empty = mount({ hasSelection: false });
    press("c", { meta: true });
    expect(empty.handlers.copySelection).not.toHaveBeenCalled();
  });

  it("Cmd+X wycina TYLKO przy niepustym zaznaczeniu", () => {
    const withSel = mount();
    press("x", { meta: true });
    expect(withSel.handlers.cutSelection).toHaveBeenCalledTimes(1);
    cleanup?.();

    const empty = mount({ hasSelection: false });
    press("x", { meta: true });
    expect(empty.handlers.cutSelection).not.toHaveBeenCalled();
  });

  it("Cmd+V wkleja TYLKO przy pełnym schowku", () => {
    const full = mount();
    press("v", { meta: true });
    expect(full.handlers.paste).toHaveBeenCalledTimes(1);
    cleanup?.();

    const emptyClipboard = mount({ canPaste: false });
    press("v", { meta: true });
    expect(emptyClipboard.handlers.paste).not.toHaveBeenCalled();
  });

  it("rozpoznaje skrót niezależnie od wielkości litery (Caps Lock)", () => {
    const { handlers } = mount();
    press("A", { meta: true });
    expect(handlers.selectAll).toHaveBeenCalledTimes(1);
  });
});

describe("useMediaKeyboardShortcuts - cofanie", () => {
  it("Cmd+Z cofa, a Cmd+Shift+Z ponawia", () => {
    const { handlers } = mount();
    press("z", { meta: true });
    expect(handlers.undo).toHaveBeenCalledTimes(1);
    expect(handlers.redo).not.toHaveBeenCalled();

    press("z", { meta: true, shift: true });
    expect(handlers.redo).toHaveBeenCalledTimes(1);
    expect(handlers.undo).toHaveBeenCalledTimes(1);
  });

  it("Cmd+Y ponawia - wariant windowsowy", () => {
    const { handlers } = mount();
    press("y", { meta: true });
    expect(handlers.redo).toHaveBeenCalledTimes(1);
  });
});

describe("useMediaKeyboardShortcuts - kasowanie i zmiana nazwy", () => {
  it("Delete i Backspace proszą o POTWIERDZENIE, nie kasują od razu", () => {
    // Skrót uruchamia dialog. Gdyby wołał kasowanie wprost, jedno naciśnięcie
    // klawisza byłoby operacją nieodwracalną bez pytania.
    const { handlers } = mount();
    press("Delete");
    press("Backspace");
    expect(handlers.requestDeleteSelection).toHaveBeenCalledTimes(2);
  });

  it("Delete przy pustym zaznaczeniu nic nie robi", () => {
    const { handlers } = mount({ hasSelection: false });
    press("Delete");
    expect(handlers.requestDeleteSelection).not.toHaveBeenCalled();
  });

  it("F2 zmienia nazwę TYLKO przy dokładnie jednym zaznaczonym pliku", () => {
    const single = mount();
    press("F2");
    expect(single.handlers.beginRename).toHaveBeenCalledWith("a");
    cleanup?.();

    const many = mount({ singleSelectionId: null });
    press("F2");
    expect(many.handlers.beginRename).not.toHaveBeenCalled();
  });
});

describe("useMediaKeyboardShortcuts - Escape i cykl życia", () => {
  it("Escape zamyka menu kontekstowe I czyści zaznaczenie", () => {
    const { handlers } = mount();
    press("Escape");
    expect(handlers.closeContextMenu).toHaveBeenCalledTimes(1);
    expect(handlers.clearSelection).toHaveBeenCalledTimes(1);
  });

  it("Escape NIE blokuje domyślnego zachowania - dialogi też go potrzebują", () => {
    const event = press("Escape");
    mount();
    expect(event.defaultPrevented).toBe(false);
  });

  it("czyta ZAWSZE najnowsze handlery, mimo jednorazowej rejestracji nasłuchu", () => {
    // Nasłuch rejestruje się raz (pusta lista zależności), więc bez refa
    // trzymałby domknięcie z pierwszego renderu i wołałby nieaktualne funkcje.
    const first = makeHandlers();
    const view = renderHook((props: Handlers) => useMediaKeyboardShortcuts(props), {
      initialProps: first,
    });
    cleanup = view.unmount;

    const second = makeHandlers();
    view.rerender(second);
    press("a", { meta: true });

    expect(second.selectAll).toHaveBeenCalledTimes(1);
    expect(first.selectAll).not.toHaveBeenCalled();
  });

  it("po odmontowaniu nie reaguje na żaden klawisz", () => {
    const { handlers, view } = mount();
    view.unmount();
    cleanup = null;

    press("a", { meta: true });
    press("Delete");
    expect(handlers.selectAll).not.toHaveBeenCalled();
    expect(handlers.requestDeleteSelection).not.toHaveBeenCalled();
  });

  it("ignoruje klawisz bez znaczenia w tym panelu", () => {
    const { handlers } = mount();
    press("q");
    expect(handlers.selectAll).not.toHaveBeenCalled();
    expect(handlers.requestDeleteSelection).not.toHaveBeenCalled();
    expect(handlers.clearSelection).not.toHaveBeenCalled();
  });
});
