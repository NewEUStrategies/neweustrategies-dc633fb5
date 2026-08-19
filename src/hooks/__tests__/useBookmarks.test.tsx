// Zapisane artykuły - warstwa danych. Stan wyjściowy: 0 z 2 funkcji.
//
// Trzy reguły, których złamanie widzi użytkownik (albo INNY użytkownik):
//
//   1. ZAPIS JEST ZAWĘŻONY DO WŁAŚCICIELA. Usunięcie zakładki filtruje po
//      `user_id` ORAZ po bycie - grant DELETE na `user_bookmarks` ma
//      `authenticated`, nie tylko właściciela wiersza, więc to `.eq()` jest tym,
//      co powstrzymuje usunięcie CUDZEJ zakładki.
//   2. DUPLIKAT NIE JEST BŁĘDEM. Dwa kliknięcia w „zapisz" (albo dwie karty
//      przeglądarki) trafiają w unikat bazy; użytkownik ma zobaczyć zapisany
//      artykuł, nie komunikat awarii.
//   3. CACHE JEST IZOLOWANY PER KONTO. Klucz niesie `user.id`, więc lista
//      zapisanych jednego konta nie może wyciec do drugiego po przelogowaniu.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ user: null as { id: string } | null }));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

// Fabryka atrapy importuje WYŁĄCZNIE moduł bez zależności produkcyjnych -
// patrz komentarz w `src/test/postExperience/fixtures.ts`.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));

import { useBookmarks, useToggleBookmark, type Bookmark } from "@/hooks/useBookmarks";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { POST_IDS } from "@/test/postExperience/fixtures";

const from = () => stubs.from as SupabaseFromStub;

function harness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function bookmarkRow(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "bm-1",
    entity_type: "post",
    entity_id: POST_IDS.post,
    created_at: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  from().reset();
  h.user = { id: POST_IDS.user };
});

