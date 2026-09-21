// Gałęzie `useEventConfirmedMutation`, których nie odwiedza istniejący
// `useEventConfirmedMutation.test.tsx` (ścieżka szczęśliwa, timeout i błąd
// serwera). Wszystkie dotyczą sytuacji NIETYPOWYCH - i właśnie dlatego są
// groźne: hook trzyma tu w ręku cache użytkownika, więc każda nieobsłużona
// gałąź kończy się albo utratą danych z ekranu, albo utrwaleniem zapisu,
// który nigdy nie doszedł do bazy.
//
// Mierzone kontrakty:
//   * DOMYŚLNE OKNO potwierdzenia (3000 ms) i pomijanie klucza `eventTypes`,
//     gdy wywołujący nie zawęził typów - `awaitDomainEvent` rozróżnia brak
//     klucza od pustej listy;
//   * `invalidateKeys` - obecne i nieobecne;
//   * `onError` BEZ kontekstu (mutacja padła, zanim `onMutate` zdążył zrobić
//     snapshot) - rollback do `undefined` skasowałby cały cache listy;
//   * `onSuccess` BEZ kontekstu (mutacja ODTWORZONA - React Query pomija
//     `onMutate`, gdy wznawia mutację zastaną w stanie `pending`) - oczekiwanie
//     na potwierdzenie cudzej korelacji zawsze skończyłoby się rollbackiem;
//   * `mutationFn` z PUSTYM ref-em korelacji na tej samej ścieżce - żądanie
//     musi wyjść ze świeżym identyfikatorem, a nie z pustym nagłówkiem.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
  type MutationOptions,
  type MutationState,
  type QueryKey,
} from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ awaitDomainEvent: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => ({ data: [], error: null })) },
}));

// Częściowa atrapa: `newCorrelationId` i `runWithCorrelation` zostają PRAWDZIWE
// (to one budują nagłówek, który potem czyta baza), a przechwytujemy wyłącznie
// oczekiwanie na potwierdzenie - inaczej nie da się zobaczyć opcji, z jakimi
// hook je wywołuje, bez czekania na realny zegar.
vi.mock("@/lib/realtime/correlation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/realtime/correlation")>();
  return {
    ...actual,
    awaitDomainEvent: (correlationId: string, options?: unknown) =>
      h.awaitDomainEvent(correlationId, options),
  };
});

import { useEventConfirmedMutation } from "@/lib/realtime/useEventConfirmedMutation";
import type { DomainEventRow, DomainEventType } from "@/lib/realtime/domainEvents";

const LIST_KEY: QueryKey = ["cohesion-branches", "list"];
const SIDEBAR_KEY: QueryKey = ["cohesion-branches", "sidebar"];
const COUNTER_KEY: QueryKey = ["cohesion-branches", "counter"];

function confirmingEvent(correlationId: string): DomainEventRow {
  return {
    id: "11111111-1111-4111-a111-111111111111",
    tenant_id: "22222222-2222-4222-a222-222222222222",
    aggregate_type: "comment",
    aggregate_id: "33333333-3333-4333-a333-333333333333",
    event_type: "comment.created.v1",
    payload: {},
    correlation_id: correlationId,
    actor_id: null,
    created_at: "2026-09-01T10:00:00.000Z",
  };
}

