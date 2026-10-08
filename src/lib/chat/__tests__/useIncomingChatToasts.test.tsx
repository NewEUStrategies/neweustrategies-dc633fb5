// Globalne toasty „ktoś do Ciebie napisał" - jedyna powierzchnia czatu, która
// żyje POZA oknem rozmowy i dlatego jako jedyna może pokazać treść wiadomości
// na ekranie, na którym użytkownik jej nie oczekuje.
//
// ŹRÓDŁO. Hak słucha WŁASNYCH wierszy `conversation_participants`
// (`user_id=eq.<uid>`), a nie INSERT-ów `messages`. Poprzednia subskrypcja
// `messages` dawała personelowi (polityka `messages_staff_read`) toasty
// z treścią cudzych prywatnych rozmów. Dowody poniżej pilnują, że:
//  - kanał na `messages` w ogóle nie powstaje, a cudzy wiersz uczestnika
//    nie kosztuje odczytu, RPC ani zdarzenia (sekcja „tylko własne rozmowy");
//  - nowa wiadomość to wzrost `unread_count`, a pierwsze zdarzenie rozmowy
//    wymaga podpisu transakcji triggera (`updated_at` = `last_message_at`);
//  - toast ma identyfikator rozmowy, a koniec sesji zdejmuje toasty i pamięć.
//
// KONTRAKT REFCOUNTU. Hak montuje `WorkspaceDock` (raz na sesję członka),
// ale każda dodatkowa powierzchnia może go wywołać obok, a kanał ma być
// JEDEN - wspólny z listą rozmów, bo specyfikacja jest ta sama.
//
// Montaż w prawdziwym pasku (zalogowany tak, gość nie, preferencje, otwarta
// rozmowa bez toasta, akcja toasta) dowodzi
// `dock/__tests__/WorkspaceDock.incomingToasts`.
//
// RODO: rozmówcy to identyfikatory z `CHAT_IDS`, treści zmyślone.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import {
  CHAT_IDS,
  conversationRow,
  fail,
  groupConversationRow,
  ok,
  participantRow,
  peerProfile,
  realtimeStub,
  supabaseFromStub,
} from "@/test/chat/fixtures";
import type { ConversationRow, ParticipantRow } from "@/lib/chat/types";
import type { FakeChannel, RecordedChain } from "@/test/supabase";
import type { IncomingChatMessage } from "../useIncomingChatToasts";

interface ToastCall {
  readonly title: string;
  readonly options: {
    id?: string;
    description?: string;
    action?: { label: string; onClick: () => void };
  };
}

const h = vi.hoisted(() => ({
  uid: "user-me" as string | null,
  toasts: [] as ToastCall[],
  dismissed: [] as string[],
  rpc: vi.fn(),
  realtime: null as unknown,
  from: null as unknown,
  /** Wiersze `conversations` zwracane przez select podglądu. */
  conversations: new Map<string, ConversationRow>(),
  /**
   * Emulacja realtime-js 2.x: `supabase.channel(nazwa)` oddaje ISTNIEJĄCY
   * obiekt o tej nazwie, dopóki serwer nie potwierdzi opuszczenia, a samo
   * `removeChannel` kończy się dopiero po tym potwierdzeniu (asynchronicznie).
   */
  emulateLeaveAck: false,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.uid ? { id: h.uid } : null }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(
    (title: string, options: ToastCall["options"]) => {
      h.toasts.push({ title, options });
      return options.id;
    },
    {
      error: vi.fn(),
      success: vi.fn(),
      dismiss: (id: string) => {
        h.dismissed.push(id);
      },
    },
  ),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/chat/fixtures");
  const realtime = fixtures.realtimeStub();
  const from = fixtures.supabaseFromStub();
  h.realtime = realtime;
  h.from = from;
  return {
    supabase: {
      channel: (name: string, config?: Record<string, unknown>) =>
        (h.emulateLeaveAck ? realtime.liveChannels().find((c) => c.name === name) : undefined) ??
        realtime.channel(name, config),
      removeChannel: (channel: FakeChannel) =>
        h.emulateLeaveAck
          ? Promise.resolve().then(() => realtime.removeChannel(channel))
          : realtime.removeChannel(channel),
      from: from.from,
      rpc: (fn: string, args: unknown) => h.rpc(fn, args),
    },
  };
});

