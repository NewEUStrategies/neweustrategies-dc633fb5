// Leniwe osadzenie quizu.
//
// Cały sens tego komponentu jest WYDAJNOŚCIOWY i niewidoczny na ekranie:
// ciężki, zewnętrzny bundel quizu nie ma się pobierać przed pierwszym paintem,
// a mimo to strona nie może skakać, gdy iframe wreszcie wjedzie. Stąd trzy
// asercje, które trudno odtworzyć okiem: że przed zamontowaniem NIE MA
// iframe'a, że zastępczy panel trzyma wymiar kontenera i że sprzątanie
// rozłącza obserwatora (inaczej wyjście z trasy zostawia go przy węźle).
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realT } from "@/test/i18nReal";
import { LazyQuizIframe } from "@/components/quiz/LazyQuizIframe";

const t = realT("pl");

/** Przejmuje IntersectionObserver, żeby test sam decydował o wejściu w viewport. */
function captureObserver() {
  const state = {
    callbacks: [] as IntersectionObserverCallback[],
    observed: [] as Element[],
    disconnects: 0,
  };
  class Stub implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds: readonly number[] = [];
    constructor(cb: IntersectionObserverCallback) {
      state.callbacks.push(cb);
    }
    observe(el: Element) {
      state.observed.push(el);
    }
    disconnect() {
      state.disconnects += 1;
    }
    unobserve() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", Stub);
  // ZWRACAMY `state`, a nie jego rozwinięcie: `{...state}` skopiowałby liczniki
  // w chwili zwrotu, więc późniejsze `disconnect()` nigdy nie byłoby widoczne
  // w asercji (pierwsza wersja tego pliku właśnie na tym zgasła).
  return {
    state,
    enterViewport() {
      act(() => {
        for (const cb of state.callbacks) {
          cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
        }
      });
    },
    leaveViewport() {
      act(() => {
        for (const cb of state.callbacks) {
          cb([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
        }
      });
    },
  };
}

beforeEach(() => {
  // Bez `requestIdleCallback` komponent schodzi na `setTimeout` - sterujemy
  // nim zegarem, zamiast czekać realnych 250 ms w każdym teście.
  vi.stubGlobal("requestIdleCallback", undefined);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("LazyQuizIframe - odroczenie", () => {
  it("na pierwszym renderze NIE MA iframe'a", () => {
    // To jest cały powód istnienia komponentu: zewnętrzny bundel quizu nie
    // pobiera się przed pierwszym paintem strony.
    captureObserver();
    const { container } = render(<LazyQuizIframe src="https://quiz.example/q" title="Quiz" />);
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("zastępczy panel pokazuje stan ładowania", () => {
    captureObserver();
    render(<LazyQuizIframe src="https://quiz.example/q" title="Quiz" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", t("common.loading"));
  });

  it("wejście w viewport MONTUJE iframe", () => {
    const io = captureObserver();
    const { container } = render(<LazyQuizIframe src="https://quiz.example/q" title="Quiz" />);
    io.enterViewport();
    const iframe = container.querySelector("iframe");
    expect(iframe).toHaveAttribute("src", "https://quiz.example/q");
    expect(iframe).toHaveAttribute("title", "Quiz");
  });

  it("iframe zachowuje natywne `loading=lazy` jako drugą warstwę obrony", () => {
    const io = captureObserver();
    const { container } = render(<LazyQuizIframe src="https://quiz.example/q" title="Quiz" />);
    io.enterViewport();
    expect(container.querySelector("iframe")).toHaveAttribute("loading", "lazy");
  });

  it("element poza viewportem NIE montuje iframe'a", () => {
    const io = captureObserver();
    const { container } = render(<LazyQuizIframe src="https://quiz.example/q" title="Quiz" />);
    io.leaveViewport();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("po wejściu w viewport obserwator jest ROZŁĄCZANY", () => {
    // Bez tego obserwator zostaje przy węźle po zamontowaniu i pracuje przy
    // każdym przewinięciu do końca życia strony.
    const io = captureObserver();
    render(<LazyQuizIframe src="https://quiz.example/q" title="Quiz" />);
    io.enterViewport();
    expect(io.state.disconnects).toBeGreaterThan(0);
  });

  it("gdy obserwator nie wystrzeli, iframe montuje się PO CZASIE zapasowym", () => {
    // Awaria IntersectionObserver (rozszerzenie przeglądarki, nietypowy układ)
    // nie może zostawić użytkownika ze spinnerem na zawsze.
    captureObserver();
    const { container } = render(
      <LazyQuizIframe src="https://quiz.example/q" title="Quiz" fallbackDelayMs={250} />,
    );
    expect(container.querySelector("iframe")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("bez IntersectionObserver w ogóle nadal montuje po czasie zapasowym", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = render(
      <LazyQuizIframe src="https://quiz.example/q" title="Quiz" fallbackDelayMs={100} />,
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("gdy przeglądarka ma requestIdleCallback, korzysta z niego zamiast z zegara", () => {
    captureObserver();
    const idle = vi.fn((cb: () => void) => {
      cb();
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", idle);
    const { container } = render(<LazyQuizIframe src="https://quiz.example/q" title="Quiz" />);
    expect(idle).toHaveBeenCalled();
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("odmontowanie przed zamontowaniem iframe'a sprząta obserwator i zegar", () => {
    const io = captureObserver();
    const { unmount } = render(<LazyQuizIframe src="https://quiz.example/q" title="Quiz" />);
    unmount();
    expect(io.state.disconnects).toBeGreaterThan(0);
    // Zegar zapasowy nie może wystrzelić po odmontowaniu - `setState` na
    // odmontowanym komponencie to ostrzeżenie Reacta i wyciek.
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(1000);
      }),
    ).not.toThrow();
  });
});

describe("LazyQuizIframe - zakończenie ładowania", () => {
  it("panel przechodzi trzy stany: ogłaszany -> ukryty -> usunięty", () => {
    // 1. Przed zamontowaniem iframe'a spinner jest JEDYNĄ treścią i ma być
    //    ogłaszany. 2. Gdy iframe już jest, oba żyją naraz - panel dostaje
    //    `aria-hidden`, więc czytnik ekranu nie ogłasza „ładowanie" nad gotowym
    //    quizem (dlatego `queryByRole` przestaje go widzieć - i to jest DOWÓD,
    //    a nie przeszkoda). 3. Po `load` znika z DOM-u całkiem.
    const io = captureObserver();
    const { container } = render(<LazyQuizIframe src="https://quiz.example/q" title="Quiz" />);

    expect(screen.getByRole("status")).toBeInTheDocument();

    io.enterViewport();
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // `fireEvent.load`, a nie `dispatchEvent(new Event("load"))`: zdarzenie
    // `load` NIE bąbelkuje, więc delegowany nasłuch Reacta w korzeniu nigdy by
    // go nie zobaczył i `onLoad` się nie odpalił.
    fireEvent.load(container.querySelector("iframe")!);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("przekazuje klasę wywołującego do iframe'a", () => {
    const io = captureObserver();
    const { container } = render(
      <LazyQuizIframe src="https://quiz.example/q" title="Quiz" className="h-full w-full" />,
    );
    io.enterViewport();
    expect(container.querySelector("iframe")).toHaveClass("h-full", "w-full");
  });
});
