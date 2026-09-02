// `EChartClient` - koszt renderu panelu BI, mierzony, nie deklarowany.
//
// PO CO. Ten plik stał na zerze (0/21 linii), a jest jedynym miejscem, w którym
// aplikacja dotyka ECharts. Dwie rzeczy trzeba tu pilnować:
//
//  1. KOSZT. Stało tu `useEffect(() => setTick(v => v + 1), [])` - efekt bez
//     warunku, odpalany RAZ NA WYKRES, żeby ponownie odczytać tokeny motywu,
//     gdyby provider nie zapisał ich na `html` przed pierwszym malowaniem.
//     Skutek: panel z dziesięcioma wykresami to dziesięć dodatkowych renderów i
//     dwadzieścia rozwiązań motywu - a każde rozwiązanie wołało
//     `getComputedStyle` dziesięć razy (raz na token). Rachunek dla dziesięciu
//     wykresów: 200 wymuszeń przeliczenia stylu.
//  2. POPRAWNOŚĆ. Powód, dla którego ten efekt istniał, jest PRAWDZIWY:
//     `DesignTokensStyle` wstrzykuje tokeny tenanta z bazy przez zapytanie
//     react-query, więc `--primary` czy `--foreground` mogą dojechać PO
//     pierwszym malowaniu wykresu. Optymalizacja, która to gubi, jest regresem,
//     nie przyspieszeniem.
//
// Rozwiązanie mierzone niżej: JEDNA wspólna subskrypcja motywu zamiast N
// efektów. Motyw jest rozwiązywany raz na „epokę", porównywany z poprzednim i
// rozgłaszany TYLKO gdy się zmienił. Gdy tokeny były gotowe od pierwszego
// malowania (przypadek typowy) - zero dodatkowych renderów. Gdy dojechały
// później - dokładnie jedna runda odświeżenia, czyli to, co efekt miał
// zapewniać.
//
// ATRAPY. `echarts` i `echarts-for-react` są tu podmienione, i to nie dla
// wygody: prawdziwy `echarts.init` potrzebuje kontekstu canvas, którego
// happy-dom nie ma, a poza tym ściągnięcie ~1 MB biblioteki do procesu
// testowego jest dokładnie tym, czego zakazuje nagłówek `EChart.tsx`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { EChartsCoreOption } from "echarts/core";

const h = vi.hoisted(() => ({
  chartRenders: 0,
  handlers: new Map<string, (p: unknown) => void>(),
  lastOption: null as Record<string, unknown> | null,
  offCalls: 0,
}));

const instance = {
  on: (event: string, handler: (p: unknown) => void) => h.handlers.set(event, handler),
  off: () => {
    h.offCalls += 1;
  },
};

// Atrapa musi być KLASĄ, nie funkcją: `EChartClient` sięga po instancję przez
// `ref.current.getEchartsInstance()`, a do komponentu funkcyjnego bez
// `forwardRef` ref w ogóle się nie przypina - atrapa funkcyjna „przechodziłaby"
// przez ciche pominięcie rejestracji kliknięcia i `onReady`.
vi.mock("echarts-for-react/lib/core", async () => {
  const { Component: ReactComponent } = await import("react");
  interface Props {
    option: Record<string, unknown>;
  }
  class ReactECharts extends ReactComponent<Props> {
    getEchartsInstance() {
      return instance;
    }
    render() {
      h.chartRenders += 1;
      h.lastOption = this.props.option;
      return <div data-testid="react-echarts" />;
    }
  }
  return { default: ReactECharts };
});
vi.mock("echarts/core", () => ({ use: () => {}, init: () => instance }));
vi.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));
vi.mock("echarts/charts", () => ({
  BarChart: {},
  LineChart: {},
  PieChart: {},
  HeatmapChart: {},
  TreemapChart: {},
  GaugeChart: {},
  RadarChart: {},
  SankeyChart: {},
  ScatterChart: {},
}));
vi.mock("echarts/components", () => ({
  TooltipComponent: {},
  LegendComponent: {},
  GridComponent: {},
  DataZoomComponent: {},
  MarkAreaComponent: {},
  MarkLineComponent: {},
  TitleComponent: {},
  VisualMapComponent: {},
  ToolboxComponent: {},
  CalendarComponent: {},
}));

