// Haki kupujacego: korzen "event-invoices-me", zapytania tylko z sesja,
// kazda mutacja uniewaznia cala galaz kupujacego (i tylko ja).
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyBuyerDraft } from "@/lib/events/eventInvoiceBuyerDraft";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";

const api = vi.hoisted(() => ({
  fetchMyInvoiceSources: vi.fn(),
  fetchMyInvoices: vi.fn(),
  saveInvoiceRequest: vi.fn(),
  cancelInvoiceRequest: vi.fn(),
}));

vi.mock("@/lib/events/myEventInvoicesApi", () => api);

const hooks = await import("@/lib/events/useMyEventInvoices");
const { myEventInvoiceKeys } = hooks;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe("myEventInvoiceKeys", () => {
  it("klucz nie zna wydarzenia - dane naleza do zalogowanego", () => {
    expect(myEventInvoiceKeys.all).toEqual(["event-invoices-me"]);
    expect(myEventInvoiceKeys.sources()).toEqual(["event-invoices-me", "sources"]);
    expect(myEventInvoiceKeys.documents()).toEqual(["event-invoices-me", "documents"]);
  });
});

describe("zapytania", () => {
  it("z sesja: zamowienia i dokumenty", async () => {
    api.fetchMyInvoiceSources.mockResolvedValue([{ source_id: "s" }]);
    api.fetchMyInvoices.mockResolvedValue([{ id: "i" }]);
    const sources = renderHookWithQueryClient(() => hooks.useMyInvoiceSources(true));
    const documents = renderHookWithQueryClient(() => hooks.useMyInvoices(true));
    await waitFor(() => expect(sources.result.current.data).toEqual([{ source_id: "s" }]));
    await waitFor(() => expect(documents.result.current.data).toEqual([{ id: "i" }]));
  });

  it("gosc nie pyta bazy", async () => {
    const sources = renderHookWithQueryClient(() => hooks.useMyInvoiceSources(false));
    const documents = renderHookWithQueryClient(() => hooks.useMyInvoices(false));
    await act(async () => {});
    expect(sources.result.current.fetchStatus).toBe("idle");
    expect(documents.result.current.fetchStatus).toBe("idle");
    expect(api.fetchMyInvoiceSources).not.toHaveBeenCalled();
    expect(api.fetchMyInvoices).not.toHaveBeenCalled();
  });
});

describe("mutacje", () => {
  it("prosba: cel i nabywca do API, uniewaznienie galezi kupujacego", async () => {
    api.saveInvoiceRequest.mockResolvedValue("req");
    const view = renderHookWithQueryClient(() => hooks.useSaveInvoiceRequest());
    view.queryClient.setQueryData(myEventInvoiceKeys.sources(), []);
    view.queryClient.setQueryData(["event-invoices", "ev"], []);
    const buyer = { ...emptyBuyerDraft(), name: "Acme" };
    await act(async () => {
      await expect(
        view.result.current.mutateAsync({ target: { registrationId: "r" }, buyer }),
      ).resolves.toBe("req");
    });
    expect(api.saveInvoiceRequest).toHaveBeenCalledWith({ registrationId: "r" }, buyer);
    expect(view.queryClient.getQueryState(myEventInvoiceKeys.sources())?.isInvalidated).toBe(true);
    expect(view.queryClient.getQueryState(["event-invoices", "ev"])?.isInvalidated).toBe(false);
  });

  it("wycofanie prosby uniewaznia galaz kupujacego", async () => {
    api.cancelInvoiceRequest.mockResolvedValue("req");
    const view = renderHookWithQueryClient(() => hooks.useCancelInvoiceRequest());
    view.queryClient.setQueryData(myEventInvoiceKeys.documents(), []);
    await act(async () => {
      await view.result.current.mutateAsync("req");
    });
    expect(api.cancelInvoiceRequest.mock.calls[0]?.[0]).toBe("req");
    expect(view.queryClient.getQueryState(myEventInvoiceKeys.documents())?.isInvalidated).toBe(true);
  });

  it("odmowa bazy nie uniewaznia", async () => {
    api.cancelInvoiceRequest.mockRejectedValue(new Error("not_found: x"));
    const view = renderHookWithQueryClient(() => hooks.useCancelInvoiceRequest());
    view.queryClient.setQueryData(myEventInvoiceKeys.documents(), []);
    await act(async () => {
      await expect(view.result.current.mutateAsync("req")).rejects.toThrow("not_found");
    });
    expect(view.queryClient.getQueryState(myEventInvoiceKeys.documents())?.isInvalidated).toBe(false);
  });
});
