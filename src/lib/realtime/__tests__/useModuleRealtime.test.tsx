// Ujednolicony realtime per moduł - warstwa, przez którą przechodzi KAŻDE
// odświeżenie cache po zdarzeniu domenowym. Przed tą pracą plik miał 0 pokrytych
// linii i 0 pokrytych funkcji, a jego defekty są z gatunku „nic się nie wywraca,
// tylko ekran przestaje być prawdziwy":
//
//   * zgubiony agregat w MODULE_AGGREGATES = moduł cicho przestaje się odświeżać;
//   * zepsuta deduplikacja debounce'u = N ramek realtime robi N zapytań do API;
//   * timer odpalany przy UKRYTEJ karcie = nieaktywna zakładka odpytuje serwer
//     po każdej ramce (dokładnie to, czemu ma zapobiegać warunek widoczności);
//   * brak flush-a przy odmontowaniu = zaległe klucze giną i po powrocie na
//     trasę widać stan sprzed zdarzenia;
//   * zgubiony unsubscribe = kanały zostają po zmianie trasy, aż skończy się
//     limit połączeń Realtime i przestaną przychodzić zdarzenia.
//
// Dlatego asercje dotyczą REFCOUNTU I EFEKTÓW UBOCZNYCH (kanały, klucze
// inwalidacji), a nie wartości zwracanej - hook nie zwraca niczego.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import type { FakeChannel, RealtimeStub } from "@/test/supabase";

const h = vi.hoisted(() => ({
  auth: { uid: "11111111-1111-4111-a111-111111111111" as string | null },
}));

// Atrapy modułowe muszą powstać w fabryce `vi.mock` (hoisting), więc trzymamy
// je w kontenerze `vi.hoisted` i sięgamy po nie w testach przez `stubs`.
const stubs = vi.hoisted(() => ({ realtime: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const atoms = await import("@/test/supabase");
  const realtime = atoms.realtimeStub();
  stubs.realtime = realtime;
  return {
    supabase: {
      channel: realtime.channel,
      removeChannel: realtime.removeChannel,
      from: () => ({}),
      rpc: async () => ({ data: null, error: null }),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: h.auth.uid ? { id: h.auth.uid } : null,
    tenantId: "22222222-2222-4222-a222-222222222222",
  }),
}));

import {
  MODULE_AGGREGATES,
  useDebouncedInvalidation,
  useDomainEventInvalidation,
  useModuleRealtime,
  type ModuleRealtimeKey,
} from "@/lib/realtime/useModuleRealtime";
import { activeChannelCount } from "@/lib/realtime/tableChannelHub";
import { DOMAIN_AGGREGATE_TYPES, type DomainEventRow } from "@/lib/realtime/domainEvents";

const rt = () => stubs.realtime as RealtimeStub;

const LEAD_ID = "33333333-3333-4333-a333-333333333333";
const POST_ID = "44444444-4444-4444-a444-444444444444";

/** Prefiks nazwy kanału huba dla strumienia domain_events (bez losowego sufiksu). */
function hubPrefix(aggregateType?: string): string {
  const filter = aggregateType ? `aggregate_type=eq.${aggregateType}` : "";
  return `hub:public|domain_events|INSERT|${filter}:`;
}

/** Jedyny ŻYWY kanał o danym prefiksie - brak albo duplikat to od razu błąd. */
function liveChannel(aggregateType?: string): FakeChannel {
  const found = rt().liveChannels(hubPrefix(aggregateType));
  expect(found).toHaveLength(1);
  return found[0];
}

