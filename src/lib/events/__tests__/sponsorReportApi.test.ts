// Warstwa RPC raportu dla sponsorów (`sponsorReportApi.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. FILTR „BEZ GRANICY" IDZIE DO BAZY JAKO NULL, a nie jako brak argumentu -
//      RPC z domyślnymi `NULL` dostaje wtedy jawny null i... działa, ale kształt
//      wywołania rozjeżdża się z typami i z testami kontraktu.
//   2. ODMOWA BAZY GINIE - błąd RPC musi dojść do mapy odmów jako `Error` z tą
//      samą głową komunikatu.
//   3. TOKEN LINKU ZNIKA W PARSOWANIU - wydanie oddaje token RAZ; brakujące pole
//      ma dać pusty napis, a nie wyjątek.
//   4. LICZNIKI PRZENIESIENIA DO CRM - nieznany kształt odpowiedzi daje zera,
//      a nie NaN w komunikacie.
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

const api = await import("@/lib/events/sponsorReportApi");

const EVENT = "e0000000-0000-4000-8000-000000000001";
const QUERY = { eventId: EVENT, from: null, to: null, placement: null, sponsorId: null } as const;

beforeEach(() => {
  rpc.mockReset();
});

describe("odczyty raportu", () => {
  it("podsumowanie: filtry null wypadają z wywołania, podane jadą pod nazwami RPC", async () => {
    rpc.mockResolvedValueOnce({ data: [{ sponsor_id: "s" }], error: null });
    await expect(api.fetchSponsorReportSummary(QUERY)).resolves.toEqual([{ sponsor_id: "s" }]);
    expect(rpc).toHaveBeenLastCalledWith("admin_event_sponsor_report_summary", {
      p_event_id: EVENT,
    });

    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      api.fetchSponsorReportSummary({
        ...QUERY,
        from: "2099-06-01",
        to: "2099-06-30",
        placement: "home_strip",
        sponsorId: "s",
      }),
    ).resolves.toEqual([]);
    expect(rpc).toHaveBeenLastCalledWith("admin_event_sponsor_report_summary", {
      p_event_id: EVENT,
      p_from: "2099-06-01",
      p_to: "2099-06-30",
      p_placement: "home_strip",
    });
  });

  it("szereg i szereg kontaktów niosą sponsora; pusta odpowiedź to []", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await api.fetchSponsorReportSeries({ ...QUERY, sponsorId: "s", placement: "materials" });
    expect(rpc).toHaveBeenLastCalledWith("admin_event_sponsor_report_series", {
      p_event_id: EVENT,
      p_sponsor_id: "s",
      p_placement: "materials",
    });
    await expect(
      api.fetchSponsorReportLeadsSeries({ ...QUERY, from: "2099-06-02" }),
    ).resolves.toEqual([]);
    expect(rpc).toHaveBeenLastCalledWith("admin_event_sponsor_report_leads_series", {
      p_event_id: EVENT,
      p_from: "2099-06-02",
    });
  });

  it("linki i historia firmy", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(api.fetchSponsorReportLinks(EVENT)).resolves.toEqual([]);
    expect(rpc).toHaveBeenLastCalledWith("admin_event_sponsor_report_links_list", {
      p_event_id: EVENT,
    });
    await expect(api.fetchCompanySponsorships("c")).resolves.toEqual([]);
    expect(rpc).toHaveBeenLastCalledWith("admin_event_company_sponsorships", { p_company_id: "c" });
    rpc.mockResolvedValue({ data: [{ id: "l" }], error: null });
    await expect(api.fetchSponsorReportLinks(EVENT)).resolves.toEqual([{ id: "l" }]);
    await expect(api.fetchCompanySponsorships("c")).resolves.toEqual([{ id: "l" }]);
  });

  it.each([
    ["podsumowanie", () => api.fetchSponsorReportSummary(QUERY)],
    ["szereg", () => api.fetchSponsorReportSeries(QUERY)],
    ["szereg kontaktów", () => api.fetchSponsorReportLeadsSeries(QUERY)],
    ["linki", () => api.fetchSponsorReportLinks(EVENT)],
    ["historia firmy", () => api.fetchCompanySponsorships("c")],
    ["odwołanie", () => api.revokeSponsorReportLink("l")],
    [
      "wydanie",
      () =>
        api.issueSponsorReportLink({
          sponsorId: "s",
          label: "x",
          expiresAt: null,
          includeLeads: false,
        }),
    ],
    ["przeniesienie do CRM", () => api.pushLeadScansToCrm({ eventId: EVENT, sponsorId: null })],
  ])("%s: odmowa bazy dochodzi jako Error z głową komunikatu", async (_label, run) => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden: admin role required" } });
    await expect(run()).rejects.toThrow("forbidden: admin role required");
  });
});

