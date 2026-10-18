// Trasa /admin/billing-settlements - stany rozliczeń i zwrotów. Do 18.10.2026:
// 0 z 14 funkcji, 0 instrukcji.
//
// CO TU MUSI BYĆ DOWIEDZIONE:
//
//   1. ZAKRES DAT TO DNI LOKALNE. Pola daty niosą natywne `RRRR-MM-DD`, a do
//      serwera jadą chwile ISO lokalnej północy („do" - włącznie, czyli północ
//      dnia następnego). Przesunięcie o strefę to zamówienia z pierwszych
//      godzin dnia przypisane do dnia poprzedniego.
//   2. ETYKIETY MÓWIĄ JĘZYKIEM BAZY. Stan zlecenia zwrotu przychodzi wprost
//      z kolumny `event_registration_refund_jobs.state` - słownik etykiet musi
//      znać KAŻDĄ wartość jej CHECK-u, inaczej panel pokazuje surowe kody
//      („completed", „needs_review") w obu językach.
//   3. STANY WIDOKU SĄ ROZRÓŻNIALNE: przed wczytaniem, w toku, błąd, pusto,
//      obcięte okno, wiersze.
//
// ATRAPOWANA JEST WYŁĄCZNIE GRANICA: funkcja serwerowa raportu. Słownik,
// router, `adminPageHead`, `dateRangeToIso` i formatowanie kwot biegną
// PRAWDZIWE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { SettlementRow } from "@/lib/billing/settlementStatus";
import type { SettlementReport } from "@/lib/billing/settlementStatus.functions";

const h = vi.hoisted(() => ({ report: vi.fn() }));

vi.mock("@/lib/billing/settlementStatus.functions", () => ({
  getSettlementReport: (args: unknown) => h.report(args),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { SETTLEMENT_STATUSES } from "@/lib/billing/settlementStatus";
import { REFUND_JOB_STATES } from "@/lib/events/registrationRefundJournal";
import { renderRoute } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { moneyPattern } from "@/test/billing/fixtures";
import { Route as SettlementsRoute } from "@/routes/admin.billing-settlements";

const PATH = "/admin/billing-settlements";
const ORIGINAL_TZ = process.env.TZ;

function row(overrides: Partial<SettlementRow> = {}): SettlementRow {
  return {
    id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    createdAt: "2026-10-01T10:00:00.000Z",
    kind: "one_time",
    status: "paid",
    amountCents: 4900,
    refundedCents: 0,
    currency: "PLN",
    environment: "live",
    refundJobState: null,
    refundJobError: null,
    needsReview: false,
    ...overrides,
  };
}

function report(overrides: Partial<SettlementReport> = {}): SettlementReport {
  return { rows: [row()], truncated: false, ...overrides };
}

async function mount() {
  return renderRoute({ route: SettlementsRoute, path: PATH, initialEntry: PATH });
}

/** Ostatni ładunek wysłany do funkcji serwerowej. */
function lastQuery(): Record<string, unknown> {
  const call = h.report.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> };
  return call.data;
}

async function show(label = "Pokaż") {
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(h.report).toHaveBeenCalled());
}

/** Wiersz tabeli po identyfikatorze zamówienia. */
async function tableRow(id: string): Promise<HTMLElement> {
  return (await screen.findByText(id)).closest("tr") as HTMLElement;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.report.mockReset().mockResolvedValue(report());
});

afterEach(async () => {
  cleanup();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  await i18n.changeLanguage("pl");
});

