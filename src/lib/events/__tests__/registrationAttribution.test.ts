// Atrybucja kampanii: ladunek zgloszenia (`attributionPayload`) i przypiecie
// do zamowienia pakietu (`src/lib/events/registrationAttribution.ts`).
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. ATRYBUCJA BEZ ZGODY - kampania trafia do zgloszenia (i do CRM) mimo
//      odmowy pomiaru. Od REG-04 przypina ja SERWER zapisu, ale bramka zgody
//      zostaje tutaj: tylko przegladarka zna magazyn zgod, a serwer przypina
//      to, co dostal.
//   2. IDENTYFIKATOR KLIKNIECIA BEZ ZGODY MARKETINGOWEJ w ladunku.
//   3. AWARIA RPC WYWRACA EKRAN - przypiecie pakietu ma nigdy nie rzucac.
//   4. ZAKUP PAKIETU BEZ ATRYBUCJI - zamowienie pakietu (bez `manage_token`)
//      nie mialo jak trafic do lejka kampanii.
//   5. PRZEGLADARKA SAMA PRZYPINA ZGLOSZENIE - po REG-04 nie ma juz takiej
//      drogi (przegladarka niezweryfikowanego wolajacego nie ma klucza).
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

const { attachPackageOrderAttribution, attributionPayload } =
  await import("@/lib/events/registrationAttribution");

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

describe("attributionPayload - ladunek zgloszenia dla serwera zapisu", () => {
  it("bez zgody analytics ani marketing nic nie wychodzi", () => {
    h.analytics = false;
    h.marketing = false;
    expect(attributionPayload()).toBeNull();
    expect(h.read).not.toHaveBeenCalled();
  });

  it("zgoda marketingowa: pierwsze i ostatnie dotkniecie z identyfikatorem i flaga zgody", () => {
    expect(attributionPayload()).toEqual({
      first: expect.objectContaining({ ts: 1, referrer_host: "google.com" }),
      last: expect.objectContaining({ ts: 2, utm_campaign: "Wiosna", click_id: "Cj0KCQjw-abc" }),
      ad_consent: true,
    });
    expect(h.read).toHaveBeenCalledWith({ analytics: true, marketing: true }, expect.any(Number));
  });

  it("sama analityka: magazyn pytany bez marketingu, flaga zgody reklamowej false", () => {
    h.marketing = false;
    expect(attributionPayload()?.ad_consent).toBe(false);
    expect(h.read).toHaveBeenCalledWith({ analytics: true, marketing: false }, expect.any(Number));
  });

  it("zgoda bez dotkniecia = wejscie bezposrednie (null w obu polach)", () => {
    h.read.mockReturnValue(null);
    expect(attributionPayload()).toEqual({ first: null, last: null, ad_consent: true });
  });

  it("ladunek NIE niesie klucza samoobslugi i nie wola bazy z przegladarki", () => {
    const payload = attributionPayload();
    expect(Object.keys(payload ?? {}).sort()).toEqual(["ad_consent", "first", "last"]);
    expect(h.rpc!.names()).toEqual([]);
  });

  it("modul nie wystawia juz przypiecia zgloszenia z przegladarki", async () => {
    const mod = await import("@/lib/events/registrationAttribution");
    expect("attachRegistrationAttribution" in mod).toBe(false);
  });
});

describe("attachPackageOrderAttribution - zakup pakietu grupowego", () => {
  beforeEach(() => {
    h.rpc!.setData("event_package_order_attribution_attach", { ok: true, attached: true });
  });

  it("zamowienie pakietu dostaje te same dotkniecia, klucz to identyfikator zamowienia", async () => {
    expect(await attachPackageOrderAttribution("ord-1")).toBe(true);
    expect(h.rpc!.lastCall("event_package_order_attribution_attach")?.arg("p_payload")).toEqual({
      order_id: "ord-1",
      first: expect.objectContaining({ ts: 1, referrer_host: "google.com" }),
      last: expect.objectContaining({ ts: 2, utm_campaign: "Wiosna", click_id: "Cj0KCQjw-abc" }),
      ad_consent: true,
    });
    expect(h.rpc!.names()).toEqual(["event_package_order_attribution_attach"]);
  });

  it("bez zgody nic nie wychodzi; sama analityka - flaga zgody reklamowej false", async () => {
    h.analytics = false;
    h.marketing = false;
    expect(await attachPackageOrderAttribution("ord-1")).toBe(false);
    expect(h.rpc!.names()).toEqual([]);

    h.analytics = true;
    await attachPackageOrderAttribution("ord-1");
    expect(h.read).toHaveBeenLastCalledWith(
      { analytics: true, marketing: false },
      expect.any(Number),
    );
    expect(
      (
        h.rpc!.lastCall("event_package_order_attribution_attach")?.arg("p_payload") as Record<
          string,
          unknown
        >
      ).ad_consent,
    ).toBe(false);
  });

  it("odmowa bazy i wyjatek sieci to false, nigdy wyjatek", async () => {
    h.rpc!.setError("event_package_order_attribution_attach", "invalid_payload: x");
    expect(await attachPackageOrderAttribution("ord-1")).toBe(false);
    h.throws = true;
    await expect(attachPackageOrderAttribution("ord-1")).resolves.toBe(false);
  });
});
