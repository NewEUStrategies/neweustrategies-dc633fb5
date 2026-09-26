// Stan formularzy raportu dla sponsorów (`sponsorReportDraft.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. ODWRÓCONY ZAKRES IDZIE DO BAZY i wraca `invalid_range` zamiast
//      podpowiedzi przy polu.
//   2. „WSZYSCY SPONSORZY" / „WSZYSTKIE MIEJSCA" JADĄ JAKO WARTOŚĆ filtra.
//   3. LINK WAŻNY DŁUŻEJ NIŻ PRZYJMIE BAZA - koniec dnia 180. to już więcej
//      niż `now() + 180 days`, więc wejście RPC musi być przycięte.
//   4. DOMYŚLNA WAŻNOŚĆ wychodzi w przeszłość (stare wydarzenie) albo poza limit.
import { describe, expect, it } from "vitest";

import {
  ALL,
  EMPTY_SPONSOR_REPORT_FILTERS,
  SPONSOR_LINK_MAX_DAYS,
  defaultSponsorLinkDraft,
  isInvalidRange,
  sponsorLinkExpiryBounds,
  sponsorLinkInput,
  sponsorReportQuery,
  validateSponsorLinkDraft,
} from "@/lib/events/sponsorReportDraft";

const NOW = Date.parse("2099-06-15T12:00:00.000Z");
const DAY = 86_400_000;

describe("filtry raportu", () => {
  it("puste filtry = bez granic i bez filtrów", () => {
    expect(sponsorReportQuery("e", EMPTY_SPONSOR_REPORT_FILTERS)).toEqual({
      eventId: "e",
      from: null,
      to: null,
      placement: null,
      sponsorId: null,
    });
  });

  it("podane dni, sponsor i miejsce trafiają do zapytania; śmieci wypadają", () => {
    expect(
      sponsorReportQuery("e", {
        from: "2099-06-01",
        to: "2099-06-30",
        sponsorId: "s",
        placement: "materials",
      }),
    ).toEqual({
      eventId: "e",
      from: "2099-06-01",
      to: "2099-06-30",
      placement: "materials",
      sponsorId: "s",
    });
    expect(
      sponsorReportQuery("e", { from: "wczoraj", to: "", sponsorId: "", placement: "banner" }),
    ).toMatchObject({ from: null, to: null, placement: null, sponsorId: null });
  });

  it("odwrócony zakres - wykryty i pominięty w zapytaniu", () => {
    const filters = { ...EMPTY_SPONSOR_REPORT_FILTERS, from: "2099-06-30", to: "2099-06-01" };
    expect(isInvalidRange(filters)).toBe(true);
    expect(sponsorReportQuery("e", filters)).toMatchObject({ from: null, to: null });
    expect(isInvalidRange({ ...filters, to: "" })).toBe(false);
    expect(isInvalidRange({ ...filters, to: "2099-06-30" })).toBe(false);
  });
});

describe("wersja robocza linku", () => {
  it("domyślna ważność: 60 dni po końcu wydarzenia", () => {
    const draft = defaultSponsorLinkDraft("s", "2099-06-20T18:00:00Z", NOW);
    expect(draft).toEqual({
      sponsorId: "s",
      label: "",
      expiresOn: "2099-08-19",
      includeLeads: false,
    });
  });

  it("domyślna ważność: nie krócej niż tydzień (stare wydarzenie), nie dłużej niż limit", () => {
    expect(defaultSponsorLinkDraft("", "2098-01-01T00:00:00Z", NOW).expiresOn).toBe("2099-06-22");
    expect(defaultSponsorLinkDraft("", "2099-12-31T00:00:00Z", NOW).expiresOn).toBe(
      new Date(NOW + (SPONSOR_LINK_MAX_DAYS - 1) * DAY).toISOString().slice(0, 10),
    );
    // Brak końca (i śmieci w dacie) = liczymy od teraz.
    expect(defaultSponsorLinkDraft("", null, NOW).expiresOn).toBe("2099-08-14");
    expect(defaultSponsorLinkDraft("", "nie-data", NOW).expiresOn).toBe("2099-08-14");
  });

  it("granice pola daty: od jutra do 179. dnia", () => {
    expect(sponsorLinkExpiryBounds(NOW)).toEqual({ min: "2099-06-16", max: "2099-12-11" });
  });

  it("walidacja: sponsor, etykieta 2..120, dzień w granicach", () => {
    const ok = {
      sponsorId: "s",
      label: "Dział marketingu",
      expiresOn: "2099-07-01",
      includeLeads: false,
    };
    expect(validateSponsorLinkDraft(ok, NOW)).toEqual([]);
    expect(validateSponsorLinkDraft({ ...ok, sponsorId: "" }, NOW)).toEqual(["sponsorId"]);
    expect(validateSponsorLinkDraft({ ...ok, sponsorId: ALL }, NOW)).toEqual(["sponsorId"]);
    expect(validateSponsorLinkDraft({ ...ok, label: " x " }, NOW)).toEqual(["label"]);
    expect(validateSponsorLinkDraft({ ...ok, label: "x".repeat(121) }, NOW)).toEqual(["label"]);
    expect(validateSponsorLinkDraft({ ...ok, expiresOn: "2099-06-15" }, NOW)).toEqual([
      "expiresOn",
    ]);
    expect(validateSponsorLinkDraft({ ...ok, expiresOn: "2099-12-12" }, NOW)).toEqual([
      "expiresOn",
    ]);
    expect(validateSponsorLinkDraft({ ...ok, expiresOn: "" }, NOW)).toEqual(["expiresOn"]);
  });

  it("wejście RPC: koniec dnia UTC, przycięty do limitu bazy minus minuta", () => {
    expect(
      sponsorLinkInput(
        { sponsorId: "s", label: " Dział ", expiresOn: "2099-07-01", includeLeads: true },
        NOW,
      ),
    ).toEqual({
      sponsorId: "s",
      label: "Dział",
      expiresAt: "2099-07-01T23:59:59.000Z",
      includeLeads: true,
    });
    const clamped = sponsorLinkInput(
      { sponsorId: "s", label: "L", expiresOn: "2099-12-12", includeLeads: false },
      NOW,
    );
    expect(Date.parse(clamped.expiresAt ?? "")).toBe(NOW + SPONSOR_LINK_MAX_DAYS * DAY - 60_000);
  });
});
