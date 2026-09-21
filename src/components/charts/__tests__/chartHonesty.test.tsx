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
import { BAR_MAX } from "@/lib/charts/geometry";
import { Chart } from "../Chart";
import { CartesianChart } from "../CartesianChart";
import { slotForSeries } from "@/lib/charts/palette";

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
    (el.getAttribute("style") ?? "").includes(
      `fill-opacity: var(--chart-band-${slotForSeries(0)})`,
    ),
  );

/**
 * Kontener wykresu - jedyny element, który przyjmuje fokus i strzałki.
 * Klawiatura jest tu drogą do stanu wskazania, a nie ozdobą: bez niej nie da
 * się w happy-dom otworzyć dymka, bo wskaźnik wymaga podmiany prostokąta
 * trafień (`getBoundingClientRect` oddaje zera).
 */
const box = (root: HTMLElement): HTMLElement => {
  const el = root.querySelector<HTMLElement>("[role='img']");
  if (!el) throw new Error("brak kontenera wykresu");
  return el;
};

/**
 * Etykiety osi kategorii.
 *
 * `text-anchor` jest tu FILTREM, nie kosmetyką selektora: podpis strefy
 * prognozy ("Prognoza") jedzie tym samym kolorem `--muted-foreground` i też
 * nie ma klasy `tabular-nums`, więc sam selektor koloru wciągałby go do
 * zestawu etykiet i przesuwał wszystkie indeksy o jeden. Etykiety osi zawsze
 * dostają jawne wyrównanie (`middle` albo `end` przy obrocie), podpis strefy
 * nigdy.
 */
const catLabels = (root: HTMLElement): Element[] =>
  all(root, "text[fill='var(--muted-foreground)']:not(.tabular-nums)").filter((el) =>
    el.hasAttribute("text-anchor"),
  );

