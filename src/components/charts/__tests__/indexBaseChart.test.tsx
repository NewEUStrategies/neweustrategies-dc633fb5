// LINIOWY NA INDEKSIE (BAZA = 100) - CO MUSI BYĆ PRAWDĄ O RYSUNKU.
//
// KONFIGURACJA BEZ KLUCZA `kind`, i to jest świadome: model czyta `categories`
// i `series`, a nie `config.kind` (`grep -n "config.kind"
// src/lib/charts/kinds/indexBase.ts` nie zwraca nic), więc rodzaj zapisany
// w konfiguracji nie ma tu żadnego znaczenia; podłączenia rodzaju do
// rozdzielnika pilnuje osobna bramka `everyKindRenders.test.tsx`.
//
// SKĄD BIORĘ LICZBY. `useContainerWidth` czyta `clientWidth`, które
// w happy-dom wynosi 0, więc szerokość zostaje na wartości startowej 720 -
// geometria jest deterministyczna. `useRevealOnScroll` nigdy nie dostaje
// callbacku IntersectionObservera, więc stan to zawsze "static", czyli
// dokładnie to, co widzi crawler.
//
// CZEGO TU NIE MA. Arytmetyka indeksu (odrzucenia, ogrodzenie bazy, zakres
// osi, sprawdzenia uczciwości) ma własny plik testowy przy modelu. Tutaj
// sprawdzam wyłącznie to, czego model sprawdzić nie może: czy RYSUNEK mówi to,
// co model policzył.
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import { FONT_AXIS } from "@/lib/charts/geometry";
import { estimateLabelWidth } from "@/lib/charts/measureText";
import type { ChartConfig } from "@/lib/charts/types";
import {
  INDEX_BASE_VALUE,
  indexBaseFormAdvice,
  indexBaseModelFromConfig,
} from "@/lib/charts/kinds/indexBase";
import { IndexBaseChart } from "../IndexBaseChart";

function cfg(data: Record<string, Json>): ChartConfig {
  return parseChartConfig(data);
}

const all = (root: HTMLElement, sel: string): Element[] => [...root.querySelectorAll(sel)];
const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));

/** Przypisy pod rysunkiem po swoich uchwytach: klucz -> treść. */
function notatki(root: HTMLElement): Map<string, string> {
  return new Map(
    all(root, "[data-note]").map((el) => [
      el.getAttribute("data-note") ?? "",
      el.textContent ?? "",
    ]),
  );
}

/** Klucze przypisów - do sprawdzania OBECNOŚCI i NIEOBECNOŚCI. */
const klucze = (root: HTMLElement): string[] => [...notatki(root).keys()];

/** Punkty jednej serii, w kolejności okresów. */
const punkty = (root: HTMLElement, seria: number): Element[] =>
  all(root, `circle[data-role='series-point'][data-series='${seria}']`);

const linia = (root: HTMLElement): Element => {
  const el = root.querySelector("[data-role='index-baseline']");
  if (el === null) throw new Error("brak linii odniesienia");
  return el;
};

/**
 * Dwa szeregi o skali różniącej się stukrotnie - czyli dokładnie ten arkusz,
 * dla którego tabela doboru formy przewiduje ten rodzaj. Eksport idzie na
 * indeks 100, 105, 120, 130, 150; zatrudnienie na 100, 105, 100, 110, 115.
 * Żaden defekt uczciwości tu NIE zachodzi - to jest punkt odniesienia dla
 * sprawdzeń „wtedy i tylko wtedy".
 */
const OKRESY = ["2019", "2020", "2021", "2022", "2023"];
const BAZA: Record<string, Json> = {
  categories: OKRESY,
  series: [
    { name: "Eksport", values: [200, 210, 240, 260, 300], colorSlot: 1 },
    { name: "Zatrudnienie", values: [2, 2.1, 2, 2.2, 2.3], colorSlot: 2 },
  ],
  unit: "mld EUR",
  animate: false,
};

/* ========================================================================== */
/*  GEOMETRIA                                                                 */
/* ========================================================================== */

describe("IndexBaseChart - pozycja koduje indeks, a linia odniesienia jest zerem odczytu", () => {
  it("w okresie bazowym KAŻDA seria leży dokładnie na linii odniesienia", () => {
    // NAJWAŻNIEJSZA ASERCJA TEGO PLIKU. Cały ten rodzaj istnieje po to, żeby
    // szeregi o różnej skali startowały z jednego punktu - bez tego zostaje
    // druga oś Y, czyli relacja wizualna dobrana przez autora. Test przepuści
    // defekt bazy liczonej PER SERIA tylko wtedy, gdyby obie serie miały
    // przypadkiem tę samą wartość bazową; tu mają 200 i 2.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const yBazy = num(linia(container), "y1");
    expect(num(punkty(container, 0)[0], "cy")).toBeCloseTo(yBazy, 6);
    expect(num(punkty(container, 1)[0], "cy")).toBeCloseTo(yBazy, 6);
  });

  it("podpis linii odniesienia i stała INDEX_BASE to TA SAMA liczba", () => {
    // Defekt, który to łapie: podpis „= 100" wpisany w słowniku na sztywno
    // i mnożnik ilorazu w modelu przestają być jedną liczbą. Rysunek wygląda
    // wtedy poprawnie, a każda wartość na nim jest odniesiona do czego innego
    // niż mówi napis.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const podpis = container.querySelector("[data-role='index-baseline-label']")?.textContent ?? "";
    expect(podpis).toContain("2019");
    const liczbaZPodpisu = Number((podpis.match(/=\s*([\d]+)\s*$/) ?? [])[1]);
    expect(liczbaZPodpisu).toBe(INDEX_BASE_VALUE);
    // I ta sama liczba stoi w modelu jako wysokość linii odniesienia.
    expect(indexBaseModelFromConfig(cfg(BAZA)).baseline).toBe(liczbaZPodpisu);
  });

  it("odległość od linii odniesienia jest proporcjonalna do odchylenia od stu", () => {
    // To jest zdanie o tym, CO NIESIE POZYCJA. Gdyby render rysował wartości
    // źródłowe (200...300) zamiast indeksu, ta proporcja by się rozjechała,
    // a przy dwóch seriach o różnej skali jedna z nich spłaszczyłaby się
    // w kreskę przy krawędzi.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const yBazy = num(linia(container), "y1");
    const indeksy = [100, 105, 120, 130, 150];
    const skale = punkty(container, 0).map(
      (p, i) => (yBazy - num(p, "cy")) / (indeksy[i] - INDEX_BASE_VALUE),
    );
    // Pierwszy punkt jest na samej linii (0/0), więc porównujemy pozostałe.
    const bezBazy = skale.slice(1);
    for (const s of bezBazy) expect(s).toBeCloseTo(bezBazy[0], 6);
    expect(bezBazy[0]).toBeGreaterThan(0);
  });

  it("seria o stukrotnie mniejszych wartościach NIE jest spłaszczona", () => {
    // Defekt, który to łapie: wspólna oś POZIOMÓW zamiast indeksu. Wtedy
    // zatrudnienie (2,0-2,3) leżałoby na dnie osi eksportu (200-300),
    // a różnica jego temp zniknęłaby w grubości linii.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const yBazy = num(linia(container), "y1");
    const eksport = punkty(container, 0);
    const zatrudnienie = punkty(container, 1);
    const odchylenieEksportu = yBazy - num(eksport[eksport.length - 1], "cy");
    const odchylenieZatrudnienia = yBazy - num(zatrudnienie[zatrudnienie.length - 1], "cy");
    // 150 do stu ma się jak 50, 115 do stu jak 15 - i tyle ma wyjść z pikseli.
    expect(odchylenieEksportu / odchylenieZatrudnienia).toBeCloseTo(50 / 15, 6);
  });

  it("okresy stoją równo, od lewej krawędzi pola do prawej", () => {
    // Wykres liniowy ma pomiar na KRAWĘDZI pola, nie w środku pasma - inaczej
    // ostatni okres nie dotyka prawej krawędzi i etykieta końca linii wisi nad
    // pustym miejscem.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const x = punkty(container, 0).map((p) => num(p, "cx"));
    expect(x).toHaveLength(OKRESY.length);
    const krok = x[1] - x[0];
    for (let i = 1; i < x.length; i++) expect(x[i] - x[i - 1]).toBeCloseTo(krok, 6);
    expect(krok).toBeGreaterThan(0);
  });

  it("oś NIE jest dociągana do zera, a ucięcie jest NAZWANE", () => {
    // `indexBaseExtent` świadomie nie domyka zera: indeksy mieszkają wokół
    // stu, więc wymuszenie zera zepchnęłoby całą zmienność w górne dziesięć
    // procent osi i dało rysunek mówiący „nic się nie działo". Cena tej
    // decyzji to obowiązek nazwania ucięcia - i ten test pilnuje obu połów
    // naraz: braku zera NA OSI i obecności zdania POD RYSUNKIEM.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const podzialki = all(container, "text.tabular-nums:not([data-role])").map(
      (e) => e.textContent ?? "",
    );
    expect(podzialki.length).toBeGreaterThan(1);
    expect(podzialki).not.toContain("0");
    expect(klucze(container)).toContain("axisTruncated");
  });

  it("zdanie o uciętej osi stoi wtedy i tylko wtedy, gdy podziałki NIE mają zera", () => {
    // ZMIERZONY DEFEKT: przypis orzekał z `model.axisTruncatedFromZero`, czyli
    // z zakresu DANYCH, a podziałki liczy `niceScale`, które dociąga krańce do
    // wielokrotności kroku. Dla serii 1, 2, 5, 10 (indeksy 100..1000) krok
    // wychodzi 200, dolny kraniec zaokrągla się w dół DO ZERA - i pod
    // podziałkami „0, 200, 400, 600, 800, 1000" stało zdanie „Oś nie zaczyna
    // się od zera". Przypis przeczący rysunkowi podważa całą listę przypisów.
    const zZerem = cfg({
      categories: ["a", "b", "c", "d"],
      series: [{ name: "Skok", values: [1, 2, 5, 10], colorSlot: 1 }],
      animate: false,
    });
    const { container } = render(<IndexBaseChart config={zZerem} lang="pl" />);
    const podzialki = all(container, "text.tabular-nums:not([data-role])").map(
      (e) => e.textContent ?? "",
    );
    expect(podzialki).toContain("0");
    expect(klucze(container)).not.toContain("axisTruncated");
    // Model nadal mówi swoje o DANYCH - to nie jego pole jest tu błędne,
    // tylko pytanie, które mu zadawano.
    expect(indexBaseModelFromConfig(zZerem).axisTruncatedFromZero).toBe(true);
  });

  it("luka przerywa linię, a nie jest zamalowana interpolacją", () => {
    // Zero w miejscu luki wpadłoby do indeksu jako spadek do zera, którego
    // nikt nie zmierzył; interpolacja narysowałaby pomiar, którego nie ma.
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          ...BAZA,
          series: [{ name: "Eksport", values: [200, 210, null, 260, 300], colorSlot: 1 }],
        })}
        lang="pl"
      />,
    );
    const d = container.querySelector("[data-role='series-line']")?.getAttribute("d") ?? "";
    // Dwa podciągi znaczą dwa oddzielne pociągnięcia - luka rozdziela ścieżkę.
    expect(d.match(/M/g) ?? []).toHaveLength(2);
    expect(punkty(container, 0)).toHaveLength(4);
  });

  it("okres bazowy jest OZNACZONY na osi, a nie tylko wspomniany w podpisie", () => {
    // Bez znacznika czytelnik nie wie, który słupek czasu jest tym, wobec
    // którego liczy się wszystko, co widzi - a przy bazie w środku szeregu
    // („= 2021") sam podpis każe mu jej szukać wzrokiem po etykietach.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" baseAt={2} />);
    const etykieta = container.querySelector("[data-role='base-period']");
    expect(etykieta?.textContent).toBe("2021");
    const znacznik = container.querySelector("[data-role='base-period-marker']");
    expect(znacznik).not.toBeNull();
    // Znacznik stoi DOKŁADNIE nad punktem bazowym, nie obok niego.
    expect(num(znacznik as Element, "x1")).toBeCloseTo(num(punkty(container, 0)[2], "cx"), 6);
  });

  it("przy nie więcej niż czterech szeregach koniec linii nosi nazwę serii", () => {
    // Sekcja 4: etykieta bezpośrednia zamiast legendy. Defekt bez tego:
    // czytelnik wodzi wzrokiem między legendą a końcem linii i przypisuje
    // kolor na pamięć - a przy kolorach z zestawu rozszerzonego myli je.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const etykiety = all(container, "[data-role='series-end-label']").map((e) => e.textContent);
    expect(etykiety).toEqual(["Eksport", "Zatrudnienie"]);
  });

  it("powyżej czterech szeregów etykiet końcowych nie ma - tożsamość niesie legenda", () => {
    const piec = Array.from({ length: 5 }, (_, i) => ({
      name: `S${i + 1}`,
      values: [10, 11 + i, 12 + i],
      colorSlot: i + 1,
    }));
    const { container } = render(
      <IndexBaseChart
        config={cfg({ ...BAZA, categories: ["a", "b", "c"], series: piec })}
        lang="pl"
      />,
    );
    expect(all(container, "[data-role='series-end-label']")).toHaveLength(0);
    expect(all(container, "[data-role='series-line']")).toHaveLength(5);
  });
});