describe("zapisy", () => {
  it("wydanie linku: etykieta przycięta, waźność pominięta = domyślna bazy, token wraca raz", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        id: "l1",
        sponsor_id: "s",
        token: "T".repeat(32),
        token_prefix: "TTTTTTTT",
        expires_at: "2099-07-01T00:00:00Z",
        include_leads: true,
      },
      error: null,
    });
    await expect(
      api.issueSponsorReportLink({
        sponsorId: "s",
        label: "  Dział  ",
        expiresAt: null,
        includeLeads: true,
      }),
    ).resolves.toEqual({
      id: "l1",
      sponsorId: "s",
      token: "T".repeat(32),
      tokenPrefix: "TTTTTTTT",
      expiresAt: "2099-07-01T00:00:00Z",
      includeLeads: true,
    });
    expect(rpc).toHaveBeenLastCalledWith("admin_event_sponsor_report_link_issue", {
      p_payload: { sponsor_id: "s", label: "Dział", include_leads: true },
    });

    rpc.mockResolvedValueOnce({ data: ["nie-obiekt"], error: null });
    await expect(
      api.issueSponsorReportLink({
        sponsorId: "s",
        label: "L",
        expiresAt: "2099-06-30T23:59:59.000Z",
        includeLeads: false,
      }),
    ).resolves.toEqual({
      id: "",
      sponsorId: "",
      token: "",
      tokenPrefix: "",
      expiresAt: "",
      includeLeads: false,
    });
    expect(rpc).toHaveBeenLastCalledWith("admin_event_sponsor_report_link_issue", {
      p_payload: {
        sponsor_id: "s",
        label: "L",
        include_leads: false,
        expires_at: "2099-06-30T23:59:59.000Z",
      },
    });
  });

  it("odwołanie: true tylko dla jawnego true", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(api.revokeSponsorReportLink("l")).resolves.toBe(true);
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(api.revokeSponsorReportLink("l")).resolves.toBe(false);
    expect(rpc).toHaveBeenLastCalledWith("admin_event_sponsor_report_link_revoke", {
      p_link_id: "l",
    });
  });

  it("przeniesienie do CRM: liczniki z odpowiedzi, zła odpowiedź = zera", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        persons: 4,
        created: 1,
        updated: 1,
        skipped_no_email: 1,
        skipped_no_consent: 1,
        failed: 0,
      },
      error: null,
    });
    await expect(api.pushLeadScansToCrm({ eventId: EVENT, sponsorId: "s" })).resolves.toEqual({
      persons: 4,
      created: 1,
      updated: 1,
      skippedNoEmail: 1,
      skippedNoConsent: 1,
      failed: 0,
    });
    expect(rpc).toHaveBeenLastCalledWith("admin_event_lead_scans_push_to_crm", {
      p_payload: { event_id: EVENT, sponsor_id: "s" },
    });
    rpc.mockResolvedValueOnce({ data: { created: "1", failed: Number.NaN }, error: null });
    await expect(api.pushLeadScansToCrm({ eventId: EVENT, sponsorId: null })).resolves.toEqual({
      persons: 0,
      created: 0,
      updated: 0,
      skippedNoEmail: 0,
      skippedNoConsent: 0,
      failed: 0,
    });
    expect(rpc).toHaveBeenLastCalledWith("admin_event_lead_scans_push_to_crm", {
      p_payload: { event_id: EVENT },
    });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      api.pushLeadScansToCrm({ eventId: EVENT, sponsorId: null }),
    ).resolves.toMatchObject({
      persons: 0,
    });
  });
});
