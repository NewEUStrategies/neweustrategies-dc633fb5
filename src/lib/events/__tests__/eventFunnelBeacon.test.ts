// Beacon kroku lejka (`src/lib/events/eventFunnelBeacon.ts`).
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. BEACON BEZ ZGODY ANALYTICS - wizyta liczona wbrew decyzji uzytkownika.
//   2. IDENTYFIKATOR KLIKNIECIA BEZ ZGODY MARKETINGOWEJ w ladunku.
//   3. POWTORKI - odswiezenie strony liczy druga wizyte w tej samej sesji.
//   4. ZABLOKOWANY MAGAZYN SESJI wywraca strone albo zeruje deduplikacje.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  analytics: true,
  marketing: false,
  beacon: vi.fn((_endpoint: string, _payload: unknown) => true),
  read: vi.fn(),
}));

vi.mock("@/lib/ads/consent", () => ({
  hasAnalyticsConsent: () => h.analytics,
  hasCategoryConsent: (cat: string) => (cat === "marketing" ? h.marketing : h.analytics),
}));
vi.mock("@/lib/analytics/track", () => ({
  readAnonId: () => "visitor-0001",
  readSession: () => "session-0001",
}));
vi.mock("@/lib/observability/report", () => ({
  sendBeaconPayload: (endpoint: string, payload: unknown) => h.beacon(endpoint, payload),
}));
vi.mock("@/lib/analytics/adAttributionStore", () => ({
  readAdAttribution: (consent: unknown, nowMs: number) => h.read(consent, nowMs),
}));

const KEY = "nes.event-funnel.sent";
const TOUCH = {
  ts: 1,
  landingPath: "/events/kongres",
  referrerHost: null,
  utmSource: "google",
  utmMedium: "cpc",
  utmCampaign: "Wiosna",
  utmTerm: null,
  utmContent: null,
  gadSource: null,
  gadCampaignId: null,
  clickType: "gclid" as const,
  clickId: null,
};

type Beacon = typeof import("@/lib/events/eventFunnelBeacon");

async function freshBeacon(): Promise<Beacon> {
  vi.resetModules();
  return import("@/lib/events/eventFunnelBeacon");
}

function lastPayload(): Record<string, unknown> {
  return h.beacon.mock.calls.at(-1)?.[1] as Record<string, unknown>;
}