import {
  dismissIncomingChatToast,
  onIncomingChatMessage,
  useIncomingChatToasts,
} from "../useIncomingChatToasts";
import { useChatListRealtime } from "../useConversations";

type RealtimeStub = ReturnType<typeof realtimeStub>;
type FromStub = ReturnType<typeof supabaseFromStub>;

const realtime = () => h.realtime as RealtimeStub;
const from = () => h.from as FromStub;

const t = chatPl.chat;

/** Prefiks nazwy kanału w hubie: własne wiersze uczestnika (każde zdarzenie). */
function channelPrefix(uid: string | null = h.uid): string {
  return `hub:public|conversation_participants|*|user_id=eq.${uid}:`;
}

/** ŻYWY kanał tego użytkownika (jeden na sesję, refcountowany). */
function participantsChannel() {
  const [channel] = realtime().liveChannels(channelPrefix());
  if (!channel) throw new Error("test: kanał wierszy uczestnika nie powstał");
  return channel;
}

let seq = 0;
/** Unikalny identyfikator - stan rozmów żyje w module przez całą sesję. */
function fresh(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

/** Kolejne znaczniki czasu wiadomości (rosnące, z dokładnością do ms). */
let clock = Date.parse("2026-10-08T12:00:00.000Z");
function nextIso(): string {
  clock += 1000;
  return new Date(clock).toISOString();
}

/** Zmiana własnego wiersza uczestnika - to, co przysyła Realtime. */
function emitParticipant(
  overrides: Partial<ParticipantRow>,
  eventType: "INSERT" | "UPDATE" = "UPDATE",
): void {
  act(() => {
    participantsChannel().emitPostgres("conversation_participants", {
      eventType,
      new: participantRow({ user_id: CHAT_IDS.me, ...overrides }),
    });
  });
}

interface Delivery {
  readonly conversationId: string;
  readonly unread: number;
  readonly body?: string | null;
  readonly kind?: string;
  readonly sender?: string;
  readonly mutedUntil?: string | null;
  readonly conversation?: Partial<ConversationRow>;
}

/**
 * Wiadomość od rozmówcy dokładnie tak, jak ją zapisuje trigger
 * `messages_after_insert`: rozmowa dostaje `last_message_*`, a wiersz
 * odbiorcy podbity licznik i `updated_at` z tej samej transakcji.
 */
function deliver(delivery: Delivery): string {
  const at = nextIso();
  h.conversations.set(
    delivery.conversationId,
    conversationRow({
      id: delivery.conversationId,
      last_message_at: at,
      last_message_kind: delivery.kind ?? "text",
      last_message_preview: delivery.body === undefined ? "Spotkanie o dziesiątej" : delivery.body,
      last_message_sender: delivery.sender ?? CHAT_IDS.peer,
      ...delivery.conversation,
    }),
  );
  emitParticipant({
    conversation_id: delivery.conversationId,
    unread_count: delivery.unread,
    updated_at: at,
    muted_until: delivery.mutedUntil ?? null,
  });
  return at;
}

/** Odczekanie na asynchroniczną obsługę (podgląd rozmowy -> profil -> toast). */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Znacznik liczony od REALNEGO zegara. Wyciszenie porównuje się z `Date.now()`.
 */
function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Selecty podglądu rozmowy (jeden łańcuch = jedno żądanie). */
function conversationReads(): RecordedChain[] {
  return from().chainsFor("conversations");
}

function peerCalls(): unknown[][] {
  return h.rpc.mock.calls.filter(([fn]) => fn === "get_chat_peers");
}

/** Znacznik otwartej rozmowy i (opcjonalnie) skupiona, widoczna karta. */
function openConversation(conversationId: string, focused = true): void {
  const marker = document.createElement("div");
  marker.setAttribute("data-active-conversation", conversationId);
  document.body.append(marker);
  vi.spyOn(document, "hasFocus").mockReturnValue(focused);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
}

/** RPC profilu trzymane do ręcznego zwolnienia - okno „odczyty trwają". */
function deferredPeers() {
  const pending: Array<() => void> = [];
  h.rpc = vi.fn(
    () =>
      new Promise((resolve) => {
        pending.push(() => resolve(ok([peerProfile({ display_name: "Zofia Testowa" })])));
      }),
  );
  return {
    release: () => {
      for (const resolve of pending.splice(0)) resolve();
    },
  };
}

beforeEach(() => {
  h.uid = CHAT_IDS.me;
  h.emulateLeaveAck = false;
  h.toasts = [];
  h.dismissed = [];
  h.conversations = new Map();
  h.rpc = vi.fn(async () => ok([peerProfile({ display_name: "Zofia Testowa" })]));
  realtime().reset();
  from().reset();
  from().setResponse("conversations", (chain) => {
    const [, id] = chain.argsOf("eq") ?? [];
    return ok(h.conversations.get(String(id)) ?? null);
  });
  document.body.innerHTML = "";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("cykl życia kanału", () => {
  it("montowanie otwiera DOKŁADNIE jeden kanał własnych wierszy, odmontowanie go zwalnia", () => {
    const { unmount } = renderHook(() => useIncomingChatToasts());
    expect(realtime().liveChannels(channelPrefix())).toHaveLength(1);
    expect(participantsChannel().subscribeCount).toBe(1);
    expect(
      participantsChannel().listeners.find((l) => l.type === "postgres_changes")?.filter,
    ).toMatchObject({
      event: "*",
      schema: "public",
      table: "conversation_participants",
      filter: `user_id=eq.${CHAT_IDS.me}`,
    });

    unmount();
    expect(realtime().liveChannels(channelPrefix())).toHaveLength(0);
  });

  it("kanał jest WSPÓLNY z listą rozmów - toasty nie dokładają kanału", () => {
    // Lista po montażu planuje potwierdzenie dostarczenia (800 ms). Zegar
    // atrapowany, żeby to RPC nie wpadło do atrapy kolejnego testu.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(
      () => {
        useChatListRealtime();
        useIncomingChatToasts();
      },
      { wrapper },
    );
    expect(realtime().channels).toHaveLength(1);
    expect(realtime().liveChannels(channelPrefix())).toHaveLength(1);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("trzy montaże naraz trzymają JEDEN websocket, zwalniany dopiero przy ostatnim", () => {
    const first = renderHook(() => useIncomingChatToasts());
    const second = renderHook(() => useIncomingChatToasts());
    const third = renderHook(() => useIncomingChatToasts());
    expect(realtime().channels).toHaveLength(1);

    first.unmount();
    second.unmount();
    expect(realtime().liveChannels(channelPrefix())).toHaveLength(1);

    third.unmount();
    expect(realtime().liveChannels(channelPrefix())).toHaveLength(0);
  });

  it("ponowny montaż, zanim serwer potwierdzi opuszczenie kanału, nadal doręcza", async () => {
    h.emulateLeaveAck = true;
    renderHook(() => useIncomingChatToasts()).unmount();
    renderHook(() => useIncomingChatToasts());
    await settle();

    expect(realtime().liveChannels(channelPrefix())).toHaveLength(1);
    deliver({ conversationId: fresh("conv-remount"), unread: 1 });
    await waitFor(() => expect(h.toasts).toHaveLength(1));
  });

  it("enabled=false nie otwiera kanału, a wyłączenie w trakcie sesji go zwalnia", () => {
    const { rerender } = renderHook(({ enabled }) => useIncomingChatToasts(enabled), {
      initialProps: { enabled: false },
    });
    expect(realtime().channels).toHaveLength(0);

    rerender({ enabled: true });
    expect(realtime().liveChannels(channelPrefix())).toHaveLength(1);

    rerender({ enabled: false });
    expect(realtime().liveChannels(channelPrefix())).toHaveLength(0);
  });

  it("anonim nie otwiera żadnego kanału", () => {
    h.uid = null;
    renderHook(() => useIncomingChatToasts());
    expect(realtime().channels).toHaveLength(0);
  });
});

describe("tylko własne rozmowy (personel nie widzi cudzych)", () => {
  it("hak NIE subskrybuje tabeli `messages` - tam RLS personelu przepuszcza cały tenant", () => {
    renderHook(() => useIncomingChatToasts());
    const tables = realtime()
      .liveChannels()
      .flatMap((channel) => channel.listeners.map((l) => l.filter.table));
    expect(tables).not.toContain("messages");
    expect(tables).toEqual(["conversation_participants"]);
  });

  it("cudzy wiersz uczestnika (rozmowa, w której nie jestem): zero toastów, odczytów, RPC i zdarzeń", async () => {
    // Redaktor czy administrator czyta polityką personelu wiersze innych
    // członków. Gdyby serwer przepuścił taki wiersz mimo filtra, hak i tak
    // nie może z niego zrobić toasta.
    const conversationId = fresh("conv-foreign");
    h.conversations.set(
      conversationId,
      conversationRow({ id: conversationId, last_message_preview: "prywatna treść" }),
    );
    const seen: IncomingChatMessage[] = [];
    const off = onIncomingChatMessage((message) => seen.push(message));
    renderHook(() => useIncomingChatToasts());

    emitParticipant({
      conversation_id: conversationId,
      user_id: CHAT_IDS.stranger,
      unread_count: 1,
    });
    // Wiadomość z cudzej rozmowy nie ma tu nawet kanału, którym mogłaby przyjść.
    act(() => {
      participantsChannel().emitPostgres("messages", {
        eventType: "INSERT",
        new: { id: "msg-foreign", conversation_id: conversationId, sender_id: CHAT_IDS.peer },
      });
    });
    await settle();

    expect(h.toasts).toHaveLength(0);
    expect(from().chains).toHaveLength(0);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
    off();
  });
});

describe("rozpoznawanie nowej wiadomości", () => {
  it("wiadomość od rozmówcy: nazwa nadawcy, podgląd, akcja i JEDEN odczyt rozmowy", async () => {
    const conversationId = fresh("conv-new");
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId, unread: 1, body: "Masz chwilę?" });

    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0]?.title).toBe("Zofia Testowa");
    expect(h.toasts[0]?.options.description).toBe("Masz chwilę?");
    expect(h.toasts[0]?.options.action?.label).toBe(t.incoming.open);
    expect(h.toasts[0]?.options.id).toBe(`chat-incoming:${conversationId}`);
    expect(conversationReads()).toHaveLength(1);
    expect(conversationReads()[0]?.argsOf("eq")).toEqual(["id", conversationId]);
    // Wyciszenie przyszło w ładunku zdarzenia - żadnego odczytu uczestnika.
    expect(from().chainsFor("conversation_participants")).toHaveLength(0);
  });

  it("pierwsze zdarzenie rozmowy BEZ podpisu wiadomości (potwierdzenie dostarczenia) nie daje toasta", async () => {
    // Lista rozmów po montażu potwierdza dostarczenie zaległych wiadomości:
    // licznik > 0, ale `updated_at` to chwila potwierdzenia, nie wiadomości.
    const conversationId = fresh("conv-ack");
    h.conversations.set(conversationId, conversationRow({ id: conversationId }));
    renderHook(() => useIncomingChatToasts());

    emitParticipant({
      conversation_id: conversationId,
      unread_count: 3,
      updated_at: nextIso(),
      last_delivered_at: conversationRow().last_message_at,
    });
    await settle();

    expect(h.toasts).toHaveLength(0);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(conversationReads()).toHaveLength(1);
  });

  it("zdarzenie bez wzrostu licznika (dostarczenie, przypięcie) nie kosztuje nawet odczytu", async () => {
    const conversationId = fresh("conv-steady");
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId, unread: 2 });
    await waitFor(() => expect(h.toasts).toHaveLength(1));

    emitParticipant({ conversation_id: conversationId, unread_count: 2, updated_at: nextIso() });
    emitParticipant({
      conversation_id: conversationId,
      unread_count: 2,
      pinned_at: nextIso(),
      updated_at: nextIso(),
    });
    await settle();

    expect(h.toasts).toHaveLength(1);
    expect(conversationReads()).toHaveLength(1);
  });

  it("znany punkt odniesienia: każdy wzrost licznika to nowa wiadomość", async () => {
    const conversationId = fresh("conv-known");
    renderHook(() => useIncomingChatToasts());
    emitParticipant({ conversation_id: conversationId, unread_count: 0 }, "INSERT");
    deliver({ conversationId, unread: 1, body: "Pierwsza" });
    await waitFor(() => expect(h.toasts).toHaveLength(1));

    deliver({ conversationId, unread: 2, body: "Druga" });
    await waitFor(() => expect(h.toasts).toHaveLength(2));
    expect(h.toasts[1]?.options.description).toBe("Druga");
  });

  it("WŁASNA wiadomość jako ostatnia w rozmowie nie robi toasta", async () => {
    const seen: IncomingChatMessage[] = [];
    const off = onIncomingChatMessage((message) => seen.push(message));
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId: fresh("conv-own"), unread: 1, sender: CHAT_IDS.me });
    await settle();

    expect(h.toasts).toHaveLength(0);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
    off();
  });

  it("wiadomość COFNIĘTA nie pokazuje treści ani nie budzi dzwonka", async () => {
    const seen: IncomingChatMessage[] = [];
    const off = onIncomingChatMessage((message) => seen.push(message));
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId: fresh("conv-deleted"), unread: 1, kind: "deleted", body: null });
    await settle();

    expect(h.toasts).toHaveLength(0);
    expect(seen).toHaveLength(0);
    off();
  });

  it("błąd odczytu podglądu rozmowy: bez toasta i bez RPC (prywatność przed kompletnością)", async () => {
    from().setResponse("conversations", fail("boom"));
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId: fresh("conv-read-error"), unread: 1 });
    await settle();

    expect(conversationReads()).toHaveLength(1);
    expect(h.toasts).toHaveLength(0);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("to samo zdarzenie dwa razy daje JEDEN toast", async () => {
    const conversationId = fresh("conv-dup");
    renderHook(() => useIncomingChatToasts());
    const at = deliver({ conversationId, unread: 1 });
    emitParticipant({ conversation_id: conversationId, unread_count: 1, updated_at: at });
    await settle();

    expect(h.toasts).toHaveLength(1);
  });
});