/* ========================================================================== */
/*  OŚ BEZJEDNOSTKOWA                                                         */
/* ========================================================================== */

describe("IndexBaseChart - oś jest bezjednostkowa i mówi to wprost", () => {
  it("render ZAWSZE wypisuje zdanie o bezjednostkowej osi", () => {
    // Bez tego zdania czytelnik czyta „112" jako wartość, a nie jako „o 12%
    // więcej niż w bazie" - i to jest defekt cichy, bo rysunek wygląda
    // bez zarzutu.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const tresc = notatki(container).get("axis.unitless") ?? "";
    expect(tresc).toContain("bezjednostkowe");
  });

  it("jednostka autora NIE trafia ani na podziałki, ani na podpis bazy", () => {
    // Iloraz dwóch wartości w mld EUR nie jest w mld EUR. Podziałka „150 mld
    // EUR" byłaby zdaniem fałszywym o każdej liczbie na rysunku.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const naOsi = all(container, "text.tabular-nums:not([data-role])")
      .map((e) => e.textContent ?? "")
      .join("|");
    expect(naOsi).not.toContain("mld");
    const podpis = container.querySelector("[data-role='index-baseline-label']")?.textContent ?? "";
    expect(podpis).not.toContain("mld");
    // A sama jednostka nie ginie: model trzyma ją dla kolumny wartości
    // źródłowych w tabeli danych.
    expect(indexBaseModelFromConfig(cfg(BAZA)).sourceUnit).toBe("mld EUR");
  });
});

/* ========================================================================== */
/*  SERIA ODRZUCONA                                                           */
/* ========================================================================== */

