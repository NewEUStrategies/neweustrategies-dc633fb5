// PollBlockView - BRAMKA WIDOCZNOŚCI kanału realtime (F34).
//
// Macierze bloków (`blockMatrix`, `blockMatrixLoaded`) dowodzą, że ankieta się
// renderuje w każdym stanie danych. Zostaje pytanie, którego tamte nie zadają:
// KIEDY ten blok otwiera websocket. Ankieta bywa w połowie długiego wpisu, a
// kanał zakładany zaraz po hydratacji płacił za siebie (TLS + WS + auth + join)
// także u czytelnika, który do niej nigdy nie dojechał - a takich jest
// większość. Dlatego trzy reguły:
//
//   1. sama obecność bloku w DOM NIE otwiera kanału,
//   2. wjazd w kadr otwiera dokładnie ten kanał, co przed bramką (ta sama
//      nazwa i ten sam filtr - bramka ma odraczać, nie zmieniać kontraktu),
//   3. odmontowanie zamyka kanał (bramka nie może zgubić sprzątania).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  poll: null as unknown,
  channelNames: [] as string[],
  filters: [] as unknown[],
  subscribed: 0,
  removed: 0,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/community/PollCard", () => ({
  // Karta jest dowodzona gdzie indziej; tutaj liczy się tylko to, że istnieje
  // węzeł do obserwacji.
  PollCard: () => <article data-testid="poll-card">ankieta</article>,
}));
vi.mock("@/lib/queries/blocks", () => ({
  pollBlockQueryOptions: (id: string) => ({
    queryKey: ["public", "blocks", "poll", id] as const,
    queryFn: async () => h.poll,
    staleTime: 0,
    gcTime: 0,
  }),
}));
vi.mock("@/lib/community/publicQueries", () => ({
  pollResultsQueryOptions: (ids: string[], userId: string | null) => ({
    queryKey: ["public-poll-results", ids, userId] as const,
    queryFn: async () => new Map<string, unknown>(),
    staleTime: 0,
    gcTime: 0,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string) => {
      h.channelNames.push(name);
      const channel = {
        on: (_event: string, filter: unknown) => {
          h.filters.push(filter);
          return channel;
        },
        subscribe: () => {
          h.subscribed += 1;
          return channel;
        },
      };
      return channel;
    },
    removeChannel: () => {
      h.removed += 1;
    },
  },
}));

import { PollBlockView } from "../PollBlockView";

const POLL_ID = "11111111-2222-3333-4444-555555555555";

/**
 * Atrapa `IntersectionObserver`. happy-dom klasę MA, ale nigdy nią nie strzela,
 * więc bez atrapy blok nigdy nie „wjeżdża w kadr" i każdy test przechodziłby
 * z powodu, którego nie bada. `revealViewport()` jest tu jedynym sposobem na
 * wjazd - stan początkowy to zawsze „czytelnik jeszcze nie dojechał".
 */
const pending: Array<() => void> = [];

class TestIntersectionObserver {
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    pending.push(() =>
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      ),
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function revealViewport() {
  const fires = pending.splice(0);
  act(() => {
    for (const fire of fires) fire();
  });
}

function Wrap({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderPoll() {
  return render(
    <Wrap>
      <PollBlockView pollId={POLL_ID} lang="pl" />
    </Wrap>,
  );
}

beforeEach(() => {
  h.poll = {
    id: POLL_ID,
    question_pl: "Pytanie",
    question_en: "Question",
    options: [{ pl: "Tak", en: "Yes" }],
    status: "open",
    ends_at: null,
  };
  h.channelNames = [];
  h.filters = [];
  h.subscribed = 0;
  h.removed = 0;
  pending.length = 0;
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PollBlockView - kanał realtime", () => {
  it("ankieta W DOM, ale POZA KADREM, nie otwiera kanału", async () => {
    const { getByTestId } = renderPoll();

    await waitFor(() => expect(getByTestId("poll-card")).toBeTruthy());
    expect(h.channelNames).toEqual([]);
    expect(h.subscribed).toBe(0);
  });

  it("wjazd w kadr otwiera kanał TEJ ankiety - nazwa i filtr bez zmian", async () => {
    const { getByTestId } = renderPoll();
    await waitFor(() => expect(getByTestId("poll-card")).toBeTruthy());

    revealViewport();

    await waitFor(() => expect(h.subscribed).toBe(1));
    expect(h.channelNames).toEqual([`poll-votes-block-${POLL_ID}`]);
    // Filtr jest treścią: kanał bez `poll_id=eq.` przelewałby głosy ze
    // WSZYSTKICH ankiet serwisu do każdego wpisu z ankietą.
    expect(h.filters[0]).toMatchObject({
      table: "poll_votes",
      filter: `poll_id=eq.${POLL_ID}`,
    });
  });

  it("odmontowanie po wjeździe w kadr ZAMYKA kanał", async () => {
    const { getByTestId, unmount } = renderPoll();
    await waitFor(() => expect(getByTestId("poll-card")).toBeTruthy());
    revealViewport();
    await waitFor(() => expect(h.subscribed).toBe(1));

    unmount();

    expect(h.removed).toBe(1);
  });

  it("ankieta, której NIE MA, nie otwiera kanału nawet po wjeździe w kadr", async () => {
    // Blok usuniętej/szkicowej ankiety znika bez śladu - nie ma czego słuchać.
    h.poll = null;
    const { container } = renderPoll();

    await waitFor(() => expect(container.querySelector(".animate-pulse")).toBeNull());
    revealViewport();

    expect(h.channelNames).toEqual([]);
  });
});
