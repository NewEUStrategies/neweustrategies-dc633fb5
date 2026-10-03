// Molekula budzetu klikniec linku podarunkowego („2 z 5 osob otworzylo").
//
// PO CO OSOBNY PLIK. Organizm (`GiftArticleButton`) zawsze podaje tu budzet
// policzony przez `giftClickBudget` i zawsze z klasa `mb-3` - wiec przez niego
// nie da sie sprawdzic, co molekula robi z danymi NIESPOJNYMI albo bez klasy.
// A to jest liczba, ktora nadawca czyta, zanim wysle link kolejnej osobie:
//   1. „null" albo „NaN" zamiast liczby pozostalych otwarc wyglada jak awaria
//      i nie mowi nadawcy, czy link jeszcze cokolwiek otworzy.
//   2. Licznik zuzycia NIE MOZE przekroczyc limitu („9 z 5") - serwer potrafi
//      zliczyc wiecej odbiorcow, niz wynosil cap, ale pasek ma pokazac pelny
//      budzet, a nie wyjsc poza skale.
//   3. Budzet bez limitu to INNA obietnica (tekst zamiast paska) - pasek
//      „0 z 0" czytalby sie jako „nikt nie przeczyta".
//
// ATRAPY: tylko i18n (echo klucza z parametrami, jak w plikach organizmu).
// Atom `QuotaMeter` biegnie prawdziwy.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { giftClickBudget, type GiftClickBudget } from "@/lib/gifting/model";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0 ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock("@/lib/i18n-gifting", () => ({}));

import { GiftClickBudgetMeter } from "../GiftClickBudgetMeter";

describe("GiftClickBudgetMeter - budzet bez limitu", () => {
  it("pokazuje TEKST zamiast paska i nie wkleja `undefined` do klas", () => {
    // Organizm zawsze podaje `className`; inny wywolujacy moze go pominac -
    // „undefined" w atrybucie class to smiec w DOM i potencjalny selektor.
    render(<GiftClickBudgetMeter budget={giftClickBudget(120, 0)} />);
    const tekst = screen.getByTestId("gift-budget-unlimited");
    expect(tekst).toHaveTextContent("gifting.budget.unlimited");
    expect(tekst.getAttribute("class")).not.toContain("undefined");
    expect(screen.queryByTestId("quota-meter")).toBeNull();
  });

  it("klasa wywolujacego trafia na element tekstu", () => {
    render(<GiftClickBudgetMeter budget={giftClickBudget(0, 0)} className="mb-3" />);
    expect(screen.getByTestId("gift-budget-unlimited").className).toContain("mb-3");
  });
});

describe("GiftClickBudgetMeter - budzet z limitem", () => {
  it("pozostale otwarcia i pasek ida z liczb serwera", () => {
    render(<GiftClickBudgetMeter budget={giftClickBudget(2, 5)} />);
    const budzet = screen.getByTestId("gift-budget");
    expect(budzet).toHaveAttribute("data-remaining", "3");
    expect(budzet).toHaveTextContent('gifting.budget.remaining {"count":3}');
    expect(screen.getByTestId("quota-meter")).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByTestId("quota-meter")).toHaveAttribute("aria-valuemax", "5");
  });

  it("NIESPOJNY budzet (`remaining: null` przy limicie) liczy sie jako 0, a nie `null`", () => {
    // Wynik RPC zlozony recznie albo starsza wersja funkcji: limit jest, ale
    // `remaining` nie przyszlo. Nadawca ma zobaczyc „0 pozostalo", a nie
    // „null pozostalo" - i nie moze dostac obietnicy otwarc, ktorych nie ma.
    const budget: GiftClickBudget = {
      used: 1,
      limit: 5,
      remaining: null,
      exhausted: false,
      unlimited: false,
    };
    render(<GiftClickBudgetMeter budget={budget} />);
    const budzet = screen.getByTestId("gift-budget");
    expect(budzet).toHaveAttribute("data-remaining", "0");
    expect(budzet).toHaveTextContent('gifting.budget.remaining {"count":0}');
    expect(budzet.textContent).not.toMatch(/null|NaN/);
  });

  it("zuzycie PONAD limit jest przyciete do limitu na pasku i w podpisie", () => {
    // Serwer potrafi doliczyc wiecej odbiorcow niz cap (wyscig rownoleglych
    // otwarc). „9 z 5" wyglada jak blad licznika; pasek ma byc po prostu pelny.
    render(<GiftClickBudgetMeter budget={giftClickBudget(9, 5)} />);
    expect(screen.getByTestId("quota-meter")).toHaveAttribute("aria-valuenow", "5");
    expect(screen.getByTestId("gift-budget")).toHaveTextContent(
      'gifting.budget.progressValue {"used":5,"limit":5}',
    );
    expect(screen.getByTestId("gift-budget").textContent).not.toContain('"used":9');
  });

  it("WYCZERPANY budzet mowi to wprost, zamiast '0 pozostalo'", () => {
    render(<GiftClickBudgetMeter budget={giftClickBudget(5, 5)} />);
    const budzet = screen.getByTestId("gift-budget");
    expect(budzet).toHaveTextContent("gifting.budget.exhaustedLabel");
    expect(budzet).not.toHaveTextContent("gifting.budget.remaining");
  });
});
