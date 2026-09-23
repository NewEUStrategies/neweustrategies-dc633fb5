// Organizm „Dodaj sekcję sponsorów" - dwuetapowe okno: najpierw wybór układu
// (Baner / Siatka logo), potem tytuł sekcji po polsku i po angielsku.
//
// CO TEN PLIK DOWODZI.
//   1. PIERWSZY KROK TO WYBÓR UKŁADU, NIE FORMULARZ. Okno otwiera się listą
//      dwóch układów z opisem; bez wyboru nie ma pól ani przycisku zapisu,
//      a podpowiedź „co dalej" jest tylko dla czytnika ekranu.
//   2. WYBÓR UKŁADU STEROWUJE DRUGIM KROKIEM. Tytuł okna i przycisk zapisu
//      mówią, JAKĄ sekcję się tworzy (baner albo siatkę), a „Wstecz" wraca do
//      listy układów.
//   3. SEKCJA BEZ TYTUŁU NIE WYCHODZI Z OKNA. Puste (albo same spacje) oba pola
//      zatrzymują zapis i pokazują komunikat; poprawienie tytułu go zdejmuje.
//   4. JEDEN JĘZYK WYSTARCZY. Tytuł podany tylko po polsku trafia też jako
//      angielski i odwrotnie - sekcja nigdy nie ma pustego nagłówka w drugim
//      języku strony. Oba tytuły idą przycięte.
//   5. KAŻDE OTWARCIE TO NOWA PRACA. Ponowne otwarcie okna zaczyna od wyboru
//      układu, z pustymi polami i bez komunikatu z poprzedniej próby.
//   6. W TRAKCIE ZAPISU PRZYCISK JEST ZGASZONY, a zamknięcie okna idzie przez
//      `onOpenChange(false)`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Tego, co rodzic robi z ładunkiem (zapis
// poziomu, `setTierLayout`, limit firm baneru) - to `SponsorSectionsBoard`,
// testowany osobno. Okno nie woła bazy, więc nie ma tu atrap hooków.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import type { NewSectionInput } from "@/components/admin/events/organisms/AddSponsorSectionDialog";

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  submitted: [] as NewSectionInput[],
  openChanges: [] as boolean[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

import { AddSponsorSectionDialog } from "@/components/admin/events/organisms/AddSponsorSectionDialog";

const A = "sponsorBoard.add";

function okienko(open = true, isSaving = false) {
  const props = {
    onOpenChange: (next: boolean) => {
      h.openChanges.push(next);
    },
    onSubmit: (input: NewSectionInput) => {
      h.submitted.push(input);
    },
  };
  const widok = render(<AddSponsorSectionDialog open={open} isSaving={isSaving} {...props} />);
  return {
    przerysuj: (nextOpen: boolean, saving = false) =>
      widok.rerender(<AddSponsorSectionDialog open={nextOpen} isSaving={saving} {...props} />),
  };
}

const okno = (): HTMLElement => screen.getByRole("dialog");

function kliknij(element: HTMLElement): void {
  act(() => {
    fireEvent.click(element);
  });
}

function wybierzUklad(uklad: "banner" | "grid"): void {
  kliknij(within(okno()).getByRole("button", { name: `${A}.${uklad}Title ${A}.${uklad}Desc` }));
}

function wpisz(etykieta: string, wartosc: string): void {
  fireEvent.change(within(okno()).getByLabelText(etykieta), { target: { value: wartosc } });
}

function zatwierdz(nazwa: string): void {
  kliknij(within(okno()).getByRole("button", { name: nazwa }));
}

beforeEach(() => {
  h.lang = "pl";
  h.submitted = [];
  h.openChanges = [];
});

describe("krok pierwszy - wybór układu", () => {
  it("zamknięte okno nie rysuje niczego", () => {
    okienko(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(["pl", "en"])(
    "w języku %s okno zaczyna od listy dwóch układów z opisami, bez formularza",
    (lang) => {
      h.lang = lang;
      okienko();
      const w = within(okno());
      expect(w.getByRole("heading", { name: `${A}.title` })).toBeTruthy();
      expect(w.getByRole("button", { name: `${A}.bannerTitle ${A}.bannerDesc` })).toBeTruthy();
      expect(w.getByRole("button", { name: `${A}.gridTitle ${A}.gridDesc` })).toBeTruthy();
      expect(w.queryByLabelText(`${A}.titlePl`)).toBeNull();
      expect(w.queryByRole("button", { name: `${A}.back` })).toBeNull();
    },
  );

  it("podpowiedź „co dalej” jest w pierwszym kroku tylko dla czytnika ekranu", () => {
    okienko();
    expect(within(okno()).getByText(`${A}.hintNext`).className).toContain("sr-only");
  });
});

describe("krok drugi - tytuł sekcji", () => {
  it("baner: tytuł okna, widoczna podpowiedź, pola PL/EN z przykładami i przycisk baneru", () => {
    okienko();
    wybierzUklad("banner");
    const w = within(okno());
    expect(w.getByRole("heading", { name: `${A}.bannerTitle` })).toBeTruthy();
    expect(w.getByText(`${A}.hintNext`).className).not.toContain("sr-only");
    expect(w.getByLabelText(`${A}.titlePl`).getAttribute("placeholder")).toBe(
      `${A}.titlePlaceholderPl`,
    );
    expect(w.getByLabelText(`${A}.titleEn`).getAttribute("placeholder")).toBe(
      `${A}.titlePlaceholderEn`,
    );
    expect(w.getByRole("button", { name: `${A}.submitBanner` })).toBeTruthy();
  });

  it("siatka: tytuł okna i przycisk mówią o siatce", () => {
    okienko();
    wybierzUklad("grid");
    const w = within(okno());
    expect(w.getByRole("heading", { name: `${A}.gridTitle` })).toBeTruthy();
    expect(w.getByRole("button", { name: `${A}.submitGrid` })).toBeTruthy();
  });

  it("tytuły mają limit 120 znaków w obu językach", () => {
    okienko();
    wybierzUklad("grid");
    expect(within(okno()).getByLabelText(`${A}.titlePl`).getAttribute("maxlength")).toBe("120");
    expect(within(okno()).getByLabelText(`${A}.titleEn`).getAttribute("maxlength")).toBe("120");
  });

  it("„Wstecz” wraca do listy układów", () => {
    okienko();
    wybierzUklad("banner");
    kliknij(within(okno()).getByRole("button", { name: `${A}.back` }));
    expect(within(okno()).getByRole("heading", { name: `${A}.title` })).toBeTruthy();
    expect(within(okno()).queryByLabelText(`${A}.titlePl`)).toBeNull();
  });
});

describe("zapis sekcji", () => {
  it.each<[string, string]>([
    ["puste pola", ""],
    ["same spacje", "   "],
  ])("%s nie wychodzą z okna i dają komunikat", (_nazwa, wartosc) => {
    okienko();
    wybierzUklad("banner");
    wpisz(`${A}.titlePl`, wartosc);
    wpisz(`${A}.titleEn`, wartosc);
    zatwierdz(`${A}.submitBanner`);
    expect(within(okno()).getByRole("alert").textContent).toBe(`${A}.titleRequired`);
    expect(h.submitted).toEqual([]);
  });

  it("komunikatu nie ma przed pierwszą próbą zapisu", () => {
    okienko();
    wybierzUklad("banner");
    expect(within(okno()).queryByRole("alert")).toBeNull();
  });

  it("wpisanie tytułu po odmowie zdejmuje komunikat", () => {
    okienko();
    wybierzUklad("grid");
    zatwierdz(`${A}.submitGrid`);
    expect(within(okno()).getByRole("alert")).toBeTruthy();
    wpisz(`${A}.titleEn`, "Partners");
    expect(within(okno()).queryByRole("alert")).toBeNull();
  });

  it("oba tytuły idą przycięte, każdy w swoim języku, z wybranym układem", () => {
    okienko();
    wybierzUklad("banner");
    wpisz(`${A}.titlePl`, "  Partner główny ");
    wpisz(`${A}.titleEn`, " Main partner  ");
    zatwierdz(`${A}.submitBanner`);
    expect(h.submitted).toEqual([
      { layout: "banner", namePl: "Partner główny", nameEn: "Main partner" },
    ]);
  });

  it("tytuł tylko po polsku trafia także jako angielski", () => {
    okienko();
    wybierzUklad("grid");
    wpisz(`${A}.titlePl`, " Partnerzy ");
    zatwierdz(`${A}.submitGrid`);
    expect(h.submitted).toEqual([{ layout: "grid", namePl: "Partnerzy", nameEn: "Partnerzy" }]);
  });

  it("tytuł tylko po angielsku trafia także jako polski", () => {
    okienko();
    wybierzUklad("grid");
    wpisz(`${A}.titleEn`, "Partners ");
    wpisz(`${A}.titlePl`, "   ");
    zatwierdz(`${A}.submitGrid`);
    expect(h.submitted).toEqual([{ layout: "grid", namePl: "Partners", nameEn: "Partners" }]);
  });

  it("w trakcie zapisu przycisk jest zgaszony", () => {
    okienko(true, true);
    wybierzUklad("banner");
    expect(within(okno()).getByRole("button", { name: `${A}.submitBanner` })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("otwieranie i zamykanie", () => {
  it("ponowne otwarcie zaczyna od wyboru układu, z pustymi polami i bez komunikatu", () => {
    const widok = okienko();
    wybierzUklad("banner");
    zatwierdz(`${A}.submitBanner`);
    wpisz(`${A}.titleEn`, "Stary tytuł");
    widok.przerysuj(false);
    widok.przerysuj(true);
    expect(within(okno()).getByRole("heading", { name: `${A}.title` })).toBeTruthy();
    wybierzUklad("banner");
    expect(within(okno()).getByLabelText(`${A}.titleEn`)).toHaveProperty("value", "");
    expect(within(okno()).getByLabelText(`${A}.titlePl`)).toHaveProperty("value", "");
    expect(within(okno()).queryByRole("alert")).toBeNull();
  });

  it("Escape prosi rodzica o zamknięcie okna", () => {
    okienko();
    fireEvent.keyDown(okno(), { key: "Escape" });
    expect(h.openChanges).toEqual([false]);
  });
});
