// Autozapis szkicu tematu.
//
// Testujemy KONTRAKT PAMIĘCI, nie renderowanie: co ląduje w localStorage, co
// się z niego czyta i co go czyści. To jest ta część, która decyduje, czy
// osoba, która przypadkiem zamknęła kartę po dwudziestu minutach pisania,
// odzyska tekst - a nie to, jak wygląda pasek wznowienia.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useThreadDraft } from "../useThreadDraft";

const CLUB = "11111111-1111-4111-8111-111111111111";
const KEY = `nes.club.threadDraft.${CLUB}`;
const DEBOUNCE_MS = 600;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

function stored(): { title?: unknown; body?: unknown; savedAt?: unknown } | null {
  const raw = window.localStorage.getItem(KEY);
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

describe("zapis", () => {
  it("zapisuje dopiero po ciszy w pisaniu, nie po każdym znaku", () => {
    const { rerender } = renderHook(({ b }) => useThreadDraft(CLUB, "Tytuł tematu", b), {
      initialProps: { b: "pierwsze zdanie" },
    });
    act(() => void vi.advanceTimersByTime(DEBOUNCE_MS - 50));
    expect(stored(), "przed upływem debounce nie ma czego zapisywać").toBeNull();

    rerender({ b: "pierwsze zdanie i drugie" });
    act(() => void vi.advanceTimersByTime(DEBOUNCE_MS - 50));
    expect(stored(), "kolejne uderzenie w klawisz resetuje odliczanie").toBeNull();

    act(() => void vi.advanceTimersByTime(100));
    expect(stored()?.body).toBe("pierwsze zdanie i drugie");
  });

  it("kasuje wpis dopiero, gdy formularz jest pusty W CAŁOŚCI", () => {
    const { rerender } = renderHook(({ tt, b }) => useThreadDraft(CLUB, tt, b), {
      initialProps: { tt: "Tytuł tematu", b: "coś tam" },
    });
    act(() => void vi.advanceTimersByTime(DEBOUNCE_MS));
    expect(stored()).not.toBeNull();

    // Sam tytuł to nadal rozpoczęta praca - kasowanie szkicu po wyczyszczeniu
    // treści zabierałoby ją w połowie ruchu "przepiszę to inaczej".
    rerender({ tt: "Tytuł tematu", b: "   " });
    act(() => void vi.advanceTimersByTime(DEBOUNCE_MS));
    expect(stored()?.title).toBe("Tytuł tematu");

    rerender({ tt: "", b: "" });
    act(() => void vi.advanceTimersByTime(DEBOUNCE_MS));
    expect(stored(), "pusty formularz nie jest szkicem do wznowienia").toBeNull();
  });

  it("nie dotyka pamięci, dopóki klub się nie rozwiązał", () => {
    renderHook(() => useThreadDraft(undefined, "Tytuł tematu", "treść"));
    act(() => void vi.advanceTimersByTime(DEBOUNCE_MS * 2));
    expect(window.localStorage.length).toBe(0);
  });

  it("trzyma szkice różnych klubów pod różnymi kluczami", () => {
    const other = "22222222-2222-4222-8222-222222222222";
    renderHook(() => useThreadDraft(CLUB, "Pierwszy", "treść A"));
    renderHook(() => useThreadDraft(other, "Drugi", "treść B"));
    act(() => void vi.advanceTimersByTime(DEBOUNCE_MS));
    expect(stored()?.body).toBe("treść A");
    expect(
      JSON.parse(window.localStorage.getItem(`nes.club.threadDraft.${other}`) ?? "{}").body,
    ).toBe("treść B");
  });
});

describe("odczyt", () => {
  it("wznawia szkic zastany przy wejściu na formularz", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ title: "Zaczęty temat", body: "Kilka akapitów", savedAt: Date.now() }),
    );
    const { result } = renderHook(() => useThreadDraft(CLUB, "", ""));
    expect(result.current.restored?.title).toBe("Zaczęty temat");
    expect(result.current.restored?.body).toBe("Kilka akapitów");
  });

  it("szkic starszy niż tydzień jest kasowany, a nie podpowiadany", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        title: "Stary",
        body: "Sprzed miesiąca",
        savedAt: Date.now() - WEEK_MS - 1,
      }),
    );
    const { result } = renderHook(() => useThreadDraft(CLUB, "", ""));
    expect(result.current.restored).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("uszkodzony wpis nie wywraca formularza", () => {
    window.localStorage.setItem(KEY, "{to nie jest json");
    const { result } = renderHook(() => useThreadDraft(CLUB, "", ""));
    expect(result.current.restored).toBeNull();
  });

  it("wpis bez treści nie jest szkicem", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ title: "  ", body: "", savedAt: Date.now() }),
    );
    expect(renderHook(() => useThreadDraft(CLUB, "", "")).result.current.restored).toBeNull();
  });
});

describe("czyszczenie", () => {
  it("`discard` kasuje pamięć i chowa pasek wznowienia", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ title: "Zaczęty", body: "treść", savedAt: Date.now() }),
    );
    const { result } = renderHook(() => useThreadDraft(CLUB, "", ""));
    act(() => result.current.discard());
    expect(result.current.restored).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  // Publikacja przechodzi, a chwilę potem nawigacja odmontowuje formularz.
  // Gdyby `clear()` nie zablokowało dalszych zapisów, wiszący timer zapisałby
  // szkic z pól, które właśnie trafiły do bazy - i przy następnym wejściu
  // formularz proponowałby wznowienie tekstu, który jest już opublikowany.
  it("`clear` blokuje zapis szkicu po udanej publikacji", () => {
    const { result, rerender } = renderHook(({ b }) => useThreadDraft(CLUB, "Tytuł tematu", b), {
      initialProps: { b: "opublikowana treść" },
    });
    act(() => result.current.clear());
    rerender({ b: "opublikowana treść" });
    act(() => void vi.advanceTimersByTime(DEBOUNCE_MS * 3));
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
