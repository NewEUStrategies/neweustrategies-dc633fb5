// Adres raportu dla sponsora i etykiety wartości z bazy
// (`sponsorReportLink.ts`, `sponsorReportLabels.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. TOKEN W ZAPYTANIU ZAMIAST WE FRAGMENCIE - trafiłby do logów serwera
//      i nagłówka `Referer`.
//   2. TOKEN O ZŁYM KSZTAŁCIE IDZIE DO SERWERA - każdy śmieć z paska adresu
//      zjadałby limit prób sponsora.
//   3. NOWA WARTOŚĆ CHECK-a BEZ ETYKIETY - surowa ścieżka klucza na ekranie.
//      Mapy muszą mieć wpis dla każdego miejsca, a klucz musi istnieć
//      w nakładce (`i18n.exists`).
//   4. ROLA SPOZA LISTY (`toString`, `__proto__`) wpadałaby w prototyp obiektu.
import { describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-event-sponsor-report";
import "@/lib/i18n-event-sponsor-report";
import { SPONSOR_PLACEMENTS } from "@/lib/events/sponsorExposure";
import {
  ADMIN_PLACEMENT_LABEL_KEYS,
  ADMIN_SPONSOR_ROLE_LABEL_KEYS,
  PUBLIC_PLACEMENT_LABEL_KEYS,
  adminSponsorRoleLabelKey,
} from "@/lib/events/sponsorReportLabels";
import {
  isSponsorReportToken,
  readSponsorReportFragment,
  sponsorReportLinkUrl,
  sponsorReportPath,
} from "@/lib/events/sponsorReportLink";

const TOKEN = "Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab";

describe("token", () => {
  it("dokładnie 32 znaki base64url", () => {
    expect(TOKEN).toHaveLength(32);
    expect(isSponsorReportToken(TOKEN)).toBe(true);
    expect(isSponsorReportToken(TOKEN.slice(1))).toBe(false);
    expect(isSponsorReportToken(`${TOKEN}x`)).toBe(false);
    expect(isSponsorReportToken(`${TOKEN.slice(1)}=`)).toBe(false);
    expect(isSponsorReportToken(`${TOKEN.slice(1)}+`)).toBe(false);
    expect(isSponsorReportToken(null)).toBe(false);
    expect(isSponsorReportToken(32)).toBe(false);
  });
});

describe("adres", () => {
  it("ścieżka koduje slug, link niesie token we FRAGMENCIE", () => {
    expect(sponsorReportPath("kongres-2099")).toBe("/events/kongres-2099/sponsor-report");
    expect(sponsorReportPath("a b")).toBe("/events/a%20b/sponsor-report");
    const url = sponsorReportLinkUrl("https://nes.example/", "kongres", TOKEN);
    expect(url).toBe(`https://nes.example/events/kongres/sponsor-report#t=${TOKEN}`);
    expect(new URL(url).search).toBe("");
    expect(sponsorReportLinkUrl("https://nes.example///", "k", TOKEN)).toBe(
      `https://nes.example/events/k/sponsor-report#t=${TOKEN}`,
    );
  });

  it("fragment: token z `#t=`, także bez krzyżyka i obok innych parametrów", () => {
    expect(readSponsorReportFragment(`#t=${TOKEN}`)).toBe(TOKEN);
    expect(readSponsorReportFragment(`t=${TOKEN}`)).toBe(TOKEN);
    expect(readSponsorReportFragment(`#x=1&t=${TOKEN}`)).toBe(TOKEN);
  });

  it("fragment bez tokenu albo ze złym tokenem to null", () => {
    expect(readSponsorReportFragment("")).toBeNull();
    expect(readSponsorReportFragment("#")).toBeNull();
    expect(readSponsorReportFragment("#t=krotki")).toBeNull();
    expect(readSponsorReportFragment(`#token=${TOKEN}`)).toBeNull();
  });
});

describe("etykiety", () => {
  it("każde miejsce ma klucz w obu mapach i klucz istnieje w obu językach", () => {
    for (const placement of SPONSOR_PLACEMENTS) {
      for (const key of [
        ADMIN_PLACEMENT_LABEL_KEYS[placement],
        PUBLIC_PLACEMENT_LABEL_KEYS[placement],
      ]) {
        expect(i18n.exists(key, { lng: "pl" }), `${key} (pl)`).toBe(true);
        expect(i18n.exists(key, { lng: "en" }), `${key} (en)`).toBe(true);
      }
    }
    expect(Object.keys(ADMIN_PLACEMENT_LABEL_KEYS).sort()).toEqual([...SPONSOR_PLACEMENTS].sort());
    expect(Object.keys(PUBLIC_PLACEMENT_LABEL_KEYS).sort()).toEqual([...SPONSOR_PLACEMENTS].sort());
  });

  it("każda rola z CHECK-a bazy ma klucz, który istnieje w nakładce", () => {
    expect(Object.keys(ADMIN_SPONSOR_ROLE_LABEL_KEYS).sort()).toEqual([
      "exhibitor",
      "media_partner",
      "partner",
      "sponsor",
    ]);
    for (const role of Object.keys(ADMIN_SPONSOR_ROLE_LABEL_KEYS)) {
      const key = adminSponsorRoleLabelKey(role);
      expect(i18n.exists(key, { lng: "pl" })).toBe(true);
      expect(i18n.exists(key, { lng: "en" })).toBe(true);
    }
    expect(adminSponsorRoleLabelKey("media_partner")).toBe(
      "adminEventSponsorReport.roles.mediaPartner",
    );
  });

  it("rola spoza listy - także nazwa z prototypu - czyta się jak sponsor", () => {
    for (const role of ["", "vip", "toString", "__proto__", "constructor"]) {
      expect(adminSponsorRoleLabelKey(role)).toBe("adminEventSponsorReport.roles.sponsor");
    }
  });
});
