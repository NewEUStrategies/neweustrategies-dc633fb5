// Reputacja zawodowa i widoczność profilu: poparcia umiejętności,
// wprowadzenia (requester -> bridge -> target), „kto oglądał profil" oraz
// rekomendacje. Kontrakt z bazą (nazwy i czasowniki RPC) jest tu równie ważny
// jak zachowanie UI - rozjazd słownika akcji już raz kosztował moduł
// rekomendacji ciche „sukcesy" przy zerowej zmianie stanu (patrz nagłówek
// useRecommendations.ts).
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type RpcResult = { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  user: { current: "user-a" as string | null },
  rpc: vi.fn(),
  profileRow: { current: { profile_view_mode: "public" } as Record<string, unknown> | null },
  profileError: { current: null as { message: string } | null },
  updates: [] as Array<{ patch: Record<string, unknown>; id: string }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  // Minimalna atrapa buildera PostgREST: tylko ścieżki, których używa moduł
  // (select -> eq -> maybeSingle, update -> eq).
  const from = (table: string) => ({
    select: (_columns: string) => ({
      eq: (_column: string, _value: string) => ({
        maybeSingle: () =>
          Promise.resolve({ data: h.profileRow.current, error: h.profileError.current }),
      }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: (_column: string, value: string) => {
        h.updates.push({ patch, id: value });
        expect(table).toBe("profiles");
        return Promise.resolve({ data: null, error: h.profileError.current });
      },
    }),
  });
  return {
    supabase: {
      rpc: (fn: string, args?: Record<string, unknown>): Promise<RpcResult> => h.rpc(fn, args),
      from,
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user.current ? { id: h.user.current } : null }),
}));

import { useSkillEndorsements, useToggleEndorsement } from "../useEndorsements";
import {
  INTRO_MESSAGE_MAX,
  INTRO_MESSAGE_MIN,
  useMyIntroductions,
  useRequestIntroduction,
  useRespondIntroduction,
} from "../useIntroductions";
import {
  useMyProfileViewMode,
  useMyProfileViewStats,
  useMyProfileViewers,
  useRecordProfileView,
  useUpdateProfileViewMode,
} from "../useProfileViews";
import {
  RECOMMENDATION_BODY_MAX,
  RECOMMENDATION_BODY_MIN,
  RECOMMENDATION_RELATIONSHIPS,
  isRecommendationRelationship,
  useRecommendations,
  useRespondRecommendation,
  useWriteRecommendation,
} from "../useRecommendations";

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function ok(data: unknown): Promise<RpcResult> {
  return Promise.resolve({ data, error: null });
}

beforeEach(() => {
  h.user.current = "user-a";
  h.rpc.mockReset();
  h.profileRow.current = { profile_view_mode: "public" };
  h.profileError.current = null;
  h.updates.length = 0;
});

describe("poparcia umiejętności", () => {
  it("czyta liczniki dla wskazanego profilu", async () => {
    h.rpc.mockImplementation(() => ok([{ skill_id: "s1", cnt: 2, by_me: false }]));
    const client = makeClient();
    const { result } = renderHook(() => useSkillEndorsements("peer-1"), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("skill_endorsement_counts", { p_user: "peer-1" });
    expect(result.current.data).toEqual([{ skill_id: "s1", cnt: 2, by_me: false }]);
  });

  it("nie odpytuje bazy bez odbiorcy", async () => {
    const client = makeClient();
    renderHook(() => useSkillEndorsements(null), { wrapper: wrapperFor(client) });
    await Promise.resolve();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("poparcie zwiększa licznik optymistycznie i woła endorse_skill", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const key = ["network", "endorsements", "user-a", "peer-1"];
    client.setQueryData(key, [{ skill_id: "s1", cnt: 2, by_me: false }]);

    const { result } = renderHook(() => useToggleEndorsement("peer-1"), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await result.current.mutateAsync({ skillId: "s1", endorsed: false });
    });

    expect(h.rpc).toHaveBeenCalledWith("endorse_skill", { p_skill_id: "s1" });
    expect(client.getQueryData(key)).toEqual([{ skill_id: "s1", cnt: 3, by_me: true }]);
  });

  it("cofnięcie poparcia zmniejsza licznik i woła unendorse_skill", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const key = ["network", "endorsements", "user-a", "peer-1"];
    client.setQueryData(key, [{ skill_id: "s1", cnt: 1, by_me: true }]);

    const { result } = renderHook(() => useToggleEndorsement("peer-1"), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await result.current.mutateAsync({ skillId: "s1", endorsed: true });
    });

    expect(h.rpc).toHaveBeenCalledWith("unendorse_skill", { p_skill_id: "s1" });
    expect(client.getQueryData(key)).toEqual([{ skill_id: "s1", cnt: 0, by_me: false }]);
  });

  it("licznik nigdy nie schodzi poniżej zera", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const key = ["network", "endorsements", "user-a", "peer-1"];
    client.setQueryData(key, [{ skill_id: "s1", cnt: 0, by_me: true }]);

    const { result } = renderHook(() => useToggleEndorsement("peer-1"), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await result.current.mutateAsync({ skillId: "s1", endorsed: true });
    });
    expect(client.getQueryData(key)).toEqual([{ skill_id: "s1", cnt: 0, by_me: false }]);
  });

  it("poparcie nieznanej dotąd umiejętności dopisuje wiersz", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const key = ["network", "endorsements", "user-a", "peer-1"];
    client.setQueryData(key, []);

    const { result } = renderHook(() => useToggleEndorsement("peer-1"), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await result.current.mutateAsync({ skillId: "s-new", endorsed: false });
    });
    expect(client.getQueryData(key)).toEqual([{ skill_id: "s-new", cnt: 1, by_me: true }]);
  });

  it("odmowa bazy cofa optymistyczną zmianę", async () => {
    h.rpc.mockImplementation(() =>
      Promise.resolve({ data: null, error: { message: "not connected" } }),
    );
    const client = makeClient();
    const key = ["network", "endorsements", "user-a", "peer-1"];
    const before = [{ skill_id: "s1", cnt: 2, by_me: false }];
    client.setQueryData(key, before);

    const { result } = renderHook(() => useToggleEndorsement("peer-1"), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await result.current.mutateAsync({ skillId: "s1", endorsed: false }).catch(() => undefined);
    });
    expect(client.getQueryData(key)).toEqual(before);
  });
});

