// KALENDARZ PANELU Z "ZOOM-OUT" (`AdminCalendar`, 182 linie).
//
// Jeden komponent obsluguje TRZY widoki tej samej daty: siatke dni
// (react-day-picker), siatke dwunastu miesiecy i strone dwunastu lat.
// Podpis "miesiac rok" jest przyciskiem oddalajacym widok, wybor w siatce
// przyblizanym z powrotem. Plik startowal z 26% linii i 12 z 15 funkcji bez
// ani jednego wywolania - ZERO plikow testowych wymienialo go z nazwy, bo
// wszystkie cztery trasy, ktore go renderuja (`/admin/tracker`, panel wygladu,
// `BlockEditRenderer`, `PostListEditor` buildera), zaslaniaja posrednika
// `AdminDatePicker` atrapa. Luka byla wiec strukturalna, nie przypadkowa,
// i jedynym wyjsciem jest montaz bezposredni.
//
// CO TU JEST NAPRAWDE DO OBRONY
//
// 1. MASZYNA TRZECH WIDOKOW I JEJ PAMIEC. Przewiniecie roku w siatce miesiecy
//    albo strony w siatce lat MUSI przetrwac powrot do siatki dni - inaczej
//    redaktor wpisujacy date archiwalna (rok 2019) laduje z powrotem w roku
//    biezacym po kazdym kliknieciu i nie ma jak sie tam dostac inaczej niz
//    dwunastoma klikami strzalki miesiaca. Pelna droga
//    dzien -> miesiac -> rok -> rok -> miesiac -> dzien jest tu przejechana
//    w calosci, z asercja na podpisie na koncu.
//
// 2. STRONICOWANIE LAT PO WIELOKROTNOSCI DWUNASTU. `baseYear` liczy sie jako
//    `floor(rok / 12) * 12`, wiec rok 2026 wpada na strone 2016-2027, a nie
//    na "dekade" 2020-2029, jak sugeruja etykiety strzalek. Ta rozbieznosc
//    miedzy arytmetyka a nazwa jest przypieta liczbami, zeby nastepna osoba
//    nie "poprawila" jednego bez drugiego.
//
// 3. ROZGALEZIENIE JEZYKOWE BEZ i18n. Ten plik NIE korzysta ze slownikow -
//    szesc etykiet nawigacji jest wpisanych w kod, a wybor jezyka robi
//    `(locale.code ?? "").startsWith("en")`. Skoro tak zostalo, musi byc
//    przypiete w obu jezykach i w przypadku locale bez kodu, bo kazda zmiana
//    tej linii cicho przelacza panel na drugi jezyk.
//
// 4. GRANICA ODPOWIEDZIALNOSCI ZA STAN. Miesiac jest podniesiony do TEGO
//    komponentu (`onMonthChange={setMonth}`), a wybor daty NIE jest - wybor
//    miesiaca czy roku nie ma prawa zglosic rodzicowi nowej daty. Rozroznienie
//    "nawigowalem" kontra "wybralem" jest tu jedyna bariera miedzy przegladaniem
//    kalendarza a nadpisaniem pola formularza.
//
// GRANICA DOWODU: to jest poziom komponentu, nie przegladarki. Nie sprawdzam
// tu ani focusu wymuszanego przez `initialFocus` (happy-dom nie ma silnika
// layoutu, a react-day-picker ustawia focus we wlasnym efekcie - mierzylabym
// obca biblioteke), ani wygladu klas Tailwinda - klasy `bg-primary` i
// `ring-1` traktuje wylacznie jako JEDYNY nosnik informacji o wyroznieniu,
// co samo w sobie jest zarejestrowanym nizej defektem dostepnosci. Nie
// sprawdzam tez zachowania wewnatrz Popovera `AdminDatePicker` - to osobna
// powierzchnia z wlasnym stanem otwarcia.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Locale } from "date-fns";
import { pl as plLocale, enGB as enLocale } from "date-fns/locale";

