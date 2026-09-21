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
// ISKRA JEST TU PROSTYM `<svg>`, A NIE WYKRESEM W BIBLIOTECE. Kafelek rysuje
// jedną ścieżkę geometrią z silnika (`pathFromPoints`) i kolorem z palety,
// więc nie ma czego podmieniać atrapą - asercje idą na atrybut `d`, czyli na
// to, co czytelnik naprawdę widzi. Poprzednia wersja pytała atrapę o `option`
// ECharts, czyli o kształt danych oddanych bibliotece, a nie o rysunek.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";
import { KpiTile, type KpiTileProps } from "../KpiTile";

/** Spacja nierozdzielająca - separator tysięcy w `pl-PL`. */
const NBSP = " ";

function kafelek(props: Partial<KpiTileProps> = {}) {
  return render(<KpiTile label="Sesje" value="1 240" {...props} />);
}

/** Iskra kafelka - jedyny `<svg>` oznaczony rolą mikrowykresu. */
function iskra(): SVGSVGElement {
  const el = document.querySelector<SVGSVGElement>('svg[data-role="sparkline"]');
  if (!el) throw new Error("test: kafelek nie narysował iskry");
  return el;
}

/** Atrybut `d` ścieżki iskry. */
function sciezka(): string {
  return iskra().querySelector("path")?.getAttribute("d") ?? "";
}

/**
 * Liczba wierzchołków ścieżki: `M` plus każde `L` albo `C`. Przy dwóch
 * punktach silnik rysuje łamaną, przy dłuższym szeregu - krzywe, więc obie
 * komendy liczą się tak samo: każda kończy się w kolejnym pomiarze.
 */
function wierzcholki(d: string): number {
  return (d.match(/[MLC]/g) ?? []).length;
}

/** Chip delty - jedyny element kafelka z ikoną kierunku i tekstem zmiany. */
function chip(): HTMLElement | null {
  return document.querySelector("[class*='rounded-md'][class*='bg-muted/60']");
}

