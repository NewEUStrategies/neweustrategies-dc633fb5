import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock } }));

import {
  useMentionSuggestions,
  MENTION_SUGGESTION_LIMIT,
} from "@/lib/mentions/useMentionSuggestions";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function personRow(over: Record<string, unknown> = {}) {
  return {
    kind: "person",
    id: "u1",
    slug: "jan-kowalski",
    label: "Jan Kowalski",
    subtitle: "Analityk",
    avatar_url: "https://cdn/jan.png",
    logo_url: null,
    website: null,
    verified: true,
    score: 1,
    ...over,
  };
}

function organizationRow(over: Record<string, unknown> = {}) {
  return {
    kind: "organization",
    id: "o1",
    slug: "org-acme",
    label: "ACME Europe",
    subtitle: "Energy",
    avatar_url: null,
    logo_url: "https://cdn/acme.png",
    website: "https://acme.example",
    verified: false,
    score: 0.8,
    ...over,
  };
}

beforeEach(() => rpcMock.mockReset());

describe("useMentionSuggestions", () => {
  it("does not query when there is no active mention (query null)", async () => {
    renderHook(() => useMentionSuggestions(null, "pl"), { wrapper: wrapper() });
    // enabled:false -> RPC never fires (no member enumeration on idle caret).
    await new Promise((r) => setTimeout(r, 20));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the query + limit and returns people and organizations with a slug", async () => {
    rpcMock.mockResolvedValue({
      data: [
        personRow(),
        organizationRow(),
        { ...personRow({ id: "u2", slug: "" }) }, // slug-less -> dropped
      ],
      error: null,
    });
    const { result } = renderHook(() => useMentionSuggestions("jan", "pl"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.length).toBe(2));
    expect(rpcMock).toHaveBeenCalledWith("search_mention_targets", {
      _q: "jan",
      _limit: MENTION_SUGGESTION_LIMIT,
    });
    expect(result.current.data?.[0]).toEqual({
      kind: "person",
      slug: "jan-kowalski",
      name: "Jan Kowalski",
      avatarUrl: "https://cdn/jan.png",
      logoUrl: null,
      website: null,
      subtitle: "Analityk",
      verified: true,
    });
    expect(result.current.data?.[1]).toEqual({
      kind: "organization",
      slug: "org-acme",
      name: "ACME Europe",
      avatarUrl: null,
      logoUrl: "https://cdn/acme.png",
      website: "https://acme.example",
      subtitle: "Energy",
      verified: false,
    });
  });

  it("keeps the safe RPC label + subtitle for lang=en", async () => {
    rpcMock.mockResolvedValue({ data: [personRow()], error: null });
    const { result } = renderHook(() => useMentionSuggestions("jan", "en"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(result.current.data?.[0].subtitle).toBe("Analityk");
  });

  it("omits _q when the query is empty (top people on a bare @)", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useMentionSuggestions("", "pl"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(rpcMock).toHaveBeenCalledWith("search_mention_targets", {
      _q: undefined,
      _limit: MENTION_SUGGESTION_LIMIT,
    });
  });

  it("degrades to an empty list when the RPC errors (pre-migration / network)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "missing function" } });
    const { result } = renderHook(() => useMentionSuggestions("x", "pl"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});
