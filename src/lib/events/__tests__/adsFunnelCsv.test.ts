// Tabela lejka do CSV i napisy liczb (`adsFunnelCsv.ts`, `adsFunnelFormat.ts`).
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. NAZWA KAMPANII Z ADRESU (`utm_campaign==HYPERLINK(...)`) wykonuje sie
//      w arkuszu organizatora - eksport ma ja neutralizowac.
//   2. KOSZT PRZYPISANY DO KANALU zamiast do kampanii (podwojnie w sumie arkusza).
//   3. ZLOTE I EURO ZSUMOWANE w jednej komorce albo kreska udajaca zero.
import { describe, expect, it } from "vitest";

import { formatMoney } from "@/lib/billing/types";
import type { AdsFunnelGroup, AdsFunnelReport } from "@/lib/events/adsFunnel";
import {
  adsFunnelGroupName,
  buildAdsFunnelCsv,
  type AdsFunnelCsvLabels,
} from "@/lib/events/adsFunnelCsv";
import { formatAmounts, formatCosts, formatRate, formatRoas } from "@/lib/events/adsFunnelFormat";

const LABELS: AdsFunnelCsvLabels = {
  campaign: "Kampania",
  source: "Zrodlo",
  medium: "Medium",
  visits: "Wizyty",
  registrationStarts: "Rozpoczete",
  registrations: "Zgloszenia",
  checkoutStarts: "Platnosci",
  paid: "Oplacone",
  revenue: "Przychod",
  cost: "Koszt",
  cpa: "CPA",
  roas: "ROAS",
  noCampaign: "Bez kampanii",
  otherCampaigns: "Pozostale kampanie",
  unattributed: "Bez atrybucji",
};

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
    registrations: 3,
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
        registrations: 3,
        paid: 2,
        revenue: [{ currency: "PLN", cents: 60000 }],
      },
    ],
    ...overrides,
  };
}

function report(groups: AdsFunnelGroup[]): AdsFunnelReport {
  return {
    timezone: "Europe/Warsaw",
    groups,
    groupsFolded: 0,
    unattributed: { registrations: 2, paid: 1, revenue: [{ currency: "EUR", cents: 1000 }] },
    totals: {
      visits: 10,
      registrationStarts: 4,
      checkoutStarts: 2,
      registrations: 5,
      paid: 3,
      attributedRegistrations: 3,
      revenue: [],
      cost: [],
    },
  };
}

describe("buildAdsFunnelCsv", () => {
  it("wiersz kampanii z kosztem, CPA i ROAS; kanal bez kosztu; bez atrybucji na koncu", () => {
    const csv = buildAdsFunnelCsv(report([group()]), LABELS);
    expect(csv.split("\n")).toEqual([
      "Kampania,Zrodlo,Medium,Wizyty,Rozpoczete,Zgloszenia,Platnosci,Oplacone,Przychod,Koszt,CPA,ROAS",
      "Wiosna Search,,,10,4,3,2,2,600.00 PLN,150.00 PLN,75.00 PLN,4.00",
      "Wiosna Search,google,cpc,10,4,3,2,2,600.00 PLN,,,",
      "Bez atrybucji,,,,,2,,1,10.00 EUR,,,",
    ]);
  });

  it("formula w nazwie kampanii z adresu jest neutralizowana, waluty rozdzielone", () => {
    const csv = buildAdsFunnelCsv(
      report([
        group({
          kind: "utm_campaign",
          label: null,
          utmCampaign: '=HYPERLINK("http://zly")',
          cost: [],
          revenue: [
            { currency: "EUR", cents: 100 },
            { currency: "PLN", cents: 200 },
          ],
          channels: [],
        }),
      ]),
      LABELS,
    );
    const lines = csv.split("\n");
    expect(lines[1]).toBe('"\'=HYPERLINK(""http://zly"")",,,10,4,3,2,2,"1.00 EUR; 2.00 PLN",,,');
  });
});

describe("adsFunnelGroupName", () => {
  it("etykieta > utm_campaign > id kampanii > bez kampanii", () => {
    expect(adsFunnelGroupName(group(), "-", "+")).toBe("Wiosna Search");
    expect(adsFunnelGroupName(group({ kind: "utm_campaign", label: null }), "-", "+")).toBe(
      "wiosna",
    );
    expect(
      adsFunnelGroupName(
        group({ kind: "gad_campaign", label: null, utmCampaign: null, gadCampaignId: "987" }),
        "-",
        "+",
      ),
    ).toBe("987");
    expect(adsFunnelGroupName(group({ kind: "none" }), "Bez kampanii", "+")).toBe("Bez kampanii");
    // Grupa zwinieta przez baze ma wlasna nazwe, nie etykiete ktorejkolwiek kampanii.
    expect(adsFunnelGroupName(group({ kind: "other", key: "other" }), "-", "Pozostale")).toBe(
      "Pozostale",
    );
    // Grupa bez zadnej nazwy (zly ksztalt z bazy) - tez nazwa zastepcza, nie pusta komorka.
    expect(
      adsFunnelGroupName(
        group({ kind: "utm_campaign", label: null, utmCampaign: null }),
        "Bez kampanii",
        "+",
      ),
    ).toBe("Bez kampanii");
  });
});

describe("adsFunnelFormat", () => {
  it("kwoty w roznych walutach obok siebie, nigdy zsumowane; pusto = null", () => {
    expect(
      formatAmounts(
        [
          { currency: "PLN", cents: 49900 },
          { currency: "EUR", cents: 1000 },
        ],
        "pl",
      ),
    ).toBe(`${formatMoney(49900, "PLN", "pl")} + ${formatMoney(1000, "EUR", "pl")}`);
    expect(formatAmounts([], "pl")).toBeNull();
  });

  it("koszt z mikro na grosze", () => {
    expect(formatCosts([{ currency: "PLN", micros: 150_000_000 }], "en")).toBe(
      formatMoney(15000, "PLN", "en"),
    );
    expect(formatCosts([], "en")).toBeNull();
  });

  it("udzial i ROAS albo null (kreska na ekranie)", () => {
    expect(formatRate(0.256)).toBe("26%");
    expect(formatRate(null)).toBeNull();
    expect(formatRoas(4)).toBe("4.00×");
    expect(formatRoas(null)).toBeNull();
  });
});
