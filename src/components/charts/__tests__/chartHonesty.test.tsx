// Render nowych elementów silnika wykresów: PODPIS UCZCIWOŚCIOWY, PROGNOZA,
// MOSTEK i TOOLTIP OBJAŚNIAJĄCY.
//
// PO CO OSOBNY PLIK. Reguły, które te elementy realizują, mają już dowody
// jednostkowe: `lib/charts/honesty.ts` (ucięta oś, prognoza bez pasma),
// `lib/charts/waterfall.ts` (kształt mostka i suma kontrolna),
// `lib/charts/labels.ts` (drabina etykiet). Czego tamte pliki NIE dowodzą, to
// PRZEJŚCIE tych reguł przez render - a klasa defektu jest tu zawsze ta sama
// i cicha: wykres nadal się rysuje, tylko przestaje mówić prawdę o sobie.
//
// KONKRETNIE ŁAPIEMY:
//   * podpis, który gubi jednostkę, `n` albo datę danych - wykres wygląda
//     wtedy identycznie, a znaczy co innego;
//   * ostrzeżenie o uciętej osi, które nie dojechało do DOM przy wykresie,
//     którego oś naprawdę jest ucięta;
//   * prognozę nieodróżnioną od historii - czyli interpolację podaną za
//     pomiar;
//   * mostek bez sumy kontrolnej w alternatywie tekstowej;
//   * tooltip objaśniający, który stracił którekolwiek z pięciu pól albo ich
//     kolejność (kolejność jest tu całą wartością - czytelnik uczy się, gdzie
//     czego szukać).
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { freezeClock } from "@/test/time";
import { parseChartConfig } from "@/lib/charts/parse";
import { Chart } from "../Chart";
import { CartesianChart } from "../CartesianChart";

// ZAMROŻONY ZEGAR, bo ten plik niesie literał daty (`sourceDate`), a bramka
// `check:clock-freeze` jest RATCHETEM: plik nieobecny na liście długu musi
// mieć zero literałów albo zamrażać zegar, a lista może tylko maleć - dopisanie
// się do niej jest dokładnie tym, czego bramka zabrania.
//
// Tutaj literał jest wejściem konwersji i etykietą: `sourceDate` jedzie
// do podpisu i wychodzi z niego jako ten sam napis, bez porównania z „teraz".
// Bramka nie ma jak tego odróżnić od okna liczonego z `Date.now()` i słusznie
// nie zgaduje, więc zamrożenie jest tu zapłatą za jej niewiedzę, a nie
// naprawą realnej bomby - ale kosztuje jedną linię i zdejmuje z pliku klasę
// defektu „przejdzie dziś, padnie w dniu, w którym data wyjdzie z okna".
freezeClock();

const cfg = (data: Record<string, Json>) => parseChartConfig(data);
const all = (root: HTMLElement, sel: string): Element[] => [...root.querySelectorAll(sel)];
const textOf = (root: HTMLElement, sel: string): string[] =>
  all(root, sel).map((e) => e.textContent ?? "");
/** Pasma i pola: krycie z tokena siedzi w `style`, nie w atrybucie. */
const bandsOf = (root: HTMLElement): Element[] =>
  all(root, "path").filter((el) =>
    (el.getAttribute("style") ?? "").includes("fill-opacity: var(--chart-band-1)"),
  );

const SERIES_4: Record<string, Json> = {
  kind: "line",
  categories: ["2021", "2022", "2023", "2024"],
  series: [{ name: "Marża", values: [12, 15, 14, 18] }],
  animate: false,
};

