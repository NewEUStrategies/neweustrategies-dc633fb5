// Molekula `AdsFunnelCampaignTable` - lejek per kampania.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. KOSZT W WIERSZU KANALU - suma arkusza liczy koszt kampanii tyle razy,
//      ile ma kanalow.
//   2. "BEZ ATRYBUCJI" Z ZERAMI W KOLUMNACH LEJKA - udaje "zero wizyt", choc
//      tych wizyt po prostu nie mierzylismy (brak zgody).
//   3. WSKAZNIK BEZ MIANOWNIKA to "0%" albo "NaN" zamiast kreski.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { axeViolations, summarize } from "@/test/axe";
import { formatMoney } from "@/lib/billing/types";
import type { AdsFunnelGroup, AdsFunnelReport } from "@/lib/events/adsFunnel";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-ads-funnel", () => ({ ensureAdsFunnelI18n: () => undefined }));

const { AdsFunnelCampaignTable } =
  await import("@/components/admin/events/molecules/AdsFunnelCampaignTable");

afterEach(cleanup);

const T = "adminEventAdsFunnel.table.";

function group(overrides: Partial<AdsFunnelGroup> = {}): AdsFunnelGroup {
  return {
    key: "campaign:c1",
    kind: "campaign",
    campaignId: "c1",
    label: "Wiosna Search",
    utmCampaign: "wiosna",
    gadCampaignId: null,
    visits: 10,
    registrationStarts: 4,
    checkoutStarts: 2,
    registrations: 5,
    paid: 2,
    revenue: [{ currency: "PLN", cents: 60000 }],
    cost: [{ currency: "PLN", micros: 150_000_000 }],
    channels: [
      {
        source: "google",
        medium: "cpc",
        visits: 10,
        registrationStarts: 4,
        checkoutStarts: 2,
        registrations: 5,
        paid: 2,
        revenue: [],
      },
    ],
    ...overrides,
  };
}

function report(groups: AdsFunnelGroup[], unattributedRegistrations = 2): AdsFunnelReport {
  return {
    timezone: "Europe/Warsaw",
    groups,
    unattributed: {
      registrations: unattributedRegistrations,
      paid: 1,
      revenue: [{ currency: "PLN", cents: 20000 }],
    },
    totals: {
      visits: 11,
      registrationStarts: 4,
      checkoutStarts: 2,
      registrations: 7,
      paid: 3,
      attributedRegistrations: 5,
      revenue: [{ currency: "PLN", cents: 80000 }],
      cost: [{ currency: "PLN", micros: 150_000_000 }],
    },
  };
}

function cells(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll("th,td")).map((cell) => cell.textContent ?? "");
}

describe("AdsFunnelCampaignTable", () => {
  it("wiersz kampanii: liczby, konwersja, przychod, koszt, CPA i ROAS", async () => {
    const { container } = render(<AdsFunnelCampaignTable report={report([group()])} lang="pl" />);
    const rows = screen.getAllByRole("row");
    expect(cells(rows[1] as HTMLElement)).toEqual([
      `Wiosna Search${T}kinds.campaign`,
      "10",
      "4",
      "5",
      "50%",
      "2",
      "2",
      formatMoney(60000, "PLN", "pl"),
      formatMoney(15000, "PLN", "pl"),
      formatMoney(7500, "PLN", "pl"),
      "4.00×",
    ]);
    // Kanal: liczby lejka, przychod (tu brak = kreska), BEZ kosztu.
    expect(cells(rows[2] as HTMLElement)).toEqual([
      "google / cpc",
      "10",
      "4",
      "5",
      "50%",
      "2",
      "2",
      "—",
      "",
    ]);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("bez atrybucji: kreski w kolumnach lejka i wyjasnienie; wiersz sum", () => {
    render(<AdsFunnelCampaignTable report={report([group()])} lang="pl" />);
    const unattributed = screen.getByRole("rowheader", { name: new RegExp(`${T}unattributed`) });
    const row = unattributed.closest("tr") as HTMLElement;
    expect(cells(row)).toEqual([
      `${T}unattributed${T}unattributedHint`,
      "—",
      "—",
      "2",
      "—",
      "—",
      "1",
      formatMoney(20000, "PLN", "pl"),
      "",
    ]);
    const total = screen.getByRole("rowheader", { name: `${T}total` }).closest("tr") as HTMLElement;
    expect(cells(total).slice(0, 9)).toEqual([
      `${T}total`,
      "11",
      "4",
      "7",
      "—",
      "2",
      "3",
      formatMoney(80000, "PLN", "pl"),
      formatMoney(15000, "PLN", "pl"),
    ]);
  });

  it("grupa bez kosztu i bez wizyt: kreski zamiast zera; nazwa zastepcza dla 'bez kampanii'", () => {
    render(
      <AdsFunnelCampaignTable
        report={report([
          group({
            key: "none",
            kind: "none",
            label: null,
            utmCampaign: null,
            visits: 0,
            paid: 0,
            revenue: [],
            cost: [],
            channels: [],
          }),
        ])}
        lang="en"
      />,
    );
    const row = screen.getAllByRole("row")[1] as HTMLElement;
    const values = cells(row);
    expect(values[0]).toBe(`${T}noCampaign${T}kinds.none`);
    expect(values[4]).toBe("—");
    expect(values.slice(7)).toEqual(["—", "—", "—", "—"]);
    expect(within(row).getByText(`${T}kinds.none`)).toBeInTheDocument();
  });

  it("zadnych grup i zgloszen - zdanie zamiast pustej tabeli", () => {
    render(<AdsFunnelCampaignTable report={report([], 0)} lang="pl" />);
    expect(screen.getByText(`${T}empty`)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("same zgloszenia bez atrybucji (zero grup) - tabela z wierszem bez atrybucji", () => {
    render(<AdsFunnelCampaignTable report={report([], 3)} lang="pl" />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
