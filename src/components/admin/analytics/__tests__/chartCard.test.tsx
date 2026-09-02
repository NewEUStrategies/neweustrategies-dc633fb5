// `ChartCard` - powłoka każdego wykresu na /admin/analytics: nagłówek, menu
// eksportu, pełny ekran i most między kliknięciem w ECharts a oknem szczegółów.
//
// PO CO. Sąsiad `chartCardA11y.test.tsx` dowodzi JEDNEJ rzeczy: że kanwa
// dostaje nazwę i tekstową alternatywę. Reszta powłoki stała nietknięta
// (55,0% linii, 1/9 funkcji) - a to właśnie tam mieszkają zachowania, które
// mają skutek poza ekranem:
//
//   1. EKSPORT WYPUSZCZA DANE Z APLIKACJI. `doPng` i `doCsv` to jedyne dwie
//      drogi, którymi liczby warsztatu opuszczają panel jako plik. Nazwa pliku
//      liczy się z tytułu (`slug`), a instancja wykresu jest łapana przez
//      `onReady` - jeśli ten most się urwie, klik w „Eksport PNG" jest cichym
//      no-opem: żadnego błędu, żadnego pliku, operator myśli, że pobrał raport.
//   2. POZYCJA CSV ISTNIEJE WARUNKOWO. Karta bez danych tabelarycznych NIE MOŻE
//      pokazywać „Eksport CSV" - to obietnica pliku, którego nie ma.
//   3. MOST KLIKNIĘCIA. `handleClick` jest zawijany tylko wtedy, gdy karta
//      dostała `onDataClick`; mapowanie zwracające `null` (klik w linię progową,
//      w tło, w legendę) NIE MOŻE otwierać pustego okna. Tu przejeżdżają trzy
//      kształty zdarzenia, jakie ECharts naprawdę oddaje: klik w słupek serii,
//      klik w wycinek kołowego i klik w element bez danych.
//   4. PEŁNY EKRAN ZMIENIA WYSOKOŚĆ WYKRESU, nie tylko ikonę. Przełącznik bez
//      przekazanej wysokości daje kartę na cały ekran z wykresem wielkości
//      miniatury.
//
// ECHARTS JEST TU ZAKAZANY (nagłówek `EChart.tsx`). Atrapa `EChart` przechwytuje
// `option`, `height`, `onReady` i `onDataClick`, i wystawia je testowi - dzięki
// temu asercje idą na KONTRAKT karty z rendererem, a nie na piksele.
// `./exportChart` też jest atrapą: jego własna poprawność ma pełny test
// (`exportChart.test.ts`), a tutaj przedmiotem dowodu jest OKABLOWANIE.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { EChartsCoreOption } from "echarts/core";
import type { ChartClickParams, ChartDrillDetail } from "../ChartDrillDialog";

const h = vi.hoisted(() => ({
  exportCsv: vi.fn(),
  exportPng: vi.fn(),
  wykresy: [] as Array<{
    option: Record<string, unknown>;
    height?: number | string;
    onDataClick?: (p: ChartClickParams) => void;
  }>,
  /** Atrapa instancji ECharts oddawana przez `onReady`. */
  instancja: { getDataURL: () => "data:image/png;base64,AAAA" },
}));

vi.mock("../exportChart", () => ({
  exportCsv: (...args: unknown[]) => h.exportCsv(...args),
  exportPng: (...args: unknown[]) => h.exportPng(...args),
}));

// Atrapa renderera: zapisuje to, co karta jej podała, i NATYCHMIAST melduje
// gotowość instancji - dokładnie tak, jak robi to `EChartClient` po `init`.
vi.mock("../EChart", async () => {
  const react = await import("react");
  return {
    EChart: ({
      option,
      height,
      onReady,
      onDataClick,
    }: {
      option: Record<string, unknown>;
      height?: number | string;
      onReady?: (instance: unknown) => void;
      onDataClick?: (p: ChartClickParams) => void;
    }) => {
      const indeks = react.useRef<number>(-1);
      if (indeks.current === -1) indeks.current = h.wykresy.length;
      h.wykresy[indeks.current] = { option, height, onDataClick };
      react.useEffect(() => {
        onReady?.(h.instancja);
      }, [onReady]);
      return <div data-testid="echart" data-chart-index={indeks.current} />;
    },
  };
});

