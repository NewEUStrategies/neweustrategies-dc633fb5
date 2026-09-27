// Atrybucja kampanii - czysta logika (`src/lib/analytics/adAttribution.ts`).
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. ADRES E-MAIL W UTM TRAFIA DO BAZY - newslettery wkladaja adresy do
//      `utm_content`, a raport widzi admin (i CRM - redaktor).
//   2. POWROT ZE STRIPE NADPISUJE KAMPANIE jako "referral" dokladnie w chwili
//      zakupu - lejek przypisuje bilet bramce platnosci.
//   3. WEJSCIE BEZPOSREDNIE KASUJE KAMPANIE (model "ostatnie NIE-bezposrednie"
//      przestaje dzialac) albo dotkniecie sprzed 90 dni wciaz przypisuje bilet.
//   4. EDYTOWALNY MAGAZYN WSTRZYKUJE SMIECI - `localStorage` zmieniony recznie
//      musi przejsc te same reguly co adres.
import { describe, expect, it } from "vitest";

import {
  AD_ATTRIBUTION_TTL_MS,
  cleanUtm,
  combineAttribution,
  freshAttribution,
  mergeAttribution,
  normalizeHost,
  parseAdTouch,
  parseStoredAttribution,
  sanitizeTouch,
  touchWire,
  withoutClickIds,
  type AdTouch,
  type StoredAttribution,
} from "@/lib/analytics/adAttribution";

const NOW = 4_000_000_000_000;
const GCLID = "Cj0KCQjw-abc_DEF1234";

function touch(overrides: Partial<AdTouch> = {}): AdTouch {
  return {
    ts: NOW,
    landingPath: "/events/kongres",
    referrerHost: null,
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "Wiosna",
    utmTerm: null,
    utmContent: null,
    gadSource: null,
    gadCampaignId: null,
    clickType: "gclid",
    clickId: GCLID,
    ...overrides,
  };
}

function landing(search: string, referrer: string | null = null, pathname = "/events/kongres") {
  return parseAdTouch({ search, pathname, referrer, host: "www.nes.example", nowMs: NOW });
}

describe("cleanUtm - lustro _event_ads_clean z bazy", () => {
  it("brak wartosci i same biale znaki to brak", () => {
    expect(cleanUtm(null)).toBeNull();
    expect(cleanUtm(undefined)).toBeNull();
    expect(cleanUtm("   ")).toBeNull();
  });

  it("wycina znaki sterujace, zwija biale znaki i przycina do 100", () => {
    expect(cleanUtm("  wio\u0007sna \t  2026 ")).toBe("wiosna 2026");
    expect(cleanUtm(`${"a".repeat(99)} bbb`)).toBe("a".repeat(99));
    expect(cleanUtm("x".repeat(150))).toHaveLength(100);
  });

  it("adres e-mail odrzuca CALA wartosc (nie tylko adres)", () => {
    expect(cleanUtm("newsletter jan.kowalski@firma.pl wrzesien")).toBeNull();
    expect(cleanUtm("jan@firma")).toBe("jan@firma");
  });
});

describe("normalizeHost", () => {
  it("male litery, bez www, tylko poprawna nazwa hosta", () => {
    expect(normalizeHost("WWW.Google.PL")).toBe("google.pl");
    expect(normalizeHost("localhost")).toBeNull();
    expect(normalizeHost("zly host")).toBeNull();
    expect(normalizeHost(`${"a".repeat(250)}.com`)).toBeNull();
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost(undefined)).toBeNull();
  });
});

