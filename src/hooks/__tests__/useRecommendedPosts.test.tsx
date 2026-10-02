// Rekomendacje „dla ciebie" - jedna ścieżka dla gościa i zalogowanego
// (`get_recommended_posts_v2`).
//
// PO CO. Hak stał na zerze, a zasila dwie powierzchnie (sekcja listy lektur,
// widżet „must reads"). Reguły, których pilnuje ten plik:
//   1. TOŻSAMOŚĆ PRZED KLUCZEM. Przy `loading` kontekst oddaje `user: null`;
//      zapytanie puszczone wtedy policzyłoby zalogowanego jako gościa i zaraz
//      potem drugi raz - stąd wstrzymanie do rozstrzygnięcia.
//   2. ZAINTERESOWANIA Z URZĄDZENIA WYŁĄCZNIE DLA GOŚCIA. Zalogowanemu funkcja
//      bierze obserwowane z `auth.uid()`; doklejenie lokalnych tablic
//      mieszałoby profil konta z cudzym stanem przeglądarki.
//   3. KORZEŃ KLUCZA = `WIDGET_QUERY_ROOTS.recommendedPosts`. W ten literał
//      celują inwalidacje po zmianie zainteresowań i obserwowanych - inny
//      korzeń znaczyłby listę, która po kliknięciu „obserwuj" się nie zmienia.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";

interface RpcResult {
  data: unknown[] | null;
  error: Error | null;
}

const h = vi.hoisted(() => ({
  rpc: vi.fn<(fn: string, args: Record<string, unknown>) => Promise<RpcResult>>(),
  anon: vi.fn<() => { categoryIds: string[]; tagIds: string[] }>(),
  auth: { user: null as { id: string } | null, loading: false },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => h.rpc(fn, args) },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/personalization/anonMerge", () => ({
  readAnonInterestIds: () => h.anon(),
}));

import { useRecommendedPosts } from "@/hooks/useRecommendedPosts";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";

const POLECANY = {
  id: "p1",
  slug: "analiza",
  title_pl: "Analiza",
  title_en: "Analysis",
  excerpt_pl: "Skrót",
  excerpt_en: "Excerpt",
  cover_image_url: "",
  parent_page_id: "strona",
  author_id: "a1",
  published_at: "2026-07-01T12:00:00Z",
  reasons: ["author"],
  score: 4.5,
};

beforeEach(() => {
  h.rpc.mockReset().mockResolvedValue({ data: [POLECANY], error: null });
  h.anon.mockReset().mockReturnValue({ categoryIds: ["kat-1"], tagIds: ["tag-1", "tag-2"] });
  h.auth = { user: null, loading: false };
});

describe("useRecommendedPosts", () => {
  it("GOŚĆ: zainteresowania z urządzenia jadą parametrami, domyślnie 9 pozycji", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useRecommendedPosts());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("get_recommended_posts_v2", {
      p_limit: 9,
      p_offset: 0,
      p_category_ids: ["kat-1"],
      p_tag_ids: ["tag-1", "tag-2"],
    });
    expect(result.current.data).toEqual([POLECANY]);
    expect(queryClient.getQueryData([WIDGET_QUERY_ROOTS.recommendedPosts, "anon", 9])).toEqual([
      POLECANY,
    ]);
  });

  it("ZALOGOWANY: puste tablice, bez czytania stanu przeglądarki, klucz pod jego id", async () => {
    h.auth = { user: { id: "u1" }, loading: false };

    const { result, queryClient } = renderHookWithQueryClient(() => useRecommendedPosts(4));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("get_recommended_posts_v2", {
      p_limit: 4,
      p_offset: 0,
      p_category_ids: [],
      p_tag_ids: [],
    });
    expect(h.anon).not.toHaveBeenCalled();
    expect(queryClient.getQueryData([WIDGET_QUERY_ROOTS.recommendedPosts, "u1", 4])).toEqual([
      POLECANY,
    ]);
  });

  it("NIEUSTALONA tożsamość wstrzymuje zapytanie, zamiast liczyć je jako gość", async () => {
    h.auth = { user: null, loading: true };

    const { result, rerender } = renderHookWithQueryClient(() => useRecommendedPosts());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");

    h.auth = { user: { id: "u1" }, loading: false };
    rerender();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.lastCall?.[1]).toMatchObject({ p_category_ids: [], p_tag_ids: [] });
  });

  it("`enabled: false` od konsumenta wstrzymuje odczyt mimo znanej tożsamości", async () => {
    const { result } = renderHookWithQueryClient(() => useRecommendedPosts(9, { enabled: false }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(h.rpc).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("błąd RPC trafia do stanu zapytania - konsument pokazuje błąd z ponowieniem", async () => {
    const awaria = new Error("get_recommended_posts_v2: 500");
    h.rpc.mockResolvedValue({ data: null, error: awaria });

    const { result } = renderHookWithQueryClient(() => useRecommendedPosts());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(awaria);
    expect(result.current.data).toBeUndefined();
  });

  it("`data: null` z RPC to pusta lista, a nie wywrotka konsumenta", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHookWithQueryClient(() => useRecommendedPosts());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
