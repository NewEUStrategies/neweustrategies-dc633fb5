import { describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { sponsorKeys } from "@/lib/events/useEventSponsors";
import {
  deleteHomeAd,
  fetchHomeAds,
  fetchPublicHomeAds,
  isHttpsUrl,
  saveHomeAd,
  toLayout,
  toLinkMode,
  useDeleteHomeAd,
  useHomeAds,
  usePublicHomeAds,
  useSaveHomeAd,
  useSetTierLayout,
  validateHomeAd,
  type HomeAdInput,
} from "./sponsorBoardApi";

const base: HomeAdInput = {
  eventId: "e",
  imageUrl: "https://neweuropeanstrategies.com/media/a.png",
  imageMobileUrl: "",
  linkUrl: "",
  altText: "",
  groupIds: [],
  startsAt: "",
  endsAt: "",
  isActive: true,
  sponsorId: "",
};

describe("sponsorBoardApi", () => {
  it("przyjmuje tylko https", () => {
    expect(isHttpsUrl("https://a.pl")).toBe(true);
    expect(isHttpsUrl("http://a.pl")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
  });

  it("normalizuje układ i tryb linku", () => {
    expect(toLayout("banner")).toBe("banner");
    expect(toLayout("x")).toBe("grid");
    expect(toLinkMode("none")).toBe("none");
    expect(toLinkMode(null)).toBe("exhibitor");
  });

  it("waliduje reklamę", () => {
    expect(validateHomeAd(base)).toEqual([]);
    expect(validateHomeAd({ ...base, imageUrl: "" })).toContain("imageUrl");
    expect(validateHomeAd({ ...base, linkUrl: "http://x.pl" })).toContain("linkUrl");
    expect(
      validateHomeAd({ ...base, startsAt: "2026-10-02T10:00:00Z", endsAt: "2026-10-01T10:00:00Z" }),
    ).toContain("endsAt");
  });
});

// ZMIANA UKLADU ODSWIEZA LISTE SEKCJI. Od migracji 20260923100100 uklad
// prowadzi tez `max_companies` (baner = 1, siatka po banerze = bez limitu), a
// limit czyta panel poziomow (`SponsorTiersPanel`) z zapytania `tiers`.
// Mutacja uniewaznia cala galaz wydarzenia, wiec `tiers` i `layouts` sa w niej
// prefiksem - ta asercja pilnuje, zeby zawezenie kluczy tego nie zgubilo.
describe("useSetTierLayout", () => {
  it("po zmianie ukladu uniewaznia liste sekcji i uklady TEGO wydarzenia", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const { result, queryClient } = renderHookWithQueryClient(() => useSetTierLayout("ev1"));
    const uklady = [...sponsorKeys.event("ev1"), "layouts"];
    queryClient.setQueryData(sponsorKeys.tiers("ev1"), []);
    queryClient.setQueryData(uklady, new Map());
    queryClient.setQueryData(sponsorKeys.tiers("ev2"), []);

    await act(() => result.current.mutateAsync({ id: "t1", layout: "banner" }));

    expect(rpc).toHaveBeenCalledWith("admin_event_sponsor_tier_set_layout", {
      _id: "t1",
      _layout: "banner",
    });
    expect(queryClient.getQueryState(sponsorKeys.tiers("ev1"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(uklady)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(sponsorKeys.tiers("ev2"))?.isInvalidated).toBe(false);
  });
});

// REKLAMA STRONY GŁÓWNEJ I JEJ SPONSOR (raport dla sponsora, F6). Klucz
// `sponsor_id` jedzie do bazy ZAWSZE: pusty wybór to `null` (odpięcie), a nie
// brak klucza - baza rozróżnia „nie zmieniaj" od „odepnij" po obecności klucza.
describe("reklama strony głównej", () => {
  it("zapis niesie sponsora: uuid przypina, pusty wybór odpina jawnym `null`", async () => {
    rpc.mockResolvedValue({ data: "ad-1", error: null });
    await expect(saveHomeAd({ ...base, id: "ad-1", sponsorId: "sp-1" })).resolves.toBe("ad-1");
    expect(rpc).toHaveBeenLastCalledWith("admin_event_home_ad_save", {
      p_payload: expect.objectContaining({ id: "ad-1", event_id: "e", sponsor_id: "sp-1" }),
    });
    await saveHomeAd({ ...base, imageUrl: "  https://cdn.example.org/x.png  " });
    const payload = rpc.mock.calls.at(-1)?.[1] as { p_payload: Record<string, unknown> };
    expect(payload.p_payload).toMatchObject({
      id: "",
      sponsor_id: null,
      image_url: "https://cdn.example.org/x.png",
    });
    expect(Object.prototype.hasOwnProperty.call(payload.p_payload, "sponsor_id")).toBe(true);
  });

  it("odmowa bazy przy zapisie, liście i usuwaniu to wyjątek z treścią bazy", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "sponsor_not_in_event: x" } });
    await expect(saveHomeAd(base)).rejects.toThrow("sponsor_not_in_event: x");
    await expect(fetchHomeAds("e")).rejects.toThrow("sponsor_not_in_event: x");
    await expect(deleteHomeAd("ad-1")).rejects.toThrow("sponsor_not_in_event: x");
    await expect(fetchPublicHomeAds("kongres")).rejects.toThrow("sponsor_not_in_event: x");
  });

  it("lista panelu i lista publiczna: brak danych to pusta lista", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchHomeAds("e")).resolves.toEqual([]);
    await expect(fetchPublicHomeAds("kongres")).resolves.toEqual([]);
    expect(rpc).toHaveBeenLastCalledWith("event_home_ads_for_viewer", { p_slug: "kongres" });
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(deleteHomeAd("ad-1")).resolves.toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("admin_event_home_ad_delete", { _id: "ad-1" });
  });

  it("hooki: lista panelu czyta TO wydarzenie, zapis i usunięcie odświeżają tylko jego listę", async () => {
    rpc.mockResolvedValue({ data: [{ id: "ad-1", sponsor_id: "sp-1" }], error: null });
    const list = renderHookWithQueryClient(() => useHomeAds("ev1"));
    await waitFor(() =>
      expect(list.result.current.data).toEqual([{ id: "ad-1", sponsor_id: "sp-1" }]),
    );
    expect(rpc).toHaveBeenLastCalledWith("admin_event_home_ads_list", { p_event_id: "ev1" });

    rpc.mockResolvedValue({ data: "ad-2", error: null });
    const save = renderHookWithQueryClient(() => useSaveHomeAd("ev1"));
    save.queryClient.setQueryData(["event-home-ads", "ev1"], []);
    save.queryClient.setQueryData(["event-home-ads", "ev2"], []);
    await act(() => save.result.current.mutateAsync(base));
    expect(save.queryClient.getQueryState(["event-home-ads", "ev1"])?.isInvalidated).toBe(true);
    expect(save.queryClient.getQueryState(["event-home-ads", "ev2"])?.isInvalidated).toBe(false);

    rpc.mockResolvedValue({ data: true, error: null });
    const remove = renderHookWithQueryClient(() => useDeleteHomeAd("ev1"));
    remove.queryClient.setQueryData(["event-home-ads", "ev1"], []);
    await act(() => remove.result.current.mutateAsync("ad-1"));
    expect(remove.queryClient.getQueryState(["event-home-ads", "ev1"])?.isInvalidated).toBe(true);
  });

  it("lista publiczna nie pyta bazy bez slugu", async () => {
    rpc.mockReset();
    const none = renderHookWithQueryClient(() => usePublicHomeAds(""));
    expect(none.result.current.fetchStatus).toBe("idle");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: [], error: null });
    const some = renderHookWithQueryClient(() => usePublicHomeAds("kongres"));
    await waitFor(() => expect(some.result.current.data).toEqual([]));
  });
});