describe("wprowadzenia", () => {
  it("lista jedzie z rolą i jest kluczowana po koncie", async () => {
    h.rpc.mockImplementation(() => ok([{ id: "i1" }]));
    const client = makeClient();
    const { result } = renderHook(() => useMyIntroductions("bridge"), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("my_introduction_requests", { p_role: "bridge" });
    expect(client.getQueryData(["network", "introductions", "user-a", "bridge"])).toEqual([
      { id: "i1" },
    ]);
  });

  it("odrzuca wiadomość poza granicami PRZED wywołaniem RPC", async () => {
    h.rpc.mockImplementation(() => ok("intro-1"));
    const client = makeClient();
    const { result } = renderHook(() => useRequestIntroduction(), { wrapper: wrapperFor(client) });

    for (const message of [
      "  " + "x".repeat(INTRO_MESSAGE_MIN - 1) + "  ",
      "y".repeat(INTRO_MESSAGE_MAX + 1),
    ]) {
      await act(async () => {
        await expect(
          result.current.mutateAsync({ bridgeId: "b", targetId: "t", message }),
        ).rejects.toThrow(/Message length/);
      });
    }
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("wysyła przyciętą wiadomość i unieważnia listy wprowadzeń", async () => {
    h.rpc.mockImplementation(() => ok("intro-1"));
    const client = makeClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useRequestIntroduction(), { wrapper: wrapperFor(client) });

    const message = "  " + "x".repeat(INTRO_MESSAGE_MIN) + "  ";
    await act(async () => {
      const id = await result.current.mutateAsync({ bridgeId: "b", targetId: "t", message });
      expect(id).toBe("intro-1");
    });
    expect(h.rpc).toHaveBeenCalledWith("request_introduction", {
      p_bridge: "b",
      p_target: "t",
      p_message: "x".repeat(INTRO_MESSAGE_MIN),
    });
    expect(spy.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey))).toContain(
      JSON.stringify(["network", "introductions", "user-a"]),
    );
  });

  it.each(["forward", "decline", "withdraw"] as const)(
    'odpowiedź „%s" idzie do respond_introduction dosłownie',
    async (action) => {
      h.rpc.mockImplementation(() => ok(null));
      const client = makeClient();
      const { result } = renderHook(() => useRespondIntroduction(), {
        wrapper: wrapperFor(client),
      });
      await act(async () => {
        await result.current.mutateAsync({ id: "i1", action });
      });
      expect(h.rpc).toHaveBeenCalledWith("respond_introduction", { p_id: "i1", p_action: action });
    },
  );
});

