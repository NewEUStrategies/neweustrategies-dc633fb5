// Notka „starsze dni z agregatu dobowego" (I9d-Y1, Z-I9c-07) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Pulpit monetyzacji (dokładna granica `aggregate_before`): notka tylko,
//      gdy okno zaczyna się PRZED granicą; data granicy to dzień kalendarzowy
//      (bez przesunięcia strefy).
//   2. Lejek huba (granicy nie zna): notka, gdy okno - bieżące albo
//      porównawcze - sięga dalej niż najkrótszy okres odczytów licznika
//      (2 mies.); krótkie świeże okna nie dostają szumu.
//   3. Dymek: przycisk z nazwą dostępną i treścią w DOM (`aria-describedby`
//      celu), brak naruszeń axe.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { RetentionAggregateNote } from "@/components/admin/settings/dataRetention/RetentionAggregateNote";
import { windowMayUseAggregate } from "@/components/admin/settings/dataRetention/aggregateWindow";
import "@/lib/i18n-admin-retention-aggregate";

h.fixedT = realT;

const NOW = new Date(2026, 9, 22, 12, 0, 0);

afterEach(() => cleanup());

describe("notka agregatu dobowego - pulpit monetyzacji (granica z RPC)", () => {
  it("okno przed granicą: notka z datą granicy jako dniem kalendarzowym", () => {
    render(<RetentionAggregateNote before="2026-07-22" from="2026-06-01" />);
    expect(screen.getByText("Starsze dni z agregatu dobowego")).toBeTruthy();
    expect(
      screen.getByText(/^Dni przed 22 lipca 2026 liczone są z anonimowego agregatu/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skąd liczby starszych dni?" })).toBeTruthy();
  });

  it("okno od granicy albo później, brak granicy, zły napis z bazy: bez notki", () => {
    const { container, rerender } = render(
      <RetentionAggregateNote before="2026-07-22" from="2026-07-22" />,
    );
    expect(container.textContent).toBe("");
    rerender(<RetentionAggregateNote before={null} from="2020-01-01" />);
    expect(container.textContent).toBe("");
    rerender(<RetentionAggregateNote before="22.07.2026" from="2020-01-01" />);
    expect(container.textContent).toBe("");
  });
});

describe("notka agregatu dobowego - lejek huba (próg najkrótszego okresu)", () => {
  it("okno porównawcze sięgające dalej niż 2 mies.: notka z okresem domyślnym", () => {
    render(
      <RetentionAggregateNote
        now={NOW}
        windowStarts={["2026-09-22T00:00:00+02:00", "2026-08-01T00:00:00+02:00"]}
      />,
    );
    expect(screen.getByText(/domyślnie 3 mies\.\) liczone są z anonimowego agregatu/)).toBeTruthy();
    expect(screen.getByText(/raz na dzień, nie raz na całe okno/)).toBeTruthy();
  });

  it("świeże okna (bez porównania): bez notki", () => {
    const { container } = render(
      <RetentionAggregateNote now={NOW} windowStarts={["2026-09-22T00:00:00+02:00", undefined]} />,
    );
    expect(container.textContent).toBe("");
  });

  it("próg liczony od dziś minus najkrótszy dozwolony okres (2 mies.)", () => {
    expect(windowMayUseAggregate(["2026-08-23T00:00:00+02:00"], NOW)).toBe(false);
    expect(windowMayUseAggregate(["2026-08-21T00:00:00+02:00"], NOW)).toBe(true);
    expect(windowMayUseAggregate([null, "nie-data"], NOW)).toBe(false);
  });

  it("brak naruszeń axe", async () => {
    const { container } = render(
      <RetentionAggregateNote now={NOW} windowStarts={["2025-10-22T00:00:00+02:00"]} />,
    );
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