import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { ChartCard, type ChartCardProps } from "../ChartCard";

// ---------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------

const OPCJA: EChartsCoreOption = { series: [{ type: "bar", data: [1, 2, 3] }] };

const CSV: NonNullable<ChartCardProps["csv"]> = {
  filename: "odslony-wpisow.csv",
  headers: ["Dzień", "Odsłony"],
  rows: [
    ["2026-08-01", 1200],
    ["2026-08-02", 1580],
  ],
};

/** Trzy kształty zdarzenia, jakie ECharts oddaje handlerowi `click`. */
const KLIK_SERIA: ChartClickParams = {
  componentType: "series",
  seriesType: "bar",
  seriesIndex: 0,
  seriesName: "Odsłony",
  name: "2026-08-02",
  dataIndex: 1,
  value: 1580,
  data: { name: "2026-08-02", value: 1580 },
};

const KLIK_WYCINEK: ChartClickParams = {
  componentType: "series",
  seriesType: "pie",
  seriesIndex: 0,
  name: "organic",
  dataIndex: 0,
  value: 64,
  data: { name: "organic", value: 64 },
};

/** Klik w linię progową / oś / tło - element bez własnych danych. */
const KLIK_BEZ_DANYCH: ChartClickParams = { componentType: "markLine", seriesIndex: 0 };

function karta(props: Partial<ChartCardProps> = {}) {
  return render(<ChartCard title="Odsłony wpisów" option={OPCJA} {...props} />);
}

/**
 * Wyzwalacz menu „trzy kropki". Rozpoznawany przez ODJĘCIE przycisku pełnego
 * ekranu (ten ma etykietę ze słownika), a nie przez „przycisk bez nazwy" -
 * brak nazwy jest tu przypiętym defektem i test nie może na nim polegać.
 */
function wyzwalaczMenu(zasieg: HTMLElement | null = null): HTMLElement {
  const t = realT(i18n.language === "en" ? "en" : "pl");
  const pelnyEkran = new Set([
    t("adminAnalytics.chartCard.fullscreen"),
    t("adminAnalytics.chartCard.exitFullscreen"),
  ]);
  const przyciski = (zasieg ? within(zasieg) : screen).getAllByRole("button");
  const kandydat = przyciski.find((b) => !pelnyEkran.has(b.getAttribute("aria-label") ?? ""));
  if (!kandydat) throw new Error("Nie znaleziono wyzwalacza menu eksportu");
  return kandydat;
}

