// Molekuły formularza kuponu B2B: rabat, nadawana subskrypcja i ograniczenie
// do planów. TU POWSTAJĄ WARTOŚCI, KTÓRE ZA CHWILĘ TRAFIĄ DO TABELI RABATÓW.
//
// CO TEN PLIK DOWODZI.
//   1. RODZAJ RABATU DECYDUJE, KTÓRE POLE W OGÓLE ISTNIEJE. Przy procencie nie
//      ma ani kwoty, ani waluty - i to jest powód, dla którego ładunek nie
//      potrafi wysłać waluty bez kwoty.
//   2. POLA LICZBOWE GUBIĄ RÓŻNICĘ MIĘDZY „PUSTE” A „ZERO”: `Number("")` daje
//      `0`, więc wyczyszczenie pola procentu wygląda jak świadomy wybór zera.
//   3. WARTOŚĆ NIELICZBOWA WCHODZI DO STANU JAKO `NaN` - a `NaN` mija potem obie
//      bramki zakresu. Dowód stoi tu na DOM-ie, a jego kanoniczna wersja
//      w `lib/billing/__tests__/couponAdminForm.test.ts` (patrz uwaga
//      o sanityzatorze happy-dom przy tym teście).
//   4. POWRÓT DO „BRAK” PRZY SUBSKRYPCJI NIE CZYŚCI LICZBY DNI - pole jest
//      tylko wyłączane, a wpisana wartość zostaje i wychodzi do bazy jako
//      sierota. Zgłoszone parą `it.fails` + `it`.
//   5. LISTA PLANÓW ODDAJE ZAMIAR `(id, zaznaczony)`, a nie gotową tablicę -
//      dzięki temu deduplikacja jest decyzją organizmu (i dziś jej nie ma).
//   6. PLAN BEZ NAZW W OBU JĘZYKACH RENDERUJE PUSTĄ ETYKIETĘ - checkbox, którego
//      nie da się nazwać, to plan, którego operator nie potrafi wybrać świadomie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) `pickLocalized` - ma własny plik testowy;
// tutaj dowodzimy skutku jego POLITYKI dla planu bez nazw. (2) Budowy ładunku
// i walidacji - `couponAdminForm.test.ts`. (3) Sklejenia z zapisem - test
// organizmu `CouponCreateDialog.test.tsx`.
//
// Radix `Select` i `Checkbox` są podmienione na natywne odpowiedniki: pod
// happy-dom nie ma pełnego API wskaźnika.
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// Prawdziwa nakładka robi `addResourceBundle` przy imporcie i wciąga CAŁY
// i18next aplikacji - atrapa zostawia sam kontrakt „loader jest wołany".
vi.mock("@/lib/i18n-admin-coupons", () => ({ ensureI18n: () => undefined }));

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
    <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>
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

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));

import { CouponDiscountFields } from "../molecules/CouponDiscountFields";
import { CouponGrantsFields } from "../molecules/CouponGrantsFields";
import { CouponPlanRestrictionList } from "../molecules/CouponPlanRestrictionList";

/** Domyślne propy pól rabatu - nadpisujemy tylko to, czego dotyczy dowód. */
function rabat(overrides: Partial<Parameters<typeof CouponDiscountFields>[0]> = {}) {
  return {
    kind: "percent" as const,
    onKind: vi.fn(),
    percent: 10,
    onPercent: vi.fn(),
    cents: 1000,
    onCents: vi.fn(),
    currency: "PLN",
    onCurrency: vi.fn(),
    ...overrides,
  };
}

