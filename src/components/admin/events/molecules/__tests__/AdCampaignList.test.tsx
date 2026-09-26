// Molekula `AdCampaignList` - zmapowane kampanie z akcjami.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. TRZY "EDYTUJ" POD SOBA - czytnik ekranu nie wie, ktora kampanie edytuje
//      (nazwa przycisku ma niesc etykiete kampanii).
//   2. KOSZT W DWOCH WALUTACH ZSUMOWANY, a dni policzone per waluta zamiast razem.
//   3. AKCJA KLIKNIETA W TRAKCIE USUWANIA - przyciski maja byc wylaczone.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { axeViolations, summarize } from "@/test/axe";
import { formatMoney } from "@/lib/billing/types";
import type { AdCampaign } from "@/lib/events/adsFunnelApi";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-ads-funnel", () => ({ ensureAdsFunnelI18n: () => undefined }));

const { AdCampaignList } = await import("@/components/admin/events/molecules/AdCampaignList");

afterEach(cleanup);

const C = "adminEventAdsFunnel.campaigns.";

const CAMPAIGNS: AdCampaign[] = [
  {
    id: "c1",
    matchKind: "utm_campaign",
    matchValue: "wiosna",
    label: "Wiosna Search",
    conversionActionName: "Bilet",
    costs: [
      { currency: "EUR", costMicros: 10_000_000, days: 1 },
      { currency: "PLN", costMicros: 150_000_000, days: 2 },
    ],
  },
  {
    id: "c2",
    matchKind: "google_ads_campaign_id",
    matchValue: "987654321",
    label: "PMax",
    conversionActionName: null,
    costs: [],
  },
];

describe("AdCampaignList", () => {
  it("etykieta, rodzaj dopasowania, koszt per waluta z suma dni, nazwa konwersji", async () => {
    const { container } = render(
      <AdCampaignList
        campaigns={CAMPAIGNS}
        lang="pl"
        disabled={false}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onCosts={() => undefined}
      />,
    );
    const amount = `${formatMoney(1000, "EUR", "pl")} + ${formatMoney(15000, "PLN", "pl")}`;
    // Intl wstawia twarda spacje - normalizator testing-library zamienia ja na zwykla.
    const summary = `${C}costsSummary(amount=${amount},count=3) · ${C}conversion(name=Bilet)`;
    expect(screen.getByText(summary.replace(/\s+/g, " "))).toBeInTheDocument();
    expect(screen.getByText(`${C}noCosts · ${C}noConversion`)).toBeInTheDocument();
    expect(
      screen.getByText("adminEventAdsFunnel.matchKinds.google_ads_campaign_id"),
    ).toBeInTheDocument();
    expect(screen.getByText("987654321")).toBeInTheDocument();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("akcje wskazuja KONKRETNA kampanie i gasna w trakcie zapisu", () => {
    const calls: string[] = [];
    const { rerender } = render(
      <AdCampaignList
        campaigns={CAMPAIGNS}
        lang="en"
        disabled={false}
        onEdit={(campaign) => calls.push(`edit:${campaign.id}`)}
        onDelete={(campaign) => calls.push(`delete:${campaign.id}`)}
        onCosts={(campaign) => calls.push(`costs:${campaign.id}`)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: `${C}costs: PMax` }));
    fireEvent.click(screen.getByRole("button", { name: `${C}edit: Wiosna Search` }));
    fireEvent.click(screen.getByRole("button", { name: `${C}delete: PMax` }));
    expect(calls).toEqual(["costs:c2", "edit:c1", "delete:c2"]);

    rerender(
      <AdCampaignList
        campaigns={CAMPAIGNS}
        lang="en"
        disabled
        onEdit={() => undefined}
        onDelete={() => undefined}
        onCosts={() => undefined}
      />,
    );
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});
