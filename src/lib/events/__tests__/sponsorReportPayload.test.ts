// Parser odpowiedzi `event_sponsor_report_for_token` (`sponsorReportPayload.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. NIEZNANY POWÓD ODMOWY WYWRACA STRONĘ - każdy powód spoza listy musi
//      być zwykłym „błędem", a zepsuty JSON też.
//   2. BRAK LISTY KONTAKTÓW MYLI SIĘ Z PUSTĄ LISTĄ - `null` to „organizator
//      nie udostępnił", `[]` to „lista jest, ale pusta".
//   3. ODPOWIEDŹ ZE STARSZEJ WERSJI FUNKCJI (brakujące pola, złe typy) ma dać
//      zera i `null`, a nie `NaN` i wyjątek.
import { describe, expect, it } from "vitest";

import {
  SPONSOR_REPORT_FAILURES,
  parseSponsorReportJson,
  parseSponsorReportPayload,
} from "@/lib/events/sponsorReportPayload";

const FULL = {
  ok: true,
  generated_at: "2099-06-15T12:00:00Z",
  event: {
    slug: "kongres",
    title_pl: "Kongres",
    title_en: "Congress",
    timezone: "Europe/Warsaw",
    starts_at: "2099-06-20T08:00:00Z",
    ends_at: "2099-06-21T16:00:00Z",
  },
  sponsor: {
    name: "Acme",
    logo_url: "https://cdn.example.org/acme.png",
    role: "sponsor",
    tier_name_pl: "Złoty",
    tier_name_en: "Gold",
  },
  link: { label: "Dla Acme", expires_at: "2099-08-19T23:59:00Z", include_leads: true },
  totals: {
    views_unique: 7,
    views_total: 9,
    clicks_unique: 3,
    clicks_total: 4,
    material_opens: 1,
    leads_total: 4,
    leads_consented: 2,
    meetings_total: 3,
    meetings_held: 1,
  },
  placements: [
    {
      placement: "home_strip",
      views_unique: 5,
      views_total: 6,
      clicks_unique: 2,
      clicks_total: 3,
      material_opens: 0,
    },
    { placement: "billboard", views_unique: 100 },
    "zly-wiersz",
  ],
  series: [
    { day: "2099-06-15", views_unique: 5, clicks_unique: 2, material_opens: 1, leads_new: 2 },
    { day: "2099-06-16T00:00:00", views_unique: "x" },
    { views_unique: 3 },
  ],
  leads: [
    {
      sponsor_name: "Acme",
      first_name: "Anna",
      last_name: "Nowak",
      company: "NES",
      job_title: "Analityk",
      email: "anna@example.org",
      phone: "+48 500",
      consent: true,
      consent_snapshot_at: "2099-06-15T09:00:00Z",
      interest_rating: 4,
      note: "Oferta",
      scan_count: 2,
      first_scanned_at: "2099-06-15T09:00:00Z",
      last_scanned_at: "2099-06-15T10:00:00Z",
      device_label: "Stoisko A",
    },
    { consent: false, first_name: "   ", interest_rating: null, scan_count: 1 },
    null,
  ],
};