function klasaIkony(): string {
  return chip()?.querySelector("svg")?.getAttribute("class") ?? "";
}

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

  it("strzałka idzie za ZNAKIEM liczby, nie za oceną, przy „mniej znaczy lepiej”", () => {
    // ROZDZIELENIE KANAŁÓW: strzałka koduje KIERUNEK (znak delty), kolor koduje
    // OCENĘ. Gdy ikona liczyła się z oceny
    // (`neutral ? Minus : good ? ArrowUpRight : ArrowDownRight`), przy
    // `higherIsBetter: false` (wszystkie metryki Web Vitals w
    // `VitalsBiDashboard`) chip pokazywał „+42.9%" ze strzałką W DÓŁ - liczba
    // mówiła „wzrosło", strzałka stojąca bezpośrednio przy niej „spadło".
    // Kanał oceny istnieje osobno i jest sprawdzony w dwóch przypadkach wyżej
    // (zielony dla spadku, czerwony dla wzrostu), więc dublowanie go strzałką
    // wbrew znakowi nic nie dodawało, a odbierało wiarygodność obu.
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

    expect(document.querySelector('svg[data-role="sparkline"]')).toBeNull();
  });

  it("JEDEN punkt to nie trend - wykres się nie rysuje", () => {
    kafelek({ series: [42] });

    expect(document.querySelector('svg[data-role="sparkline"]')).toBeNull();
  });

  it("pusta seria też nie rysuje wykresu", () => {
    kafelek({ series: [] });

    expect(document.querySelector('svg[data-role="sparkline"]')).toBeNull();
  });

  it("dwa punkty wystarczą, a iskra jest SAMĄ ścieżką - bez osi i bez punktów", () => {
    kafelek({ series: [10, 14] });

    const svg = iskra();
    // Pasek trendu, nie wykres do czytania: jeden `<path>` i nic poza nim.
    // Oś, podziałka albo znaczniki punktów w czterdziestu pikselach wysokości
    // byłyby nieczytelne, a liczba stoi obok, w kafelku.
    expect(svg.querySelectorAll("path")).toHaveLength(1);
    expect(svg.querySelectorAll("line, text, circle")).toHaveLength(0);
    // `aria-hidden`, bo iskra nie niesie ani jednej liczby, której nie ma już
    // w kafelku - ogłoszona przez czytnik byłaby drugim głosem o tym samym.
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("ścieżka ma tyle wierzchołków, ile punktów serii", () => {
    kafelek({ series: [1, 2, 3, 4, 5] });

    // Zgubiony wierzchołek to zgubiony pomiar: iskra pokazywałaby krótszy
    // szereg niż ten, którym ją nakarmiono, i nikt by tego nie zauważył.
    expect(wierzcholki(sciezka())).toBe(5);
  });

  it("iskra jest niska - 40 px, żeby nie rozpychała siatki kafelków", () => {
    kafelek({ series: [1, 2] });

    expect(iskra().getAttribute("height")).toBe("40");
    // Układ współrzędnych jest STAŁY, a szerokość bierze się z kontenera:
    // inaczej kafelki o różnej szerokości rysowałyby ten sam szereg pod inną
    // stromizną, czyli sugerowałyby różną dynamikę.
    expect(iskra().getAttribute("viewBox")).toBe("0 0 100 40");
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

    // Szereg rosnący i malejący nie mogą dać tej samej ścieżki - równość
    // znaczyłaby, że `useMemo` po `series` przecieka między instancjami.
    const dSciezki = (el: HTMLElement): string =>
      el.querySelector('svg[data-role="sparkline"] path')?.getAttribute("d") ?? "";
    const dA = dSciezki(screen.getByTestId("a"));
    const dB = dSciezki(screen.getByTestId("b"));
    expect(dA).not.toBe("");
    expect(dA).not.toBe(dB);
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

  // ETYKIETA I WARTOŚĆ SĄ POWIĄZANE PROGRAMOWO - to cała treść informacyjna
  // kafelka.
  //
  // `KpiTile` renderuje parę jako dwa sąsiednie `<div>`-y w `<div class="min-w-0">`:
  // etykieta jest `<span>`-em, wartość osobnym `<div>`-em. Gdy oba były zwykłymi
  // `<div>`-ami bez roli, czytnik ekranu ogłaszał DWA NIEPOWIĄZANE węzły
  // tekstowe - „Sesje" i „1 240" - i nic w drzewie dostępności nie mówiło, że
  // druga liczba jest wartością pierwszej etykiety. Na pulpicie z sześcioma
  // kafelkami obok siebie dawało to dwanaście luźnych napisów w kolejności
  // wizualnej, a nie sześć par. Powiązanie niesie dziś para ról
  // `term`/`definition` na tych samych `<div>`-ach.
  //
  // DLACZEGO `axe` TEGO NIE PILNUJE ZA NAS (przypadek niżej jest zielony
  // i słusznie): axe-core nie ma reguły wymagającej semantyki listy definicji
  // dla dowolnej pary `<div>`-ów - nie da się odróżnić „etykieta i wartość" od
  // dwóch niezależnych akapitów bez znajomości intencji. Zieleń axe i ten
  // przypadek nie są sprzeczne: to granica tego, co bramka strukturalna może
  // zmierzyć, i dlatego kontrakt musi mieć własny test.
  //
  // ROLE DOŁOŻONO OBOK ZNACZNIKÓW, NIE ZAMIAST NICH. `<dl>/<dt>/<dd>` wymagałoby
  // przebudowy drzewa, a pomocnik `kpiValue()` w pięciu plikach
  // (`gscBiDashboard`, `ga4BiDashboard`, `vitalsBiDashboard`,
  // `clientErrorsDashboard`, `relatedPostsAnalytics`) ma postać
  // `getByText(label).closest("div.min-w-0")` + ostatnie dziecko. Kilkadziesiąt
  // asercji KPI wisi na tej klasie i na kolejności dzieci, więc `min-w-0`
  // i układ zostały nietknięte - zmiana jest czysto semantyczna.
  //
  // Kontrakt pilnowany: wartość wskaźnika jest programowo powiązana ze swoją
  // etykietą (WCAG 1.3.1 - informacja i relacje).
  it("etykieta i wartość są parą w drzewie dostępności, nie dwoma napisami", () => {
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

describe("incomplete sparkline observations", () => {
  it("omits a trend when fewer than two finite observations remain", () => {
    const { container } = kafelek({ series: [NaN, 2, Infinity] });
    expect(container.querySelector('svg[data-role="sparkline"]')).toBeNull();
  });
  it("keeps mixed finite and missing observations from emitting invalid SVG", () => {
    kafelek({ series: [1, NaN, 3] });
    expect(sciezka()).not.toMatch(/NaN|Infinity/);
  });
});
