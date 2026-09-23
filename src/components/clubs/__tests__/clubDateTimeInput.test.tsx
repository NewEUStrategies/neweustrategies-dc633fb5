// Molekuła „pole terminu wydarzenia klubu" (`ClubDateTimeInput`) - natywne pole
// do wpisu z klawiatury plus własne okno wyboru: kalendarz shadcn i dwie kolumny
// (godziny, minuty co pięć). Siedzi pod polami „początek" i „koniec" w
// `ClubEventForm`, więc każda pomyłka tutaj to wydarzenie w złym dniu albo
// o złej godzinie w rozesłanych zaproszeniach.
//
// CO TEN PLIK DOWODZI.
//   1. POLE NIE PRZEKŁADA WPISU. Wartość wpisana z klawiatury idzie do rodzica
//      bit w bit (także pusty napis po skasowaniu), a typ pola wynika z trybu:
//      `datetime-local` z godziną, `date` dla wydarzenia całodniowego.
//   2. WYBÓR DNIA NIE GUBI GODZINY. Przy zapisanym terminie nowy dzień zachowuje
//      godzinę i minutę; przy pustym (albo nieczytelnym) polu dostaje domyślne
//      18:00. Tryb całodniowy oddaje samą datę i zamyka okno, tryb z godziną
//      zostawia je otwarte, bo kurator zwykle wybiera jeszcze godzinę.
//   3. KOLUMNY ZMIENIAJĄ TYLKO SWOJĄ CZĘŚĆ. Godzina nie rusza minut, minuta nie
//      rusza godziny; bez zapisanego terminu wybór startuje od dziś. Minuta spoza
//      siatki co pięć (np. 37) podświetla najbliższą niższą piątkę, a zaznaczone
//      pozycje są przewijane na środek kolumn.
//   4. KALENDARZ MÓWI JĘZYKIEM INTERFEJSU. Po polsku - polskie nazwy, po
//      angielsku (także `en-US`) - brytyjskie; każdy inny język spada na polski.
//      Tydzień zawsze zaczyna poniedziałek. Okno otwiera się na miesiącu
//      zapisanego terminu i zaznacza jego dzień.
//   5. PRZYCISKI STOPKI ROBIĄ, CO OBIECUJĄ. „Wyczyść" oddaje pusty napis
//      i zamyka okno, „Teraz" wstawia bieżącą chwilę z dokładnością do minuty
//      (bez zaokrąglania w górę) albo samą dzisiejszą datę, „Gotowe" i Escape
//      zamykają okno bez zmiany wartości.
//   6. WARTOŚĆ NIECZYTELNA DEGRADUJE, a nie wywraca okna: nic nie jest
//      zaznaczone, kalendarz stoi na bieżącym miesiącu.
//   7. PO OTWARCIU FOKUS STOI NA ZAZNACZONYM DNIU, więc strzałki od razu chodzą
//      po dniach (szczegóły przy teście, w sekcji o klawiaturze).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   - Przeliczenia pola na ISO ze strefą i presetów terminu - to robi
//     `ClubEventForm` i `lib/clubs/workspaceForms`; dowód w
//     `clubEventForm.test.tsx` i `src/lib/clubs/__tests__/workspaceForms.test.ts`.
//   - Nawigacji po miesiącach i klawiszologii kalendarza - to zachowanie
//     `react-day-picker`, nie tej molekuły.
//   - Stanu `disabled` oraz granic `min`/`max` - molekuła ich NIE MA (nie
//     przyjmuje takich właściwości), więc nie ma czego dowodzić.
//
// Radix Popover i kalendarz są PRAWDZIWE: pod happy-dom otwierają się, a Escape
// zamyka warstwę, więc atrapa nie jest potrzebna. Zegar jest zamrożony, a daty
// liczone względem „teraz" i składane z pól LOKALNYCH - tak samo czyta je
// komponent, więc asercje nie zależą od strefy maszyny.

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { DZIEN, MINUTA, SEKUNDA, advanceClock, freezeClock, relativeDate } from "@/test/time";

