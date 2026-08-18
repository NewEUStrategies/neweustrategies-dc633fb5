// Podgląd „zobacz jak gość” - wspólny magazyn dla strony /profile i jej layoutu.
// Moduł stał na ZERZE pokrycia, a niesie dwa warunki, których złamanie widzi
// wyłącznie użytkownik.
//
// PIERWSZY: SYNCHRONIZACJA DWÓCH DRZEW. Przełącznik żyje na `profile.index`,
// a chować pasek boczny musi `profile.tsx` (layout) - są w różnych miejscach
// drzewa Reacta i nie mają wspólnego rodzica poniżej trasy. Stan jest więc
// modułowy, a subskrypcja przez `useSyncExternalStore`. Gdyby powiadamianie
// przestało działać, przełącznik przestawiałby się, a kompozycja strony NIE -
// czyli podgląd gościa pokazywałby widok właściciela.
//
// DRUGI: SSR. Stan jest MODUŁOWY, więc na serwerze żyje tyle, ile proces -
// wspólny dla wszystkich żądań. `getServerSnapshot` zwraca dlatego twarde
// `false`: bez tego przełącznik ustawiony przez jedno żądanie wyciekłby do HTML
// generowanego dla kolejnego (i to obcego) użytkownika. Ta asercja jedzie przez
// `renderToStaticMarkup`, bo tylko renderowanie serwerowe wchodzi w tę gałąź.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { setGuestPreview, useGuestPreview } from "../guestPreviewStore";

/** Sonda: wypisuje stan magazynu, żeby dało się go czytać z DOM/HTML. */
function Probe(): React.ReactElement {
  const asGuest = useGuestPreview();
  return <span data-testid="probe">{asGuest ? "gosc" : "wlasciciel"}</span>;
}

// Magazyn jest MODUŁOWY - bez zerowania stan przecieka między testami
// dokładnie tak, jak przeciekałby między żądaniami SSR.
beforeEach(() => setGuestPreview(false));
afterEach(() => setGuestPreview(false));

describe("useGuestPreview", () => {
  it("startuje na widoku właściciela", () => {
    const { result } = renderHook(() => useGuestPreview());
    expect(result.current).toBe(false);
  });

  it("reaguje na przestawienie magazynu Z ZEWNĄTRZ komponentu", () => {
    const { result } = renderHook(() => useGuestPreview());
    act(() => setGuestPreview(true));
    expect(result.current).toBe(true);
    act(() => setGuestPreview(false));
    expect(result.current).toBe(false);
  });

  it("powiadamia WSZYSTKICH subskrybentów - przełącznik i layout naraz", () => {
    // To jest właściwy powód istnienia modułu: strona i layout są w różnych
    // miejscach drzewa. Gdyby powiadomienie dochodziło tylko do jednego,
    // podgląd gościa pokazywałby widok właściciela.
    const first = renderHook(() => useGuestPreview());
    const second = renderHook(() => useGuestPreview());

    act(() => setGuestPreview(true));

    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(true);
  });

  it("odmontowany subskrybent nie blokuje pozostałych", () => {
    // Wyciek w `subscribe` (brak wypisania) trzymałby w pamięci komponenty
    // odmontowanych tras i wołał ich `setState` po unmount.
    const staying = renderHook(() => useGuestPreview());
    const leaving = renderHook(() => useGuestPreview());
    leaving.unmount();

    act(() => setGuestPreview(true));

    expect(staying.result.current).toBe(true);
  });

  it("przepisuje stan na DOM, nie tylko na wartość hooka", () => {
    const { getByTestId } = render(<Probe />);
    expect(getByTestId("probe").textContent).toBe("wlasciciel");
    act(() => setGuestPreview(true));
    expect(getByTestId("probe").textContent).toBe("gosc");
  });
});

describe("setGuestPreview", () => {
  it("ustawienie TEJ SAMEJ wartości nie budzi subskrybentów", () => {
    // Bez wczesnego wyjścia każdy render przełącznika (a ten reaguje na
    // hover/focus) wymuszałby ponowne renderowanie całego layoutu profilu.
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useGuestPreview();
    });
    const baseline = renders;

    act(() => setGuestPreview(false));

    expect(renders).toBe(baseline);
  });

  it("jest idempotentne - dwa razy `true` daje jeden stan", () => {
    const { result } = renderHook(() => useGuestPreview());
    act(() => {
      setGuestPreview(true);
      setGuestPreview(true);
    });
    expect(result.current).toBe(true);
  });
});

describe("SSR", () => {
  it("renderowanie serwerowe pokazuje widok właściciela NAWET przy włączonym podglądzie", () => {
    // Stan modułowy na serwerze jest wspólny dla całego procesu. Gdyby SSR
    // czytał `getSnapshot`, przełącznik ustawiony przez jedno żądanie wyciekłby
    // do HTML-a generowanego dla obcego użytkownika.
    setGuestPreview(true);
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain("wlasciciel");
    expect(html).not.toContain("gosc");
  });

  it("stan klienta zostaje nietknięty po renderze serwerowym", () => {
    setGuestPreview(true);
    renderToStaticMarkup(<Probe />);
    const { result } = renderHook(() => useGuestPreview());
    expect(result.current).toBe(true);
  });
});
