// Hooki ekranu lejka (`src/lib/events/useEventAdsFunnel.ts`).
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. MUTACJA ODSWIEZA TYLKO LISTE - raport zostaje ze starym podzialem na
//      kampanie i starym kosztem (ROAS klamie do przeladowania).
//   2. MUTACJA ODSWIEZA CUDZE WYDARZENIE - galaz innej edycji traci cache.
//   3. ZAPYTANIE Z PUSTYM OKNEM / BEZ KAMPANII - strzal do bazy z NULL-em.
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => h.rpc!.rpc(name, args) },
}));

const hooks = await import("@/lib/events/useEventAdsFunnel");
const { adsFunnelKeys } = hooks;

const EVENT = "3f1a0c8e-0000-4000-8000-000000000042";
const OTHER = "3f1a0c8e-0000-4000-8000-000000000099";

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.rpc.setData("admin_event_ads_funnel", { groups: [] });
  h.rpc.setData("admin_event_ad_campaigns_list", []);
  h.rpc.setData("admin_event_ad_costs_list", []);
  h.rpc.setData("admin_event_ad_campaign_save", "c1");
  h.rpc.setData("admin_event_ad_campaign_delete", true);
  h.rpc.setData("admin_event_ad_costs_save", 2);
  h.rpc.setData("admin_event_ad_cost_delete", true);
  h.rpc.setData("admin_event_ads_conversions_export", { timezone: "Europe/Warsaw", rows: [] });
});

describe("klucze", () => {
  it("jedna fabryka zakorzeniona w `event-ads-funnel`, galaz per wydarzenie", () => {
    expect(adsFunnelKeys.event(EVENT)).toEqual(["event-ads-funnel", EVENT]);
    expect(adsFunnelKeys.report({ eventId: EVENT, from: "a", to: null })).toEqual([
      "event-ads-funnel",
      EVENT,
      "report",
      "a",
      null,
    ]);
    expect(adsFunnelKeys.campaigns(EVENT)).toEqual(["event-ads-funnel", EVENT, "campaigns"]);
    expect(adsFunnelKeys.costs(EVENT, "c1")).toEqual(["event-ads-funnel", EVENT, "costs", "c1"]);
  });
});

describe("zapytania", () => {
  it("raport: bez okna nie pyta bazy, z oknem - pyta z granicami", async () => {
    const idle = renderHookWithQueryClient(() => hooks.useAdsFunnelReport(null));
    expect(idle.result.current.fetchStatus).toBe("idle");
    const empty = renderHookWithQueryClient(() =>
      hooks.useAdsFunnelReport({ eventId: "", from: null, to: null }),
    );
    expect(empty.result.current.fetchStatus).toBe("idle");
    expect(h.rpc!.callsFor("admin_event_ads_funnel")).toHaveLength(0);

    const { result } = renderHookWithQueryClient(() =>
      hooks.useAdsFunnelReport({ eventId: EVENT, from: "2099-06-01T00:00:00.000Z", to: null }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc!.lastCall("admin_event_ads_funnel")?.arg("p_from")).toBe(
      "2099-06-01T00:00:00.000Z",
    );
  });

  it("kampanie i koszty: bez wydarzenia / kampanii nie pytaja bazy", async () => {
    expect(
      renderHookWithQueryClient(() => hooks.useAdCampaigns("")).result.current.fetchStatus,
    ).toBe("idle");
    expect(
      renderHookWithQueryClient(() => hooks.useAdCampaignCosts(EVENT, null)).result.current
        .fetchStatus,
    ).toBe("idle");

    const campaigns = renderHookWithQueryClient(() => hooks.useAdCampaigns(EVENT));
    const costs = renderHookWithQueryClient(() => hooks.useAdCampaignCosts(EVENT, "c1"));
    await waitFor(() => expect(campaigns.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(costs.result.current.isSuccess).toBe(true));
    expect(h.rpc!.lastCall("admin_event_ad_costs_list")?.arg("p_campaign_id")).toBe("c1");
  });
});

describe("mutacje uniewazniaja galaz TEGO wydarzenia", () => {
  it("zapis i usuniecie kampanii, zapis i usuniecie kosztu", async () => {
    const save = renderHookWithQueryClient(() => hooks.useSaveAdCampaign(EVENT));
    save.queryClient.setQueryData(adsFunnelKeys.campaigns(EVENT), []);
    save.queryClient.setQueryData(adsFunnelKeys.campaigns(OTHER), []);
    await save.result.current.mutateAsync({ id: "c1", label: "X" });
    expect(save.queryClient.getQueryState(adsFunnelKeys.campaigns(EVENT))?.isInvalidated).toBe(
      true,
    );
    expect(save.queryClient.getQueryState(adsFunnelKeys.campaigns(OTHER))?.isInvalidated).toBe(
      false,
    );

    const remove = renderHookWithQueryClient(() => hooks.useDeleteAdCampaign(EVENT));
    remove.queryClient.setQueryData(adsFunnelKeys.costs(EVENT, "c1"), []);
    await remove.result.current.mutateAsync("c1");
    expect(remove.queryClient.getQueryState(adsFunnelKeys.costs(EVENT, "c1"))?.isInvalidated).toBe(
      true,
    );
    expect(h.rpc!.lastCall("admin_event_ad_campaign_delete")?.arg("p_id")).toBe("c1");

    const costs = renderHookWithQueryClient(() => hooks.useSaveAdCosts(EVENT));
    costs.queryClient.setQueryData(
      adsFunnelKeys.report({ eventId: EVENT, from: null, to: null }),
      {},
    );
    expect(
      await costs.result.current.mutateAsync({ campaignId: "c1", source: "manual", rows: [] }),
    ).toBe(2);
    expect(
      costs.queryClient.getQueryState(
        adsFunnelKeys.report({ eventId: EVENT, from: null, to: null }),
      )?.isInvalidated,
    ).toBe(true);

    const removeCost = renderHookWithQueryClient(() => hooks.useDeleteAdCost(EVENT));
    removeCost.queryClient.setQueryData(adsFunnelKeys.costs(EVENT, "c1"), []);
    await removeCost.result.current.mutateAsync({ campaignId: "c1", day: "2099-06-14" });
    expect(h.rpc!.lastCall("admin_event_ad_cost_delete")?.args).toEqual({
      p_campaign_id: "c1",
      p_day: "2099-06-14",
    });
    expect(
      removeCost.queryClient.getQueryState(adsFunnelKeys.costs(EVENT, "c1"))?.isInvalidated,
    ).toBe(true);
  });

  it("eksport konwersji nie trafia do cache (mutacja na klikniecie)", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() =>
      hooks.useAdsConversionsExport(),
    );
    const data = await result.current.mutateAsync({ eventId: EVENT, from: null, to: null });
    expect(data.timezone).toBe("Europe/Warsaw");
    expect(queryClient.getQueryCache().findAll({ queryKey: adsFunnelKeys.all })).toHaveLength(0);
  });
});
