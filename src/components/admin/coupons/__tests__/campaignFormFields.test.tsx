// Trzy molekuły formularza kampanii: kształt kodów, rabat i to, co kampania nadaje.
// RYZYKIEM jest tu WEJŚCIE do stanu - każde z tych pól zasila ładunek, którym
// panel rozdaje pieniądze i subskrypcje.
//
// CO TEN PLIK DOWODZI.
//   1. Pola liczbowe oddają LICZBĘ, nie tekst - i właśnie dlatego wyczyszczenie
//      pola oddaje ZERO (`Number("") === 0`), a nie „brak wartości". Baza ma na
//      to CHECK-i, więc panel wysyła żądanie skazane na odmowę. Ten defekt jest
//      niewidoczny w `tsc` (typ się zgadza: to number) i w recenzji (jedna
//      linijka `Number(e.target.value)`).
//   2. Wybór rodzaju rabatu USUWA z drzewa pola drugiego rodzaju - to on
//      gwarantuje, że w ładunku niepuste jest dokładnie jedno pole rabatu.
//   3. Pole liczby dni jest zablokowane BEZ warstwy - ale blokada dotyczy
//      klawiatury, nie pamięci formularza: wartość wpisana wcześniej zostaje
//      w stanie i molekuła jej NIE CZYŚCI.
//   4. Wybór „brak" oddaje PUSTY STRING, a nie sentinel „none" - inaczej do
//      bazy poszedłby klucz warstwy o nazwie „none".
//   5. Prefiks jest podnoszony do wielkich liter już przy wpisywaniu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Kształtu ładunku i bramki zapisu - to
// `couponCampaignForm.test.ts`.
//
// DLACZEGO Radix `Select` JEST ATRAPĄ. Pod happy-dom nie ma pełnego API
// wskaźnika, więc lista rozwijana nigdy się nie otwiera i żadna pozycja nie
// trafia do DOM. Atrapa jest natywnym `<select>`/`<option>`, dzięki czemu
// WSZYSTKIE pozycje naprawdę istnieją, a wybór idzie tą samą drogą co
// w produkcji - przez `onValueChange`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
  }) => (
    <select
      aria-label="wybor"
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import { CampaignCodeShapeFields } from "@/components/admin/coupons/molecules/CampaignCodeShapeFields";
import { CampaignDiscountFields } from "@/components/admin/coupons/molecules/CampaignDiscountFields";
import { CampaignGrantsFields } from "@/components/admin/coupons/molecules/CampaignGrantsFields";

afterEach(cleanup);

describe("kształt generowanych kodów", () => {
  function renderShape(overrides: Partial<Parameters<typeof CampaignCodeShapeFields>[0]> = {}) {
    const props = {
      prefix: "",
      onPrefix: vi.fn(),
      codeLength: 8,
      onCodeLength: vi.fn(),
      codeCount: 100,
      onCodeCount: vi.fn(),
      labels: { prefix: "Prefiks", codeLength: "Długość kodu", codeCount: "Liczba kodów" },
      ...overrides,
    };
    render(<CampaignCodeShapeFields {...props} />);
    return props;
  }

  it("prefiks jest podnoszony do WIELKICH LITER już przy wpisywaniu", () => {
    const props = renderShape();
    fireEvent.change(screen.getByLabelText("Prefiks"), { target: { value: "nes-" } });
    expect(props.onPrefix).toHaveBeenCalledWith("NES-");
  });

  it("liczba kodów wychodzi jako LICZBA, nie jako tekst z pola", () => {
    const props = renderShape();
    fireEvent.change(screen.getByLabelText("Liczba kodów"), { target: { value: "250" } });
    expect(props.onCodeCount).toHaveBeenCalledWith(250);
  });

  it("WYCZYSZCZENIE pola liczby kodów oddaje ZERO, a nie brak wartości", () => {
    // `Number("")` to 0 - i to zero leci do bazy, gdzie CHECK wymaga > 0.
    const props = renderShape();
    fireEvent.change(screen.getByLabelText("Liczba kodów"), { target: { value: "" } });
    expect(props.onCodeCount).toHaveBeenCalledWith(0);
  });

  it("WYCZYSZCZENIE pola długości kodu też oddaje ZERO (baza wymaga 4-24)", () => {
    const props = renderShape();
    fireEvent.change(screen.getByLabelText("Długość kodu"), { target: { value: "" } });
    expect(props.onCodeLength).toHaveBeenCalledWith(0);
  });

  it("atrybuty min/max są podpowiedzią przeglądarki, a nie walidacją - wartość spoza zakresu przechodzi", () => {
    const props = renderShape();
    fireEvent.change(screen.getByLabelText("Liczba kodów"), { target: { value: "99999" } });
    expect(props.onCodeCount).toHaveBeenCalledWith(99999);
  });
});

describe("rodzaj rabatu kampanii", () => {
  function renderDiscount(overrides: Partial<Parameters<typeof CampaignDiscountFields>[0]> = {}) {
    const props = {
      kind: "percent" as const,
      onKind: vi.fn(),
      percent: 20,
      onPercent: vi.fn(),
      cents: 2000,
      onCents: vi.fn(),
      currency: "PLN",
      onCurrency: vi.fn(),
      labels: {
        discountType: "Typ rabatu",
        percentOption: "%",
        fixedOption: "Kwota",
        percent: "Procent",
        amountCents: "Kwota (grosze)",
        currency: "Waluta",
      },
      ...overrides,
    };
    render(<CampaignDiscountFields {...props} />);
    return props;
  }

  it("rabat procentowy USUWA z drzewa pola kwoty i waluty", () => {
    renderDiscount({ kind: "percent" });
    expect(screen.getByLabelText("Procent")).toBeInTheDocument();
    expect(screen.queryByLabelText("Kwota (grosze)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Waluta")).not.toBeInTheDocument();
  });

  it("rabat kwotowy USUWA z drzewa pole procentu i pokazuje kwotę z walutą", () => {
    renderDiscount({ kind: "fixed" });
    expect(screen.queryByLabelText("Procent")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Kwota (grosze)")).toBeInTheDocument();
    expect(screen.getByLabelText("Waluta")).toBeInTheDocument();
  });

  it("obie pozycje listy rodzaju rabatu istnieją i wybór oddaje wartość enumu", () => {
    const props = renderDiscount();
    fireEvent.change(screen.getByLabelText("wybor"), { target: { value: "fixed" } });
    expect(props.onKind).toHaveBeenCalledWith("fixed");
  });

  it("procent wychodzi jako LICZBA, a wyczyszczone pole jako ZERO", () => {
    const props = renderDiscount({ kind: "percent" });
    fireEvent.change(screen.getByLabelText("Procent"), { target: { value: "35" } });
    expect(props.onPercent).toHaveBeenCalledWith(35);
    fireEvent.change(screen.getByLabelText("Procent"), { target: { value: "" } });
    expect(props.onPercent).toHaveBeenCalledWith(0);
  });

  it("pole waluty przyjmuje TEKST bez zmiany wielkości liter - podnosi ją dopiero ładunek", () => {
    const props = renderDiscount({ kind: "fixed" });
    fireEvent.change(screen.getByLabelText("Waluta"), { target: { value: "eur" } });
    expect(props.onCurrency).toHaveBeenCalledWith("eur");
  });

  it("walutę można WYCZYŚCIĆ - formularz nie broni kwoty bez jednostki", () => {
    const props = renderDiscount({ kind: "fixed" });
    fireEvent.change(screen.getByLabelText("Waluta"), { target: { value: "" } });
    expect(props.onCurrency).toHaveBeenCalledWith("");
  });
});

describe("co kampania nadaje", () => {
  const TIERS = [
    { key: "gold", label: "Złoty" },
    { key: "silver", label: "Srebrny" },
  ];

  function renderGrants(overrides: Partial<Parameters<typeof CampaignGrantsFields>[0]> = {}) {
    const props = {
      tiers: TIERS,
      tierKey: "",
      onTierKey: vi.fn(),
      durationDays: "30",
      onDurationDays: vi.fn(),
      labels: {
        grantsSubscription: "Nadaje subskrypcję",
        none: "Brak",
        durationDays: "Liczba dni",
      },
      ...overrides,
    };
    render(<CampaignGrantsFields {...props} />);
    return props;
  }

  it("lista niesie pozycję 'brak' ORAZ wszystkie warstwy z etykietami z zewnątrz", () => {
    renderGrants();
    const opcje = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opcje).toEqual(["Brak", "Złoty", "Srebrny"]);
  });

  it("wybór warstwy oddaje jej KLUCZ, a nie widoczną nazwę", () => {
    const props = renderGrants();
    fireEvent.change(screen.getByLabelText("wybor"), { target: { value: "gold" } });
    expect(props.onTierKey).toHaveBeenCalledWith("gold");
  });

  it("wybór 'brak' oddaje PUSTY STRING - sentinel 'none' nie ma prawa dojść do bazy", () => {
    const props = renderGrants({ tierKey: "gold" });
    fireEvent.change(screen.getByLabelText("wybor"), { target: { value: "none" } });
    expect(props.onTierKey).toHaveBeenCalledWith("");
  });

  it("pole liczby dni jest ZABLOKOWANE, dopóki nie wybrano warstwy", () => {
    renderGrants({ tierKey: "" });
    expect(screen.getByLabelText("Liczba dni")).toBeDisabled();
  });

  it("po wybraniu warstwy pole dni jest edytowalne i oddaje TEKST (pusty = bezterminowo)", () => {
    const props = renderGrants({ tierKey: "gold" });
    const pole = screen.getByLabelText("Liczba dni");
    expect(pole).not.toBeDisabled();
    fireEvent.change(pole, { target: { value: "" } });
    expect(props.onDurationDays).toHaveBeenCalledWith("");
  });

  it("powrót do 'brak' NIE CZYŚCI liczby dni - wartość zostaje w stanie formularza", () => {
    // Molekuła świadomie nie czyści: bramkę stawia dopiero `buildCampaignInsert`
    // (`durationDays && tierKey`). Bliźniaczy formularz kuponu tej bramki nie ma.
    const props = renderGrants({ tierKey: "gold", durationDays: "90" });
    fireEvent.change(screen.getByLabelText("wybor"), { target: { value: "none" } });
    expect(props.onTierKey).toHaveBeenCalledWith("");
    expect(props.onDurationDays).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Liczba dni")).toHaveValue(90);
  });
});
