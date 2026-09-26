// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Haki ekranu faktur: klucze i uniewaznienia. Wystawienie zmienia naraz
// kandydatow, liste i szczegoly dokumentu, a takze pakiety wydarzenia (firma
// CRM dopieta do zamowienia) - wiec mutacja uniewaznia CALA galaz wydarzenia
// i galaz pakietow TEGO wydarzenia, a cudzych galezi nie rusza. Ustawienia
// wystawcy (wspolne dla najemcy) wracaja z zapisu prosto do cache.
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";

const api = vi.hoisted(() => ({
  fetchInvoiceSettings: vi.fn(),
  fetchInvoiceCandidates: vi.fn(),
  fetchEventInvoices: vi.fn(),
  fetchEventInvoice: vi.fn(),
  saveInvoiceSettings: vi.fn(),
  createInvoiceDraft: vi.fn(),
  updateInvoiceDraft: vi.fn(),
  issueInvoice: vi.fn(),
  issuePendingInvoices: vi.fn(),
  cancelInvoice: vi.fn(),
  createInvoiceCorrection: vi.fn(),
  invoiceFromProforma: vi.fn(),
  updateInvoiceKsef: vi.fn(),
  setInvoicePaid: vi.fn(),
}));

vi.mock("@/lib/events/eventInvoicesApi", () => api);

const hooks = await import("@/lib/events/useEventInvoices");
const { eventInvoiceKeys } = hooks;

const EVENT = "ev-1";

