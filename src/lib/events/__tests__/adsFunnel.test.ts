// Model raportu lejka (`src/lib/events/adsFunnel.ts`): parsery i wskazniki.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. ZMIANA KSZTALTU JSON W SQL WYWRACA RENDER - parser ma dac zera i kreski,
//      nie wyjatek.
//   2. ROAS SUMUJE ZLOTE Z EURO - wskaznik przy wielu walutach ma byc `null`.
//   3. ZEROWY MIANOWNIK DAJE 0% albo Infinity zamiast kreski.
//   4. EKSPORT Z WIERSZEM BEZ IDENTYFIKATORA KLIKNIECIA - taki wiersz wypada.
//   5. ROAS KAFLA LICZY PRZYCHOD KAMPANII BEZ KOSZTU - 600/100 + 200/brak dawalo
//      8,00x zamiast 6,00x.
import { describe, expect, it } from "vitest";

import { freezeClock, FIXED_NOW_MS } from "@/test/time";
import {
  adsFunnelWindow,
  costPerAcquisition,
  mappedCampaignsRoas,
  microsToCents,
  parseAdsConversionsExport,
  parseAdsFunnelReport,
  returnOnAdSpend,
  stepRate,
} from "@/lib/events/adsFunnel";

freezeClock();

describe("parseAdsFunnelReport", () => {
  it("przepisuje pelny raport z bazy na typy ekranu", () => {
    const got = parseAdsFunnelReport({
      window: { from: null, to: null, timezone: "Europe/Warsaw" },
      groups: [
        {
          key: "campaign:c1",
          kind: "campaign",
          campaign_id: "c1",
          label: "Wiosna Search",
          utm_campaign: "Wiosna",
          gad_campaign_id: null,
          visits: 10,
          registration_starts: 4,
          checkout_starts: 2,
          registrations: 3,
          paid: "2",
          revenue: [
            { currency: "PLN", cents: 59900 },
            { currency: "", cents: 1 },
          ],
          cost: [{ currency: "PLN", micros: 150000000 }, { cents: 5 }],
          channels: [
            {
              source: "google",
              medium: "cpc",
              visits: 10,
              registration_starts: 4,
              checkout_starts: 2,
              registrations: 3,
              paid: 2,
              revenue: [{ currency: "PLN", cents: 59900 }],
            },
            { visits: -5 },
          ],
        },
        { kind: "zly" },
      ],
      unattributed: { registrations: 2, paid: 1, revenue: [{ currency: "PLN", cents: 20000 }] },
      totals: {
        visits: 12,
        registration_starts: 4,
        checkout_starts: 2,
        attributed_registrations: 3,
        registrations: 5,
        paid: 3,
        revenue: [{ currency: "PLN", cents: 79900 }],
        cost: [{ currency: "PLN", micros: 150000000 }],
      },
    });

    expect(got.timezone).toBe("Europe/Warsaw");
    expect(got.groups[0]).toEqual({
      key: "campaign:c1",
      kind: "campaign",
      campaignId: "c1",
      label: "Wiosna Search",
      utmCampaign: "Wiosna",
      gadCampaignId: null,
      visits: 10,
      registrationStarts: 4,
      checkoutStarts: 2,
      registrations: 3,
      paid: 2,
      revenue: [{ currency: "PLN", cents: 59900 }],
      cost: [{ currency: "PLN", micros: 150000000 }],
      channels: [
        {
          source: "google",
          medium: "cpc",
          visits: 10,
          registrationStarts: 4,
          checkoutStarts: 2,
          registrations: 3,
          paid: 2,
          revenue: [{ currency: "PLN", cents: 59900 }],
        },
        {
          source: "(not set)",
          medium: "(not set)",
          visits: 0,
          registrationStarts: 0,
          checkoutStarts: 0,
          registrations: 0,
          paid: 0,
          revenue: [],
        },
      ],
    });
    expect(got.groupsFolded).toBe(0);
    // Nieznany rodzaj i brak klucza - grupa "bez kampanii", nie wyjatek.
    expect(got.groups[1]).toMatchObject({ key: "none", kind: "none", channels: [], cost: [] });
    expect(got.unattributed).toEqual({
      registrations: 2,
      paid: 1,
      revenue: [{ currency: "PLN", cents: 20000 }],
    });
    expect(got.totals).toEqual({
      visits: 12,
      registrationStarts: 4,
      checkoutStarts: 2,
      registrations: 5,
      paid: 3,
      attributedRegistrations: 3,
      revenue: [{ currency: "PLN", cents: 79900 }],
      cost: [{ currency: "PLN", micros: 150000000 }],
    });
  });

  it("pusta albo obca odpowiedz daje pusty raport ze strefa domyslna", () => {
    for (const raw of [null, [], "x", { groups: "nie-lista" }]) {
      const got = parseAdsFunnelReport(raw);
      expect(got.timezone).toBe("Europe/Warsaw");
      expect(got.groups).toEqual([]);
      expect(got.totals.visits).toBe(0);
      expect(got.unattributed.revenue).toEqual([]);
    }
  });
});

