// WACHLARZ SCENARIUSZY - CO MUSI BYĆ PRAWDĄ O RYSUNKU.
//
// KONFIGURACJA BEZ KLUCZA `kind`, i to jest świadome: model czyta `categories`
// i `series` (a przy granicy prognozy `forecastFrom` i `forecastBandPct`),
// nigdy `config.kind` - `grep -n "config.kind" src/lib/charts/kinds/fanChart.ts`
// nie zwraca ani jednej linii - więc rodzaj wpisany w konfigurację nie zmieniłby
// tu niczego poza tym, że sugerowałby, że coś zmienia; podłączenia rodzaju do
// rozdzielnika pilnuje osobna bramka `everyKindRenders.test.tsx`.
//
// SKĄD BIORĘ LICZBY. `useContainerWidth` czyta `clientWidth`, które w happy-dom
// wynosi 0, więc szerokość zostaje na wartości startowej 720 - geometria jest
// deterministyczna i można asertować współrzędne. `useRevealOnScroll` nigdy nie
// dostaje callbacku IntersectionObservera, więc stan to zawsze "static".
//
// CZEGO TU NIE MA. Arytmetyka wachlarza (pary krawędzi, zagnieżdżenie, kolejność
// warstw, pierścienie, orzeczenia uczciwości) ma własny plik testowy przy
// modelu. Tutaj sprawdzam wyłącznie to, czego model sprawdzić nie może: czy
// RYSUNEK mówi to, co model policzył.
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import type { ChartConfig } from "@/lib/charts/types";
import { FanChart } from "../FanChart";

function cfg(data: Record<string, Json>): ChartConfig {
  return parseChartConfig(data);
}

const all = (root: HTMLElement, sel: string): Element[] => [...root.querySelectorAll(sel)];
const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));
const nota = (root: HTMLElement, klucz: string): Element | null =>
  root.querySelector(`[data-note='${klucz}']`);
const klucze = (root: HTMLElement): string[] =>
  all(root, "[data-note]").map((el) => el.getAttribute("data-note") ?? "");

const N = null;
const OKRESY = ["2021", "2022", "2023", "2024", "2025", "2026", "2027", "2028"];
const CENTRUM = { name: "PKB", values: [100, 104, 107, 111, 115, 119, 123, 128] };

/**
 * Trzy zagnieżdżone pasma rozchodzące się z horyzontem, zaczynające się
 * DOPIERO w pierwszym kroku prognozy - taki wachlarz nie ma ANI JEDNEJ uwagi
 * i jest tu punktem odniesienia dla wszystkich sprawdzeń, które mają milczeć.
 */
const BAZA: Record<string, Json> = {
  categories: OKRESY,
  series: [
    CENTRUM,
    { name: "50% dolna", values: [N, N, N, N, N, 117, 119, 122] },
    { name: "50% górna", values: [N, N, N, N, N, 121, 127, 134] },
    { name: "80% dolna", values: [N, N, N, N, N, 115, 115, 116] },
    { name: "80% górna", values: [N, N, N, N, N, 123, 131, 140] },
    { name: "95% dolna", values: [N, N, N, N, N, 113, 111, 110] },
    { name: "95% górna", values: [N, N, N, N, N, 125, 135, 146] },
  ],
  forecastFrom: 5,
  unit: " mld EUR",
  title: "Wzrost PKB",
  animate: false,
};

/**
 * Ten sam wachlarz PRZYPIĘTY do ostatniej obserwacji: krawędzie w kroku "2025"
 * są równe wartości pomiaru, żeby wielokąt pasma wychodził z danych, a nie
 * zaczynał się w powietrzu pół kroku dalej.
 */
const Z_KOTWICA: Record<string, Json> = {
  ...BAZA,
  series: [
    CENTRUM,
    { name: "50% dolna", values: [N, N, N, N, 115, 117, 119, 122] },
    { name: "50% górna", values: [N, N, N, N, 115, 121, 127, 134] },
    { name: "80% dolna", values: [N, N, N, N, 115, 115, 115, 116] },
    { name: "80% górna", values: [N, N, N, N, 115, 123, 131, 140] },
    { name: "95% dolna", values: [N, N, N, N, 115, 113, 111, 110] },
    { name: "95% górna", values: [N, N, N, N, 115, 125, 135, 146] },
  ],
};

/** Wachlarz z jednego `forecastBandPct` - jeden poziom o NIEZNANEJ pewności. */
const Z_PROCENTU: Record<string, Json> = {
  categories: OKRESY,
  series: [CENTRUM],
  forecastFrom: 5,
  forecastBandPct: 8,
  animate: false,
};

/** Punkt z atrybutu `d` - wystarczy do odczytania geometrii bez migawek HTML. */
function punkty(d: string): Array<{ x: number; y: number }> {
  return [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
}

/** Pionowy zakres powierzchni w podanej kolumnie X (z tolerancją pół piksela). */
function zakresY(d: string, x: number): { min: number; max: number } | null {
  const w = punkty(d).filter((p) => Math.abs(p.x - x) < 0.5);
  if (w.length === 0) return null;
  return { min: Math.min(...w.map((p) => p.y)), max: Math.max(...w.map((p) => p.y)) };
}

/** Liczba z etykiety podziałki, w obu językach. */
function zPodzialki(text: string): number {
  // `\s` obejmuje w ECMAScripcie także twardą spację (U+00A0), którą pl-PL
  // grupuje tysiące - dlatego jedna klasa wystarcza na oba języki.
  return Number(text.replace(/\s/g, "").replace(",", "."));
}

/** Mnożnik tokena krycia wyciągnięty z `calc(var(--chart-band-N) * M)`. */
function mnoznik(el: Element): number {
  const m = /\*\s*([0-9.]+)\)/.exec(el.getAttribute("style") ?? "");
  return m ? Number(m[1]) : Number.NaN;
}

/* -------------------------------------------------------------------------- */
/*  GEOMETRIA                                                                 */
/* -------------------------------------------------------------------------- */