describe("bramki widoczności", () => {
  it("otwarta i skupiona rozmowa: bez toasta, bez odczytu i bez zdarzenia dla dzwonka", async () => {
    const conversationId = fresh("conv-focused");
    openConversation(conversationId);
    const seen: IncomingChatMessage[] = [];
    const off = onIncomingChatMessage((message) => seen.push(message));
    renderHook(() => useIncomingChatToasts());

    deliver({ conversationId, unread: 1 });
    await settle();

    expect(h.toasts).toHaveLength(0);
    expect(conversationReads()).toHaveLength(0);
    expect(seen).toHaveLength(0);
    off();
  });

  it("okno otwarte, ale karta w tle - toast MA się pokazać", async () => {
    const conversationId = fresh("conv-bg");
    openConversation(conversationId, false);
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId, unread: 1 });
    await waitFor(() => expect(h.toasts).toHaveLength(1));
  });

  it("INNA otwarta rozmowa nie ucisza toasta z tej, która przyszła", async () => {
    openConversation(fresh("conv-other-open"));
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId: fresh("conv-incoming"), unread: 1 });
    await waitFor(() => expect(h.toasts).toHaveLength(1));
  });

  it("rozmowa otwarta i skupiona W TRAKCIE odczytów nie dostaje spóźnionego toasta", async () => {
    const conversationId = fresh("conv-late-open");
    const peers = deferredPeers();
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId, unread: 1, sender: fresh("user-late-open") });
    await waitFor(() => expect(peerCalls()).toHaveLength(1));

    openConversation(conversationId);
    peers.release();
    await settle();

    expect(h.toasts).toHaveLength(0);
  });

  it("toast spóźniony za zakończeniem sesji przepada", async () => {
    const peers = deferredPeers();
    const { unmount } = renderHook(() => useIncomingChatToasts());
    deliver({ conversationId: fresh("conv-logout"), unread: 1, sender: fresh("user-late") });
    await waitFor(() => expect(peerCalls()).toHaveLength(1));

    unmount();
    peers.release();
    await settle();

    expect(h.toasts).toHaveLength(0);
  });
});