describe("parseAdsConversionsExport", () => {
  const good = {
    order_id: "o1",
    registration_id: "r1",
    click_id_type: "gbraid",
    click_id: "GBRAID-123456",
    conversion_action_name: "Bilet",
    conversion_time: "2099-06-15T10:00:00+00:00",
    conversion_time_local: "2099-06-15 12:00:00",
    value_cents: 49900,
    currency: "PLN",
    ad_user_data: true,
    ad_personalization: false,
  };

  it("przepisuje wiersze i liczniki pominietych", () => {
    const got = parseAdsConversionsExport({
      timezone: "Europe/Warsaw",
      rows: [
        good,
        {
          ...good,
          order_id: null,
          registration_id: null,
          conversion_time: null,
          conversion_action_name: null,
        },
      ],
      skipped: {
        unattributed: 1,
        no_click: 2,
        expired: 3,
        before_click: 4,
        consent_withdrawn: 5,
        awaiting_admission: 6,
      },
    });
    expect(got.rows[0]).toEqual({
      orderId: "o1",
      registrationId: "r1",
      clickType: "gbraid",
      clickId: "GBRAID-123456",
      conversionActionName: "Bilet",
      conversionTime: "2099-06-15T10:00:00+00:00",
      conversionTimeLocal: "2099-06-15 12:00:00",
      valueCents: 49900,
      currency: "PLN",
      adUserData: true,
      adPersonalization: false,
    });
    expect(got.rows[1]).toMatchObject({
      orderId: "",
      registrationId: "",
      conversionTime: "",
      conversionActionName: null,
    });
    expect(got.skipped).toEqual({
      unattributed: 1,
      noClick: 2,
      expired: 3,
      beforeClick: 4,
      consentWithdrawn: 5,
      awaitingAdmission: 6,
    });
  });

  it("wiersz bez rodzaju/identyfikatora klikniecia, waluty albo czasu wypada", () => {
    const got = parseAdsConversionsExport({
      rows: [
        { ...good, click_id_type: "fbclid" },
        { ...good, click_id: null },
        { ...good, currency: null },
        { ...good, conversion_time_local: "" },
        { ...good, click_id_type: "gclid" },
        { ...good, click_id_type: "wbraid" },
      ],
    });
    expect(got.rows.map((row) => row.clickType)).toEqual(["gclid", "wbraid"]);
    expect(got.timezone).toBe("Europe/Warsaw");
    expect(got.skipped).toEqual({
      unattributed: 0,
      noClick: 0,
      expired: 0,
      beforeClick: 0,
      consentWithdrawn: 0,
      awaitingAdmission: 0,
    });
  });
});