describe("IndexBaseChart - seria odrzucona nie znika po cichu", () => {
  const zBaza = (bazowa: number | null): ChartConfig =>
    cfg({
      ...BAZA,
      series: [
        { name: "Eksport", values: [200, 210, 240, 260, 300], colorSlot: 1 },
        { name: "Deficyt", values: [bazowa, 2.1, 2, 2.2, 2.3], colorSlot: 2 },
      ],
    });

  it("baza zerowa daje przypis z NAZWANĄ przyczyną, a nie cichą jedynkę", () => {
    // Defekt, który to łapie: podstawienie jedynki w mianowniku. Indeks
    // wyglądałby wtedy jak każdy inny, a znaczyłby „wartość razy sto".
    const { container } = render(<IndexBaseChart config={zBaza(0)} lang="pl" />);
    const wpisy = notatki(container);
    const klucz = [...wpisy.keys()].find((k) => k.startsWith("rejection.zeroBase"));
    expect(klucz, "brak przypisu o serii odrzuconej").toBeTruthy();
    expect(wpisy.get(klucz ?? "")).toContain("Deficyt");
    expect(wpisy.get(klucz ?? "")).toContain("dzieleniem przez zero");
    // I rysunek naprawdę jej nie ma - przypis nie jest ozdobą przy linii.
    expect(all(container, "[data-role='series-line']")).toHaveLength(1);
  });

  it("brak wartości w okresie bazowym to INNA przyczyna niż zero", () => {
    // Trzy przyczyny to trzy różne poprawki dla autora: dopisz pomiar, zmień
    // okres bazowy, przelicz szereg. Jedno zdanie „nie da się zaindeksować"
    // nie mówi, którą z nich wykonać.
    const { container } = render(<IndexBaseChart config={zBaza(null)} lang="pl" />);
    expect(klucze(container).some((k) => k.startsWith("rejection.missingBase"))).toBe(true);
    expect(klucze(container).some((k) => k.startsWith("rejection.zeroBase"))).toBe(false);
  });

  it("baza ujemna jest odrzucana, bo ODWRACAŁABY kierunek", () => {
    // Dzielenie przez liczbę ujemną jest legalne arytmetycznie i dlatego
    // groźne: pogłębiający się deficyt dałby rosnący indeks, czyli rysunek
    // pokazałby wzrost tam, gdzie jest spadek.
    const { container } = render(<IndexBaseChart config={zBaza(-5)} lang="pl" />);
    const wpisy = notatki(container);
    const klucz = [...wpisy.keys()].find((k) => k.startsWith("rejection.negativeBase")) ?? "";
    expect(wpisy.get(klucz)).toContain("odwraca kierunek");
  });

  it("seria odrzucona jest w dymku z kreską, a nie pominięta w nim", () => {
    // Seria pominięta w dymku znikałaby czytelnikowi DRUGI raz. Kreska mówi
    // „ten szereg istnieje i nie ma tu indeksu" - a to jest prawda, której
    // pusty dymek nie powie. Czytany jest WIERSZ, nie cała treść dymka:
    // „w dymku gdzieś jest myślnik" przechodzi także wtedy, gdy myślnik stoi
    // w cudzej nazwie albo w liczbie ujemnej, czyli nie mówi nic o serii,
    // o którą pytamy.
    const { container } = render(<IndexBaseChart config={zBaza(0)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    fireEvent.keyDown(box as HTMLElement, { key: "ArrowRight" });
    const wiersze = new Map(
      all(container, ".neh-tooltip dl > div").map((w) => [
        w.querySelector("dt")?.textContent ?? "",
        w.querySelector("dd")?.textContent ?? "",
      ]),
    );
    expect(wiersze.get("Deficyt")).toBe("-");
    // ...a seria, która na rysunku JEST, ma w tym samym dymku liczbę.
    expect(wiersze.get("Eksport")).toBe("100");
  });

  it("przy zdrowym arkuszu żadnego przypisu o odrzuceniu NIE MA", () => {
    // Druga połowa „wtedy i tylko wtedy": lista, na której zawsze coś stoi,
    // uczy ignorowania całej listy.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    expect(klucze(container).some((k) => k.startsWith("rejection."))).toBe(false);
  });
});

/* ========================================================================== */
/*  DOSTĘPNOŚĆ I KLAWIATURA                                                   */
/* ========================================================================== */

describe("IndexBaseChart - dostępność", () => {
  it("kontener ma rolę, ognisko, nazwę z tytułu i opis obsługi", () => {
    // Sama obsługa klawiszy nie wystarcza: czytelnik, który nie wie, że
    // strzałki coś robią, ich nie naciśnie.
    const { container } = render(
      <IndexBaseChart config={cfg({ ...BAZA, title: "Tempo eksportu" })} lang="pl" />,
    );
    const box = container.querySelector<HTMLElement>("[role='img'][tabindex='0']");
    expect(box).not.toBeNull();
    const nazwa = box?.getAttribute("aria-label") ?? "";
    expect(nazwa).toContain("Tempo eksportu");
    // Nazwa niesie też to, czego z samej grafiki nie da się usłyszeć: bazę
    // i bezjednostkowość osi.
    expect(nazwa).toContain("2019");
    expect(nazwa).toContain("bezjednostkowe");
    const opisId = box?.getAttribute("aria-describedby") ?? "";
    expect(opisId).not.toBe("");
    const opis = container.querySelector(`#${opisId}`);
    expect(opis?.className).toContain("sr-only");
    expect((opis?.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("wykres bez tytułu ma nazwę zastępczą, a nie pustą", () => {
    // Pusty `aria-label` to przystanek tabulacji, który nic nie mówi.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const nazwa = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(nazwa.startsWith("Wykres")).toBe(true);
  });

  it("ognisko jest JEDNO - rysunek nie rozsypuje kolejności tabulacji", () => {
    // Punktów jest tu kilkadziesiąt; gdyby każdy był osobnym przystankiem,
    // czytelnik klawiatury przechodziłby przez wykres kilkadziesiąt razy,
    // zanim dojdzie do tabeli danych.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    expect(all(container, "[tabindex='0']")).toHaveLength(1);
  });
});

describe("IndexBaseChart - klawiatura", () => {
  it("ArrowRight ustawia czynny okres, a Escape przywraca rysunek do stanu sprzed strzałki", () => {
    // Porównanie migawek, bo pytanie brzmi o ZASADĘ: wszystko, co dokłada
    // wskazanie, musi zniknąć. Defekt, który to łapie: prowadnica albo
    // atrybut `data-active` zostawione po Escapie - wykres pokazuje wtedy
    // wskazanie, którego czytelnik już nie ma.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    const przed = container.innerHTML;
    fireEvent.keyDown(box as HTMLElement, { key: "ArrowRight" });
    expect(container.innerHTML).not.toBe(przed);
    expect(container.querySelector("[data-role='active-period']")).not.toBeNull();
    fireEvent.keyDown(box as HTMLElement, { key: "Escape" });
    expect(container.innerHTML).toBe(przed);
  });

  it("Escape przywraca rysunek także po wskazaniu WSKAŹNIKIEM", () => {
    // Druga droga do tego samego stanu. Defekt, który to łapie: stan czynny
    // zapisany przy `pointermove` w innym polu niż przy strzałce - Escape
    // czyści wtedy jedno z dwóch i na rysunku zostaje prowadnica bez dymka
    // albo dymek bez prowadnicy.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']") as HTMLElement;
    const przed = container.innerHTML;
    const hit = container.querySelector("rect.neh-hit") as Element;
    fireEvent.pointerDown(hit, { clientX: 0, clientY: 0 });
    expect(container.innerHTML).not.toBe(przed);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(container.innerHTML).toBe(przed);
  });

  it("ArrowLeft z pustego stanu wchodzi od OSTATNIEGO okresu", () => {
    // Bez tego strzałka „wstecz" na nieużywanym wykresie nie robi nic, więc
    // czytelnik uzna, że klawiatura tu nie działa.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    fireEvent.keyDown(box as HTMLElement, { key: "ArrowLeft" });
    expect(container.querySelector(".neh-tooltip")?.textContent).toContain("2023");
  });

  it("wskazanie nie wychodzi poza oś okresów", () => {
    // Defekt, który to łapie: indeks większy od liczby okresów - dymek bez
    // wierszy albo `undefined` w tytule.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    for (let i = 0; i < OKRESY.length + 4; i++) {
      fireEvent.keyDown(box as HTMLElement, { key: "ArrowRight" });
    }
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).toContain("2023");
    expect(dymek).not.toContain("undefined");
  });

  it("dymek nad okresem bazowym mówi, że tam każda seria ma sto", () => {
    // To jedyne miejsce interakcji, w którym widać, wobec czego czyta się
    // cały wykres - a wszystkie linie mają tam tę samą liczbę, więc bez
    // dopisku wygląda to na przypadek.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    fireEvent.keyDown(box as HTMLElement, { key: "ArrowRight" });
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).toContain("2019");
    expect(dymek).toContain("wiersz bazowy");
  });
});

/* ========================================================================== */
/*  I18N                                                                      */
/* ========================================================================== */

describe("IndexBaseChart - ten sam zestaw, dwa poprawne napisy", () => {
  it("przypisy i podpis bazy są po polsku i po angielsku, a nie po jednemu", () => {
    const pl = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const en = render(<IndexBaseChart config={cfg(BAZA)} lang="en" />);
    const podpisPl =
      pl.container.querySelector("[data-role='index-baseline-label']")?.textContent ?? "";
    const podpisEn =
      en.container.querySelector("[data-role='index-baseline-label']")?.textContent ?? "";
    expect(podpisPl).toBe("Baza: 2019 = 100");
    expect(podpisEn).toBe("Base: 2019 = 100");
    expect(notatki(pl.container).get("axis.unitless")).toContain("bezjednostkowe");
    expect(notatki(en.container).get("axis.unitless")).toContain("carry no unit");
  });

  it("liczby jadą przez Intl: pl-PL rozdziela tysiące TWARDĄ SPACJĄ, en-GB przecinkiem", () => {
    // Defekt, który to łapie: formatowanie po `toFixed` albo `i18n.language`
    // zamiast języka z propsa. Strony publiczne są cache'owane na brzegu, więc
    // język MUSI jechać propsem - inaczej pierwszy czytelnik decyduje, w jakim
    // języku zobaczą wykres wszyscy następni.
    const dane = {
      ...BAZA,
      categories: ["baza", "potem"],
      series: [{ name: "Skok", values: [1, 12345], colorSlot: 1 }],
    };
    const box = (root: HTMLElement): HTMLElement =>
      root.querySelector("[role='img']") as HTMLElement;
    const pl = render(<IndexBaseChart config={cfg(dane)} lang="pl" />);
    fireEvent.keyDown(box(pl.container), { key: "ArrowLeft" });
    // Twarda spacja U+00A0 wpisana WPROST - zwykła spacja przeszłaby cicho.
    expect(pl.container.querySelector(".neh-tooltip")?.textContent).toContain("1 234 500");
    const en = render(<IndexBaseChart config={cfg(dane)} lang="en" />);
    fireEvent.keyDown(box(en.container), { key: "ArrowLeft" });
    expect(en.container.querySelector(".neh-tooltip")?.textContent).toContain("1,234,500");
  });
});

/* ========================================================================== */
/*  UCZCIWOŚĆ - KAŻDE POLE WTEDY I TYLKO WTEDY                                */
/* ========================================================================== */

describe("IndexBaseChart - uczciwość: pole modelu wypisuje się wtedy i tylko wtedy", () => {
  it("przy zdrowym arkuszu nie ma ANI JEDNEGO przypisu uczciwości", () => {
    // Punkt odniesienia dla wszystkich sprawdzeń niżej. Bez niego każdy z nich
    // przeszedłby na renderze, który wypisuje wszystko zawsze.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    expect(klucze(container).filter((k) => k.startsWith("honesty."))).toEqual([]);
  });

  it("baseInRangeOk: żądanie bazy spoza osi jest ZGŁASZANE, bo podpis mówi o innym okresie", () => {
    // Baza podmieniona po cichu znaczy, że podpis „= 100" nazywa okres, którego
    // autor nie wybrał - a tego nie widać nigdzie na rysunku.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" baseAt={99} />);
    const tresc = notatki(container).get("honesty.baseInRangeOk") ?? "";
    expect(tresc).toContain("2023");
    expect(tresc).not.toContain("{{");
  });

  it("baseNamedOk: baza bez nazwy jest zgłaszana, bo podpis urywa się na „= 100”", () => {
    const { container } = render(
      <IndexBaseChart
        config={cfg({ ...BAZA, categories: ["", "2020", "2021", "2022", "2023"] })}
        lang="pl"
      />,
    );
    expect(klucze(container)).toContain("honesty.baseNamedOk");
    const { container: zdrowy } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    expect(klucze(zdrowy)).not.toContain("honesty.baseNamedOk");
  });

  it("baseUsableOk: agregat wymienia serie, których na rysunku nie ma, z NAZWY", () => {
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          ...BAZA,
          series: [
            { name: "Eksport", values: [200, 210, 240, 260, 300], colorSlot: 1 },
            { name: "Deficyt", values: [0, 2.1, 2, 2.2, 2.3], colorSlot: 2 },
          ],
        })}
        lang="pl"
      />,
    );
    const tresc = notatki(container).get("honesty.baseUsableOk") ?? "";
    expect(tresc).toContain("Deficyt");
    expect(tresc).not.toContain("Eksport");
  });

  it("baseTypicalOk: rok kryzysowy jako baza wyolbrzymia cały indeks i jest zgłaszany", () => {
    // Odczyt „+400%" byłby wtedy artefaktem wyboru bazy, a nie zdarzeniem
    // w danych. Dane wprost z testu modelu, żeby oba pliki mówiły o tym samym.
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          ...BAZA,
          categories: ["a", "b", "c", "d", "e", "f"],
          series: [{ name: "Ruch", values: [100, 98, 20, 99, 101, 102], colorSlot: 1 }],
        })}
        lang="pl"
        baseAt={2}
      />,
    );
    expect(notatki(container).get("honesty.baseTypicalOk") ?? "").toContain("Ruch");
  });

  it("baseTypicalOk MILCZY przy szeregu silnie rosnącym, choć baza jest daleko od mediany", () => {
    // Druga połowa poprzedniego testu i ważniejsza od niego: ostrzeżenie,
    // które widać zawsze, uczy ignorowania wszystkich ostrzeżeń. Dla serii
    // 100, 200, 400, 800, 1600 pierwszy okres jest bazą całkowicie poprawną.
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          ...BAZA,
          categories: ["a", "b", "c", "d", "e"],
          series: [{ name: "Wzrost", values: [100, 200, 400, 800, 1600], colorSlot: 1 }],
        })}
        lang="pl"
      />,
    );
    expect(klucze(container)).not.toContain("honesty.baseTypicalOk");
  });

  it("indexRepresentableOk: punkt spoza podwójnej precyzji jest ZGŁOSZONY, a nie postawiony na dnie osi", () => {
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          ...BAZA,
          categories: ["baza", "potem"],
          series: [{ name: "Mikrobaza", values: [1e-320, 1e10], colorSlot: 1 }],
        })}
        lang="pl"
      />,
    );
    expect(notatki(container).get("honesty.indexRepresentableOk") ?? "").toContain("Mikrobaza");
    // Punkt naprawdę wypadł: została jedna kropka, nie dwie.
    expect(punkty(container, 0)).toHaveLength(1);
  });

  it("signStableOk: szereg przechodzący przez zero jest zgłaszany, nie ukrywany", () => {
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          ...BAZA,
          categories: ["I", "II", "III"],
          series: [{ name: "Marża", values: [4, -2, 3], colorSlot: 1 }],
        })}
        lang="pl"
      />,
    );
    expect(notatki(container).get("honesty.signStableOk") ?? "").toContain("Marża");
  });

  it("spreadOk: gdy wszystkie linie leżą na setce, render to mówi", () => {
    // Rysunek pokazuje wtedy definicję indeksu, a nie dane - i to jest
    // informacja na jedno zdanie, nie na wykres.
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          ...BAZA,
          categories: ["I", "II", "III"],
          series: [
            { name: "A", values: [5, 5, 5], colorSlot: 1 },
            { name: "B", values: [90, 90, 90], colorSlot: 2 },
          ],
        })}
        lang="pl"
      />,
    );
    expect(klucze(container)).toContain("honesty.spreadOk");
    expect(klucze(container)).toContain("reading.noSpread");
    // Linia leżąca DOKŁADNIE na linii odniesienia jest niewidoczna, więc
    // każda taka seria dostaje własny przypis z nazwą.
    expect(notatki(container).get("note.flat.0") ?? "").toContain("A");
    expect(notatki(container).get("note.flat.1") ?? "").toContain("B");
  });

  it("declaredSampleOk: rozjazd podpisanego n z liczbą OKRESÓW Z POMIAREM podaje obie liczby", () => {
    // Dwa defekty naraz. Pierwszy: pominięta wstawka - i18next zostawia wtedy
    // w zdaniu surowe `{{actual}}` i żadna bramka tego nie widzi. Drugi
    // i groźniejszy: podstawienie pod `{{actual}}` liczby OKRESÓW zamiast
    // okresów Z POMIAREM. Dlatego w środku szeregu jest luka - okresów jest
    // pięć, zmierzono w czterech, a zdanie ma mówić o czterech.
    const zLuka = {
      ...BAZA,
      sampleSize: 9,
      series: [{ name: "Eksport", values: [200, null, 240, 260, 300], colorSlot: 1 }],
    };
    expect(indexBaseModelFromConfig(cfg(zLuka)).periodCount).toBe(5);
    const { container } = render(<IndexBaseChart config={cfg(zLuka)} lang="pl" />);
    const tresc = notatki(container).get("honesty.declaredSampleOk") ?? "";
    expect(tresc).toContain("n = 9");
    expect(tresc).toContain("jest 4");
    expect(tresc).not.toContain("{{");
  });

  it("pointsInPeriodsOk: liczba bez swojego okresu na osi jest policzona, nie przemilczana", () => {
    // Konfiguracja składana RĘCZNIE na kopii wyniku parsera, i to jest tu
    // konieczne: `parseChartSeries` przycina `values` do liczby kategorii,
    // więc tą drogą arkusz z nadmiarem liczb nigdy nie dojdzie do modelu.
    // Sam model liczy nadmiar poprawnie i render musi go umieć wypisać.
    const podstawa = cfg({ ...BAZA, categories: ["I", "II"] });
    const zNadmiarem: ChartConfig = {
      ...podstawa,
      series: [{ name: "Dłuższa", values: [10, 20, 30, 40], colorSlot: 1 }],
    };
    const { container } = render(<IndexBaseChart config={zNadmiarem} lang="pl" />);
    const tresc = notatki(container).get("honesty.pointsInPeriodsOk") ?? "";
    expect(tresc).toContain("2");
    expect(tresc).not.toContain("{{");
  });
});