describe("wyciszenie rozmowy (z ładunku zdarzenia)", () => {
  it("wyciszona rozmowa milczy i nie kosztuje żadnego odczytu", async () => {
    const seen: IncomingChatMessage[] = [];
    const off = onIncomingChatMessage((message) => seen.push(message));
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId: fresh("conv-muted"), unread: 1, mutedUntil: minutesFromNow(60) });
    await settle();

    expect(h.toasts).toHaveLength(0);
    expect(from().chains).toHaveLength(0);
    expect(seen).toHaveLength(0);
    off();
  });

  it("wyciszenie „na zawsze” (`infinity`) też milczy", async () => {
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId: fresh("conv-forever"), unread: 1, mutedUntil: "infinity" });
    await settle();
    expect(h.toasts).toHaveLength(0);
  });

  it("wyciszenie, które WYGASŁO, nie ucisza niczego", async () => {
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId: fresh("conv-expired"), unread: 1, mutedUntil: minutesFromNow(-60) });
    await waitFor(() => expect(h.toasts).toHaveLength(1));
  });

  it("wyciszenie w trakcie sesji działa od NASTĘPNEJ wiadomości, bez pamięci do unieważniania", async () => {
    const conversationId = fresh("conv-mute-live");
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId, unread: 1 });
    await waitFor(() => expect(h.toasts).toHaveLength(1));

    // `chat_set_muted` zmienia wiersz: licznik bez zmian, więc bez toasta.
    const until = minutesFromNow(60);
    emitParticipant({
      conversation_id: conversationId,
      unread_count: 1,
      muted_until: until,
      updated_at: nextIso(),
    });
    deliver({ conversationId, unread: 2, mutedUntil: until });
    await settle();

    expect(h.toasts).toHaveLength(1);
  });
});