describe("wskazniki", () => {
  it("stepRate: udzial albo null przy zerowym mianowniku", () => {
    expect(stepRate(1, 4)).toBe(0.25);
    expect(stepRate(3, 0)).toBeNull();
  });

  it("costPerAcquisition: tylko jedna waluta kosztu i co najmniej jedno oplacone", () => {
    expect(costPerAcquisition([{ currency: "PLN", micros: 100_000_000 }], 4)).toEqual({
      currency: "PLN",
      micros: 25_000_000,
    });
    expect(costPerAcquisition([{ currency: "PLN", micros: 1 }], 0)).toBeNull();
    expect(costPerAcquisition([], 3)).toBeNull();
    expect(
      costPerAcquisition(
        [
          { currency: "PLN", micros: 1 },
          { currency: "EUR", micros: 1 },
        ],
        3,
      ),
    ).toBeNull();
  });

  it("mappedCampaignsRoas: tylko zmapowane kampanie Z KOSZTEM w obu sumach", () => {
    const report = parseAdsFunnelReport({
      groups: [
        {
          key: "campaign:c1",
          kind: "campaign",
          revenue: [{ currency: "PLN", cents: 60_000 }],
          cost: [{ currency: "PLN", micros: 100_000_000 }],
        },
        // Kampania bez wpisanego kosztu - jej przychod nie trafia do licznika.
        { key: "campaign:c2", kind: "campaign", revenue: [{ currency: "PLN", cents: 20_000 }] },
        {
          key: "campaign:c3",
          kind: "campaign",
          revenue: [{ currency: "PLN", cents: 5_000 }],
          cost: [{ currency: "PLN", micros: 0 }],
        },
        // Grupa niezmapowana z kosztem nie istnieje, ale i tak jest poza kaflem.
        {
          key: "utm:lato",
          kind: "utm_campaign",
          revenue: [{ currency: "PLN", cents: 90_000 }],
          cost: [{ currency: "PLN", micros: 1 }],
        },
      ],
      groups_folded: 3,
    });
    expect(report.groupsFolded).toBe(3);
    expect(mappedCampaignsRoas(report.groups)).toBe(6);
    expect(mappedCampaignsRoas(report.groups.filter((group) => group.key !== "campaign:c1"))).toBe(
      null,
    );
    expect(mappedCampaignsRoas([])).toBeNull();
  });

  it("parseAdsFunnelReport: grupa zwinieta `other` zachowuje rodzaj", () => {
    const got = parseAdsFunnelReport({ groups: [{ key: "other", kind: "other", visits: 7 }] });
    expect(got.groups[0]).toMatchObject({ key: "other", kind: "other", visits: 7 });
  });

  it("returnOnAdSpend: przychod / koszt w TEJ SAMEJ walucie", () => {
    // 600 zl przychodu na 150 zl kosztu = 4.
    expect(
      returnOnAdSpend(
        [
          { currency: "PLN", cents: 40_000 },
          { currency: "PLN", cents: 20_000 },
        ],
        [{ currency: "PLN", micros: 150_000_000 }],
      ),
    ).toBe(4);
    expect(returnOnAdSpend([], [{ currency: "PLN", micros: 1_000_000 }])).toBe(0);
    expect(
      returnOnAdSpend([{ currency: "EUR", cents: 1 }], [{ currency: "PLN", micros: 1 }]),
    ).toBeNull();
    expect(returnOnAdSpend([], [{ currency: "PLN", micros: 0 }])).toBeNull();
    expect(returnOnAdSpend([], [])).toBeNull();
  });

  it("microsToCents zaokragla", () => {
    expect(microsToCents(1_234_567)).toBe(123);
    expect(microsToCents(1_235_000)).toBe(124);
  });
});

describe("adsFunnelWindow", () => {
  it("calosc = bez granic", () => {
    expect(adsFunnelWindow("all", FIXED_NOW_MS)).toEqual({ from: null, to: null });
  });

  it("okna dzienne z dniem biezacym i otwarta gora", () => {
    // FIXED_NOW = 2099-06-15T12:00Z; 7 dni z dzisiejszym = od 2099-06-09 00:00Z.
    expect(adsFunnelWindow("7d", FIXED_NOW_MS)).toEqual({
      from: "2099-06-09T00:00:00.000Z",
      to: null,
    });
    expect(adsFunnelWindow("28d", FIXED_NOW_MS).from).toBe("2099-05-19T00:00:00.000Z");
    expect(adsFunnelWindow("90d", FIXED_NOW_MS).from).toBe("2099-03-18T00:00:00.000Z");
  });
});