/** Współrzędne X środków kategorii, odczytane z etykiet osi. */
const catCentersOf = (root: HTMLElement): number[] =>
  catLabels(root).map((el) => Number(el.getAttribute("x")));

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

  /** Ta sama prognoza na KOLUMNACH - granica ma tam inną arytmetykę. */
  const SLUPKI_Z_PROGNOZA: Record<string, Json> = {
    kind: "bar",
    categories: ["2023", "2024", "2025", "2026"],
    series: [{ name: "Naklady", values: [10, 12, 14, 15] }],
    forecastFrom: 2,
    animate: false,
  };

  /**
   * Luka PRZED granicą prognozy: pierwszy ciąg (indeksy 0-1) leży cały
   * w historii, drugi (3-5) przechodzi przez granicę.
   */
  const LUKA_PRZED_PROGNOZA: Record<string, Json> = {
    ...FORECAST,
    series: [{ name: "PKB", values: [10, 12, null, 15, 16, 18] }],
  };

  it("LINIA SERII ZOSTAJE CIĄGŁA - także w prognozie", () => {
    // ZMIANA REGUŁY, nie regresja. Wcześniej prognoza jechała kreskowaniem
    // przyciętym maską; specyfikacja mówi teraz, że prognoza jest odróżniona
    // TRZEMA nośnikami jednocześnie (pasmo, strefa, separator z etykietą),
    // a kreskowana linia dodaje czwarty i zaczyna wyglądać na artefakt
    // renderu - kreska na współrzędnej niecałkowitej aliasuje przy innym DPR.
    // Czwarty nośnik nie dodaje informacji, tylko szum.
    const { container } = render(<CartesianChart config={cfg(FORECAST)} lang="pl" />);
    const lines = all(container, "path.neh-line");
    expect(lines).toHaveLength(1);
    // Ani kreskowania, ani drugiej ścieżki, ani masek - te ostatnie istniały
    // wyłącznie po to, żeby kreskowany ogon nie leżał na ciągłym podkładzie.
    expect(lines[0].getAttribute("stroke-dasharray")).toBeNull();
    expect(lines[0].getAttribute("clip-path")).toBeNull();
    expect(all(container, "path.neh-forecast-line")).toHaveLength(0);
    expect(container.querySelector("clipPath")).toBeNull();
  });

  it("TRZY NOŚNIKI naraz: pasmo, strefa i separator z etykietą", () => {
    // Prognoza jako pojedyncza linia bez przedziału to najczęstsza forma
    // kłamstwa na wykresie, więc pasmo jest obowiązkowe - a strefa i separator
    // niosą podział także tam, gdzie pasmo jest wąskie.
    const { container } = render(<CartesianChart config={cfg(FORECAST)} lang="pl" />);
    expect(bandsOf(container).length).toBeGreaterThan(0);
    expect(all(container, "rect[fill='var(--chart-zone)']")).toHaveLength(1);
    expect(all(container, "line.neh-forecast-divider")).toHaveLength(1);
    expect(container.textContent ?? "").toContain("Prognoza");
  });

  it("PUNKTY OBSERWACJI TYLKO NA HISTORII - ich brak sam mówi, że tam nie ma pomiarów", () => {
    // Nośnik mocniejszy od kreskowania, bo działa w druku, w skali szarości
    // i na zrzucie ekranu. Kropka nad wartością prognozowaną podawała
    // interpolację za pomiar.
    const { container } = render(<CartesianChart config={cfg(FORECAST)} lang="pl" />);
    const dots = all(container, "circle.neh-dot");
    // Sześć kategorii, prognoza od indeksu 4 - zostają cztery kropki historii.
    expect(dots).toHaveLength(4);
    const divider = Number(all(container, "line.neh-forecast-divider")[0].getAttribute("x1"));
    for (const dot of dots) {
      expect(Number(dot.getAttribute("cx"))).toBeLessThan(divider);
    }
  });

  it("BEZ prognozy kropki wracają na cały szereg", () => {
    const { container } = render(
      <CartesianChart config={cfg({ ...FORECAST, forecastFrom: null })} lang="pl" />,
    );
    expect(all(container, "circle.neh-dot")).toHaveLength(6);
    expect(all(container, "line.neh-forecast-divider")).toHaveLength(0);
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
    // Kropki są już TYLKO na historii, więc ostatnia z nich jest ostatnią
    // obserwacją. Pierwszą prognozę bierzemy z pasma niepewności: jego
    // obwiednia startuje na kategorii granicznej, a więc jej drugi punkt jest
    // pierwszą kategorią prognozowaną.
    const lastObservation = Math.max(...dots);
    expect(divider).toBeGreaterThan(lastObservation);
    const band = bandsOf(container)[0].getAttribute("d") ?? "";
    const xs = [...band.matchAll(/[ML]\s*([\d.]+)/g)].map((m) => Number(m[1]));
    const firstForecast = xs.filter((x) => x > divider).sort((a, b) => a - b)[0];
    expect(firstForecast).toBeGreaterThan(divider);
    // Separator leży POMIĘDZY nimi, bo pomiar z kategorii granicznej jest
    // nadal pomiarem i separator nie może przez niego przechodzić.
    expect(divider).toBeLessThan(firstForecast);
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
    // Bez pasma zostają DWA nośniki z trzech: strefa i separator z etykietą.
    // Silnik nie dorysowuje wtedy trzeciego na siłę (kreskowanie linii wypadło
    // z reguł), a brak pasma jest osobno wyłapywany przez ostrzeżenie
    // uczciwościowe - patrz `isForecastMissingBand`.
    expect(bandsOf(container)).toHaveLength(0);
    expect(all(container, "line.neh-forecast-divider")).toHaveLength(1);
    expect(all(container, "rect[fill='var(--chart-zone)']")).toHaveLength(1);
    expect(all(container, "path.neh-line")[0].getAttribute("stroke-dasharray")).toBeNull();
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

  it("dymek kategorii PROGNOZOWANEJ jest oznaczony flagą, a zmierzonej NIE - i granica nie przesuwa się o jedną kategorię", () => {
    // Trzy nośniki odróżnienia prognozy (pasmo, strefa, separator) są
    // GRAFICZNE. Kto czyta wykres kursorem albo strzałkami, patrzy w dymek -
    // a tam liczba 16 z kategorii prognozowanej wyglądała identycznie jak 15
    // z kategorii zmierzonej. Dymek jest jedynym miejscem, w którym czytelnik
    // dostaje KONKRETNĄ liczbę, więc brak flagi znaczył, że najdokładniejszy
    // odczyt wykresu był jednocześnie jedynym pozbawionym ostrzeżenia.
    //
    // Test przechodzi CAŁY szereg, bo defekt, którego się tu boję, to nie
    // „flagi nie ma", a „flaga jest o jedną kategorię za wcześnie": pomiar
    // z kategorii granicznej (indeks `forecastFrom - 1`) jest nadal pomiarem
    // i oznaczenie go prognozą byłoby kłamstwem w drugą stronę.
    const { container } = render(<CartesianChart config={cfg(FORECAST)} lang="pl" />);
    const el = box(container);
    for (let i = 0; i < 6; i++) {
      fireEvent.keyDown(el, { key: "ArrowRight" });
      const flaga = container.querySelector(".neh-tooltip div.uppercase");
      expect(Boolean(flaga), `kategoria ${i}`).toBe(i >= 4);
      if (flaga) expect(flaga.textContent).toBe("prognoza");
    }
  });

  it("flaga prognozy jest OSOBNYM wierszem dymka i mówi językiem wykresu", () => {
    // Sklejona z wartością ("16 prognoza") czytałaby się jak jednostka albo
    // jak część liczby - a prognozą jest CAŁA kategoria, nie pojedynczy
    // odczyt jednej serii. Dlatego flaga stoi nad listą serii, poza `<dd>`,
    // i dlatego wchodzi tam przez słownik, a nie jako literał: wykres
    // w interfejsie angielskim z polskim „prognoza" w dymku jest defektem
    // tej samej klasy co brak flagi.
    const { container } = render(<CartesianChart config={cfg(FORECAST)} lang="en" />);
    for (let i = 0; i < 5; i++) fireEvent.keyDown(box(container), { key: "ArrowRight" });
    const tip = container.querySelector(".neh-tooltip");
    expect(tip?.querySelector("div.uppercase")?.textContent).toBe("forecast");
    for (const dd of tip?.querySelectorAll("dd") ?? []) {
      expect(dd.textContent).not.toContain("forecast");
    }
  });

  it("na KOLUMNACH granica prognozy biegnie szczeliną między pasmami, nie przez kolumnę", () => {
    // Na linii granicę wyznacza połowa drogi między dwoma PUNKTAMI, ale
    // kolumna zajmuje całe pasmo kategorii. Ta sama arytmetyka postawiłaby
    // separator na środku pasma, czyli PRZEZ kolumnę - a wtedy tło strefy
    // zamalowuje prawą połowę zmierzonej kolumny i pojedynczy pomiar zostaje
    // rozdzielony na „historię" i „prognozę". Dla słupków granicą musi więc
    // być KRAWĘDŹ pasma, nie jego środek.
    const { container } = render(<CartesianChart config={cfg(SLUPKI_Z_PROGNOZA)} lang="pl" />);
    const divider = Number(all(container, "line.neh-forecast-divider")[0].getAttribute("x1"));
    const centers = catCentersOf(container);
    expect(centers).toHaveLength(4);
    const innerW = Number(all(container, "rect.neh-hit")[0].getAttribute("width"));
    const band = innerW / centers.length;

    // Dwa niezależne rachunki tej samej liczby: krawędź pasma pierwszej
    // prognozowanej kategorii i połowa drogi między środkami sąsiadów.
    expect(divider).toBeCloseTo(centers[2] - band / 2, 6);
    expect(divider).toBeCloseTo((centers[1] + centers[2]) / 2, 6);

    // I ta liczba leży w SZCZELINIE: kolumna jest węższa od pasma (72% pasma,
    // najwyżej 24 px), więc separator nie dotyka ani ostatniej zmierzonej
    // kolumny, ani pierwszej prognozowanej.
    const barW = Math.min(BAR_MAX, band * 0.72);
    expect(divider).toBeGreaterThan(centers[1] + barW / 2);
    expect(divider).toBeLessThan(centers[2] - barW / 2);

    // Strefa startuje na tej samej krawędzi i obejmuje DOKŁADNIE dwie
    // prognozowane kategorie - ani piksela historii, ani uciętej prognozy.
    const zone = all(container, "rect.neh-zone-tint")[0];
    expect(Number(zone.getAttribute("x"))).toBeCloseTo(divider, 6);
    expect(Number(zone.getAttribute("width"))).toBeCloseTo(2 * band, 6);
  });

  it("CIĄG LEŻĄCY CAŁY W HISTORII nie dokłada do pasma pustego domknięcia", () => {
    // Luka przed granicą rozbija serię na dwa ciągi, a pasmo liczy się PER
    // CIĄG (obwiednia policzona przez lukę malowałaby niepewność nad
    // kategorią bez pomiaru). Ciąg leżący cały przed granicą nie ma z czego
    // zrobić obwiedni - i tu jest pułapka: bez klamry na liczbie punktów
    // `forecastBandPath` zwracał dla niego napis " Z". Pusty w treści, ale
    // PRAWDZIWY dla `filter(Boolean)`, więc wchodził do sklejonej ścieżki
    // i pasmo zaczynało się od bezładnego domknięcia. Przeglądarka takie
    // domknięcie zignoruje, ale ścieżka przestaje być JEDNYM wielokątem,
    // a jej pierwsze `M` przestaje wyznaczać początek pasma - czyli traci
    // sens każdy odczyt geometrii pasma, w tym asercja „na granicy szerokość
    // zero" w teście obok.
    const { container } = render(<CartesianChart config={cfg(LUKA_PRZED_PROGNOZA)} lang="pl" />);
    const band = bandsOf(container)[0]?.getAttribute("d") ?? "";
    expect(band).not.toBe("");
    expect(band.trimStart().startsWith("M")).toBe(true);
    // Jedno domknięcie = jeden wielokąt = jedno pasmo.
    expect((band.match(/Z/g) ?? []).length).toBe(1);

    // Pasmo obejmuje kategorię graniczną i cały ogon prognozy - i nic przed
    // granicą, bo tam nie ma prognozy, o której niepewności można by mówić.
    // Wszystkie liczby w ścieżce chodzą parami (x, y), więc parzyste pozycje
    // to współrzędne X.
    const centers = catCentersOf(container);
    const xs = (band.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(centers[3], 1);
    expect(Math.max(...xs)).toBeCloseTo(centers[5], 1);
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
    expect(bars[0].getAttribute("fill")).toBe(`var(--chart-${slotForSeries(0)})`);
    expect(bars[4].getAttribute("fill")).toBe(`var(--chart-${slotForSeries(0)})`);
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
    // Trzeciego klucza NIE MA, bo w tych danych nie ma zerowego składnika.
    // Klucz bezwarunkowy obiecywałby kategorię nieobecną na rysunku.
    expect(text).not.toContain("Bez zmiany");
  });

  // SKŁADNIK O WKŁADZIE DOKŁADNIE ZEROWYM - trzeci kierunek, który model
  // zwracał od początku (`direction: "flat"`), a render go nie znał.
  //
  // CO BYŁO. Wszystkie trzy miejsca pytały wyłącznie `=== "down"`, więc
  // zerowy wkład wpadał do gałęzi "nie down": malował się kolorem DODATNIM
  // i podpisywał w dymku "Wzrost". Wykres, który koduje znak kolorem,
  // twierdził o wzroście, którego nie było, a mostek dekompozycji marży
  // gubił przy tym osobną informację - pozycję, która się nie ruszyła.
  //
  // CZEMU TRZECI TUSZ, A NIE TOKEN OSI. Wkład zerowy nie ma znaku, więc nie
  // może dostać koloru znaku; ale jest ZNACZNIKIEM DANYCH, więc obowiązuje go
  // próg obiektu graficznego 3,0:1. Token osi ma do płyty 1,40:1 i kreska
  // byłaby praktycznie niewidoczna; `--muted-foreground` daje 5,11:1
  // w najgorszym przypadku.
  describe("składnik o wkładzie zerowym", () => {
    const Z_ZEREM: Record<string, Json> = {
      kind: "waterfall",
      categories: ["EBITDA 2024", "Cena", "Kurs walutowy", "Koszty", "EBITDA 2025"],
      series: [{ name: "Mostek", values: [100, 20, 0, -20, 100] }],
      unit: " mln",
      animate: false,
    };

    it("nie dostaje koloru znaku - ani dodatniego, ani ujemnego", () => {
      const { container } = render(<CartesianChart config={cfg(Z_ZEREM)} lang="pl" />);
      const bars = all(container, "path.neh-bar");
      expect(bars).toHaveLength(5);
      expect(bars[2].getAttribute("fill")).toBe("var(--muted-foreground)");
      expect(bars[1].getAttribute("fill")).toBe("var(--chart-positive)");
      expect(bars[3].getAttribute("fill")).toBe("var(--chart-negative)");
    });

    it("w dymku NIE nazywa się wzrostem", () => {
      const { container } = render(<CartesianChart config={cfg(Z_ZEREM)} lang="pl" />);
      const hit = container.querySelector("rect.neh-hit");
      if (!hit) throw new Error("brak warstwy trafień");
      Object.defineProperty(hit, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 674,
          bottom: 270,
          width: 674,
          height: 270,
          toJSON: () => ({}),
        }),
      });
      // Trzecia z pięciu kategorii, czyli środek pola trafień.
      fireEvent.pointerMove(hit, { clientX: 674 * 0.5, clientY: 135 });
      const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
      expect(dymek).toContain("Bez zmiany");
      expect(dymek).not.toContain("Wzrost");
    });

    it("legenda dopisuje trzeci klucz TYLKO wtedy, gdy taki składnik istnieje", () => {
      const { container } = render(<Chart config={cfg(Z_ZEREM)} lang="pl" />);
      const text = container.textContent ?? "";
      expect(text).toContain("Bez zmiany");
      // Dwa pozostałe klucze zostają - zerowy składnik nie zastępuje znaku.
      expect(text).toContain("Wzrost");
      expect(text).toContain("Spadek");
    });
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

  it("wskazanie kroku mostka NAZYWA jego rolę - filar, wzrost, spadek - a nie nazwę serii", () => {
    // Mostek jest jedynym wykresem w silniku, na którym nazwa serii jest
    // BEZUŻYTECZNA: wszystkie słupki pochodzą z jednej serii, więc dymek
    // z napisem „Mostek" przy każdym kroku nie mówi nic. Znaczenie niesie
    // ROLA kroku, a role są cztery i tylko dwie z nich widać z kształtu
    // (filar stoi na zerze, składnik wisi); wzrostu od spadku bez koloru nie
    // odróżni czytelnik, który koloru nie widzi. Dlatego rola idzie napisem,
    // i to napisem ze słownika - polski dymek na wykresie angielskim jest
    // defektem tej samej klasy co brak nazwy.
    const { container } = render(<CartesianChart config={cfg(BRIDGE)} lang="pl" />);
    const el = box(container);
    const role = ["Stan początkowy", "Wzrost", "Spadek", "Spadek", "Stan końcowy"];
    for (const [i, rola] of role.entries()) {
      fireEvent.keyDown(el, { key: "ArrowRight" });
      const tip = container.querySelector(".neh-tooltip");
      expect(tip?.querySelector("dt")?.textContent, `krok ${i}`).toBe(rola);
      // ŻADNEJ PRÓBKI KOLORU. Na mostku kolor koduje ZNAK, nie tożsamość
      // serii, więc kwadracik obok nazwy obiecywałby klucz do legendy serii,
      // której tu nie ma - a legenda mostka mówi właśnie o znaku.
      expect(tip?.querySelector("dt span[aria-hidden]")).toBeNull();
    }
  });

  it("dymek mostka pokazuje WKŁAD kroku, nie poziom, do którego krok dowiózł", () => {
    // Cały sens mostka polega na tym, że składnik koduje długością SWÓJ
    // wkład, a nie osiągnięty poziom - i dymek musi mówić to samo, co
    // kształt. Trzeci krok BRIDGE wisi między 120 i 115; gdyby dymek podawał
    // krawędź słupka, czytelnik dostałby „115" i sumowanie dekompozycji
    // przestałoby się zgadzać z liczbami, które przed chwilą przeczytał.
    const { container } = render(<CartesianChart config={cfg(BRIDGE)} lang="pl" />);
    const el = box(container);
    for (let i = 0; i < 3; i++) fireEvent.keyDown(el, { key: "ArrowRight" });
    const wartosc = container.querySelector(".neh-tooltip dd")?.textContent ?? "";
    expect(wartosc).toContain("-5");
    expect(wartosc).not.toContain("115");
    expect(wartosc).not.toContain("120");
  });

  it("mostek NA SAMYCH KATEGORIACH, bez ani jednej liczby, rysuje filary na zerze i pisze zero", () => {
    // Tak wygląda mostek wklejony z arkusza, w którym wypełniono nagłówki
    // i nie wypełniono wartości - i to jest przypadek, w którym najłatwiej
    // zgadnąć zamiast przyznać się do braku. Silnik ma wtedy narysować
    // kompletny szkielet z zerami: trzy słupki o wysokości zera i trzy
    // etykiety „0". Zgadnięty poziom albo puste płótno byłyby gorsze -
    // pierwsze kłamie, drugie każe autorowi szukać, czy blok w ogóle działa.
    const { container } = render(
      <CartesianChart
        config={cfg({ kind: "waterfall", categories: ["Start", "Zmiana", "Koniec"], series: [] })}
        lang="pl"
      />,
    );
    expect(all(container, "path.neh-bar")).toHaveLength(3);
    expect(textOf(container, "text.neh-value-label")).toEqual(["0", "0", "0"]);
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
    expect(names[0]).toContain(`var(--chart-${slotForSeries(0)}t)`);
    expect(names[1]).toContain(`var(--chart-${slotForSeries(1)}t)`);
  });

  it("legenda zawsze pokazuje pełne kolory, bez kreskowania", () => {
    const { container } = render(
      <Chart
        config={cfg({
          kind: "line",
          categories: ["a", "b", "c", "d"],
          series: [
            { name: "Pierwsza", values: [1, 2, 3, 4], colorSlot: 9 },
            { name: "Nieodróżnialna", values: [4, 3, 2, 1], colorSlot: 16 },
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
    expect(swatches[1]).not.toContain("repeating-linear-gradient");
    expect(swatches[0]).toContain("var(--chart-9)");
    expect(swatches[1]).toContain("var(--chart-16)");
  });

  it("kreskowanie dojeżdża TAKŻE do linii na rysunku, nie tylko do legendy", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "line",
          categories: ["a", "b", "c", "d"],
          series: [
            { name: "Pierwsza", values: [1, 2, 3, 4], colorSlot: 9 },
            { name: "Nieodróżnialna", values: [4, 3, 2, 1], colorSlot: 16 },
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
