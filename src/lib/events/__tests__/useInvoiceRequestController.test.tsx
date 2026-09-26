// Stan prosby o fakture przy zakupie. Najwazniejsze kontrakty:
//   * NIC nie jest pobierane, dopoki kupujacy nie zaznaczy "potrzebuje faktury"
//     (krok platnosci bez faktury nie robi dodatkowych zapytan);
//   * podpowiedz: zapisana prosba > profil rozliczeniowy, nigdy po edycji;
//   * `commit()` = walidacja + zapis prosby (+ profil przy "zapamietaj");
//     `false` zatrzymuje przejscie do kasy.
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingProfile } from "@/lib/billing/types";
import { emptyBuyerDraft } from "@/lib/events/eventInvoiceBuyerDraft";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { INVOICE_IDS, myInvoiceSourceRow } from "@/test/events/invoiceFixtures";

const billing = vi.hoisted(() => ({
  fetchMyBillingProfile: vi.fn(),
  upsertMyBillingProfile: vi.fn(),
}));
const api = vi.hoisted(() => ({
  fetchMyInvoiceSources: vi.fn(),
  fetchMyInvoices: vi.fn(),
  saveInvoiceRequest: vi.fn(),
  cancelInvoiceRequest: vi.fn(),
}));

vi.mock("@/lib/billing/queries", () => billing);
vi.mock("@/lib/events/myEventInvoicesApi", () => api);

const { useInvoiceRequestController } = await import("@/lib/events/useInvoiceRequestController");