/* ========================================================================== */
/*  OBSERWACJE O FORMIE                                                       */
/* ========================================================================== */

describe("IndexBaseChart - obserwacje o formie", () => {
  it("seriesDropped podaje LICZBĘ serii, których nie ma na rysunku", () => {
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          ...BAZA,
          series: [
            { name: "Eksport", values: [200, 210, 240, 260, 300], colorSlot: 1 },
            { name: "Deficyt", values: [0, 2.1, 2, 2.2, 2.3], colorSlot: 2 },
          ],
        })}
        lang="pl"
      />,
    );
    const tresc = notatki(container).get("reading.seriesDropped") ?? "";
    expect(tresc.startsWith("1 ")).toBe(true);
    expect(tresc).not.toContain("{{");
  });

  it("tooManySeries podaje próg zestawu bezpiecznego dla daltonizmu", () => {
    const siedem = Array.from({ length: 7 }, (_, i) => ({
      name: `S${i + 1}`,
      values: [10, 11 + i, 12 + i],
      colorSlot: (i % 8) + 1,
    }));
    const { container } = render(
      <IndexBaseChart
        config={cfg({ ...BAZA, categories: ["a", "b", "c"], series: siedem })}
        lang="pl"
      />,
    );
    const tresc = notatki(container).get("reading.tooManySeries") ?? "";
    expect(tresc).toContain("6");
    expect(tresc).not.toContain("{{");
  });

  it("baseUnusable jest JEDYNĄ obserwacją, gdy nie ma czego narysować", () => {
    // Rysunku nie ma, więc lista pozostałych obserwacji byłaby szumem wokół
    // rzeczy najważniejszej.
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          ...BAZA,
          categories: ["I", "II"],
          series: [{ name: "Zero", values: [0, 5], colorSlot: 1 }],
        })}
        lang="pl"
      />,
    );
    const czytania = klucze(container).filter((k) => k.startsWith("reading."));
    expect(czytania).toEqual(["reading.baseUnusable"]);
    expect(all(container, "[data-role='series-line']")).toHaveLength(0);
  });

  it("porada bez treści w słowniku daje MILCZENIE, a nie surowy klucz na stronie", () => {
    // `scaleComparable` jest poradą modelu, dla której słownik nie ma zdania
    // ani po polsku, ani po angielsku. `t()` zwraca wtedy sam klucz, więc pod
    // opublikowanym wpisem stanąłby napis „indexBase.reading.scaleComparable".
    // Ten test pilnuje, żeby render milczał do czasu dopisania treści.
    const podobne = cfg({
      ...BAZA,
      categories: ["I", "II", "III"],
      series: [
        { name: "A", values: [100, 110, 120], colorSlot: 1 },
        { name: "B", values: [90, 99, 95], colorSlot: 2 },
      ],
    });
    expect(indexBaseFormAdvice(indexBaseModelFromConfig(podobne))).toContain("scaleComparable");
    const { container } = render(<IndexBaseChart config={podobne} lang="pl" />);
    expect(container.textContent ?? "").not.toContain("indexBase.");
    expect(klucze(container)).not.toContain("reading.scaleComparable");
  });
});