describe("wyświetlenia profilu", () => {
  it("rejestracja obejrzenia woła RPC z id profilu", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useRecordProfileView(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync("profile-1");
    });
    expect(h.rpc).toHaveBeenCalledWith("record_profile_view", { p_profile: "profile-1" });
  });

  it("lista widzów przekazuje limit", async () => {
    h.rpc.mockImplementation(() => ok([{ viewer_id: "v1" }]));
    const client = makeClient();
    const { result } = renderHook(() => useMyProfileViewers(7), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("my_profile_viewers", { p_limit: 7 });
  });

  it("statystyki normalizują liczby, a brak wiersza daje null", async () => {
    h.rpc.mockImplementation(() => ok([{ last_7: "3", last_30: null, last_90: 9 }]));
    const client = makeClient();
    const { result } = renderHook(() => useMyProfileViewStats(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ last_7: 3, last_30: 0, last_90: 9 });

    h.rpc.mockImplementation(() => ok([]));
    const empty = makeClient();
    const second = renderHook(() => useMyProfileViewStats(), { wrapper: wrapperFor(empty) });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(second.result.current.data).toBeNull();
  });

  it.each([
    ["anonymous", "anonymous"],
    ["private", "private"],
    ["public", "public"],
    // Wartość spoza słownika NIE może ukryć widza - domyślamy najbezpieczniej
    // dla przejrzystości wobec oglądanego, czyli „public".
    ["banana", "public"],
    [null, "public"],
  ])("tryb widoczności %s -> %s", async (stored, expected) => {
    h.profileRow.current = { profile_view_mode: stored };
    const client = makeClient();
    const { result } = renderHook(() => useMyProfileViewMode(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(expected);
  });

  it("zmiana trybu zapisuje kolumnę własnego wiersza i odświeża odczyt", async () => {
    const client = makeClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateProfileViewMode(), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await result.current.mutateAsync("anonymous");
    });
    expect(h.updates).toEqual([{ patch: { profile_view_mode: "anonymous" }, id: "user-a" }]);
    expect(spy.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey))).toContain(
      JSON.stringify(["network", "profile-view-mode", "user-a"]),
    );
  });

  it("bez zalogowania zmiana trybu jest odmawiana lokalnie", async () => {
    h.user.current = null;
    const client = makeClient();
    const { result } = renderHook(() => useUpdateProfileViewMode(), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await expect(result.current.mutateAsync("private")).rejects.toThrow(/Not authenticated/);
    });
    expect(h.updates).toHaveLength(0);
  });
});

describe("rekomendacje", () => {
  it("słownik relacji jest domknięty i zaczyna się od najczęstszej", () => {
    expect(RECOMMENDATION_RELATIONSHIPS[0]).toBe("colleague");
    expect(new Set(RECOMMENDATION_RELATIONSHIPS).size).toBe(RECOMMENDATION_RELATIONSHIPS.length);
    expect(isRecommendationRelationship("mentor")).toBe(true);
    expect(isRecommendationRelationship("bff")).toBe(false);
    expect(RECOMMENDATION_BODY_MIN).toBeLessThan(RECOMMENDATION_BODY_MAX);
  });

  it("mapuje wiersz RPC jawnie, a nieznaną relację i status degraduje bezpiecznie", async () => {
    h.rpc.mockImplementation(() =>
      ok([
        {
          id: "r1",
          author_id: "a1",
          author_name: null,
          author_avatar: null,
          author_headline: null,
          relationship: "bff",
          body: null,
          status: "banana",
          created_at: "2026-01-01T00:00:00Z",
        },
      ]),
    );
    const client = makeClient();
    const { result } = renderHook(() => useRecommendations("peer-1"), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toEqual({
      id: "r1",
      author_id: "a1",
      author_name: "",
      author_avatar: null,
      author_headline: null,
      relationship: null,
      body: "",
      status: "pending",
      created_at: "2026-01-01T00:00:00Z",
    });
  });

  // Ta sama lista wygląda inaczej zależnie od pytającego (autor widzi swoje
  // hidden/declined jako pending), więc klucz MUSI nieść oglądającego.
  it("klucz cache rozdziela oglądających tego samego profilu", async () => {
    h.rpc.mockImplementation(() => ok([]));
    const client = makeClient();
    renderHook(() => useRecommendations("peer-1"), { wrapper: wrapperFor(client) });
    await waitFor(() =>
      expect(client.getQueryData(["network", "recommendations", "user-a", "peer-1"])).toEqual([]),
    );

    h.user.current = "user-b";
    renderHook(() => useRecommendations("peer-1"), { wrapper: wrapperFor(client) });
    await waitFor(() =>
      expect(client.getQueryData(["network", "recommendations", "user-b", "peer-1"])).toEqual([]),
    );
  });

  it("napisanie rekomendacji trafia do write_recommendation i odświeża listę odbiorcy", async () => {
    h.rpc.mockImplementation(() => ok("rec-1"));
    const client = makeClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useWriteRecommendation("peer-1"), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      const id = await result.current.mutateAsync({ body: "x".repeat(50), relationship: "client" });
      expect(id).toBe("rec-1");
    });
    expect(h.rpc).toHaveBeenCalledWith("write_recommendation", {
      p_recipient: "peer-1",
      p_body: "x".repeat(50),
      p_relationship: "client",
    });
    expect(spy.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey))).toContain(
      JSON.stringify(["network", "recommendations", "user-a", "peer-1"]),
    );
  });

  it.each(["publish", "hide", "decline", "delete"] as const)(
    'czasownik „%s" jedzie do respond_recommendation bez tłumaczenia',
    async (action) => {
      h.rpc.mockImplementation(() => ok(null));
      const client = makeClient();
      const { result } = renderHook(() => useRespondRecommendation(), {
        wrapper: wrapperFor(client),
      });
      await act(async () => {
        await result.current.mutateAsync({ id: "r1", action, recipientId: "user-a" });
      });
      expect(h.rpc).toHaveBeenCalledWith("respond_recommendation", {
        p_id: "r1",
        p_action: action,
      });
    },
  );
});
