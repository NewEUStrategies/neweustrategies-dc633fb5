// PollBlockView - SKLEJANIE serii głosów z realtime w jedno odświeżenie wyników.
//
// pollBlockRealtime dowodzi, KIEDY blok otwiera kanał. Tu pytanie brzmi, co
// robi z tym, co kanałem przyjdzie. Ankieta w popularnym wpisie dostaje głosy
// seriami; każde zdarzenie `poll_votes` odpalające osobne zapytanie o wyniki
// (RPC liczący rozkład) mnożyłoby ruch do bazy przez liczbę czytelników.
// Kontrakt:
//   1. seria zdarzeń w oknie 250 ms = JEDNA inwalidacja wyników,
//   2. inwalidacja trafia w prefiks klucza wspólny z /polls
//      (`["public-poll-results"]`), więc odświeża obie powierzchnie,
//   3. odmontowanie z oczekującym odświeżeniem anuluje je (zero pracy po
//      zamknięciu bloku) i zamyka kanał.
//
// Granice: Supabase realtime (atrapa zapisuje handler zdarzeń), zapytania
// ankiety i wyników, karta ankiety, `useAuth`, IntersectionObserver (blok od
// razu „w kadrze"). React Query jest prawdziwy - na nim liczymy inwalidacje.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type VoteHandler = (payload: { eventType: string }) => void;

const h = vi.hoisted(() => ({
  handlers: [] as VoteHandler[],
  removed: 0,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/community/PollCard", () => ({
  PollCard: () => <article data-testid="poll-card">ankieta</article>,
}));
vi.mock("@/lib/queries/blocks", () => ({
  pollBlockQueryOptions: (id: string) => ({
    queryKey: ["public", "blocks", "poll", id] as const,
    queryFn: async () => ({ id, question_pl: "Pytanie", options: [], status: "open" }),
    staleTime: 0,
    gcTime: 0,
  }),
}));
vi.mock("@/lib/community/publicQueries", () => ({
  pollResultsQueryOptions: (ids: string[], userId: string | null) => ({
    queryKey: ["public-poll-results", ids, userId] as const,
    queryFn: async () => new Map<string, unknown>(),
    staleTime: Infinity,
    gcTime: 0,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => {
      const channel = {
        on: (_event: string, _filter: unknown, handler: VoteHandler) => {
          h.handlers.push(handler);
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: () => {
      h.removed += 1;
    },
  },
}));

import { PollBlockView } from "../PollBlockView";

/** Obserwator, który od razu zgłasza wjazd w kadr. */
class VisibleIntersectionObserver {
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

let client: QueryClient;
let invalidate: ReturnType<typeof vi.spyOn>;

/** Renderuje blok, czeka na otwarcie kanału i przełącza się na sztuczny zegar. */
async function renderSubscribed() {
  const utils = render(
    <QueryClientProvider client={client}>
      <PollBlockView pollId="poll-1" lang="pl" />
    </QueryClientProvider>,
  );
  await screen.findByTestId("poll-card");
  await vi.waitFor(() => expect(h.handlers).toHaveLength(1));
  vi.useFakeTimers();
  return utils;
}

function vote(): void {
  act(() => h.handlers[0]({ eventType: "INSERT" }));
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  h.handlers = [];
  h.removed = 0;
  vi.stubGlobal("IntersectionObserver", VisibleIntersectionObserver);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidate = vi.spyOn(client, "invalidateQueries");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PollBlockView - seria głosów z realtime", () => {
  it("trzy głosy w oknie 250 ms dają JEDNĄ inwalidację wspólnego prefiksu wyników", async () => {
    await renderSubscribed();
    vote();
    advance(100);
    vote();
    advance(100);
    vote();
    expect(invalidate).not.toHaveBeenCalled();
    advance(50);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["public-poll-results"] });
    advance(1000);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("głos po zamknięciu okna otwiera nowe okno - druga inwalidacja", async () => {
    await renderSubscribed();
    vote();
    advance(250);
    vote();
    advance(250);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("odmontowanie z oczekującym odświeżeniem anuluje je i zamyka kanał", async () => {
    const { unmount } = await renderSubscribed();
    vote();
    unmount();
    advance(1000);
    expect(invalidate).not.toHaveBeenCalled();
    expect(h.removed).toBe(1);
  });
});
