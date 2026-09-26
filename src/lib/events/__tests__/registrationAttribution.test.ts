// Przypiecie atrybucji do zgloszenia (`src/lib/events/registrationAttribution.ts`).
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. PRZYPIECIE BEZ ZGODY - kampania trafia do zgloszenia (i do CRM) mimo
//      odmowy pomiaru.
//   2. IDENTYFIKATOR KLIKNIECIA BEZ ZGODY MARKETINGOWEJ w ladunku RPC.
//   3. AWARIA RPC WYWRACA EKRAN POTWIERDZENIA - funkcja ma nigdy nie rzucac.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  analytics: true,
  marketing: true,
  rpc: null as SupabaseRpcStub | null,
  throws: false,
  read: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.throws) throw new Error("siec padla");
      return h.rpc!.rpc(name, args);
    },
  },
}));
vi.mock("@/lib/ads/consent", () => ({
  hasCategoryConsent: (cat: string) => (cat === "marketing" ? h.marketing : h.analytics),
}));
vi.mock("@/lib/analytics/adAttributionStore", () => ({
  readAdAttribution: (consent: unknown, nowMs: number) => h.read(consent, nowMs),
}));

const { attachRegistrationAttribution } = await import("@/lib/events/registrationAttribution");

const FIRST = {
  ts: 1,
  landingPath: null,
  referrerHost: "google.com",
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  utmContent: null,
  gadSource: null,
  gadCampaignId: null,
  clickType: null,
  clickId: null,
};
const LAST = {
  ...FIRST,
  ts: 2,
  referrerHost: null,
  utmCampaign: "Wiosna",
  clickType: "gclid" as const,
  clickId: "Cj0KCQjw-abc",
};

beforeEach(() => {
  h.analytics = true;
  h.marketing = true;
  h.throws = false;
  h.rpc = supabaseRpcStub();
  h.rpc.setData("event_registration_attribution_attach", { ok: true, attached: true });
  h.read.mockReset();
  h.read.mockReturnValue({ v: 1, first: FIRST, last: LAST });
});

describe("attachRegistrationAttribution", () => {
  it("bez zgody analytics ani marketing nic nie wychodzi", async () => {
    h.analytics = false;
    h.marketing = false;
    expect(await attachRegistrationAttribution("token-1")).toBe(false);
    expect(h.rpc!.names()).toEqual([]);
  });

  it("zgoda marketingowa: pierwsze i ostatnie dotkniecie z identyfikatorem i flaga zgody", async () => {
    expect(await attachRegistrationAttribution("token-1")).toBe(true);
    const payload = h.rpc!.lastCall("event_registration_attribution_attach")?.arg("p_payload");
    expect(payload).toEqual({
      manage_token: "token-1",
      first: expect.objectContaining({ ts: 1, referrer_host: "google.com" }),
      last: expect.objectContaining({ ts: 2, utm_campaign: "Wiosna", click_id: "Cj0KCQjw-abc" }),
      ad_consent: true,
    });
    expect(h.read).toHaveBeenCalledWith({ analytics: true, marketing: true }, expect.any(Number));
  });

  it("sama analityka: magazyn pytany bez marketingu, flaga zgody reklamowej false", async () => {
    h.marketing = false;
    await attachRegistrationAttribution("token-1");
    expect(h.read).toHaveBeenCalledWith({ analytics: true, marketing: false }, expect.any(Number));
    expect(
      (
        h.rpc!.lastCall("event_registration_attribution_attach")?.arg("p_payload") as Record<
          string,
          unknown
        >
      ).ad_consent,
    ).toBe(false);
  });

  it("zgoda bez dotkniecia = wejscie bezposrednie (null w obu polach)", async () => {
    h.read.mockReturnValue(null);
    await attachRegistrationAttribution("token-1");
    expect(
      h.rpc!.lastCall("event_registration_attribution_attach")?.arg("p_payload"),
    ).toMatchObject({
      first: null,
      last: null,
    });
  });

  it("odmowa bazy i wyjatek sieci to false, nigdy wyjatek", async () => {
    h.rpc!.setError("event_registration_attribution_attach", "invalid_payload: x");
    expect(await attachRegistrationAttribution("token-1")).toBe(false);
    h.throws = true;
    await expect(attachRegistrationAttribution("token-1")).resolves.toBe(false);
  });
});
