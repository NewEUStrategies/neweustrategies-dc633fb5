// `ChartCard` - powłoka każdego wykresu na /admin/analytics: nagłówek, menu
// eksportu, pełny ekran i most między WSKAZANIEM z silnika a oknem szczegółów.
//
// PO CO. Sąsiad `chartCardA11y.test.tsx` dowodzi JEDNEJ rzeczy: że kanwa
// dostaje nazwę i tekstową alternatywę. Reszta powłoki stała nietknięta
// (55,0% linii, 1/9 funkcji) - a to właśnie tam mieszkają zachowania, które
// mają skutek poza ekranem:
//
//   1. EKSPORT WYPUSZCZA DANE Z APLIKACJI. `doPng` i `doCsv` to jedyne dwie
//      drogi, którymi liczby warsztatu opuszczają panel jako plik. Nazwa pliku
//      liczy się z tytułu (`slug`), a rysunek bierze się z KONTENERA karty -
//      silnik nie wystawia uchwytu do swojego SVG i nie powinien, bo to
//      szczegół renderu. Jeśli ten most się urwie, klik w „Eksport PNG" jest
//      cichym no-opem: żadnego błędu, żadnego pliku, a operator myśli, że
//      pobrał raport.
//   2. POZYCJA CSV ISTNIEJE WARUNKOWO. Karta bez danych tabelarycznych NIE MOŻE
//      pokazywać „Eksport CSV" - to obietnica pliku, którego nie ma.
//   3. MOST WSKAZANIA. `handleSelect` jest zawijany tylko wtedy, gdy karta
//      dostała `onDataClick`; mapowanie zwracające `null` (wskazanie bez
//      kategorii, wyczyszczone zaznaczenie, rodzaj bez wskazania) NIE MOŻE
//      otwierać pustego okna. Tu przejeżdżają trzy kształty wskazania, jakie
//      silnik naprawdę oddaje: kategoria z jedną serią, wycinek tarczy
//      i wskazanie puste.
//   4. PEŁNY EKRAN ZMIENIA WYSOKOŚĆ WYKRESU, nie tylko ikonę. Przełącznik bez
//      przekazanej wysokości daje kartę na cały ekran z wykresem wielkości
//      miniatury.
//
// SILNIK JEST TU PODGLĄDANY, NIE PODMIENIANY. Szpieg zapisuje konfigurację,
// obsługę wskazania i nazwę regionu, po czym oddaje sterowanie prawdziwemu
// `Chart` - inaczej zniknęłyby z dokumentu tabela danych i nazwa rysunku,
// czyli dokładnie to, czego dotyczy granica między kartą a silnikiem.
// `./exportChart` zostaje atrapą: jego własna poprawność ma pełny test
// (`exportChart.test.ts`), a tutaj przedmiotem dowodu jest OKABLOWANIE.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChartConfig } from "@/lib/charts/types";
import type { ChartSelection } from "@/lib/charts/selection";
import type { ChartDrillDetail } from "../ChartDrillDialog";

const h = vi.hoisted(() => ({
  exportCsv: vi.fn(),
  exportPng: vi.fn(),
  wykresy: [] as Array<{
    config: ChartConfig;
    onSelect?: (selection: ChartSelection) => void;
    ariaLabel?: string;
  }>,
}));

vi.mock("../exportChart", () => ({
  exportCsv: (...args: unknown[]) => h.exportCsv(...args),
  exportPng: (...args: unknown[]) => h.exportPng(...args),
}));

vi.mock("@/components/charts/Chart", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/charts/Chart")>();
  return {
    ...real,
    Chart: (props: Parameters<typeof real.Chart>[0]) => {
      h.wykresy.push({
        config: props.config,
        onSelect: props.onSelect,
        ariaLabel: props.ariaLabel,
      });
      return real.Chart(props);
    },
  };
});

import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { ChartCard, type ChartCardProps } from "../ChartCard";
import { biChart } from "../biChart";

// ---------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------

const KONFIG: ChartConfig = biChart({
  kind: "bar",
  categories: ["2026-08-01", "2026-08-02", "2026-08-03"],
  series: [{ name: "Odsłony", values: [1200, 1580, 1410] }],
});

const CSV: NonNullable<ChartCardProps["csv"]> = {
  filename: "odslony-wpisow.csv",
  headers: ["Dzień", "Odsłony"],
  rows: [
    ["2026-08-01", 1200],
    ["2026-08-02", 1580],
  ],
};

/** Trzy kształty wskazania, jakie silnik oddaje karcie. */
const WSKAZANIE_SLUPEK: ChartSelection = {
  kind: "bar",
  categoryIndex: 1,
  category: "2026-08-02",
  seriesIndex: 0,
  seriesName: "Odsłony",
  value: 1580,
};

