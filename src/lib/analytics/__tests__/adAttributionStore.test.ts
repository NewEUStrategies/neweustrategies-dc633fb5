// Magazyn atrybucji (`src/lib/analytics/adAttributionStore.ts`) - macierz zgod.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. ZAPIS PRZED ZGODA - `localStorage` z `gclid` zanim uzytkownik zdecydowal
//      (art. 5 ust. 3 ePrivacy). Przechwycenie ma trafiac WYLACZNIE do pamieci.
//   2. SAMA ANALITYKA Z IDENTYFIKATOREM KLIKNIECIA - kopia bez zgody
//      marketingowej ma byc bez `clickId`, a odczyt do wysylki tez.
//   3. COFNIECIE ZGODY / GPC NIE KASUJE KLUCZA - identyfikator zostaje na
//      urzadzeniu po wycofaniu zgody.
//   4. NAWIGACJA SPA NADPISUJE KAMPANIE ODSYLACZEM - `document.referrer` liczy
//      sie tylko przy pierwszym przechwyceniu dokumentu.
//   5. ZABLOKOWANY MAGAZYN WYWRACA STRONE - kazdy dostep ma byc bezpieczny.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AD_ATTRIBUTION_TTL_MS } from "@/lib/analytics/adAttribution";

const KEY = "nes.attribution.v1";
const NOW = 4_000_000_000_000;
const GCLID = "Cj0KCQjw-abc_DEF1234";
const NONE = { analytics: false, marketing: false };
const ANALYTICS = { analytics: true, marketing: false };
const MARKETING = { analytics: true, marketing: true };
const MARKETING_ONLY = { analytics: false, marketing: true };

type Store = typeof import("@/lib/analytics/adAttributionStore");

async function freshStore(): Promise<Store> {
  vi.resetModules();
  return import("@/lib/analytics/adAttributionStore");
}

function landing(store: Store, search: string, referrer: string | null = null, nowMs = NOW) {
  store.captureAdLanding({
    search,
    pathname: "/events/kongres",
    referrer,
    host: "nes.example",
    nowMs,
  });
}

function storedJson(): Record<string, unknown> | null {
  const raw = window.localStorage.getItem(KEY);
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("przechwycenie - tylko pamiec", () => {
  it("przed decyzja o zgodzie nic nie trafia do magazynu, a odczyt bez zgody jest pusty", async () => {
    const store = await freshStore();
    landing(store, `?utm_campaign=Wiosna&gclid=${GCLID}`);

    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(store.readAdAttribution(NONE, NOW)).toBeNull();
    // Pamiec karty ma dotkniecie - zgoda udzielona pozniej na tej samej stronie
    // dalej moze je zapisac.
    expect(store.readAdAttribution(MARKETING, NOW)?.last.clickId).toBe(GCLID);
  });

  it("wejscie bez sygnalu niczego nie zmienia", async () => {
    const store = await freshStore();
    landing(store, "?page=2");
    expect(store.readAdAttribution(MARKETING, NOW)).toBeNull();
  });

  it("odsylacz liczy sie tylko przy PIERWSZYM przechwyceniu dokumentu", async () => {
    const store = await freshStore();
    landing(store, "?utm_campaign=Wiosna&utm_source=google&utm_medium=cpc");
    // Nawigacja SPA po zakladkach - ten sam `document.referrer`.
    landing(store, "", "https://www.google.pl/");
    expect(store.readAdAttribution(ANALYTICS, NOW)?.last.utmCampaign).toBe("Wiosna");
  });

  it("pierwsze przechwycenie z samym odsylaczem tworzy dotkniecie organiczne", async () => {
    const store = await freshStore();
    landing(store, "", "https://www.bing.com/");
    expect(store.readAdAttribution(ANALYTICS, NOW)?.last.referrerHost).toBe("bing.com");
  });

  it("nowe dotkniecie laczy sie z zapisanym (pierwsze zostaje)", async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        first: { ts: NOW - 1000, utmCampaign: "pierwsza" },
        last: { ts: NOW - 1000, utmCampaign: "pierwsza" },
      }),
    );
    const store = await freshStore();
    landing(store, "?utm_campaign=druga");
    const got = store.readAdAttribution(ANALYTICS, NOW);
    expect(got?.first.utmCampaign).toBe("pierwsza");
    expect(got?.last.utmCampaign).toBe("druga");
  });
});

describe("zapis wedlug zgody", () => {
  it("marketing - pelna atrybucja z identyfikatorem klikniecia", async () => {
    const store = await freshStore();
    landing(store, `?utm_campaign=Wiosna&gclid=${GCLID}`);
    store.persistAdAttribution(MARKETING, NOW);
    expect((storedJson()?.last as Record<string, unknown>).clickId).toBe(GCLID);
  });

  it("sam marketing (bez analityki) tez zapisuje pelna atrybucje", async () => {
    const store = await freshStore();
    landing(store, `?gclid=${GCLID}`);
    store.persistAdAttribution(MARKETING_ONLY, NOW);
    expect((storedJson()?.last as Record<string, unknown>).clickId).toBe(GCLID);
    expect(store.readAdAttribution(MARKETING_ONLY, NOW)?.last.clickId).toBe(GCLID);
  });

  it("sama analityka - kopia BEZ identyfikatora klikniecia (kanal zostaje)", async () => {
    const store = await freshStore();
    landing(store, `?utm_campaign=Wiosna&gclid=${GCLID}`);
    store.persistAdAttribution(ANALYTICS, NOW);
    const last = storedJson()?.last as Record<string, unknown>;
    expect(last.clickId).toBeNull();
    expect(last.clickType).toBe("gclid");
    expect(store.readAdAttribution(ANALYTICS, NOW)?.last.clickId).toBeNull();
  });

  it("cofniecie zgody (albo GPC) kasuje klucz", async () => {
    const store = await freshStore();
    landing(store, `?gclid=${GCLID}`);
    store.persistAdAttribution(MARKETING, NOW);
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
    store.persistAdAttribution(NONE, NOW);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("wygasla atrybucja kasuje klucz zamiast go odswiezac", async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        first: { ts: NOW, utmSource: "x" },
        last: { ts: NOW, utmSource: "x" },
      }),
    );
    const store = await freshStore();
    store.persistAdAttribution(MARKETING, NOW + AD_ATTRIBUTION_TTL_MS + 1);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(store.readAdAttribution(MARKETING, NOW + AD_ATTRIBUTION_TTL_MS + 1)).toBeNull();
  });

  it("zablokowany magazyn nie wywraca ani zapisu, ani odczytu", async () => {
    const store = await freshStore();
    landing(store, `?gclid=${GCLID}`);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => store.persistAdAttribution(MARKETING, NOW)).not.toThrow();
    expect(store.readAdAttribution(MARKETING, NOW)?.last.clickId).toBe(GCLID);
  });
});
