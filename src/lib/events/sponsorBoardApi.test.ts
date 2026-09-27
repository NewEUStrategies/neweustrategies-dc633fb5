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
  fetchSponsorLinks,
  fetchTierLayouts,
  isHttpsUrl,
  saveHomeAd,
  setSponsorLink,
  setTierLayout,
  toLayout,
  toLinkMode,
  useDeleteHomeAd,
  useHomeAds,
  usePublicHomeAds,
  useSaveHomeAd,
  useSetSponsorLink,
  useSetTierLayout,
  useSponsorLinks,
  useTierLayouts,
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
    expect(validateHomeAd({ ...base, imageMobileUrl: "http://x.pl/m.png" })).toEqual([
      "imageMobileUrl",
    ]);
    expect(validateHomeAd({ ...base, imageMobileUrl: "https://x.pl/m.png" })).toEqual([]);
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

  it("odmowa zapisu układu dochodzi jako błąd, a brak potwierdzenia to false", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(setTierLayout({ id: "t1", layout: "grid" })).resolves.toBe(false);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden: not an event admin" } });
    await expect(setTierLayout({ id: "t1", layout: "grid" })).rejects.toThrow(
      "forbidden: not an event admin",
    );
  });
});

// UKŁADY I LINKI LOGOTYPÓW. Odczyt normalizuje wartości spoza listy do
// domyślnych (siatka, strona firmy), a zapis linku wysyła adres WYŁĄCZNIE dla
// trybu zewnętrznego - „bez linku" i „strona firmy" nie mogą zostawić w bazie
// starego adresu kampanii. Odmowa bazy dochodzi jako `Error` z tą samą głową.
describe("układy i linki logotypów", () => {
  it("odczyt układów: mapa id -> układ, nieznany układ to siatka, odmowa to błąd", async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({
      data: [
        { id: "t1", layout: "banner" },
        { id: "t2", layout: "karuzela" },
      ],
      error: null,
    });
    const { result } = renderHookWithQueryClient(() => useTierLayouts("ev1"));
    await waitFor(() =>
      expect(result.current.data).toEqual(
        new Map([
          ["t1", "banner"],
          ["t2", "grid"],
        ]),
      ),
    );
    expect(rpc).toHaveBeenCalledWith("admin_event_sponsor_tier_layouts", { p_event_id: "ev1" });

    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchTierLayouts("ev1")).resolves.toEqual(new Map());
    rpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden: not an event admin" } });
    await expect(fetchTierLayouts("ev1")).rejects.toThrow("forbidden: not an event admin");
  });

  it("odczyt linków: pusty adres to napis, brak danych to pusta mapa, odmowa to błąd", async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchSponsorLinks("ev1")).resolves.toEqual(new Map());
    rpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden: not an event admin" } });
    await expect(fetchSponsorLinks("ev1")).rejects.toThrow("forbidden: not an event admin");
  });

  it("zapis linku: adres tylko dla trybu zewnętrznego i odświeżenie linków TEGO wydarzenia", async () => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: true, error: null });
    const { result, queryClient } = renderHookWithQueryClient(() => useSetSponsorLink("ev1"));
    const linki = [...sponsorKeys.event("ev1"), "links"];
    const cudze = [...sponsorKeys.event("ev2"), "links"];
    queryClient.setQueryData(linki, new Map());
    queryClient.setQueryData(cudze, new Map());

    await act(() =>
      result.current.mutateAsync({ id: "s1", mode: "external", url: "  https://go.example/k  " }),
    );
    expect(rpc).toHaveBeenLastCalledWith("admin_event_sponsor_set_link", {
      _id: "s1",
      _mode: "external",
      _url: "https://go.example/k",
    });
    expect(queryClient.getQueryState(linki)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(cudze)?.isInvalidated).toBe(false);

    await act(() =>
      result.current.mutateAsync({ id: "s1", mode: "none", url: "https://go.example/stary" }),
    );
    expect(rpc).toHaveBeenLastCalledWith("admin_event_sponsor_set_link", {
      _id: "s1",
      _mode: "none",
      _url: "",
    });

    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(setSponsorLink({ id: "s1", mode: "exhibitor", url: "" })).resolves.toBe(false);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "not_found: sponsor" } });
    await expect(setSponsorLink({ id: "s1", mode: "exhibitor", url: "" })).rejects.toThrow(
      "not_found: sponsor",
    );
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

  it("ustawienia linkow: zamkniety podglad i brak wydarzenia nie pytaja bazy", async () => {
    rpc.mockReset();
    const closed = renderHookWithQueryClient(() => useSponsorLinks("ev1", false));
    const noEvent = renderHookWithQueryClient(() => useSponsorLinks(""));
    expect(closed.result.current.fetchStatus).toBe("idle");
    expect(noEvent.result.current.fetchStatus).toBe("idle");
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({
      data: [{ id: "s1", link_mode: "none", link_url: null }],
      error: null,
    });
    const open = renderHookWithQueryClient(() => useSponsorLinks("ev1", true));
    await waitFor(() =>
      expect(open.result.current.data).toEqual(new Map([["s1", { mode: "none", url: "" }]])),
    );
    expect(rpc).toHaveBeenCalledWith("admin_event_sponsor_links", { p_event_id: "ev1" });
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