function domainEvent(overrides: Partial<DomainEventRow> = {}): DomainEventRow {
  return {
    id: "55555555-5555-4555-a555-555555555555",
    tenant_id: "22222222-2222-4222-a222-222222222222",
    aggregate_type: "crm_lead",
    aggregate_id: LEAD_ID,
    event_type: "crm_lead.created.v1",
    payload: {},
    correlation_id: null,
    actor_id: null,
    created_at: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

function emitOn(aggregateType: string | undefined, event: DomainEventRow): void {
  liveChannel(aggregateType).emitPostgres("domain_events", { eventType: "INSERT", new: event });
}

/**
 * Podmienia `invalidateQueries` na rejestrator kluczy. Interesuje nas KTÓRY
 * cache został unieważniony, a nie czy react-query wykonał refetch - to drugie
 * jest kontraktem react-query, nie tego modułu.
 */
function trackInvalidations(queryClient: QueryClient): QueryKey[] {
  const seen: QueryKey[] = [];
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async (filters) => {
    seen.push(filters?.queryKey ?? []);
  });
  return seen;
}

// happy-dom trzyma `visibilityState` jako getter na prototypie Document, więc
// test nadpisuje go WŁASNĄ właściwością instancji i kasuje ją po sobie.
let visibilityPatched = false;
function setVisibility(state: "visible" | "hidden"): void {
  visibilityPatched = true;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}
function fireVisibilityChange(): void {
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  h.auth.uid = "11111111-1111-4111-a111-111111111111";
  rt().reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (visibilityPatched) {
    Reflect.deleteProperty(document, "visibilityState");
    visibilityPatched = false;
  }
  // Hub trzyma refcount w STANIE MODUŁU. Test, który zostawi żywą subskrypcję,
  // podaje następnemu współdzielony kanał z poprzedniego przebiegu i tamten
  // zaczyna mierzyć nie to, co deklaruje.
  expect(activeChannelCount()).toBe(0);
});

describe("MODULE_AGGREGATES", () => {
  it("deklaruje agregaty dla WSZYSTKICH sześciu modułów i żadnej pustej listy", () => {
    // Pusta lista agregatów to hook, który montuje się bez błędu i nie
    // subskrybuje NICZEGO - moduł przestaje się odświeżać, a nic tego nie widać.
    const keys = Object.keys(MODULE_AGGREGATES).sort();
    expect(keys).toEqual(["chat", "club", "comments", "content", "crm", "newsletter"]);
    for (const [moduleKey, aggregates] of Object.entries(MODULE_AGGREGATES)) {
      expect(aggregates.length, `moduł ${moduleKey} bez agregatów`).toBeGreaterThan(0);
    }
  });

  it("każdy zadeklarowany agregat istnieje w katalogu agregatów szyny", () => {
    // Literówka w nazwie agregatu zbuduje filtr `aggregate_type=eq.<literówka>`,
    // który po stronie serwera nie dopasuje NICZEGO. Kanał powstaje, subskrypcja
    // działa, zdarzenia nie przychodzą - najcichsza z możliwych awarii.
    const catalogue = new Set<string>(DOMAIN_AGGREGATE_TYPES);
    for (const [moduleKey, aggregates] of Object.entries(MODULE_AGGREGATES)) {
      for (const aggregate of aggregates) {
        expect(catalogue.has(aggregate), `${moduleKey} -> ${aggregate}`).toBe(true);
      }
    }
  });

  it("nie powtarza agregatu w obrębie jednego modułu", () => {
    // Duplikat trafiłby do huba dwa razy pod TYM SAMYM kluczem specyfikacji:
    // jeden kanał, dwa handlery, czyli podwójna inwalidacja na każde zdarzenie.
    for (const [moduleKey, aggregates] of Object.entries(MODULE_AGGREGATES)) {
      expect(new Set(aggregates).size, `moduł ${moduleKey}`).toBe(aggregates.length);
    }
  });
});

