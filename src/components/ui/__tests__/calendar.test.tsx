// Atom `Calendar` (shadcn nad react-day-picker 9) - etykiety ARIA w języku
// interfejsu.
//
// CO TEN PLIK DOWODZI.
//   1. POLSKI INTERFEJS MÓWI PO POLSKU. Przyciski poprzedniego i następnego
//      miesiąca, pasek nawigacji i dzień „dziś" mają polskie nazwy dostępne,
//      choć wywołujący podaje wyłącznie locale date-fns (formatowanie), które
//      etykiet nie ma. Przed poprawką czytnik ekranu czytał tu angielskie
//      „Go to the Next Month" i „Today, ..." - domyślne etykiety biblioteki.
//   2. ANGIELSKI INTERFEJS (także „en-GB") MÓWI PO ANGIELSKU, a język spoza
//      pary PL/EN spada na domyślny język serwisu - polski.
//   3. LOCALE WYWOŁUJĄCEGO NADAL FORMATUJE DATY. Etykiety idą za interfejsem,
//      podpis miesiąca - za `locale`; bez `locale` oba idą za interfejsem.
//   4. JAWNE ETYKIETY WYGRYWAJĄ. Prop `labels` przykrywa etykiety interfejsu
//      (tylko te, które podano), a locale react-day-pickera z własnymi
//      etykietami wygrywa z językiem interfejsu.
//   5. RE-RENDER NIE PRZEMONTOWUJE SIATKI. Podkomponenty (`Root`, `Chevron`,
//      `WeekNumber`) były literałami w renderze, czyli nowym typem elementu
//      przy każdym renderze - React zrywał całe drzewo dni razem z przyciskiem,
//      który miał ognisko. Teraz węzły DOM przeżywają zmianę propsów.
//   6. ROZWIJANA LISTA MIESIĘCY MÓWI JĘZYKIEM KALENDARZA, nie przeglądarki.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nawigacji, wyboru dnia i klawiszologii - to
// zachowanie biblioteki, a sklejenia z polami daty mają testy wywołujących
// (`adminCalendar`, `clubDateTimeInput`, `EventHomeAdsPanel`, trasa wyszukiwania).
//
// ZEGAR. Kalendarz otwiera się na bieżącym miesiącu i wyróżnia „dziś" z
// `new Date()`, więc chwila jest zamrożona na `FIXED_NOW` (poniedziałek
// 15 czerwca 2099).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { enGB, pl as plDateFns } from "date-fns/locale";
import { enUS as dayPickerEnUS } from "react-day-picker/locale/en-US";

import { freezeClock } from "@/test/time";

const h = vi.hoisted(() => ({ lang: "pl" as string }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

import { Calendar } from "@/components/ui/calendar";

freezeClock();

const PL = {
  next: "Przejdź do następnego miesiąca",
  previous: "Przejdź do poprzedniego miesiąca",
  nav: "Pasek nawigacyjny",
};
const EN = {
  next: "Go to the Next Month",
  previous: "Go to the Previous Month",
  nav: "Navigation bar",
};

const przycisk = (nazwa: string | RegExp): HTMLElement =>
  screen.getByRole("button", { name: nazwa });

/** Podpis miesiąca nad siatką - tekst, który formatuje `locale`. */
const podpis = (): string => screen.getByRole("status").textContent ?? "";

beforeEach(() => {
  h.lang = "pl";
});

describe("etykiety w języku interfejsu", () => {
  it("polski interfejs z locale date-fns: nawigacja, pasek i „dziś” mają polskie nazwy", () => {
    render(<Calendar mode="single" locale={plDateFns} />);
    expect(przycisk(PL.next)).toBeTruthy();
    expect(przycisk(PL.previous)).toBeTruthy();
    expect(screen.getByRole("navigation", { name: PL.nav })).toBeTruthy();
    expect(przycisk(/^Dziś, poniedziałek, 15 czerwca 2099$/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: EN.next })).toBeNull();
  });

  it.each(["en", "en-GB"])("interfejs %s: nawigacja i „dziś” mają angielskie nazwy", (lang) => {
    h.lang = lang;
    render(<Calendar mode="single" locale={enGB} />);
    expect(przycisk(EN.next)).toBeTruthy();
    expect(przycisk(EN.previous)).toBeTruthy();
    expect(screen.getByRole("navigation", { name: EN.nav })).toBeTruthy();
    expect(przycisk(/^Today, Monday, 15 June 2099$/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: PL.next })).toBeNull();
  });

  it("język spoza pary PL/EN spada na domyślny język serwisu, czyli polski", () => {
    h.lang = "de";
    render(<Calendar mode="single" locale={plDateFns} />);
    expect(przycisk(PL.next)).toBeTruthy();
  });
});

