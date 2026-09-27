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
//   6. DWIE KARTY - pamiec karty zaslania nowsze klikniecie zapisane przez inna
//      karte (zgloszenie przypiete do starego dotkniecia, gclid zgubiony),
//      a zapis na kazde zdarzenie `storage` nadpisuje sie miedzy kartami bez
//      konca.
//   7. COFNIECIE ZGODY ZOSTAWIA IDENTYFIKATOR W PAMIECI - ponowna zgoda
//      przywraca gclid zebrany przed cofnieciem; przed decyzja pamiec ma go
//      jednak trzymac.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AD_ATTRIBUTION_TTL_MS } from "@/lib/analytics/adAttribution";

const KEY = "nes.attribution.v1";
const NOW = 4_000_000_000_000;
const GCLID = "Cj0KCQjw-abc_DEF1234";
const GCLID_B = "Cj0KCQjw-karta_B-5678";
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

describe("dwie karty - wspolny magazyn, osobna pamiec", () => {
  it("karta A czyta nowsze klikniecie karty B, a jej zapis niczego nie nadpisuje", async () => {
    // `vi.resetModules()` = nowa instancja modulu = druga karta tej samej przegladarki.
    const tabA = await freshStore();
    landing(tabA, `?utm_campaign=Stara&gclid=${GCLID}`, null, NOW - 60_000);
    tabA.persistAdAttribution(MARKETING, NOW - 60_000);
    const tabB = await freshStore();
    landing(tabB, `?utm_campaign=Nowa&gclid=${GCLID_B}`, null, NOW);
    tabB.persistAdAttribution(MARKETING, NOW);

    const got = tabA.readAdAttribution(MARKETING, NOW);
    expect(got?.last.clickId).toBe(GCLID_B);
    expect(got?.last.utmCampaign).toBe("Nowa");
    expect(got?.first.utmCampaign).toBe("Stara");

    const before = window.localStorage.getItem(KEY);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    // Zdarzenie `storage` w karcie A, potem odbicie w karcie B.
    tabA.persistAdAttribution(MARKETING, NOW);
    tabB.persistAdAttribution(MARKETING, NOW);
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBe(before);
  });

  it("karty z roznymi wejsciami dochodza do jednego zapisu (koniec odbijania)", async () => {
    const tabA = await freshStore();
    landing(tabA, "?utm_campaign=Jeden", null, NOW - 1000);
    const tabB = await freshStore();
    landing(tabB, `?utm_campaign=Dwa&gclid=${GCLID_B}`, null, NOW);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    // Kazdy zapis to zdarzenie `storage` w drugiej karcie - symulujemy petle.
    for (let i = 0; i < 5; i += 1) {
      tabA.persistAdAttribution(MARKETING, NOW);
      tabB.persistAdAttribution(MARKETING, NOW);
    }
    expect(setItem.mock.calls.length).toBeLessThanOrEqual(2);
    const last = storedJson()?.last as Record<string, unknown>;
    expect(last.clickId).toBe(GCLID_B);
  });

  it("wejscie w karcie A laczy sie z zapisem karty B (pierwsze z magazynu zostaje)", async () => {
    const tabB = await freshStore();
    landing(tabB, "?utm_campaign=Pierwsza", null, NOW - 5000);
    tabB.persistAdAttribution(ANALYTICS, NOW - 5000);
    const tabA = await freshStore();
    landing(tabA, "?utm_campaign=Druga", null, NOW);
    const got = tabA.readAdAttribution(ANALYTICS, NOW);
    expect(got?.first.utmCampaign).toBe("Pierwsza");
    expect(got?.last.utmCampaign).toBe("Druga");
  });
});

describe("decyzja bez marketingu czysci tez pamiec karty", () => {
  it("przed decyzja brak zgody NIE zabiera identyfikatora z pamieci", async () => {
    const store = await freshStore();
    landing(store, `?gclid=${GCLID}`);
    store.persistAdAttribution({ ...NONE, decided: false }, NOW);
    store.persistAdAttribution(NONE, NOW);
    expect(store.readAdAttribution(MARKETING, NOW)?.last.clickId).toBe(GCLID);
  });

  it("cofniecie (decyzja bez zgody) - ponowna zgoda NIE przywraca identyfikatora", async () => {
    const store = await freshStore();
    landing(store, `?utm_campaign=Wiosna&gclid=${GCLID}`);
    store.persistAdAttribution(MARKETING, NOW);
    store.persistAdAttribution({ ...NONE, decided: true }, NOW);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    store.persistAdAttribution(MARKETING, NOW);
    const last = storedJson()?.last as Record<string, unknown>;
    expect(last.clickId).toBeNull();
    expect(last.utmCampaign).toBe("Wiosna");
  });

  it("sama analityka to decyzja - pamiec traci identyfikator, kanal zostaje", async () => {
    const store = await freshStore();
    landing(store, `?gclid=${GCLID}`);
    store.persistAdAttribution(ANALYTICS, NOW);
    const got = store.readAdAttribution(MARKETING, NOW);
    expect(got?.last.clickId).toBeNull();
    expect(got?.last.clickType).toBe("gclid");
  });
});

describe("pruneAdAttributionForConsent - sprzatanie po decyzji w dowolnym miejscu serwisu", () => {
  it("bez obu kategorii klucz znika, a pamiec traci identyfikator", async () => {
    const store = await freshStore();
    landing(store, `?utm_campaign=Wiosna&gclid=${GCLID}`);
    store.persistAdAttribution(MARKETING, NOW);
    store.pruneAdAttributionForConsent(NONE);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(store.readAdAttribution(MARKETING, NOW)?.last.clickId).toBeNull();
  });

  it("sama analityka - magazyn bez identyfikatora (rodzaj klikniecia zostaje)", async () => {
    const store = await freshStore();
    landing(store, `?utm_campaign=Wiosna&gclid=${GCLID}`);
    store.persistAdAttribution(MARKETING, NOW);
    store.pruneAdAttributionForConsent(ANALYTICS);
    const last = storedJson()?.last as Record<string, unknown>;
    expect(last.clickId).toBeNull();
    expect(last.clickType).toBe("gclid");
    expect(last.utmCampaign).toBe("Wiosna");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    store.pruneAdAttributionForConsent(ANALYTICS);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("zgoda marketingowa niczego nie rusza; zepsuty zapis przy samej analityce znika", async () => {
    const store = await freshStore();
    landing(store, `?gclid=${GCLID}`);
    store.persistAdAttribution(MARKETING, NOW);
    store.pruneAdAttributionForConsent(MARKETING);
    expect((storedJson()?.last as Record<string, unknown>).clickId).toBe(GCLID);
    window.localStorage.setItem(KEY, "{zepsuty");
    store.pruneAdAttributionForConsent(ANALYTICS);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