import { AdminCalendar } from "@/components/admin/blocks/AdminCalendar";
import { axeViolations, summarize } from "@/test/axe";

// Czas zamrozony, bo obie siatki rysuja obwodke "dzisiaj" z `new Date()`.
// 6 wrzesnia 2026: miesiac biezacy = wrzesien (indeks 8), rok biezacy = 2026.
const TERAZ = new Date(2026, 8, 6, 12, 0, 0);

// Daty testowe sa arbitralne i niczyje - kalendarz nie dotyka danych osobowych.
const MAJ_2026 = new Date(2026, 4, 15);
const MARZEC_2024 = new Date(2024, 2, 10);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(TERAZ);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

interface Zamontowany {
  onSelect: ReturnType<typeof vi.fn>;
  container: HTMLElement;
  rerender: (element: React.ReactElement) => void;
}

function zamontuj(props: Partial<React.ComponentProps<typeof AdminCalendar>> = {}): Zamontowany {
  const onSelect = vi.fn();
  const { container, rerender } = render(
    <AdminCalendar
      selected={props.selected}
      onSelect={props.onSelect ?? onSelect}
      locale={props.locale ?? plLocale}
      className={props.className}
    />,
  );
  return { onSelect, container, rerender };
}

/**
 * Podpis "miesiac rok" w siatce dni. Szukam po klasie, a NIE po nazwie
 * dostepnej, bo nazwa tego przycisku to cala jego tresc - czyli zmienia sie
 * przy kazdej nawigacji i przy kazdej zmianie jezyka. Klasa
 * `admin-calendar-caption-btn` jest jedynym stalym uchwytem.
 */
function podpis(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>(".admin-calendar-caption-btn");
  if (!found) throw new Error("test: nie znaleziono przycisku podpisu miesiaca");
  return found;
}

/** Czy w DOM jest siatka dni react-day-pickera (kontra siatka miesiecy/lat). */
function siatkaDniIstnieje(container: HTMLElement): boolean {
  return container.querySelector("[data-slot='calendar']") !== null;
}

/** Przechodzi z siatki dni do siatki miesiecy. */
function oddalDoMiesiecy(container: HTMLElement): void {
  fireEvent.click(podpis(container));
}

/** Przechodzi z siatki miesiecy do strony lat (naglowek z rokiem jest guzikiem). */
function oddalDoLat(rok: string): void {
  fireEvent.click(screen.getByRole("button", { name: rok }));
}

/** Naglowek strony lat - jedyny `span` z klasa `font-semibold` w tym widoku. */
function naglowekStronyLat(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>("span.font-semibold");
  if (!found) throw new Error("test: nie znaleziono naglowka strony lat");
  return found;
}

/** Wszystkie przyciski siatki trzykolumnowej (miesiace albo lata). */
function przyciskiSiatki(container: HTMLElement): HTMLElement[] {
  const grid = container.querySelector<HTMLElement>(".grid-cols-3");
  if (!grid) throw new Error("test: nie znaleziono siatki trzykolumnowej");
  return Array.from(grid.querySelectorAll<HTMLElement>("button"));
}

// ---------------------------------------------------------------------------

