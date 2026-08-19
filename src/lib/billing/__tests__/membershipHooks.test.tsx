// Hooki warstwy członkostwa - druga połowa 21 funkcji `membership.ts`.
//
// Same zapytania mają test obok (`membership.test.ts`); tu chodzi o rzeczy,
// które widać wyłącznie w hookach, a które decydują o poprawności ekranu:
//
//   1. IZOLACJA CACHE'U MIĘDZY KONTAMI. Klucz każdego zapytania nosi
//      identyfikator użytkownika. Bez tego po przelogowaniu drugi klient
//      zobaczyłby nadania i darowizny pierwszego z cache'u.
//   2. ZAPYTANIE JEST WYŁĄCZONE BEZ SESJI. Gość nie ma czego pytać, a włączone
//      zapytanie generowałoby żądanie 401 na każdym wejściu na stronę.
//   3. ODBIÓR MIEJSC ODŚWIEŻA WARSTWĘ TYLKO WTEDY, GDY COŚ ODEBRANO.
//      Bezwarunkowe unieważnianie po każdym wejściu na profil kasowałoby cache
//      uprawnień w pętli.
//   4. DODANIE I USUNIĘCIE MIEJSCA unieważnia listę miejsc ORAZ organizację -
//      licznik „wykorzystane / limit" jest częścią organizacji, nie listy.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { membershipGrant } from "@/test/billing/fixtures";

const h = vi.hoisted(() => ({
  user: { current: { id: "user-me" } as { id: string } | null },
  rpc: vi.fn(),
  chain: null as ReturnType<typeof import("@/test/supabaseChain").supabaseFromStub> | null,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user.current }) }));

vi.mock("@/lib/auth/currentUser", () => ({
  currentUserIdFromSession: () => Promise.resolve(h.user.current?.id ?? null),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.chain!.from(table),
    rpc: (fn: string, args?: Record<string, unknown>) => h.rpc(fn, args),
  },
}));

import {
  useAddSeat,
  useClaimOrgSeats,
  useMyDonations,
  useMyEventParticipation,
  useMyGrants,
  useMyOrganization,
  useMyResourceDownloads,
  useOrgSeats,
  useRemoveSeat,
} from "@/lib/billing/membership";

function harness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** Klucze zapytań, jakie hook zarejestrował w cache'u. */
const cacheKeys = (queryClient: QueryClient): string[] =>
  queryClient
    .getQueryCache()
    .getAll()
    .map((entry) => JSON.stringify(entry.queryKey));

beforeEach(() => {
  h.user.current = { id: "user-me" };
  h.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  h.chain = supabaseFromStub();
  h.chain.setResponse("membership_grants", ok([membershipGrant()]));
  h.chain.setResponse("donations", ok([]));
  h.chain.setResponse("organization_seats", ok([]));
});

describe("IZOLACJA CACHE'U między kontami", () => {
  it("klucz nadań nosi identyfikator użytkownika", async () => {
    const { queryClient, wrapper } = harness();

    renderHook(() => useMyGrants(), { wrapper });

    await waitFor(() => expect(cacheKeys(queryClient).length).toBeGreaterThan(0));
    expect(cacheKeys(queryClient)[0]).toContain("user-me");
  });

  it("dwa konta dostają DWA różne klucze, nie jeden wspólny", async () => {
    const { queryClient, wrapper } = harness();
    renderHook(() => useMyGrants(), { wrapper });
    await waitFor(() => expect(cacheKeys(queryClient)).toHaveLength(1));

    h.user.current = { id: "user-other" };
    renderHook(() => useMyGrants(), { wrapper });

    await waitFor(() => expect(cacheKeys(queryClient)).toHaveLength(2));
    expect(new Set(cacheKeys(queryClient)).size).toBe(2);
  });

  it("klucz darowizn też jest per konto", async () => {
    const { queryClient, wrapper } = harness();

    renderHook(() => useMyDonations(), { wrapper });

    await waitFor(() => expect(cacheKeys(queryClient).length).toBeGreaterThan(0));
    expect(cacheKeys(queryClient)[0]).toContain("user-me");
  });

  it("historia uczestnictwa i pobrań również", async () => {
    const { queryClient, wrapper } = harness();

    renderHook(() => useMyEventParticipation(), { wrapper });
    renderHook(() => useMyResourceDownloads(), { wrapper });

    await waitFor(() => expect(cacheKeys(queryClient)).toHaveLength(2));
    expect(cacheKeys(queryClient).every((key) => key.includes("user-me"))).toBe(true);
  });
});

