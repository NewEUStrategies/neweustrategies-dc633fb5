// Trzy przełączniki PRYWATNOŚCI na własnym profilu i skrzynka zapytań do
// eksperta - moduły, które stały na zerze, choć każdy zapisuje kolumnę
// widoczną dla innych użytkowników:
//
//   discoverable             - czy jestem w katalogu osób,
//   expert_requests_enabled  - czy przyjmuję zapytania do eksperta,
//   hide_avatar              - czy moje zdjęcie jest maskowane w wyszukiwarkach.
//
// Reguła wspólna dla wszystkich trzech: zapis MUSI być zawężony do WŁASNEGO
// wiersza (`.eq("id", user.id)`), bo grant UPDATE na `profiles` ma
// `authenticated`, a nie tylko właściciel - RLS jest barierą, ale filtr po
// swoim id jest tym, co odróżnia zapis od próby zapisu cudzego wiersza.
//
// Domyślne wartości przy braku wiersza są równie ważne i różne per pole:
// brak wiersza to „nie w katalogu" (false), ale „przyjmuję zapytania" (true) -
// bo kolumna jest NOT NULL DEFAULT true i milczenie nie może wyłączyć funkcji
// ekspertowi.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CHAT_IDS, fail, ok, supabaseFromStub, type SupabaseResult } from "@/test/chat/fixtures";

const h = vi.hoisted(() => ({
  uid: "user-me" as string | null,
  rpc: vi.fn(),
}));

const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/chat/fixtures");
  const from = fixtures.supabaseFromStub();
  stubs.from = from;
  return {
    supabase: {
      from: from.from,
      rpc: (fn: string, args?: Record<string, unknown>): Promise<SupabaseResult> => h.rpc(fn, args),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.uid ? { id: h.uid } : null, tenantId: CHAT_IDS.tenant }),
}));

import {
  useDiscoverable,
  useExpertRequestsEnabled,
  useHideAvatar,
  useSetDiscoverable,
  useSetExpertRequestsEnabled,
  useSetHideAvatar,
} from "../useDiscoverable";
import {
  expertRequestKeys,
  useAdminExpertRequests,
  useMyExpertRequestQuota,
  useMyExpertRequests,
  useResolveExpertRequest,
  useSendExpertRequest,
} from "../useExpertRequests";

type FromStub = ReturnType<typeof supabaseFromStub>;
const db = () => stubs.from as FromStub;

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

function rpcOk(data: unknown): Promise<SupabaseResult> {
  return Promise.resolve({ data, error: null });
}

function rpcFail(message: string): Promise<SupabaseResult> {
  const error = new Error(message);
  error.name = "PostgrestError";
  return Promise.resolve({ data: null, error });
}

beforeEach(() => {
  h.uid = CHAT_IDS.me;
  h.rpc.mockReset();
  db().reset();
});

