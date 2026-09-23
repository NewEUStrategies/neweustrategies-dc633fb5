import { describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { sponsorKeys } from "@/lib/events/useEventSponsors";
import {
  isHttpsUrl,
  toLayout,
  toLinkMode,
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
