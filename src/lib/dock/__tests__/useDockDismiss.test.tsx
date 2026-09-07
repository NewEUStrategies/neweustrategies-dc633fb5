// ESCAPE, KTÓRY NIE KRADNIE CUDZYCH ZDARZEŃ, I OGNISKO Z POWROTEM.
//
// ── DEFEKT, KTÓRY TU JEST PRZYPIĘTY ─────────────────────────────────────
// Panel i skrzynka nasłuchiwały Escape na `document`/`window` i zamykały się
// bezwarunkowo. W środku panelu żyją jednak WARSTWY RADIKSA (`Select`
// priorytetu w panelu zadań, `Dialog` grupy w skrzynce), które nasłuchują
// Escape w fazie PRZECHWYTYWANIA i po obsłużeniu wołają `preventDefault()`.
// Nasłuch doku dostawał to samo zdarzenie chwilę później i zamykał TAKŻE
// panel - użytkownik naciskał Escape, żeby zamknąć listę priorytetów,
// a tracił cały panel razem z wpisywanym zadaniem.
//
// Test odtwarza dokładnie tę sekwencję: nasłuch w fazie przechwytywania
// (jak Radix) woła `preventDefault`, a hak doku MUSI wtedy zamilczeć.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { useDockEscape, useDockFocusReturn } from "../useDockDismiss";

afterEach(() => cleanup());

/** Wysyła Escape na dokument tak, jak przeglądarka: z bąbelkowaniem. */
function pressEscape(): void {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

function pressKey(key: string): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("useDockEscape", () => {
  it("Escape zamyka otwartą powierzchnię", () => {
    const onClose = vi.fn();
    renderHook(() => useDockEscape(true, onClose));
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("NIE zamyka, gdy warstwa wyżej już to zdarzenie obsłużyła", () => {
    // To jest cała naprawa. Radix po zamknięciu swojej listy woła
    // `preventDefault()`, a `defaultPrevented` jest jedynym kryterium.
    const onClose = vi.fn();
    renderHook(() => useDockEscape(true, onClose));

    const radixLike = (event: Event) => event.preventDefault();
    document.addEventListener("keydown", radixLike, { capture: true });
    try {
      pressEscape();
    } finally {
      document.removeEventListener("keydown", radixLike, { capture: true });
    }

    expect(onClose).not.toHaveBeenCalled();
  });

  it("po zamknięciu warstwy Radiksa NASTĘPNY Escape zamyka już panel", () => {
    // Bez tej asercji poprawka mogłaby wyciszyć Escape na zawsze - a Escape
    // ma zamykać panel, kiedy nic innego nie jest otwarte.
    const onClose = vi.fn();
    renderHook(() => useDockEscape(true, onClose));

    const radixLike = (event: Event) => event.preventDefault();
    document.addEventListener("keydown", radixLike, { capture: true });
    pressEscape();
    document.removeEventListener("keydown", radixLike, { capture: true });

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("nie nasłuchuje wcale, gdy powierzchnia jest zamknięta", () => {
    const onClose = vi.fn();
    renderHook(() => useDockEscape(false, onClose));
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignoruje każdy inny klawisz", () => {
    const onClose = vi.fn();
    renderHook(() => useDockEscape(true, onClose));
    for (const key of ["Enter", "Tab", " ", "Esc", "a"]) pressKey(key);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("odmontowanie zdejmuje nasłuch", () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useDockEscape(true, onClose));
    unmount();
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("zamknięcie powierzchni zdejmuje nasłuch bez odmontowania haka", () => {
    const onClose = vi.fn();
    const { rerender } = renderHook(({ open }: { open: boolean }) => useDockEscape(open, onClose), {
      initialProps: { open: true },
    });
    rerender({ open: false });
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("useDockFocusReturn", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function Harness() {
    const focus = useDockFocusReturn();
    return (
      <div>
        <button type="button" data-dock-tab="todos" data-testid="tab">
          zakładka
        </button>
        <button type="button" data-testid="capture" onClick={focus.capture}>
          zapamiętaj
        </button>
        <button type="button" data-testid="restore" onClick={() => focus.restore("todos")}>
          przywróć
        </button>
      </div>
    );
  }

  it("przywraca ognisko elementowi, który je miał przy otwieraniu", () => {
    const { getByTestId } = render(<Harness />);
    const tab = getByTestId("tab");
    tab.focus();

    // `capture` czyta `document.activeElement`, więc wołamy je bez zabierania
    // ogniska - dokładnie tak, jak robi to procedura otwarcia panelu.
    act(() => {
      getByTestId("capture").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Panel zabiera ognisko na siebie.
    getByTestId("restore").focus();
    expect(document.activeElement).not.toBe(tab);

    act(() => {
      getByTestId("restore").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      vi.advanceTimersByTime(32);
    });
    expect(document.activeElement).toBe(tab);
  });

  it("gdy zapamiętany element ZNIKNĄŁ z drzewa, sięga po zakładkę", () => {
    // Realna ścieżka: pasek przemontowuje się przy przejściu na trasę
    // z `ownChrome`, więc zapamiętany węzeł przestaje być podłączony.
    const { getByTestId } = render(<Harness />);
    const ghost = document.createElement("button");
    document.body.appendChild(ghost);
    ghost.focus();

    act(() => {
      getByTestId("capture").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    ghost.remove();

    act(() => {
      getByTestId("restore").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      vi.advanceTimersByTime(32);
    });
    expect(document.activeElement).toBe(getByTestId("tab"));
  });

  it("bez zapamiętanego elementu i bez zakładki nie rzuca", () => {
    const { result } = renderHook(() => useDockFocusReturn());
    expect(() => {
      act(() => {
        result.current.restore(null);
        vi.advanceTimersByTime(32);
      });
    }).not.toThrow();
  });
});
