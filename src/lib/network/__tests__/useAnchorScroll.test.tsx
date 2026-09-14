// Przewijanie do kotwicy deep-linku - OKNO PONAWIANIA, nie jedna próba.
//
// PO CO TEN PLIK. Pierwsza wersja naprawy A6 wołała `resolveAnchorId` w jednej
// klatce po zmianie zakładki i przechodziła test, bo test montował widok
// z wierszem JUŻ OBECNYM w DOM. Przegląd PR #361 wskazał, że w realnym
// zimnym wejściu wiersza wtedy nie ma: profil się ładuje, a wprowadzenia
// dojeżdżają trzema zapytaniami. Asercja mierzyła więc warunek, którego
// produkcja nie spełnia - klasyczne pokrycie bez kontraktu.
//
// Dlatego każdy przypadek niżej opisuje moment, w którym pierwotna wersja
// MILCZAŁA: wiersz spóźniony, drugi fragment bez przemontowania, okno
// wyczerpane, fragment już obsłużony.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const scrolled = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("@/lib/smoothAnchorScroll", () => ({
  smoothScrollToAnchor: (id: string) => scrolled.ids.push(id),
  getAnchorScrollOffset: () => 80,
  replaceHashPreservingRouterState: () => undefined,
}));

import { useAnchorScroll } from "@/lib/network/useAnchorScroll";

function addRow(id: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function setHash(hash: string): void {
  window.location.hash = hash;
}

beforeEach(() => {
  vi.useFakeTimers();
  scrolled.ids = [];
  document.body.innerHTML = "";
  setHash("");
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  setHash("");
});

describe("useAnchorScroll - wiersz obecny od razu", () => {
  it("przewija natychmiast, bez czekania na okno", () => {
    addRow("i-abc-pending");
    setHash("#i-abc-pending");

    renderHook(() => useAnchorScroll());

    expect(scrolled.ids).toEqual(["i-abc-pending"]);
  });

  it("bez fragmentu nie przewija NIGDZIE - zwykłe wejście nie skacze", () => {
    addRow("i-abc-pending");

    renderHook(() => useAnchorScroll());
    act(() => void vi.advanceTimersByTime(5_000));

    expect(scrolled.ids).toEqual([]);
  });
});

describe("useAnchorScroll - wiersz, który dojeżdża później (zimne wejście)", () => {
  it("PONAWIA, aż wiersz pojawi się w DOM - to jest cała stawka poprawki", () => {
    setHash("#i-late-pending");
    renderHook(() => useAnchorScroll());

    // Pierwsza próba trafia w pustkę: tak wygląda zimne wejście.
    expect(scrolled.ids).toEqual([]);

    act(() => void vi.advanceTimersByTime(500));
    expect(scrolled.ids).toEqual([]);

    // RPC wraca, React dorysowuje wiersz - kolejny takt okna go znajduje.
    addRow("i-late-pending");
    act(() => void vi.advanceTimersByTime(200));

    expect(scrolled.ids).toEqual(["i-late-pending"]);
  });

  it("zmiana sygnału `ready` ponawia NATYCHMIAST, bez czekania na takt", () => {
    setHash("#i-ready-pending");
    const { rerender } = renderHook(({ ready }) => useAnchorScroll(ready), {
      initialProps: { ready: 0 },
    });
    expect(scrolled.ids).toEqual([]);

    addRow("i-ready-pending");
    rerender({ ready: 1 });

    expect(scrolled.ids).toEqual(["i-ready-pending"]);
  });

  it("po wyczerpaniu okna przestaje szukać - skok do treści, na którą nikt już nie patrzy, jest gorszy niż jego brak", () => {
    setHash("#i-never-pending");
    renderHook(() => useAnchorScroll());

    act(() => void vi.advanceTimersByTime(4_100));
    addRow("i-never-pending");
    act(() => void vi.advanceTimersByTime(1_000));

    expect(scrolled.ids).toEqual([]);
  });
});

describe("useAnchorScroll - drugi fragment i powtórzenia", () => {
  it("drugie powiadomienie o TĘ SAMĄ zakładkę przewija, choć nic się nie przemontowało", () => {
    addRow("i-first-pending");
    addRow("i-second-pending");
    setHash("#i-first-pending");
    renderHook(() => useAnchorScroll());
    expect(scrolled.ids).toEqual(["i-first-pending"]);

    // Sam fragment się zmienia - komponent żyje, `ready` się nie rusza.
    act(() => {
      setHash("#i-second-pending");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(scrolled.ids).toEqual(["i-first-pending", "i-second-pending"]);
  });

  it("ten sam fragment przewija RAZ - odświeżenie danych nie szarpie widoku", () => {
    addRow("i-once-pending");
    setHash("#i-once-pending");
    const { rerender } = renderHook(({ ready }) => useAnchorScroll(ready), {
      initialProps: { ready: 0 },
    });
    expect(scrolled.ids).toEqual(["i-once-pending"]);

    rerender({ ready: 1 });
    rerender({ ready: 2 });
    act(() => void vi.advanceTimersByTime(1_000));

    expect(scrolled.ids).toEqual(["i-once-pending"]);
  });

  it("kotwica ze STARYM statusem trafia w wiersz, który zdążył się zmienić", () => {
    addRow("r-rec-1-published");
    setHash("#r-rec-1-pending");

    renderHook(() => useAnchorScroll());

    expect(scrolled.ids).toEqual(["r-rec-1-published"]);
  });

  it("odmontowanie zatrzymuje ponawianie - nie ma po czym przewijać", () => {
    setHash("#i-unmount-pending");
    const { unmount } = renderHook(() => useAnchorScroll());

    unmount();
    addRow("i-unmount-pending");
    act(() => void vi.advanceTimersByTime(2_000));

    expect(scrolled.ids).toEqual([]);
  });
});
