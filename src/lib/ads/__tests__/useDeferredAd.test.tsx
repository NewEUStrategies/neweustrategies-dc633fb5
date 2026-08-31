// Bramki odroczonego ładowania reklamy: `src/lib/ads/useDeferredAd.ts`.
//
// PO CO TEN PLIK ISTNIEJE. Ten hak jest jedynym powodem, dla którego reklamy
// tego serwisu nie psują Core Web Vitals: kreacja nie rusza z miejsca, dopóki
// nie otworzą się OBIE bramki - bezczynności wątku głównego (ochrona LCP)
// i bliskości viewportu (ochrona INP i transferu). Uszkodzenie którejkolwiek
// jest niewidoczne w każdym teście renderującym: strona nadal się wyświetla,
// reklama nadal się pokazuje, tylko metryki lecą w dół i widać to dopiero
// w Lighthouse albo w Search Console, tygodnie po wdrożeniu.
//
// Druga strona tego samego ryzyka jest gorsza: zerwana bramka viewportu
// (np. `containerRef` przestaje trafiać do węzła DOM) NIE psuje niczego
// widocznego - po prostu ŻADNA reklama nigdy się nie doładowuje, w ciszy.
// Dlatego degradacja „brak IntersectionObserver -> traktuj jak widoczne" ma
// tu jawny test, a nie komentarz.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE PRZEGLĄDARKI: IntersectionObserver
// i requestIdleCallback. Sam hak oraz `whenIdle` biegną prawdziwe.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useDeferredAd, type DeferredAdOptions } from "@/lib/ads/useDeferredAd";

interface ObserverRecord {
  readonly rootMargin: string;
  readonly targets: Element[];
  disconnected: number;
  fire(): void;
}

const observers: ObserverRecord[] = [];

/** Atrapa obserwatora, którą test otwiera RĘCZNIE - bramka ma być sterowalna. */
class ControlledIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number> = [];
  private readonly cb: IntersectionObserverCallback;
  private readonly record: ObserverRecord;

  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.cb = cb;
    this.rootMargin = options?.rootMargin ?? "";
    const record: ObserverRecord = {
      rootMargin: this.rootMargin,
      targets: [],
      disconnected: 0,
      // Strzalka domyka `this` leksykalnie - aliasowanie do `self` bylo tu
      // jedynie obejsciem tego, ze metoda skrocona ma wlasne `this`.
      fire: () => {
        for (const target of record.targets) {
          this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this);
        }
      },
    };
    this.record = record;
    observers.push(this.record);
  }

  observe(target: Element): void {
    this.record.targets.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    this.record.disconnected += 1;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function Slot({ options }: { options?: DeferredAdOptions }) {
  const { containerRef, shouldRender } = useDeferredAd<HTMLDivElement>(options);
  return <div ref={containerRef} data-testid="pudelko" data-ready={shouldRender ? "1" : "0"} />;
}

/** Wariant BEZ przypiętego refa - odwzorowuje slot, który nie trafił do DOM. */
function SlotWithoutRef({ options }: { options?: DeferredAdOptions }) {
  const { shouldRender } = useDeferredAd<HTMLDivElement>(options);
  return <div data-testid="pudelko" data-ready={shouldRender ? "1" : "0"} />;
}

function ready(): boolean {
  return screen.getByTestId("pudelko").getAttribute("data-ready") === "1";
}

/** Otwiera bramkę bezczynności: `whenIdle` bez rIC schodzi na setTimeout(32). */
async function openIdleGate() {
  await act(async () => {
    vi.advanceTimersByTime(50);
    await Promise.resolve();
  });
}

async function openViewportGate() {
  await act(async () => {
    for (const observer of observers) observer.fire();
    await Promise.resolve();
  });
}

const realIntersectionObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  observers.length = 0;
  globalThis.IntersectionObserver = ControlledIntersectionObserver;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  globalThis.IntersectionObserver = realIntersectionObserver;
});

