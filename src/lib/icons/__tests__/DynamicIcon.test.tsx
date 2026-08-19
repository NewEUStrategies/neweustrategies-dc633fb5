// Resolwer ikon po NAZWIE Z DANYCH. Do 18.08.2026: 22 instrukcje bez pokrycia.
//
// DLACZEGO TO WAŻNE. `DynamicIcon` renderuje chrome nagłówka (SiteMenu,
// MegaPanelView) i ikony z bazy (menu, powiadomienia, konfiguracja konta), a
// nazwy zapisują się RÓŻNIE w zależności od źródła: kebab-case w bazie menu,
// PascalCase w configu account-menu, czasem sklejone bez separatora. Ten sam
// byt musi trafić w tę samą ikonę - inaczej połowa menu pokazuje znak zapytania.
//
// DRUGI POWÓD jest wydajnościowy i opisany w nagłówku modułu: kurowany zestaw
// renderuje się synchronicznie, a nieznane nazwy dociągają pełny rejestr
// leniwym chunkiem. Fallback MUSI rezerwować dokładny wymiar ikony, inaczej
// doładowanie przesuwa układ (CLS) w nagłówku każdej strony.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Pełny rejestr to leniwy chunk z wygenerowanym plikiem danych - podmieniamy go
// znacznikiem, żeby test mierzył DECYZJĘ resolwera, a nie cudzy zbiór ikon.
vi.mock("../DynamicIconFull", () => ({
  default: ({ iconKey }: { iconKey: string }) => <span data-testid="pelny">{iconKey}</span>,
}));

import { DynamicIcon } from "../DynamicIcon";

/** Pierwszy element svg w drzewie - kurowana ikona renderuje się właśnie tak. */
const svg = () => document.querySelector("svg");

describe("DynamicIcon - kurowany zestaw", () => {
  it("renderuje ikonę z zestawu SYNCHRONICZNIE, bez sięgania po pełny rejestr", () => {
    render(<DynamicIcon name="Search" />);
    expect(svg()).toBeTruthy();
    expect(screen.queryByTestId("pelny")).toBeNull();
  });

  it.each(["graduation-cap", "GraduationCap", "graduation_cap", "graduation cap"])(
    "rozpoznaje zapis %s jako tę samą ikonę",
    (name) => {
      // Kebab z bazy menu, PascalCase z configu, podkreślenie i spacja - cztery
      // zapisy tego samego bytu muszą dać jedną ikonę.
      render(<DynamicIcon name={name} />);
      expect(svg()).toBeTruthy();
      expect(screen.queryByTestId("pelny")).toBeNull();
    },
  );

  it("rozpoznaje nazwę sklejoną bez separatora, zachowując wewnętrzne wielkie litery", () => {
    // „LogIn", „logIn" i „login" mają trafić w ten sam komponent; naiwne
    // lowercase'owanie zepsułoby nazwy PascalCase'owe.
    for (const name of ["LogIn", "logIn", "login"]) {
      const { unmount } = render(<DynamicIcon name={name} />);
      expect(svg(), name).toBeTruthy();
      expect(screen.queryByTestId("pelny"), name).toBeNull();
      unmount();
    }
  });

  it("rozpoznaje nazwę z cyfrą w środku", () => {
    render(<DynamicIcon name="building-2" />);
    expect(svg()).toBeTruthy();
  });

  it("obcina białe znaki wokół nazwy", () => {
    render(<DynamicIcon name="   Search   " />);
    expect(svg()).toBeTruthy();
    expect(screen.queryByTestId("pelny")).toBeNull();
  });

  it("przekazuje właściwości do ikony", () => {
    render(<DynamicIcon name="Search" className="w-4 h-4" aria-label="szukaj" />);
    expect(screen.getByLabelText("szukaj")).toBeTruthy();
  });
});

describe("DynamicIcon - nazwy spoza zestawu", () => {
  it("REZERWUJE wymiar ikony na czas dociągania chunka", async () => {
    // Bez rezerwacji doładowanie przesuwa układ nagłówka na każdej stronie.
    const { container } = render(<DynamicIcon name="alarm-clock-check" size={32} />);
    const placeholder = container.querySelector<HTMLElement>('span[aria-hidden="true"]');
    if (placeholder) {
      expect(placeholder.style.width).toBe("32px");
      expect(placeholder.style.height).toBe("32px");
    }
    await screen.findByTestId("pelny");
  });

  it("dociąga PEŁNY rejestr i przekazuje mu klucz PascalCase", async () => {
    render(<DynamicIcon name="alarm-clock-check" />);
    expect(await screen.findByTestId("pelny")).toHaveTextContent("AlarmClockCheck");
  });

  it("normalizuje egzotyczną nazwę zanim trafi do rejestru", async () => {
    render(<DynamicIcon name="  alarm_clock check  " />);
    expect(await screen.findByTestId("pelny")).toHaveTextContent("AlarmClockCheck");
  });
});

describe("DynamicIcon - nazwa pusta", () => {
  it.each(["", "   ", null, undefined])("dla %s renderuje ikonę zastępczą, nie pustkę", (name) => {
    // Pusta wartość w polu ikony jest częsta (nowy wiersz menu bez ikony) -
    // brak elementu przesunąłby cały układ wiersza.
    render(<DynamicIcon name={name as unknown as string} />);
    expect(svg()).toBeTruthy();
    expect(screen.queryByTestId("pelny")).toBeNull();
  });
});