/** Rejestruje klucze, które hook faktycznie unieważnił. */
function trackInvalidations(queryClient: QueryClient): QueryKey[] {
  const seen: QueryKey[] = [];
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async (filters) => {
    seen.push(filters?.queryKey ?? []);
  });
  return seen;
}

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function makeClient(mutationCache?: MutationCache): QueryClient {
  return new QueryClient({
    ...(mutationCache ? { mutationCache } : {}),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

interface MountOptions {
  confirmTimeoutMs?: number;
  confirmEventTypes?: readonly DomainEventType[];
  invalidateKeys?: QueryKey[];
  optimisticUpdate?: (current: string[] | undefined, item: string) => string[] | undefined;
  onConfirmed?: (event: DomainEventRow, item: string) => void;
  onRolledBack?: (item: string) => void;
  queryClient?: QueryClient;
}

function mountMutation(options: MountOptions = {}) {
  const queryClient = options.queryClient ?? makeClient();
  queryClient.setQueryData<string[]>(LIST_KEY, ["istniejacy"]);
  const correlationIds: string[] = [];
  const hook = renderHook(
    () =>
      useEventConfirmedMutation<{ ok: boolean }, string, string[]>({
        mutationFn: async (_item, ctx) => {
          correlationIds.push(ctx.correlationId);
          return { ok: true };
        },
        queryKey: LIST_KEY,
        optimisticUpdate:
          options.optimisticUpdate ?? ((current, item) => [...(current ?? []), item]),
        ...(options.confirmTimeoutMs === undefined
          ? {}
          : { confirmTimeoutMs: options.confirmTimeoutMs }),
        ...(options.confirmEventTypes ? { confirmEventTypes: options.confirmEventTypes } : {}),
        ...(options.invalidateKeys ? { invalidateKeys: options.invalidateKeys } : {}),
        ...(options.onConfirmed ? { onConfirmed: options.onConfirmed } : {}),
        ...(options.onRolledBack ? { onRolledBack: options.onRolledBack } : {}),
      }),
    { wrapper: wrapperFor(queryClient) },
  );
  return { queryClient, hook, correlationIds };
}

beforeEach(() => {
  h.awaitDomainEvent.mockReset();
  // Domyślnie potwierdzenie nigdy nie nadchodzi ani nie pada - test, który
  // nie interesuje się tą ścieżką, nie dostaje przypadkowego rollbacku.
  h.awaitDomainEvent.mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("opcje oczekiwania na potwierdzenie", () => {
  it("bez podanego okna czeka DOMYŚLNE 3000 ms i nie wysyła klucza eventTypes", async () => {
    // Pusta lista typów znaczyłaby dla `awaitDomainEvent` „żadne zdarzenie nie
    // potwierdza" - czyli gwarantowany rollback poprawnego zapisu. Brak klucza
    // znaczy „dowolne zdarzenie z tym correlation_id" i tak ma być domyślnie.
    const { hook } = mountMutation();

    await act(async () => {
      await hook.result.current.mutateAsync("nowy");
    });

    expect(h.awaitDomainEvent).toHaveBeenCalledTimes(1);
    const [, awaitOptions] = h.awaitDomainEvent.mock.calls[0];
    expect(awaitOptions).toEqual({ timeoutMs: 3000 });
    expect(Object.keys(Object(awaitOptions))).toEqual(["timeoutMs"]);
  });

  it("podane okno i zawężenie typów przechodzą do oczekiwania bez zmian", async () => {
    const { hook } = mountMutation({
      confirmTimeoutMs: 750,
      confirmEventTypes: ["comment.created.v1"],
    });

    await act(async () => {
      await hook.result.current.mutateAsync("nowy");
    });

    expect(h.awaitDomainEvent.mock.calls[0][1]).toEqual({
      timeoutMs: 750,
      eventTypes: ["comment.created.v1"],
    });
  });

  it("oczekiwanie dotyczy korelacji z onMutate, a nie nowo wylosowanej", async () => {
    // Gdyby `onSuccess` wygenerował własne id, potwierdzenie nigdy by nie
    // przyszło - a zapis, który się powiódł, zostałby wycofany z ekranu.
    const { hook, correlationIds } = mountMutation();

    await act(async () => {
      await hook.result.current.mutateAsync("nowy");
    });

    expect(correlationIds).toHaveLength(1);
    expect(h.awaitDomainEvent.mock.calls[0][0]).toBe(correlationIds[0]);
  });
});

describe("inwalidacja po rozstrzygnięciu", () => {
  it("potwierdzenie odświeża klucz główny ORAZ wszystkie invalidateKeys", async () => {
    const onConfirmed = vi.fn();
    const { hook, queryClient, correlationIds } = mountMutation({
      invalidateKeys: [SIDEBAR_KEY, COUNTER_KEY],
      onConfirmed,
    });
    const seen = trackInvalidations(queryClient);
    h.awaitDomainEvent.mockImplementation(async (correlationId: string) =>
      confirmingEvent(correlationId),
    );

    await act(async () => {
      await hook.result.current.mutateAsync("nowy");
    });

    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(seen).toEqual([LIST_KEY, SIDEBAR_KEY, COUNTER_KEY]);
    expect(onConfirmed.mock.calls[0][0]).toMatchObject({
      correlation_id: correlationIds[0],
    });
    expect(onConfirmed.mock.calls[0][1]).toBe("nowy");
  });

  it("bez invalidateKeys odświeża WYŁĄCZNIE klucz główny", async () => {
    const onConfirmed = vi.fn();
    const { hook, queryClient } = mountMutation({ onConfirmed });
    const seen = trackInvalidations(queryClient);
    h.awaitDomainEvent.mockImplementation(async (correlationId: string) =>
      confirmingEvent(correlationId),
    );

    await act(async () => {
      await hook.result.current.mutateAsync("nowy");
    });

    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(seen).toEqual([LIST_KEY]);
  });

  it("brak potwierdzenia w oknie wycofuje łatkę i odświeża TAKŻE klucze poboczne", async () => {
    const onRolledBack = vi.fn();
    const { hook, queryClient } = mountMutation({
      invalidateKeys: [SIDEBAR_KEY],
      onRolledBack,
    });
    h.awaitDomainEvent.mockRejectedValue(new Error("brak potwierdzenia"));

    await act(async () => {
      await hook.result.current.mutateAsync("duch");
    });

    await vi.waitFor(() => expect(onRolledBack).toHaveBeenCalledTimes(1));
    // Snapshot wraca DOKŁADNIE do stanu sprzed łatki - to jest naprawa
    // objawu „wpis znika po odświeżeniu strony".
    expect(queryClient.getQueryData(LIST_KEY)).toEqual(["istniejacy"]);
  });
});

describe("rozstrzygnięcie BEZ kontekstu z onMutate", () => {
  it("onError bez kontekstu NIE nadpisuje cache wartością undefined", async () => {
    // `optimisticUpdate` jest funkcją wywołującego. Gdy rzuci, `onMutate`
    // przerywa się PRZED zwróceniem snapshotu, więc React Query woła `onError`
    // z kontekstem `undefined`. Bezwarunkowe `setQueryData(key, context.previous)`
    // rzuciłoby tu na `undefined`, a bezwarunkowe `setQueryData(key, undefined)`
    // - skasowało całą listę z cache przy błędzie, który jej nawet nie dotknął.
    const onRolledBack = vi.fn();
    const { hook, queryClient } = mountMutation({
      invalidateKeys: [SIDEBAR_KEY],
      onRolledBack,
      optimisticUpdate: () => {
        throw new Error("łatka optymistyczna rzuciła");
      },
    });
    const seen = trackInvalidations(queryClient);

    await act(async () => {
      await expect(hook.result.current.mutateAsync("nowy")).rejects.toThrow(
        "łatka optymistyczna rzuciła",
      );
    });

    expect(queryClient.getQueryData(LIST_KEY)).toEqual(["istniejacy"]);
    expect(seen).toEqual([LIST_KEY, SIDEBAR_KEY]);
    expect(onRolledBack).toHaveBeenCalledWith("nowy");
    expect(h.awaitDomainEvent).not.toHaveBeenCalled();
  });

  it("onError Z kontekstem przywraca dokładnie zapamiętany snapshot", async () => {
    // Kontrast do poprzedniego testu: gdy snapshot ISTNIEJE, rollback ma go
    // przywrócić, a nie zostawić łatkę w cache.
    const onRolledBack = vi.fn();
    const queryClient = makeClient();
    queryClient.setQueryData<string[]>(LIST_KEY, ["istniejacy"]);
    const hook = renderHook(
      () =>
        useEventConfirmedMutation<{ ok: boolean }, string, string[]>({
          mutationFn: async () => {
            throw new Error("serwer odmówił");
          },
          queryKey: LIST_KEY,
          optimisticUpdate: (current, item) => [...(current ?? []), item],
          onRolledBack,
        }),
      { wrapper: wrapperFor(queryClient) },
    );

    await act(async () => {
      await expect(hook.result.current.mutateAsync("nowy")).rejects.toThrow("serwer odmówił");
    });

    expect(queryClient.getQueryData(LIST_KEY)).toEqual(["istniejacy"]);
    expect(onRolledBack).toHaveBeenCalledTimes(1);
    expect(h.awaitDomainEvent).not.toHaveBeenCalled();
  });

  it("mutacja ODTWORZONA (bez onMutate) wysyła świeżą korelację i nie czeka na potwierdzenie", async () => {
    // React Query pomija `onMutate`, gdy wznawia mutację zastaną w stanie
    // `pending` (`Mutation.execute`: `const restored = this.state.status === "pending"`)
    // - tak wracają mutacje odtworzone z magazynu po przeładowaniu karty.
    // Wtedy JEDNOCZEŚNIE: ref korelacji jest pusty, a `onSuccess` dostaje
    // kontekst `undefined`. Bez obu zabezpieczeń żądanie wyszłoby z pustym
    // nagłówkiem `x-correlation-id`, a hook czekałby na potwierdzenie
    // nieistniejącej korelacji i wycofałby cudzą łatkę po timeoucie.
    //
    // Scenariusz odtwarzamy uczciwie, na PRAWDZIWYCH opcjach hooka: globalny
    // middleware MutationCache przerywa pierwszą mutację ZANIM `onMutate`
    // ustawi ref, dzięki czemu mamy w ręku te same opcje z nietkniętym refem.
    const captured: { options: MutationOptions<unknown, unknown, unknown, unknown> | null } = {
      options: null,
    };
    const mutationCache = new MutationCache({
      onMutate: (_variables, mutation) => {
        captured.options = mutation.options;
        throw new Error("globalny middleware odrzucił mutację");
      },
    });
    const queryClient = makeClient(mutationCache);
    const { hook, correlationIds } = mountMutation({ queryClient });

    await act(async () => {
      await expect(hook.result.current.mutateAsync("nowy")).rejects.toThrow(
        "globalny middleware odrzucił",
      );
    });
    // Dowód, że `onMutate` NIE zdążył pobiec: mutationFn nie dostał niczego,
    // a ref korelacji w hooku jest nadal pusty.
    expect(correlationIds).toEqual([]);
    expect(captured.options).not.toBeNull();

    const restoredState: MutationState<unknown, unknown, unknown, unknown> = {
      context: undefined,
      data: undefined,
      error: null,
      failureCount: 0,
      failureReason: null,
      isPaused: false,
      status: "pending",
      variables: "odtworzony",
      submittedAt: Date.now(),
    };
    const restored = mutationCache.build(queryClient, captured.options ?? {}, restoredState);

    await act(async () => {
      await restored.execute("odtworzony");
    });

    expect(correlationIds).toHaveLength(1);
    expect(correlationIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // Bez kontekstu nie ma czego potwierdzać ani czego wycofywać - `onSuccess`
    // musi wyjść natychmiast, zamiast zamawiać oczekiwanie na korelację.
    expect(h.awaitDomainEvent).not.toHaveBeenCalled();
  });
});

describe("dwie mutacje w locie z jednego hooka", () => {
  // ZNANY DEFEKT PRODUKCYJNY - test jest celowo czerwony (`it.fails`) i NIE
  // wolno go naprawiać zmianą asercji.
  //
  // CO JEST ZŁAMANE: correlation id powstaje w `onMutate` i wędruje do
  // `mutationFn` przez POJEDYNCZY `useRef` wspólny dla całego hooka
  // (`correlationRef`, linie 59 i 72 w useEventConfirmedMutation.ts). `onMutate`
  // jest asynchroniczne (`await qc.cancelQueries`), więc dwie mutacje wypuszczone
  // z tego samego hooka bez czekania na pierwszą przeplatają się tak:
  //
  //   onMutate(A): ref = idA -> await cancelQueries
  //   onMutate(B): ref = idB -> await cancelQueries
  //   mutationFn(A): czyta ref -> dostaje idB   <-- zły stempel
  //   mutationFn(B): czyta ref -> dostaje idB
  //
  // Kontekst z `onMutate` jest już poprawny per mutacja, więc `onSuccess(A)`
  // czeka na potwierdzenie idA - a żądanie A poszło do bazy z nagłówkiem idB
  // i trigger zapisze w `domain_events.correlation_id` właśnie idB. Zdarzenie
  // potwierdzające dla A nigdy nie nadejdzie.
  //
  // SKUTEK DLA UŻYTKOWNIKA: przy dwóch szybkich akcjach z jednego widoku
  // (dwa kliknięcia „dodaj", przeciągnięcie dwóch kart naraz) PIERWSZA z nich
  // po upływie okna potwierdzenia zostaje WYCOFANA z cache mimo poprawnego
  // zapisu - czyli dokładnie objaw „zniknęło po chwili", któremu ten hook ma
  // zapobiegać. Cichy, bo nie ma żadnego błędu ani w konsoli, ani w sieci.
  //
  // OCZEKIWANY KONTRAKT: identyfikator wygenerowany w `onMutate` danej mutacji
  // musi dotrzeć do `mutationFn` TEJ SAMEJ mutacji - czyli zbiór stempli
  // faktycznie wysłanych ma się pokrywać ze zbiorem oczekiwanych korelacji.
  // Naprawa wymaga przeniesienia id ze wspólnego ref-a na kontekst mutacji
  // (np. mapa `mutationId -> correlationId` albo przekazanie go przez zmienne),
  // a nie zmiany testu.
  it.fails(
    "DEFEKT: równoległe mutacje dzielą jeden ref korelacji - pierwsze żądanie idzie ze stemplem drugiego",
    async () => {
      const { hook, correlationIds } = mountMutation();

      await act(async () => {
        await Promise.all([
          hook.result.current.mutateAsync("pierwszy"),
          hook.result.current.mutateAsync("drugi"),
        ]);
      });

      const awaited = h.awaitDomainEvent.mock.calls.map((call) => String(call[0]));
      expect(correlationIds).toHaveLength(2);
      expect(awaited).toHaveLength(2);
      // Zmierzone na tym HEAD: `correlationIds` to DWA RAZY ten sam (drugi)
      // identyfikator, a `awaited` - dwa różne. Pierwsza mutacja czeka więc na
      // korelację, której nigdy nie wysłała.
      expect([...correlationIds].sort()).toEqual([...awaited].sort());
    },
  );
});