describe("trasa /admin/billing-settlements - sklejenie i nagłówek", () => {
  it("ma nagłówek sekcji i nie trafia do indeksu wyszukiwarek", async () => {
    // Wiersze niosą identyfikatory zamówień, kwoty i błędy operatora.
    const view = await mount();

    expect(view.currentPath()).toBe(PATH);
    expect(view.meta()).toContainEqual({
      title: "Settlement and refund states | New European Strategies",
    });
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });

  it("przed wczytaniem nie ma ani tabeli, ani licznika, ani zapytania", async () => {
    // Zero pozycji wyświetlone przed zapytaniem czytałoby się jak „brak
    // rozliczeń".
    await mount();

    expect(screen.getByRole("heading", { name: "Stany rozliczeń i zwrotów" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/Pozycji:/)).not.toBeInTheDocument();
    expect(h.report).not.toHaveBeenCalled();
  });

  it("nie zostawia panelu z wadami dostępności", async () => {
    h.report.mockResolvedValue(
      report({ rows: [row({ refundJobState: "failed", refundJobError: "card_declined" })] }),
    );
    const view = await mount();
    await show();
    await screen.findByRole("table");

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /admin/billing-settlements - zakres pytania", () => {
  it("domyślnie pyta o wszystkie stany bez granic dat", async () => {
    await mount();
    await show();

    expect(lastQuery()).toEqual({ status: "all", fromIso: null, toIso: null });
  });

  it("dni lokalne z pól daty jadą jako lokalne północe, a „do” obejmuje cały dzień", async () => {
    // Administrator w Warszawie: 1 października zaczyna się o 22:00 UTC
    // 30 września, a 25 października (zmiana czasu) kończy się o 23:00 UTC.
    process.env.TZ = "Europe/Warsaw";
    await mount();

    const od = screen.getByLabelText("Od dnia");
    const doDnia = screen.getByLabelText("Do dnia");
    expect(od).not.toHaveAttribute("max");
    expect(doDnia).not.toHaveAttribute("min");

    fireEvent.change(od, { target: { value: "2026-10-01" } });
    fireEvent.change(doDnia, { target: { value: "2026-10-25" } });

    // Natywne wartości zostają w polach bez przeróbek, a pola pilnują
    // kolejności granic natywnie (min/max), bez własnej walidacji.
    expect(od).toHaveValue("2026-10-01");
    expect(doDnia).toHaveValue("2026-10-25");
    expect(od).toHaveAttribute("max", "2026-10-25");
    expect(doDnia).toHaveAttribute("min", "2026-10-01");

    await show();
    expect(lastQuery()).toEqual({
      status: "all",
      fromIso: "2026-09-30T22:00:00.000Z",
      toIso: "2026-10-25T23:00:00.000Z",
    });
  });

  it("lista stanów to „Wszystkie” i każdy stan rozliczenia, a wybór jedzie do serwera", async () => {
    await mount();
    const select = screen.getByLabelText("Status");

    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      "Wszystkie",
      "Oczekuje",
      "W toku",
      "Opłacone",
      "Zwrot częściowy",
      "Zwrócone",
      "Nieudane",
      "Anulowane",
    ]);

    fireEvent.change(select, { target: { value: "partially_refunded" } });
    await show();
    expect(lastQuery().status).toBe("partially_refunded");
  });

  it("wartość spoza listy stanów nie zmienia filtra", async () => {
    await mount();
    const select = screen.getByLabelText("Status");

    fireEvent.change(select, { target: { value: "refunded" } });
    fireEvent.change(select, { target: { value: "cancelled" } });
    await show();

    expect(lastQuery().status).toBe("refunded");
  });
});

describe("trasa /admin/billing-settlements - stany widoku", () => {
  it("w toku przycisk jest zablokowany i mówi, że trwa wczytywanie", async () => {
    let resolve: (value: SettlementReport) => void = () => {};
    h.report.mockReturnValue(new Promise<SettlementReport>((r) => (resolve = r)));
    await mount();
    await show();

    const button = await screen.findByRole("button", { name: "Wczytywanie..." });
    expect(button).toBeDisabled();

    resolve(report());
    expect(await screen.findByRole("button", { name: "Pokaż" })).toBeEnabled();
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("błąd serwera jest pokazany treścią, bez tabeli", async () => {
    h.report.mockRejectedValue(new Error("forbidden"));
    await mount();
    await show();

    expect(await screen.findByText("forbidden")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("odrzucenie wartością inną niż Error też jest pokazane, a nie zgubione", async () => {
    h.report.mockRejectedValue("gateway timeout");
    await mount();
    await show();

    expect(await screen.findByText("gateway timeout")).toBeInTheDocument();
  });

  it("pusty wynik mówi wprost, że filtry nic nie znalazły", async () => {
    h.report.mockResolvedValue(report({ rows: [] }));
    await mount();
    await show();

    expect(await screen.findByText("Brak rozliczeń dla wybranych filtrów.")).toBeInTheDocument();
    expect(screen.getByText("Pozycji: 0")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("obcięte okno ma ostrzeżenie, a pełne - nie", async () => {
    const komunikat = "Sprawdzono tylko 500 najnowszych zamówień - zawęź zakres dat.";
    h.report.mockResolvedValue(report({ truncated: true }));
    await mount();
    await show();
    expect(await screen.findByText(komunikat)).toBeInTheDocument();

    h.report.mockResolvedValue(report({ truncated: false }));
    await show();
    await waitFor(() => expect(screen.queryByText(komunikat)).not.toBeInTheDocument());
  });
});

describe("trasa /admin/billing-settlements - wiersze", () => {
  it("wiersz niesie datę lokalną, zamówienie, środowisko, stan, kwoty i zlecenie", async () => {
    process.env.TZ = "Europe/Warsaw";
    h.report.mockResolvedValue(
      report({
        rows: [
          row({
            id: "zamowienie-czesciowe",
            kind: "subscription",
            environment: "sandbox",
            status: "partially_refunded",
            amountCents: 123456,
            refundedCents: 2000,
            needsReview: true,
            refundJobState: "failed",
            refundJobError: "card_declined",
          }),
          row({ id: "zamowienie-oplacone" }),
        ],
      }),
    );
    await mount();
    await show();

    const czesciowy = within(await tableRow("zamowienie-czesciowe"));
    // Data w strefie przeglądarki - tej samej, w której liczą się pola filtra.
    expect(czesciowy.getByText(/1\.10\.2026.*12:00/)).toBeInTheDocument();
    expect(czesciowy.getByText("subscription - sandbox")).toBeInTheDocument();
    expect(czesciowy.getByText("Zwrot częściowy")).toBeInTheDocument();
    expect(czesciowy.getByText("Do sprawdzenia")).toBeInTheDocument();
    expect(czesciowy.getByText(moneyPattern(123456))).toBeInTheDocument();
    expect(czesciowy.getByText(moneyPattern(2000))).toBeInTheDocument();
    expect(czesciowy.getByText("Nieudany")).toBeInTheDocument();
    expect(czesciowy.getByText("card_declined")).toBeInTheDocument();

    const oplacony = within(await tableRow("zamowienie-oplacone"));
    expect(oplacony.getByText("Opłacone")).toBeInTheDocument();
    expect(oplacony.queryByText("Do sprawdzenia")).not.toBeInTheDocument();
    // Brak zwrotu i brak zlecenia to myślniki, nie „0,00 zł".
    expect(oplacony.getAllByText("-")).toHaveLength(2);
    expect(screen.getByText("Pozycji: 2")).toBeInTheDocument();
  });

  it("KAŻDY stan zlecenia zwrotu z bazy ma etykietę - żaden surowy kod nie wycieka", async () => {
    // Słownik znał dawniej `done` i `review`, których baza nigdy nie zapisuje,
    // a nie znał `completed`, `needs_review`, `submitted` ani `cancelled` -
    // panel pokazywał wtedy kod kolumny zamiast stanu.
    const oczekiwane: Record<string, string> = {
      pending: "W kolejce",
      processing: "W toku",
      submitted: "Zlecony operatorowi",
      completed: "Wykonany",
      failed: "Nieudany",
      cancelled: "Wycofany",
      needs_review: "Wymaga decyzji",
    };
    h.report.mockResolvedValue(
      report({
        rows: REFUND_JOB_STATES.map((state) =>
          row({ id: `zlecenie-${state}`, refundJobState: state }),
        ),
      }),
    );
    await mount();
    await show();

    for (const state of REFUND_JOB_STATES) {
      const wiersz = within(await tableRow(`zlecenie-${state}`));
      expect(wiersz.getByText(oczekiwane[state])).toBeInTheDocument();
      expect(wiersz.queryByText(state)).not.toBeInTheDocument();
    }
  });

  it("kod waluty, którego nie zna Intl, nie wywraca tabeli", async () => {
    // `payment_orders.currency` to tekst bez CHECK-u. Jeden taki wiersz nie
    // może zabrać administratorowi całej listy.
    h.report.mockResolvedValue(report({ rows: [row({ id: "zla-waluta", currency: "zł" })] }));
    await mount();
    await show();

    const wiersz = within(await tableRow("zla-waluta"));
    expect(wiersz.getByText("49.00 zł")).toBeInTheDocument();
  });

  it("po angielsku: stany, zlecenia, znacznik i licznik z angielskiego słownika", async () => {
    await i18n.changeLanguage("en");
    h.report.mockResolvedValue(
      report({
        rows: [
          row({ id: "en-1", status: "refunded", refundedCents: 4900, refundJobState: "completed" }),
          row({
            id: "en-2",
            status: "canceled",
            needsReview: true,
            refundJobState: "needs_review",
          }),
        ],
        truncated: true,
      }),
    );
    await mount();
    expect(
      screen.getByRole("heading", { name: "Settlement and refund states" }),
    ).toBeInTheDocument();
    await show("Show");

    const pierwszy = within(await tableRow("en-1"));
    expect(pierwszy.getByText("Refunded")).toBeInTheDocument();
    expect(pierwszy.getByText("Done")).toBeInTheDocument();
    const drugi = within(await tableRow("en-2"));
    expect(drugi.getByText("Canceled")).toBeInTheDocument();
    expect(drugi.getByText("Needs review")).toBeInTheDocument();
    expect(drugi.getByText("Needs a decision")).toBeInTheDocument();
    expect(screen.getByText("Entries: 2")).toBeInTheDocument();
    expect(
      screen.getByText("Only the 500 most recent orders were checked - narrow the date range."),
    ).toBeInTheDocument();
  });
});

describe("słownik stanów - parytet z bazą i między językami", () => {
  it("każdy stan zlecenia (CHECK kolumny `state`) i każdy stan rozliczenia ma etykietę PL i EN", () => {
    // `REFUND_JOB_STATES` jest przybity do CHECK-u w bazie testem
    // `refundJournalDbEnumParity` - tu domykamy drugie ogniwo: słownik panelu.
    for (const lng of ["pl", "en"]) {
      for (const state of REFUND_JOB_STATES) {
        expect(i18n.exists(`adminSettlements.jobs.${state}`, { lng }), `${lng}: ${state}`).toBe(
          true,
        );
      }
      for (const status of SETTLEMENT_STATUSES) {
        expect(
          i18n.exists(`adminSettlements.statuses.${status}`, { lng }),
          `${lng}: ${status}`,
        ).toBe(true);
      }
    }
    expect(
      Object.keys(i18n.getResource("pl", "translation", "adminSettlements.jobs")).sort(),
    ).toEqual([...REFUND_JOB_STATES].sort());
  });
});