describe("jeden toast na rozmowę i sprzątanie", () => {
  it("seria wiadomości jednej rozmowy podmienia toast w miejscu i pokazuje najnowszą", async () => {
    const conversationId = fresh("conv-burst");
    const peers = deferredPeers();
    renderHook(() => useIncomingChatToasts());

    deliver({ conversationId, unread: 1, body: "Pierwsza" });
    await waitFor(() => expect(peerCalls()).toHaveLength(1));
    deliver({ conversationId, unread: 2, body: "Druga" });
    deliver({ conversationId, unread: 3, body: "Trzecia" });
    peers.release();
    await waitFor(() => expect(h.toasts.at(-1)?.options.description).toBe("Trzecia"));
    peers.release();
    await settle();

    const ids = new Set(h.toasts.map((call) => call.options.id));
    expect(ids).toEqual(new Set([`chat-incoming:${conversationId}`]));
    // Odczyt w locie + JEDNO powtórzenie dla całej reszty serii, jedno RPC profilu.
    expect(conversationReads()).toHaveLength(2);
    expect(peerCalls()).toHaveLength(1);
  });

  it("dwie rozmowy to dwa niezależne toasty", async () => {
    const a = fresh("conv-a");
    const b = fresh("conv-b");
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId: a, unread: 1 });
    deliver({ conversationId: b, unread: 1 });
    await waitFor(() => expect(h.toasts).toHaveLength(2));
    expect(h.toasts.map((call) => call.options.id).sort()).toEqual(
      [`chat-incoming:${a}`, `chat-incoming:${b}`].sort(),
    );
  });

  it("przeczytanie rozmowy (licznik 0, także w innej karcie) zdejmuje jej toast", async () => {
    const conversationId = fresh("conv-read");
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId, unread: 1 });
    await waitFor(() => expect(h.toasts).toHaveLength(1));

    emitParticipant({ conversation_id: conversationId, unread_count: 0, updated_at: nextIso() });
    expect(h.dismissed).toEqual([`chat-incoming:${conversationId}`]);
  });

  it("`dismissIncomingChatToast` zdejmuje tylko toast pokazany w tej sesji", async () => {
    const conversationId = fresh("conv-open-bus");
    renderHook(() => useIncomingChatToasts());
    dismissIncomingChatToast(conversationId);
    expect(h.dismissed).toEqual([]);

    deliver({ conversationId, unread: 1 });
    await waitFor(() => expect(h.toasts).toHaveLength(1));
    dismissIncomingChatToast(conversationId);
    dismissIncomingChatToast(conversationId);
    expect(h.dismissed).toEqual([`chat-incoming:${conversationId}`]);
  });

  it("koniec sesji (wylogowanie, zejście doku) zdejmuje WSZYSTKIE toasty tej sesji", async () => {
    const a = fresh("conv-end-a");
    const b = fresh("conv-end-b");
    const { unmount } = renderHook(() => useIncomingChatToasts());
    deliver({ conversationId: a, unread: 1 });
    deliver({ conversationId: b, unread: 1 });
    await waitFor(() => expect(h.toasts).toHaveLength(2));

    unmount();
    expect(h.dismissed.sort()).toEqual([`chat-incoming:${a}`, `chat-incoming:${b}`].sort());
  });

  it("zmiana konta w tej samej karcie zdejmuje toasty poprzedniego", async () => {
    const conversationId = fresh("conv-switch");
    const { rerender } = renderHook(() => useIncomingChatToasts());
    deliver({ conversationId, unread: 1 });
    await waitFor(() => expect(h.toasts).toHaveLength(1));

    h.uid = CHAT_IDS.peerTwo;
    rerender();
    expect(h.dismissed).toEqual([`chat-incoming:${conversationId}`]);
    expect(realtime().liveChannels(channelPrefix(CHAT_IDS.me))).toHaveLength(0);
    expect(realtime().liveChannels(channelPrefix(CHAT_IDS.peerTwo))).toHaveLength(1);
  });
});

