// Części zakładki „Realizacje": plakietka nadania planu i pasek filtrów.
//
// CO TEN PLIK DOWODZI.
//   1. Kolumna „Plan" ma TRZY stany, nie dwa. Stan „czeka na płatność" jest
//      jedynym miejscem w panelu, z którego widać zamówienie NIEOPŁACONE, i
//      najłatwiejszym do zgubienia przy refaktorze („skoro jest warstwa, to
//      nadano"). Warunek jest zagnieżdżony w warunku w środku wiersza tabeli -
//      `tsc` go nie sprawdzi, a recenzja przeczyta jako jeden `? :`.
//   2. Brak warstwy daje kreskę NIEZALEŻNIE od znacznika efektów - czyli
//      realizacja z zastosowanymi efektami, ale bez warstwy, wygląda jak
//      realizacja bez żadnych efektów.
//   3. Data nadania jest podpowiedzią pod kursorem i jest formatowana JĘZYKIEM
//      interfejsu - w dwóch językach daje dwa różne napisy.
//   4. Pasek filtrów oddaje `undefined` przy wyczyszczeniu pola. To nie jest
//      kosmetyka: od tego zależy, czy zapytanie dostanie ogniwo `gte`/`lte`.
//   5. Eksport CSV jest klikalny TAKŻE przy pustej tabeli.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Treści arkusza (`couponCsv.test.ts`), granic
// zakresu (`couponRedemptionsRange.test.ts`) ani całego wiersza tabeli
// (`RedemptionsTable.test.tsx`).
//
// DLACZEGO `DatePickerField` JEST ATRAPĄ. Prawdziwy komponent to Radix Popover
// + `react-day-picker`; pod happy-dom nie ma pełnego API wskaźnika, więc
// kalendarz nigdy się nie otwiera. Atrapa jest natywnym `<input>`, dzięki
// czemu wyczyszczenie pola (a więc `undefined`) da się w ogóle wywołać. Sam
// `DatePickerField` ma zostać dowiedziony osobno, w teście tej molekuły.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/admin/coupons/DatePickerField", () => ({
  DatePickerField: ({
    value,
    onChange,
    label,
  }: {
    value: Date | undefined;
    onChange: (value: Date | undefined) => void;
    label: string;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value ? value.toISOString() : ""}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value) : undefined)}
      />
    </label>
  ),
}));

import { RedemptionEffectsBadge } from "@/components/admin/coupons/atoms/RedemptionEffectsBadge";
import { CouponDateRangeFields } from "@/components/admin/coupons/molecules/CouponDateRangeFields";
import { RedemptionsFilterBar } from "@/components/admin/coupons/molecules/RedemptionsFilterBar";

afterEach(cleanup);