describe("parseAdTouch - adres wejscia", () => {
  it("klikniecie Google Ads z UTM i autotagowaniem", () => {
    const got = landing(
      `?UTM_Source=Google&utm_medium=CPC&utm_campaign=Wiosna&utm_term=energia&utm_content=baner` +
        `&gclid=${GCLID}&gad_source=1&gad_campaignid=987654321`,
    );
    expect(got).toEqual({
      ts: NOW,
      landingPath: "/events/kongres",
      referrerHost: null,
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "Wiosna",
      utmTerm: "energia",
      utmContent: "baner",
      gadSource: "1",
      gadCampaignId: "987654321",
      clickType: "gclid",
      clickId: GCLID,
    });
  });

  it("pierwsze wystapienie parametru wygrywa (drugie nie nadpisuje)", () => {
    expect(landing("?utm_campaign=pierwsza&utm_campaign=druga")?.utmCampaign).toBe("pierwsza");
  });

  it("pierwszenstwo klikniec gclid > gbraid > wbraid, zly identyfikator pomijany", () => {
    expect(landing(`?wbraid=${GCLID}&gbraid=${GCLID}`)?.clickType).toBe("gbraid");
    expect(landing(`?wbraid=${GCLID}`)?.clickType).toBe("wbraid");
    const shortClick = landing("?gclid=krotki&utm_source=x");
    expect(shortClick?.clickType).toBeNull();
    expect(shortClick?.clickId).toBeNull();
  });

  it("gad_* tylko jako liczby", () => {
    const got = landing("?gad_source=abc&gad_campaignid=12a&utm_source=x");
    expect(got?.gadSource).toBeNull();
    expect(got?.gadCampaignId).toBeNull();
  });

  it("odsylacz zewnetrzny jest dotknieciem, wlasny host i bramki platnosci - nie", () => {
    expect(landing("", "https://www.google.pl/search?q=x")?.referrerHost).toBe("google.pl");
    expect(landing("", "https://nes.example/blog")).toBeNull();
    expect(landing("", "https://checkout.stripe.com/c/pay/cs_1")).toBeNull();
    expect(landing("", "https://stripe.com/")).toBeNull();
    expect(landing("", "android-app://com.google.android.gm/")).toBeNull();
    expect(landing("", "nie adres")).toBeNull();
    expect(landing("", "https://10.0.0.1:8080/")?.referrerHost).toBe("10.0.0.1");
    expect(landing("", "https://intranet/")).toBeNull();
    expect(landing("", "")).toBeNull();
  });

  it("sciezka spoza wzorca albo za dluga nie trafia do dotkniecia", () => {
    expect(landing("?utm_source=x", null, "/a b")?.landingPath).toBeNull();
    expect(landing("?utm_source=x", null, `/${"a".repeat(600)}`)?.landingPath).toBeNull();
  });

  it("wejscie bez zadnego sygnalu to NULL (niczego nie nadpisuje)", () => {
    expect(landing("")).toBeNull();
    expect(landing("?page=2&utm_content=ktos@firma.pl")).toBeNull();
  });
});

describe("mergeAttribution / freshAttribution - pierwsze + ostatnie nie-bezposrednie", () => {
  const first = touch({ ts: NOW - 10 * 24 * 3600 * 1000, utmCampaign: "pierwsza" });

  it("pierwsze dotkniecie zostaje, ostatnie jest nowe", () => {
    const prev: StoredAttribution = { v: 1, first, last: first };
    const next = touch({ utmCampaign: "druga" });
    expect(mergeAttribution(prev, next, NOW)).toEqual({ v: 1, first, last: next });
  });

  it("bez poprzedniej atrybucji pierwsze = ostatnie", () => {
    const next = touch();
    expect(mergeAttribution(null, next, NOW)).toEqual({ v: 1, first: next, last: next });
  });

  it("wygasla atrybucja (ostatnie poza 90 dniami) nie przechodzi do wyniku", () => {
    const old = touch({ ts: NOW - AD_ATTRIBUTION_TTL_MS - 1 });
    const next = touch({ utmCampaign: "nowa" });
    expect(mergeAttribution({ v: 1, first: old, last: old }, next, NOW)).toEqual({
      v: 1,
      first: next,
      last: next,
    });
    expect(freshAttribution({ v: 1, first: old, last: old }, NOW)).toBeNull();
    expect(freshAttribution(null, NOW)).toBeNull();
  });

  it("pierwsze wygasle, ostatnie swieze - pierwszym staje sie ostatnie", () => {
    const old = touch({ ts: NOW - AD_ATTRIBUTION_TTL_MS - 5 });
    const recent = touch({ ts: NOW - 1000 });
    expect(freshAttribution({ v: 1, first: old, last: recent }, NOW)).toEqual({
      v: 1,
      first: recent,
      last: recent,
    });
    const fresh: StoredAttribution = { v: 1, first: recent, last: recent };
    expect(freshAttribution(fresh, NOW)).toBe(fresh);
  });
});

