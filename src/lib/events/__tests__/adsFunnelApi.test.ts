// Warstwa danych panelu lejka (`src/lib/events/adsFunnelApi.ts`).
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. KLUCZ POMINIETY ZAMIENIA SIE W NULL - zmiana etykiety czysci nazwe
//      konwersji (konwencja: pominiety = bez zmian, null = wyczysc).
//   2. ODMOWA BAZY GUBI GLOWE KOMUNIKATU - mapa bledow pokazuje "unknown"
//      zamiast "kampania juz zmapowana".
//   3. OKNO "CALOSC" WYSYLA NULL-e - RPC ma dostac brak argumentu (DEFAULT NULL).
//   4. WIERSZ LISTY Z NULL-em (generator klamie "niepuste") psuje ekran.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { freezeClock } from "@/test/time";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => h.rpc!.rpc(name, args) },
}));

const api = await import("@/lib/events/adsFunnelApi");

// Daty w fixture'ach sa w roku 2099 - zegar stoi, zeby nic nie zalezalo od dnia uruchomienia.
freezeClock();

const EVENT = "3f1a0c8e-0000-4000-8000-000000000042";
const CAMPAIGN = "c0000000-0000-4000-8000-000000000001";

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("kampanie", () => {
  it("lista: wiersze z bazy na typy ekranu, koszty per waluta", async () => {
    h.rpc!.setData("admin_event_ad_campaigns_list", [
      {
        id: CAMPAIGN,
        match_kind: "google_ads_campaign_id",
        match_value: "987654321",
        label: "PMax",
        conversion_action_name: null,
        costs: [{ currency: "PLN", cost_micros: 30000000, days: 1 }, "smiec"],
        created_at: "x",
        updated_at: "x",
      },
      {
        id: "c2",
        match_kind: "utm_campaign",
        match_value: "wiosna",
        label: "Wiosna",
        conversion_action_name: "",
        costs: null,
        created_at: "x",
        updated_at: "x",
      },
      {
        id: "c3",
        match_kind: "cos-nowego",
        match_value: "x",
        label: "X",
        conversion_action_name: "Bilet",
        costs: [],
        created_at: "x",
        updated_at: "x",
      },
    ]);
    const got = await api.fetchAdCampaigns(EVENT);
    expect(h.rpc!.lastCall("admin_event_ad_campaigns_list")?.arg("p_event_id")).toBe(EVENT);
    expect(got).toEqual([
      {
        id: CAMPAIGN,
        matchKind: "google_ads_campaign_id",
        matchValue: "987654321",
        label: "PMax",
        conversionActionName: null,
        costs: [{ currency: "PLN", costMicros: 30000000, days: 1 }],
      },
      {
        id: "c2",
        matchKind: "utm_campaign",
        matchValue: "wiosna",
        label: "Wiosna",
        conversionActionName: null,
        costs: [],
      },
      {
        id: "c3",
        matchKind: "utm_campaign",
        matchValue: "x",
        label: "X",
        conversionActionName: "Bilet",
        costs: [],
      },
    ]);
  });

  it("lista pusta (null z bazy) to pusta tablica; odmowa to wyjatek z glowa komunikatu", async () => {
    h.rpc!.setData("admin_event_ad_campaigns_list", null);
    expect(await api.fetchAdCampaigns(EVENT)).toEqual([]);
    h.rpc!.setError("admin_event_ad_campaigns_list", "forbidden: admin role required");
    await expect(api.fetchAdCampaigns(EVENT)).rejects.toThrow("forbidden: admin role required");
  });

  it("zapis nowej: pelny ladunek snake_case", async () => {
    h.rpc!.setData("admin_event_ad_campaign_save", CAMPAIGN);
    const id = await api.saveAdCampaign({
      eventId: EVENT,
      matchKind: "utm_campaign",
      matchValue: "wiosna",
      label: "Wiosna",
      conversionActionName: null,
    });
    expect(id).toBe(CAMPAIGN);
    expect(h.rpc!.lastCall("admin_event_ad_campaign_save")?.arg("p_payload")).toEqual({
      event_id: EVENT,
      match_kind: "utm_campaign",
      match_value: "wiosna",
      label: "Wiosna",
      conversion_action_name: null,
    });
  });

  it("zmiana: pominiete klucze NIE jada (baza je zostawia)", async () => {
    h.rpc!.setData("admin_event_ad_campaign_save", CAMPAIGN);
    await api.saveAdCampaign({ id: CAMPAIGN, label: "Nowa etykieta" });
    expect(h.rpc!.lastCall("admin_event_ad_campaign_save")?.arg("p_payload")).toEqual({
      id: CAMPAIGN,
      label: "Nowa etykieta",
    });
    h.rpc!.setError("admin_event_ad_campaign_save", "campaign_exists: already mapped");
    await expect(api.saveAdCampaign({ id: CAMPAIGN })).rejects.toThrow("campaign_exists");
  });

  it("usuniecie", async () => {
    h.rpc!.setData("admin_event_ad_campaign_delete", true);
    await api.deleteAdCampaign(CAMPAIGN);
    expect(h.rpc!.lastCall("admin_event_ad_campaign_delete")?.arg("p_id")).toBe(CAMPAIGN);
    h.rpc!.setError("admin_event_ad_campaign_delete", "not_found: x");
    await expect(api.deleteAdCampaign(CAMPAIGN)).rejects.toThrow("not_found");
  });
});