describe("useDebouncedInvalidation", () => {
  it("zbija N zdarzeń w oknie do JEDNEJ inwalidacji na unikalny klucz", () => {
    const { result, queryClient, unmount } = renderHookWithQueryClient(() =>
      useDebouncedInvalidation(50),
    );
    const seen = trackInvalidations(queryClient);

    act(() => {
      result.current([["crm-leads"]]);
      result.current([["crm-leads"], ["crm-lead", LEAD_ID]]);
      result.current([["crm-leads"]]);
    });
    // Do upływu okna cache nie może zostać ruszony ANI RAZU - inaczej debounce
    // nie istnieje, a burza zdarzeń (import CSV, masowa zmiana etapu) zamienia
    // się w burzę zapytań.
    expect(seen).toEqual([]);

    act(() => vi.advanceTimersByTime(50));
    expect(seen).toEqual([["crm-leads"], ["crm-lead", LEAD_ID]]);

    unmount();
  });

  it("deduplikuje po TREŚCI klucza, nie po tożsamości tablicy", () => {
    // Klucze przychodzą z `invalidationKeysFor`, które buduje NOWE tablice na
    // każde zdarzenie. Deduplikacja po referencji nie zbiłaby niczego.
    const { result, queryClient, unmount } = renderHookWithQueryClient(() =>
      useDebouncedInvalidation(20),
    );
    const seen = trackInvalidations(queryClient);

    act(() => {
      result.current([["comments", POST_ID]]);
      result.current([["comments", POST_ID]]);
      result.current([["comments", POST_ID]]);
    });
    act(() => vi.advanceTimersByTime(20));

    expect(seen).toEqual([["comments", POST_ID]]);
    unmount();
  });

  it("pusty zestaw kluczy nie planuje niczego", () => {
    const { result, queryClient, unmount } = renderHookWithQueryClient(() =>
      useDebouncedInvalidation(20),
    );
    const seen = trackInvalidations(queryClient);

    act(() => result.current([]));
    act(() => vi.advanceTimersByTime(1000));

    expect(seen).toEqual([]);
    unmount();
  });

  it("UKRYTA karta nie odpala timera - kolejka rośnie, cache stoi", () => {
    // Sedno „visibility-aware refresh": zakładka w tle nie ma prawa odpytywać
    // API po każdej ramce realtime. Bez tego warunku dziesięć otwartych kart
    // mnoży ruch do backendu przez dziesięć.
    setVisibility("hidden");
    const { result, queryClient, unmount } = renderHookWithQueryClient(() =>
      useDebouncedInvalidation(10),
    );
    const seen = trackInvalidations(queryClient);

    act(() => result.current([["crm-leads"]]));
    act(() => vi.advanceTimersByTime(10_000));
    expect(seen).toEqual([]);

    unmount();
    // Odmontowanie i tak oddaje zaległość - patrz osobny test niżej.
    expect(seen).toEqual([["crm-leads"]]);
  });

  it("zdarzenie widoczności przy nadal ukrytej karcie NIE opróżnia kolejki", () => {
    // `visibilitychange` leci także przy przejściu widoczna -> ukryta.
    // Reakcja na samo zdarzenie, bez sprawdzenia stanu, opróżniałaby kolejkę
    // dokładnie w chwili, w której karta idzie w tło.
    setVisibility("hidden");
    const { result, queryClient, unmount } = renderHookWithQueryClient(() =>
      useDebouncedInvalidation(10),
    );
    const seen = trackInvalidations(queryClient);

    act(() => result.current([["crm-leads"]]));
    fireVisibilityChange();
    expect(seen).toEqual([]);

    unmount();
  });

  it("powrót na pierwszy plan DOGANIA zaległości natychmiast, bez czekania na timer", () => {
    setVisibility("hidden");
    const { result, queryClient, unmount } = renderHookWithQueryClient(() =>
      useDebouncedInvalidation(10_000),
    );
    const seen = trackInvalidations(queryClient);

    act(() => {
      result.current([["crm-leads"]]);
      result.current([["crm-lead", LEAD_ID]]);
    });
    expect(seen).toEqual([]);

    setVisibility("visible");
    fireVisibilityChange();
    // ZERO przesunięcia zegara: użytkownik, który wraca na kartę, ma zobaczyć
    // prawdę od razu, a nie po kolejnym oknie debounce'u.
    expect(seen).toEqual([["crm-leads"], ["crm-lead", LEAD_ID]]);

    unmount();
  });

  it("odmontowanie opróżnia kolejkę - zaległe klucze nie giną", () => {
    setVisibility("hidden");
    const { result, queryClient, unmount } = renderHookWithQueryClient(() =>
      useDebouncedInvalidation(10_000),
    );
    const seen = trackInvalidations(queryClient);

    act(() => result.current([["admin-posts"]]));
    expect(seen).toEqual([]);

    unmount();
    // Bez flush-a w cleanupie zmiana trasy w trakcie okna debounce'u gubiłaby
    // inwalidację - nowy ekran wchodziłby na cache sprzed zdarzenia.
    expect(seen).toEqual([["admin-posts"]]);
  });
});