describe("combineAttribution - pamiec karty + magazyn wspolny dla kart", () => {
  const early = touch({ ts: NOW - 5000, utmCampaign: "Pierwsza" });
  const mid = touch({ ts: NOW - 1000, utmCampaign: "Srodek" });
  const late = touch({ ts: NOW, utmCampaign: "Ostatnia", clickType: "gclid", clickId: GCLID });

  it("wczesniejsze pierwsze i pozniejsze ostatnie - niezaleznie od kolejnosci argumentow", () => {
    const a: StoredAttribution = { v: 1, first: mid, last: mid };
    const b: StoredAttribution = { v: 1, first: early, last: late };
    expect(combineAttribution(a, b)).toBe(b);
    expect(combineAttribution(b, a)).toBe(b);
    const c: StoredAttribution = { v: 1, first: early, last: early };
    expect(combineAttribution(c, a)).toEqual({ v: 1, first: early, last: mid });
    expect(combineAttribution(a, c)).toEqual({ v: 1, first: early, last: mid });
  });

  it("remis wygrywa pierwszy argument; brak jednej strony oddaje druga", () => {
    const a: StoredAttribution = { v: 1, first: mid, last: mid };
    const same: StoredAttribution = { v: 1, first: { ...mid }, last: { ...mid, clickId: GCLID } };
    expect(combineAttribution(a, same)).toBe(a);
    expect(combineAttribution(null, a)).toBe(a);
    expect(combineAttribution(a, null)).toBe(a);
    expect(combineAttribution(null, null)).toBeNull();
  });
});

describe("withoutClickIds / touchWire", () => {
  it("kopia analityczna traci identyfikator, zachowuje rodzaj klikniecia (kanal)", () => {
    const got = withoutClickIds({ v: 1, first: touch(), last: touch({ clickType: "wbraid" }) });
    expect(got.first.clickId).toBeNull();
    expect(got.first.clickType).toBe("gclid");
    expect(got.last.clickId).toBeNull();
    expect(got.last.clickType).toBe("wbraid");
  });

  it("ksztalt do bazy ma klucze `_event_ads_touch`", () => {
    expect(touchWire(touch({ referrerHost: "google.pl", gadSource: "1" }))).toEqual({
      ts: NOW,
      landing_path: "/events/kongres",
      referrer_host: "google.pl",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "Wiosna",
      utm_term: null,
      utm_content: null,
      gad_source: "1",
      gad_campaign_id: null,
      click_id_type: "gclid",
      click_id: GCLID,
    });
  });
});

describe("sanitizeTouch / parseStoredAttribution - magazyn jest edytowalny", () => {
  it("poprawne dotkniecie przechodzi bez zmian", () => {
    expect(sanitizeTouch(touch())).toEqual(touch());
  });

  it("odrzuca nie-obiekty i zly czas", () => {
    expect(sanitizeTouch(null)).toBeNull();
    expect(sanitizeTouch([touch()])).toBeNull();
    expect(sanitizeTouch("x")).toBeNull();
    expect(sanitizeTouch({ ...touch(), ts: "1" })).toBeNull();
    expect(sanitizeTouch({ ...touch(), ts: Number.NaN })).toBeNull();
    expect(sanitizeTouch({ ...touch(), ts: 0 })).toBeNull();
  });

  it("zle pola wypadaja, a bez sygnalu caly wpis wypada", () => {
    const got = sanitizeTouch({
      ...touch(),
      utmSource: "GOOGLE",
      utmContent: "ja@firma.pl",
      clickType: "fbclid",
      landingPath: "/x?y=1",
    });
    expect(got?.utmSource).toBe("google");
    expect(got?.utmContent).toBeNull();
    expect(got?.clickType).toBeNull();
    expect(got?.clickId).toBeNull();
    expect(got?.landingPath).toBeNull();
    expect(sanitizeTouch({ ...touch(), clickId: "krotki" })?.clickId).toBeNull();
    expect(sanitizeTouch({ ts: NOW, landingPath: null, utmSource: 5 })).toBeNull();
  });

  it("parsuje zapis wersji 1, reszte odrzuca", () => {
    const stored: StoredAttribution = { v: 1, first: touch({ utmCampaign: "a" }), last: touch() };
    expect(parseStoredAttribution(JSON.stringify(stored))).toEqual(stored);
    expect(parseStoredAttribution(null)).toBeNull();
    expect(parseStoredAttribution("{zly json")).toBeNull();
    expect(parseStoredAttribution("5")).toBeNull();
    expect(parseStoredAttribution("null")).toBeNull();
    expect(parseStoredAttribution(JSON.stringify({ ...stored, v: 2 }))).toBeNull();
    expect(parseStoredAttribution(JSON.stringify({ v: 1, first: stored.first }))).toBeNull();
  });

  it("zepsute pierwsze dotkniecie zastepuje ostatnie", () => {
    const last = touch();
    expect(parseStoredAttribution(JSON.stringify({ v: 1, first: { ts: -1 }, last }))).toEqual({
      v: 1,
      first: last,
      last,
    });
  });
});