describe("tożsamość nadawcy", () => {
  it("profil nadawcy jest pamiętany - druga wiadomość nie pyta RPC drugi raz", async () => {
    const sender = fresh("user-cache-peer");
    h.rpc = vi.fn(async () => ok([peerProfile({ id: sender, display_name: "Zofia Testowa" })]));
    renderHook(() => useIncomingChatToasts());

    deliver({ conversationId: fresh("conv-p1"), unread: 1, sender });
    await waitFor(() => expect(h.toasts).toHaveLength(1));
    deliver({ conversationId: fresh("conv-p2"), unread: 1, sender });
    await waitFor(() => expect(h.toasts).toHaveLength(2));

    expect(peerCalls()).toHaveLength(1);
    expect(h.rpc).toHaveBeenCalledWith("get_chat_peers", { p_user_ids: [sender] });
  });

  it("równoległe wiadomości tego samego nadawcy w dwóch rozmowach dzielą JEDNO RPC", async () => {
    const sender = fresh("user-inflight");
    const peers = deferredPeers();
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId: fresh("conv-i1"), unread: 1, sender });
    deliver({ conversationId: fresh("conv-i2"), unread: 1, sender });
    await waitFor(() => expect(conversationReads()).toHaveLength(2));
    await settle();
    peers.release();

    await waitFor(() => expect(h.toasts).toHaveLength(2));
    expect(peerCalls()).toHaveLength(1);
  });

  it("nierozpoznany nadawca: neutralna etykieta i krótka pamięć braku (bez RPC przy każdej wiadomości)", async () => {
    h.rpc = vi.fn(async () => ok([]));
    const sender = fresh("user-nieznany");
    renderHook(() => useIncomingChatToasts());

    deliver({ conversationId: fresh("conv-u1"), unread: 1, sender });
    await waitFor(() => expect(h.toasts).toHaveLength(1));
    deliver({ conversationId: fresh("conv-u2"), unread: 1, sender });
    await waitFor(() => expect(h.toasts).toHaveLength(2));

    expect(h.toasts[0]?.title).toBe(t.incoming.someone);
    expect(h.toasts[0]?.title).not.toContain(sender);
    expect(peerCalls()).toHaveLength(1);
  });

  it("pamięć profili nie przeżywa sesji - po ponownym zalogowaniu RPC idzie znowu", async () => {
    const sender = fresh("user-session");
    const first = renderHook(() => useIncomingChatToasts());
    deliver({ conversationId: fresh("conv-s1"), unread: 1, sender });
    await waitFor(() => expect(h.toasts).toHaveLength(1));
    first.unmount();

    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId: fresh("conv-s2"), unread: 1, sender });
    await waitFor(() => expect(h.toasts).toHaveLength(2));
    expect(peerCalls()).toHaveLength(2);
  });

  it("w kręgu tytuł niesie nazwę kręgu, nie tylko nadawcę", async () => {
    const conversationId = fresh("conv-group");
    renderHook(() => useIncomingChatToasts());
    const circle = groupConversationRow({ id: conversationId, title: "Krąg energetyczny" });
    deliver({
      conversationId,
      unread: 1,
      conversation: { kind: circle.kind, title: circle.title, direct_key: circle.direct_key },
    });
    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0]?.title).toBe("Zofia Testowa · Krąg energetyczny");
  });

  it("akcja toasta otwiera DOKŁADNIE tę rozmowę", async () => {
    const conversationId = fresh("conv-open");
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId, unread: 1 });
    await waitFor(() => expect(h.toasts).toHaveLength(1));

    const opened: string[] = [];
    const listener = (event: Event) => {
      opened.push((event as CustomEvent<{ conversationId: string }>).detail.conversationId);
    };
    window.addEventListener("nes:open-chat", listener);
    h.toasts[0]?.options.action?.onClick();
    window.removeEventListener("nes:open-chat", listener);

    expect(opened).toEqual([conversationId]);
  });
});