// ---------------------------------------------------------------------------
describe("obie bramki muszą się otworzyć", () => {
  it("na starcie nic się nie ładuje - ani jedna bramka nie jest otwarta", () => {
    render(<Slot />);

    expect(ready()).toBe(false);
  });

  it("sama bezczynność wątku NIE wystarcza - slot poza ekranem czeka", async () => {
    render(<Slot />);

    await openIdleGate();

    // Bez tej bramki serwis pobierałby kreacje wszystkich stref naraz, także
    // tych kilka ekranów niżej, których czytelnik nigdy nie zobaczy.
    expect(ready()).toBe(false);
  });

  it("samo wejście w viewport NIE wystarcza - kreacja nie konkuruje z LCP", async () => {
    render(<Slot />);

    await openViewportGate();

    expect(ready()).toBe(false);
  });

  it("po otwarciu OBU bramek kreacja może ruszyć", async () => {
    render(<Slot />);

    await openIdleGate();
    await openViewportGate();

    expect(ready()).toBe(true);
  });

  it("kolejność otwierania bramek nie ma znaczenia", async () => {
    render(<Slot />);

    await openViewportGate();
    await openIdleGate();

    expect(ready()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("obserwator viewportu", () => {
  it("obserwuje DOKŁADNIE ten węzeł, który dostał ref", () => {
    render(<Slot />);

    expect(observers).toHaveLength(1);
    expect(observers[0].targets).toEqual([screen.getByTestId("pudelko")]);
  });

  it("domyślny margines wyprzedzenia daje kreacji zapas przed wjazdem na ekran", () => {
    render(<Slot />);

    // Bez wyprzedzenia kreacja startowałaby dopiero na krawędzi ekranu i
    // czytelnik zobaczyłby pustą ramkę zamiast reklamy.
    expect(observers[0].rootMargin).toBe("200px 0px");
  });

  it("margines da się nadpisać per strefa", () => {
    render(<Slot options={{ rootMargin: "600px 0px" }} />);

    expect(observers[0].rootMargin).toBe("600px 0px");
  });

  it("rozłącza się po PIERWSZYM przecięciu - nie zostaje na stronie", async () => {
    render(<Slot />);

    await openViewportGate();

    expect(observers[0].disconnected).toBeGreaterThan(0);
  });

  it("odmontowanie strefy rozłącza obserwatora", () => {
    const { unmount } = render(<Slot />);

    unmount();

    // Nierozłączony obserwator trzyma referencję do usuniętego węzła -
    // wyciek pamięci mnożący się przez każdą nawigację w SPA.
    expect(observers[0].disconnected).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe("degradacja: brak IntersectionObserver albo brak węzła", () => {
  it("bez IntersectionObserver slot uznaje się za widoczny i czeka tylko na bezczynność", async () => {
    const restore = globalThis.IntersectionObserver;
    // @ts-expect-error celowe usunięcie API przeglądarki - odwzorowanie SSR
    // i starszych silników; bez tej gałęzi reklamy NIGDY by się nie ładowały.
    delete globalThis.IntersectionObserver;
    try {
      render(<Slot />);

      await openIdleGate();

      expect(ready()).toBe(true);
    } finally {
      globalThis.IntersectionObserver = restore;
    }
  });

  it("gdy ref nie trafił do węzła, bramka viewportu też przepuszcza", async () => {
    render(<SlotWithoutRef />);

    await openIdleGate();

    // „Bezpiecznie" znaczy tu: pokaż reklamę. Cicha odmowa ładowania byłaby
    // utratą całego przychodu bez jednego błędu w logu.
    expect(ready()).toBe(true);
    expect(observers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("wyłącznik (disabled)", () => {
  it("wyłączony slot nigdy nie melduje gotowości", async () => {
    render(<Slot options={{ disabled: true }} />);

    await openIdleGate();
    await openViewportGate();

    expect(ready()).toBe(false);
  });

  it("wyłączony slot nie zakłada obserwatora", () => {
    render(<Slot options={{ disabled: true }} />);

    // Slot bez zgody marketingowej pokazuje sam placeholder - obserwowanie go
    // byłoby czystym kosztem na każdej stronie u każdego, kto zgody nie dał.
    expect(observers).toHaveLength(0);
  });

  it("zdjęcie wyłącznika uruchamia obie bramki od nowa", async () => {
    const { rerender } = render(<Slot options={{ disabled: true }} />);

    rerender(<Slot options={{ disabled: false }} />);
    await openIdleGate();
    await openViewportGate();

    // Tak wygląda udzielenie zgody marketingowej bez przeładowania strony.
    expect(ready()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("bramka bezczynności korzysta z requestIdleCallback, gdy jest", () => {
  it("przekazuje górny limit czasu do requestIdleCallback", async () => {
    const calls: Array<{ timeout?: number }> = [];
    // happy-dom nie ma tego API, więc `whenIdle` schodzi na `setTimeout`.
    // Wstawiamy własną implementację, żeby udowodnić gałąź, która w prawdziwej
    // przeglądarce obsługuje KAŻDĄ reklamę.
    const originalRequest = window.requestIdleCallback;
    const originalCancel = window.cancelIdleCallback;
    window.requestIdleCallback = (cb, options) => {
      calls.push(options ?? {});
      cb({ didTimeout: false, timeRemaining: () => 0 });
      return 1;
    };
    window.cancelIdleCallback = () => {};
    try {
      render(<Slot options={{ idleTimeout: 1200 }} />);
      await openViewportGate();

      // Limit jest gwarancją, że reklama pojawi się nawet na stronie, która
      // nigdy nie dochodzi do bezczynności (ciężkie skrypty, wolne urządzenie).
      expect(calls).toEqual([{ timeout: 1200 }]);
      expect(ready()).toBe(true);
    } finally {
      window.requestIdleCallback = originalRequest;
      window.cancelIdleCallback = originalCancel;
    }
  });
});
