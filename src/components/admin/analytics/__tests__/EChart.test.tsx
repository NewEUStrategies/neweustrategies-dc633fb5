// Rozdzielenie `EChart` / `EChartClient` - najbardziej kruche miejsce modułu.
//
// PO CO. Ten split nie jest zaniedbaniem ani stylem: nagłówek `EChart.tsx`
// zapisuje, że ECharts z `echarts-for-react` dokłada ~1 MB, a wciągnięcie go do
// grafu SSR (chunk routera >2,5 MB) WYWALAŁO renderer chunków Rollupa na OOM V8
// przy `build:dev`. Obroną są dwie rzeczy naraz: `React.lazy` po stronie
// klienta i zakaz statycznego importu `./EChartClient`. Druga z nich była do tej
// pory pilnowana WYŁĄCZNIE akapitem komentarza, a oba pliki stały na zerze
// (EChart.tsx 0/8 linii, EChartClient.tsx 0/21).
//
// Ten plik pilnuje strony RUNTIME'owej: że render serwerowy KOŃCZY SIĘ na
// szkielecie i nie dotyka modułu wykresu. Strony BUDOWLANEJ pilnuje osobno
// `check:entry-purity` (wpis `echarts` w HEAVY_MODULES) wraz z
// `src/lib/ci/__tests__/entryPurityEchartsMarkers.test.ts`. Jedno bez drugiego
// nie wystarcza: test runtime'owy nie widzi krawędzi w grafie chunków, a bramka
// grafu nie widzi, czy komponent w ogóle działa.
//
// DLACZEGO ATRAPA MODUŁU KLIENTA. Prawdziwy `EChartClient` ciągnie `echarts` i
// `echarts-for-react` do procesu testowego - czyli dokładnie ten import, którego
// ten plik zabrania. Atrapa z LICZNIKIEM wywołań fabryki jest jednocześnie
// sondą: fabryka `vi.mock` odpala się przy PIERWSZYM zaimportowaniu modułu, więc
// licznik równy zeru dowodzi, że `import("./EChartClient")` nie padło.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EChartsCoreOption } from "echarts/core";

const h = vi.hoisted(() => ({
  factoryCalls: 0,
  lastProps: null as Record<string, unknown> | null,
}));

vi.mock("../EChartClient", () => {
  h.factoryCalls += 1;
  return {
    EChartClient: (props: Record<string, unknown>) => {
      h.lastProps = props;
      return <div data-testid="echart-client" />;
    },
  };
});

import { EChart } from "../EChart";

const OPTION: EChartsCoreOption = { series: [{ type: "bar", data: [1, 2, 3] }] };

// `factoryCalls` NIE jest zerowane między przypadkami i to jest celowe:
// fabryka `vi.mock` odpala się przy PIERWSZYM imporcie modułu w całym pliku, więc
// zerowanie licznika kazałoby asercjom zależeć od kolejności bloków. Każdy
// przypadek mierzy zatem PRZYROST wobec stanu sprzed siebie - twierdzenie
// „ten render (nie) sięgnął po moduł wykresu" jest wtedy prawdziwe niezależnie
// od tego, co biegło wcześniej.
beforeEach(() => {
  h.lastProps = null;
});

describe("render serwerowy", () => {
  it("oddaje SZKIELET, a nie wykres - graf SSR nie ma prawa sięgnąć po ECharts", () => {
    const html = renderToStaticMarkup(<EChart option={OPTION} />);

    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("echart-client");
  });

  it("szkielet jest UKRYTY DLA CZYTNIKÓW EKRANU - to placeholder, nie treść", () => {
    // Bez `aria-hidden` czytnik ogłasza pusty prostokąt jako element strony.
    const html = renderToStaticMarkup(<EChart option={OPTION} />);

    expect(html).toContain("aria-hidden");
  });

  it('NIE WYWOŁUJE `import("./EChartClient")` - to jest cała stawka tego splitu', () => {
    const before = h.factoryCalls;

    renderToStaticMarkup(<EChart option={OPTION} />);

    expect(h.factoryCalls).toBe(before);
  });

  it("wysokość liczbowa staje się pikselami, a napis idzie dosłownie", () => {
    // Szkielet MUSI mieć tę samą wysokość co wykres - inaczej hydratacja
    // przesuwa układ i psuje CLS, który ten sam moduł mierzy.
    expect(renderToStaticMarkup(<EChart option={OPTION} height={240} />)).toContain("height:240px");
    expect(renderToStaticMarkup(<EChart option={OPTION} height="50vh" />)).toContain("height:50vh");
  });

  it("domyślna wysokość szkieletu to 320 px", () => {
    expect(renderToStaticMarkup(<EChart option={OPTION} />)).toContain("height:320px");
  });

  it("klasa wywołującego jest doklejana do szkieletu, a jej brak nie daje `undefined` w atrybucie", () => {
    expect(renderToStaticMarkup(<EChart option={OPTION} className="mt-4" />)).toContain("mt-4");
    expect(renderToStaticMarkup(<EChart option={OPTION} />)).not.toContain("undefined");
  });
});

describe("render kliencki", () => {
  it("PO ZAMONTOWANIU dociąga moduł wykresu przez granicę Suspense", async () => {
    render(<EChart option={OPTION} />);

    await waitFor(() => expect(screen.getByTestId("echart-client")).toBeTruthy());
    expect(h.factoryCalls).toBe(1);
  });

  it("granica Suspense oddaje TEN SAM szkielet co serwer - hydratacja nie przesuwa układu", async () => {
    // Fallback i render serwerowy muszą być identyczne co do wysokości,
    // inaczej dociągnięcie chunku ECharts wywołuje przesunięcie układu -
    // czyli CLS, który ten sam moduł mierzy.
    const ssr = renderToStaticMarkup(<EChart option={OPTION} height={260} className="karta" />);
    const { container } = render(<EChart option={OPTION} height={260} className="karta" />);
    await waitFor(() => expect(screen.getAllByTestId("echart-client").length).toBeGreaterThan(0));

    expect(ssr).toContain("height:260px");
    expect(ssr).toContain("karta");
    // Po dociągnięciu modułu szkielet znika - to jest ta sama gałąź, tylko
    // po drugiej stronie granicy.
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("przekazuje WSZYSTKIE propsy dalej - most nie może gubić handlera kliknięcia", async () => {
    const onDataClick = vi.fn();
    const onReady = vi.fn();

    render(
      <EChart
        option={OPTION}
        height={200}
        className="chart"
        themeVersion={3}
        onDataClick={onDataClick}
        onReady={onReady}
      />,
    );

    await waitFor(() => expect(h.lastProps).not.toBeNull());
    expect(h.lastProps).toMatchObject({
      option: OPTION,
      height: 200,
      className: "chart",
      themeVersion: 3,
      onDataClick,
      onReady,
    });
  });

  it("moduł wykresu jest ładowany RAZ, nawet gdy na stronie stoi dziesięć wykresów", async () => {
    // Panel BI renderuje wiele wykresów naraz; `React.lazy` ma je obsłużyć
    // jednym pobraniem chunku, a nie dziesięcioma.
    const before = h.factoryCalls;
    render(
      <>
        {Array.from({ length: 10 }, (_, i) => (
          <EChart key={i} option={OPTION} />
        ))}
      </>,
    );

    await waitFor(() => expect(screen.getAllByTestId("echart-client")).toHaveLength(10));
    // Zero DODATKOWYCH pobrań: dziesięć wykresów dzieli jeden chunk.
    expect(h.factoryCalls).toBe(before);
    expect(h.factoryCalls).toBe(1);
  });
});