describe("podgląd treści", () => {
  async function previewOf(delivery: Omit<Delivery, "conversationId" | "unread">) {
    renderHook(() => useIncomingChatToasts());
    deliver({ conversationId: fresh("conv-prev"), unread: 1, ...delivery });
    await waitFor(() => expect(h.toasts).toHaveLength(1));
    return h.toasts[0]?.options.description;
  }

  it("zdjęcie bez podpisu ma własny zastępnik", async () => {
    expect(await previewOf({ kind: "image", body: null })).toBe(t.photo);
  });

  it("zdjęcie z podpisem skleja oba człony", async () => {
    expect(await previewOf({ kind: "image", body: "Wykres zużycia" })).toBe(
      `${t.photo} - Wykres zużycia`,
    );
  });

  it("plik pokazuje nazwę albo podpis z podglądu rozmowy", async () => {
    expect(await previewOf({ kind: "file", body: "raport-kwartalny.pdf" })).toBe(
      `${t.file}: raport-kwartalny.pdf`,
    );
  });

  it("plik bez podglądu nie produkuje „Plik: null”", async () => {
    expect(await previewOf({ kind: "file", body: null })).toBe(t.file);
  });

  it("notatka głosowa nazywa się notatką głosową", async () => {
    expect(await previewOf({ kind: "audio", body: null })).toBe(t.voice.message);
  });

  it("długa treść jest ucinana z wielokropkiem, a nie wylewa się na ekran", async () => {
    const preview = await previewOf({ body: "z".repeat(140) });
    expect(preview).toHaveLength(120);
    expect(preview?.endsWith("...")).toBe(true);
  });

  it("długi PODPIS załącznika też jest ucinany - limit obejmuje cały wynik", async () => {
    const preview = await previewOf({ kind: "image", body: "a".repeat(140) });
    expect(preview).toHaveLength(120);
    expect(preview?.startsWith(`${t.photo} - `)).toBe(true);
    expect(preview?.endsWith("...")).toBe(true);
  });

  it("krótka treść zostaje bez zmian", async () => {
    const body = "z".repeat(120);
    expect(await previewOf({ body })).toBe(body);
  });

  it("pusta treść dostaje zastępnik, nie pusty dymek", async () => {
    expect(await previewOf({ body: "   " })).toBe(t.incoming.emptyBody);
  });
});

describe("zdarzenie dla animowanych dzwonków", () => {
  it("leci PO bramkach i niesie rozmowę, nadawcę i znacznik wiadomości", async () => {
    const seen: IncomingChatMessage[] = [];
    const off = onIncomingChatMessage((message) => seen.push(message));
    renderHook(() => useIncomingChatToasts());
    const conversationId = fresh("conv-bell");
    const at = deliver({ conversationId, unread: 1 });

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ conversationId, senderId: CHAT_IDS.peer, at });
    off();
  });

  it("odsubskrybowanie przestaje dostarczać zdarzenia", async () => {
    const seen: IncomingChatMessage[] = [];
    const off = onIncomingChatMessage((message) => seen.push(message));
    renderHook(() => useIncomingChatToasts());

    deliver({ conversationId: fresh("conv-bell-1"), unread: 1 });
    await waitFor(() => expect(seen).toHaveLength(1));

    off();
    deliver({ conversationId: fresh("conv-bell-2"), unread: 1 });
    await waitFor(() => expect(h.toasts).toHaveLength(2));
    expect(seen).toHaveLength(1);
  });
});
