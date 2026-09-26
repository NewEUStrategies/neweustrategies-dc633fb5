// Filtry raportu dla sponsorów (`SponsorReportFiltersBar`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. ZMIANA JEDNEGO POLA KASUJE POZOSTAŁE - `onChange` musi dostać całe
//      filtry z podmienionym jednym polem.
//   2. ODWRÓCONY ZAKRES BEZ SŁOWA - pod polami ma stać zdanie, a oba pola
//      mają `aria-invalid` i opis błędu (czytnik ekranu czyta je razem).
//   3. MIEJSCE BEZ ETYKIETY - każda wartość CHECK-a bazy ma pozycję w liście
//      z etykietą z nakładki, a pierwszą pozycją jest „wszystkie".
//   4. RESET NIE WRACA DO STANU POCZĄTKOWEGO.
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SPONSOR_PLACEMENTS } from "@/lib/events/sponsorExposure";
import { ADMIN_PLACEMENT_LABEL_KEYS } from "@/lib/events/sponsorReportLabels";
import {
  EMPTY_SPONSOR_REPORT_FILTERS,
  type SponsorReportFilters,
} from "@/lib/events/sponsorReportDraft";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    id,
    value,
    options,
    onValueChange,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (next: string) => void;
  }) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {String(option.label)}
        </option>
      ))}
    </select>
  ),
}));

const { SponsorReportFiltersBar } =
  await import("@/components/admin/events/molecules/SponsorReportFiltersBar");

const F = "adminEventSponsorReport.filters";
const SPONSORS = [
  { id: "s1", name: "Acme" },
  { id: "s2", name: "Beta" },
];

let changes: SponsorReportFilters[] = [];

function bar(filters: SponsorReportFilters = EMPTY_SPONSOR_REPORT_FILTERS) {
  return render(
    <SponsorReportFiltersBar
      filters={filters}
      sponsors={SPONSORS}
      onChange={(next) => changes.push(next)}
    />,
  );
}

beforeEach(() => {
  changes = [];
});

describe("SponsorReportFiltersBar", () => {
  it("każde pole zmienia TYLKO swoje pole filtrów", () => {
    const start = { from: "2099-06-01", to: "2099-06-30", sponsorId: "all", placement: "all" };
    bar(start);
    fireEvent.change(screen.getByLabelText(`${F}.from`), { target: { value: "2099-06-02" } });
    fireEvent.change(screen.getByLabelText(`${F}.to`), { target: { value: "2099-06-29" } });
    fireEvent.change(screen.getByLabelText(`${F}.sponsor`), { target: { value: "s2" } });
    fireEvent.change(screen.getByLabelText(`${F}.placement`), { target: { value: "home_ad" } });
    expect(changes).toEqual([
      { ...start, from: "2099-06-02" },
      { ...start, to: "2099-06-29" },
      { ...start, sponsorId: "s2" },
      { ...start, placement: "home_ad" },
    ]);
  });

  it("listy: „wszyscy” i sponsorzy, „wszystkie” i każde miejsce z etykietą", () => {
    bar();
    const sponsors = screen.getByLabelText<HTMLSelectElement>(`${F}.sponsor`);
    expect(Array.from(sponsors.options).map((o) => [o.value, o.textContent])).toEqual([
      ["all", `${F}.allSponsors`],
      ["s1", "Acme"],
      ["s2", "Beta"],
    ]);
    const placements = screen.getByLabelText<HTMLSelectElement>(`${F}.placement`);
    expect(Array.from(placements.options).map((o) => [o.value, o.textContent])).toEqual([
      ["all", `${F}.allPlacements`],
      ...SPONSOR_PLACEMENTS.map((p) => [p, ADMIN_PLACEMENT_LABEL_KEYS[p]]),
    ]);
    expect(screen.getByText(`${F}.placementHint`)).toBeTruthy();
  });

  it("poprawny zakres nie ma komunikatu ani `aria-invalid`", () => {
    bar({ ...EMPTY_SPONSOR_REPORT_FILTERS, from: "2099-06-01", to: "2099-06-01" });
    expect(screen.queryByText(`${F}.invalidRange`)).toBeNull();
    expect(screen.getByLabelText(`${F}.from`).hasAttribute("aria-invalid")).toBe(false);
    expect(screen.getByLabelText(`${F}.to`).hasAttribute("aria-describedby")).toBe(false);
  });

  it("odwrócony zakres: zdanie pod polami, oba pola `aria-invalid` z opisem błędu", () => {
    bar({ ...EMPTY_SPONSOR_REPORT_FILTERS, from: "2099-06-30", to: "2099-06-01" });
    for (const label of [`${F}.from`, `${F}.to`]) {
      const field = screen.getByLabelText(label);
      expect(field.getAttribute("aria-invalid")).toBe("true");
      expect(field).toHaveAccessibleDescription(`${F}.invalidRange`);
    }
  });

  it("reset wraca do filtrów początkowych", () => {
    bar({ from: "2099-06-01", to: "", sponsorId: "s1", placement: "materials" });
    fireEvent.click(screen.getByRole("button", { name: `${F}.reset` }));
    expect(changes).toEqual([EMPTY_SPONSOR_REPORT_FILTERS]);
  });
});