describe("siatka dni - podpis, wybor daty i podniesiony stan miesiaca", () => {
  it("podpis pokazuje miesiac i rok wybranej daty w jezyku przekazanego locale", () => {
    const { container } = zamontuj({ selected: MAJ_2026 });

    expect(podpis(container)).toHaveTextContent("maj 2026");
    expect(siatkaDniIstnieje(container)).toBe(true);
  });

  it("ten sam podpis po angielsku, gdy locale niesie kod en", () => {
    const { container } = zamontuj({ selected: MAJ_2026, locale: enLocale });

    expect(podpis(container)).toHaveTextContent("May 2026");
  });

  it("bez wskazanej daty siatka otwiera sie na miesiacu biezacym", () => {
    const { container } = zamontuj();

    expect(podpis(container)).toHaveTextContent("wrzesień 2026");
  });

  it("klasa przekazana propem dokleja sie do korzenia kalendarza obok pointer-events-auto", () => {
    const { container } = zamontuj({ selected: MAJ_2026, className: "moja-klasa-testowa" });

    const korzen = container.querySelector<HTMLElement>("[data-slot='calendar']");
    expect(korzen).not.toBeNull();
    expect(korzen).toHaveClass("pointer-events-auto");
    expect(korzen).toHaveClass("moja-klasa-testowa");
  });

  it("klikniecie dnia oddaje rodzicowi dokladnie te date, w ktora kliknieto", () => {
    const { container, onSelect } = zamontuj({ selected: MAJ_2026 });

    fireEvent.click(within(container).getByRole("button", { name: /20 maja 2026/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    const oddana = onSelect.mock.calls[0][0] as Date;
    expect(oddana).toBeInstanceOf(Date);
    expect([oddana.getFullYear(), oddana.getMonth(), oddana.getDate()]).toEqual([2026, 4, 20]);
  });

  it("strzalka nastepnego miesiaca przesuwa podpis, bo stan miesiaca trzyma ten komponent", () => {
    const { container, onSelect } = zamontuj({ selected: MAJ_2026 });

    fireEvent.click(within(container).getByRole("button", { name: /Next Month/i }));

    expect(podpis(container)).toHaveTextContent("czerwiec 2026");
    // Nawigacja NIE jest wyborem - pole formularza ma zostac nietkniete.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("zmiana propu selected na inna date przestawia widoczny miesiac na miesiac tej daty", () => {
    const { container, rerender } = zamontuj({ selected: MAJ_2026 });
    expect(podpis(container)).toHaveTextContent("maj 2026");

    rerender(<AdminCalendar selected={MARZEC_2024} onSelect={vi.fn()} locale={plLocale} />);

    expect(podpis(container)).toHaveTextContent("marzec 2024");
  });

  it("wyczyszczenie daty (selected undefined) NIE przestawia widocznego miesiaca", () => {
    const { container, rerender } = zamontuj({ selected: MARZEC_2024 });
    expect(podpis(container)).toHaveTextContent("marzec 2024");

    rerender(<AdminCalendar selected={undefined} onSelect={vi.fn()} locale={plLocale} />);

    // Efekt synchronizacji ma warunek `if (selected)`, wiec pusta wartosc
    // zostawia redaktora tam, gdzie patrzyl, zamiast wyrzucac go do dzisiaj.
    expect(podpis(container)).toHaveTextContent("marzec 2024");
  });
});

// ---------------------------------------------------------------------------

describe("oddalenie do siatki miesiecy", () => {
  it("klikniecie podpisu zamienia siatke dni na dwanascie skrotow miesiecy w jezyku locale", () => {
    const { container } = zamontuj({ selected: MAJ_2026 });

    oddalDoMiesiecy(container);

    expect(siatkaDniIstnieje(container)).toBe(false);
    expect(przyciskiSiatki(container).map((b) => b.textContent)).toEqual([
      "sty",
      "lut",
      "mar",
      "kwi",
      "maj",
      "cze",
      "lip",
      "sie",
      "wrz",
      "paź",
      "lis",
      "gru",
    ]);
  });

  it("te same dwanascie skrotow po angielsku dla locale en", () => {
    const { container } = zamontuj({ selected: MAJ_2026, locale: enLocale });

    oddalDoMiesiecy(container);

    expect(przyciskiSiatki(container).map((b) => b.textContent)).toEqual([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]);
  });

  it("miesiac wybranej daty ma tlo wyroznienia, a miesiac biezacy - sama obwodke", () => {
    const { container } = zamontuj({ selected: MAJ_2026 });

    oddalDoMiesiecy(container);
    const [, , , , maj, , , , wrzesien] = przyciskiSiatki(container);

    expect(maj).toHaveClass("bg-primary");
    expect(maj).not.toHaveClass("ring-1");
    // Wrzesien 2026 jest "dzisiaj", ale nie jest wybrany - stad sama obwodka.
    expect(wrzesien).toHaveClass("ring-1");
    expect(wrzesien).not.toHaveClass("bg-primary");
  });

  it("gdy nie ma wybranej daty, zaden miesiac nie dostaje tla wyroznienia", () => {
    const { container } = zamontuj();

    oddalDoMiesiecy(container);

    expect(przyciskiSiatki(container).filter((b) => b.classList.contains("bg-primary"))).toEqual(
      [],
    );
  });

  it("przewiniecie roku gasi oba wyroznienia, bo ani wybor, ani dzisiaj nie sa w tym roku", () => {
    const { container } = zamontuj({ selected: MAJ_2026 });

    oddalDoMiesiecy(container);
    fireEvent.click(screen.getByRole("button", { name: "Poprzedni rok" }));

    expect(screen.getByRole("button", { name: "2025" })).toBeInTheDocument();
    const bezWyroznien = przyciskiSiatki(container).every(
      (b) => !b.classList.contains("bg-primary") && !b.classList.contains("ring-1"),
    );
    expect(bezWyroznien).toBe(true);
  });

  it("strzalki przesuwaja rok o jeden w obie strony, zachowujac numer miesiaca", () => {
    const { container } = zamontuj({ selected: MAJ_2026 });

    oddalDoMiesiecy(container);
    fireEvent.click(screen.getByRole("button", { name: "Następny rok" }));
    expect(screen.getByRole("button", { name: "2027" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Poprzedni rok" }));
    fireEvent.click(screen.getByRole("button", { name: "Poprzedni rok" }));
    expect(screen.getByRole("button", { name: "2025" })).toBeInTheDocument();

    // Powrot do siatki dni musi pamietac przewiniety rok, a miesiac zostac maj.
    fireEvent.click(screen.getByRole("button", { name: "maj" }));
    expect(podpis(container)).toHaveTextContent("maj 2025");
  });

  it("etykiety strzalek sa po angielsku, gdy locale niesie kod en", () => {
    const { container } = zamontuj({ selected: MAJ_2026, locale: enLocale });

    oddalDoMiesiecy(container);

    expect(screen.getByRole("button", { name: "Previous year" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next year" })).toBeInTheDocument();
  });

  it("locale pozbawione kodu jezyka degraduje etykiety do polskich zamiast wysypywac komponent", () => {
    // `locale.code` jest w typie date-fns wymagane, wiec zeby dojsc do galezi
    // `?? ""` trzeba usunac wlasciwosc w czasie wykonania - bez rzutowania
    // na `any` i bez podmiany produkcyjnego typu.
    const bezKodu: Locale = { ...plLocale };
    Reflect.deleteProperty(bezKodu, "code");

    const { container } = zamontuj({ selected: MAJ_2026, locale: bezKodu });

    oddalDoMiesiecy(container);

    expect(screen.getByRole("button", { name: "Poprzedni rok" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Następny rok" })).toBeInTheDocument();
  });

  it("wybor miesiaca wraca do siatki dni na tym miesiacu i NIE zglasza rodzicowi daty", () => {
    const { container, onSelect } = zamontuj({ selected: MAJ_2026 });

    oddalDoMiesiecy(container);
    fireEvent.click(screen.getByRole("button", { name: "lis" }));

    expect(siatkaDniIstnieje(container)).toBe(true);
    expect(podpis(container)).toHaveTextContent("listopad 2026");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("klasa przekazana propem trafia takze na kontener siatki miesiecy", () => {
    const { container } = zamontuj({ selected: MAJ_2026, className: "moja-klasa-testowa" });

    oddalDoMiesiecy(container);

    expect(container.firstElementChild).toHaveClass("moja-klasa-testowa");
    expect(container.firstElementChild).toHaveClass("p-3");
  });
});

// ---------------------------------------------------------------------------

describe("oddalenie do strony lat", () => {
  it("strona lat zaczyna sie od wielokrotnosci dwunastu, a nie od poczatku dekady", () => {
    const { container } = zamontuj({ selected: MAJ_2026 });

    oddalDoMiesiecy(container);
    oddalDoLat("2026");

    // floor(2026 / 12) * 12 = 2016, wiec strona to 2016-2027 - mimo ze
    // strzalki nazywaja to "dekada".
    expect(naglowekStronyLat(container)).toHaveTextContent("2016 – 2027");
    expect(przyciskiSiatki(container).map((b) => b.textContent)).toEqual([
      "2016",
      "2017",
      "2018",
      "2019",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
      "2025",
      "2026",
      "2027",
    ]);
  });

  it("rok wybranej daty ma tlo wyroznienia, a rok biezacy - sama obwodke", () => {
    const { container } = zamontuj({ selected: MARZEC_2024 });

    oddalDoMiesiecy(container);
    oddalDoLat("2024");

    const rok2024 = screen.getByRole("button", { name: "2024" });
    const rok2026 = screen.getByRole("button", { name: "2026" });
    expect(rok2024).toHaveClass("bg-primary");
    expect(rok2024).not.toHaveClass("ring-1");
    expect(rok2026).toHaveClass("ring-1");
    expect(rok2026).not.toHaveClass("bg-primary");
  });

  it("bez wybranej daty zaden rok nie dostaje tla wyroznienia", () => {
    const { container } = zamontuj();

    oddalDoMiesiecy(container);
    oddalDoLat("2026");

    expect(przyciskiSiatki(container).filter((b) => b.classList.contains("bg-primary"))).toEqual(
      [],
    );
  });

  it("strzalki przewijaja strone o dwanascie lat w obie strony", () => {
    const { container } = zamontuj({ selected: MAJ_2026 });

    oddalDoMiesiecy(container);
    oddalDoLat("2026");

    fireEvent.click(screen.getByRole("button", { name: "Poprzednia dekada" }));
    expect(naglowekStronyLat(container)).toHaveTextContent("2004 – 2015");

    fireEvent.click(screen.getByRole("button", { name: "Następna dekada" }));
    fireEvent.click(screen.getByRole("button", { name: "Następna dekada" }));
    expect(naglowekStronyLat(container)).toHaveTextContent("2028 – 2039");
  });

  it("etykiety strzalek dekady sa po angielsku, gdy locale niesie kod en", () => {
    const { container } = zamontuj({ selected: MAJ_2026, locale: enLocale });

    oddalDoMiesiecy(container);
    oddalDoLat("2026");

    expect(screen.getByRole("button", { name: "Previous decade" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next decade" })).toBeInTheDocument();
  });

  it("klasa przekazana propem trafia takze na kontener strony lat", () => {
    const { container } = zamontuj({ selected: MAJ_2026, className: "moja-klasa-testowa" });

    oddalDoMiesiecy(container);
    oddalDoLat("2026");

    expect(container.firstElementChild).toHaveClass("moja-klasa-testowa");
  });

  it("pelna droga rok -> miesiac -> dzien ustawia podpis na wybrana pare rok i miesiac", () => {
    const { container, onSelect } = zamontuj({ selected: MAJ_2026 });

    oddalDoMiesiecy(container);
    oddalDoLat("2026");
    fireEvent.click(screen.getByRole("button", { name: "Poprzednia dekada" }));
    fireEvent.click(screen.getByRole("button", { name: "2007" }));

    // Wybor roku cofa o jeden poziom - do siatki miesiecy, nie do siatki dni.
    expect(screen.getByRole("button", { name: "2007" })).toBeInTheDocument();
    expect(siatkaDniIstnieje(container)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "lut" }));

    expect(siatkaDniIstnieje(container)).toBe(true);
    expect(podpis(container)).toHaveTextContent("luty 2007");
    // Trzy poziomy nawigacji i ani jednego zgloszenia daty do rodzica.
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("dostepnosc trzech widokow", () => {
  it("siatka miesiecy nie ma naruszen strukturalnych axe", async () => {
    const { container } = zamontuj({ selected: MAJ_2026 });
    oddalDoMiesiecy(container);

    const naruszenia = await axeViolations(container);

    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("strona lat nie ma naruszen strukturalnych axe", async () => {
    const { container } = zamontuj({ selected: MAJ_2026 });
    oddalDoMiesiecy(container);
    oddalDoLat("2026");

    const naruszenia = await axeViolations(container);

    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DEFEKTY - zarejestrowane, NIE naprawione w kodzie produkcyjnym.
// ---------------------------------------------------------------------------

describe("defekty kalendarza panelu", () => {
  // DEFEKT: KLIKNIECIE JUZ WYBRANEGO DNIA KASUJE DATE ZAMIAST JA POTWIERDZIC.
  //
  // WEJSCIE: kalendarz z `selected` = 15 maja 2026 (czyli pole formularza ma
  //   juz wartosc), redaktor otwiera go i klika w podswietlony dzien 15.
  // CO PSUJE: `AdminCalendar` (src/components/admin/blocks/AdminCalendar.tsx:39-42)
  //   podaje `onSelect` react-day-pickerowi w trybie `mode="single"` BEZ propu
  //   `required`. W react-day-picker 9 tryb pojedynczy jest przelacznikiem:
  //   klikniecie aktualnie zaznaczonego dnia to ODZNACZENIE i handler dostaje
  //   `undefined`. Zmierzone: `onSelect` wolane raz, argument `undefined`.
  // KONSEKWENCJA: jedyny konsument, `AdminDatePicker`
  //   (src/components/admin/blocks/AdminDatePicker.tsx:107-110), robi z tego
  //   `onChange(d ? toLocalDate(d) : null)` i NATYCHMIAST zamyka popover.
  //   Czyli: redaktor klika w date, ktora widzi jako wybrana - zeby ja
  //   potwierdzic - a pole zostaje WYCZYSZCZONE i kalendarz sie zamyka, bez
  //   zadnego komunikatu. Na `/admin/tracker` i w edytorze bloku odliczania
  //   znika wtedy cala zaplanowana data, a odzyskac ja mozna tylko pamiecia.
  //   Kasowanie ma w tym UI wlasny, jawny przycisk "Wyczyść" - ten gest nie
  //   ma prawa go dublowac.
  // WYMAGANA POPRAWKA: `<Calendar mode="single" required ...>` (react-day-picker
  //   wylacza wtedy odznaczanie) albo straznik w `onSelect`, ktory przy
  //   `undefined` zostawia dotychczasowa wartosc.
  it.fails("DEFEKT: klikniecie juz wybranego dnia NIE moze kasowac daty", () => {
    const { container, onSelect } = zamontuj({ selected: MAJ_2026 });

    fireEvent.click(within(container).getByRole("button", { name: /15 maja 2026/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toBeInstanceOf(Date);
  });

  // DEFEKT: NOWA INSTANCJA TEJ SAMEJ DATY COFA NAWIGACJE REDAKTORA.
  //
  // WEJSCIE: kalendarz z `selected` = 15 maja 2026. Redaktor przewija do
  //   czerwca 2026 strzalka siatki dni. Rodzic renderuje sie ponownie
  //   (dowolny powod: zmiana innego pola, otwarcie/zamkniecie popovera,
  //   przerysowanie panelu) i podaje TE SAMA date jako NOWY obiekt `Date`.
  // CO PSUJE: efekt synchronizacji
  //   (src/components/admin/blocks/AdminCalendar.tsx:33-35) ma w tablicy
  //   zaleznosci `[selected]`, czyli porownuje TOZSAMOSC obiektu, a nie jego
  //   wartosc. To nie jest teoretyczne: jedyny konsument liczy
  //   `parsed = value ? parseLocalDateTime(value) : null`
  //   (src/components/admin/blocks/AdminDatePicker.tsx:82) przy KAZDYM
  //   renderze, wiec `selected` dostaje nowa tozsamosc nawet wtedy, gdy
  //   napis "2026-05-15" w ogole sie nie zmienil.
  // KONSEKWENCJA: `setMonth(selected)` przestawia widok z powrotem na maj i
  //   przewiniecie przepada. Redaktor, ktory szuka daty kilka miesiecy dalej,
  //   jest cofany do miesiaca juz wybranego - w skrajnym przypadku (rodzic
  //   renderujacy sie na kazde nacisniecie klawisza w sasiednim polu) siatka
  //   jest nie do przewiniecia w ogole.
  // WYMAGANA POPRAWKA: efekt musi zalezec od WARTOSCI, a nie od tozsamosci -
  //   `[selected?.getTime()]` z odczytem daty w srodku - zeby zadzialal
  //   wylacznie wtedy, gdy realnie zmienil sie wybrany dzien.
  it.fails("DEFEKT: nowa instancja tej samej daty NIE moze cofac nawigacji redaktora", () => {
    const { container, rerender } = zamontuj({ selected: new Date(2026, 4, 15) });

    fireEvent.click(within(container).getByRole("button", { name: /Next Month/i }));
    expect(podpis(container)).toHaveTextContent("czerwiec 2026");

    rerender(
      <AdminCalendar selected={new Date(2026, 4, 15)} onSelect={vi.fn()} locale={plLocale} />,
    );

    expect(podpis(container)).toHaveTextContent("czerwiec 2026");
  });

  // DEFEKT: WYROZNIENIE W SIATKACH MIESIECY I LAT ISTNIEJE WYLACZNIE JAKO KLASA CSS.
  //
  // WEJSCIE: kalendarz z `selected` = 15 maja 2026, oddalony do siatki
  //   miesiecy; uzytkownik czytnika ekranu przechodzi tabulatorem po
  //   dwunastu przyciskach.
  // CO PSUJE: przyciski miesiecy (AdminCalendar.tsx:106-122) i lat
  //   (:161-177) roznicuja stan wybrania WYLACZNIE klasami `bg-primary` /
  //   `ring-1 ring-border`. Nie ma ani `aria-pressed`, ani `aria-current`,
  //   ani zadnego tekstu pomocniczego. Zmierzone: `maj` ma `bg-primary`
  //   i ZERO atrybutow ARIA.
  // KONSEKWENCJA: czytnik ekranu ogloszi dwanascie identycznie brzmiacych
  //   przyciskow ("sty", "lut", ... "gru") i nie powie, ktory jest wybrany
  //   ani ktory jest biezacy. To regres wzgledem widoku, ktory te siatki
  //   ZASTEPUJA: react-day-picker dokleja w siatce dni stan do nazwy
  //   dostepnej ("piątek, 15 maja 2026, selected"). Oddalenie widoku odbiera
  //   wiec informacje, ktora przyblizony widok podaje - a to jest jedyna
  //   droga do lat odleglych, wiec obejscia nie ma.
  //   Sam kolor tla nie jest dopuszczalnym nosnikiem informacji (WCAG 1.4.1).
  // WYMAGANA POPRAWKA: przyciski miesiaca i roku musza niesc
  //   `aria-pressed={isSelected}` (albo `aria-current="date"` dla biezacego),
  //   zeby stan byl w drzewie dostepnosci, a nie tylko w warstwie wizualnej.
  it.fails("DEFEKT: wybrany miesiac musi byc oznaczony w ARIA, nie tylko klasa CSS", () => {
    const { container } = zamontuj({ selected: MAJ_2026 });

    oddalDoMiesiecy(container);
    const maj = screen.getByRole("button", { name: "maj" });

    expect(maj).toHaveClass("bg-primary");
    expect(maj).toHaveAttribute("aria-pressed", "true");
  });
});