describe("FanChart - co koduje pozycja", () => {
  it("pozioma koduje KROK CZASU, pionowa WARTOŚĆ, a oś nie jest domykana do zera", () => {
    // Gdyby tego testu nie było, przeszłaby zamiana osi (kroki w pionie) oraz
    // domknięcie zera - a zero domknięte na szeregu poziomów rzędu stu
    // spłaszcza pasma do niewidoczności, czyli usuwa z wykresu jego treść.
    // Sekcja 8 nie wymaga zera dla rodzaju liniowego i to jest tu istotne.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const sciezka = container.querySelector("[data-role='central-path']");
    const p = punkty(sciezka?.getAttribute("d") ?? "");
    expect(p).toHaveLength(OKRESY.length);
    for (let i = 1; i < p.length; i += 1) expect(p[i].x).toBeGreaterThan(p[i - 1].x);
    // Wartości rosną (100 -> 128), więc współrzędna pionowa MALEJE.
    expect(p[p.length - 1].y).toBeLessThan(p[0].y);
    const podzialki = all(container, "svg text.tabular-nums").map((e) =>
      zPodzialki(e.textContent ?? ""),
    );
    expect(Math.min(...podzialki)).toBeGreaterThan(0);
  });

  it("skala osi obejmuje KRAWĘDZIE PASM, nie samą linię", () => {
    // To jest najważniejsza asercja o skali. Najwyższa wartość ścieżki to 128,
    // najwyższa krawędź pasma 95% to 146. Skala policzona z samej linii
    // skończyłaby się na 130 i pasmo zostałoby PRZYCIĘTE krawędzią rysunku -
    // a przycięte pasmo niepewności jest gorsze od braku pasma, bo sugeruje,
    // że niepewność kończy się tam, gdzie kończy się obszar kreślenia.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const podzialki = all(container, "svg text.tabular-nums").map((e) =>
      zPodzialki(e.textContent ?? ""),
    );
    expect(Math.max(...podzialki)).toBeGreaterThanOrEqual(146);
  });

  it("pasma są rysowane OD NAJSZERSZEGO DO NAJWĘŻSZEGO", () => {
    // Odwrotna kolejność chowa pasmo 50% pod pasmem 95% - znika wtedy poziom
    // o najwyższej wartości informacyjnej, a rysunek pokazuje jeden przedział
    // zamiast kształtu niepewności.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const warstwy = all(container, "[data-role='band']").map((e) => num(e, "data-layer"));
    expect(warstwy.length).toBeGreaterThan(2);
    for (let i = 1; i < warstwy.length; i += 1) {
      expect(warstwy[i]).toBeGreaterThanOrEqual(warstwy[i - 1]);
    }
    expect(Math.max(...warstwy)).toBe(2);
  });

  it("pasmo węższe leży W CAŁOŚCI wewnątrz szerszego", () => {
    // Zagnieżdżenie jest orzeczeniem modelu, ale na rysunek trafia przez
    // arytmetykę pikseli - pomyłka w mapowaniu krawędzi (na przykład dolnej na
    // `upper`) dałaby rysunek, na którym pasma się przecinają, choć model
    // twierdzi, że są zagnieżdżone.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const pasma = all(container, "[data-role='band']");
    const x = punkty(
      container.querySelector("[data-role='central-path']")?.getAttribute("d") ?? "",
    )[OKRESY.length - 1].x;
    const zakresy = pasma.map((el) => ({
      layer: num(el, "data-layer"),
      z: zakresY(el.getAttribute("d") ?? "", x),
    }));
    const najszersze = zakresy.filter((w) => w.layer === 0 && w.z !== null);
    const rdzen = zakresy.find((w) => w.layer === 2 && w.z !== null);
    expect(najszersze.length).toBeGreaterThan(0);
    expect(rdzen?.z).not.toBeUndefined();
    const gora = Math.min(...najszersze.map((w) => w.z!.min));
    const dol = Math.max(...najszersze.map((w) => w.z!.max));
    expect(rdzen!.z!.min).toBeGreaterThan(gora);
    expect(rdzen!.z!.max).toBeLessThan(dol);
  });

  it("krycie ROŚNIE z warstwą, więc węższe pasmo nie znika w szerszym", () => {
    // Jedna alfa na wszystkie warstwy daje jedną płaską plamę: czytelnik widzi
    // zewnętrzną krawędź i nic więcej. Rosnące krycie jest jedynym nośnikiem
    // granicy między poziomami pewności.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const poWarstwie = new Map<number, number>();
    for (const el of all(container, "[data-role='band']")) {
      poWarstwie.set(num(el, "data-layer"), mnoznik(el));
    }
    const kolejno = [...poWarstwie.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => m);
    expect(kolejno).toHaveLength(3);
    for (const m of kolejno) expect(Number.isFinite(m)).toBe(true);
    for (let i = 1; i < kolejno.length; i += 1) expect(kolejno[i]).toBeGreaterThan(kolejno[i - 1]);
    // Krycie idzie TOKENEM slotu, a nie liczbą wpisaną w kod - inaczej motyw
    // ciemny dostałby alfę policzoną dla jasnego.
    expect(all(container, "[data-role='band']")[0].getAttribute("style")).toContain(
      "var(--chart-band-1)",
    );
  });

  it("pasmo NIGDY nie jest gradientem", () => {
    // Zakaz wprost ze specyfikacji: gradient oznacza obszar danych, płaskie
    // wypełnienie oznacza niepewność. Gradient w paśmie kazałby czytelnikowi
    // odróżniać wielkość od nieznanego tym samym nośnikiem.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    expect(container.querySelector("linearGradient")).toBeNull();
    expect(container.querySelector("radialGradient")).toBeNull();
    for (const el of all(container, "[data-role='band']")) {
      expect(el.getAttribute("fill")).toBe("var(--chart-1)");
    }
  });

  it("ścieżka centralna idzie WIERZCHEM pasm", () => {
    // Schowana pod pasmem 50% traci kontrast dokładnie tam, gdzie wachlarz jest
    // najgęstszy - czyli w kroku, w którym czytelnik najbardziej chce ją
    // odczytać.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const role = all(container, "svg [data-role]").map((e) => e.getAttribute("data-role"));
    expect(role.indexOf("central-path")).toBeGreaterThan(role.lastIndexOf("band"));
  });

  it("ścieżka centralna jest CIĄGŁA przez granicę prognozy", () => {
    // Kreskowany ogon prognozy byłby czwartym nośnikiem odróżnienia i zaczyna
    // wyglądać na artefakt renderu; model orzeka o ciągłości osobno
    // (`centralContinuousInForecast`), a przerywa ją WYŁĄCZNIE luka w danych.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const sciezki = all(container, "[data-role='central-path']");
    expect(sciezki).toHaveLength(1);
    expect(sciezki[0].getAttribute("stroke-dasharray")).toBeNull();
    expect(punkty(sciezki[0].getAttribute("d") ?? "")).toHaveLength(OKRESY.length);
  });

  it("LUKA w danych przerywa ścieżkę - i to jest co innego niż styl linii", () => {
    const zLuka = {
      ...BAZA,
      series: [{ name: "PKB", values: [100, 104, 107, 111, 115, 119, N, 128] }, ...[]],
    };
    const { container } = render(<FanChart config={cfg(zLuka)} lang="pl" />);
    expect(all(container, "[data-role='central-path']")).toHaveLength(2);
  });
});