describe("formatowanie zostaje przy locale wywołującego", () => {
  it("polski interfejs z angielskim locale: podpis po angielsku, etykiety po polsku", () => {
    render(<Calendar mode="single" locale={enGB} />);
    expect(podpis()).toBe("June 2099");
    expect(przycisk(PL.next)).toBeTruthy();
  });

  it("bez locale polski interfejs formatuje i podpisuje po polsku", () => {
    render(<Calendar mode="single" />);
    expect(podpis()).toBe("czerwiec 2099");
    expect(przycisk(PL.previous)).toBeTruthy();
  });

  it("bez locale angielski interfejs formatuje i podpisuje po angielsku", () => {
    h.lang = "en";
    render(<Calendar mode="single" />);
    expect(podpis()).toBe("June 2099");
    expect(przycisk(EN.previous)).toBeTruthy();
  });
});

describe("jawne etykiety wygrywają z językiem interfejsu", () => {
  it("prop `labels` przykrywa tylko podane etykiety, reszta zostaje w języku interfejsu", () => {
    render(<Calendar mode="single" locale={plDateFns} labels={{ labelNext: () => "Dalej" }} />);
    expect(przycisk("Dalej")).toBeTruthy();
    expect(screen.queryByRole("button", { name: PL.next })).toBeNull();
    expect(przycisk(PL.previous)).toBeTruthy();
  });

  it("locale react-day-pickera z własnymi etykietami wygrywa z językiem interfejsu", () => {
    render(<Calendar mode="single" locale={dayPickerEnUS} />);
    expect(przycisk(EN.next)).toBeTruthy();
    expect(screen.queryByRole("button", { name: PL.next })).toBeNull();
  });
});

describe("stabilność drzewa i warianty układu", () => {
  it("zmiana propsów nie przemontowuje siatki dni ani korzenia", () => {
    const { container, rerender } = render(<Calendar mode="single" locale={plDateFns} />);
    const korzen = container.querySelector('[data-slot="calendar"]');
    const dzien = screen.getByRole("button", { name: /15 czerwca 2099/ });
    rerender(<Calendar mode="single" locale={plDateFns} selected={new Date(2099, 5, 15)} />);
    expect(container.querySelector('[data-slot="calendar"]')).toBe(korzen);
    expect(screen.getByRole("button", { name: /15 czerwca 2099/ })).toBe(dzien);
  });

  it("wybrany dzień w trybie pojedynczym ma znacznik wyboru, a zakres - początek, środek i koniec", () => {
    const { unmount } = render(
      <Calendar mode="single" locale={plDateFns} selected={new Date(2099, 5, 10)} />,
    );
    const wybrany = screen.getByRole("button", { name: /10 czerwca 2099/ });
    expect(wybrany.dataset.selectedSingle).toBe("true");
    unmount();
    render(
      <Calendar
        mode="range"
        locale={plDateFns}
        selected={{ from: new Date(2099, 5, 10), to: new Date(2099, 5, 12) }}
      />,
    );
    const dzien = (n: number) =>
      screen.getByRole("button", { name: new RegExp(`${n} czerwca 2099`) });
    expect(dzien(10).dataset.rangeStart).toBe("true");
    expect(dzien(11).dataset.rangeMiddle).toBe("true");
    expect(dzien(12).dataset.rangeEnd).toBe("true");
    expect(dzien(10).dataset.selectedSingle).toBe("false");
  });

  it("rozwijana lista miesięcy podpisuje miesiące w języku kalendarza", () => {
    render(
      <Calendar
        mode="single"
        locale={plDateFns}
        captionLayout="dropdown"
        startMonth={new Date(2099, 0, 1)}
        endMonth={new Date(2099, 11, 31)}
      />,
    );
    const lista = screen.getByRole("combobox", { name: /miesiąc/i });
    const miesiace = within(lista)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(miesiace[0]).toBe(new Date(2099, 0, 1).toLocaleString("pl", { month: "short" }));
    expect(miesiace).not.toContain("Jan");
    // Strzałka rozwijania listy to trzeci wariant szewronu.
    expect(lista.parentElement?.querySelector("svg")).not.toBeNull();
  });

  it("numery tygodni stoją w komórkach tabeli siatki", () => {
    render(<Calendar mode="single" locale={plDateFns} showWeekNumber />);
    const numery = screen.getAllByRole("rowheader");
    expect(numery.length).toBeGreaterThanOrEqual(4);
    expect(numery[0].tagName).toBe("TD");
    expect(numery[0].textContent).toMatch(/^\d+$/);
  });

  it("nawigacja do następnego miesiąca działa i zachowuje etykiety interfejsu", () => {
    render(<Calendar mode="single" locale={plDateFns} />);
    fireEvent.click(przycisk(PL.next));
    expect(podpis()).toBe("lipiec 2099");
    expect(przycisk(PL.previous)).toBeTruthy();
  });
});