describe("pola rabatu", () => {
  it("rabat procentowy NIE pokazuje ani kwoty, ani waluty", () => {
    render(<CouponDiscountFields {...rabat()} />);
    expect(screen.getByText("adminCoupons.percent")).toBeInTheDocument();
    expect(screen.queryByText("adminCoupons.amountCents")).toBeNull();
    expect(screen.queryByText("adminCoupons.currency")).toBeNull();
  });

  it("rabat kwotowy pokazuje kwotę i walutę, a chowa procent", () => {
    render(<CouponDiscountFields {...rabat({ kind: "fixed" })} />);
    expect(screen.getByText("adminCoupons.amountCents")).toBeInTheDocument();
    expect(screen.getByText("adminCoupons.currency")).toBeInTheDocument();
    expect(screen.queryByText("adminCoupons.percent")).toBeNull();
  });

  it("wybór rodzaju rabatu wychodzi wartością enumu bazy, nie etykietą", () => {
    const props = rabat();
    render(<CouponDiscountFields {...props} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "fixed" } });
    expect(props.onKind).toHaveBeenCalledWith("fixed");
  });

  it("wpisany procent wychodzi jako LICZBA, nie jako napis", () => {
    const props = rabat();
    render(<CouponDiscountFields {...props} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "25" } });
    expect(props.onPercent).toHaveBeenCalledWith(25);
  });

  it("WYCZYSZCZENIE pola procentu wygląda jak wpisanie zera - różnica ginie", () => {
    // `Number("")` to `0`, a `0` przechodzi przez walidację jako „procent poza
    // zakresem” - komunikat jest ten sam, co przy świadomie wpisanym zerze.
    const props = rabat();
    render(<CouponDiscountFields {...props} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } });
    expect(props.onPercent).toHaveBeenCalledWith(0);
  });

  it("wartość nieliczbowa w polu procentu wchodzi do stanu jako NaN", () => {
    // UWAGA NA WIERNOŚĆ ŚRODOWISKA: happy-dom sanityzuje `input[type=number]`
    // łagodniej niż przeglądarka (`parseFloat` zamiast pełnej reguły HTML),
    // więc „12abc” tu przechodzi, a w Chrome dałoby "". Dowód jest wierny
    // wobec KODU (`Number(e.target.value)`), a nie wobec przeglądarki -
    // kanoniczne miejsce dowodu to `buildCouponInsert`.
    const props = rabat();
    render(<CouponDiscountFields {...props} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "12abc" } });
    const [przekazany] = (props.onPercent as ReturnType<typeof vi.fn>).mock.calls.at(-1) ?? [];
    expect(Number.isNaN(przekazany)).toBe(true);
  });

  it("waluta wychodzi tak, jak ją wpisano - podniesienie liter robi dopiero ładunek", () => {
    const props = rabat({ kind: "fixed" });
    render(<CouponDiscountFields {...props} />);
    fireEvent.change(screen.getByDisplayValue("PLN"), { target: { value: "eur" } });
    expect(props.onCurrency).toHaveBeenCalledWith("eur");
  });
});

const WARSTWY = [
  { key: "gold", name_pl: "Złoty", name_en: "Gold", active: true },
  { key: "silver", name_pl: "Srebrny", name_en: "Silver", active: true },
];

