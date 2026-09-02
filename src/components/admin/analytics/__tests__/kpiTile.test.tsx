// `KpiTile` - kafelek pojedynczego wskaźnika BI: etykieta, duża liczba, chip
// delty względem poprzedniego okresu i mikrowykres.
//
// PO CO. Kafelek jest pierwszą rzeczą, na którą patrzy operator, i JEDYNĄ,
// którą zwykle czyta do końca. Cała jego treść informacyjna powstaje z
// arytmetyki, która nie ma żadnego widocznego objawu przy pomyłce:
//
//   1. ZNAK I KIERUNEK. `formatDelta` liczy procent względem WARTOŚCI
//      BEZWZGLĘDNEJ poprzedniego okresu, a `dir`/`good`/`neutral` decydują o
//      kolorze i strzałce. Pomylenie mianownika albo znaku daje chip, który
//      wygląda dokładnie tak samo, tylko mówi coś przeciwnego.
//   2. DZIELENIE PRZEZ ZERO. Poprzednie okno z zerem (nowy warsztat, świeżo
//      podpięty GSC) to najczęstszy stan pierwszego tygodnia. Bez osobnej
//      gałęzi kafelek pokazałby „NaN%" albo „Infinity%".
//   3. „BRAK DELTY" TO INFORMACJA, nie stan pusty. Kafelek bez porównania NIE
//      MOŻE rysować chipa z zerem - to byłoby „bez zmian" tam, gdzie nie ma
//      z czym porównywać.
//   4. FORMAT LICZBY JEST KONTRAKTEM Z CZYTELNIKIEM. Delta bezwzględna jedzie
//      przez `pl-PL`: przecinek dziesiętny, spacja nierozdzielająca jako
//      separator tysięcy i najwyżej dwa miejsca po przecinku.
//   5. MIKROWYKRES POWSTAJE TYLKO Z SENSOWNEJ SERII. Jeden punkt to nie trend;
//      linia z jednego punktu jest rysunkiem bez treści.
//
// ECHARTS JEST TU ZAKAZANY (nagłówek `EChart.tsx`) - atrapa przechwytuje
// `option`, więc asercje o mikrowykresie idą na dane oddane rendererowi.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  wykresy: [] as Array<Record<string, unknown>>,
}));

vi.mock("../EChart", () => ({
  EChart: ({ option, height }: { option: Record<string, unknown>; height?: number | string }) => {
    const indeks = h.wykresy.length;
    h.wykresy.push(option);
    return <div data-testid="spark" data-chart-index={indeks} data-height={String(height)} />;
  },
}));

import { axeViolations, summarize } from "@/test/axe";
import { KpiTile, type KpiTileProps } from "../KpiTile";

/** Spacja nierozdzielająca - separator tysięcy w `pl-PL`. */
const NBSP = " ";

function kafelek(props: Partial<KpiTileProps> = {}) {
  return render(<KpiTile label="Sesje" value="1 240" {...props} />);
}

/** Chip delty - jedyny element kafelka z ikoną kierunku i tekstem zmiany. */
function chip(): HTMLElement | null {
  return document.querySelector("[class*='rounded-md'][class*='bg-muted/60']");
}

function klasaIkony(): string {
  return chip()?.querySelector("svg")?.getAttribute("class") ?? "";
}