describe("FanChart - granica prognozy", () => {
  it("separator stoi MIĘDZY ostatnią obserwacją a pierwszą prognozą", () => {
    // Separator postawiony na kategorii dzieli jej kolumnę i czytelnik nie wie,
    // po której stronie granicy ona jest. Bez tego testu przeszłoby
    // przesunięcie o pół kroku, którego na oko nie widać.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const p = punkty(
      container.querySelector("[data-role='central-path']")?.getAttribute("d") ?? "",
    );
    const linia = container.querySelector("[data-role='forecast-boundary'] line");
    expect(linia).not.toBeNull();
    expect(num(linia!, "x1")).toBeCloseTo((p[4].x + p[5].x) / 2, 5);
    expect(num(linia!, "x1")).toBe(num(linia!, "x2"));
  });

  it("granica jest NAZWANA, nie tylko narysowana", () => {
    // Sama linia nie mówi "prognoza": kreska pionowa na wykresie może znaczyć
    // cokolwiek. Etykieta słowna jest tu nośnikiem, który przeżywa druk.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    expect(container.querySelector("[data-role='forecast-boundary'] text")?.textContent).toBe(
      "Prognoza",
    );
  });

  it("strefa prognozy ma KRESKOWANIE tym samym mechanizmem co wykres kartezjański", () => {
    // Płaski tint 2,2% znika w skali szarości i na papierze - prognoza traci
    // wtedy jeden z trzech nośników odróżnienia. Kreskowanie jest tu WYPEŁNIENIEM
    // POWIERZCHNI, nie linią rusztowania, i dlatego jest jedyną dozwoloną
    // nieciągłością w całym silniku. Własny mechanizm (na przykład maska albo
    // drugi prostokąt w innym tokenie) rozjechałby się z regułą druku
    // w `styles.css`, która przełącza oba prostokąty po KLASACH.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const tint = container.querySelector("rect.neh-zone-tint");
    const hatch = container.querySelector("rect.neh-zone-hatch");
    expect(tint).not.toBeNull();
    expect(hatch).not.toBeNull();
    expect(tint?.getAttribute("style")).toContain("fill-opacity: var(--chart-zone-alpha)");
    const wzor = /url\(#(.+)\)/.exec(hatch?.getAttribute("fill") ?? "");
    expect(wzor).not.toBeNull();
    const pattern = container.querySelector(`#${wzor![1]}`);
    expect(pattern?.getAttribute("patternTransform")).toBe("rotate(45)");
    // Strefa zaczyna się na separatorze, a nie na kategorii prognozowanej.
    const linia = container.querySelector("[data-role='forecast-boundary'] line");
    expect(num(tint!, "x")).toBeCloseTo(num(linia!, "x1"), 5);
  });

  it("bez granicy nie ma ani strefy, ani separatora", () => {
    // Strefa narysowana bez granicy twierdziłaby, że cały szereg jest prognozą.
    const { container } = render(<FanChart config={cfg({ ...BAZA, forecastFrom: N })} lang="pl" />);
    expect(container.querySelector("rect.neh-zone-tint")).toBeNull();
    expect(container.querySelector("[data-role='forecast-boundary']")).toBeNull();
  });

  it("punkty obserwacji stoją TYLKO na historii", () => {
    // Punkt jest znacznikiem POMIARU, a w prognozie nie ma pomiarów. Kropka nad
    // wartością prognozowaną podaje interpolację za dane - i jest to nośnik
    // mocniejszy od kreskowania, bo działa w druku i w skali szarości.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const punkciki = all(container, "[data-role='observation']");
    expect(punkciki).toHaveLength(5);
    const granica = num(container.querySelector("[data-role='forecast-boundary'] line")!, "x1");
    for (const p of punkciki) expect(num(p, "cx")).toBeLessThan(granica);
  });
});

