// Hooki KLONU EDYCJI na prawdziwym react-query (warstwa RPC jest atrapą).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. PODGLĄD STRZELA NA KAŻDY ZNAK. Odroczenie po REFERENCJI obiektu
//      resetowałoby zegar przy każdym renderze - albo, przy złym porównaniu,
//      pytało bazę przy każdym znaku tytułu. Dowód: dwie szybkie zmiany = JEDNO
//      nowe zapytanie, z ostatnią wartością.
//   2. PODGLĄD MRUGA. Poprzedni wynik ma zostać na ekranie, dopóki nowy się
//      liczy (`keepPreviousData`).
//   3. KLON NIE ODŚWIEŻA LISTY. Mutacja ma unieważnić listę wydarzeń, katalog
//      rodzajów, starą listę społeczności i listę edycji ŹRÓDŁA - i NIE ruszać
//      edycji innego wydarzenia (para asercji).
//   4. PODSUMOWANIE ZNIKA ALBO IDZIE DO BAZY. Wynik ma leżeć w cache pod kluczem
//      NOWEJ edycji, bez zapytania; zamknięcie czyści tylko ten wpis.
//   5. WYSZUKIWARKA OD JEDNEGO ZNAKU. Fraza krótsza niż dwa znaki nie pyta bazy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { freezeClock } from "@/test/time";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase";
import { CLONE_NEW_ID, CLONE_SOURCE_ID } from "@/test/events/eventCloneFixtures";
import type { EventCloneInput } from "@/lib/events/eventCloneApi";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => h.rpc!.rpc(name, args),
  },
}));

const hooks = await import("@/lib/events/useEventClone");
const { adminEventKeys } = await import("@/lib/events/useAdminEvents");
const { eventTypeKeys } = await import("@/lib/events/useEventTypes");

freezeClock();

const OTHER_ID = "5e5e5e5e-0000-4000-8000-0000000000ff";

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function previewCalls(): unknown[] {
  return h.rpc!.callsFor("admin_event_clone_preview").map((call) => call.arg("p_payload"));
}

describe("eventCloneKeys", () => {
  it("wszystko o wydarzeniu siedzi w jego gałęzi `event-clone`", () => {
    const branch = hooks.eventCloneKeys.event(CLONE_SOURCE_ID);
    for (const key of [
      hooks.eventCloneKeys.source(CLONE_SOURCE_ID),
      hooks.eventCloneKeys.preview(CLONE_SOURCE_ID, "{}"),
      hooks.eventCloneKeys.editions(CLONE_SOURCE_ID),
      hooks.eventCloneKeys.result(CLONE_SOURCE_ID),
    ]) {
      expect(key.slice(0, branch.length)).toEqual([...branch]);
    }
    expect(hooks.eventCloneKeys.search("x")).toEqual(["event-clone", "search", "x"]);
  });
});

describe("useEventCloneSource", () => {
  it("pyta podgląd samym źródłem; pusty identyfikator nie pyta wcale", async () => {
    h.rpc!.setData("admin_event_clone_preview", { source: { id: CLONE_SOURCE_ID, slug: "kongres" } });
    const { result } = renderHookWithQueryClient(() => hooks.useEventCloneSource(CLONE_SOURCE_ID));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.source.slug).toBe("kongres");
    expect(previewCalls()).toEqual([{ source_event_id: CLONE_SOURCE_ID }]);

    const idle = renderHookWithQueryClient(() => hooks.useEventCloneSource(""));
    expect(idle.result.current.fetchStatus).toBe("idle");
    expect(previewCalls()).toHaveLength(1);
  });

  it("odmowa bazy (not_found) jest błędem bez ponowienia", async () => {
    h.rpc!.setError("admin_event_clone_preview", "not_found: source event does not exist in this tenant");
    const { result } = renderHookWithQueryClient(() => hooks.useEventCloneSource(CLONE_SOURCE_ID));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/^not_found/);
    expect(previewCalls()).toHaveLength(1);
  });
});

describe("useEventClonePreview", () => {
  function mount(initial: EventCloneInput | null) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(({ input }: { input: EventCloneInput | null }) => hooks.useEventClonePreview(input), {
      wrapper,
      initialProps: { input: initial },
    });
  }

  it("pierwsze wejście pyta od razu; dwie szybkie zmiany = jedno zapytanie z ostatnią", async () => {
    h.rpc!.setResponse("admin_event_clone_preview", (call) => ({
      data: { target: { slug: (call.arg("p_payload") as { slug?: string }).slug ?? "brak" } },
      error: null,
    }));
    const { result, rerender } = mount({ sourceEventId: CLONE_SOURCE_ID, slug: "a-1" });
    await waitFor(() => expect(result.current.data?.target.slug).toBe("a-1"));

    rerender({ input: { sourceEventId: CLONE_SOURCE_ID, slug: "a-2" } });
    rerender({ input: { sourceEventId: CLONE_SOURCE_ID, slug: "a-3" } });
    // Poprzedni wynik zostaje, dopóki nowy się liczy.
    expect(result.current.data?.target.slug).toBe("a-1");
    await waitFor(() => expect(result.current.data?.target.slug).toBe("a-3"), { timeout: 3000 });
    expect(previewCalls()).toEqual([
      { source_event_id: CLONE_SOURCE_ID, slug: "a-1" },
      { source_event_id: CLONE_SOURCE_ID, slug: "a-3" },
    ]);
  });

  it("ten sam ładunek w nowym obiekcie nie pyta ponownie (porównanie po treści)", async () => {
    h.rpc!.setData("admin_event_clone_preview", {});
    const { result, rerender } = mount({ sourceEventId: CLONE_SOURCE_ID, titlePl: "X" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ input: { sourceEventId: CLONE_SOURCE_ID, titlePl: "X" } });
    await new Promise((resolve) => setTimeout(resolve, hooks.CLONE_PREVIEW_DEBOUNCE_MS + 100));
    expect(previewCalls()).toHaveLength(1);
  });

  it("brak wejścia = brak zapytania", () => {
    const { result } = mount(null);
    expect(result.current.fetchStatus).toBe("idle");
    expect(previewCalls()).toEqual([]);
  });
});

