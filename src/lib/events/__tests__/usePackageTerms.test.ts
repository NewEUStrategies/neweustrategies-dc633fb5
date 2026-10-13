// Hook warunków zakupu i profilu podatkowego pakietów (TIX-07, TIX-09).
//
// CO TU PILNUJEMY.
//   1. KLUCZ SIEDZI W GAŁĘZI WYDARZENIA. Zapis pakietu unieważnia
//      `packageKeys.event(eventId)` (`useEventInvalidation`), więc warunki
//      zapisane przed chwilą wracają do dialogu bez odświeżania strony.
//      Dowodzimy tego PRZEBIEGIEM (zapis -> drugie pobranie), nie samym
//      porównaniem kluczy: klucz poza gałęzią oznaczałby dialog, który po
//      zapisie startuje od warunków sprzed zapisu.
//   2. STAN ZAPYTANIA -> STAN WARUNKÓW. „W drodze", „baza bez migracji"
//      (`null` z warstwy danych) i „odczyt padł" są rozróżnione, a dane
//      wygrywają z błędem odświeżenia w tle.
//
// Atrapą jest WYŁĄCZNIE `packagesApi` (sieć); klucze gałęzi bierzemy
// PRAWDZIWE z `useEventPackages`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EventPackageInput, EventPackageTermsRow } from "@/lib/events/packagesApi";

const api = vi.hoisted(() => ({
  fetchEventPackageTerms: vi.fn(),
  fetchEventPackages: vi.fn(),
  fetchPackageOrders: vi.fn(),
  fetchPackageSeats: vi.fn(),
  saveEventPackage: vi.fn(),
  deleteEventPackage: vi.fn(),
  createPackageOrder: vi.fn(),
  setPackageOrderStatus: vi.fn(),
  invitePackageSeat: vi.fn(),
  revokePackageSeat: vi.fn(),
}));

// `useEventRegistrations` (klucze rejestracji w unieważnieniu) ciągnie klienta
// bazy w imporcie - atrapa wzorcem repozytorium.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/lib/events/packagesApi", () => api);

import { packageKeys, useSaveEventPackage } from "@/lib/events/useEventPackages";
import {
  packageTermsKey,
  packageTermsLookupFrom,
  usePackageTerms,
} from "@/lib/events/usePackageTerms";

const EVENT = "evt-1";
const OTHER_EVENT = "evt-2";

const ROW: EventPackageTermsRow = {
  id: "pkg-1",
  admit_before_payment: false,
  payment_terms_days: 14,
  max_open_orders_per_buyer: 3,
  vat_rate: null,
  vat_exempt_basis: "",
  stripe_tax_code: null,
};

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

const INPUT: EventPackageInput = {
  id: "pkg-1",
  eventId: EVENT,
  key: "gold",
  ticketTypeId: "tt-1",
  namePl: "Złoty",
  nameEn: "Gold",
  descriptionPl: "",
  descriptionEn: "",
  audience: "company",
  seats: 5,
  priceCents: 100_000,
  currency: "PLN",
  quota: null,
  salesFrom: null,
  salesTo: null,
  minTierRank: 0,
  requiresVerification: false,
  isActive: true,
  sortOrder: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

describe("packageTermsKey", () => {
  it("leży w gałęzi wydarzenia i nie zlewa się z innym wydarzeniem", () => {
    expect(packageTermsKey(EVENT).slice(0, packageKeys.event(EVENT).length)).toEqual([
      ...packageKeys.event(EVENT),
    ]);
    expect(packageTermsKey(EVENT)).not.toEqual(packageTermsKey(OTHER_EVENT));
    expect(packageTermsKey(EVENT)).not.toEqual(packageKeys.list(EVENT));
  });
});

describe("packageTermsLookupFrom", () => {
  it("brak danych i brak błędu = wczytywanie", () => {
    expect(packageTermsLookupFrom({ data: undefined, error: null })).toEqual({
      status: "loading",
    });
  });

  it("brak danych i błąd = odczyt padł, z przyczyną dla zdania na ekranie", () => {
    const error = new Error("forbidden");
    expect(packageTermsLookupFrom({ data: undefined, error })).toEqual({
      status: "failed",
      error,
    });
  });

  it("`null` z warstwy danych = baza bez migracji", () => {
    expect(packageTermsLookupFrom({ data: null, error: null })).toEqual({
      status: "unavailable",
    });
  });

  it("dane wygrywają z błędem odświeżenia w tle", () => {
    const byPackage = new Map([[ROW.id, ROW]]);
    expect(packageTermsLookupFrom({ data: byPackage, error: new Error("timeout") })).toEqual({
      status: "ready",
      byPackage,
    });
  });
});

describe("usePackageTerms", () => {
  it("pyta o warunki TEGO wydarzenia i oddaje je jako `ready`", async () => {
    const byPackage = new Map([[ROW.id, ROW]]);
    api.fetchEventPackageTerms.mockResolvedValue(byPackage);

    const { result } = renderHook(() => usePackageTerms(EVENT), { wrapper });
    expect(result.current).toEqual({ status: "loading" });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(api.fetchEventPackageTerms).toHaveBeenCalledWith(EVENT);
    expect(result.current).toEqual({ status: "ready", byPackage });
  });

  it("baza bez migracji daje `unavailable`, awaria - `failed`", async () => {
    api.fetchEventPackageTerms.mockResolvedValueOnce(null);
    const first = renderHook(() => usePackageTerms(EVENT), { wrapper });
    await waitFor(() => expect(first.result.current.status).toBe("unavailable"));

    const error = new Error("forbidden: editor role required");
    api.fetchEventPackageTerms.mockRejectedValueOnce(error);
    const second = renderHook(() => usePackageTerms(OTHER_EVENT), { wrapper });
    await waitFor(() => expect(second.result.current).toEqual({ status: "failed", error }));
  });

  it("zapis pakietu unieważnia warunki - dialog po zapisie nie startuje od starych", async () => {
    api.fetchEventPackageTerms.mockResolvedValue(new Map([[ROW.id, ROW]]));
    api.saveEventPackage.mockResolvedValue("pkg-1");

    const { result } = renderHook(
      () => ({ terms: usePackageTerms(EVENT), save: useSaveEventPackage(EVENT) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.terms.status).toBe("ready"));
    expect(api.fetchEventPackageTerms).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.save.mutateAsync(INPUT);
    });

    // Unieważnienie obejmuje gałąź wydarzenia i całe drzewo pakietów, więc
    // pobrań po zapisie bywa więcej niż jedno - liczy się, że w ogóle są.
    await waitFor(() => expect(api.fetchEventPackageTerms.mock.calls.length).toBeGreaterThan(1));
    expect(api.fetchEventPackageTerms).toHaveBeenLastCalledWith(EVENT);
  });
});
