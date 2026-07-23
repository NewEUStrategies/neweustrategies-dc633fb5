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
    label_pl: "Jan Kowalski",
    label_en: "Jan Kowalski",
    sublabel_pl: "Analityk",
    sublabel_en: "Analyst",
    avatar_url: "https://cdn/jan.png",
    logo_url: null,
    verified: true,
    post_count: 3,
    score: 1,
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

  it("passes the query + limit and returns only persons with a slug", async () => {
    rpcMock.mockResolvedValue({
      data: [
        personRow(),
        { ...personRow({ kind: "organization", id: "o1", slug: "acme" }) },
        { ...personRow({ id: "u2", slug: "" }) }, // slug-less -> dropped
      ],
      error: null,
    });
    const { result } = renderHook(() => useMentionSuggestions("jan", "pl"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(rpcMock).toHaveBeenCalledWith("search_people_orgs", {
      _q: "jan",
      _limit: MENTION_SUGGESTION_LIMIT,
    });
    expect(result.current.data?.[0]).toEqual({
      slug: "jan-kowalski",
      name: "Jan Kowalski",
      avatarUrl: "https://cdn/jan.png",
      subtitle: "Analityk",
    });
  });

  it("selects the EN label + subtitle for lang=en", async () => {
    rpcMock.mockResolvedValue({ data: [personRow()], error: null });
    const { result } = renderHook(() => useMentionSuggestions("jan", "en"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(result.current.data?.[0].subtitle).toBe("Analyst");
  });

  it("omits _q when the query is empty (top people on a bare @)", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useMentionSuggestions("", "pl"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(rpcMock).toHaveBeenCalledWith("search_people_orgs", {
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