describe("useDiscoverable", () => {
  it("czyta kolumnę WŁASNEGO wiersza profilu", async () => {
    db().setResponse("profiles", ok({ discoverable: true }));
    const { result } = renderHook(() => useDiscoverable(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
    const chain = db().lastChain("profiles");
    expect(chain?.argsOf("select")).toEqual(["discoverable"]);
    expect(chain?.argsOf("eq")).toEqual(["id", CHAT_IDS.me]);
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  it("brak wiersza to NIE w katalogu (opt-in, nie opt-out)", async () => {
    db().setResponse("profiles", ok(null));
    const { result } = renderHook(() => useDiscoverable(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(false);
  });

  it("nie odpytuje bazy bez sesji", async () => {
    h.uid = null;
    db().setResponse("profiles", ok(null));
    renderHook(() => useDiscoverable(), { wrapper: wrapperFor(makeClient()) });
    await Promise.resolve();
    expect(db().chainsFor("profiles")).toHaveLength(0);
  });

  it("propaguje błąd zapytania", async () => {
    db().setResponse("profiles", fail("denied"));
    const { result } = renderHook(() => useDiscoverable(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useSetDiscoverable", () => {
  it("zapisuje ZAWĘŻONE do własnego wiersza i odświeża katalog osób", async () => {
    db().setResponse("profiles", ok(null));
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSetDiscoverable(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync(true);
    });

    const chain = db().lastChain("profiles");
    expect(chain?.argsOf("update")?.[0]).toEqual({ discoverable: true });
    expect(chain?.argsOf("eq")).toEqual(["id", CHAT_IDS.me]);
    // Wejście/wyjście z katalogu zmienia CUDZE wyniki wyszukiwania.
    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(
      JSON.stringify(["chat", "people"]),
    );
    expect(client.getQueryData(["chat", "discoverable", CHAT_IDS.me])).toBe(true);
  });

  it("odmawia bez sesji i nie dotyka bazy", async () => {
    h.uid = null;
    db().setResponse("profiles", ok(null));
    const { result } = renderHook(() => useSetDiscoverable(), {
      wrapper: wrapperFor(makeClient()),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync(true);
      }),
    ).rejects.toThrow("auth required");
    expect(db().chainsFor("profiles")).toHaveLength(0);
  });
});

describe("useExpertRequestsEnabled", () => {
  it("brak wiersza to WŁĄCZONE - milczenie nie wyłącza funkcji ekspertowi", async () => {
    db().setResponse("profiles", ok(null));
    const { result } = renderHook(() => useExpertRequestsEnabled(), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
  });

  it("jawne `false` w bazie wyłącza przyjmowanie zapytań", async () => {
    db().setResponse("profiles", ok({ expert_requests_enabled: false }));
    const { result } = renderHook(() => useExpertRequestsEnabled(), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(false);
  });

  it("zapis zawęża do własnego wiersza i aktualizuje cache", async () => {
    db().setResponse("profiles", ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useSetExpertRequestsEnabled(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync(false);
    });

    const chain = db().lastChain("profiles");
    expect(chain?.argsOf("update")?.[0]).toEqual({ expert_requests_enabled: false });
    expect(chain?.argsOf("eq")).toEqual(["id", CHAT_IDS.me]);
    expect(client.getQueryData(["profile", "expert-requests-enabled", CHAT_IDS.me])).toBe(false);
  });

  it("odmawia bez sesji", async () => {
    h.uid = null;
    db().setResponse("profiles", ok(null));
    const { result } = renderHook(() => useSetExpertRequestsEnabled(), {
      wrapper: wrapperFor(makeClient()),
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync(true);
      }),
    ).rejects.toThrow("auth required");
  });
});

describe("useHideAvatar", () => {
  it("brak wiersza to NIE maskuj (domyślnie avatar widoczny)", async () => {
    db().setResponse("profiles", ok(null));
    const { result } = renderHook(() => useHideAvatar(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(false);
  });

  it("zapis unieważnia OBIE powierzchnie, na których avatar się pokazuje", async () => {
    db().setResponse("profiles", ok(null));
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSetHideAvatar(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync(true);
    });

    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    // Maskowanie egzekwuje baza (profiles_public + funkcje szukania), ale
    // KLIENT musi zrzucić oba cache, inaczej stary avatar wisi do TTL.
    expect(keys).toContain(JSON.stringify(["chat", "people"]));
    expect(keys).toContain(JSON.stringify(["search-overlay-tabs"]));
    expect(db().lastChain("profiles")?.argsOf("update")?.[0]).toEqual({ hide_avatar: true });
  });

  it("odmawia bez sesji", async () => {
    h.uid = null;
    db().setResponse("profiles", ok(null));
    const { result } = renderHook(() => useSetHideAvatar(), { wrapper: wrapperFor(makeClient()) });
    await expect(
      act(async () => {
        await result.current.mutateAsync(true);
      }),
    ).rejects.toThrow("auth required");
  });
});

describe("useMyExpertRequestQuota", () => {
  it("normalizuje zwrotkę RPC na cztery liczby i dwie flagi", async () => {
    h.rpc.mockImplementation(() =>
      rpcOk({ quota: 3, used: 1, remaining: 2, unlimited: false, direct: false }),
    );
    const { result } = renderHook(() => useMyExpertRequestQuota(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      quota: 3,
      used: 1,
      remaining: 2,
      unlimited: false,
      direct: false,
    });
    expect(h.rpc).toHaveBeenCalledWith("my_inmail_quota", undefined);
  });

  it("wartości nieliczbowe schodzą na zero, a nie na NaN w interfejsie", async () => {
    h.rpc.mockImplementation(() =>
      rpcOk({ quota: "trzy", used: null, remaining: undefined, unlimited: "tak" }),
    );
    const { result } = renderHook(() => useMyExpertRequestQuota(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      quota: 0,
      used: 0,
      remaining: 0,
      // `unlimited` wymaga DOKŁADNIE `true` - napis „tak" nie otwiera puli.
      unlimited: false,
      direct: false,
    });
  });

  it("tablica albo null zamiast obiektu daje zerową pulę, nie wywrotkę", async () => {
    for (const payload of [null, [], "nonsens"]) {
      h.rpc.mockImplementation(() => rpcOk(payload));
      const { result } = renderHook(() => useMyExpertRequestQuota(), {
        wrapper: wrapperFor(makeClient()),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.quota).toBe(0);
    }
  });

  it("nie odpytuje bazy bez sesji", async () => {
    h.uid = null;
    h.rpc.mockImplementation(() => rpcOk({}));
    renderHook(() => useMyExpertRequestQuota(), { wrapper: wrapperFor(makeClient()) });
    await Promise.resolve();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("useMyExpertRequests", () => {
  it("skrzynka wysłanych i odebranych to DWA różne klucze i dwa argumenty RPC", async () => {
    h.rpc.mockImplementation(() => rpcOk([]));
    const client = makeClient();

    const sent = renderHook(() => useMyExpertRequests("sent"), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(sent.result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenLastCalledWith("list_my_inmails", { p_box: "sent" });

    const received = renderHook(() => useMyExpertRequests("received"), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(received.result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenLastCalledWith("list_my_inmails", { p_box: "received" });

    expect(expertRequestKeys.my(CHAT_IDS.me, "sent")).not.toEqual(
      expertRequestKeys.my(CHAT_IDS.me, "received"),
    );
  });

  it("brak danych to pusta lista", async () => {
    h.rpc.mockImplementation(() => rpcOk(null));
    const { result } = renderHook(() => useMyExpertRequests("sent"), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useAdminExpertRequests", () => {
  it("bez filtra statusu pyta o pierwsze 200 wierszy", async () => {
    h.rpc.mockImplementation(() => rpcOk([]));
    const { result } = renderHook(() => useAdminExpertRequests(), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("admin_list_inmails", { p_limit: 200, p_offset: 0 });
  });

  it("filtr statusu dokłada argument, a klucz cache go rozróżnia", async () => {
    h.rpc.mockImplementation(() => rpcOk([]));
    const { result } = renderHook(() => useAdminExpertRequests("pending"), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("admin_list_inmails", {
      p_limit: 200,
      p_offset: 0,
      p_status: "pending",
    });
    expect(expertRequestKeys.admin("pending")).not.toEqual(expertRequestKeys.admin(null));
  });
});

describe("useSendExpertRequest", () => {
  const input = {
    recipientId: CHAT_IDS.peer,
    subject: "Pakiet energetyczny",
    reason: "Potrzebuję oceny wpływu na przemysł",
    questions: ["Jaki jest horyzont?", "Kto decyduje?"],
    externalLinks: ["https://ec.europa.eu"],
  };

  it("przekazuje pytania i linki, POMIJAJĄC puste pole opcjonalne", async () => {
    h.rpc.mockImplementation(() => rpcOk("req-1"));
    const { result } = renderHook(() => useSendExpertRequest(), {
      wrapper: wrapperFor(makeClient()),
    });

    await act(async () => {
      await result.current.mutateAsync({ ...input, expectedAnswers: "   " });
    });

    const args = h.rpc.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(args).toEqual({
      p_recipient_id: CHAT_IDS.peer,
      p_subject: input.subject,
      p_reason: input.reason,
      p_questions: input.questions,
      p_external_links: input.externalLinks,
    });
    // Białoznakowe pole opcjonalne NIE jedzie jako pusty napis - RPC ma
    // rozróżniać „nie podano" od „podano nic".
    expect("p_expected_answers" in args).toBe(false);
  });

  it("niepuste pole opcjonalne jedzie przycięte", async () => {
    h.rpc.mockImplementation(() => rpcOk("req-1"));
    const { result } = renderHook(() => useSendExpertRequest(), {
      wrapper: wrapperFor(makeClient()),
    });

    await act(async () => {
      await result.current.mutateAsync({ ...input, expectedAnswers: "  krótka analiza  " });
    });
    expect((h.rpc.mock.calls.at(-1)?.[1] as Record<string, unknown>).p_expected_answers).toBe(
      "krótka analiza",
    );
  });

  it("po wysłaniu odświeża skrzynkę wysłanych I pulę (anulowanie nie zwraca limitu)", async () => {
    h.rpc.mockImplementation(() => rpcOk("req-1"));
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSendExpertRequest(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(expertRequestKeys.my(CHAT_IDS.me, "sent")));
    expect(keys).toContain(JSON.stringify(expertRequestKeys.quota(CHAT_IDS.me)));
  });

  it("odmowa serwera (wyczerpana pula) propaguje się do callera", async () => {
    h.rpc.mockImplementation(() => rpcFail("chat: expert request quota exceeded"));
    const { result } = renderHook(() => useSendExpertRequest(), {
      wrapper: wrapperFor(makeClient()),
    });

    await act(async () => {
      result.current.mutate(input);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("quota exceeded");
  });
});

describe("useResolveExpertRequest", () => {
  it("przekazuje akcję eksperta i pomija pustą notatkę", async () => {
    h.rpc.mockImplementation(() => rpcOk({ status: "approved" }));
    const { result } = renderHook(() => useResolveExpertRequest(), {
      wrapper: wrapperFor(makeClient()),
    });

    await act(async () => {
      await result.current.mutateAsync({ requestId: "req-1", action: "approve", note: "  " });
    });

    const args = h.rpc.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(args).toEqual({ p_inmail_id: "req-1", p_action: "approve" });
    expect("p_note" in args).toBe(false);
  });

  it("notatka jedzie przycięta, gdy jest treścią", async () => {
    h.rpc.mockImplementation(() => rpcOk({ status: "declined" }));
    const { result } = renderHook(() => useResolveExpertRequest(), {
      wrapper: wrapperFor(makeClient()),
    });

    await act(async () => {
      await result.current.mutateAsync({
        requestId: "req-1",
        action: "decline",
        note: "  poza moją specjalizacją  ",
      });
    });
    expect((h.rpc.mock.calls.at(-1)?.[1] as Record<string, unknown>).p_note).toBe(
      "poza moją specjalizacją",
    );
  });

  it("obsługuje wszystkie cztery czasowniki decyzji", async () => {
    h.rpc.mockImplementation(() => rpcOk({ status: "ok" }));
    const { result } = renderHook(() => useResolveExpertRequest(), {
      wrapper: wrapperFor(makeClient()),
    });

    for (const action of ["approve", "decline", "answered", "cancel"] as const) {
      await act(async () => {
        await result.current.mutateAsync({ requestId: "req-1", action });
      });
      expect((h.rpc.mock.calls.at(-1)?.[1] as Record<string, unknown>).p_action).toBe(action);
    }
  });

  it("przyjęcie zwraca id rozmowy (ekspert otwiera wątek) i czyści CAŁY korzeń", async () => {
    h.rpc.mockImplementation(() =>
      rpcOk({ status: "approved", conversation_id: CHAT_IDS.conversation }),
    );
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useResolveExpertRequest(), { wrapper: wrapperFor(client) });

    let resolved: { status: string; conversation_id?: string } | null = null;
    await act(async () => {
      resolved = await result.current.mutateAsync({ requestId: "req-1", action: "approve" });
    });

    expect(resolved).toEqual({ status: "approved", conversation_id: CHAT_IDS.conversation });
    // Decyzja zmienia OBIE skrzynki i pulę - unieważniamy korzeń, nie liść.
    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(
      JSON.stringify(expertRequestKeys.all),
    );
  });
});