const SETTINGS_INPUT = {
  enabled: true,
  sellerName: "Org",
  sellerTaxId: "7011278375",
  sellerAddress: "ul. Dluga 1",
  sellerPostalCode: "00-001",
  sellerCity: "Warszawa",
  sellerCountry: "PL",
  sellerEmail: "",
  sellerPhone: "",
  sellerBankAccount: "",
  sellerBankSwift: "",
  seriesInvoice: "FV",
  seriesProforma: "PRO",
  seriesCorrection: "KOR",
  paymentDays: 14,
  defaultVatRate: "23" as const,
  vatExemptBasis: "",
  footerNote: "",
  defaultLocale: "pl" as const,
  confirmSeller: false,
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe("eventInvoiceKeys", () => {
  it("jedna fabryka zakorzeniona w event-invoices", () => {
    expect(eventInvoiceKeys.all).toEqual(["event-invoices"]);
    expect(eventInvoiceKeys.settings()).toEqual(["event-invoices", "settings"]);
    expect(eventInvoiceKeys.event(EVENT)).toEqual(["event-invoices", EVENT]);
    expect(eventInvoiceKeys.candidates(EVENT)).toEqual(["event-invoices", EVENT, "candidates"]);
    expect(eventInvoiceKeys.list(EVENT)).toEqual(["event-invoices", EVENT, "list"]);
    expect(eventInvoiceKeys.detail(EVENT, "inv")).toEqual([
      "event-invoices",
      EVENT,
      "detail",
      "inv",
    ]);
  });
});

describe("zapytania", () => {
  it("ustawienia, kandydaci, lista i dokument", async () => {
    api.fetchInvoiceSettings.mockResolvedValue({ enabled: true });
    api.fetchInvoiceCandidates.mockResolvedValue([{ source_id: "s" }]);
    api.fetchEventInvoices.mockResolvedValue([{ id: "i" }]);
    api.fetchEventInvoice.mockResolvedValue({ id: "inv" });
    const settings = renderHookWithQueryClient(() => hooks.useInvoiceSettings());
    const candidates = renderHookWithQueryClient(() => hooks.useInvoiceCandidates(EVENT));
    const list = renderHookWithQueryClient(() => hooks.useEventInvoices(EVENT));
    const detail = renderHookWithQueryClient(() => hooks.useEventInvoice(EVENT, "inv"));
    await waitFor(() => expect(settings.result.current.data).toEqual({ enabled: true }));
    await waitFor(() => expect(candidates.result.current.data).toEqual([{ source_id: "s" }]));
    await waitFor(() => expect(list.result.current.data).toEqual([{ id: "i" }]));
    await waitFor(() => expect(detail.result.current.data).toEqual({ id: "inv" }));
    expect(api.fetchInvoiceCandidates).toHaveBeenCalledWith(EVENT);
    expect(api.fetchEventInvoices).toHaveBeenCalledWith(EVENT);
    expect(api.fetchEventInvoice).toHaveBeenCalledWith("inv");
  });

  it("bez wydarzenia, z zamknietym edytorem albo wylaczone - baza nie jest pytana", async () => {
    const settings = renderHookWithQueryClient(() => hooks.useInvoiceSettings(false));
    const candidates = renderHookWithQueryClient(() => hooks.useInvoiceCandidates(""));
    const list = renderHookWithQueryClient(() => hooks.useEventInvoices(""));
    const closed = renderHookWithQueryClient(() => hooks.useEventInvoice(EVENT, null));
    const noEvent = renderHookWithQueryClient(() => hooks.useEventInvoice("", "inv"));
    await act(async () => {});
    for (const view of [settings, candidates, list, closed, noEvent]) {
      expect(view.result.current.fetchStatus).toBe("idle");
    }
    expect(api.fetchInvoiceSettings).not.toHaveBeenCalled();
    expect(api.fetchInvoiceCandidates).not.toHaveBeenCalled();
    expect(api.fetchEventInvoices).not.toHaveBeenCalled();
    expect(api.fetchEventInvoice).not.toHaveBeenCalled();
    expect(
      closed.queryClient.getQueryCache().find({ queryKey: eventInvoiceKeys.detail(EVENT, "") }),
    ).toBeDefined();
  });
});

describe("mutacje", () => {
  interface MutationCase {
    name: string;
    fn: keyof typeof api;
    input: unknown;
    result: unknown;
    use: () => () => Promise<unknown>;
  }
  const DRAFT_INPUT = {
    eventId: EVENT,
    kind: "invoice" as const,
    aggregate: "per_source" as const,
    sources: [{ kind: "registration" as const, id: "r" }],
  };
  const CORRECTION_INPUT = { invoiceId: "i", mode: "full" as const, reason: "r" };
  const KSEF_INPUT = { id: "i", status: "sent" as const, number: "" };
  const PAID_INPUT = { id: "i", paidAt: null };
  const CASES: MutationCase[] = [
    {
      name: "useCreateInvoiceDraft",
      fn: "createInvoiceDraft",
      input: DRAFT_INPUT,
      result: "draft",
      use: () => {
        const mutation = hooks.useCreateInvoiceDraft(EVENT);
        return () => mutation.mutateAsync(DRAFT_INPUT);
      },
    },
    {
      name: "useUpdateInvoiceDraft",
      fn: "updateInvoiceDraft",
      input: { id: "d" },
      result: "d",
      use: () => {
        const mutation = hooks.useUpdateInvoiceDraft(EVENT);
        return () => mutation.mutateAsync({ id: "d" });
      },
    },
    {
      name: "useIssueInvoice",
      fn: "issueInvoice",
      input: "d",
      result: { id: "d", number: "FV/1" },
      use: () => {
        const mutation = hooks.useIssueInvoice(EVENT);
        return () => mutation.mutateAsync("d");
      },
    },
    {
      name: "useCreateInvoiceCorrection",
      fn: "createInvoiceCorrection",
      input: CORRECTION_INPUT,
      result: "c",
      use: () => {
        const mutation = hooks.useCreateInvoiceCorrection(EVENT);
        return () => mutation.mutateAsync(CORRECTION_INPUT);
      },
    },
    {
      name: "useInvoiceFromProforma",
      fn: "invoiceFromProforma",
      input: "p",
      result: "f",
      use: () => {
        const mutation = hooks.useInvoiceFromProforma(EVENT);
        return () => mutation.mutateAsync("p");
      },
    },
    {
      name: "useUpdateInvoiceKsef",
      fn: "updateInvoiceKsef",
      input: KSEF_INPUT,
      result: "i",
      use: () => {
        const mutation = hooks.useUpdateInvoiceKsef(EVENT);
        return () => mutation.mutateAsync(KSEF_INPUT);
      },
    },
    {
      name: "useSetInvoicePaid",
      fn: "setInvoicePaid",
      input: PAID_INPUT,
      result: "i",
      use: () => {
        const mutation = hooks.useSetInvoicePaid(EVENT);
        return () => mutation.mutateAsync(PAID_INPUT);
      },
    },
  ];

  it.each(CASES)("$name: wynik API i uniewaznienie galezi wydarzenia + pakietow", async (item) => {
    api[item.fn].mockResolvedValue(item.result);
    const view = renderHookWithQueryClient(() => item.use());
    view.queryClient.setQueryData(eventInvoiceKeys.list(EVENT), []);
    view.queryClient.setQueryData(eventInvoiceKeys.list("other"), []);
    view.queryClient.setQueryData(["event-packages", EVENT], []);
    view.queryClient.setQueryData(["event-packages", "other"], []);
    view.queryClient.setQueryData(eventInvoiceKeys.settings(), { enabled: true });
    await act(async () => {
      await expect(view.result.current()).resolves.toEqual(item.result);
    });
    expect(api[item.fn].mock.calls[0]?.[0]).toEqual(item.input);
    const stale = (key: readonly unknown[]) => view.queryClient.getQueryState(key)?.isInvalidated;
    expect(stale(eventInvoiceKeys.list(EVENT))).toBe(true);
    expect(stale(["event-packages", EVENT])).toBe(true);
    expect(stale(eventInvoiceKeys.list("other"))).toBe(false);
    expect(stale(["event-packages", "other"])).toBe(false);
    expect(stale(eventInvoiceKeys.settings())).toBe(false);
  });

  it("masowe wystawienie przekazuje wydarzenie i tryb zbiorczy", async () => {
    api.issuePendingInvoices.mockResolvedValue({ issued: [], failed: [] });
    const view = renderHookWithQueryClient(() => hooks.useIssuePendingInvoices(EVENT));
    await act(async () => {
      await view.result.current.mutateAsync(true);
    });
    expect(api.issuePendingInvoices).toHaveBeenCalledWith(EVENT, true);
  });

  it("anulowanie przekazuje identyfikator i powod", async () => {
    api.cancelInvoice.mockResolvedValue("i");
    const view = renderHookWithQueryClient(() => hooks.useCancelInvoice(EVENT));
    await act(async () => {
      await view.result.current.mutateAsync({ id: "i", reason: "Pomylka" });
    });
    expect(api.cancelInvoice).toHaveBeenCalledWith("i", "Pomylka");
  });

  it("odmowa bazy nie uniewaznia niczego", async () => {
    api.issueInvoice.mockRejectedValue(new Error("mor_seller_conflict: x"));
    const view = renderHookWithQueryClient(() => hooks.useIssueInvoice(EVENT));
    view.queryClient.setQueryData(eventInvoiceKeys.list(EVENT), []);
    await act(async () => {
      await expect(view.result.current.mutateAsync("d")).rejects.toThrow("mor_seller_conflict");
    });
    expect(view.queryClient.getQueryState(eventInvoiceKeys.list(EVENT))?.isInvalidated).toBe(false);
  });

  it("zapis ustawien wraca prosto do cache ustawien", async () => {
    api.saveInvoiceSettings.mockResolvedValue({ enabled: true, sellerName: "Org" });
    const view = renderHookWithQueryClient(() => hooks.useSaveInvoiceSettings());
    await act(async () => {
      await view.result.current.mutateAsync(SETTINGS_INPUT);
    });
    expect(view.queryClient.getQueryData(eventInvoiceKeys.settings())).toEqual({
      enabled: true,
      sellerName: "Org",
    });
  });
});