describe("koszty", () => {
  it("lista: NULL klikniec i wyswietlen zostaje nullem (typy generatora klamia)", async () => {
    h.rpc!.setData("admin_event_ad_costs_list", [
      {
        day: "2099-06-14",
        cost_micros: "50000000",
        currency: "PLN",
        clicks: null,
        impressions: 10,
        source: "csv",
        updated_at: "x",
      },
      {
        day: "2099-06-13",
        cost_micros: 1,
        currency: "EUR",
        clicks: 3,
        impressions: null,
        source: "manual",
        updated_at: "x",
      },
    ]);
    expect(await api.fetchAdCosts(CAMPAIGN)).toEqual([
      {
        day: "2099-06-14",
        costMicros: 50000000,
        currency: "PLN",
        clicks: null,
        impressions: 10,
        source: "csv",
      },
      {
        day: "2099-06-13",
        costMicros: 1,
        currency: "EUR",
        clicks: 3,
        impressions: null,
        source: "manual",
      },
    ]);
    expect(h.rpc!.lastCall("admin_event_ad_costs_list")?.arg("p_campaign_id")).toBe(CAMPAIGN);
    h.rpc!.setData("admin_event_ad_costs_list", null);
    expect(await api.fetchAdCosts(CAMPAIGN)).toEqual([]);
    h.rpc!.setError("admin_event_ad_costs_list", "not_found: x");
    await expect(api.fetchAdCosts(CAMPAIGN)).rejects.toThrow("not_found");
  });

  it("zapis wsadowy: wiersze bez kluczy pominietych", async () => {
    h.rpc!.setData("admin_event_ad_costs_save", 2);
    const n = await api.saveAdCosts({
      campaignId: CAMPAIGN,
      source: "csv",
      rows: [
        { day: "2099-06-14", costMicros: 50000000, currency: "PLN", clicks: 40, impressions: null },
        { day: "2099-06-13", costMicros: 1, currency: "PLN" },
      ],
    });
    expect(n).toBe(2);
    expect(h.rpc!.lastCall("admin_event_ad_costs_save")?.arg("p_payload")).toEqual({
      campaign_id: CAMPAIGN,
      source: "csv",
      rows: [
        {
          day: "2099-06-14",
          cost_micros: 50000000,
          currency: "PLN",
          clicks: 40,
          impressions: null,
        },
        { day: "2099-06-13", cost_micros: 1, currency: "PLN" },
      ],
    });
    h.rpc!.setError("admin_event_ad_costs_save", "invalid_cost_row: row 2 is invalid");
    await expect(
      api.saveAdCosts({ campaignId: CAMPAIGN, source: "manual", rows: [] }),
    ).rejects.toThrow("invalid_cost_row: row 2");
  });

  it("usuniecie dnia", async () => {
    h.rpc!.setData("admin_event_ad_cost_delete", true);
    await api.deleteAdCost(CAMPAIGN, "2099-06-14");
    expect(h.rpc!.lastCall("admin_event_ad_cost_delete")?.args).toEqual({
      p_campaign_id: CAMPAIGN,
      p_day: "2099-06-14",
    });
    h.rpc!.setError("admin_event_ad_cost_delete", "not_found: x");
    await expect(api.deleteAdCost(CAMPAIGN, "2099-06-14")).rejects.toThrow("not_found");
  });
});

describe("raport i eksport", () => {
  it("okno 'calosc' nie wysyla granic; okno dzienne wysyla tylko poczatek", async () => {
    h.rpc!.setData("admin_event_ads_funnel", { groups: [] });
    const all = await api.fetchAdsFunnel({ eventId: EVENT, from: null, to: null });
    expect(h.rpc!.lastCall("admin_event_ads_funnel")?.args).toEqual({ p_event_id: EVENT });
    expect(all.groups).toEqual([]);

    await api.fetchAdsFunnel({
      eventId: EVENT,
      from: "2099-06-09T00:00:00.000Z",
      to: "2099-06-15T00:00:00.000Z",
    });
    expect(h.rpc!.lastCall("admin_event_ads_funnel")?.args).toEqual({
      p_event_id: EVENT,
      p_from: "2099-06-09T00:00:00.000Z",
      p_to: "2099-06-15T00:00:00.000Z",
    });
  });

  it("raport null z bazy to pusty raport; odmowa to wyjatek", async () => {
    h.rpc!.setData("admin_event_ads_funnel", null);
    expect((await api.fetchAdsFunnel({ eventId: EVENT, from: null, to: null })).groups).toEqual([]);
    h.rpc!.setError("admin_event_ads_funnel", "invalid_window: x");
    await expect(api.fetchAdsFunnel({ eventId: EVENT, from: null, to: null })).rejects.toThrow(
      "invalid_window",
    );
  });

  it("eksport konwersji przez parser", async () => {
    h.rpc!.setData("admin_event_ads_conversions_export", { timezone: "Europe/Berlin", rows: [] });
    const got = await api.fetchAdsConversions({
      eventId: EVENT,
      from: "2099-06-01T00:00:00.000Z",
      to: null,
    });
    expect(got.timezone).toBe("Europe/Berlin");
    expect(h.rpc!.lastCall("admin_event_ads_conversions_export")?.args).toEqual({
      p_event_id: EVENT,
      p_from: "2099-06-01T00:00:00.000Z",
    });
    h.rpc!.setData("admin_event_ads_conversions_export", null);
    expect((await api.fetchAdsConversions({ eventId: EVENT, from: null, to: null })).rows).toEqual(
      [],
    );
    h.rpc!.setError("admin_event_ads_conversions_export", "forbidden: x");
    await expect(api.fetchAdsConversions({ eventId: EVENT, from: null, to: null })).rejects.toThrow(
      "forbidden",
    );
  });
});
