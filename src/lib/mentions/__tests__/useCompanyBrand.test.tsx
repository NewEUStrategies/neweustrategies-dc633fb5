// Marka firmy do dymka przy nazwie firmy - `useCompanyBrand`.
//
// CO TEN PLIK DOWODZI.
// (1) LENIWIE: zapytanie rusza dopiero po otwarciu dymka i tylko dla
//     niepustej nazwy.
// (2) DOPASOWANIE PO NAZWIE przez `crm_company_brand` - jedyne publiczne
//     wejście do kartoteki; oddaje wyłącznie markę (nazwa, logo, strona, branża).
// (3) BRAK TRAFIENIA TO `null`, nie błąd - firma wpisana ręcznie w profilu
//     zwykle nie ma karty w CRM. Puste pola marki są brakiem, nie wartością.
// (4) BEZ DOSTAWCY zapytań bylina i tak działa (klient zapasowy).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock } }));

import { useCompanyBrand } from "@/lib/mentions/useCompanyBrand";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => rpcMock.mockReset());

describe("useCompanyBrand", () => {
  it.each([
    ["zamknięty dymek", "ACME", false],
    ["brak nazwy", null, true],
    ["pusta nazwa", "", true],
  ])("%s - nie pyta kartoteki", async (_opis, name, enabled) => {
    renderHook(() => useCompanyBrand(name, enabled), { wrapper: wrapper() });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("mapuje markę i zwija białe znaki", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          name: " ACME   Polska ",
          logo_url: "https://cdn.example/acme.png",
          website: "https://acme.example",
          branch: "Energetyka",
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useCompanyBrand("ACME", true), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("crm_company_brand", { p_name: "ACME" });
    expect(result.current.data).toEqual({
      name: "ACME Polska",
      logoUrl: "https://cdn.example/acme.png",
      website: "https://acme.example",
      branch: "Energetyka",
    });
  });

  it("puste pola marki są brakiem; bez nazwy z kartoteki zostaje nazwa z profilu", async () => {
    rpcMock.mockResolvedValue({
      data: [{ name: "  ", logo_url: "", website: null, branch: 42 }],
      error: null,
    });

    const { result } = renderHook(() => useCompanyBrand("ACME", true), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      name: "ACME",
      logoUrl: null,
      website: null,
      branch: null,
    });
  });

  it.each([
    ["pusta lista", []],
    ["`null`", null],
  ])("brak trafienia (%s) to `null`, nie błąd", async (_opis, data) => {
    rpcMock.mockResolvedValue({ data, error: null });

    const { result } = renderHook(() => useCompanyBrand("Firma Spoza CRM", true), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("błąd RPC jest błędem zapytania - bez ponawiania", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("boom") });

    const { result } = renderHook(() => useCompanyBrand("ACME", true), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("bez dostawcy zapytań bylina i tak dociąga markę", async () => {
    rpcMock.mockResolvedValue({ data: [{ name: "Solo" }], error: null });

    const { result } = renderHook(() => useCompanyBrand("Solo bez dostawcy", true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ name: "Solo" });
  });
});