describe("useBookmarks - odczyt listy zapisanych", () => {
  it("czyta zakładki zalogowanego użytkownika, najnowsze na górze", async () => {
    from().setResponse("user_bookmarks", ok([bookmarkRow(), bookmarkRow({ id: "bm-2" })]));
    const { wrapper } = harness();

    const { result } = renderHook(() => useBookmarks(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(from().lastChain("user_bookmarks")?.argsOf("order")).toEqual([
      "created_at",
      { ascending: false },
    ]);
  });

  it("czyta tylko kolumny, których potrzebuje lista (bez PII i bez `*`)", async () => {
    from().setResponse("user_bookmarks", ok([]));
    const { wrapper } = harness();

    const { result } = renderHook(() => useBookmarks(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from().lastChain("user_bookmarks")?.argsOf("select")).toEqual([
      "id, entity_type, entity_id, created_at",
    ]);
  });

  it("GOŚĆ nie odpytuje bazy w ogóle (zapytanie wyłączone)", async () => {
    h.user = null;
    const { wrapper } = harness();

    const { result } = renderHook(() => useBookmarks(), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(from().chainsFor("user_bookmarks")).toHaveLength(0);
  });

  it("CACHE JEST IZOLOWANY PER KONTO - klucz niesie identyfikator użytkownika", async () => {
    from().setResponse("user_bookmarks", ok([bookmarkRow()]));
    const { wrapper, queryClient } = harness();

    const { result } = renderHook(() => useBookmarks(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(queryClient.getQueryData(["bookmarks", POST_IDS.user])).toHaveLength(1);
    expect(queryClient.getQueryData(["bookmarks", POST_IDS.author])).toBeUndefined();
  });

  it("BŁĄD ODCZYTU jest zgłaszany, nie ukrywany jako pusta lista", async () => {
    from().setResponse("user_bookmarks", fail("permission denied for table user_bookmarks"));
    const { wrapper } = harness();

    const { result } = renderHook(() => useBookmarks(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("`data: null` z bazy degraduje do pustej listy, nie do null w interfejsie", async () => {
    from().setResponse("user_bookmarks", ok(null));
    const { wrapper } = harness();

    const { result } = renderHook(() => useBookmarks(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useToggleBookmark - dodanie", () => {
  it("wstawia wiersz ze WŁASNYM `user_id`, typem i identyfikatorem bytu", async () => {
    from().setResponse("user_bookmarks", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useToggleBookmark(), { wrapper });

    await result.current.mutateAsync({ entityType: "post", entityId: POST_IDS.post, on: true });

    expect(from().lastChain("user_bookmarks")?.argsOf("insert")?.[0]).toEqual({
      user_id: POST_IDS.user,
      entity_type: "post",
      entity_id: POST_IDS.post,
    });
    expect(from().lastChain("user_bookmarks")?.has("delete")).toBe(false);
  });

  it("DUPLIKAT nie jest błędem - drugi klik zostawia artykuł zapisany", async () => {
    from().setResponse(
      "user_bookmarks",
      fail('duplicate key value violates unique constraint "user_bookmarks_pkey"'),
    );
    const { wrapper } = harness();
    const { result } = renderHook(() => useToggleBookmark(), { wrapper });

    await expect(
      result.current.mutateAsync({ entityType: "post", entityId: POST_IDS.post, on: true }),
    ).resolves.toBeUndefined();
    expect(from().lastChain("user_bookmarks")?.has("insert")).toBe(true);
  });

  it("INNY błąd wstawienia JEST zgłaszany (nie każdy błąd to duplikat)", async () => {
    from().setResponse("user_bookmarks", fail("new row violates row-level security policy"));
    const { wrapper } = harness();
    const { result } = renderHook(() => useToggleBookmark(), { wrapper });

    await expect(
      result.current.mutateAsync({ entityType: "post", entityId: POST_IDS.post, on: true }),
    ).rejects.toThrow(/row-level security/);
    expect(from().chainsFor("user_bookmarks")).toHaveLength(1);
  });

  it("obsługuje też byt typu `page`, nie tylko wpis", async () => {
    from().setResponse("user_bookmarks", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useToggleBookmark(), { wrapper });

    await result.current.mutateAsync({ entityType: "page", entityId: "page-7", on: true });

    expect(from().lastChain("user_bookmarks")?.argsOf("insert")?.[0]).toMatchObject({
      entity_type: "page",
      entity_id: "page-7",
    });
    expect(from().chainsFor("user_bookmarks")).toHaveLength(1);
  });
});

describe("useToggleBookmark - usunięcie", () => {
  it("USUWA WYŁĄCZNIE WŁASNY wiersz: filtr po user_id, typie i bycie", async () => {
    from().setResponse("user_bookmarks", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useToggleBookmark(), { wrapper });

    await result.current.mutateAsync({ entityType: "post", entityId: POST_IDS.post, on: false });

    const chain = from().lastChain("user_bookmarks");
    expect(chain?.has("delete")).toBe(true);
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["user_id", POST_IDS.user],
      ["entity_type", "post"],
      ["entity_id", POST_IDS.post],
    ]);
  });

  it("BŁĄD USUNIĘCIA jest zgłaszany (przycisk nie może kłamać o stanie)", async () => {
    from().setResponse("user_bookmarks", fail("permission denied"));
    const { wrapper } = harness();
    const { result } = renderHook(() => useToggleBookmark(), { wrapper });

    await expect(
      result.current.mutateAsync({ entityType: "post", entityId: POST_IDS.post, on: false }),
    ).rejects.toThrow(/permission denied/);
    expect(from().lastChain("user_bookmarks")?.has("delete")).toBe(true);
  });
});

describe("useToggleBookmark - warunki brzegowe", () => {
  it("GOŚĆ nie zapisuje niczego: mutacja rzuca i nie dotyka bazy", async () => {
    h.user = null;
    const { wrapper } = harness();
    const { result } = renderHook(() => useToggleBookmark(), { wrapper });

    await expect(
      result.current.mutateAsync({ entityType: "post", entityId: POST_IDS.post, on: true }),
    ).rejects.toThrow(/Not authenticated/);
    expect(from().chainsFor("user_bookmarks")).toHaveLength(0);
  });

  it("sukces unieważnia listę zapisanych TEGO konta", async () => {
    from().setResponse("user_bookmarks", ok(null));
    const { wrapper, queryClient } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useToggleBookmark(), { wrapper });

    await result.current.mutateAsync({ entityType: "post", entityId: POST_IDS.post, on: true });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["bookmarks", POST_IDS.user] }),
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("PORAŻKA nie unieważnia cache (lista nie mruga bez powodu)", async () => {
    from().setResponse("user_bookmarks", fail("permission denied"));
    const { wrapper, queryClient } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useToggleBookmark(), { wrapper });

    await expect(
      result.current.mutateAsync({ entityType: "post", entityId: POST_IDS.post, on: true }),
    ).rejects.toThrow();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