import { EChartClient } from "../EChartClient";

const OPTION: EChartsCoreOption = { series: [{ type: "bar", data: [1, 2] }] };

/**
 * Ile razy `getComputedStyle` wymusiło przeliczenie stylu w tym przypadku.
 *
 * To jest JEDNOCZEŚNIE licznik rozwiązań motywu: po zmianie `resolveChartTheme`
 * pobiera migawkę stylu DOKŁADNIE RAZ na wywołanie (wcześniej dziesięć razy -
 * raz na token), więc jedna liczba mierzy oba wymiary kosztu.
 */
let computedStyleCalls = 0;

beforeEach(() => {
  h.chartRenders = 0;
  h.handlers.clear();
  h.lastOption = null;
  h.offCalls = 0;
  computedStyleCalls = 0;
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((...args: Parameters<typeof real>) => {
    computedStyleCalls += 1;
    return real(...args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Wypłucz odświeżenie zaplanowane przy montowaniu.
 *
 * `scheduleChartThemeRefresh` koalescencyjnie odkłada przeliczenie na mikrotask,
 * więc każdy test, który renderuje wykres, zostawia je w kolejce. Bez tego
 * wypłukania mikrotask wystrzeliwuje POZA `act` - React słusznie o tym krzyczy,
 * a licznik renderów następnego przypadku dostaje cudzy przebieg.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function panel(count: number) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <EChartClient key={i} option={OPTION} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
describe("koszt renderu panelu (N8)", () => {
  it("JEDEN wykres renderuje się RAZ - nie ma bezwarunkowego drugiego przebiegu", async () => {
    render(<EChartClient option={OPTION} />);

    expect(h.chartRenders).toBe(1);
    await settle();
  });

  it("DZIESIĘĆ wykresów to dziesięć renderów, nie dwadzieścia", async () => {
    // Liczba, dla której ta zmiana powstała: przed nią panel z dziesięcioma
    // wykresami renderował je dwukrotnie.
    render(panel(10));

    expect(h.chartRenders).toBe(10);
    await settle();
  });

  it("motyw jest rozwiązywany RAZ na cały panel, nie raz na wykres", async () => {
    // ZMIERZONE PRZED zmianą na tym samym panelu: 20 rozwiązań motywu i 200
    // wywołań `getComputedStyle`. Jedna migawka stylu = jedno rozwiązanie.
    render(panel(10));

    expect(computedStyleCalls).toBe(1);
    await settle();
  });

  it("po zamontowaniu całego panelu odświeżenie jest JEDNO, nie dziesięć", async () => {
    // Efekt montujący każdego wykresu woła `scheduleChartThemeRefresh`, a ten
    // koalescencyjnie skleja je w jedno przeliczenie na turę.
    render(panel(10));
    await act(async () => {
      await Promise.resolve();
    });

    expect(computedStyleCalls).toBe(2);
    // Tokeny się nie zmieniły, więc odświeżenie NIE renderuje wykresów ponownie.
    expect(h.chartRenders).toBe(10);
  });

  it("zmiana `themeVersion` PRZELICZA motyw - przełącznik trybu nie może zostawić starej palety", async () => {
    // Asercja jest na SKUTKU, nie na liczniku: po podbiciu `themeVersion`
    // wykres MUSI malować się nową paletą. Wcześniej stało tu tylko
    // `computedStyleCalls === before + 1`, czyli „coś policzono" - to przechodzi
    // także wtedy, gdy przeliczony motyw nigdy nie dojedzie do wykresu.
    const { rerender } = render(<EChartClient option={OPTION} themeVersion={0} />);
    await settle();
    document.documentElement.style.setProperty("--chart-1", "#0000ff");

    rerender(<EChartClient option={OPTION} themeVersion={1} />);
    await settle();

    expect((h.lastOption?.color as string[])[0]).toBe("#0000ff");
    document.documentElement.style.removeProperty("--chart-1");
  });

  it("przełączenie trybu na panelu to JEDNO rozwiązanie motywu, nie dziesięć", async () => {
    // `themeVersion` zmienia się CAŁEMU panelowi naraz, więc efekt każdego
    // wykresu odpala się na tej samej turze. Póki wołał `notifyChartThemeChanged`
    // bezpośrednio, jedno przełączenie trybu kosztowało dziesięć rozwiązań
    // motywu (ZMIERZONE: 10 wywołań `getComputedStyle`) - dziewięć z nich
    // wyłącznie po to, żeby porównać wynik z samym sobą i wyjść.
    const p = (v: number) => (
      <>
        {Array.from({ length: 10 }, (_, i) => (
          <EChartClient key={i} option={OPTION} themeVersion={v} />
        ))}
      </>
    );
    const { rerender } = render(p(0));
    await settle();
    computedStyleCalls = 0;

    rerender(p(1));
    await settle();

    expect(computedStyleCalls).toBe(1);
  });

  it("wymiana panelu na panel to dziesięć renderów, nie dwadzieścia", async () => {
    // Stary panel odmontowuje się w TYM SAMYM commicie, w którym montuje się
    // nowy. Póki ostatni `unsubscribe` WYRZUCAŁ migawkę (`snapshot = null`),
    // pierwszy odczyt po wymianie rodził NOWY obiekt o identycznych kolorach,
    // `useSyncExternalStore` porównywał go przez `Object.is` i wymuszał każdemu
    // nowemu wykresowi drugi render oraz drugie `setOption(notMerge)` - czyli
    // dokładnie ten koszt, który wspólna subskrypcja miała usunąć, tylko innym
    // wejściem. ZMIERZONE na tym przypadku: 20 renderów -> 10.
    //
    // UCZCIWIE O ZASIĘGU: dziś na `/admin/analytics` to się NIE ZAPALA, i to
    // nie zasługa tego pliku. `EChart` bramkuje klienta stanem `mounted`, więc
    // nowy `EChartClient` montuje się o commit PÓŹNIEJ niż odmontował się stary
    // - zmierzone przez prawdziwy `EChart`: 10 renderów zarówno przed zmianą,
    // jak i po niej. Ten test pilnuje kontraktu SAMEGO `EChartClient`, żeby
    // zdjęcie tamtej bramki (albo pierwsze użycie komponentu z pominięciem
    // `EChart`) nie przywróciło po cichu podwójnego renderu.
    const p = (tag: string) => (
      <>
        {Array.from({ length: 10 }, (_, i) => (
          <EChartClient key={`${tag}-${i}`} option={OPTION} />
        ))}
      </>
    );
    const { rerender } = render(p("a"));
    await settle();
    h.chartRenders = 0;

    rerender(p("b"));
    await settle();

    expect(h.chartRenders).toBe(10);
  });
});

// ---------------------------------------------------------------------------
describe("spóźnione tokeny motywu", () => {
  it("tokeny, które dojechały PO pierwszym malowaniu, trafiają do wykresu", async () => {
    // To jest powód, dla którego bezwarunkowy efekt w ogóle istniał:
    // `DesignTokensStyle` wstrzykuje paletę tenanta z bazy, więc może dojechać
    // po zamontowaniu wykresu. Optymalizacja bez tej gwarancji byłaby regresem.
    const { notifyChartThemeChanged } = await import("../chartTheme");
    render(<EChartClient option={OPTION} />);
    await settle();
    const before = h.chartRenders;
    document.documentElement.style.setProperty("--chart-1", "#ff0000");

    act(() => {
      notifyChartThemeChanged();
    });

    expect(h.chartRenders).toBe(before + 1);
    expect((h.lastOption?.color as string[])[0]).toBe("#ff0000");
    document.documentElement.style.removeProperty("--chart-1");
  });

  it("rozgłoszenie BEZ realnej zmiany tokenów NIE renderuje wykresów ponownie", async () => {
    // Sedno oszczędności: sygnał, po którym motyw wychodzi identyczny, jest
    // wyciszany. Inaczej wróciłby koszt sprzed zmiany, tylko innym kanałem.
    const { notifyChartThemeChanged } = await import("../chartTheme");
    render(panel(10));
    await settle();
    const before = h.chartRenders;

    act(() => {
      notifyChartThemeChanged();
    });

    expect(h.chartRenders).toBe(before);
  });

  it("wykres odmontowany przestaje nasłuchiwać - subskrypcja nie przecieka", async () => {
    const { notifyChartThemeChanged } = await import("../chartTheme");
    const { unmount } = render(panel(3));
    await settle();
    unmount();
    const before = h.chartRenders;
    document.documentElement.style.setProperty("--chart-1", "#00ff00");

    act(() => {
      notifyChartThemeChanged();
    });

    expect(h.chartRenders).toBe(before);
    document.documentElement.style.removeProperty("--chart-1");
  });
});

// ---------------------------------------------------------------------------
describe("kontrakt komponentu", () => {
  it("motyw jest podkładem opcji, a opcja wywołującego nadpisuje jego pola", async () => {
    render(<EChartClient option={{ ...OPTION, backgroundColor: "#123456" }} />);
    await settle();

    expect(h.lastOption).toMatchObject({ backgroundColor: "#123456" });
    expect(h.lastOption?.series).toBeTruthy();
    // Pola motywu, których wywołujący nie podał, zostają.
    expect(h.lastOption?.color).toBeTruthy();
  });

  it("wysokość liczbowa staje się pikselami, napis idzie dosłownie", async () => {
    const { container, rerender } = render(<EChartClient option={OPTION} height={180} />);
    await settle();
    expect((container.firstChild as HTMLElement).style.height).toBe("180px");

    rerender(<EChartClient option={OPTION} height="40vh" />);
    expect((container.firstChild as HTMLElement).style.height).toBe("40vh");
  });

  it("kursor wskaźnika pojawia się TYLKO gdy wykres jest klikalny", async () => {
    const { container, rerender } = render(<EChartClient option={OPTION} />);
    await settle();
    expect((container.firstChild as HTMLElement).style.cursor).toBe("");

    rerender(<EChartClient option={OPTION} onDataClick={() => {}} />);
    expect((container.firstChild as HTMLElement).style.cursor).toBe("pointer");
  });

  it("handler kliknięcia jest rejestrowany RAZ, a mimo to zawsze świeży", async () => {
    // Rejestracja przez ref: zmiana handlera nie może odpinać i podpinać
    // zdarzenia od nowa, ale kliknięcie ma trafić w NOWY handler.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<EChartClient option={OPTION} onDataClick={first} />);
    await settle();

    rerender(<EChartClient option={OPTION} onDataClick={second} />);
    h.handlers.get("click")?.({ name: "wpis" });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ name: "wpis" });
  });

  it("odmontowanie odpina handler kliknięcia", async () => {
    const { unmount } = render(<EChartClient option={OPTION} onDataClick={() => {}} />);
    await settle();

    unmount();

    expect(h.offCalls).toBeGreaterThan(0);
  });

  it("`onReady` dostaje instancję wykresu", async () => {
    const onReady = vi.fn();

    render(<EChartClient option={OPTION} onReady={onReady} />);

    expect(onReady).toHaveBeenCalledWith(instance);
    await settle();
  });
});