/* ========================================================================== */
/*  PRZYPADKI BRZEGOWE                                                        */
/* ========================================================================== */

describe("IndexBaseChart - dane z bazy nie wywracają rysunku", () => {
  it("pusty blok nie rysuje nic i nie ostrzega o niczym", () => {
    // Pusty blok w edytorze nie jest błędem doboru formy, a lista ostrzeżeń
    // pod pustym wykresem uczy ignorowania ostrzeżeń.
    const { container } = render(<IndexBaseChart config={cfg({})} lang="pl" />);
    expect(container.innerHTML).toBe("");
  });

  it("same luki to brak danych, a nie szereg zerowy", () => {
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          ...BAZA,
          categories: ["I", "II"],
          series: [{ name: "Pusta", values: [null, null], colorSlot: 1 }],
        })}
        lang="pl"
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("jeden okres rysuje definicję indeksu i mówi o tym wprost", () => {
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          ...BAZA,
          categories: ["2020"],
          series: [
            { name: "A", values: [5], colorSlot: 1 },
            { name: "B", values: [900], colorSlot: 2 },
          ],
        })}
        lang="pl"
      />,
    );
    expect(klucze(container)).toContain("reading.shortSeries");
    // Obie serie mają tam dokładnie sto, czyli leżą na linii odniesienia.
    const yBazy = num(linia(container), "y1");
    expect(num(punkty(container, 0)[0], "cy")).toBeCloseTo(yBazy, 6);
    expect(num(punkty(container, 1)[0], "cy")).toBeCloseTo(yBazy, 6);
  });

  it("wartości skrajne nie wypuszczają NaN ani nieskończoności na stronę", () => {
    // Bramka `blockMatrix` czyta `textContent` bloków właśnie na te napisy.
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          ...BAZA,
          categories: ["I", "II", "III"],
          series: [
            { name: "Kres", values: [1e308, -1e308, 1e-308], colorSlot: 1 },
            { name: "Mały", values: [1e-308, 1e308, 0], colorSlot: 2 },
          ],
        })}
        lang="pl"
      />,
    );
    const box = container.querySelector<HTMLElement>("[role='img']");
    fireEvent.keyDown(box as HTMLElement, { key: "ArrowRight" });
    const tresc = container.textContent ?? "";
    expect(tresc).not.toContain("NaN");
    expect(tresc).not.toContain("Infinity");
    expect(tresc).not.toContain("∞");
    expect(tresc).not.toContain("undefined");
    // Żadna współrzędna nie może być nieliczbą - punkt z NaN znika z SVG bez
    // śladu, czyli kłamie o liczbie pomiarów.
    for (const p of all(container, "circle[data-role='series-point']")) {
      expect(Number.isFinite(num(p, "cx"))).toBe(true);
      expect(Number.isFinite(num(p, "cy"))).toBe(true);
    }
  });

  it("kolejność serii jest kolejnością arkusza, a nie posortowaną", () => {
    // Sekcja 4 wymaga legendy w kolejności szeregów; przestawienie serii
    // rozjechałoby legendę z etykietami przy końcach linii.
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          ...BAZA,
          series: [
            { name: "Mała", values: [2, 2.1, 2, 2.2, 2.3], colorSlot: 2 },
            { name: "Duża", values: [200, 210, 240, 260, 300], colorSlot: 1 },
          ],
        })}
        lang="pl"
      />,
    );
    expect(all(container, "[data-role='series-end-label']").map((e) => e.textContent)).toEqual([
      "Mała",
      "Duża",
    ]);
  });
});

/* ========================================================================== */
/*  ŻADEN NAPIS NIE WYCHODZI SUROWY                                           */
/* ========================================================================== */

/**
 * ARKUSZE, KTÓRE URUCHAMIAJĄ WSZYSTKIE ZDANIA TEGO RENDERU - po jednym na
 * każdą ścieżkę słownika, którą render umie zawołać.
 */
const ARKUSZE: { nazwa: string; dane: Record<string, Json> }[] = [
  { nazwa: "zdrowy", dane: BAZA },
  { nazwa: "z tytułem", dane: { ...BAZA, title: "Tempo eksportu" } },
  {
    nazwa: "podpisane n obok liczby okresów z pomiarem",
    dane: { ...BAZA, sampleSize: 9, series: [{ name: "E", values: [200, null, 240, 260, 300] }] },
  },
  { nazwa: "baza bez nazwy", dane: { ...BAZA, categories: ["", "b", "c", "d", "e"] } },
  { nazwa: "baza zerowa", dane: { ...BAZA, series: [{ name: "Zero", values: [0, 1, 2, 3, 4] }] } },
  { nazwa: "baza ujemna", dane: { ...BAZA, series: [{ name: "Neg", values: [-5, 1, 2, 3, 4] }] } },
  {
    nazwa: "baza pusta",
    dane: { ...BAZA, series: [{ name: "Brak", values: [null, 1, 2, 3, 4] }] },
  },
  {
    nazwa: "iloraz poza precyzją",
    dane: { ...BAZA, categories: ["I", "II"], series: [{ name: "M", values: [1e-320, 1e10] }] },
  },
  {
    nazwa: "szereg przez zero",
    dane: {
      ...BAZA,
      categories: ["I", "II", "III"],
      series: [{ name: "Marża", values: [4, -2, 3] }],
    },
  },
  {
    nazwa: "wszystko na setce",
    dane: {
      ...BAZA,
      categories: ["I", "II", "III"],
      series: [
        { name: "A", values: [5, 5, 5] },
        { name: "B", values: [9, 9, 9] },
      ],
    },
  },
  {
    nazwa: "baza odstająca",
    dane: {
      ...BAZA,
      categories: ["a", "b", "c", "d", "e", "f"],
      series: [{ name: "Ruch", values: [100, 98, 20, 99, 101, 102] }],
    },
  },
  {
    nazwa: "siedem serii",
    dane: {
      ...BAZA,
      categories: ["a", "b", "c"],
      series: Array.from({ length: 7 }, (_, i) => ({
        name: `S${i}`,
        values: [10, 11 + i, 12 + i],
      })),
    },
  },
  {
    nazwa: "jeden okres",
    dane: { ...BAZA, categories: ["2020"], series: [{ name: "A", values: [5] }] },
  },
];