describe("useModuleRealtime", () => {
  it("zakłada osobny filtrowany kanał dla KAŻDEGO agregatu modułu", () => {
    const { unmount } = renderHookWithQueryClient(() => useModuleRealtime("crm"));

    const aggregates = MODULE_AGGREGATES.crm;
    expect(rt().liveChannels("hub:")).toHaveLength(aggregates.length);
    for (const aggregate of aggregates) {
      const channel = liveChannel(aggregate);
      // Filtr SERWEROWY musi trafić do specyfikacji postgres_changes; bez niego
      // przeglądarka dostaje cały strumień tenanta i filtruje go u siebie.
      expect(channel.listeners[0].filter).toEqual({
        event: "INSERT",
        schema: "public",
        table: "domain_events",
        filter: `aggregate_type=eq.${aggregate}`,
      });
      expect(channel.subscribeCount).toBe(1);
    }

    unmount();
  });

  it("odmontowanie zwalnia WSZYSTKIE kanały modułu", () => {
    const { unmount } = renderHookWithQueryClient(() => useModuleRealtime("crm"));
    const opened = rt().liveChannels("hub:");
    expect(opened.length).toBeGreaterThan(1);

    unmount();

    expect(rt().liveChannels("hub:")).toEqual([]);
    for (const channel of opened) expect(channel.removed).toBe(true);
    expect(activeChannelCount()).toBe(0);
  });

  it("enabled:false nie stawia ANI JEDNEGO kanału", () => {
    const { unmount } = renderHookWithQueryClient(() =>
      useModuleRealtime("crm", { enabled: false }),
    );
    expect(rt().channels).toEqual([]);
    expect(activeChannelCount()).toBe(0);
    unmount();
  });

  it("bez zalogowanego użytkownika nie stawia kanałów", () => {
    // RLS i tak przyciąłby strumień do zera, ale websocket kosztuje kwotę
    // połączeń - anonim nie ma prawa go trzymać.
    h.auth.uid = null;
    const { unmount } = renderHookWithQueryClient(() => useModuleRealtime("crm"));
    expect(rt().channels).toEqual([]);
    unmount();
  });

  it("zdarzenie modułu unieważnia klucze wyliczone przez mapę inwalidacji", () => {
    const { queryClient, unmount } = renderHookWithQueryClient(() => useModuleRealtime("crm"));
    const seen = trackInvalidations(queryClient);

    act(() => emitOn("crm_lead", domainEvent()));
    act(() => vi.advanceTimersByTime(250));

    // Reguła `crm_lead.created.v1` z eventInvalidationMap: lista leadów, karta
    // leada i licznik kolejki staffu.
    expect(seen).toEqual([["crm-leads"], ["crm-lead", LEAD_ID], ["pending-counters", "tenant"]]);

    unmount();
  });

  it("nieznany typ zdarzenia nie unieważnia niczego i nie wywraca strumienia", () => {
    // Nowszy backend emitujący typ nieznany temu bundle'owi nie może wywrócić
    // subskrypcji - mapa zwraca pustą listę, a kanał żyje dalej.
    const onEvent = vi.fn();
    const { queryClient, unmount } = renderHookWithQueryClient(() =>
      useModuleRealtime("crm", { onEvent }),
    );
    const seen = trackInvalidations(queryClient);

    act(() => emitOn("crm_lead", domainEvent({ event_type: "crm_lead.teleported.v9" })));
    act(() => vi.advanceTimersByTime(250));

    expect(seen).toEqual([]);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(liveChannel("crm_lead").removed).toBe(false);

    unmount();
  });

  it("onEvent dostaje KAŻDE zdarzenie modułu, a zmiana jego referencji nie przepina kanału", () => {
    // Handler bywa budowany w ciele komponentu (nowa funkcja co render). Gdyby
    // trafiał do tablicy zależności efektu, każdy render zrywałby websocket
    // i zakładał nowy - migotanie subskrypcji i gubione zdarzenia.
    const first = vi.fn();
    const second = vi.fn();
    const holder = { onEvent: first };
    const { rerender, unmount } = renderHookWithQueryClient(() =>
      useModuleRealtime("newsletter", { onEvent: holder.onEvent }),
    );

    const channelBefore = liveChannel("newsletter_subscriber");
    act(() =>
      emitOn("newsletter_subscriber", domainEvent({ aggregate_type: "newsletter_subscriber" })),
    );
    expect(first).toHaveBeenCalledTimes(1);

    holder.onEvent = second;
    act(() => rerender());

    const channelAfter = liveChannel("newsletter_subscriber");
    expect(channelAfter).toBe(channelBefore);
    expect(channelAfter.subscribeCount).toBe(1);

    act(() =>
      emitOn("newsletter_subscriber", domainEvent({ aggregate_type: "newsletter_subscriber" })),
    );
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("dwa moduły dzielące agregat dzielą JEDEN kanał, a odejście jednego go nie zabiera", () => {
    // crm i newsletter mają wspólny agregat newsletter_subscriber. To jest
    // sedno refcountu huba: pierwszy odchodzący nie może zamknąć kanału, na
    // którym nadal wisi drugi ekran.
    const crm = renderHookWithQueryClient(() => useModuleRealtime("crm"));
    const newsletter = renderHookWithQueryClient(() => useModuleRealtime("newsletter"));

    expect(rt().liveChannels("hub:")).toHaveLength(MODULE_AGGREGATES.crm.length);
    const shared = liveChannel("newsletter_subscriber");

    newsletter.unmount();
    expect(shared.removed).toBe(false);
    expect(rt().liveChannels("hub:")).toHaveLength(MODULE_AGGREGATES.crm.length);

    crm.unmount();
    expect(shared.removed).toBe(true);
    expect(activeChannelCount()).toBe(0);
  });

  it("moduł klubów subskrybuje wszystkie trzy agregaty (tabele club_* są deny-all)", () => {
    // Dla klubów szyna zdarzeń jest JEDYNYM kanałem - postgres_changes na
    // tabelach club_* nie dostarczyłby nic, bo RLS jest tam deny-all.
    const { unmount } = renderHookWithQueryClient(() => useModuleRealtime("club"));
    for (const aggregate of MODULE_AGGREGATES.club) expect(liveChannel(aggregate)).toBeDefined();
    expect(rt().liveChannels("hub:")).toHaveLength(3);
    unmount();
  });

  it("przełączenie modułu zwalnia kanały poprzedniego", () => {
    const holder: { moduleKey: ModuleRealtimeKey } = { moduleKey: "content" };
    const { rerender, unmount } = renderHookWithQueryClient(() =>
      useModuleRealtime(holder.moduleKey),
    );
    const postChannel = liveChannel("post");

    holder.moduleKey = "comments";
    act(() => rerender());

    expect(postChannel.removed).toBe(true);
    expect(liveChannel("comment")).toBeDefined();
    expect(rt().liveChannels("hub:")).toHaveLength(1);

    unmount();
  });
});

describe("useDomainEventInvalidation", () => {
  it("stawia JEDEN kanał BEZ filtra agregatu", () => {
    // Globalny mostek słucha całej szyny - filtr serwerowy przyciąłby strumień
    // do jednego agregatu, a mapa inwalidacji obsługuje wszystkie.
    const { unmount } = renderHookWithQueryClient(() => useDomainEventInvalidation());

    expect(rt().liveChannels("hub:")).toHaveLength(1);
    const spec = liveChannel().listeners[0].filter;
    expect(spec).toEqual({ event: "INSERT", schema: "public", table: "domain_events" });
    expect("filter" in spec).toBe(false);

    unmount();
    expect(activeChannelCount()).toBe(0);
  });

  it("przepuszcza zdarzenie przez mapę inwalidacji z identyfikatorem użytkownika", () => {
    const { queryClient, unmount } = renderHookWithQueryClient(() => useDomainEventInvalidation());
    const seen = trackInvalidations(queryClient);

    act(() =>
      emitOn(
        undefined,
        domainEvent({
          aggregate_type: "comment",
          event_type: "comment.created.v1",
          payload: { post_id: POST_ID },
        }),
      ),
    );
    act(() => vi.advanceTimersByTime(250));

    expect(seen).toEqual([
      ["comments", POST_ID],
      ["pending-counters", "tenant"],
    ]);

    unmount();
  });

  it("klucze per-użytkownik biorą identyfikator z sesji, nie z payloadu", () => {
    // Gdyby konsument gubił `userId`, licznik nieprzeczytanych odświeżałby się
    // pod kluczem „anon" - badge zostawałby stary do przeładowania strony.
    const { queryClient, unmount } = renderHookWithQueryClient(() => useDomainEventInvalidation());
    const seen = trackInvalidations(queryClient);

    act(() =>
      emitOn(undefined, domainEvent({ aggregate_type: "message", event_type: "message.sent.v1" })),
    );
    act(() => vi.advanceTimersByTime(250));

    expect(seen).toContainEqual(["pending-counters", "user", h.auth.uid]);

    unmount();
  });

  it("bez zalogowanego użytkownika nie stawia kanału", () => {
    h.auth.uid = null;
    const { unmount } = renderHookWithQueryClient(() => useDomainEventInvalidation());
    expect(rt().channels).toEqual([]);
    unmount();
  });
});