/** Otwiera menu eksportu i oddaje jego zawartość. */
async function menu(zasieg: HTMLElement | null = null) {
  fireEvent.click(wyzwalaczMenu(zasieg));
  return within(await screen.findByRole("dialog"));
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.wykresy.length = 0;
  h.exportCsv.mockReset();
  h.exportPng.mockReset();
  document.body.innerHTML = "";
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("ChartCard - nagłówek", () => {
  it("tytuł, podtytuł i odznaka trafiają na kartę - każde w swoje miejsce", () => {
    karta({
      subtitle: "Ostatnie 30 dni, wszystkie wpisy",
      badge: <span data-testid="odznaka">GA4</span>,
    });

    expect(screen.getByText("Odsłony wpisów")).toBeTruthy();
    expect(screen.getByText("Ostatnie 30 dni, wszystkie wpisy")).toBeTruthy();
    expect(screen.getByTestId("odznaka").textContent).toBe("GA4");
  });

  it("bez podtytułu i bez odznaki nagłówek nie rysuje pustych kontenerów", () => {
    const { container } = karta();

    expect(container.textContent).toContain("Odsłony wpisów");
    // Podpowiedź o klikaniu należy do kart z drążeniem - tu jej nie ma.
    expect(container.textContent).not.toContain(realT("pl")("adminAnalytics.drillDialog.hint"));
  });

  it("podpowiedź o drążeniu pojawia się TYLKO gdy karta umie drążyć", () => {
    const t = realT("pl");
    const { unmount } = karta();
    expect(screen.queryByText(t("adminAnalytics.drillDialog.hint"))).toBeNull();
    unmount();

    karta({ onDataClick: () => null });
    expect(screen.getByText(t("adminAnalytics.drillDialog.hint"))).toBeTruthy();
  });

  it("stopka renderuje się tylko wtedy, gdy karta ją dostała", () => {
    const { unmount } = karta();
    expect(screen.queryByTestId("stopka")).toBeNull();
    unmount();

    karta({ footer: <span data-testid="stopka">próbka: 1 240 sesji</span> });
    expect(screen.getByTestId("stopka")).toBeTruthy();
  });
});

describe("ChartCard - menu eksportu", () => {
  it("bez danych CSV menu oferuje SAM PNG - żadnej obietnicy pliku, którego nie ma", async () => {
    const t = realT("pl");
    karta();

    const m = await menu();
    expect(m.getByRole("button", { name: t("adminAnalytics.chartCard.exportPng") })).toBeTruthy();
    expect(m.queryByRole("button", { name: t("adminAnalytics.chartCard.exportCsv") })).toBeNull();
  });

  it("z danymi CSV menu oferuje OBIE ścieżki", async () => {
    const t = realT("pl");
    karta({ csv: CSV });

    const m = await menu();
    expect(m.getByRole("button", { name: t("adminAnalytics.chartCard.exportPng") })).toBeTruthy();
    expect(m.getByRole("button", { name: t("adminAnalytics.chartCard.exportCsv") })).toBeTruthy();
  });

  it("CSV jedzie do `exportCsv` z nazwą pliku, nagłówkami i wierszami z propsów", async () => {
    const t = realT("pl");
    karta({ csv: CSV });

    const m = await menu();
    fireEvent.click(m.getByRole("button", { name: t("adminAnalytics.chartCard.exportCsv") }));

    expect(h.exportCsv).toHaveBeenCalledTimes(1);
    expect(h.exportCsv).toHaveBeenCalledWith(CSV.filename, CSV.headers, CSV.rows);
  });

  it("PNG dostaje INSTANCJĘ wykresu złapaną przez `onReady`, nie `null`", async () => {
    // To jest cały sens `handleReady`: bez niej `exportPng` dostaje `null`,
    // wraca no-opem i klik w menu nie robi NIC - bez śladu w konsoli.
    const t = realT("pl");
    karta();

    const m = await menu();
    fireEvent.click(m.getByRole("button", { name: t("adminAnalytics.chartCard.exportPng") }));

    expect(h.exportPng).toHaveBeenCalledTimes(1);
    expect(h.exportPng.mock.calls[0][1]).toBe(h.instancja);
  });

  it("nazwa pliku PNG to SLUG tytułu - bez polskich znaków, spacji i ukośników", async () => {
    const t = realT("pl");
    karta({ title: "Odsłony / CTR: 30 dni!" });

    const m = await menu();
    fireEvent.click(m.getByRole("button", { name: t("adminAnalytics.chartCard.exportPng") }));

    const nazwa = h.exportPng.mock.calls[0][0] as string;
    expect(nazwa).toBe("ods-ony-ctr-30-dni");
    // Nazwa pliku nie może zawierać separatora ścieżki ani spacji.
    expect(nazwa).not.toMatch(/[\s/\\]/);
  });

  it("jawny `pngName` PRZEBIJA slug tytułu", async () => {
    const t = realT("pl");
    karta({ pngName: "gsc-trend-klikniec" });

    const m = await menu();
    fireEvent.click(m.getByRole("button", { name: t("adminAnalytics.chartCard.exportPng") }));

    expect(h.exportPng.mock.calls[0][0]).toBe("gsc-trend-klikniec");
  });

  it("pozycje menu to PRZYCISKI type=button, osiągalne klawiaturą", async () => {
    const t = realT("pl");
    karta({ csv: CSV });

    const m = await menu();
    for (const klucz of ["exportPng", "exportCsv"]) {
      const pozycja = m.getByRole("button", { name: t(`adminAnalytics.chartCard.${klucz}`) });
      expect(pozycja.getAttribute("type")).toBe("button");
      pozycja.focus();
      expect(document.activeElement).toBe(pozycja);
    }
  });
});

describe("ChartCard - pełny ekran", () => {
  it("przełącznik zmienia etykietę na przeciwną - i wraca", async () => {
    const t = realT("pl");
    karta();

    const wejdz = screen.getByRole("button", { name: t("adminAnalytics.chartCard.fullscreen") });
    fireEvent.click(wejdz);

    const wyjdz = await screen.findByRole("button", {
      name: t("adminAnalytics.chartCard.exitFullscreen"),
    });
    fireEvent.click(wyjdz);

    expect(
      await screen.findByRole("button", { name: t("adminAnalytics.chartCard.fullscreen") }),
    ).toBeTruthy();
  });

  it("pełny ekran ROZCIĄGA wykres, a nie tylko ramkę karty", () => {
    // Bez zmiany wysokości karta zajmuje cały ekran, a wykres zostaje w
    // rozmiarze miniatury - najczęstszy regres tego przełącznika.
    const t = realT("pl");
    karta({ height: 240 });
    expect(h.wykresy.at(-1)?.height).toBe(240);

    fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.chartCard.fullscreen") }));

    expect(h.wykresy.at(-1)?.height).toBe("calc(100vh - 120px)");
  });

  it("domyślna wysokość wykresu to 300 px, gdy karta jej nie dostała", () => {
    karta();

    expect(h.wykresy.at(-1)?.height).toBe(300);
  });

  it("pełny ekran przypina kartę do okna, zachowując klasę wołającego", () => {
    const t = realT("pl");
    const { container } = karta({ className: "moja-karta" });
    const kartaEl = container.firstElementChild as HTMLElement;
    expect(kartaEl.className).toContain("moja-karta");
    expect(kartaEl.className).not.toContain("fixed");

    fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.chartCard.fullscreen") }));

    expect(kartaEl.className).toContain("fixed");
    expect(kartaEl.className).toContain("moja-karta");
  });
});

describe("ChartCard - most kliknięcia i okno szczegółów", () => {
  it("bez `onDataClick` renderer NIE dostaje handlera - żadnych zbędnych nasłuchów", () => {
    karta();

    expect(h.wykresy.at(-1)?.onDataClick).toBeUndefined();
  });

  it("klik w SŁUPEK serii otwiera okno z ładunkiem zbudowanym z parametrów", async () => {
    const mapuj = vi.fn(
      (p: ChartClickParams): ChartDrillDetail => ({
        title: String(p.name),
        subtitle: `${p.seriesName}: ${String(p.value)}`,
      }),
    );
    karta({ onDataClick: mapuj });

    await act(async () => {
      h.wykresy.at(-1)?.onDataClick?.(KLIK_SERIA);
    });

    expect(mapuj).toHaveBeenCalledWith(KLIK_SERIA);
    const okno = await screen.findByRole("dialog", { name: "2026-08-02" });
    expect(within(okno).getByText("Odsłony: 1580")).toBeTruthy();
  });

  it("klik w WYCINEK kołowego otwiera to samo okno - powłoka nie zna typu serii", async () => {
    karta({
      onDataClick: (p) => ({ title: String(p.name), subtitle: `udział ${String(p.value)}%` }),
    });

    await act(async () => {
      h.wykresy.at(-1)?.onDataClick?.(KLIK_WYCINEK);
    });

    const okno = await screen.findByRole("dialog", { name: "organic" });
    expect(within(okno).getByText("udział 64%")).toBeTruthy();
  });

  it("klik BEZ DANYCH (mapowanie oddaje null) NIE otwiera pustego okna", async () => {
    // Linia progowa, oś i tło też generują `click`. Okno z samym tytułem
    // „undefined" jest gorsze niż brak reakcji.
    const mapuj = vi.fn((p: ChartClickParams) =>
      p.componentType === "series" ? { title: String(p.name) } : null,
    );
    karta({ onDataClick: mapuj });

    await act(async () => {
      h.wykresy.at(-1)?.onDataClick?.(KLIK_BEZ_DANYCH);
    });

    expect(mapuj).toHaveBeenCalledWith(KLIK_BEZ_DANYCH);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("zamknięcie okna kasuje ładunek - kolejny klik startuje od zera", async () => {
    karta({ onDataClick: (p) => ({ title: String(p.name) }) });

    await act(async () => {
      h.wykresy.at(-1)?.onDataClick?.(KLIK_SERIA);
    });
    await screen.findByRole("dialog", { name: "2026-08-02" });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await act(async () => {
      h.wykresy.at(-1)?.onDataClick?.(KLIK_WYCINEK);
    });
    expect(await screen.findByRole("dialog", { name: "organic" })).toBeTruthy();
  });

  it("drugi klik w ten sam wykres PODMIENIA treść okna, nie dokłada drugiego", async () => {
    karta({ onDataClick: (p) => ({ title: String(p.name) }) });

    await act(async () => {
      h.wykresy.at(-1)?.onDataClick?.(KLIK_SERIA);
    });
    await act(async () => {
      h.wykresy.at(-1)?.onDataClick?.(KLIK_WYCINEK);
    });

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "organic" })).toBeTruthy();
  });
});