const WSKAZANIE_WYCINEK: ChartSelection = {
  kind: "donut",
  categoryIndex: 0,
  category: "organic",
  seriesIndex: 0,
  seriesName: "Sesje",
  value: 64,
};

/**
 * Wskazanie PUSTE - wyczyszczone zaznaczenie albo rodzaj, który wskazania nie
 * oddaje (histogram, boxplot, beeswarm: wiersz danych nie odpowiada tam
 * jednemu elementowi rysunku).
 */
const WSKAZANIE_BEZ_DANYCH: ChartSelection = {
  kind: "histogram",
  categoryIndex: null,
  category: null,
  seriesIndex: null,
  seriesName: null,
  value: null,
};

function karta(props: Partial<ChartCardProps> = {}) {
  return render(<ChartCard title="Odsłony wpisów" config={KONFIG} {...props} />);
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

  it("PNG dostaje KONTENER RYSUNKU, w którym stoi SVG - nie `null`", async () => {
    // To jest cały sens `plotRef`: bez niego `exportPng` dostaje `null`, wraca
    // no-opem i klik w menu nie robi NIC - bez śladu w konsoli. Silnik nie
    // wystawia uchwytu do swojego SVG i nie powinien (to szczegół renderu),
    // więc karta podaje własny kontener, a eksport znajduje rysunek w środku.
    const t = realT("pl");
    karta();

    const m = await menu();
    fireEvent.click(m.getByRole("button", { name: t("adminAnalytics.chartCard.exportPng") }));

    expect(h.exportPng).toHaveBeenCalledTimes(1);
    const kontener = h.exportPng.mock.calls[0][1] as HTMLElement | null;
    expect(kontener).toBeInstanceOf(HTMLElement);
    expect(kontener?.querySelector("svg")).toBeTruthy();
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
    // Bez zmiany wysokości karta zajmuje cały ekran, a wykres zostaje
    // w rozmiarze miniatury - najczęstszy regres tego przełącznika.
    //
    // WYSOKOŚĆ JEDZIE PRZEZ KONFIGURACJĘ, nie stylem kontenera: silnik liczy
    // z niej geometrię (pasma, odstępy, próg etykiety w łuku), więc rysunek
    // rozciągnięty CSS-em rozjechałby się z własnymi obliczeniami. Stąd
    // liczba, a nie `calc(100vh - 120px)` jak przy kanwie ECharts.
    const t = realT("pl");
    karta({ height: 240 });
    expect(h.wykresy.at(-1)?.config.height).toBe(240);

    fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.chartCard.fullscreen") }));

    expect(h.wykresy.at(-1)?.config.height).toBe(560);
  });

  it("domyślna wysokość wykresu to 300 px, gdy karta jej nie dostała", () => {
    karta();

    expect(h.wykresy.at(-1)?.config.height).toBe(300);
  });

  it("konfiguracja idzie do silnika z PUSTYM tytułem - nagłówek rysuje karta", () => {
    // Rama silnika pomija swój własny nagłówek dokładnie wtedy, gdy tytuł
    // i opis są puste. Dwa nagłówki nad jednym rysunkiem to nie ozdoba, tylko
    // szum - a nazwę rysunku dla czytnika ekranu karta i tak podaje osobno.
    karta();

    expect(h.wykresy.at(-1)?.config.title).toBe("");
    expect(h.wykresy.at(-1)?.config.description).toBe("");
    expect(h.wykresy.at(-1)?.ariaLabel).toBe(
      realT("pl")("adminAnalytics.chartCard.chartRegion", { title: "Odsłony wpisów" }),
    );
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
  it("bez `onDataClick` silnik NIE dostaje obsługi wskazania - żadnych zbędnych nasłuchów", () => {
    karta();

    expect(h.wykresy.at(-1)?.onSelect).toBeUndefined();
  });

  it("wskazanie SŁUPKA otwiera okno z ładunkiem zbudowanym ze wskazania", async () => {
    const mapuj = vi.fn((sel: ChartSelection): ChartDrillDetail => ({
      title: String(sel.category),
      subtitle: `${sel.seriesName}: ${String(sel.value)}`,
    }));
    karta({ onDataClick: mapuj });

    await act(async () => {
      h.wykresy.at(-1)?.onSelect?.(WSKAZANIE_SLUPEK);
    });

    expect(mapuj).toHaveBeenCalledWith(WSKAZANIE_SLUPEK);
    const okno = await screen.findByRole("dialog", { name: "2026-08-02" });
    expect(within(okno).getByText("Odsłony: 1580")).toBeTruthy();
  });

  it("wskazanie WYCINKA otwiera to samo okno - powłoka nie zna rodzaju wykresu", async () => {
    karta({
      onDataClick: (sel) => ({
        title: String(sel.category),
        subtitle: `udział ${String(sel.value)}%`,
      }),
    });

    await act(async () => {
      h.wykresy.at(-1)?.onSelect?.(WSKAZANIE_WYCINEK);
    });

    const okno = await screen.findByRole("dialog", { name: "organic" });
    expect(within(okno).getByText("udział 64%")).toBeTruthy();
  });

  it("wskazanie BEZ DANYCH (mapowanie oddaje null) NIE otwiera pustego okna", async () => {
    // Wyczyszczone zaznaczenie i rodzaje, które wskazania nie oddają, też
    // dojeżdżają tą samą drogą. Okno z samym tytułem „null" jest gorsze niż
    // brak reakcji.
    const mapuj = vi.fn((sel: ChartSelection) =>
      sel.category === null ? null : { title: sel.category },
    );
    karta({ onDataClick: mapuj });

    await act(async () => {
      h.wykresy.at(-1)?.onSelect?.(WSKAZANIE_BEZ_DANYCH);
    });

    expect(mapuj).toHaveBeenCalledWith(WSKAZANIE_BEZ_DANYCH);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("zamknięcie okna kasuje ładunek - kolejne wskazanie startuje od zera", async () => {
    karta({ onDataClick: (sel) => ({ title: String(sel.category) }) });

    await act(async () => {
      h.wykresy.at(-1)?.onSelect?.(WSKAZANIE_SLUPEK);
    });
    await screen.findByRole("dialog", { name: "2026-08-02" });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await act(async () => {
      h.wykresy.at(-1)?.onSelect?.(WSKAZANIE_WYCINEK);
    });
    expect(await screen.findByRole("dialog", { name: "organic" })).toBeTruthy();
  });

  it("drugie wskazanie w tym samym wykresie PODMIENIA treść okna, nie dokłada drugiego", async () => {
    karta({ onDataClick: (sel) => ({ title: String(sel.category) }) });

    await act(async () => {
      h.wykresy.at(-1)?.onSelect?.(WSKAZANIE_SLUPEK);
    });
    await act(async () => {
      h.wykresy.at(-1)?.onSelect?.(WSKAZANIE_WYCINEK);
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
            config={KONFIG}
            csv={csvA}
            onDataClick={() => ({ title: "warsztat-a.example.com" })}
          />
        </div>
        <div data-testid="karta-b">
          <ChartCard
            title="Warsztat B"
            config={KONFIG}
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
      h.wykresy[0]?.onSelect?.(WSKAZANIE_SLUPEK);
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

    // Po NAZWIE, a nie po roli: silnik daje rysunkom kartezjańskim rolę
    // „img", ale tarczy - „group", bo jej wycinki są fokusowalne.
    expect(
      screen.getByLabelText(
        realT("en")("adminAnalytics.chartCard.chartRegion", { title: "Impressions" }),
      ),
    ).toBeTruthy();
  });

  it("karta z pełnym wyposażeniem jest czysta w axe - bez ani jednej ulgi", async () => {
    // BEZ WYŁĄCZANIA REGUŁ. Wcześniej `button-name` musiała tu być wygaszona,
    // bo wyzwalacz menu eksportu był samą ikoną bez nazwy; defekt jest
    // zamknięty, więc ulga zniknęła. Reszta - region wykresu, tabela danych,
    // nagłówki kolumn, stopka - przechodziła bez ulg już wcześniej.
    const { container } = karta({
      subtitle: "Ostatnie 30 dni",
      csv: CSV,
      footer: <span>próbka: 1 240 sesji</span>,
      onDataClick: () => null,
    });

    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("KAŻDY przycisk powłoki ma dostępną nazwę, także wyzwalacz menu eksportu", () => {
    // Przycisk „trzy kropki" to sama ikona `MoreHorizontal`, bez tekstu -
    // jedyne wejście do eksportu PNG i CSV. Bez `aria-label` czytnik ekranu
    // ogłaszałby je jako samo „przycisk", czyli dla osoby niewidzącej jako
    // wejście nieopisane. Nazwa idzie ze słownika
    // (`adminAnalytics.chartCard.exportMenu`), dokładnie tak jak w sąsiednim
    // przełączniku pełnego ekranu - ten sam mechanizm dla obu przycisków
    // powłoki. Asercja jest ZBIORCZA (pętla po wszystkich przyciskach), żeby
    // każdy kolejny przycisk dołożony do nagłówka karty musiał przejść tę samą
    // bramkę, a nie tylko te dwa, które istnieją dziś.
    //
    // UWAGA na pomocnik `wyzwalaczMenu()` wyżej: rozpoznaje wyzwalacz przez
    // ODJĘCIE przycisku pełnego ekranu, a nie przez „przycisk bez nazwy" -
    // dlatego nadaną tu nazwę znosi bez zmian.
    const { container } = karta({ csv: CSV });

    for (const przycisk of within(container).getAllByRole("button")) {
      const nazwa = przycisk.getAttribute("aria-label") ?? przycisk.textContent ?? "";
      expect(nazwa.trim()).not.toBe("");
    }
  });
});