const h = vi.hoisted(() => ({
  /** Język widziany przez atrapę i18n - przestawialny w teście. */
  lang: "pl" as string,
  ensureI18n: vi.fn<() => void>(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: h.ensureI18n }));

import { ClubDateTimeInput } from "@/components/clubs/molecules/ClubDateTimeInput";

freezeClock();

const K = {
  open: "club.eventForm.openPicker",
  hours: "club.eventForm.hours",
  minutes: "club.eventForm.minutes",
  clear: "club.eventForm.clear",
  now: "club.eventForm.now",
  done: "club.eventForm.done",
} as const;

// --- daty względem zamrożonego „teraz" ----------------------------------------

const dwa = (n: number): string => String(n).padStart(2, "0");

/** Dzień w formacie pola `date`, złożony z pól LOKALNYCH. */
function dzienPola(d: Date): string {
  return `${d.getFullYear()}-${dwa(d.getMonth() + 1)}-${dwa(d.getDate())}`;
}

/** Chwila w formacie pola `datetime-local` (bez sekund), z pól LOKALNYCH. */
function chwilaPola(d: Date): string {
  return `${dzienPola(d)}T${dwa(d.getHours())}:${dwa(d.getMinutes())}`;
}

/** Dzień `dni` dób od „teraz", o podanej godzinie LOKALNEJ. */
function oGodzinie(dni: number, godzina: number, minuta: number): Date {
  const d = relativeDate(dni * DZIEN);
  d.setHours(godzina, minuta, 0, 0);
  return d;
}

/** „Teraz" testu: poniedziałek 15 czerwca 2099, południe UTC. */
const DZIS = relativeDate(0);
/** Zapisany termin: pięć tygodni później (20 lipca), 14:37 - minuta spoza siatki co pięć. */
const TERMIN = oGodzinie(35, 14, 37);

// --- narzędzia ----------------------------------------------------------------

function pole(props: { value?: string; allDay?: boolean; required?: boolean } = {}): {
  onChange: Mock<(value: string) => void>;
} {
  const onChange = vi.fn<(value: string) => void>();
  render(
    <ClubDateTimeInput
      id="termin"
      value={props.value ?? ""}
      onChange={onChange}
      allDay={props.allDay ?? false}
      required={props.required}
    />,
  );
  return { onChange };
}

/** Rodzic trzymający wartość w stanie - jak `ClubEventForm`. */
function Sterowane({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <ClubDateTimeInput
      id="termin"
      value={value}
      allDay={false}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

function wpis(): HTMLInputElement {
  const node = document.getElementById("termin");
  if (!(node instanceof HTMLInputElement)) throw new Error("brak pola terminu");
  return node;
}

function ikona(): HTMLElement {
  return screen.getByRole("button", { name: K.open });
}

function otworz(): HTMLElement {
  fireEvent.click(ikona());
  return screen.getByRole("dialog");
}

function okno(): HTMLElement | null {
  return screen.queryByRole("dialog");
}

function nacisnij(nazwa: string): void {
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: nazwa }));
}

/** Przycisk dnia w kalendarzu - komórka niesie dzień lokalny w `data-day`. */
function dzien(d: Date): HTMLElement {
  const przycisk = screen
    .getByRole("dialog")
    .querySelector(`td[data-day="${dzienPola(d)}"] button`);
  if (!(przycisk instanceof HTMLButtonElement)) {
    throw new Error(`brak dnia ${dzienPola(d)} w kalendarzu`);
  }
  return przycisk;
}

/** Pozycje przewinięte do widoku, w kolejności przewijania - po ich tekście. */
function przewiniete(przewin: { mock: { contexts: unknown[] } }): (string | null)[] {
  return przewin.mock.contexts.map((el) => (el instanceof Element ? el.textContent : null));
}

function kolumna(nazwa: string): HTMLElement {
  return screen.getByRole("listbox", { name: nazwa });
}

