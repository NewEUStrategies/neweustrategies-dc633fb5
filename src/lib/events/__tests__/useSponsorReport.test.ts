// Hooki raportu dla sponsorów (`useSponsorReport.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. RAPORT NIE ODŚWIEŻA SIĘ PO ZAPISIE SPONSORÓW - klucze raportu muszą
//      wisieć pod gałęzią `["event-sponsors", eventId]`, którą unieważniają
//      mutacje modułu sponsorów i zdarzenia domenowe linków.
//   2. MUTACJA UNIEWAŻNIA CUDZE WYDARZENIE albo nie unieważnia karty firmy
//      (licznik aktywnych linków w CRM zostaje nieaktualny).
//   3. ZAPYTANIE Z PUSTYM IDENTYFIKATOREM leci do bazy.
import { waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchSponsorReportSummary: vi.fn(async () => [{ sponsor_id: "s" }]),
  fetchSponsorReportSeries: vi.fn(async () => []),
  fetchSponsorReportLeadsSeries: vi.fn(async () => []),
  fetchSponsorReportLinks: vi.fn(async () => []),
  fetchCompanySponsorships: vi.fn(async () => []),
  issueSponsorReportLink: vi.fn(async () => ({ id: "l", token: "t" })),
  revokeSponsorReportLink: vi.fn(async () => true),
  pushLeadScansToCrm: vi.fn(async () => ({ created: 1 })),
}));
vi.mock("@/lib/events/sponsorReportApi", () => api);

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { sponsorKeys } from "@/lib/events/useEventSponsors";
import {
  sponsorReportKeys,
  useCompanySponsorships,
  useIssueSponsorReportLink,
  usePushLeadScansToCrm,
  useRevokeSponsorReportLink,
  useSponsorReportLeadsSeries,
  useSponsorReportLinks,
  useSponsorReportSeries,
  useSponsorReportSummary,
} from "@/lib/events/useSponsorReport";

const E1 = "e1";
const E2 = "e2";
const Q = { eventId: E1, from: null, to: null, placement: null, sponsorId: null };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockClear();
});

describe("klucze", () => {
  it("raport wisi pod gałęzią sponsorów wydarzenia, karty firm pod korzeniem modułu", () => {
    expect(sponsorReportKeys.event(E1).slice(0, 2)).toEqual(sponsorKeys.event(E1));
    expect(sponsorReportKeys.summary(Q)).toEqual(["event-sponsors", E1, "report", "summary", Q]);
    expect(sponsorReportKeys.series(Q)[3]).toBe("series");
    expect(sponsorReportKeys.leadsSeries(Q)[3]).toBe("leads-series");
    expect(sponsorReportKeys.links(E1)).toEqual(["event-sponsors", E1, "report", "links"]);
    expect(sponsorReportKeys.company("c")).toEqual(["event-sponsors", "company", "c"]);
  });
});

describe("zapytania", () => {
  it("wszystkie odczyty wołają API z zapytaniem i oddają dane", async () => {
    const summary = renderHookWithQueryClient(() => useSponsorReportSummary(Q));
    await waitFor(() => expect(summary.result.current.data).toEqual([{ sponsor_id: "s" }]));
    const series = renderHookWithQueryClient(() => useSponsorReportSeries(Q));
    const leads = renderHookWithQueryClient(() => useSponsorReportLeadsSeries(Q));
    const links = renderHookWithQueryClient(() => useSponsorReportLinks(E1));
    const company = renderHookWithQueryClient(() => useCompanySponsorships("c"));
    await waitFor(() => expect(series.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(leads.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(links.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(company.result.current.isSuccess).toBe(true));
    expect(api.fetchSponsorReportSummary).toHaveBeenCalledWith(Q);
    expect(api.fetchSponsorReportSeries).toHaveBeenCalledWith(Q);
    expect(api.fetchSponsorReportLeadsSeries).toHaveBeenCalledWith(Q);
    expect(api.fetchSponsorReportLinks).toHaveBeenCalledWith(E1);
    expect(api.fetchCompanySponsorships).toHaveBeenCalledWith("c");
  });

  it("pusty identyfikator = zapytanie wyłączone", () => {
    renderHookWithQueryClient(() => useSponsorReportSummary({ ...Q, eventId: "" }));
    renderHookWithQueryClient(() => useSponsorReportSeries({ ...Q, eventId: "" }));
    renderHookWithQueryClient(() => useSponsorReportLeadsSeries({ ...Q, eventId: "" }));
    renderHookWithQueryClient(() => useSponsorReportLinks(""));
    renderHookWithQueryClient(() => useCompanySponsorships(""));
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it("odmowa historii firmy (redaktor CRM) nie jest ponawiana", async () => {
    api.fetchCompanySponsorships.mockRejectedValueOnce(new Error("forbidden: admin role required"));
    const company = renderHookWithQueryClient(() => useCompanySponsorships("c"));
    await waitFor(() => expect(company.result.current.isError).toBe(true));
    expect(api.fetchCompanySponsorships).toHaveBeenCalledTimes(1);
  });
});

describe("mutacje unieważniają SWOJĄ gałąź i karty firm, nie cudze wydarzenie", () => {
  it.each([
    [
      "wydanie linku",
      () => useIssueSponsorReportLink(E1),
      { sponsorId: "s" },
      api.issueSponsorReportLink,
    ],
    ["odwołanie linku", () => useRevokeSponsorReportLink(E1), "l", api.revokeSponsorReportLink],
    [
      "przeniesienie do CRM",
      () => usePushLeadScansToCrm(E1),
      { eventId: E1, sponsorId: null },
      api.pushLeadScansToCrm,
    ],
  ] as const)("%s", async (_label, hook, input, fn) => {
    const { result, queryClient } = renderHookWithQueryClient(
      hook as () => {
        mutateAsync: (value: unknown) => Promise<unknown>;
      },
    );
    queryClient.setQueryData(sponsorReportKeys.links(E1), []);
    queryClient.setQueryData(sponsorReportKeys.links(E2), []);
    queryClient.setQueryData(sponsorReportKeys.company("c"), []);
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    expect(fn).toHaveBeenCalledWith(input, expect.anything());
    expect(queryClient.getQueryState(sponsorReportKeys.links(E1))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(sponsorReportKeys.company("c"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(sponsorReportKeys.links(E2))?.isInvalidated).toBe(false);
  });
});