describe("parseSponsorReportPayload - odmowy", () => {
  it("znany powód odmowy przechodzi bez zmian", () => {
    for (const reason of SPONSOR_REPORT_FAILURES) {
      expect(parseSponsorReportPayload({ ok: false, reason })).toEqual({ ok: false, reason });
    }
  });

  it("nieznany powód, brak `ok` albo nie-obiekt to zwykły błąd", () => {
    expect(parseSponsorReportPayload({ ok: false, reason: "hacked" })).toEqual({
      ok: false,
      reason: "error",
    });
    expect(parseSponsorReportPayload({ reason: "expired" })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(parseSponsorReportPayload(null)).toEqual({ ok: false, reason: "error" });
    expect(parseSponsorReportPayload([1, 2])).toEqual({ ok: false, reason: "error" });
    expect(parseSponsorReportPayload("ok")).toEqual({ ok: false, reason: "error" });
  });
});

describe("parseSponsorReportPayload - raport", () => {
  it("pełna odpowiedź daje pełny model; złe miejsca i dni odpadają", () => {
    const out = parseSponsorReportPayload(FULL);
    if (!out.ok) throw new Error("oczekiwano raportu");
    expect(out.generatedAt).toBe("2099-06-15T12:00:00Z");
    expect(out.event).toEqual({
      slug: "kongres",
      titlePl: "Kongres",
      titleEn: "Congress",
      timezone: "Europe/Warsaw",
      startsAt: "2099-06-20T08:00:00Z",
      endsAt: "2099-06-21T16:00:00Z",
    });
    expect(out.sponsor).toEqual({
      name: "Acme",
      logoUrl: "https://cdn.example.org/acme.png",
      role: "sponsor",
      tierNamePl: "Złoty",
      tierNameEn: "Gold",
    });
    expect(out.link).toEqual({
      label: "Dla Acme",
      expiresAt: "2099-08-19T23:59:00Z",
      includeLeads: true,
    });
    expect(out.totals).toEqual({
      viewsUnique: 7,
      viewsTotal: 9,
      clicksUnique: 3,
      clicksTotal: 4,
      materialOpens: 1,
      leadsTotal: 4,
      leadsConsented: 2,
      meetingsTotal: 3,
      meetingsHeld: 1,
    });
    expect(out.placements).toEqual([
      {
        placement: "home_strip",
        viewsUnique: 5,
        viewsTotal: 6,
        clicksUnique: 2,
        clicksTotal: 3,
        materialOpens: 0,
      },
    ]);
    expect(out.series).toEqual([
      { day: "2099-06-15", viewsUnique: 5, clicksUnique: 2, materialOpens: 1, leadsNew: 2 },
      { day: "2099-06-16", viewsUnique: 0, clicksUnique: 0, materialOpens: 0, leadsNew: 0 },
    ]);
    expect(out.leads).toHaveLength(3);
    expect(out.leads?.[0]).toMatchObject({
      email: "anna@example.org",
      consent: true,
      scan_count: 2,
    });
    // Wiersz bez zgody: puste napisy i braki to null, zgoda zostaje jawnym `false`.
    expect(out.leads?.[1]).toEqual({
      sponsor_name: null,
      first_name: null,
      last_name: null,
      company: null,
      job_title: null,
      email: null,
      phone: null,
      consent: false,
      consent_snapshot_at: null,
      interest_rating: null,
      note: null,
      scan_count: 1,
      first_scanned_at: null,
      last_scanned_at: null,
      device_label: null,
    });
    expect(out.leads?.[2]).toMatchObject({ consent: null, scan_count: null });
  });

  it("odpowiedź szczątkowa: zera, null, puste listy, a brak listy kontaktów to null", () => {
    const out = parseSponsorReportPayload({ ok: true, placements: {}, series: "x" });
    if (!out.ok) throw new Error("oczekiwano raportu");
    expect(out.generatedAt).toBeNull();
    expect(out.event.slug).toBe("");
    expect(out.event.titlePl).toBeNull();
    expect(out.sponsor.name).toBe("");
    expect(out.link).toEqual({ label: null, expiresAt: null, includeLeads: false });
    expect(out.totals.viewsUnique).toBe(0);
    expect(out.placements).toEqual([]);
    expect(out.series).toEqual([]);
    expect(out.leads).toBeNull();
  });

  it("pusta lista kontaktów zostaje pustą listą", () => {
    const out = parseSponsorReportPayload({ ...FULL, leads: [] });
    expect(out.ok && out.leads).toEqual([]);
  });
});

describe("parseSponsorReportJson", () => {
  it("poprawny JSON idzie przez parser, zepsuty to błąd", () => {
    expect(parseSponsorReportJson(JSON.stringify({ ok: false, reason: "expired" }))).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(parseSponsorReportJson("{nie-json")).toEqual({ ok: false, reason: "error" });
    expect(parseSponsorReportJson("null")).toEqual({ ok: false, reason: "error" });
  });
});