function pozycja(nazwaKolumny: string, tekst: string): HTMLElement {
  return within(kolumna(nazwaKolumny)).getByRole("option", { name: tekst });
}

function zaznaczone(nazwaKolumny: string): string[] {
  return within(kolumna(nazwaKolumny))
    .getAllByRole("option")
    .filter((o) => o.getAttribute("aria-selected") === "true")
    .map((o) => o.textContent ?? "");
}

function zaznaczoneDni(): string[] {
  return within(screen.getByRole("dialog"))
    .queryAllByRole("gridcell")
    .filter((c) => c.getAttribute("aria-selected") === "true")
    .map((c) => c.textContent ?? "");
}

/** Pierwsza kolumna nagłówka tygodnia (nagłówek jest `aria-hidden`). */
function pierwszyDzienTygodnia(): string {
  const [pierwszy] = within(screen.getByRole("dialog")).getAllByRole("columnheader", {
    hidden: true,
  });
  return pierwszy?.textContent ?? "";
}

beforeEach(() => {
  h.lang = "pl";
  h.ensureI18n.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- testy --------------------------------------------------------------------

describe("pole wpisu z klawiatury", () => {
  it("tryb z godziną to pole `datetime-local` z identyfikatorem, wartością i wymaganiem", () => {
    pole({ value: chwilaPola(TERMIN), required: true });
    expect(wpis()).toHaveAttribute("type", "datetime-local");
    expect(wpis()).toHaveAttribute("id", "termin");
    expect(wpis()).toHaveValue(chwilaPola(TERMIN));
    expect(wpis()).toBeRequired();
  });

  it("tryb całodniowy to pole `date`, a bez `required` pole nie jest wymagane", () => {
    pole({ value: dzienPola(TERMIN), allDay: true });
    expect(wpis()).toHaveAttribute("type", "date");
    expect(wpis()).toHaveValue(dzienPola(TERMIN));
    expect(wpis()).not.toBeRequired();
  });

  it("wpisana chwila idzie do rodzica bez żadnej przeróbki", () => {
    const { onChange } = pole();
    fireEvent.change(wpis(), { target: { value: chwilaPola(TERMIN) } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(chwilaPola(TERMIN));
  });

  it("wpisana data w trybie całodniowym idzie do rodzica bez żadnej przeróbki", () => {
    const { onChange } = pole({ allDay: true });
    fireEvent.change(wpis(), { target: { value: dzienPola(TERMIN) } });
    expect(onChange).toHaveBeenCalledWith(dzienPola(TERMIN));
  });

  it("skasowanie wpisu z klawiatury oddaje pusty napis", () => {
    const { onChange } = pole({ value: chwilaPola(TERMIN) });
    fireEvent.change(wpis(), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("molekuła sama dociąga słownik klubu, zanim wyrenderuje etykiety", () => {
    pole();
    expect(h.ensureI18n).toHaveBeenCalled();
    expect(ikona()).toHaveAttribute("aria-label", K.open);
  });
});

describe("otwieranie i zamykanie okna wyboru", () => {
  it("okno jest zamknięte do kliknięcia ikony kalendarza, a ikona zgłasza rozwinięcie", () => {
    pole();
    expect(okno()).toBeNull();
    expect(ikona()).toHaveAttribute("aria-expanded", "false");
    otworz();
    expect(okno()).not.toBeNull();
    expect(ikona()).toHaveAttribute("aria-expanded", "true");
  });

  it("ponowne kliknięcie ikony zamyka otwarte okno", () => {
    pole();
    otworz();
    fireEvent.click(ikona());
    expect(okno()).toBeNull();
  });

  it("Escape zamyka okno, nie zmienia wartości i oddaje fokus ikonie", async () => {
    const { onChange } = pole({ value: chwilaPola(TERMIN) });
    // Użytkownik klawiatury: Tab na ikonę, otwarcie, Escape.
    ikona().focus();
    otworz();
    expect(document.activeElement).not.toBe(ikona());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(okno()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(ikona()));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("„Gotowe” zamyka okno bez zmiany wartości", () => {
    const { onChange } = pole({ value: chwilaPola(TERMIN) });
    otworz();
    nacisnij(K.done);
    expect(okno()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("„Wyczyść” oddaje pusty napis i zamyka okno", () => {
    const { onChange } = pole({ value: chwilaPola(TERMIN) });
    otworz();
    nacisnij(K.clear);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
    expect(okno()).toBeNull();
  });
});

describe("kalendarz: język, początek tygodnia i miesiąc startowy", () => {
  it("po polsku miesiąc i dni tygodnia są polskie, a tydzień zaczyna poniedziałek", () => {
    pole();
    const o = otworz();
    expect(within(o).getByText("czerwiec 2099")).toBeTruthy();
    expect(pierwszyDzienTygodnia()).toBe("pon");
  });

  it("po angielsku kalendarz jest brytyjski, z tygodniem od poniedziałku", () => {
    h.lang = "en";
    pole();
    const o = otworz();
    expect(within(o).getByText("June 2099")).toBeTruthy();
    expect(pierwszyDzienTygodnia()).toBe("Mo");
  });

  it("wariant regionalny `en-US` też dostaje kalendarz angielski", () => {
    h.lang = "en-US";
    pole();
    expect(within(otworz()).getByText("June 2099")).toBeTruthy();
  });

  it("język spoza pary pl/en spada na kalendarz polski", () => {
    h.lang = "de";
    pole();
    expect(within(otworz()).getByText("czerwiec 2099")).toBeTruthy();
  });

  it("okno otwiera się na miesiącu zapisanego terminu i zaznacza jego dzień", () => {
    pole({ value: chwilaPola(TERMIN) });
    const o = otworz();
    expect(within(o).getByText("lipiec 2099")).toBeTruthy();
    expect(zaznaczoneDni()).toEqual([String(TERMIN.getDate())]);
  });

  it("bez wartości kalendarz stoi na bieżącym miesiącu i nic nie jest zaznaczone", () => {
    pole();
    const o = otworz();
    expect(within(o).getByText("czerwiec 2099")).toBeTruthy();
    expect(zaznaczoneDni()).toEqual([]);
  });
});

describe("wartość, której nie da się przeczytać", () => {
  it.each([
    ["bez godziny", "jutro"],
    ["z godziną", "jutroTwieczorem"],
  ])("nieczytelna wartość %s nie zaznacza niczego i nie przesuwa kalendarza", (_nazwa, value) => {
    pole({ value });
    const o = otworz();
    expect(within(o).getByText("czerwiec 2099")).toBeTruthy();
    expect(zaznaczoneDni()).toEqual([]);
    expect(zaznaczone(K.hours)).toEqual([]);
    expect(zaznaczone(K.minutes)).toEqual([]);
  });

  it("wybór dnia przy nieczytelnej wartości startuje od 18:00, jak przy pustym polu", () => {
    const { onChange } = pole({ value: "jutroTwieczorem" });
    otworz();
    const dzienWydarzenia = relativeDate(3 * DZIEN);
    fireEvent.click(dzien(dzienWydarzenia));
    expect(onChange).toHaveBeenCalledWith(`${dzienPola(dzienWydarzenia)}T18:00`);
  });
});

describe("wybór dnia", () => {
  it("bez wartości wybrany dzień dostaje domyślną godzinę 18:00, a okno zostaje otwarte", () => {
    const { onChange } = pole();
    otworz();
    const zaTydzien = relativeDate(7 * DZIEN);
    fireEvent.click(dzien(zaTydzien));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(`${dzienPola(zaTydzien)}T18:00`);
    expect(okno()).not.toBeNull();
  });

  it("przy zapisanym terminie nowy dzień zachowuje godzinę i minutę", () => {
    const { onChange } = pole({ value: chwilaPola(TERMIN) });
    otworz();
    fireEvent.click(dzien(oGodzinie(37, 0, 0)));
    expect(onChange).toHaveBeenCalledWith(chwilaPola(oGodzinie(37, 14, 37)));
  });

  it("w trybie całodniowym wybór dnia oddaje samą datę i zamyka okno", () => {
    const { onChange } = pole({ allDay: true });
    otworz();
    const zaTydzien = relativeDate(7 * DZIEN);
    fireEvent.click(dzien(zaTydzien));
    expect(onChange).toHaveBeenCalledWith(dzienPola(zaTydzien));
    expect(okno()).toBeNull();
  });

  it("zapisana sama data: okno stoi na jej miesiącu, a nowy dzień to znów sama data", () => {
    const { onChange } = pole({ value: dzienPola(TERMIN), allDay: true });
    const o = otworz();
    expect(within(o).getByText("lipiec 2099")).toBeTruthy();
    expect(zaznaczoneDni()).toEqual([String(TERMIN.getDate())]);
    fireEvent.click(dzien(relativeDate(36 * DZIEN)));
    expect(onChange).toHaveBeenCalledWith(dzienPola(relativeDate(36 * DZIEN)));
  });

  it("ponowne kliknięcie zaznaczonego dnia NIE czyści terminu", () => {
    const { onChange } = pole({ value: chwilaPola(TERMIN) });
    otworz();
    fireEvent.click(dzien(TERMIN));
    expect(onChange).not.toHaveBeenCalled();
    expect(okno()).not.toBeNull();
  });
});

describe("kolumny godzin i minut", () => {
  it("tryb całodniowy nie pokazuje kolumn godzin i minut", () => {
    pole({ allDay: true });
    otworz();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("kolumna godzin ma pełną dobę 00-23, a kolumna minut dwanaście pozycji co pięć", () => {
    pole();
    otworz();
    const godziny = within(kolumna(K.hours))
      .getAllByRole("option")
      .map((o) => o.textContent);
    const minuty = within(kolumna(K.minutes))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(godziny).toEqual(Array.from({ length: 24 }, (_, i) => dwa(i)));
    expect(minuty).toEqual(Array.from({ length: 12 }, (_, i) => dwa(i * 5)));
  });

  it("zapisana godzina jest zaznaczona, a minuta spoza siatki podświetla niższą piątkę", () => {
    pole({ value: chwilaPola(TERMIN) });
    otworz();
    expect(zaznaczone(K.hours)).toEqual(["14"]);
    expect(zaznaczone(K.minutes)).toEqual(["35"]);
  });

  it("zaznaczone pozycje są przewijane na środek swoich kolumn", () => {
    const przewin = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    pole({ value: chwilaPola(TERMIN) });
    otworz();
    expect(przewiniete(przewin)).toEqual(expect.arrayContaining(["14", "35"]));
    expect(przewin).toHaveBeenCalledWith({ block: "center" });
  });

  it("bez wartości nic nie jest zaznaczone ani przewijane", () => {
    const przewin = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    pole();
    otworz();
    expect(zaznaczone(K.hours)).toEqual([]);
    expect(zaznaczone(K.minutes)).toEqual([]);
    expect(przewin).not.toHaveBeenCalled();
  });

  it("wybór godziny bez wartości ustawia dziś o pełnej wybranej godzinie", () => {
    const { onChange } = pole();
    otworz();
    fireEvent.click(pozycja(K.hours, "09"));
    expect(onChange).toHaveBeenCalledWith(`${dzienPola(DZIS)}T09:00`);
  });

  it("wybór minuty bez wartości ustawia dziś, bieżącą godzinę i wybraną minutę", () => {
    const { onChange } = pole();
    otworz();
    fireEvent.click(pozycja(K.minutes, "25"));
    expect(onChange).toHaveBeenCalledWith(`${dzienPola(DZIS)}T${dwa(DZIS.getHours())}:25`);
  });

  it("wybór godziny przy zapisanym terminie zmienia TYLKO godzinę i nie zamyka okna", () => {
    const { onChange } = pole({ value: chwilaPola(TERMIN) });
    otworz();
    fireEvent.click(pozycja(K.hours, "09"));
    expect(onChange).toHaveBeenCalledWith(chwilaPola(oGodzinie(35, 9, 37)));
    expect(okno()).not.toBeNull();
  });

  it("wybór minuty przy zapisanym terminie zmienia TYLKO minutę", () => {
    const { onChange } = pole({ value: chwilaPola(TERMIN) });
    otworz();
    fireEvent.click(pozycja(K.minutes, "50"));
    expect(onChange).toHaveBeenCalledWith(chwilaPola(oGodzinie(35, 14, 50)));
  });
});

describe("przycisk „Teraz”", () => {
  it("w trybie z godziną wstawia bieżącą chwilę z dokładnością do minuty, bez zaokrąglania", () => {
    advanceClock(7 * MINUTA + 42 * SEKUNDA);
    const { onChange } = pole();
    otworz();
    nacisnij(K.now);
    // 12:07:42 to wciąż 12:07 - sekundy są ucinane, a nie zaokrąglane do 12:08.
    expect(onChange).toHaveBeenCalledWith(chwilaPola(relativeDate(7 * MINUTA)));
    expect(okno()).not.toBeNull();
  });

  it("w trybie całodniowym wstawia samą dzisiejszą datę", () => {
    const { onChange } = pole({ allDay: true });
    otworz();
    nacisnij(K.now);
    expect(onChange).toHaveBeenCalledWith(dzienPola(DZIS));
  });
});

describe("przepływ z rodzicem, który trzyma wartość", () => {
  it("dzień, potem godzina, potem minuta składają się w jeden termin widoczny w polu", () => {
    const onChange = vi.fn<(value: string) => void>();
    render(<Sterowane onChange={onChange} />);
    otworz();
    const zaTydzien = relativeDate(7 * DZIEN);
    fireEvent.click(dzien(zaTydzien));
    fireEvent.click(pozycja(K.hours, "09"));
    fireEvent.click(pozycja(K.minutes, "45"));
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([
      `${dzienPola(zaTydzien)}T18:00`,
      `${dzienPola(zaTydzien)}T09:00`,
      `${dzienPola(zaTydzien)}T09:45`,
    ]);
    expect(wpis()).toHaveValue(`${dzienPola(zaTydzien)}T09:45`);
    expect(zaznaczone(K.hours)).toEqual(["09"]);
    expect(zaznaczone(K.minutes)).toEqual(["45"]);
  });

  it("nowo zaznaczona godzina też jest przewijana na środek kolumny", () => {
    const przewin = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    render(<Sterowane onChange={() => {}} />);
    otworz();
    fireEvent.click(pozycja(K.hours, "21"));
    expect(przewiniete(przewin)).toContain("21");
  });

  it("„Wyczyść” po wyborze opróżnia pole, a ponowne otwarcie startuje bez zaznaczeń", () => {
    render(<Sterowane onChange={() => {}} />);
    otworz();
    fireEvent.click(dzien(relativeDate(7 * DZIEN)));
    nacisnij(K.clear);
    expect(wpis()).toHaveValue("");
    otworz();
    expect(zaznaczoneDni()).toEqual([]);
    expect(zaznaczone(K.hours)).toEqual([]);
  });
});

describe("klawiatura w oknie wyboru", () => {
  // Kalendarz dostawał `initialFocus`, a `react-day-picker` 9.x tej właściwości
  // już NIE CZYTA (została tylko w typach jako przestarzała; hook fokusu czyta
  // wyłącznie `autoFocus`). Skutek: po otwarciu fokus lądował na „poprzedni
  // miesiąc" (pierwszy element okna według Radiksa), a nie na zaznaczonym dniu,
  // więc strzałki nie chodziły po dniach, dopóki użytkownik nie „dotabował" się
  // do siatki. Ten przypadek był czerwony do poprawki na `autoFocus`.
  it("po otwarciu fokus stoi na zaznaczonym dniu, więc strzałki od razu chodzą po dniach", () => {
    pole({ value: chwilaPola(TERMIN) });
    otworz();
    expect(document.activeElement).toBe(dzien(TERMIN));
  });
});