const PROFILE: BillingProfile = {
  id: "bp",
  user_id: "u",
  tenant_id: "t",
  full_name: "Anna Kupujaca",
  company: "Profil Sp. z o.o.",
  tax_id: "7011278375",
  email: "anna@example.com",
  phone: null,
  address_line1: "ul. Profilowa 1",
  address_line2: null,
  city: "Warszawa",
  postal_code: "00-001",
  region: null,
  country_code: "PL",
  is_company: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const VALID = {
  ...emptyBuyerDraft(),
  name: "Acme Sp. z o.o.",
  taxId: "5260250274",
  address: "ul. Morska 5",
  postalCode: "80-001",
  city: "Gdansk",
};

const TARGET = { registrationId: INVOICE_IDS.registration };

beforeEach(() => {
  for (const fn of [...Object.values(billing), ...Object.values(api)]) fn.mockReset();
  billing.fetchMyBillingProfile.mockResolvedValue(null);
  api.fetchMyInvoiceSources.mockResolvedValue([]);
});

describe("useInvoiceRequestController", () => {
  it("bez zaznaczenia nic nie pobiera, a commit przepuszcza do kasy bez zapisu", async () => {
    const view = renderHookWithQueryClient(() =>
      useInvoiceRequestController({ target: TARGET, enabled: true }),
    );
    await act(async () => {});
    expect(billing.fetchMyBillingProfile).not.toHaveBeenCalled();
    expect(api.fetchMyInvoiceSources).not.toHaveBeenCalled();
    let result = false;
    await act(async () => {
      result = await view.result.current.commit();
    });
    expect(result).toBe(true);
    expect(api.saveInvoiceRequest).not.toHaveBeenCalled();
    expect(view.result.current.wanted).toBe(false);
    expect(view.result.current.saving).toBe(false);
  });

  it("wylaczony (gosc) nie pobiera nawet po zaznaczeniu", async () => {
    const view = renderHookWithQueryClient(() =>
      useInvoiceRequestController({ target: TARGET, enabled: false }),
    );
    act(() => view.result.current.setWanted(true));
    await act(async () => {});
    expect(billing.fetchMyBillingProfile).not.toHaveBeenCalled();
    expect(api.fetchMyInvoiceSources).not.toHaveBeenCalled();
  });

  it("po zaznaczeniu podpowiada dane z profilu rozliczeniowego", async () => {
    billing.fetchMyBillingProfile.mockResolvedValue(PROFILE);
    const view = renderHookWithQueryClient(() =>
      useInvoiceRequestController({ target: TARGET, enabled: true }),
    );
    act(() => view.result.current.setWanted(true));
    await waitFor(() => expect(view.result.current.buyer.name).toBe("Profil Sp. z o.o."));
    expect(view.result.current.profile).toEqual(PROFILE);
    expect(view.result.current.hasExistingRequest).toBe(false);
    expect(api.fetchMyInvoiceSources).toHaveBeenCalledTimes(1);
  });

  it("zapisana prosba ma pierwszenstwo przed profilem; wystawiona faktura blokuje zapis", async () => {
    billing.fetchMyBillingProfile.mockResolvedValue(PROFILE);
    api.fetchMyInvoiceSources.mockResolvedValue([
      myInvoiceSourceRow({ source_id: "inna", source_kind: "registration" }),
      myInvoiceSourceRow({
        request_id: INVOICE_IDS.request,
        request_status: "pending",
        buyer_name: "Z prosby SA",
        buyer_tax_id: "5260250274",
        buyer_country: "PL",
        buyer_address: "ul. Prosby 2",
        buyer_postal_code: "80-002",
        buyer_city: "Gdynia",
        invoice_number: "FV/2026/09/0001",
      }),
    ]);
    const view = renderHookWithQueryClient(() =>
      useInvoiceRequestController({ target: TARGET, enabled: true }),
    );
    act(() => view.result.current.setWanted(true));
    await waitFor(() => expect(view.result.current.buyer.name).toBe("Z prosby SA"));
    expect(view.result.current.hasExistingRequest).toBe(true);
    expect(view.result.current.invoicedNumber).toBe("FV/2026/09/0001");
    let result = false;
    await act(async () => {
      result = await view.result.current.commit();
    });
    expect(result).toBe(true);
    expect(api.saveInvoiceRequest).not.toHaveBeenCalled();
  });

  it("zamowienie pakietu dopasowuje sie po rodzaju zrodla", async () => {
    api.fetchMyInvoiceSources.mockResolvedValue([
      myInvoiceSourceRow({
        source_id: INVOICE_IDS.packageOrder,
        source_kind: "registration",
        request_id: "zly",
      }),
      myInvoiceSourceRow({
        source_id: INVOICE_IDS.packageOrder,
        source_kind: "package_order",
        request_id: INVOICE_IDS.request,
        buyer_name: "Pakiet SA",
      }),
    ]);
    const view = renderHookWithQueryClient(() =>
      useInvoiceRequestController({
        target: { packageOrderId: INVOICE_IDS.packageOrder },
        enabled: true,
      }),
    );
    act(() => view.result.current.setWanted(true));
    await waitFor(() => expect(view.result.current.buyer.name).toBe("Pakiet SA"));
  });

  it("podpowiedz milczy po edycji; recznie wstawiony profil tez liczy sie jako edycja", async () => {
    billing.fetchMyBillingProfile.mockResolvedValue(PROFILE);
    const view = renderHookWithQueryClient(() =>
      useInvoiceRequestController({ target: TARGET, enabled: true }),
    );
    act(() => view.result.current.setBuyer({ ...VALID, name: "Wpisane recznie" }));
    act(() => view.result.current.setWanted(true));
    await waitFor(() => expect(billing.fetchMyBillingProfile).toHaveBeenCalled());
    await act(async () => {});
    expect(view.result.current.buyer.name).toBe("Wpisane recznie");
    act(() => view.result.current.prefillFromProfile(PROFILE));
    expect(view.result.current.buyer.name).toBe("Profil Sp. z o.o.");
  });

  it("commit z bledami: pokazuje bledy i zatrzymuje kase", async () => {
    const view = renderHookWithQueryClient(() =>
      useInvoiceRequestController({ target: TARGET, enabled: true }),
    );
    act(() => view.result.current.setWanted(true));
    await act(async () => {});
    expect(view.result.current.showErrors).toBe(false);
    let result = true;
    await act(async () => {
      result = await view.result.current.commit();
    });
    expect(result).toBe(false);
    expect(view.result.current.showErrors).toBe(true);
    expect(view.result.current.errors.name).toBeDefined();
    expect(api.saveInvoiceRequest).not.toHaveBeenCalled();
    let valid = true;
    act(() => {
      valid = view.result.current.validate();
    });
    expect(valid).toBe(false);
  });

  it("commit poprawny: zapis prosby, bez profilu gdy nie zapamietuje", async () => {
    api.saveInvoiceRequest.mockResolvedValue(INVOICE_IDS.request);
    const view = renderHookWithQueryClient(() =>
      useInvoiceRequestController({ target: TARGET, enabled: true }),
    );
    act(() => {
      view.result.current.setWanted(true);
      view.result.current.setBuyer(VALID);
    });
    let result = false;
    await act(async () => {
      result = await view.result.current.commit();
    });
    expect(result).toBe(true);
    expect(api.saveInvoiceRequest).toHaveBeenCalledWith(TARGET, VALID);
    expect(billing.upsertMyBillingProfile).not.toHaveBeenCalled();
    expect(view.result.current.failureKey).toBeNull();
  });

  it("zapamietaj: po zapisie prosby dane trafiaja do profilu; awaria profilu nie psuje prosby", async () => {
    api.saveInvoiceRequest.mockResolvedValue(INVOICE_IDS.request);
    billing.upsertMyBillingProfile.mockRejectedValue(new Error("profil"));
    const view = renderHookWithQueryClient(() =>
      useInvoiceRequestController({ target: null, enabled: true }),
    );
    act(() => {
      view.result.current.setWanted(true);
      view.result.current.setBuyer(VALID);
      view.result.current.setRemember(true);
    });
    expect(view.result.current.remember).toBe(true);
    let result = false;
    await act(async () => {
      result = await view.result.current.commit({ packageOrderId: INVOICE_IDS.packageOrder });
    });
    expect(result).toBe(true);
    expect(api.saveInvoiceRequest).toHaveBeenCalledWith(
      { packageOrderId: INVOICE_IDS.packageOrder },
      VALID,
    );
    expect(billing.upsertMyBillingProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        company: "Acme Sp. z o.o.",
        tax_id: "5260250274",
        is_company: true,
      }),
    );
  });

  it("bez celu (pakiet przed utworzeniem zamowienia) commit nic nie zapisuje", async () => {
    const view = renderHookWithQueryClient(() =>
      useInvoiceRequestController({ target: null, enabled: true }),
    );
    act(() => {
      view.result.current.setWanted(true);
      view.result.current.setBuyer(VALID);
    });
    let result = false;
    await act(async () => {
      result = await view.result.current.commit();
    });
    expect(result).toBe(true);
    expect(api.saveInvoiceRequest).not.toHaveBeenCalled();
    expect(api.fetchMyInvoiceSources).not.toHaveBeenCalled();
  });

  it("odmowa bazy: klucz bledu kupujacego i zatrzymana kasa", async () => {
    api.saveInvoiceRequest.mockRejectedValue(new Error("request_window_closed: too late"));
    const view = renderHookWithQueryClient(() =>
      useInvoiceRequestController({ target: TARGET, enabled: true }),
    );
    act(() => {
      view.result.current.setWanted(true);
      view.result.current.setBuyer(VALID);
    });
    let result = true;
    await act(async () => {
      result = await view.result.current.commit();
    });
    expect(result).toBe(false);
    expect(view.result.current.failureKey).toBe("eventInvoices.errors.requestWindowClosed");
  });
});
