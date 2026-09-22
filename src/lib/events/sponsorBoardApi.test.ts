import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

import { isHttpsUrl, toLayout, toLinkMode, validateHomeAd, type HomeAdInput } from "./sponsorBoardApi";

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
