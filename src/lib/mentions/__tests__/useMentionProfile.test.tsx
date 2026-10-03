// Leniwy podgląd celu wzmianki - `useMentionProfile`.
//
// CO TEN PLIK DOWODZI.
// (1) LENIWOŚĆ JEST KONTRAKTEM. Zamknięty dymek (`enabled: false`) i brak
//     sluga nie wołają RPC - lista z dwudziestoma wzmiankami nie robi
//     dwudziestu wyjść do bazy przy renderze.
// (2) RODZAJ CELU PRZYCHODZI Z BAZY. Firma (`kind: organization`) ma podpis
//     w polu `company` (branża), osoba - w `jobTitle`. Na tym rozróżnieniu
//     `MentionTag` wybiera kartę firmy albo osoby dla nierozwiązanej wzmianki.
// (3) BRAK CELU TO `null`, BŁĄD TO BŁĄD - widok mówi „nie znaleziono" tylko
//     wtedy, gdy baza naprawdę nic nie oddała.
// (4) BEZ DOSTAWCY zapytań dymek i tak działa (klient zapasowy).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock } }));

import { useMentionProfile } from "@/lib/mentions/useMentionProfile";

function wrapper(retry: number | false = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry, retryDelay: 0 } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function row(over: Record<string, unknown> = {}) {
  return {
    kind: "person",
    id: "u1",
    slug: "anna-nowak",
    label: "Anna   Nowak",
    subtitle: "Analityczka - ACME",
    avatar_url: "https://cdn.example/anna.png",
    logo_url: null,
    website: null,
    verified: true,
    ...over,
  };
}

beforeEach(() => rpcMock.mockReset());

describe("useMentionProfile", () => {
  it("zamknięty dymek nie pyta bazy", async () => {
    renderHook(() => useMentionProfile("anna-nowak", "pl", false), { wrapper: wrapper() });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["pusty slug", ""],
  ])("brak sluga (%s) nie pyta bazy nawet przy otwartym dymku", async (_opis, slug) => {
    renderHook(() => useMentionProfile(slug, "pl", true), { wrapper: wrapper() });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("osoba: podpis to stanowisko, białe znaki zwinięte, weryfikacja przeniesiona", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });

    const { result } = renderHook(() => useMentionProfile("anna-nowak", "pl", true), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("get_mention_target", { _slug: "anna-nowak" });
    expect(result.current.data).toEqual({
      kind: "person",
      id: "u1",
      slug: "anna-nowak",
      name: "Anna Nowak",
      avatarUrl: "https://cdn.example/anna.png",
      logoUrl: null,
      jobTitle: "Analityczka - ACME",
      company: null,
      website: null,
      bio: null,
      verified: true,
    });
  });

  it("firma: podpis (branża) ląduje w `company`, a nie w stanowisku", async () => {
    const slug = "org-123e4567-e89b-12d3-a456-426614174000";
    rpcMock.mockResolvedValue({
      data: [
        row({
          kind: "organization",
          label: "ACME Polska",
          subtitle: "Energetyka",
          avatar_url: null,
          logo_url: "https://cdn.example/acme.png",
          website: "https://acme.example",
          verified: false,
        }),
      ],
      error: null,
    });

    const { result } = renderHook(() => useMentionProfile(slug, "pl", true), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      kind: "organization",
      slug,
      name: "ACME Polska",
      logoUrl: "https://cdn.example/acme.png",
      website: "https://acme.example",
      jobTitle: null,
      company: "Energetyka",
      verified: false,
    });
  });

  it("bez etykiety nazwą jest slug; nieznany rodzaj traktujemy jak osobę", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ kind: "bot", label: "   ", subtitle: null, verified: "yes" })],
      error: null,
    });

    const { result } = renderHook(() => useMentionProfile("anna-nowak", "pl", true), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      kind: "person",
      name: "anna-nowak",
      jobTitle: null,
      // Tylko jawne `true` jest weryfikacją - napis „yes" nią nie jest.
      verified: false,
    });
  });

  it("pusty wynik to `null` (nie znaleziono), nie błąd", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useMentionProfile("nikt", "pl", true), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("`data: null` z RPC też jest brakiem celu", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useMentionProfile("nikt", "pl", true), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("błąd RPC jest błędem zapytania - bez ponawiania", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("boom") });

    // Klient z WŁĄCZONYM ponawianiem (jak w aplikacji: `retry: 1` w routerze) -
    // jedno wywołanie może wynikać wyłącznie z `retry: false` samego haka.
    const { result } = renderHook(() => useMentionProfile("anna-nowak", "pl", true), {
      wrapper: wrapper(3),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("bez dostawcy zapytań dymek i tak dociąga cel", async () => {
    rpcMock.mockResolvedValue({ data: [row({ slug: "solo" })], error: null });

    const { result } = renderHook(() => useMentionProfile("solo-bez-dostawcy", "pl", true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ slug: "solo-bez-dostawcy", name: "Anna Nowak" });
  });
});