describe("IndexBaseChart - wstawka podana, klucz istniejący", () => {
  it("na żadnym arkuszu i w żadnym języku nie wychodzi ani „{{”, ani nazwa klucza", () => {
    // DWA DEFEKTY NARAZ, oba niewidoczne dla wszystkich bramek i18n.
    // Pominięta wstawka zostaje na stronie SUROWA („n = {{declared}}”),
    // a klucz bez treści w słowniku wychodzi jako własna nazwa
    // („indexBase.reading.scaleComparable”). Jedno i drugie widać wyłącznie
    // w `textContent` gotowego rysunku, i wyłącznie wtedy, gdy zdanie w ogóle
    // się postawi - dlatego arkusze wyżej uruchamiają każdą ścieżkę słownika,
    // a baza jedzie także poza zakresem osi (dociśnięcie + zgłoszenie).
    for (const { nazwa, dane } of ARKUSZE) {
      for (const lang of ["pl", "en"] as const) {
        for (const baza of [undefined, 2, 99]) {
          const { container } = render(
            <IndexBaseChart config={cfg(dane)} lang={lang} baseAt={baza} />,
          );
          const gdzie = `${nazwa} / ${lang} / baseAt=${String(baza)}`;
          const tresc = container.textContent ?? "";
          expect(tresc, gdzie).not.toContain("{{");
          expect(tresc, gdzie).not.toContain("indexBase.");
          expect(tresc, gdzie).not.toContain("a11y.");
          // `aria-label` nie jest częścią `textContent`, a czyta go czytnik
          // ekranu - surowa wstawka schowałaby się tam przed każdym testem
          // patrzącym na tekst.
          const nazwaDostepna =
            container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
          expect(nazwaDostepna, gdzie).not.toContain("{{");
          expect(nazwaDostepna, gdzie).not.toContain("indexBase.");
        }
      }
    }
  });
});

/* ========================================================================== */
/*  NAZWA SERII PRZY KOŃCU LINII                                              */
/* ========================================================================== */

describe("IndexBaseChart - etykieta końca linii zostaje w płycie", () => {
  /** Prawa krawędź napisu, mierzona TĄ SAMĄ heurystyką, z której render liczy
   *  margines - innej miary w silniku nie ma, a marginesu nie wolno sprawdzać
   *  linijką grubszą niż ta, którą go wyznaczono. */
  const prawaKrawedz = (el: Element): number =>
    // Mierzony jest WIDOCZNY napis, czyli pierwszy węzeł tekstowy: pod `<text>`
    // stoi jeszcze `<title>` z pełną nazwą, którego nikt nie rysuje, a który
    // wchodzi do `textContent` i zawyżyłby pomiar.
    num(el, "x") + estimateLabelWidth(el.firstChild?.textContent ?? "", FONT_AXIS);

  const zNazwa = (name: string): ChartConfig =>
    cfg({ ...BAZA, series: [{ name, values: [200, 210, 240, 260, 300], colorSlot: 1 }] });

  it("nazwa DOWOLNEJ długości kończy się przed prawą krawędzią rysunku", () => {
    // DEFEKT ZMIERZONY PRZED POPRAWKĄ: margines prawy ma sufit
    // (`CATEGORY_LABEL_MAX_WIDTH`), a napis stawiany był w CAŁOŚCI - przy
    // nazwie z pięćdziesięciu znaków prawa krawędź wypadała na 894 px przy
    // rysunku szerokim na 720 px, czyli 174 px za płytą i bez żadnego znaku,
    // że coś ucięto. Sufitu marginesu nie wolno podnieść, bo margines odbiera
    // miejsce POLU RYSUNKU, więc jedynym wyjściem jest ucięcie z podpowiedzią.
    for (const dlugosc of [1, 10, 24, 25, 50, 120]) {
      const nazwa = "N".repeat(dlugosc);
      const { container } = render(<IndexBaseChart config={zNazwa(nazwa)} lang="pl" />);
      const svg = container.querySelector("svg") as Element;
      const etykieta = container.querySelector("[data-role='series-end-label']") as Element;
      expect(prawaKrawedz(etykieta), `${dlugosc} znaków`).toBeLessThanOrEqual(num(svg, "width"));
    }
  });

  it("ucięta nazwa niesie wielokropek i PEŁNĄ treść w <title>", () => {
    // Wielokropek bez podpowiedzi jest zakazany (sekcja 4): „Eksport towarów
    // i usł…” i „Eksport towarów i usługi” wyglądają identycznie, a to dwie
    // różne serie.
    const pelna = "Eksport towarów i usług poza Unię Europejską";
    const { container } = render(<IndexBaseChart config={zNazwa(pelna)} lang="pl" />);
    const etykieta = container.querySelector("[data-role='series-end-label']") as Element;
    const napis = etykieta.firstChild?.textContent ?? "";
    expect(napis.endsWith("…")).toBe(true);
    expect(pelna.startsWith(napis.slice(0, -1))).toBe(true);
    expect(etykieta.querySelector("title")?.textContent).toBe(pelna);
  });

  it("nazwa mieszcząca się NIE dostaje <title>, bo nie ma czego podpowiadać", () => {
    // Druga połowa reguły: `<title>` powtarzający widoczny napis dokłada
    // czytnikowi ekranu drugą kopię tej samej nazwy.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const etykiety = all(container, "[data-role='series-end-label']");
    expect(etykiety).toHaveLength(2);
    for (const e of etykiety) expect(e.querySelector("title")).toBeNull();
  });

  it("rozsunięty blok etykiet zostaje W POLU RYSUNKU, a nie na przypisach pod nim", () => {
    // ZMIERZONY DEFEKT: cztery serie kończące się na 100,1..100,4 (czyli
    // cztery linie schodzące się w jeden punkt u dna osi) przy wysokości
    // 200 px - rozsuwanie w dół stawiało ostatnią etykietę na 218 px, czyli
    // 18 px POD płótnem, wprost na liście przypisów. `overflow: visible` na
    // SVG znaczy, że taki napis się RYSUJE - nie jest przycięty, tylko leży
    // na cudzym tekście.
    const zbiegajace = cfg({
      categories: ["a", "b", "c"],
      height: 200,
      series: [100.1, 100.2, 100.3, 100.4].map((v, i) => ({
        name: `S${i}`,
        values: [100, 300, v],
        colorSlot: i + 1,
      })),
      animate: false,
    });
    const { container } = render(<IndexBaseChart config={zbiegajace} lang="pl" />);
    const hit = container.querySelector("rect.neh-hit") as Element;
    const gora = num(hit, "y");
    const dol = gora + num(hit, "height");
    const y = all(container, "[data-role='series-end-label']").map((e) => num(e, "y") - 3.5);
    expect(y).toHaveLength(4);
    for (const v of y) {
      expect(v).toBeGreaterThanOrEqual(gora);
      expect(v).toBeLessThanOrEqual(dol);
    }
    // Przesunięcie jest WSPÓLNE, więc prześwit i kolejność serii zostają.
    const posortowane = [...y].sort((a, b) => a - b);
    for (let i = 1; i < posortowane.length; i++) {
      expect(posortowane[i] - posortowane[i - 1]).toBeCloseTo(13, 6);
    }
  });

  it("etykiety końców rozsuwają się o wiersz DOPIERO przy kolizji", () => {
    // Rozsunięcie profilaktyczne odrywałoby etykietę od linii, którą nazywa;
    // brak rozsunięcia przy kolizji dawałby dwa napisy jeden na drugim.
    const blisko = cfg({
      categories: ["a", "b", "c"],
      height: 260,
      series: [
        { name: "S1", values: [100, 300, 40], colorSlot: 1 },
        { name: "S2", values: [100, 300, 41], colorSlot: 2 },
        { name: "S3", values: [100, 300, 42], colorSlot: 3 },
      ],
      animate: false,
    });
    const { container } = render(<IndexBaseChart config={blisko} lang="pl" />);
    const y = all(container, "[data-role='series-end-label']")
      .map((e) => num(e, "y"))
      .sort((a, b) => a - b);
    expect(y).toHaveLength(3);
    for (let i = 1; i < y.length; i++) expect(y[i] - y[i - 1]).toBeGreaterThanOrEqual(13);
    // A przy końcach oddalonych od siebie etykieta stoi DOKŁADNIE na
    // wysokości ostatniego pomiaru swojej serii.
    const { container: daleko } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    for (const e of all(daleko, "[data-role='series-end-label']")) {
      const seria = e.getAttribute("data-series") ?? "";
      const kropki = punkty(daleko, Number(seria));
      expect(num(e, "y") - 3.5).toBeCloseTo(num(kropki[kropki.length - 1], "cy"), 6);
    }
  });
});

/* ========================================================================== */
/*  POMIAR, KTÓREGO NIE NIESIE ODCINEK                                        */
/* ========================================================================== */

