// PREZENCJA POWIERZCHNI DOKU: wejście w dwóch klatkach, wyjście z opóźnieniem.
//
// PO CO TESTOWAĆ HAK, A NIE PANEL. Cała wartość tego haka siedzi w RYTMIE:
// stan `entering` musi przeżyć jedną klatkę (inaczej przejście CSS nie ma
// z czego animować i ruchu nie ma wcale), a `mounted` musi przeżyć czas
// wyjścia (inaczej React zdejmuje węzeł, zanim przejście się odegra). Ani
// jednej z tych rzeczy nie widać w wyrenderowanym HTML-u panelu - widać je
// wyłącznie w kolejności stanów w czasie.
//
// ZEGAR I KLATKI SĄ STEROWANE. `vi.useFakeTimers()` obejmuje w Vitest także
// `requestAnimationFrame`, więc obie osie - klatki i milisekundy - idą pod
// kontrolą testu. Bez tego test byłby wyścigiem z prawdziwym zegarem.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { DOCK_DRAWER_OUT_MS, DOCK_PANEL_OUT_MS } from "../dockMotion";
import { useDockPresence } from "../useDockPresence";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Przepuszcza jedną klatkę animacji. */
function frame(): void {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

/** Przepuszcza podany czas. */
function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("otwieranie", () => {
  it("zamknięta powierzchnia NIE JEST w drzewie", () => {
    const { result } = renderHook(() => useDockPresence(false, "panel"));
    expect(result.current.mounted).toBe(false);
  });

  it("wejście przechodzi entering -> entered, a nie od razu do stanu końcowego", () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useDockPresence(open, "panel"),
      { initialProps: { open: false } },
    );

    rerender({ open: true });
    // PIERWSZA KLATKA: węzeł już jest, ale w stanie POCZĄTKOWYM. To jest cały
    // warunek, żeby przejście CSS miało co animować - zmiana klasy w tym
    // samym cyklu, w którym węzeł wchodzi do drzewa, jest dla silnika stylu
    // jedną wartością i ruchu nie ma.
    expect(result.current.mounted).toBe(true);
    expect(result.current.state).toBe("entering");

    frame();
    expect(result.current.state).toBe("entered");
  });

  it("powierzchnia otwarta OD PIERWSZEGO RENDERU też się wysuwa", () => {
    // Przypadek realny: kliknięcie „Napisz" gdziekolwiek w serwisie wysyła
    // żądanie magistralą, a dok montuje skrzynkę od razu otwartą. Reguła jest
    // jedna - otwarcie ZAWSZE ma ruch - więc pierwszy render niesie stan
    // początkowy, a nie końcowy.
    const { result } = renderHook(() => useDockPresence(true, "drawer"));
    expect(result.current.mounted).toBe(true);
    expect(result.current.state).toBe("entering");

    frame();
    expect(result.current.state).toBe("entered");
  });
});

describe("zamykanie", () => {
  it("węzeł ZOSTAJE w drzewie przez czas wyjścia, a potem znika", () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useDockPresence(open, "panel"),
      { initialProps: { open: true } },
    );
    frame();

    rerender({ open: false });
    expect(result.current.state).toBe("exiting");
    // KLUCZOWA ASERCJA: gdyby `mounted` spadło tu na `false`, React zdjąłby
    // poddrzewo w tej samej klatce i wyjścia nie byłoby - dokładnie tak
    // zachowywał się panel przed tym hakiem.
    expect(result.current.mounted).toBe(true);

    tick(DOCK_PANEL_OUT_MS - 1);
    expect(result.current.mounted).toBe(true);

    tick(2);
    expect(result.current.mounted).toBe(false);
  });

  it("skrzynka schodzi WŁASNYM, dłuższym czasem", () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useDockPresence(open, "drawer"),
      { initialProps: { open: true } },
    );
    frame();
    rerender({ open: false });

    // Po czasie PANELU skrzynka musi jeszcze być - inaczej rozróżnienie
    // czasów w `dockExitMs` byłoby atrapą.
    tick(DOCK_PANEL_OUT_MS + 1);
    expect(result.current.mounted).toBe(true);

    tick(DOCK_DRAWER_OUT_MS - DOCK_PANEL_OUT_MS);
    expect(result.current.mounted).toBe(false);
  });
});

describe("przerwane przejścia - to tu mieszkają realne wady haków prezencji", () => {
  it("ponowne otwarcie W TRAKCIE wyjścia anuluje zdjęcie węzła", () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useDockPresence(open, "panel"),
      { initialProps: { open: true } },
    );
    frame();

    rerender({ open: false });
    tick(Math.floor(DOCK_PANEL_OUT_MS / 2));
    expect(result.current.state).toBe("exiting");

    rerender({ open: true });
    frame();
    expect(result.current.state).toBe("entered");

    // Stary licznik wyjścia MUSI być anulowany. Bez tego panel zniknąłby
    // w połowie ponownego otwarcia - użytkownik klika dwa razy szybko
    // i zostaje z pustym ekranem.
    tick(DOCK_PANEL_OUT_MS * 2);
    expect(result.current.mounted).toBe(true);
    expect(result.current.state).toBe("entered");
  });

  it("odmontowanie w trakcie wyjścia nie zostawia działającego licznika", () => {
    const { rerender, unmount } = renderHook(
      ({ open }: { open: boolean }) => useDockPresence(open, "panel"),
      { initialProps: { open: true } },
    );
    frame();
    rerender({ open: false });
    unmount();
    // Aktualizacja stanu po odmontowaniu to wyciek - tu sprawdzamy, że
    // przepuszczenie czasu nie rzuca i nie ostrzega.
    expect(() => tick(DOCK_PANEL_OUT_MS * 3)).not.toThrow();
  });

  it("dwa szybkie przełączenia nie zostawiają dwóch liczników", () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useDockPresence(open, "panel"),
      { initialProps: { open: true } },
    );
    frame();

    rerender({ open: false });
    rerender({ open: true });
    frame();
    rerender({ open: false });

    tick(DOCK_PANEL_OUT_MS - 1);
    expect(result.current.mounted).toBe(true);
    tick(2);
    expect(result.current.mounted).toBe(false);
  });
});