describe("BEZ SESJI zapytania są wyłączone", () => {
  it("nadania: gość nie pyta bazy", async () => {
    h.user.current = null;
    const { wrapper } = harness();

    const { result } = renderHook(() => useMyGrants(), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(h.chain!.chains).toHaveLength(0);
  });

  it("darowizny: gość nie pyta bazy", async () => {
    h.user.current = null;
    const { wrapper } = harness();

    renderHook(() => useMyDonations(), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.chain!.chainsFor("donations")).toHaveLength(0);
  });

  it("organizacja: gość nie woła RPC", async () => {
    h.user.current = null;
    const { wrapper } = harness();

    renderHook(() => useMyOrganization(), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("miejsca organizacji: bez identyfikatora organizacji zapytanie nie startuje", async () => {
    const { wrapper } = harness();

    renderHook(() => useOrgSeats(null), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.chain!.chainsFor("organization_seats")).toHaveLength(0);
  });

  it("z identyfikatorem organizacji zapytanie startuje", async () => {
    const { wrapper } = harness();

    renderHook(() => useOrgSeats("org-1"), { wrapper });

    await waitFor(() => expect(h.chain!.chainsFor("organization_seats")).toHaveLength(1));
    expect(h.chain!.lastChain("organization_seats")!.argsOf("eq")).toEqual(["org_id", "org-1"]);
  });
});

describe("useMyGrants - odczyt", () => {
  it("oddaje nadania z bazy", async () => {
    const { wrapper } = harness();

    const { result } = renderHook(() => useMyGrants(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].tier_key).toBe("member");
  });

  it("błąd odczytu trafia do stanu hooka, nie w pustkę", async () => {
    h.chain!.setResponse("membership_grants", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });
    const { wrapper } = harness();

    const { result } = renderHook(() => useMyGrants(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe("useAddSeat / useRemoveSeat - zarządzanie miejscami", () => {
  it("dodanie miejsca idzie przez RPC z rolą „member”", async () => {
    h.rpc.mockResolvedValue({ data: "seat-1", error: null });
    const { wrapper } = harness();

    const { result } = renderHook(() => useAddSeat("org-1"), { wrapper });
    await result.current.mutateAsync("nowy@example.test");

    expect(h.rpc).toHaveBeenCalledWith("org_add_seat", {
      p_org: "org-1",
      p_email: "nowy@example.test",
      p_role: "member",
    });
  });

  it("dodanie miejsca ODŚWIEŻA listę miejsc I organizację (licznik limitu)", async () => {
    h.rpc.mockResolvedValue({ data: "seat-1", error: null });
    const { queryClient, wrapper } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useAddSeat("org-1"), { wrapper });
    await result.current.mutateAsync("nowy@example.test");

    await waitFor(() => expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(2));
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]));
    expect(keys.some((key) => key.includes("org-1"))).toBe(true);
  });

  it("ODRZUCONE dodanie miejsca (limit) zgłasza błąd, nie udaje sukcesu", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("seats_limit_reached") });
    const { wrapper } = harness();

    const { result } = renderHook(() => useAddSeat("org-1"), { wrapper });

    await expect(result.current.mutateAsync("nowy@example.test")).rejects.toThrow(
      "seats_limit_reached",
    );
  });

  it("usunięcie miejsca celuje w konkretny wiersz", async () => {
    h.chain!.setResponse("organization_seats", ok(null));
    const { wrapper } = harness();

    const { result } = renderHook(() => useRemoveSeat("org-1"), { wrapper });
    await result.current.mutateAsync("seat-7");

    const chain = h.chain!.lastChain("organization_seats")!;
    expect(chain.has("delete")).toBe(true);
    expect(chain.argsOf("eq")).toEqual(["id", "seat-7"]);
  });

  it("nieudane usunięcie miejsca zgłasza błąd", async () => {
    h.chain!.setResponse("organization_seats", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });
    const { wrapper } = harness();

    const { result } = renderHook(() => useRemoveSeat("org-1"), { wrapper });

    await expect(result.current.mutateAsync("seat-7")).rejects.toThrow("permission denied");
  });
});

describe("useClaimOrgSeats - odbiór zaproszeń po zalogowaniu", () => {
  it("woła RPC odbioru miejsc dla zalogowanego", async () => {
    h.rpc.mockResolvedValue({ data: 0, error: null });
    const { wrapper } = harness();

    renderHook(() => useClaimOrgSeats(), { wrapper });

    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("claim_my_org_seats", undefined));
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("gość nie woła RPC wcale", async () => {
    h.user.current = null;
    const { wrapper } = harness();

    renderHook(() => useClaimOrgSeats(), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("ZERO ODEBRANYCH MIEJSC nie unieważnia warstwy uprawnień", async () => {
    h.rpc.mockResolvedValue({ data: 0, error: null });
    const { queryClient, wrapper } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useClaimOrgSeats(), { wrapper });

    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("ODEBRANE MIEJSCE odświeża warstwę i organizację", async () => {
    h.rpc.mockResolvedValue({ data: 2, error: null });
    const { queryClient, wrapper } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useClaimOrgSeats(), { wrapper });

    await waitFor(() => expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(h.rpc).toHaveBeenCalledWith("claim_my_org_seats", undefined);
  });

  it("brak liczby w odpowiedzi jest traktowany jako zero, nie jako sukces", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    const { queryClient, wrapper } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useClaimOrgSeats(), { wrapper });

    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    expect(invalidate).not.toHaveBeenCalled();
  });
});