describe("IndexBaseChart - każdy pomiar ma na rysunku swój nośnik", () => {
  /** Trzydzieści okresów, czyli POWYŻEJ progu rysowania kropek - dokładnie
   *  tam, gdzie samotny pomiar nie ma czym się pokazać. */
  const DUZO = Array.from({ length: 30 }, (_, i) => `R${i}`);
  const rzadka = (indeksy: number[]): ChartConfig =>
    cfg({
      categories: DUZO,
      series: [
        {
          name: "Rzadka",
          values: DUZO.map((_, i) => (indeksy.includes(i) ? 100 + i : null)),
          colorSlot: 1,
        },
      ],
      animate: false,
    });

  it("pomiar otoczony lukami dostaje marker, choć kropki są wyłączone", () => {
    // ZMIERZONY DEFEKT: dla trzydziestu okresów i pomiarów w okresie 0 i 15
    // ścieżka serii wychodziła jako „M33.0 296.0 M360.9 12.0”, a znaczników
    // było zero. Ścieżka z samym `M` nie rysuje NICZEGO, więc czytelnik
    // widział pusty wykres przy danych, które są - to samo kłamstwo co seria
    // zniknięta bez słowa, tylko o pojedynczej obserwacji.
    const { container } = render(<IndexBaseChart config={rzadka([0, 15])} lang="pl" />);
    const d = container.querySelector("[data-role='series-line']")?.getAttribute("d") ?? "";
    // Warunek, z którego wynika cały ten przypadek: linia NIE MA ani jednego
    // odcinka, bo nie ma dwóch pomiarów obok siebie.
    expect(d).not.toContain("L");
    expect(punkty(container, 0)).toHaveLength(2);
  });

  it("marker samotnego pomiaru stoi dokładnie nad swoim okresem", () => {
    // Marker postawiony obok okresu kłamałby o dacie pomiaru - a to jedyny
    // znacznik, jaki ten pomiar ma.
    // Pomiar w okresie bazowym MUSI być, inaczej cała seria jest odrzucona
    // i pytanie o marker nie ma sensu.
    const { container } = render(<IndexBaseChart config={rzadka([0, 15])} lang="pl" />);
    const hit = container.querySelector("rect.neh-hit") as Element;
    const kropki = punkty(container, 0);
    expect(kropki).toHaveLength(2);
    expect(num(kropki[1], "cx")).toBeCloseTo(num(hit, "x") + (num(hit, "width") * 15) / 29, 6);
  });

  it("pomiar NIESIONY przez odcinek nie dostaje osobnego markera", () => {
    // Druga połowa reguły. Marker przy każdym pomiarze powyżej progu zlewa
    // trzydzieści kropek w sznur paciorków, w którym nie widać już linii -
    // dlatego próg istnieje i nie wolno go obchodzić „na wszelki wypadek”.
    const { container } = render(<IndexBaseChart config={rzadka([0, 1, 2, 15])} lang="pl" />);
    const d = container.querySelector("[data-role='series-line']")?.getAttribute("d") ?? "";
    expect(d).toContain("L");
    const kropki = punkty(container, 0);
    expect(kropki).toHaveLength(1);
    expect(kropki[0].getAttribute("data-lone")).toBe("true");
  });

  it("poniżej progu kropek rysowany jest KAŻDY pomiar", () => {
    // Trzecia połowa: przy pięciu okresach kropki są włączone i samotność
    // pomiaru niczego nie zmienia - a marker nie może się zdublować.
    const { container } = render(
      <IndexBaseChart
        config={cfg({ ...BAZA, series: [{ name: "E", values: [200, null, 240, null, 300] }] })}
        lang="pl"
      />,
    );
    expect(punkty(container, 0)).toHaveLength(3);
  });

  it("marker i linia mają wymiary także BEZ arkusza stylów", () => {
    // `r` nie ma domyślnej wartości różnej od zera: `<circle>` bez `r` jest
    // okręgiem o promieniu ZERO, czyli niczym. Właściwe wymiary niosą tokeny
    // (`--chart-dot`, `--chart-stroke`) przez klasy `.neh-dot` i `.neh-line`,
    // ale do chwili, w której arkusz zadziała - pierwsza klatka odpowiedzi
    // z brzegu, wydruk bez CSS, zrzut czytający sam kod - rysunek stoi na
    // atrybutach. Bez nich znika marker, a z nim cały ciąg jednopunktowy.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const kropka = punkty(container, 0)[0];
    expect(Number(kropka.getAttribute("r"))).toBeGreaterThan(0);
    expect(Number(kropka.getAttribute("stroke-width"))).toBeGreaterThan(0);
    const linia = container.querySelector("[data-role='series-line']") as Element;
    expect(Number(linia.getAttribute("stroke-width"))).toBeGreaterThan(0);
  });
});

/* ========================================================================== */
/*  ETYKIETY OKRESÓW                                                          */
/* ========================================================================== */

describe("IndexBaseChart - etykiety okresów nie leżą jedna na drugiej", () => {
  /** Miejsce zajęte przez napis, liczone Z KOTWICĄ - skrajne etykiety nie są
   *  wyśrodkowane na swoim okresie. */
  function przedzialy(root: HTMLElement): { napis: string; od: number; do: number }[] {
    return all(root, "[data-role='period'],[data-role='base-period']").map((e) => {
      const napis = e.textContent ?? "";
      const w = estimateLabelWidth(napis, FONT_AXIS);
      const x = num(e, "x");
      const kotwica = e.getAttribute("text-anchor");
      const od = kotwica === "start" ? x : kotwica === "end" ? x - w : x - w / 2;
      return { napis, od, do: od + w };
    });
  }

  const bezKolizji = (root: HTMLElement): void => {
    const p = przedzialy(root);
    expect(p.length).toBeGreaterThan(1);
    for (let i = 1; i < p.length; i++) {
      expect(p[i].od, `„${p[i - 1].napis}” obok „${p[i].napis}”`).toBeGreaterThanOrEqual(
        p[i - 1].do,
      );
    }
  };

  it("etykieta ostatniego okresu nie nachodzi na przerzedzoną przed nią", () => {
    // ZMIERZONY DEFEKT: trzydzieści okresów „R0”..„R29”, krok przerzedzania 2,
    // więc podpisane były wszystkie parzyste PLUS ostatni (29) - „R28” i „R29”
    // nachodziły na siebie o 7,7 px. Ta sama reguła („ostatnia rysowana i
    // koniec osi muszą być od siebie oddalone”) stoi w `visibleIndices`
    // w `labels.ts`; ten render liczył przerzedzenie sam i o niej nie wiedział.
    const okresy = Array.from({ length: 30 }, (_, i) => `R${i}`);
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          categories: okresy,
          series: [{ name: "A", values: okresy.map((_, i) => 100 + i), colorSlot: 1 }],
          animate: false,
        })}
        lang="pl"
        baseAt={3}
      />,
    );
    bezKolizji(container);
    // Skrajne okresy zostają podpisane ZAWSZE - bez nich nie wiadomo, jaki
    // odcinek czasu pokazuje rysunek.
    const napisy = przedzialy(container).map((p) => p.napis);
    expect(napisy[0]).toBe("R0");
    expect(napisy[napisy.length - 1]).toBe("R29");
  });

  it("etykieta bazowa USTĘPUJE skrajnej, gdy się nie mieszczą - i nadal jest nazwana", () => {
    // ZMIERZONY DEFEKT: dwanaście okresów „Kwartał 1 roku 2020”... z bazą na
    // drugim okresie - napisy „Kwartał 1 roku 2020” i „Kwartał 2 roku 2021”
    // stały jeden na drugim z przesunięciem czterech pikseli, czyli nie dało
    // się przeczytać ŻADNEGO z nich. Etykieta podpisana, ale nieczytelna, nie
    // jest podpisana: jest plamą, która zabiera też tę drugą.
    const okresy = Array.from({ length: 12 }, (_, i) => `Kwartał ${i + 1} roku 20${20 + i}`);
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          categories: okresy,
          series: [{ name: "A", values: okresy.map((_, i) => 100 + i), colorSlot: 1 }],
          animate: false,
        })}
        lang="pl"
        baseAt={1}
      />,
    );
    bezKolizji(container);
    expect(container.querySelector("[data-role='base-period']")).toBeNull();
    // ...a czytelnik nadal wie, który okres jest bazą: podpis linii
    // odniesienia go NAZYWA, a pionowa kreska POKAZUJE, gdzie stoi.
    const podpis = container.querySelector("[data-role='index-baseline-label']")?.textContent ?? "";
    expect(podpis).toContain(okresy[1]);
    const znacznik = container.querySelector("[data-role='base-period-marker']");
    expect(znacznik).not.toBeNull();
    expect(num(znacznik as Element, "x1")).toBeCloseTo(num(punkty(container, 0)[1], "cx"), 6);
  });

  it("gdy wszystko się mieści, podpisany jest KAŻDY okres, a bazowy jest wyróżniony", () => {
    // Druga połowa: plan, który przerzedza zawsze, zabierałby etykiety także
    // z osi, na której nic się nie stykało.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" baseAt={2} />);
    expect(przedzialy(container).map((p) => p.napis)).toEqual(OKRESY);
    const bazowa = container.querySelector("[data-role='base-period']") as Element;
    expect(bazowa.textContent).toBe("2021");
    expect(bazowa.getAttribute("font-weight")).toBe("600");
  });
});