describe("FanChart - siatka nie udaje krawędzi pasma", () => {
  it("siatka jest WYCIĘTA spod wachlarza", () => {
    // Siatka ma do płyty około 1,18:1, a sąsiednie poziomy pasma dzieli około
    // 0,02 kontrastu - linia siatki prześwitująca przez pasmo jest więc
    // WYRAŹNIEJSZA od granicy poziomów i czyta się jako krawędź pasma.
    // Bez tego testu wystarczyłoby przestawić siatkę nad pasma albo zgubić
    // przycięcie, żeby wachlarz dostał tyle fałszywych krawędzi, ile ma
    // podziałek - i nikt by tego nie nazwał błędem, bo rysunek wygląda gęściej.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const grupa = container.querySelector("svg g[clip-path]");
    expect(grupa).not.toBeNull();
    expect(grupa!.querySelectorAll("line[stroke='var(--chart-grid)']").length).toBeGreaterThan(1);
    const id = /url\(#(.+)\)/.exec(grupa!.getAttribute("clip-path") ?? "")![1];
    const wycinanka = container.querySelector(`#${id} path`);
    expect(wycinanka?.getAttribute("clip-rule")).toBe("evenodd");
    // Prostokąt pola rysunku PLUS co najmniej jeden wielokąt pasma - jedno "M"
    // znaczyłoby, że z siatki nic nie wycięto.
    expect((wycinanka?.getAttribute("d") ?? "").split("M").length - 1).toBeGreaterThan(1);
  });

  it("bez pasm siatka NIE jest przycinana", () => {
    // Przycinanie bez powodu zostawiałoby w drzewie pustą definicję, a w
    // recenzji wyglądałoby na mechanizm, który działa - podczas gdy wycinanka
    // z samego prostokąta pola usunęłaby CAŁĄ siatkę.
    const { container } = render(
      <FanChart config={cfg({ ...Z_PROCENTU, forecastBandPct: 0 })} lang="pl" />,
    );
    expect(container.querySelector("svg g[clip-path]")).toBeNull();
    expect(all(container, "line[stroke='var(--chart-grid)']").length).toBeGreaterThan(1);
  });
});

/* -------------------------------------------------------------------------- */
/*  DOSTĘPNOŚĆ I KLAWIATURA                                                   */
/* -------------------------------------------------------------------------- */

describe("FanChart - dostępność", () => {
  it("rysunek ma rolę, fokus i nazwę zbudowaną z TYTUŁU", () => {
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    expect(box).not.toBeNull();
    expect(box?.getAttribute("tabindex")).toBe("0");
    expect(box?.getAttribute("aria-label")).toContain("Wzrost PKB");
  });

  it("wykres bez tytułu dostaje nazwę zastępczą, nie pustą", () => {
    // Pusta nazwa dostępna znaczy przystanek tabulacji, który nic nie mówi.
    const { container } = render(<FanChart config={cfg({ ...BAZA, title: "" })} lang="pl" />);
    expect(container.querySelector("[role='img']")?.getAttribute("aria-label")).toContain("Wykres");
  });

  it("nazwa niesie POZIOMY PEWNOŚCI i początek prognozy", () => {
    // Czytelnik ekranu nie zobaczy ani wachlarza, ani separatora. Bez poziomów
    // i bez granicy dostaje wykres, o którym wie tylko, że istnieje.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const nazwa = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(nazwa).toContain("Pasmo 95%");
    expect(nazwa).toContain("Pasmo 50%");
    expect(nazwa).toContain("Prognoza od: 2026");
    expect(nazwa).not.toContain("{{");
  });

  it("opis obsługi jest OPISEM i mówi też, skąd wzięły się krawędzie", () => {
    // Sama obsługa klawiszy nie wystarcza: czytelnik, który nie wie, że
    // strzałki coś robią, ich nie naciśnie. Pochodzenie pasm stoi tutaj, a nie
    // na liście uwag, bo jest prawdziwe na KAŻDYM wachlarzu - uwaga, którą
    // widać zawsze, uczy ignorowania wszystkich uwag.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    const id = box?.getAttribute("aria-describedby") ?? "";
    expect(id).not.toContain(" ");
    const opis = container.querySelector(`#${id}`)?.textContent ?? "";
    expect(opis).toContain("Strzałkami");
    expect(opis).toContain("par serii nazwanych dolną i górną");
  });

  it("pasmo z `forecastBandPct` MÓWI, że nie ma przy sobie procentu pewności", () => {
    // Pole deklaruje SZEROKOŚĆ, a nie pewność. Podpisanie takiego pasma
    // procentem pewności byłoby liczbą, której autor nie podał.
    const { container } = render(<FanChart config={cfg(Z_PROCENTU)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    const id = box?.getAttribute("aria-describedby") ?? "";
    expect(container.querySelector(`#${id}`)?.textContent).toContain("jedną szerokość pasma");
    expect(box?.getAttribute("aria-label")).toContain("Pasmo o nieznanej pewności");
  });

  it("w kolejności tabulacji stoi DOKŁADNIE JEDEN element", () => {
    // Wachlarz nie ma znaczników nazwanych osobno (inaczej niż tarcza), więc
    // każdy dodatkowy przystanek tabulacji byłby przystankiem bez treści.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    expect(all(container, "[tabindex='0']")).toHaveLength(1);
  });
});

describe("FanChart - klawiatura", () => {
  it("ArrowRight zmienia stan czynny, a Escape przywraca rysunek DOKŁADNIE", () => {
    // Tak pyta bramka `everyKindRenders`: porównuje migawki HTML sprzed
    // i po Escape. Stan czynny, który zostawia po sobie choćby jeden atrybut,
    // oblewa ją - i słusznie, bo czytelnik klawiatury nie ma innej drogi
    // zdjęcia dymka niż Escape.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    const przed = container.innerHTML;
    fireEvent.keyDown(box!, { key: "ArrowRight" });
    expect(container.innerHTML).not.toBe(przed);
    expect(container.querySelector(".neh-crosshair")).not.toBeNull();
    fireEvent.keyDown(box!, { key: "Escape" });
    expect(container.innerHTML).toBe(przed);
  });

  it("ArrowLeft z pustego stanu wskazuje OSTATNI krok, a strzałki nie wychodzą poza zakres", () => {
    // Bez przycięcia indeks rośnie w nieskończoność i dymek gaśnie bez powodu,
    // bo `kroki[9999]` jest `undefined`.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    fireEvent.keyDown(box!, { key: "ArrowLeft" });
    expect(container.querySelector(".neh-tooltip")?.textContent).toContain("2028");
    for (let i = 0; i < 20; i += 1) fireEvent.keyDown(box!, { key: "ArrowRight" });
    expect(container.querySelector(".neh-tooltip")?.textContent).toContain("2028");
  });

  it("klawisze nieobsługiwane nie wywracają rysunku", () => {
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    for (const key of ["Tab", "Enter", " ", "a", "F5", "PageDown", "Home"]) {
      expect(() => fireEvent.keyDown(box!, { key })).not.toThrow();
    }
    expect(container.textContent ?? "").not.toContain("NaN");
  });
});

/* -------------------------------------------------------------------------- */
/*  DYMEK I JĘZYK                                                             */
/* -------------------------------------------------------------------------- */

/** Duże liczby, żeby separator tysięcy odróżnił pl-PL od en-GB. */
const DUZE: Record<string, Json> = {
  categories: ["I", "II", "III", "IV"],
  series: [{ name: "Obrót", values: [12345.6, 20000, 30000, 40000] }],
  forecastFrom: 2,
  forecastBandPct: 10,
  animate: false,
};

describe("FanChart - dymek podaje KRAWĘDZIE, których z rysunku nie da się odczytać", () => {
  it("wiersz na każdy poziom pewności, plus wartość centralna", () => {
    // Pasmo ma 10-11% krycia i nie ma przy sobie podziałki, więc krawędź jest
    // jedyną liczbą tego wykresu, której czytelnik nie odczyta wzrokiem.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    for (let i = 0; i < 8; i += 1) fireEvent.keyDown(box!, { key: "ArrowRight" });
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).toContain("2028");
    expect(dymek).toContain("Ścieżka centralna");
    expect(dymek).toContain("Pasmo 95%");
    expect(dymek).toContain("Pasmo 80%");
    expect(dymek).toContain("Pasmo 50%");
    expect(dymek).toContain("110");
    expect(dymek).toContain("146");
  });

  it("dymek NAZYWA fazę kroku", () => {
    // Bez fazy dymek podaje prognozę i pomiar tą samą liczbą w tym samym
    // miejscu, a cała ostrożność rysunku kończy się w chwili najechania
    // kursorem.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    fireEvent.keyDown(box!, { key: "ArrowRight" });
    expect(container.querySelector(".neh-tooltip")?.textContent).toContain("Historia");
    for (let i = 0; i < 5; i += 1) fireEvent.keyDown(box!, { key: "ArrowRight" });
    expect(container.querySelector(".neh-tooltip")?.textContent).toContain("Prognoza");
  });

  it("krok bez wartości centralnej pokazuje KRESKĘ, nie liczbę zastępczą", () => {
    // Milczenie modelu (`central: null`) nie ma prawa dojechać do czytelnika
    // jako zero: zero jest twierdzeniem o danych, kreska jest ich brakiem.
    const zLuka = {
      ...BAZA,
      series: [{ name: "PKB", values: [100, N, 107, 111, 115, 119, 123, 128] }],
    };
    const { container } = render(<FanChart config={cfg(zLuka)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    fireEvent.keyDown(box!, { key: "ArrowRight" });
    fireEvent.keyDown(box!, { key: "ArrowRight" });
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).toContain("-");
    expect(dymek).not.toContain("NaN");
    expect(dymek).not.toContain("0 mld EUR");
  });
});

describe("FanChart - język jedzie PROPSEM", () => {
  it("ten sam zestaw daje odmienne POPRAWNE napisy w pl i en", () => {
    // Strony publiczne są cache'owane na brzegu sieci, więc odczyt z globalnego
    // `i18n.language` serwowałby polski tekst pod angielskim adresem. Test
    // renderuje TEN SAM config dwa razy i pyta o liczby, bo to one różnią się
    // najciszej: pl-PL grupuje tysiące TWARDĄ SPACJĄ (U+00A0), en-GB przecinkiem.
    const pl = render(<FanChart config={cfg(DUZE)} lang="pl" />);
    const boxPl = pl.container.querySelector<HTMLElement>("[role='img']");
    fireEvent.keyDown(boxPl!, { key: "ArrowRight" });
    const dymekPl = pl.container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymekPl).toContain("12 345,6");
    expect(dymekPl).toContain("Historia");
    expect(dymekPl).toContain("Pasmo o nieznanej pewności");

    const en = render(<FanChart config={cfg(DUZE)} lang="en" />);
    const boxEn = en.container.querySelector<HTMLElement>("[role='img']");
    fireEvent.keyDown(boxEn!, { key: "ArrowRight" });
    const dymekEn = en.container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymekEn).toContain("12,345.6");
    expect(dymekEn).toContain("History");
    expect(dymekEn).toContain("Band of unknown confidence");
    expect(dymekEn).not.toContain("12 345,6");
  });

  it("etykieta granicy i uwagi też idą za propsem", () => {
    const { container } = render(<FanChart config={cfg(Z_PROCENTU)} lang="en" />);
    expect(container.querySelector("[data-role='forecast-boundary'] text")?.textContent).toBe(
      "Forecast",
    );
    expect(nota(container, "reading.singleLevel")?.textContent).toContain("one confidence level");
  });
});

/* -------------------------------------------------------------------------- */
/*  UWAGI: OBSERWACJE O FORMIE I DEFEKTY DANYCH                               */
/* -------------------------------------------------------------------------- */

describe("FanChart - obserwacje o formie", () => {
  it("poprawny wachlarz nie dostaje ŻADNEJ uwagi", () => {
    // Uwaga, którą widać zawsze, uczy ignorowania wszystkich uwag - łącznie
    // z tą jedną, która kiedyś będzie o defekcie.
    const { container } = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    expect(klucze(container)).toHaveLength(0);
  });

  it("prognoza BEZ PASMA jest nazwana - to jest cała racja bytu tego rodzaju", () => {
    // Kolumna "czego unikać" ma przy tym wierszu dokładnie jedną pozycję:
    // "pojedyncza linia prognozy". Rysunek, który ją popełnia, musi to
    // powiedzieć, bo sam wygląda jak zwykły wykres liniowy.
    const { container } = render(
      <FanChart config={cfg({ ...Z_PROCENTU, forecastBandPct: 0 })} lang="pl" />,
    );
    expect(nota(container, "reading.noBand")?.textContent).toContain("jedną linią");
    // ...i jednocześnie DEFEKT: prognoza straciła jeden z trzech nośników.
    expect(nota(container, "honesty.forecastDistinguished")?.textContent).toContain(
      "tło strefy prognozy",
    );
  });

  it("wachlarz bez prognozy mówi, czego na nim nie ma", () => {
    const { container } = render(<FanChart config={cfg({ ...BAZA, forecastFrom: N })} lang="pl" />);
    expect(nota(container, "reading.noForecast")).not.toBeNull();
  });

  it("PROGU liczby poziomów nie da się dziś przekroczyć - sufit serii jest niżej", () => {
    // STAN FAKTYCZNY, nie życzenie. `fanFormAdvice` odzywa się dopiero POWYŻEJ
    // czterech poziomów (`FAN_LEVELS_ADVICE_MAX`), a `parseChartConfig` obcina
    // arkusz do `MAX_SERIES` = 8 kolumn. Osiem kolumn to najwyżej cztery pary
    // krawędzi, czyli dokładnie cztery poziomy - i to bez ani jednej kolumny na
    // ścieżkę centralną. Klucz `fan.reading.tooManyLevels` jest więc wołany
    // z renderu (wymaga tego bramka podziału porad), ale na opublikowanej
    // stronie nie ma jak się pokazać.
    //
    // Test pinuje oba końce: cztery poziomy MILCZĄ (próg jest ostry, nie
    // "od czterech"), a pod rysunkiem stoi za to obserwacja o braku ścieżki
    // centralnej - bo na krawędzie poszły wszystkie kolumny.
    const cztery: Record<string, Json> = {
      categories: OKRESY,
      forecastFrom: 5,
      animate: false,
      series: [
        { name: "50% dolna", values: [N, N, N, N, N, 118, 119, 122] },
        { name: "50% górna", values: [N, N, N, N, N, 120, 127, 134] },
        { name: "60% dolna", values: [N, N, N, N, N, 117, 118, 120] },
        { name: "60% górna", values: [N, N, N, N, N, 121, 128, 136] },
        { name: "80% dolna", values: [N, N, N, N, N, 115, 115, 116] },
        { name: "80% górna", values: [N, N, N, N, N, 123, 131, 140] },
        { name: "95% dolna", values: [N, N, N, N, N, 113, 111, 110] },
        { name: "95% górna", values: [N, N, N, N, N, 125, 135, 146] },
      ],
    };
    const { container } = render(<FanChart config={cfg(cztery)} lang="pl" />);
    expect(all(container, "[data-role='band']").length).toBeGreaterThan(3);
    expect(nota(container, "reading.tooManyLevels")).toBeNull();
    expect(nota(container, "reading.noCentral")).not.toBeNull();
    // Dziewiąta kolumna nie dokłada piątego poziomu, bo parser ją odcina.
    const dziewiec = {
      ...cztery,
      series: [
        ...(cztery.series as Json[]),
        { name: "99% dolna", values: [N, N, N, N, N, 110, 108, 105] },
      ],
    };
    const drugi = render(<FanChart config={cfg(dziewiec)} lang="pl" />);
    expect(nota(drugi.container, "reading.tooManyLevels")).toBeNull();
  });

  it("stała szerokość pasma jest nazwana RAZ, a nie dwa razy tym samym zdaniem", () => {
    // Model wystawia z JEDNEGO pola (`honesty.constantWidth`) i orzeczenie
    // uczciwości, i poradę formy `constantBand`, a oba zdania w słowniku mówią
    // to samo. Wypisane razem stałyby obok siebie na liście jako dwa zdania
    // o tej samej treści - dlatego render wypisuje tylko obserwację o formie.
    const stale: Record<string, Json> = {
      categories: ["I", "II", "III", "IV"],
      forecastFrom: 2,
      animate: false,
      series: [
        { name: "PKB", values: [100, 100, 100, 100] },
        { name: "80% dolna", values: [N, N, 90, 90] },
        { name: "80% górna", values: [N, N, 110, 110] },
      ],
    };
    const { container } = render(<FanChart config={cfg(stale)} lang="pl" />);
    expect(nota(container, "reading.constantBand")).not.toBeNull();
    expect(nota(container, "honesty.constantWidth")).toBeNull();
  });
});

/**
 * DEFEKTY DANYCH - jeden przypadek na jedno orzeczenie modelu, plus asercja
 * ODWROTNA: na wachlarzu poprawnym ta sama uwaga ma milczeć.
 *
 * Bez asercji odwrotnej test przechodziłby dla uwagi wypisywanej ZAWSZE, a to
 * jest defekt gorszy od braku uwagi: lista, na której wszystko krzyczy, uczy
 * pomijania całej listy.
 */
describe("FanChart - defekty danych: wtedy i tylko wtedy", () => {
  const PRZYPADKI: Array<[string, string, Record<string, Json>, string]> = [
    [
      "honesty.bandsContainCentral",
      "pasmo mijające ścieżkę centralną znaczy, że krawędzie i centrum policzono z dwóch różnych prognoz",
      {
        ...BAZA,
        series: [
          CENTRUM,
          { name: "80% dolna", values: [N, N, N, N, N, 130, 131, 132] },
          { name: "80% górna", values: [N, N, N, N, N, 140, 145, 150] },
        ],
      },
      "2026",
    ],
    [
      "honesty.bandsNested",
      "przecięcie krawędzi dwóch poziomów znaczy, że jedna z liczb nie pochodzi z rozkładu, o którym mówi jej etykieta",
      {
        ...BAZA,
        series: [
          CENTRUM,
          { name: "50% dolna", values: [N, N, N, N, N, 110, 119, 122] },
          { name: "50% górna", values: [N, N, N, N, N, 121, 127, 134] },
          { name: "80% dolna", values: [N, N, N, N, N, 115, 115, 116] },
          { name: "80% górna", values: [N, N, N, N, N, 123, 131, 140] },
        ],
      },
      "2026",
    ],
    [
      "honesty.confidenceMatchesWidth",
      "pasmo 95% węższe od 80% to defekt DEKLARACJI - bez tej uwagi etykieta kłamie o rozkładzie",
      {
        ...BAZA,
        series: [
          CENTRUM,
          { name: "80% dolna", values: [N, N, N, N, N, 110, 105, 100] },
          { name: "80% górna", values: [N, N, N, N, N, 130, 140, 150] },
          { name: "95% dolna", values: [N, N, N, N, N, 117, 119, 122] },
          { name: "95% górna", values: [N, N, N, N, N, 121, 127, 134] },
        ],
      },
      "95%",
    ],
    [
      "honesty.bandsHaveWidth",
      "pasmo zwężone do linii twierdzi „tę wartość znam dokładnie” - twierdzenie mocniejsze niż cała reszta rysunku",
      Z_KOTWICA,
      "2025",
    ],
    [
      "honesty.bandPairsOrdered",
      "odwrócona para krawędzi znaczy, że jedna z kolumn arkusza nie jest tym, co mówi jej nazwa",
      {
        ...BAZA,
        series: [
          CENTRUM,
          { name: "80% dolna", values: [N, N, N, N, N, 123, 115, 116] },
          { name: "80% górna", values: [N, N, N, N, N, 115, 131, 140] },
        ],
      },
      "2026",
    ],
    [
      "honesty.centralContinuousInForecast",
      "luka w prognozie przerywa linię, a pasmo wokół niej nie ma do czego się odnieść",
      {
        ...BAZA,
        series: [
          { name: "PKB", values: [100, 104, 107, 111, 115, 119, N, 128] },
          { name: "80% dolna", values: [N, N, N, N, N, 115, 115, 116] },
          { name: "80% górna", values: [N, N, N, N, N, 123, 131, 140] },
        ],
      },
      "2027",
    ],
    [
      "honesty.unpairedEdge",
      "jedna krawędź nie jest pasmem, więc tego poziomu na rysunku nie ma - autor musi wiedzieć, czego brakuje",
      {
        ...BAZA,
        series: [CENTRUM, { name: "80% dolna", values: [N, N, N, N, N, 115, 115, 116] }],
      },
      "80% dolna",
    ],
    [
      "honesty.duplicateEdge",
      "druga seria zgłoszona do tej samej krawędzi nie zostawia na wykresie żadnego śladu",
      {
        ...BAZA,
        series: [
          CENTRUM,
          { name: "80% dolna", values: [N, N, N, N, N, 115, 115, 116] },
          { name: "80% górna", values: [N, N, N, N, N, 123, 131, 140] },
          { name: "80% górna bis", values: [N, N, N, N, N, 124, 132, 141] },
        ],
      },
      "80% górna bis",
    ],
    [
      "honesty.outOfRangeConfidence",
      "pewność 120% nie jest pewnością - poziom traci etykietę i wypada ze sprawdzenia kolejności",
      {
        ...BAZA,
        series: [
          CENTRUM,
          { name: "120% dolna", values: [N, N, N, N, N, 115, 115, 116] },
          { name: "120% górna", values: [N, N, N, N, N, 123, 131, 140] },
        ],
      },
      "120",
    ],
    [
      "honesty.extraSeries",
      "seria, której wachlarz nie czyta, znika z rysunku bez śladu - autor spodziewał się trzech scenariuszy, dostał jeden",
      {
        ...BAZA,
        series: [
          CENTRUM,
          { name: "Wariant awaryjny", values: [90, 92, 94, 96, 98, 100, 102, 104] },
          { name: "80% dolna", values: [N, N, N, N, N, 115, 115, 116] },
          { name: "80% górna", values: [N, N, N, N, N, 123, 131, 140] },
        ],
      },
      "Wariant awaryjny",
    ],
    [
      "honesty.droppedValues",
      "liczba spoza zakresu arytmetyki pasm wypada z rysunku i z tabeli - wiersz wygląda wtedy na niekompletny bez powodu",
      {
        ...BAZA,
        series: [
          { name: "PKB", values: [100, 104, 107, 111, 115, 119, 1.7e308, 128] },
          { name: "80% dolna", values: [N, N, N, N, N, 115, 115, 116] },
          { name: "80% górna", values: [N, N, N, N, N, 123, 131, 140] },
        ],
      },
      "1",
    ],
  ];

  for (const [klucz, powod, dane, fragment] of PRZYPADKI) {
    it(`${klucz} - ${powod}`, () => {
      const zly = render(<FanChart config={cfg(dane)} lang="pl" />);
      const el = nota(zly.container, klucz);
      expect(el, `${klucz}: uwaga nie pojawiła się przy defekcie`).not.toBeNull();
      expect(el?.textContent ?? "").toContain(fragment);
      // Defekt DANYCH idzie czerwienią tekstową; obserwacja o formie inkiem
      // recesywnym. Rozróżnienie jest w kolorze, bo lista, na której wszystko
      // krzyczy, uczy ignorowania całej listy.
      expect(el?.getAttribute("style") ?? "").toContain("--chart-negative-text");
      // ...i NIE pojawia się na wachlarzu poprawnym.
      const dobry = render(<FanChart config={cfg(BAZA)} lang="pl" />);
      expect(nota(dobry.container, klucz), `${klucz}: uwaga widoczna bez defektu`).toBeNull();
    });
  }

  it("honesty.wideAtStart wypisuje się PRZY BIEGUNOWOŚCI ODWRÓCONEJ - true znaczy defekt", () => {
    // `wideAtStart` i `constantWidth` to jedyne pola `FanHonesty`, w których
    // `true` znaczy „coś jest nie tak"; wszystkie pozostałe orzeczenia mają
    // defekt pod `false`. Odruchowe `=== false` dałoby uwagę o szerokim starcie
    // na KAŻDYM poprawnym wachlarzu i milczenie na tym jednym, który naprawdę
    // wystartował szeroko - czyli dokładne odwrócenie sensu.
    const { container } = render(<FanChart config={cfg(Z_PROCENTU)} lang="pl" />);
    const el = nota(container, "honesty.wideAtStart");
    expect(el).not.toBeNull();
    // Udział jest PODSTAWIONY, a nie zostawiony klamrami.
    expect(el?.textContent ?? "").toMatch(/9\d%/);
    // To NIE jest defekt danych: żadna z tych liczb nie jest fałszywa.
    expect(el?.getAttribute("style") ?? "").toContain("--muted-foreground");
    const dobry = render(<FanChart config={cfg(BAZA)} lang="pl" />);
    expect(nota(dobry.container, "honesty.wideAtStart")).toBeNull();
  });

  it("granica poza zakresem kroków NIE dociera do uwagi - odrzuca ją parser", () => {
    // `parseChartConfig` zeruje `forecastFrom` spoza 1..count-1 ZANIM zobaczy
    // go model, więc `honesty.boundaryDropped` nigdy nie zapala się na drodze
    // z konfiguracji bloku. Czytelnik dostaje wtedy „wykres nie ma odcinka
    // prognozy" i nie dowiaduje się, że autor deklarację złożył. Ten test
    // pinuje stan FAKTYCZNY, żeby zmiana w parserze albo w modelu nie przeszła
    // niezauważona.
    const { container } = render(
      <FanChart config={cfg({ ...BAZA, forecastFrom: 40 })} lang="pl" />,
    );
    expect(nota(container, "honesty.boundaryDropped")).toBeNull();
    expect(nota(container, "reading.noForecast")).not.toBeNull();
  });

  it("żadna uwaga nie zostawia surowych klamer wstawki", () => {
    // Brakująca liczba nie jest błędem kompilacji ani rozjazdem klucza, więc
    // jedyne, co ją wyłapie, to tekst na ekranie.
    for (const [, , dane] of PRZYPADKI) {
      const { container } = render(<FanChart config={cfg(dane)} lang="pl" />);
      for (const el of all(container, "[data-note]")) {
        expect(el.textContent ?? "").not.toContain("{{");
        expect(el.textContent ?? "").not.toContain("undefined");
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  DANE Z BAZY                                                               */
/* -------------------------------------------------------------------------- */

describe("FanChart - przypadki brzegowe", () => {
  it("PUSTO nie gubi przypisów - rysunku nie ma, ale milczenia też nie", () => {
    // Histogram miał tu defekt: wczesny powrót „brak danych" zwracał `null`
    // razem z uwagami, więc czytelnik widział kartę z tytułem nad niczym i nie
    // wiedział, czy patrzy na awarię, czy na dane, z których nie da się
    // zbudować rozkładu.
    const { container } = render(
      <FanChart config={cfg({ categories: [], series: [], animate: false })} lang="pl" />,
    );
    expect(container.querySelector("svg")).toBeNull();
    expect(klucze(container)).toContain("reading.noBand");
    expect(klucze(container)).toContain("reading.noForecast");
  });

  it("JEDNA obserwacja nie wywraca rysunku", () => {
    const { container } = render(
      <FanChart
        config={cfg({ categories: ["a"], series: [{ name: "x", values: [42] }], animate: false })}
        lang="pl"
      />,
    );
    expect(container.textContent ?? "").not.toContain("NaN");
    expect(container.querySelector("[data-role='central-path']")).not.toBeNull();
  });

  it("SAME LUKI nie dają ani ścieżki, ani nie-liczby", () => {
    const { container } = render(
      <FanChart
        config={cfg({
          categories: ["a", "b", "c"],
          series: [{ name: "x", values: [N, N, N] }],
          forecastFrom: 2,
          animate: false,
        })}
        lang="pl"
      />,
    );
    expect(all(container, "[data-role='central-path']")).toHaveLength(0);
    expect(container.textContent ?? "").not.toContain("NaN");
    expect(nota(container, "reading.noCentral")).not.toBeNull();
  });

  it("WARTOŚCI SKRAJNE nie wypuszczają NaN ani Infinity do atrybutów SVG", () => {
    // `NaN` w atrybucie `d` nie pokazuje się jako tekst - wycina znacznik
    // z rysunku bez śladu w konsoli, więc jedyną drogą wykrycia jest asercja
    // na atrybutach.
    const { container } = render(
      <FanChart
        config={cfg({
          categories: ["a", "b", "c", "d"],
          series: [
            { name: "x", values: [1, Number.NaN, Number.POSITIVE_INFINITY, 1.7e308] },
            { name: "80% dolna", values: [N, N, -1.7e308, 0] },
            { name: "80% górna", values: [N, N, 1.7e308, 2] },
          ],
          forecastFrom: 2,
          animate: false,
        })}
        lang="pl"
      />,
    );
    const tekst = container.textContent ?? "";
    for (const zly of ["NaN", "Infinity", "undefined", "∞"]) expect(tekst).not.toContain(zly);
    for (const el of all(container, "svg *")) {
      for (const attr of [
        "x",
        "y",
        "cx",
        "cy",
        "r",
        "width",
        "height",
        "d",
        "x1",
        "y1",
        "x2",
        "y2",
      ]) {
        const v = el.getAttribute(attr);
        if (v === null) continue;
        expect(/NaN|Infinity/.test(v), `${attr}="${v}"`).toBe(false);
      }
    }
  });

  it("WSZYSTKIE WARTOŚCI RÓWNE nie dzielą przez zero", () => {
    const { container } = render(
      <FanChart
        config={cfg({
          categories: ["a", "b", "c", "d"],
          series: [{ name: "x", values: [5, 5, 5, 5] }],
          forecastFrom: 2,
          forecastBandPct: 10,
          animate: false,
        })}
        lang="pl"
      />,
    );
    expect(container.textContent ?? "").not.toContain("NaN");
    const p = punkty(
      container.querySelector("[data-role='central-path']")?.getAttribute("d") ?? "",
    );
    for (const punkt of p) {
      expect(Number.isFinite(punkt.x)).toBe(true);
      expect(Number.isFinite(punkt.y)).toBe(true);
    }
  });

  it("ZERO jako wartość centralna daje pasmo o zerowej szerokości - i mówi o tym", () => {
    // Pasmo liczone procentowo od zera ma zerową szerokość z arytmetyki, nie
    // z danych: rysunek twierdziłby wtedy, że wartość zero znamy dokładnie.
    const { container } = render(
      <FanChart
        config={cfg({
          categories: ["a", "b", "c", "d"],
          series: [{ name: "x", values: [0, 0, 0, 0] }],
          forecastFrom: 2,
          forecastBandPct: 10,
          animate: false,
        })}
        lang="pl"
      />,
    );
    expect(nota(container, "honesty.bandsHaveWidth")).not.toBeNull();
    expect(container.textContent ?? "").not.toContain("NaN");
  });
});