beforeEach(() => {
  h.analytics = true;
  h.marketing = false;
  h.beacon.mockReset();
  h.beacon.mockReturnValue(true);
  h.read.mockReset();
  h.read.mockReturnValue(null);
  window.sessionStorage.clear();
  document.documentElement.lang = "pl";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendEventFunnelStep", () => {
  it("bez zgody analytics nic nie wychodzi", async () => {
    h.analytics = false;
    const { sendEventFunnelStep } = await freshBeacon();
    expect(sendEventFunnelStep("visit", { slug: "kongres" })).toBe(false);
    expect(h.beacon).not.toHaveBeenCalled();
  });

  it("wysyla krok z identyfikatorami analityki i dotknieciem bez klikniecia (sama analityka)", async () => {
    h.read.mockReturnValue({ v: 1, first: TOUCH, last: TOUCH });
    const { sendEventFunnelStep } = await freshBeacon();

    expect(sendEventFunnelStep("visit", { slug: "kongres" })).toBe(true);
    expect(h.beacon.mock.calls[0]?.[0]).toBe("/api/public/event-funnel");
    expect(lastPayload()).toEqual({
      step: "visit",
      slug: "kongres",
      visitor: "visitor-0001",
      session: "session-0001",
      touch: expect.objectContaining({
        utm_campaign: "Wiosna",
        click_id_type: "gclid",
        click_id: null,
      }),
      ad_consent: false,
      lang: "pl",
    });
    expect(h.read).toHaveBeenCalledWith({ analytics: true, marketing: false }, expect.any(Number));
  });

  it("przy zgodzie marketingowej prosi magazyn o pelna atrybucje i flaguje zgode", async () => {
    h.marketing = true;
    document.documentElement.lang = "en-GB";
    const { sendEventFunnelStep } = await freshBeacon();
    sendEventFunnelStep("checkout_start", { eventId: "3f1a0c8e-0000-4000-8000-000000000042" });

    expect(h.read).toHaveBeenCalledWith({ analytics: true, marketing: true }, expect.any(Number));
    expect(lastPayload()).toMatchObject({
      step: "checkout_start",
      event_id: "3f1a0c8e-0000-4000-8000-000000000042",
      touch: null,
      ad_consent: true,
      lang: "en",
    });
    expect(lastPayload()).not.toHaveProperty("slug");
  });

  it("nieznany jezyk dokumentu nie trafia do ladunku", async () => {
    document.documentElement.lang = "de";
    const { sendEventFunnelStep } = await freshBeacon();
    sendEventFunnelStep("visit", { slug: "kongres" });
    expect(lastPayload()).not.toHaveProperty("lang");
  });

  it("ten sam krok tego samego wydarzenia raz na sesje - takze po przeladowaniu modulu", async () => {
    const first = await freshBeacon();
    expect(first.sendEventFunnelStep("visit", { slug: "kongres" })).toBe(true);
    expect(first.sendEventFunnelStep("visit", { slug: "kongres" })).toBe(false);
    // Nowy modul (przeladowanie strony) - pamiec w sessionStorage.
    const second = await freshBeacon();
    expect(second.sendEventFunnelStep("visit", { slug: "kongres" })).toBe(false);
    // Inny krok albo inne wydarzenie to nowy beacon.
    expect(second.sendEventFunnelStep("registration_start", { slug: "kongres" })).toBe(true);
    expect(second.sendEventFunnelStep("visit", { slug: "inne" })).toBe(true);
    expect(JSON.parse(window.sessionStorage.getItem(KEY) as string)).toEqual([
      "visit:slug:kongres",
      "registration_start:slug:kongres",
      "visit:slug:inne",
    ]);
  });

  it("nieudany sendBeacon nie zapisuje kroku jako wyslanego", async () => {
    h.beacon.mockReturnValue(false);
    const { sendEventFunnelStep } = await freshBeacon();
    expect(sendEventFunnelStep("visit", { slug: "kongres" })).toBe(false);
    h.beacon.mockReturnValue(true);
    expect(sendEventFunnelStep("visit", { slug: "kongres" })).toBe(true);
  });

  it("zepsuty zapis w sessionStorage nie blokuje beaconu", async () => {
    window.sessionStorage.setItem(KEY, "{zly json");
    const a = await freshBeacon();
    expect(a.sendEventFunnelStep("visit", { slug: "kongres" })).toBe(true);
    window.sessionStorage.setItem(KEY, JSON.stringify({ nie: "tablica" }));
    const b = await freshBeacon();
    expect(b.sendEventFunnelStep("visit", { slug: "kongres" })).toBe(true);
    window.sessionStorage.setItem(KEY, JSON.stringify([5, "visit:slug:kongres"]));
    const c = await freshBeacon();
    expect(c.sendEventFunnelStep("visit", { slug: "kongres" })).toBe(false);
  });

  it("zablokowany magazyn sesji: deduplikacja w pamieci modulu", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const { sendEventFunnelStep } = await freshBeacon();
    expect(sendEventFunnelStep("visit", { slug: "kongres" })).toBe(true);
    expect(sendEventFunnelStep("visit", { slug: "kongres" })).toBe(false);
  });

  it("pamiec wyslanych krokow ma sufit 50 wpisow", async () => {
    const { sendEventFunnelStep } = await freshBeacon();
    for (let i = 0; i < 55; i += 1) sendEventFunnelStep("visit", { slug: `wydarzenie-${i}` });
    const saved = JSON.parse(window.sessionStorage.getItem(KEY) as string) as string[];
    expect(saved).toHaveLength(50);
    expect(saved[0]).toBe("visit:slug:wydarzenie-5");
  });
});