/* ========================================================================== */
/*  WSKAŹNIK I WYGASZANIE WSKAZANIA                                           */
/* ========================================================================== */

/** happy-dom nie mierzy elementów, więc bez podmiany prostokąta każdy
 *  `pointermove` trafia w ścieżkę „element niezmierzony". */
function stubPlotRect(hit: Element): { hit: Element; x: number; w: number; y: number } {
  const x = num(hit, "x");
  const y = num(hit, "y");
  const width = num(hit, "width");
  const height = num(hit, "height");
  Object.defineProperty(hit, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x,
      y,
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
      width,
      height,
      toJSON: () => ({}),
    }),
  });
  return { hit, x, w: width, y };
}

describe("IndexBaseChart - wskazanie wchodzi i wychodzi bez śladu", () => {
  it("wskaźnik wybiera okres, NAD którym stoi, a nie pierwszy z osi", () => {
    // Defekt, który to łapie: przypisanie po środkach pasm zamiast po
    // krawędziach. Punkty wykresu liniowego leżą na krawędziach pola
    // (odstępów jest n-1), więc trzy czwarte szerokości to czwarty z pięciu
    // okresów, a nie czwarte pasmo z pięciu.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const { hit, x, w, y } = stubPlotRect(container.querySelector("rect.neh-hit") as Element);
    fireEvent.pointerMove(hit, { clientX: x + w * 0.75, clientY: y + 10 });
    expect(container.querySelector(".neh-tooltip")?.textContent).toContain("2022");
  });

  it("element NIEZMIERZONY nie zgaduje okresu na oślep", () => {
    // `pointerToPlot` oddaje wtedy `null` (prostokąt o zerowej szerokości -
    // element schowany albo jeszcze niezmierzony), a render bierze pierwszy
    // okres. Kłamstwem byłoby dopiero `Infinity` po dzieleniu przez zero,
    // które po zaokrągleniu wygląda jak prawdziwy indeks.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const hit = container.querySelector("rect.neh-hit") as Element;
    fireEvent.pointerDown(hit, { clientX: 500, clientY: 100 });
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).toContain("2019");
    expect(dymek).not.toContain("undefined");
    expect(dymek).not.toContain("NaN");
  });

  it("zjazd MYSZĄ gasi dymek, a zejście PALCA go zostawia", () => {
    // Palec schodzi z ekranu po każdym stuknięciu, więc gaszenie na
    // `pointerleave` zabierałoby dotykowemu czytelnikowi dymek natychmiast po
    // jego otwarciu; gasi go stuknięcie poza wykresem.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const hit = container.querySelector("rect.neh-hit") as Element;
    fireEvent.pointerDown(hit, { clientX: 0, clientY: 0, pointerType: "touch" });
    fireEvent.pointerLeave(hit, { pointerType: "touch" });
    expect(container.querySelector("[data-role='active-period']")).not.toBeNull();
    fireEvent.pointerLeave(hit, { pointerType: "mouse" });
    expect(container.querySelector("[data-role='active-period']")).toBeNull();
  });

  it("utrata ogniska gasi wskazanie", () => {
    // Wskazanie zostawione po odejściu ogniska pokazuje okres, którego
    // czytelnik już nie wybiera - a klawiatura nie ma jak go zdjąć, bo
    // strzałki lecą już gdzie indziej.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']") as HTMLElement;
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(container.querySelector("[data-role='active-period']")).not.toBeNull();
    fireEvent.blur(box);
    expect(container.querySelector("[data-role='active-period']")).toBeNull();
  });

  it("klawisz spoza obsługi nie rusza rysunku ani go nie blokuje", () => {
    // Defekt, który to łapie: `preventDefault` na wszystkim, co przyjdzie -
    // wtedy Tab przestaje wyprowadzać ognisko z wykresu i czytelnik
    // klawiatury zostaje w nim uwięziony.
    const { container } = render(<IndexBaseChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']") as HTMLElement;
    const przed = container.innerHTML;
    const zdarzenie = fireEvent.keyDown(box, { key: "Tab" });
    expect(zdarzenie).toBe(true);
    expect(container.innerHTML).toBe(przed);
  });
});

/* ========================================================================== */
/*  WCZESNE WYJŚCIE NIE GUBI PRZYPISÓW                                        */
/* ========================================================================== */

describe("IndexBaseChart - brak rysunku nie znaczy brak zastrzeżenia", () => {
  it("pusta seria z bezimiennym okresem bazowym nadal mówi, czego brakuje", () => {
    // Ten sam defekt, który miał histogram: wczesne wyjście „nie ma czego
    // rysować" stało PRZED złożeniem przypisów i zabierało ze strony wszystkie
    // zdania o defektach danych. Tu zdanie o bezimiennej bazie nie zależy od
    // danych, więc musi wyjść także wtedy, gdy rysunku nie ma.
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          categories: ["", "II"],
          series: [{ name: "Pusta", values: [null, null], colorSlot: 1 }],
          animate: false,
        })}
        lang="pl"
      />,
    );
    expect(all(container, "svg")).toHaveLength(0);
    expect(klucze(container)).toContain("honesty.baseNamedOk");
    // ...i ani jednego zdania o rysunku, którego nie ma.
    expect(klucze(container)).not.toContain("axis.unitless");
    expect(klucze(container).filter((k) => k.startsWith("reading."))).toEqual([]);
  });

  it("liczby całkowicie poza osią okresów są policzone, choć rysunku nie ma", () => {
    // Arkusz, w którym KAŻDA liczba leży za ostatnią kategorią: na rysunku nie
    // ma nic, a w danych są cztery pomiary. Milczenie znaczyłoby tu „blok jest
    // pusty", czyli zdanie fałszywe o arkuszu autora.
    const podstawa = cfg({ ...BAZA, categories: ["I", "II"] });
    const poza: ChartConfig = {
      ...podstawa,
      series: [{ name: "Za osią", values: [null, null, 30, 40], colorSlot: 1 }],
    };
    const { container } = render(<IndexBaseChart config={poza} lang="pl" />);
    expect(all(container, "svg")).toHaveLength(0);
    const tresc = notatki(container).get("honesty.pointsInPeriodsOk") ?? "";
    expect(tresc).toContain("2");
    expect(tresc).not.toContain("{{");
  });

  it("podpisane n bez ani jednego pomiaru NIE jest cytowane jako zero", () => {
    // UWAGA NA TEN TEST: on NIE łapie defektu, który był - łapie defekt,
    // którym łatwo go zastąpić. Render podstawiał pod wstawkę `{{declared}}`
    // `config.sampleSize ?? 0`, ale zero było nieosiągalne, bo model milczy
    // (`declaredSampleOk === null`), gdy autor nie podał `n` albo gdy nie ma
    // ani jednego pomiaru - czyli dokładnie w tym arkuszu. Wartość zastępcza
    // stała tam jako gałąź, której nie da się wykonać, i pierwsza poprawka
    // przesuwająca warunek („wypisuj, gdy podano n") wpuściłaby ją na stronę
    // jako zdanie „w podpisie stoi n = 0" o podpisie, którego nikt nie
    // napisał. Ten test trzyma milczenie po obu stronach.
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          ...BAZA,
          categories: ["I", "II"],
          sampleSize: 7,
          series: [{ name: "Pusta", values: [null, null], colorSlot: 1 }],
        })}
        lang="pl"
      />,
    );
    expect(klucze(container)).not.toContain("honesty.declaredSampleOk");
    expect(container.textContent ?? "").not.toContain("n = 0");
  });

  it("dwie luki obok siebie nie tworzą pustego pociągnięcia", () => {
    // Defekt, który to łapie: wypchnięcie pustego ciągu punktów do ścieżki -
    // `pathFromPoints([])` daje pusty napis, a ten po sklejeniu zostawia
    // w atrybucie `d` podwójne spacje i ścieżkę, której przeglądarka nie
    // rysuje ani w całości, ani w części.
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          categories: ["a", "b", "c", "d", "e"],
          series: [{ name: "Dziurawa", values: [10, null, null, 12, 13], colorSlot: 1 }],
          animate: false,
        })}
        lang="pl"
      />,
    );
    const d = container.querySelector("[data-role='series-line']")?.getAttribute("d") ?? "";
    expect(d.match(/M/g) ?? []).toHaveLength(2);
    expect(d).not.toContain("  ");
    expect(punkty(container, 0)).toHaveLength(3);
  });
});