describe("plakietka nadania planu", () => {
  it("kupon nadający warstwę i JUŻ zastosowany mówi 'nadano'", () => {
    render(
      <RedemptionEffectsBadge
        tierKey="gold"
        effectsAppliedAt="2026-08-20T10:00:00.000Z"
        grantedLabel="nadano"
        awaitingLabel="czeka na płatność"
        lang="pl"
      />,
    );
    expect(screen.getByText("gold")).toBeInTheDocument();
    expect(screen.getByText("nadano")).toBeInTheDocument();
    expect(screen.queryByText("czeka na płatność")).not.toBeInTheDocument();
  });

  it("kupon nadający warstwę BEZ znacznika efektów mówi 'czeka na płatność'", () => {
    render(
      <RedemptionEffectsBadge
        tierKey="gold"
        effectsAppliedAt={null}
        grantedLabel="nadano"
        awaitingLabel="czeka na płatność"
        lang="pl"
      />,
    );
    expect(screen.getByText("czeka na płatność")).toBeInTheDocument();
    expect(screen.queryByText("nadano")).not.toBeInTheDocument();
  });

  it("realizacja BEZ warstwy pokazuje kreskę - także wtedy, gdy efekty zastosowano", () => {
    const { container } = render(
      <RedemptionEffectsBadge
        tierKey={null}
        effectsAppliedAt="2026-08-20T10:00:00.000Z"
        grantedLabel="nadano"
        awaitingLabel="czeka na płatność"
        lang="pl"
      />,
    );
    expect(container.textContent).toBe("-");
    expect(screen.queryByText("nadano")).not.toBeInTheDocument();
  });

  it("data nadania jest podpowiedzią pod kursorem i zależy od języka interfejsu", () => {
    const pl = render(
      <RedemptionEffectsBadge
        tierKey="gold"
        effectsAppliedAt="2026-01-05T10:00:00.000Z"
        grantedLabel="nadano"
        awaitingLabel="czeka"
        lang="pl"
      />,
    );
    const tytulPl = pl.getByText("nadano").getAttribute("title");
    cleanup();
    const en = render(
      <RedemptionEffectsBadge
        tierKey="gold"
        effectsAppliedAt="2026-01-05T10:00:00.000Z"
        grantedLabel="granted"
        awaitingLabel="awaiting"
        lang="en"
      />,
    );
    const tytulEn = en.getByText("granted").getAttribute("title");
    expect(tytulPl).toBeTruthy();
    expect(tytulEn).toBeTruthy();
    expect(tytulPl).not.toBe(tytulEn);
  });

  it("USZKODZONA data nadania nie wywala wiersza - wypisuje 'Invalid Date' w podpowiedzi", () => {
    render(
      <RedemptionEffectsBadge
        tierKey="gold"
        effectsAppliedAt="nie-data"
        grantedLabel="nadano"
        awaitingLabel="czeka"
        lang="pl"
      />,
    );
    expect(screen.getByText("nadano").getAttribute("title")).toBe("Invalid Date");
  });
});

describe("para pól zakresu dat", () => {
  it("pole 'od' i pole 'do' trafiają do WŁASNYCH procedur obsługi", () => {
    const onFrom = vi.fn();
    const onTo = vi.fn();
    render(
      <CouponDateRangeFields
        from={undefined}
        to={undefined}
        onFrom={onFrom}
        onTo={onTo}
        fromLabel="Od"
        toLabel="Do"
      />,
    );
    fireEvent.change(screen.getByLabelText("Od"), { target: { value: "2026-08-01" } });
    expect(onFrom).toHaveBeenCalledTimes(1);
    expect(onTo).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Do"), { target: { value: "2026-08-22" } });
    expect(onTo).toHaveBeenCalledTimes(1);
  });

  it("WYCZYSZCZENIE pola oddaje undefined, czyli ogniwo filtrujące ma zniknąć z zapytania", () => {
    const onTo = vi.fn();
    render(
      <CouponDateRangeFields
        from={undefined}
        to={new Date("2026-08-22T00:00:00.000Z")}
        onFrom={vi.fn()}
        onTo={onTo}
        fromLabel="Od"
        toLabel="Do"
      />,
    );
    fireEvent.change(screen.getByLabelText("Do"), { target: { value: "" } });
    expect(onTo).toHaveBeenCalledWith(undefined);
  });
});

describe("pasek filtrów historii realizacji", () => {
  function renderBar(overrides: Partial<Parameters<typeof RedemptionsFilterBar>[0]> = {}) {
    const props = {
      from: undefined,
      to: undefined,
      onFrom: vi.fn(),
      onTo: vi.fn(),
      onExport: vi.fn(),
      fromLabel: "Od",
      toLabel: "Do",
      exportLabel: "Eksport CSV",
      ...overrides,
    };
    render(<RedemptionsFilterBar {...props} />);
    return props;
  }

  it("kliknięcie eksportu woła zdarzenie DOKŁADNIE raz - pobranie pliku zostaje u wołającego", () => {
    const props = renderBar();
    fireEvent.click(screen.getByRole("button", { name: /Eksport CSV/ }));
    expect(props.onExport).toHaveBeenCalledTimes(1);
  });

  it("eksport jest klikalny TAKŻE bez ustawionego zakresu - powstanie plik z samym nagłówkiem", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /Eksport CSV/ })).not.toBeDisabled();
  });

  it("pasek niesie oba pola zakresu, a nie tylko jedno", () => {
    renderBar();
    expect(screen.getByLabelText("Od")).toBeInTheDocument();
    expect(screen.getByLabelText("Do")).toBeInTheDocument();
  });
});
