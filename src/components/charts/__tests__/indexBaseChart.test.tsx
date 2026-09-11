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
    // pusty dymek nie powie.
    const { container } = render(<IndexBaseChart config={zBaza(0)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    fireEvent.keyDown(box as HTMLElement, { key: "ArrowRight" });
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).toContain("Deficyt");
    expect(dymek).toContain("-");
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

describe("SONDA2", () => {
  it("P7 etykiety okresow nie nachodza na siebie", () => {
    const okresy = Array.from({ length: 30 }, (_, i) => `R${i}`);
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          categories: okresy,
          series: [{ name: "A", values: okresy.map((_, i) => 100 + i) }],
          animate: false,
        })}
        lang="pl"
        baseAt={3}
      />,
    );
    const et = all(container, "[data-role='period'],[data-role='base-period']").map((e) => {
      const x = Number(e.getAttribute("x"));
      const w = (e.textContent ?? "").length * 11 * 0.62;
      const a = e.getAttribute("text-anchor");
      const od = a === "start" ? x : a === "end" ? x - w : x - w / 2;
      return { t: e.textContent, x, od, do: od + w, a };
    });
    console.log("P7", JSON.stringify(et));
    for (let i = 1; i < et.length; i++) {
      expect(et[i].od, `${et[i - 1].t} / ${et[i].t}`).toBeGreaterThanOrEqual(et[i - 1].do);
    }
  });

  it("P8 dluga etykieta okresu i baza obok sasiada", () => {
    const okresy = Array.from({ length: 12 }, (_, i) => `Kwartal ${i + 1} roku 202${i % 10}`);
    const { container } = render(
      <IndexBaseChart
        config={cfg({
          categories: okresy,
          series: [{ name: "A", values: okresy.map((_, i) => 100 + i) }],
          animate: false,
        })}
        lang="pl"
        baseAt={1}
      />,
    );
    const et = all(container, "[data-role='period'],[data-role='base-period']").map((e) => {
      const x = Number(e.getAttribute("x"));
      const w = (e.textContent ?? "").length * 11 * 0.62;
      const a = e.getAttribute("text-anchor");
      const od = a === "start" ? x : a === "end" ? x - w : x - w / 2;
      return { t: e.textContent, od, do: od + w };
    });
    console.log("P8", JSON.stringify(et));
    for (let i = 1; i < et.length; i++) {
      expect(et[i].od, `${et[i - 1].t} / ${et[i].t}`).toBeGreaterThanOrEqual(et[i - 1].do);
    }
  });
});