describe("ChartCard - izolacja warsztatów", () => {
  it("eksport i drążenie DWÓCH kart nie mieszają danych warsztatów", async () => {
    // Panel administratora obsługującego kilka warsztatów stawia karty obok
    // siebie. Eksport karty A musi nieść WYŁĄCZNIE wiersze A, a okno otwarte
    // klikiem w wykres A - wyłącznie tytuł A. Wspólny stan w powłoce (jeden
    // `drill`, jedna instancja wykresu) rozlałby dane między warsztatami.
    const t = realT("pl");
    const csvA: NonNullable<ChartCardProps["csv"]> = {
      filename: "warsztat-a.csv",
      headers: ["Dzień", "Odsłony"],
      rows: [["2026-08-01", 111]],
    };
    const csvB: NonNullable<ChartCardProps["csv"]> = {
      filename: "warsztat-b.csv",
      headers: ["Dzień", "Odsłony"],
      rows: [["2026-08-01", 999]],
    };
    render(
      <>
        <div data-testid="karta-a">
          <ChartCard
            title="Warsztat A"
            option={OPCJA}
            csv={csvA}
            onDataClick={() => ({ title: "warsztat-a.example.com" })}
          />
        </div>
        <div data-testid="karta-b">
          <ChartCard
            title="Warsztat B"
            option={OPCJA}
            csv={csvB}
            onDataClick={() => ({ title: "warsztat-b.example.org" })}
          />
        </div>
      </>,
    );

    // Eksport z karty B niesie wyłącznie wiersze B.
    const m = await menu(screen.getByTestId("karta-b"));
    fireEvent.click(m.getByRole("button", { name: t("adminAnalytics.chartCard.exportCsv") }));
    expect(h.exportCsv).toHaveBeenCalledTimes(1);
    expect(h.exportCsv).toHaveBeenCalledWith(csvB.filename, csvB.headers, csvB.rows);
    expect(h.exportCsv.mock.calls[0][2]).not.toEqual(csvA.rows);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Drążenie karty A otwiera JEDNO okno i tylko z tytułem A.
    await act(async () => {
      h.wykresy[0]?.onDataClick?.(KLIK_SERIA);
    });
    const okno = await screen.findByRole("dialog");
    expect(okno.textContent).toContain("warsztat-a.example.com");
    expect(okno.textContent).not.toContain("warsztat-b.example.org");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});

describe("ChartCard - dwujęzyczność i dostępność", () => {
  it("etykiety powłoki przychodzą ZE SŁOWNIKA - PL i EN", async () => {
    const pl = realT("pl");
    const { unmount } = karta({ csv: CSV, onDataClick: () => null });
    expect(screen.getByLabelText(pl("adminAnalytics.chartCard.fullscreen"))).toBeTruthy();
    expect(screen.getByText(pl("adminAnalytics.drillDialog.hint"))).toBeTruthy();
    const mPl = await menu();
    expect(mPl.getByText(pl("adminAnalytics.chartCard.exportCsv"))).toBeTruthy();
    unmount();

    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const en = realT("en");
    expect(en("adminAnalytics.chartCard.exportCsv")).not.toBe(
      pl("adminAnalytics.chartCard.exportCsv"),
    );

    karta({ csv: CSV, onDataClick: () => null });
    expect(screen.getByLabelText(en("adminAnalytics.chartCard.fullscreen"))).toBeTruthy();
    expect(screen.getByText(en("adminAnalytics.drillDialog.hint"))).toBeTruthy();
    const mEn = await menu();
    expect(mEn.getByText(en("adminAnalytics.chartCard.exportCsv"))).toBeTruthy();
    expect(mEn.queryByText(pl("adminAnalytics.chartCard.exportCsv"))).toBeNull();
  });

  it("nazwa regionu wykresu jest ZŁOŻONA z tytułu, także po angielsku", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    karta({ title: "Impressions" });

    expect(
      screen.getByRole("img", {
        name: realT("en")("adminAnalytics.chartCard.chartRegion", { title: "Impressions" }),
      }),
    ).toBeTruthy();
  });

  it("karta z pełnym wyposażeniem jest czysta w axe poza nazwą wyzwalacza menu", async () => {
    // `button-name` wyłączone ŚWIADOMIE i tylko tutaj - to osobny, przypięty
    // niżej defekt. Cała reszta (region wykresu, tabela danych, nagłówki
    // kolumn, stopka) musi przechodzić bez ulg.
    const { container } = karta({
      subtitle: "Ostatnie 30 dni",
      csv: CSV,
      footer: <span>próbka: 1 240 sesji</span>,
      onDataClick: () => null,
    });

    const naruszenia = await axeViolations(container, { "button-name": { enabled: false } });
    expect(summarize(naruszenia)).toBe("");
  });

  it.fails("DEFEKT: wyzwalacz menu eksportu nie ma dostępnej nazwy", () => {
    // Przycisk „trzy kropki" to sama ikona `MoreHorizontal` bez `aria-label`
    // i bez tekstu. Dla czytnika ekranu jest ogłoszony jako samo „przycisk" -
    // jedyne wejście do eksportu PNG i CSV jest więc dla osoby niewidzącej
    // nieopisane. Sąsiedni przycisk pełnego ekranu robi to poprawnie
    // (`aria-label` ze słownika), więc brak jest przeoczeniem, nie decyzją;
    // słownik ma już klucz `common.more` w PL i EN.
    const { container } = karta({ csv: CSV });

    for (const przycisk of within(container).getAllByRole("button")) {
      const nazwa = przycisk.getAttribute("aria-label") ?? przycisk.textContent ?? "";
      expect(nazwa.trim()).not.toBe("");
    }
  });
});