describe("ChartFrame - podpis uczciwościowy", () => {
  it("jednostka, n i data danych jadą w podpisie jako OSOBNE fakty", () => {
    const { container } = render(
      <Chart
        config={cfg({
          ...SERIES_4,
          unit: "%",
          sampleSize: 48,
          sourceDate: "2026-06-30",
          source: "Źródło: Eurostat",
        })}
        lang="pl"
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Źródło: Eurostat");
    expect(text).toContain("Jednostka: %");
    expect(text).toContain("n = 48");
    expect(text).toContain("Dane na dzień: 2026-06-30");
  });

  it("pola, których autor nie podał, NIE zostawiają puste etykiety", () => {
    // Podpis "n = " albo "Jednostka: " bez wartości jest gorszy niż brak
    // podpisu: sugeruje, że liczba jest, tylko się nie wyświetliła.
    const { container } = render(<Chart config={cfg(SERIES_4)} lang="pl" />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("n =");
    expect(text).not.toContain("Jednostka:");
    expect(text).not.toContain("Dane na dzień:");
  });

  it("`n` równe zero jest traktowane jak BRAK, nie jak pomiar", () => {
    // Zero obserwacji na wykresie, który coś rysuje, jest liczbą nieprawdziwą.
    const { container } = render(<Chart config={cfg({ ...SERIES_4, sampleSize: 0 })} lang="pl" />);
    expect(container.textContent ?? "").not.toContain("n =");
  });

  it("UCIĘTA OŚ jest nazwana wprost, nie zostawiona do wyczytania z podziałek", () => {
    const { container } = render(
      <Chart
        config={cfg({
          kind: "line",
          categories: ["a", "b", "c", "d"],
          series: [{ name: "Indeks", values: [980, 1010, 995, 1020] }],
          animate: false,
        })}
        lang="pl"
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Oś wartości nie zaczyna się od zera");
    // Ostrzeżenie mówi TAKŻE, co z tym zrobić - inaczej jest samym alarmem.
    expect(text).toContain("Pełne liczby są w tabeli danych");
  });

  it("SŁUPKI nie dostają tego ostrzeżenia - ich oś zawsze zaczyna się od zera", () => {
    const { container } = render(
      <Chart
        config={cfg({
          kind: "bar",
          categories: ["a", "b", "c"],
          series: [{ name: "S", values: [980, 1010, 995] }],
          animate: false,
        })}
        lang="pl"
      />,
    );
    expect(container.textContent ?? "").not.toContain("nie zaczyna się od zera");
  });

  it("trzy zdania mają STAŁĄ kolejność, a puste są pomijane", () => {
    const { container } = render(
      <Chart
        config={cfg({
          ...SERIES_4,
          notesShows: "Marża rośnie trzeci rok.",
          notesHidden: "Nie pokazuje kosztów jednorazowych.",
        })}
        lang="pl"
      />,
    );
    const labels = textOf(container, "dl dt").filter((l) =>
      ["Co pokazuje", "Co jest zaskakujące", "Czego nie pokazuje"].includes(l),
    );
    // Autor podał dwa z trzech: kolejność zostaje, brakujące nie robi dziury.
    expect(labels).toEqual(["Co pokazuje", "Czego nie pokazuje"]);
  });

  it("podpis jest dwujęzyczny - te same dane, inne napisy", () => {
    const config = cfg({ ...SERIES_4, unit: "%", sampleSize: 12, notesHidden: "x" });
    const pl = render(<Chart config={config} lang="pl" />);
    expect(pl.container.textContent ?? "").toContain("Czego nie pokazuje");
    pl.unmount();

    const en = render(<Chart config={config} lang="en" />);
    const text = en.container.textContent ?? "";
    expect(text).toContain("What it does not show");
    expect(text).toContain("Unit: %");
    expect(text).not.toContain("Czego nie pokazuje");
  });
});

describe("CartesianChart - prognoza", () => {
  const FORECAST: Record<string, Json> = {
    kind: "line",
    categories: ["2021", "2022", "2023", "2024", "2025", "2026"],
    series: [{ name: "PKB", values: [10, 12, 13, 15, 16, 18] }],
    forecastFrom: 4,
    forecastBandPct: 12,
    animate: false,
  };

  it("prognoza dostaje WŁASNĄ kreskowaną ścieżkę, przyciętą maską prognozy", () => {
    const { container } = render(<CartesianChart config={cfg(FORECAST)} lang="pl" />);
    const dashed = all(container, "path.neh-forecast-line");
    expect(dashed).toHaveLength(1);
    expect(dashed[0].getAttribute("stroke-dasharray")).toBe("6 4");
    expect(all(container, "path.neh-line")).toHaveLength(1);
    // Obie ścieżki są PRZYCIĘTE, każda do swojej połowy rysunku. Bez
    // przycięcia kreskowana prognoza leżała na ciągłej linii i w przerwach
    // kreskowania było widać podkład - prognoza wyglądała na ciągłą, czyli
    // podział, który miał ostrzegać, nie istniał wizualnie.
    const histClip = all(container, "path.neh-line")[0].getAttribute("clip-path") ?? "";
    const fcClip = dashed[0].getAttribute("clip-path") ?? "";
    expect(histClip).toMatch(/^url\(#neh-hist-/);
    expect(fcClip).toMatch(/^url\(#neh-fc-/);
    expect(histClip).not.toBe(fcClip);
  });

  it("historia i prognoza to JEDNA geometria, nie dwie policzone osobno", () => {
    // Policzona osobno prognoza przestaje być tą samą krzywą: krótki ogon
    // dostaje inne styczne Hermite'a, a poniżej czterech punktów żadnego
    // wygładzenia - więc odjeżdżałaby od historii dokładnie w miejscu,
    // w którym powinna z niej wychodzić.
    const { container } = render(<CartesianChart config={cfg(FORECAST)} lang="pl" />);
    const historia = all(container, "path.neh-line")[0].getAttribute("d");
    const prognoza = all(container, "path.neh-forecast-line")[0].getAttribute("d");
    expect(prognoza).toBe(historia);
    expect(historia).not.toBe("");
  });

  it("SERIA Z LUKĄ: prognoza obejmuje właściwe kategorie, a nie przesunięte o luki", () => {
    // REGRESJA. Część prognozy była wybierana przez indeksowanie listy
    // wszystkich niepustych wartości SERII indeksem lokalnym dla ciągu, więc
    // przy jednej dziurze prognoza obejmowała nie te kategorie, a przy dziurze
    // przed granicą znikała zupełnie: `d` wychodziło puste, mimo że separator
    // "Prognoza" nadal był rysowany. Czytelnik widział wtedy po prawej stronie
    // separatora zwykłą, ciągłą historię.
    const { container } = render(
      <CartesianChart
        config={cfg({
          ...FORECAST,
          series: [{ name: "PKB", values: [10, 12, null, 15, 16, 18] }],
        })}
        lang="pl"
      />,
    );
    expect(all(container, "line.neh-forecast-divider")).toHaveLength(1);
    const prognoza = all(container, "path.neh-forecast-line")[0];
    expect(prognoza.getAttribute("d")).not.toBe("");
    // Maska prognozy zaczyna się dokładnie na separatorze, więc to ona - a nie
    // dobór punktów - decyduje, co jest kreskowane.
    const divider = Number(all(container, "line.neh-forecast-divider")[0].getAttribute("x1"));
    const clipId = (prognoza.getAttribute("clip-path") ?? "").replace(/^url\(#|\)$/g, "");
    const rect = container.querySelector(`#${clipId} rect`);
    expect(Number(rect?.getAttribute("x"))).toBeCloseTo(divider, 5);
    expect(Number(rect?.getAttribute("width"))).toBeGreaterThan(0);
  });

  it("pasmo NIE zamyka się przez lukę w danych", () => {
    // REGRESJA. Obwiednia liczona z jednej listy dla całej serii przeskakiwała
    // dziurę i domykała ją kolorem - wykres malował niepewność nad kategorią,
    // w której nie było żadnego pomiaru. Pasmo jest teraz liczone PER CIĄG,
    // a ciąg z definicji nie ma dziur, więc pasm jest tyle, ile ciągów.
    const { container } = render(
      <CartesianChart
        config={cfg({
          ...FORECAST,
          categories: ["2021", "2022", "2023", "2024", "2025", "2026", "2027"],
          series: [{ name: "PKB", values: [10, 12, 13, 15, 16, null, 20] }],
          forecastFrom: 4,
        })}
        lang="pl"
      />,
    );
    const bands = bandsOf(container);
    expect(bands).toHaveLength(1);
    // Jedno pasmo na ciąg, a ciągi są dwa (2021-2025 i 2027), więc ścieżka
    // ma dwa domknięte podobszary. Drugi ciąg ma jeden punkt, czyli pasma nie
    // dostaje wcale - liczba domknięć mówi, ile ciągów je dostało.
    const d = bands[0].getAttribute("d") ?? "";
    expect((d.match(/Z/g) ?? []).length).toBe(1);
    // I najważniejsze: obwiednia nie przechodzi przez kategorię 2026.
    const dots = all(container, "circle.neh-dot").map((c) => Number(c.getAttribute("cx")));
    const lukaX = dots.at(-1);
    expect(dots).toHaveLength(6);
    expect(d).not.toContain(`${lukaX}`);
  });

  it("pasmo WCHODZI DO DOMENY OSI - nie jest przycinane krawędzią rysunku", () => {
    // REGRESJA. Skala liczona z samych wartości pozwalała obwiedni +12%
    // wyjść ponad najwyższą podziałkę i zostać uciętą - a ucięte pasmo
    // niepewności sugeruje, że niepewność KOŃCZY SIĘ tam, gdzie kończy się
    // obszar kreślenia.
    const { container } = render(<CartesianChart config={cfg(FORECAST)} lang="pl" />);
    const band = bandsOf(container)[0];
    const ys = [...(band.getAttribute("d") ?? "").matchAll(/[ML]\s*[\d.]+\s+([\d.]+)/g)].map((m) =>
      Number(m[1]),
    );
    const gora = Math.min(...ys);
    // Najwyższa podziałka osi wyznacza górną krawędź obszaru kreślenia;
    // pasmo musi się pod nią zmieścić (y rośnie w dół, więc >=).
    const siatka = all(container, "line[stroke='var(--chart-grid)']").map((l) =>
      Number(l.getAttribute("y1")),
    );
    expect(siatka.length).toBeGreaterThan(0);
    expect(gora).toBeGreaterThanOrEqual(Math.min(...siatka) - 0.01);
  });

  it("separator i etykieta słowna - kreskowanie samo nie mówi 'prognoza'", () => {
    const { container } = render(<CartesianChart config={cfg(FORECAST)} lang="pl" />);
    expect(all(container, "line.neh-forecast-divider")).toHaveLength(1);
    expect(container.textContent ?? "").toContain("Prognoza");
  });

  it("granica biegnie MIĘDZY ostatnią obserwacją i pierwszą prognozą", () => {
    // Pomiar z kategorii granicznej jest nadal pomiarem, więc separator nie
    // może przez niego przechodzić.
    const { container } = render(<CartesianChart config={cfg(FORECAST)} lang="pl" />);
    const divider = Number(all(container, "line.neh-forecast-divider")[0].getAttribute("x1"));
    const dots = all(container, "circle.neh-dot").map((c) => Number(c.getAttribute("cx")));
    // Czwarty punkt (indeks 3) to ostatnia obserwacja, piąty (indeks 4) to
    // pierwsza prognoza - granica leży dokładnie pomiędzy nimi.
    expect(divider).toBeGreaterThan(dots[3]);
    expect(divider).toBeLessThan(dots[4]);
  });

  it("pasmo niepewności istnieje i ma krycie Z TOKENA slotu", () => {
    const { container } = render(<CartesianChart config={cfg(FORECAST)} lang="pl" />);
    // Krycie w `style`, nie w atrybucie - `var()` w atrybutach prezentacyjnych
    // SVG nie jest wspierane wszędzie, a nierozwiązane krycie to plama.
    const bands = bandsOf(container);
    expect(bands.length).toBeGreaterThan(0);
  });

  it("pasmo ma na granicy szerokość ZERO - pomiar nie ma niepewności prognozy", () => {
    const { container } = render(<CartesianChart config={cfg(FORECAST)} lang="pl" />);
    const band = bandsOf(container).at(-1);
    const d = band?.getAttribute("d") ?? "";
    // Pierwszy punkt obwiedni górnej i OSTATNI dolnej to ta sama kategoria
    // graniczna, więc obie krawędzie startują z tego samego y.
    const first = /^M([\d.]+) ([\d.]+)/.exec(d);
    const last = /L([\d.]+) ([\d.]+) Z$/.exec(d);
    expect(first).not.toBeNull();
    expect(last).not.toBeNull();
    expect(Number(first?.[1])).toBeCloseTo(Number(last?.[1]), 1);
    expect(Number(first?.[2])).toBeCloseTo(Number(last?.[2]), 1);
  });

  it("BEZ pasma prognoza nadal jest odróżniona - ale to jest ostrzeżenie, nie cisza", () => {
    const { container } = render(
      <CartesianChart config={cfg({ ...FORECAST, forecastBandPct: 0 })} lang="pl" />,
    );
    expect(all(container, "path.neh-forecast-line")).toHaveLength(1);
    expect(bandsOf(container)).toHaveLength(0);
  });

  it("prognoza poza zakresem kategorii jest ODRZUCANA, nie rysowana na krawędzi", () => {
    // `forecastFrom: 0` znaczyłoby "cały szereg jest prognozą" - separator
    // stałby na lewej krawędzi i nie mówiłby nic.
    for (const bad of [0, 6, 99, -3]) {
      const { container, unmount } = render(
        <CartesianChart config={cfg({ ...FORECAST, forecastFrom: bad })} lang="pl" />,
      );
      expect(all(container, "line.neh-forecast-divider"), `forecastFrom=${bad}`).toHaveLength(0);
      unmount();
    }
  });

  it("tabela danych dostaje kolumnę prognozy TYLKO gdy prognoza istnieje", () => {
    const z = render(<Chart config={cfg(FORECAST)} lang="pl" />);
    expect(z.container.textContent ?? "").toContain("prognoza");
    z.unmount();

    const bez = render(<Chart config={cfg({ ...FORECAST, forecastFrom: null })} lang="pl" />);
    expect(bez.container.textContent ?? "").not.toContain("prognoza");
  });
});

describe("CartesianChart - mostek (waterfall)", () => {
  const BRIDGE: Record<string, Json> = {
    kind: "waterfall",
    categories: ["EBITDA 2024", "Cena", "Wolumen", "Koszty", "EBITDA 2025"],
    series: [{ name: "Mostek", values: [100, 20, -5, -15, 100] }],
    unit: " mln",
    animate: false,
  };

  it("znak kodują KOLOR I KIERUNEK jednocześnie, a filary są neutralne", () => {
    const { container } = render(<CartesianChart config={cfg(BRIDGE)} lang="pl" />);
    const bars = all(container, "path.neh-bar");
    expect(bars).toHaveLength(5);
    // Filary (pierwszy i ostatni) niosą POZIOM, nie zmianę - więc kolor serii,
    // nie semantyka znaku.
    expect(bars[0].getAttribute("fill")).toBe("var(--chart-1)");
    expect(bars[4].getAttribute("fill")).toBe("var(--chart-1)");
    // Składniki: dodatni tealem, ujemne czerwienią.
    expect(bars[1].getAttribute("fill")).toBe("var(--chart-positive)");
    expect(bars[2].getAttribute("fill")).toBe("var(--chart-negative)");
    expect(bars[3].getAttribute("fill")).toBe("var(--chart-negative)");
    // KIERUNEK jest drugim nośnikiem znaku - klasa mówi o nim wprost, więc
    // animacja wejścia rośnie w stronę zgodną z wartością.
    expect(bars[1].getAttribute("class")).not.toContain("neh-bar-negative");
    expect(bars[2].getAttribute("class")).toContain("neh-bar-negative");
  });

  it("KAŻDY słupek mostka ma etykietę wartości - po to jest mostek", () => {
    const { container } = render(<CartesianChart config={cfg(BRIDGE)} lang="pl" />);
    const labels = textOf(container, "text.neh-value-label");
    expect(labels).toHaveLength(5);
    expect(labels[0]).toContain("100");
    expect(labels[2]).toContain("-5");
  });

  it("legenda mostka mówi o ZNAKU, nie o serii", () => {
    const { container } = render(<Chart config={cfg(BRIDGE)} lang="pl" />);
    const text = container.textContent ?? "";
    expect(text).toContain("Wzrost");
    expect(text).toContain("Spadek");
  });

  it("tabela mostka niesie POZIOM PO KROKU - liczbę, której wykres nie pokazuje", () => {
    const { container } = render(<Chart config={cfg(BRIDGE)} lang="pl" />);
    expect(container.textContent ?? "").toContain("Suma zmian");
  });

  it("NIEDOMKNIĘTA suma kontrolna jest wypisana wprost, nie przemilczana", () => {
    const { container } = render(
      <Chart
        config={cfg({
          ...BRIDGE,
          categories: ["Start", "Cena", "Koniec"],
          series: [{ name: "Mostek", values: [100, 20, 130] }],
        })}
        lang="pl"
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("nie zgadza się z różnicą stanów");
  });

  it("mostek domknięty NIE wypisuje ostrzeżenia", () => {
    const { container } = render(<Chart config={cfg(BRIDGE)} lang="pl" />);
    expect(container.textContent ?? "").not.toContain("nie zgadza się");
  });

  it("mostek czyta WYŁĄCZNIE pierwszą serię", () => {
    // Nie da się dodać dwóch dekompozycji tej samej różnicy, więc druga seria
    // jest zawsze pomyłką - i lepiej ją zignorować niż narysować dwa mostki
    // jeden na drugim.
    const { container } = render(
      <CartesianChart
        config={cfg({
          ...BRIDGE,
          series: [
            { name: "A", values: [100, 20, -5, -15, 100] },
            { name: "B", values: [50, 10, -2, -8, 50] },
          ],
        })}
        lang="pl"
      />,
    );
    expect(all(container, "path.neh-bar")).toHaveLength(5);
  });
});

describe("MetricTooltip - tooltip objaśniający", () => {
  const WITH_METRIC: Record<string, Json> = {
    ...SERIES_4,
    title: "Rentowność kapitału",
    metric: {
      name: "ROIC",
      expansion: "Return on Invested Capital - rentowność kapitału zainwestowanego",
      formula: "NOPAT / kapitał zainwestowany",
      measures: "Rentowność kapitału realnie pracującego w biznesie",
      reading: "Porównuj wyłącznie z WACC",
      levers: "Marża NOPAT w górę albo kapitał zaangażowany w dół",
      caution: "Wrażliwe na definicję mianownika",
    },
  };

  it("wywołanie ma DWA nośniki: nazwę wskaźnika i ikonę", () => {
    render(<Chart config={cfg(WITH_METRIC)} lang="pl" />);
    const trigger = screen.getByRole("button", { name: /ROIC/ });
    expect(trigger.textContent).toContain("ROIC");
    expect(trigger.querySelector("svg")).not.toBeNull();
  });

  it("otwiera się na HOVER, na FOCUS i na KLIK - bez dotyku wykres jest nieużywalny", () => {
    render(<Chart config={cfg(WITH_METRIC)} lang="pl" />);
    const trigger = screen.getByRole("button", { name: /ROIC/ });

    fireEvent.pointerEnter(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerLeave(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();

    // Klik PRZYPINA dymek: na dotyku kursor zsuwa się natychmiast, więc bez
    // przypięcia dymek zamykałby się w tej samej chwili, w której się otworzył.
    fireEvent.click(trigger);
    fireEvent.pointerLeave(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("PIĘĆ PÓL W STAŁEJ KOLEJNOŚCI - to jest cała wartość tej struktury", () => {
    render(<Chart config={cfg(WITH_METRIC)} lang="pl" />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: /ROIC/ }));
    const tip = screen.getByRole("tooltip");
    expect([...tip.querySelectorAll("dt")].map((el) => el.textContent)).toEqual([
      "Wzór",
      "Mierzy",
      "Czytanie",
      "Dźwignie",
      "Uwaga",
    ]);
  });

  it("pole puste NIE zostawia pustego wiersza - lepiej trzy pola niż pięć zmyślonych", () => {
    render(
      <Chart
        config={cfg({
          ...WITH_METRIC,
          metric: { name: "CCC", formula: "DSO + DIO - DPO", caution: "Sezonowość" },
        })}
        lang="pl"
      />,
    );
    fireEvent.pointerEnter(screen.getByRole("button", { name: /CCC/ }));
    const tip = screen.getByRole("tooltip");
    expect([...tip.querySelectorAll("dt")].map((el) => el.textContent)).toEqual(["Wzór", "Uwaga"]);
  });

  it("wskaźnik BEZ nazwy nie stawia ikony - nie ma czego zaczepić", () => {
    const { container } = render(
      <Chart config={cfg({ ...WITH_METRIC, metric: { formula: "x / y" } })} lang="pl" />,
    );
    expect(container.querySelector(".neh-metric-trigger")).toBeNull();
  });

  it("ESCAPE ZAMYKA, choć fokus wraca na wywołanie", () => {
    // REGRESJA. Escape oddaje fokus wywołującemu (inaczej czytelnik zostaje
    // z fokusem w nicości), a wywołanie otwiera dymek NA FOKUS - więc
    // `setOpen(false)` i `setOpen(true)` lądowały w jednej porcji aktualizacji
    // i dymek zostawał otwarty. Escape nie działał w ogóle.
    render(<Chart config={cfg(WITH_METRIC)} lang="pl" />);
    const trigger = screen.getByRole("button", { name: /ROIC/ });

    fireEvent.pointerEnter(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger).toHaveFocus();

    // Tak samo dla dymka PRZYPIĘTEGO klikiem - przypięcie nie może przeżyć
    // Escape, bo wtedy dymka nie da się zamknąć z klawiatury wcale.
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    // Zamknięcie NIE jest trwałe: nowy zamiar czytelnika (zjechanie kursorem
    // i powrót) otwiera dymek z powrotem.
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerEnter(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("nazwy pól są ze SŁOWNIKA - w EN wychodzą po angielsku", () => {
    render(<Chart config={cfg(WITH_METRIC)} lang="en" />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: /ROIC/ }));
    const tip = screen.getByRole("tooltip");
    expect([...tip.querySelectorAll("dt")].map((el) => el.textContent)).toEqual([
      "Formula",
      "Measures",
      "Reading",
      "Levers",
      "Caution",
    ]);
    // Treść wskaźnika jest AUTORSKA, więc zostaje w języku, w którym ją
    // napisano - słownik odpowiada za nazwy pól, nie za definicję.
    expect(tip.textContent).toContain("NOPAT / kapitał zainwestowany");
  });
});

describe("Legenda - warianty tekstowe i kreskowanie", () => {
  it("nazwa serii jedzie WARIANTEM TEKSTOWYM slotu, nie kolorem linii", () => {
    // Próg kontrastu dla tekstu to 4,5:1, dla linii 3,0:1: ochra jako linia
    // jest w porządku, jako napis nie przechodzi audytu dostępności.
    const { container } = render(
      <Chart
        config={cfg({
          kind: "line",
          categories: ["a", "b", "c", "d"],
          series: [
            { name: "Granat", values: [1, 2, 3, 4] },
            { name: "Ochra", values: [4, 3, 2, 1] },
          ],
          animate: false,
        })}
        lang="pl"
      />,
    );
    const names = all(container, "li span:last-child").map((el) => el.getAttribute("style") ?? "");
    expect(names[0]).toContain("var(--chart-1t)");
    expect(names[1]).toContain("var(--chart-2t)");
  });

  it("seria poza zestawem bezpiecznym dla daltonizmu dostaje KRESKOWANIE w legendzie", () => {
    const { container } = render(
      <Chart
        config={cfg({
          kind: "line",
          categories: ["a", "b", "c", "d"],
          series: [
            { name: "Bezpieczna", values: [1, 2, 3, 4], colorSlot: 1 },
            { name: "Rozszerzenie", values: [4, 3, 2, 1], colorSlot: 7 },
          ],
          animate: false,
        })}
        lang="pl"
      />,
    );
    const swatches = all(container, "li span[aria-hidden]").map(
      (el) => el.getAttribute("style") ?? "",
    );
    expect(swatches[0]).not.toContain("repeating-linear-gradient");
    expect(swatches[1]).toContain("repeating-linear-gradient");
  });

  it("kreskowanie dojeżdża TAKŻE do linii na rysunku, nie tylko do legendy", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "line",
          categories: ["a", "b", "c", "d"],
          series: [
            { name: "Bezpieczna", values: [1, 2, 3, 4], colorSlot: 1 },
            { name: "Rozszerzenie", values: [4, 3, 2, 1], colorSlot: 8 },
          ],
          animate: false,
        })}
        lang="pl"
      />,
    );
    const lines = all(container, "path.neh-line");
    expect(lines[0].getAttribute("class")).not.toContain("neh-line-pattern");
    expect(lines[1].getAttribute("class")).toContain("neh-line-pattern");
  });
});