describe("useCloneEvent", () => {
  it("wynik w cache NOWEJ edycji; unieważnia listę, rodzaje, społeczność i edycje ŹRÓDŁA", async () => {
    h.rpc!.setData("admin_event_clone", { event_id: CLONE_NEW_ID, source_event_id: CLONE_SOURCE_ID });
    const { result, queryClient } = renderHookWithQueryClient(() => hooks.useCloneEvent());
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync({ sourceEventId: CLONE_SOURCE_ID, idempotencyKey: "event.clone:1" });
    });
    const keys = spy.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(adminEventKeys.all);
    expect(keys).toContainEqual(eventTypeKeys.all);
    expect(keys).toContainEqual(["admin-community-events"]);
    expect(keys).toContainEqual(hooks.eventCloneKeys.editions(CLONE_SOURCE_ID));
    expect(keys).not.toContainEqual(hooks.eventCloneKeys.editions(OTHER_ID));
    expect(queryClient.getQueryData(hooks.eventCloneKeys.result(CLONE_NEW_ID))).toMatchObject({
      eventId: CLONE_NEW_ID,
    });
  });

  it("odmowa nie wpisuje niczego do cache", async () => {
    h.rpc!.setError("admin_event_clone", "slug_taken: another event already uses this address");
    const { result, queryClient } = renderHookWithQueryClient(() => hooks.useCloneEvent());
    await act(async () => {
      await result.current.mutateAsync({ sourceEventId: CLONE_SOURCE_ID }).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.error?.message).toMatch(/^slug_taken/));
    expect(queryClient.getQueryCache().findAll({ queryKey: hooks.eventCloneKeys.all })).toEqual([]);
  });
});

describe("useEventEditions", () => {
  it("czyta edycje wydarzenia; pusty identyfikator nie pyta", async () => {
    h.rpc!.setData("admin_event_editions", [{ id: OTHER_ID, relation: "previous" }]);
    const { result } = renderHookWithQueryClient(() => hooks.useEventEditions(CLONE_SOURCE_ID));
    await waitFor(() => expect(result.current.data).toEqual([{ id: OTHER_ID, relation: "previous" }]));
    const idle = renderHookWithQueryClient(() => hooks.useEventEditions(""));
    expect(idle.result.current.fetchStatus).toBe("idle");
    expect(h.rpc!.callsFor("admin_event_editions")).toHaveLength(1);
  });
});

describe("useEventCloneResult / useDismissCloneResult", () => {
  it("czyta wynik z cache bez zapytania i zamyka go bez ruszania innych wpisów", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => ({
      value: hooks.useEventCloneResult(CLONE_NEW_ID),
      dismiss: hooks.useDismissCloneResult(CLONE_NEW_ID),
    }));
    expect(result.current.value).toBeNull();
    act(() => {
      queryClient.setQueryData(hooks.eventCloneKeys.result(CLONE_NEW_ID), { eventId: CLONE_NEW_ID });
      queryClient.setQueryData(hooks.eventCloneKeys.result(OTHER_ID), { eventId: OTHER_ID });
    });
    await waitFor(() => expect(result.current.value).toEqual({ eventId: CLONE_NEW_ID }));
    act(() => result.current.dismiss());
    await waitFor(() => expect(result.current.value).toBeNull());
    expect(queryClient.getQueryData(hooks.eventCloneKeys.result(OTHER_ID))).toEqual({ eventId: OTHER_ID });
    expect(h.rpc!.calls).toEqual([]);
  });
});

describe("useCloneSourceSearch", () => {
  it("pyta od dwóch znaków (po przycięciu)", async () => {
    h.rpc!.setData("admin_events_list", [{ id: CLONE_SOURCE_ID }]);
    const short = renderHookWithQueryClient(() => hooks.useCloneSourceSearch(" k "));
    expect(short.result.current.fetchStatus).toBe("idle");
    const { result } = renderHookWithQueryClient(() => hooks.useCloneSourceSearch(" ko "));
    await waitFor(() => expect(result.current.data).toEqual([{ id: CLONE_SOURCE_ID }]));
    expect(h.rpc!.lastCall("admin_events_list")?.arg("p_q")).toBe("ko");
  });
});