beforeEach(() => {
  h.wykresy.length = 0;
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("KpiTile - treść podstawowa", () => {
  it("etykieta stoi PRZED wartością - tak czyta ją czytnik ekranu", () => {
    const { container } = kafelek({ label: "Sesje", value: "1 240" });

    const tekst = container.textContent ?? "";
    expect(tekst.indexOf("Sesje")).toBeGreaterThanOrEqual(0);
    expect(tekst.indexOf("Sesje")).toBeLessThan(tekst.indexOf("1 240"));
  });

  it("ikona wołającego renderuje się obok etykiety, nie zamiast niej", () => {
    kafelek({ icon: <span data-testid="ikona">◆</span> });

    expect(screen.getByTestId("ikona")).toBeTruthy();
    expect(screen.getByText("Sesje")).toBeTruthy();
  });

  it("wartość jest oddawana DOSŁOWNIE - kafelek jej nie formatuje po swojemu", () => {
    // Formatowanie należy do pulpitu (waluta, procent, czas, „-" dla braku).
    kafelek({ value: "2,4 s" });

    expect(screen.getByText("2,4 s")).toBeTruthy();
  });
});

describe("KpiTile - obecność chipa delty", () => {
  it("bez `current` i bez `previous` chipa NIE MA", () => {
    kafelek();

    expect(chip()).toBeNull();
  });

  it.each([
    ["sam `current`", { current: 120 }],
    ["sam `previous`", { previous: 100 }],
    ["`current` = NaN", { current: Number.NaN, previous: 100 }],
    ["`previous` = Infinity", { current: 120, previous: Number.POSITIVE_INFINITY }],
  ])("przy %s chip się NIE pojawia - nie ma z czym porównać", (_etykieta, props) => {
    // Kafelek z chipem „0%" tam, gdzie porównania nie ma, to zmyślony pomiar.
    kafelek(props as Partial<KpiTileProps>);

    expect(chip()).toBeNull();
  });

  it("z obiema liczbami chip jest - nawet gdy obie to zero", () => {
    kafelek({ current: 0, previous: 0 });

    expect(chip()).not.toBeNull();
  });
});

describe("KpiTile - delta procentowa", () => {
  it("wzrost daje znak plus, jedno miejsce po przecinku i kolor wzrostu", () => {
    kafelek({ current: 120, previous: 100 });

    const c = chip() as HTMLElement;
    expect(within(c).getByText("+20.0%")).toBeTruthy();
    expect(c.className).toContain("text-emerald-600");
    expect(klasaIkony()).toContain("up-right");
  });

  it("spadek NIE dokłada plusa i maluje się kolorem ostrzegawczym", () => {
    kafelek({ current: 80, previous: 100 });

    const c = chip() as HTMLElement;
    expect(within(c).getByText("-20.0%")).toBeTruthy();
    expect(c.className).toContain("text-destructive");
    expect(klasaIkony()).toContain("down-right");
  });

  it("brak zmiany to STAN NEUTRALNY: kreska, kolor stonowany, zero bez znaku", () => {
    kafelek({ current: 100, previous: 100 });

    const c = chip() as HTMLElement;
    expect(within(c).getByText("0.0%")).toBeTruthy();
    expect(c.className).toContain("text-muted-foreground");
    expect(c.className).not.toContain("emerald");
    expect(klasaIkony()).toContain("minus");
  });

  it("procent liczy się od WARTOŚCI BEZWZGLĘDNEJ poprzedniego okresu", () => {
    // Mianownik ze znakiem odwróciłby znak wyniku dla ujemnego okresu bazowego:
    // (-50 - (-100)) / -100 = -50%, choć wartość URosła o połowę.
    kafelek({ current: -50, previous: -100 });

    expect(within(chip() as HTMLElement).getByText("+50.0%")).toBeTruthy();
  });

  it("zaokrągla do JEDNEGO miejsca, nie ucina", () => {
    // 100 -> 133 to 33,0%; 100 -> 133.5 to 33,5%. Ucinanie dałoby 33,4%.
    kafelek({ current: 133.5, previous: 100 });

    expect(within(chip() as HTMLElement).getByText("+33.5%")).toBeTruthy();
  });

  it("poprzednie ZERO przy niezerowym teraz daje nieskończoność, nie NaN", () => {
    // Pierwszy tydzień świeżo podpiętego GSC: poprzednie okno jest puste.
    kafelek({ current: 42, previous: 0 });

    const c = chip() as HTMLElement;
    expect(within(c).getByText("+∞")).toBeTruthy();
    expect(c.textContent).not.toContain("NaN");
    expect(c.textContent).not.toContain("Infinity");
  });

  it("zero do zera to czyste 0%, bez miejsc dziesiętnych i bez nieskończoności", () => {
    kafelek({ current: 0, previous: 0 });

    const c = chip() as HTMLElement;
    expect(within(c).getByText("0%")).toBeTruthy();
    expect(c.textContent).not.toContain("∞");
  });
});

describe("KpiTile - metryka, w której MNIEJ znaczy lepiej", () => {
  it("spadek jest zielony, gdy `higherIsBetter` jest wyłączone", () => {
    // Pozycja w SERP-ach, CLS, LCP: mniejsza liczba to lepszy wynik.
    kafelek({ current: 4.2, previous: 6.0, higherIsBetter: false });

    expect((chip() as HTMLElement).className).toContain("text-emerald-600");
  });

  it("wzrost jest czerwony, gdy `higherIsBetter` jest wyłączone", () => {
    kafelek({ current: 6.0, previous: 4.2, higherIsBetter: false });

    expect((chip() as HTMLElement).className).toContain("text-destructive");
  });

  it("brak zmiany zostaje neutralny niezależnie od kierunku „lepszego”", () => {
    kafelek({ current: 4.2, previous: 4.2, higherIsBetter: false });

    expect((chip() as HTMLElement).className).toContain("text-muted-foreground");
  });

  it.fails("DEFEKT: strzałka przeczy ZNAKOWI liczby przy „mniej znaczy lepiej”", () => {
    // `DeltaIcon = neutral ? Minus : good ? ArrowUpRight : ArrowDownRight` -
    // ikona koduje OCENĘ, nie kierunek, choć stoi bezpośrednio przy liczbie ze
    // znakiem. Dla `higherIsBetter: false` (wszystkie metryki Web Vitals w
    // `VitalsBiDashboard`) daje to chip „+42.9%" ze strzałką W DÓŁ: liczba mówi
    // „wzrosło", strzałka mówi „spadło". Kanał oceny już istnieje i działa - to
    // KOLOR (zielony/czerwony, sprawdzony w dwóch testach wyżej) - więc strzałka
    // powinna iść za znakiem delty, a nie dublować ocenę wbrew liczbie.
    kafelek({ current: 6.0, previous: 4.2, higherIsBetter: false });

    const c = chip() as HTMLElement;
    expect(c.textContent).toContain("+42.9%");
    expect(klasaIkony()).toContain("up-right");
  });
});

describe("KpiTile - delta bezwzględna i format liczby", () => {
  it("tryb bezwzględny oddaje RÓŻNICĘ z przyrostkiem, nie procent", () => {
    kafelek({ current: 42.5, previous: 40, absoluteDelta: true, deltaSuffix: "pp" });

    const c = chip() as HTMLElement;
    expect(within(c).getByText("+2,5pp")).toBeTruthy();
    expect(c.textContent).not.toContain("%");
  });

  it("ujemna różnica bezwzględna nie dostaje podwójnego znaku", () => {
    kafelek({ current: 40, previous: 42.5, absoluteDelta: true, deltaSuffix: "pp" });

    expect(within(chip() as HTMLElement).getByText("-2,5pp")).toBeTruthy();
  });

  it("bez przyrostka chip niesie samą liczbę", () => {
    kafelek({ current: 12, previous: 5, absoluteDelta: true });

    expect(within(chip() as HTMLElement).getByText("+7")).toBeTruthy();
  });

  it("duża liczba dostaje separator tysięcy jako SPACJĘ NIEROZDZIELAJĄCĄ", () => {
    // Zwykła spacja łamałaby liczbę na końcu wiersza; `pl-PL` daje U+00A0.
    kafelek({ current: 1_250_000, previous: 15_433, absoluteDelta: true });

    const tekst = (chip() as HTMLElement).textContent ?? "";
    expect(tekst).toBe(`+1${NBSP}234${NBSP}567`);
  });

  it("cztery cyfry NIE dostają separatora - taka jest reguła pl-PL", () => {
    // `minimumGroupingDigits` w polskim to 2, więc 1000 zostaje zwarte.
    // Asercja pilnuje, żeby nikt nie „poprawił" tego ręcznym grupowaniem.
    kafelek({ current: 1000, previous: 0, absoluteDelta: true });

    expect((chip() as HTMLElement).textContent).toBe("+1000");
  });

  it("ułamek jest przycięty do DWÓCH miejsc, z przecinkiem dziesiętnym", () => {
    kafelek({ current: 12_345.6789, previous: 0, absoluteDelta: true });

    expect((chip() as HTMLElement).textContent).toBe(`+12${NBSP}345,68`);
  });

  it("zerowa różnica bezwzględna jest bez znaku i neutralna", () => {
    kafelek({ current: 7, previous: 7, absoluteDelta: true, deltaSuffix: "pp" });

    const c = chip() as HTMLElement;
    expect(within(c).getByText("0pp")).toBeTruthy();
    expect(c.className).toContain("text-muted-foreground");
  });

  it("tryb bezwzględny dzieli przez zero BEZ nieskończoności", () => {
    // To jest cały powód istnienia `absoluteDelta`: dla liczników startujących
    // od zera procent nie ma sensu, a różnica ma.
    kafelek({ current: 9, previous: 0, absoluteDelta: true });

    const tekst = (chip() as HTMLElement).textContent ?? "";
    expect(tekst).toBe("+9");
    expect(tekst).not.toContain("∞");
  });
});

describe("KpiTile - mikrowykres", () => {
  it("bez serii mikrowykresu NIE MA", () => {
    kafelek();

    expect(screen.queryByTestId("spark")).toBeNull();
    expect(h.wykresy).toHaveLength(0);
  });

  it("JEDEN punkt to nie trend - wykres się nie rysuje", () => {
    kafelek({ series: [42] });

    expect(screen.queryByTestId("spark")).toBeNull();
  });

  it("pusta seria też nie rysuje wykresu", () => {
    kafelek({ series: [] });

    expect(screen.queryByTestId("spark")).toBeNull();
  });

  it("dwa punkty wystarczą, a dane jadą do serii NIETKNIĘTE", () => {
    const seria = [10, 14];
    kafelek({ series: seria });

    expect(screen.getByTestId("spark")).toBeTruthy();
    const opcja = h.wykresy[0] as {
      series: Array<{ data: number[]; type: string; symbol: string }>;
      xAxis: { data: number[]; show: boolean };
      yAxis: { show: boolean };
    };
    expect(opcja.series[0].data).toEqual(seria);
    expect(opcja.series[0].type).toBe("line");
    // Mikrowykres nie ma osi ani punktów - to pasek trendu, nie wykres do czytania.
    expect(opcja.series[0].symbol).toBe("none");
    expect(opcja.xAxis.show).toBe(false);
    expect(opcja.yAxis.show).toBe(false);
  });

  it("oś kategorii ma tyle pozycji, ile punktów serii", () => {
    kafelek({ series: [1, 2, 3, 4, 5] });

    const opcja = h.wykresy[0] as { xAxis: { data: number[] } };
    expect(opcja.xAxis.data).toEqual([0, 1, 2, 3, 4]);
  });

  it("mikrowykres jest niski - 40 px, żeby nie rozpychał siatki kafelków", () => {
    kafelek({ series: [1, 2] });

    expect(screen.getByTestId("spark").getAttribute("data-height")).toBe("40");
  });
});

describe("KpiTile - izolacja warsztatów i dostępność", () => {
  it("dwa kafelki obok siebie nie mieszają serii ani delt", () => {
    // Siatka KPI stoi na jednej stronie dla kilku warsztatów; `useMemo` po
    // `series` musi być per instancja, inaczej mikrowykres warsztatu B
    // pokazałby trend warsztatu A.
    render(
      <>
        <div data-testid="a">
          <KpiTile label="Sesje" value="111" current={111} previous={100} series={[1, 2, 3]} />
        </div>
        <div data-testid="b">
          <KpiTile label="Sesje" value="999" current={90} previous={100} series={[9, 8, 7]} />
        </div>
      </>,
    );

    const a = within(screen.getByTestId("a"));
    const b = within(screen.getByTestId("b"));
    expect(a.getByText("111")).toBeTruthy();
    expect(a.getByText("+11.0%")).toBeTruthy();
    expect(b.getByText("999")).toBeTruthy();
    expect(b.getByText("-10.0%")).toBeTruthy();

    const [opcjaA, opcjaB] = h.wykresy as Array<{ series: Array<{ data: number[] }> }>;
    expect(opcjaA.series[0].data).toEqual([1, 2, 3]);
    expect(opcjaB.series[0].data).toEqual([9, 8, 7]);
  });

  it("kierunek zmiany NIE jest przekazany samym kolorem - jest też znak liczby", () => {
    // WCAG 1.4.1: kolor nie może być jedynym nośnikiem informacji. Znak przy
    // liczbie działa też dla osoby, która nie rozróżnia czerwieni i zieleni.
    const { unmount } = kafelek({ current: 120, previous: 100 });
    expect((chip() as HTMLElement).textContent?.startsWith("+")).toBe(true);
    unmount();

    kafelek({ current: 80, previous: 100 });
    expect((chip() as HTMLElement).textContent?.startsWith("-")).toBe(true);
  });

  // DEFEKT PRZYPIĘTY - ETYKIETA I WARTOŚĆ NIE SĄ POWIĄZANE PROGRAMOWO.
  //
  // `KpiTile` renderuje parę jako dwa sąsiednie `<div>`-y w `<div class="min-w-0">`:
  // etykieta jest `<span>`-em, wartość osobnym `<div>`-em. Nie ma ani
  // `<dl>/<dt>/<dd>`, ani `aria-labelledby`, ani wspólnej dostępnej nazwy.
  // Czytnik ekranu ogłasza więc DWA NIEPOWIĄZANE węzły tekstowe - „Sesje" i
  // „1 240" - i nic w drzewie dostępności nie mówi, że druga liczba jest
  // wartością pierwszej etykiety. Na pulpicie z sześcioma kafelkami obok siebie
  // daje to dwanaście luźnych napisów w kolejności wizualnej, a nie sześć par.
  // Cała treść informacyjna kafelka to WŁAŚNIE to powiązanie.
  //
  // DLACZEGO `axe` TEGO NIE ŁAPIE (przypadek wyżej jest zielony i słusznie):
  // axe-core nie ma reguły wymagającej semantyki listy definicji dla dowolnej
  // pary `<div>`-ów - nie da się odróżnić „etykieta i wartość" od dwóch
  // niezależnych akapitów bez znajomości intencji. Zieleń axe i ten defekt nie
  // są sprzeczne: to granica tego, co bramka strukturalna może zmierzyć.
  //
  // SKUTEK UBOCZNY, WIDOCZNY W CAŁYM MODULE: skoro powiązania nie ma, testy
  // pulpitów muszą trafiać w wartość po KLASIE UKŁADU. Pomocnik `kpiValue()`
  // w pięciu plikach (`gscBiDashboard`, `ga4BiDashboard`, `vitalsBiDashboard`,
  // `clientErrorsDashboard`, `relatedPostsAnalytics`) ma postać
  // `getByText(label).closest("div.min-w-0")` + indeks dziecka. Kilkadziesiąt
  // asercji KPI wisi więc na klasie prezentacyjnej, bo nie ma czego zapytać
  // semantycznie. Naprawa po stronie produkcji zamyka defekt dostępności
  // i kruchość tych asercji JEDNĄ zmianą.
  //
  // NIE NAPRAWIAM TEGO TUTAJ: `KpiTile` jest współdzielony przez pięć pulpitów,
  // a zmiana znaczników pociąga przepisanie tych pomocników - poza zakresem
  // zlecenia N1-N8.
  //
  // Kontrakt złamany: wartość wskaźnika jest programowo powiązana ze swoją
  // etykietą (WCAG 1.3.1 - informacja i relacje).
  it.fails("etykieta i wartość są parą w drzewie dostępności, nie dwoma napisami", () => {
    kafelek({ label: "Sesje", value: "1 240" });

    // Naturalną postacią tej pary jest lista definicji: `<dt>` ma rolę `term`,
    // `<dd>` rolę `definition`. Asercja jest spełnialna także przez
    // `aria-labelledby` - wtedy wartość miałaby dostępną nazwę „Sesje" - więc
    // nie narzuca JEDNEJ implementacji, tylko wymaga JAKIEJKOLWIEK relacji.
    const term = screen.queryAllByRole("term");
    const definition = screen.queryAllByRole("definition");
    const nazwana = screen.queryByLabelText("Sesje");
    expect((term.length === 1 && definition.length === 1) || nazwana !== null).toBe(true);
  });

  it("kafelek z pełnym wyposażeniem nie wnosi naruszeń axe", async () => {
    const { container } = kafelek({
      icon: <span aria-hidden>◆</span>,
      current: 120,
      previous: 100,
      series: [1, 2, 3, 4],
    });

    const naruszenia = await axeViolations(container);
    expect(summarize(naruszenia)).toBe("");
  });
});