describe("pola nadawanej subskrypcji", () => {
  it("warstwy są wybierane KLUCZEM bazy, a opisane nazwą w języku interfejsu", () => {
    const onTierKey = vi.fn();
    render(
      <CouponGrantsFields
        tiers={WARSTWY}
        tierKey=""
        onTierKey={onTierKey}
        durationDays=""
        onDurationDays={vi.fn()}
        lang="pl"
      />,
    );
    expect(screen.getByRole("option", { name: "Złoty" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "gold" } });
    expect(onTierKey).toHaveBeenCalledWith("gold");
  });

  it("wybór „Brak” oddaje PUSTY napis, a nie wartość techniczną „none”", () => {
    const onTierKey = vi.fn();
    render(
      <CouponGrantsFields
        tiers={WARSTWY}
        tierKey="gold"
        onTierKey={onTierKey}
        durationDays="30"
        onDurationDays={vi.fn()}
        lang="pl"
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "none" } });
    expect(onTierKey).toHaveBeenCalledWith("");
  });

  it("liczba dni jest ZABLOKOWANA, dopóki nie wybrano warstwy", () => {
    render(
      <CouponGrantsFields
        tiers={WARSTWY}
        tierKey=""
        onTierKey={vi.fn()}
        durationDays=""
        onDurationDays={vi.fn()}
        lang="pl"
      />,
    );
    expect(screen.getByRole("spinbutton")).toBeDisabled();
  });

  it("liczba dni wychodzi jako NAPIS - konwersję robi dopiero ładunek", () => {
    const onDurationDays = vi.fn();
    render(
      <CouponGrantsFields
        tiers={WARSTWY}
        tierKey="gold"
        onTierKey={vi.fn()}
        durationDays=""
        onDurationDays={onDurationDays}
        lang="pl"
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "30" } });
    expect(onDurationDays).toHaveBeenCalledWith("30");
  });

  it.fails("powrót do „Brak” powinien wyczyścić wpisaną liczbę dni", () => {
    const onDurationDays = vi.fn();
    render(
      <CouponGrantsFields
        tiers={WARSTWY}
        tierKey="gold"
        onTierKey={vi.fn()}
        durationDays="30"
        onDurationDays={onDurationDays}
        lang="pl"
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "none" } });
    expect(onDurationDays).toHaveBeenCalledWith("");
  });

  it("STAN FAKTYCZNY: pole jest tylko WYŁĄCZANE, a wartość zostaje w stanie", () => {
    // Para do usunięcia RAZEM po naprawie. Skutek: ładunek niesie
    // `grants_duration_days: 30` przy `grants_tier_key: null`.
    const onDurationDays = vi.fn();
    render(
      <CouponGrantsFields
        tiers={WARSTWY}
        tierKey="gold"
        onTierKey={vi.fn()}
        durationDays="30"
        onDurationDays={onDurationDays}
        lang="pl"
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "none" } });
    expect(onDurationDays).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("30")).toBeInTheDocument();
  });
});

describe("ograniczenie do planów", () => {
  const PLANY = [
    { id: "p-1", name_pl: "Roczny", name_en: "Annual", active: true },
    { id: "p-2", name_pl: "Archiwalny", name_en: "Legacy", active: false },
  ];

  it("zaznaczenie planu oddaje jego identyfikator i zamiar, nie nową tablicę", () => {
    const onToggle = vi.fn();
    render(<CouponPlanRestrictionList plans={PLANY} selected={[]} onToggle={onToggle} lang="pl" />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onToggle).toHaveBeenCalledWith("p-1", true);
  });

  it("odznaczenie planu oddaje ten sam identyfikator z zamiarem przeciwnym", () => {
    const onToggle = vi.fn();
    render(
      <CouponPlanRestrictionList plans={PLANY} selected={["p-1"]} onToggle={onToggle} lang="pl" />,
    );
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onToggle).toHaveBeenCalledWith("p-1", false);
  });

  it("plan nieaktywny jest widoczny i wybieralny - tylko przekreślony", () => {
    render(<CouponPlanRestrictionList plans={PLANY} selected={[]} onToggle={vi.fn()} lang="pl" />);
    expect(screen.getByText("Archiwalny").className).toContain("line-through");
  });

  it("pusta lista planów pokazuje jeden komunikat i ani jednego pola wyboru", () => {
    render(<CouponPlanRestrictionList plans={[]} selected={[]} onToggle={vi.fn()} lang="pl" />);
    expect(screen.getByText("adminCoupons.plansAvailable")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it.fails("plan bez nazwy w obu językach powinien mieć etykietę zastępczą", () => {
    render(
      <CouponPlanRestrictionList
        plans={[{ id: "p-9", name_pl: null, name_en: null, active: true }]}
        selected={[]}
        onToggle={vi.fn()}
        lang="pl"
      />,
    );
    expect(screen.getByRole("checkbox")).toHaveAccessibleName();
  });

  it("STAN FAKTYCZNY: plan bez nazw renderuje PUSTĄ etykietę obok pola wyboru", () => {
    // `pickLocalized` bez `fallback` cofa się do "" - a wołający go nie podaje.
    const { container } = render(
      <CouponPlanRestrictionList
        plans={[{ id: "p-9", name_pl: null, name_en: null, active: true }]}
        selected={[]}
        onToggle={vi.fn()}
        lang="pl"
      />,
    );
    expect(container.querySelector("label span")?.textContent).toBe("");
  });
});
