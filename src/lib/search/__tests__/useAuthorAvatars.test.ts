// Avatary autorów w podpowiedziach (widget nagłówka, autosuggest /search,
// overlay). Hook nie miał własnego testu - pokrywały go uboczem testy
// komponentów, które zawsze odpowiadały sukcesem, więc nikt nie widział, że
// odmowa bazy zapisywała `null` dla każdego id NA STAŁE (brak ponownej próby),
// a zerwane połączenie kończyło się nieobsłużonym odrzuceniem obietnicy.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { AutosuggestItem } from "@/lib/queries/archives";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";

const stubs = vi.hoisted(() => ({ from: null as ReturnType<typeof supabaseFromStub> | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub: make } = await import("@/test/supabaseChain");
  const from = make();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import { useAuthorAvatars } from "@/lib/search/useAuthorAvatars";

const author = (id: string): AutosuggestItem => ({
  kind: "author",
  id,
  slug: id,
  label_pl: id,
  label_en: id,
  parentPageId: null,
  score: 0,
});

const fetches = () => stubs.from!.chainsFor("profiles_public");

beforeEach(() => {
  stubs.from!.reset();
});

describe("useAuthorAvatars", () => {
  it("dociąga avatary JEDNYM zapytaniem dla unikalnych autorów", async () => {
    stubs.from!.setResponse("profiles_public", ok([{ id: "a", avatar_url: "https://x/a.png" }]));
    const items = [author("a"), author("a"), author("b")];
    const { result } = renderHook(() => useAuthorAvatars(items));
    await waitFor(() => expect(result.current).toEqual({ a: "https://x/a.png", b: null }));
    expect(fetches()).toHaveLength(1);
    expect(fetches()[0].argsOf("in")).toEqual(["id", ["a", "b"]]);
  });

  it("wiersze inne niż autor (i autor bez id) nie generują zapytania", async () => {
    stubs.from!.setResponse("profiles_public", ok([]));
    const items: AutosuggestItem[] = [
      { ...author("x"), kind: "post" },
      { ...author("y"), id: null },
    ];
    renderHook(() => useAuthorAvatars(items));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetches()).toHaveLength(0);
  });

  it("autor już znany NIE jest pobierany ponownie przy nowej liście podpowiedzi", async () => {
    stubs.from!.setResponse("profiles_public", ok([{ id: "a", avatar_url: null }]));
    const { result, rerender } = renderHook(({ items }) => useAuthorAvatars(items), {
      initialProps: { items: [author("a")] },
    });
    await waitFor(() => expect(result.current).toEqual({ a: null }));
    rerender({ items: [author("a")] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetches()).toHaveLength(1);
  });

  it("ODMOWA bazy nie zapisuje „brak avatara” - następna lista próbuje ponownie", async () => {
    stubs.from!.setResponse("profiles_public", fail("permission denied"));
    const { result, rerender } = renderHook(({ items }) => useAuthorAvatars(items), {
      initialProps: { items: [author("a")] },
    });
    await waitFor(() => expect(fetches()).toHaveLength(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual({});
    stubs.from!.setResponse("profiles_public", ok([{ id: "a", avatar_url: "https://x/a.png" }]));
    rerender({ items: [author("a")] });
    await waitFor(() => expect(result.current).toEqual({ a: "https://x/a.png" }));
    expect(fetches()).toHaveLength(2);
  });

  it("ZERWANE połączenie nie jest nieobsłużonym odrzuceniem i nie psuje stanu", async () => {
    stubs.from!.setResponse("profiles_public", () => {
      throw new Error("Failed to fetch");
    });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { result } = renderHook(() => useAuthorAvatars([author("a")]));
      await waitFor(() => expect(fetches()).toHaveLength(1));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(result.current).toEqual({});
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("odpowiedź, która wróci po odmontowaniu, nie ustawia stanu (anulowanie)", async () => {
    stubs.from!.setResponse("profiles_public", ok([{ id: "a", avatar_url: "https://x/a.png" }]));
    const { result, unmount } = renderHook(() => useAuthorAvatars([author("a")]));
    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetches()).toHaveLength(1);
    expect(result.current).toEqual({});
  });
});
