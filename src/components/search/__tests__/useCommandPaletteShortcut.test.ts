/**
 * GLOBALNY SKRÓT PALETY POLECEŃ - próg, którego nie widać w klikaniu.
 *
 * Hak wisi na KAŻDEJ stronie (`CommandPaletteHost` w korzeniu). Dopóki `open`
 * siedziało w zależnościach efektu, każde otwarcie i zamknięcie palety
 * ZDEJMOWAŁO i ZAKŁADAŁO od nowa nasłuch `keydown` na oknie - praca w oknie
 * mierzonym jako INP dokładnie tego naciśnięcia (audyt CWV, F38). Ten plik
 * przypina trzy rzeczy:
 *
 *   1. NASŁUCH ZAKŁADANY RAZ. Przerysowania i zmiana `open` nie przepinają go;
 *      przepina go wyłącznie zmiana `enabled` (i odmontowanie go zdejmuje).
 *   2. AKTUALNE WARTOŚCI MIMO TO. Skrót czyta `open` i `setOpen` przez
 *      referencje, więc zachowanie zależne od stanu (Escape tylko przy
 *      otwartej, `/` tylko przy zamkniętej) pozostaje nietknięte - także wtedy,
 *      gdy wołający tworzy `setOpen` na nowo przy każdym renderze.
 *   3. `/` NIE KRADNIE PISANIA. W polu tekstowym i w treści edytowalnej ukośnik
 *      jest znakiem, nie skrótem.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useCommandPaletteShortcut } from "../useCommandPaletteShortcut";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Ile razy okno dostało `addEventListener("keydown", …)` / `remove…`. */
function liczKeydown() {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const ile = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === "keydown").length;
  return { dodane: () => ile(add), zdjete: () => ile(remove) };
}

function nacisnij(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
}

describe("useCommandPaletteShortcut - nasłuch zakładany RAZ", () => {
  it("zmiana `open` NIE przepina nasłuchu", () => {
    const licznik = liczKeydown();
    const setOpen = vi.fn();
    const { rerender } = renderHook(({ open }) => useCommandPaletteShortcut(open, setOpen), {
      initialProps: { open: false },
    });
    expect(licznik.dodane()).toBe(1);

    rerender({ open: true });
    rerender({ open: false });

    // To jest cały sens poprawki: otwarcie i zamknięcie palety nie mogą
    // kosztować dwóch operacji na liście nasłuchów okna.
    expect(licznik.dodane()).toBe(1);
    expect(licznik.zdjete()).toBe(0);
  });

  it("NOWY `setOpen` przy każdym renderze też nie przepina nasłuchu", () => {
    // `CommandPalette` podaje tu `onOpenChange` z propsów - wołający może je
    // tworzyć na nowo przy każdym renderze.
    const licznik = liczKeydown();
    const { rerender } = renderHook(() => useCommandPaletteShortcut(false, () => {}));
    rerender();
    rerender();
    expect(licznik.dodane()).toBe(1);
  });

  it("odmontowanie ZDEJMUJE nasłuch", () => {
    const licznik = liczKeydown();
    const { unmount } = renderHook(() => useCommandPaletteShortcut(false, vi.fn()));
    unmount();
    expect(licznik.zdjete()).toBe(1);
  });

  it("`enabled: false` nie zakłada nasłuchu w ogóle", () => {
    const licznik = liczKeydown();
    const setOpen = vi.fn();
    renderHook(() => useCommandPaletteShortcut(false, setOpen, false));
    expect(licznik.dodane()).toBe(0);
    nacisnij("k", { ctrlKey: true });
    expect(setOpen).not.toHaveBeenCalled();
  });
});

describe("useCommandPaletteShortcut - zachowanie skrótów bez zmian", () => {
  it("Ctrl/Cmd+K przełącza paletę", () => {
    const setOpen = vi.fn();
    renderHook(() => useCommandPaletteShortcut(false, setOpen));

    nacisnij("K", { ctrlKey: true });
    nacisnij("k", { metaKey: true });

    expect(setOpen).toHaveBeenCalledTimes(2);
    // Przekazujemy funkcję aktualizującą, nie wartość - stan palety może w
    // międzyczasie zmienić ktoś inny.
    expect(typeof setOpen.mock.calls[0][0]).toBe("function");
    expect(setOpen.mock.calls[0][0](false)).toBe(true);
  });

  it("Escape działa TYLKO przy otwartej palecie - i czyta AKTUALNY stan", () => {
    const setOpen = vi.fn();
    const { rerender } = renderHook(({ open }) => useCommandPaletteShortcut(open, setOpen), {
      initialProps: { open: false },
    });

    nacisnij("Escape");
    expect(setOpen).not.toHaveBeenCalled();

    // Nasłuch jest ten sam co przed chwilą - a mimo to widzi nowe `open`.
    rerender({ open: true });
    nacisnij("Escape");
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("`/` otwiera paletę tylko przy zamkniętej", () => {
    const setOpen = vi.fn();
    const { rerender } = renderHook(({ open }) => useCommandPaletteShortcut(open, setOpen), {
      initialProps: { open: false },
    });

    nacisnij("/");
    expect(setOpen).toHaveBeenCalledWith(true);

    setOpen.mockClear();
    rerender({ open: true });
    nacisnij("/");
    expect(setOpen).not.toHaveBeenCalled();
  });

  it("`/` NIE kradnie ukośnika polu tekstowemu ani treści edytowalnej", () => {
    const setOpen = vi.fn();
    renderHook(() => useCommandPaletteShortcut(false, setOpen));

    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      nacisnij("/", {}, el);
      el.remove();
    }
    const edytowalny = document.createElement("div");
    edytowalny.contentEditable = "true";
    // happy-dom nie wyprowadza `isContentEditable` z atrybutu - hak czyta
    // właśnie tę właściwość, więc test ustawia ją wprost.
    Object.defineProperty(edytowalny, "isContentEditable", { value: true });
    document.body.appendChild(edytowalny);
    nacisnij("/", {}, edytowalny);
    edytowalny.remove();

    expect(setOpen).not.toHaveBeenCalled();
  });
});
