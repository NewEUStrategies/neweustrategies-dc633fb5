// Globalne toasty „ktoś do Ciebie napisał" - jedyna powierzchnia czatu, która
// żyje POZA oknem rozmowy i dlatego jako jedyna może pokazać treść wiadomości
// na ekranie, na którym użytkownik jej nie oczekuje.
//
// Stan wyjściowy: 4/18 funkcji. Niepokryte były dokładnie te bramki, które
// decydują, CZY treść w ogóle wolno pokazać: wyciszenie rozmowy
// (`isMutedConversation` + `invalidateMuteCache`), aktywne okno tej samej
// rozmowy (`isConversationFocused`), nagrobek wiadomości cofniętej
// (`handleInsert`) i budowa podglądu (`buildPreview` + `attachmentSummary`).
//
// KONTRAKT REFCOUNTU. `ChatBell`, `ChatDock` i trasa `/messages` montują ten
// hook równolegle, a kanał ma być JEDEN. Zgubiony `removeChannel` nie psuje
// żadnego widoku od razu - dopiero po kilku przejściach kończy się limit
// kanałów i toasty cicho przestają przychodzić. Stąd dowody na licznik.
//
// RODO: rozmówcy to identyfikatory z `CHAT_IDS`, treści zmyślone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import {
  BASE_ISO,
  CHAT_IDS,
  isoOffset,
  messageRow,
  ok,
  peerProfile,
  realtimeStub,
  supabaseFromStub,
} from "@/test/chat/fixtures";
import type { MessageRow } from "@/lib/chat/types";

interface ToastCall {
  readonly title: string;
  readonly options: {
    description?: string;
    action?: { label: string; onClick: () => void };
  };
}

const h = vi.hoisted(() => ({
  uid: "user-me" as string | null,
  toasts: [] as ToastCall[],
  rpc: vi.fn(),
  realtime: null as unknown,
  from: null as unknown,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.uid ? { id: h.uid } : null }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(
    (title: string, options: ToastCall["options"]) => {
      h.toasts.push({ title, options });
    },
    { error: vi.fn(), success: vi.fn() },
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
      channel: realtime.channel,
      removeChannel: realtime.removeChannel,
      from: from.from,
      rpc: (fn: string, args: unknown) => h.rpc(fn, args),
    },
  };
});

import {
  invalidateMuteCache,
  onIncomingChatMessage,
  useIncomingChatToasts,
} from "../useIncomingChatToasts";

type RealtimeStub = ReturnType<typeof realtimeStub>;
type FromStub = ReturnType<typeof supabaseFromStub>;

const realtime = () => h.realtime as RealtimeStub;
const from = () => h.from as FromStub;

const t = chatPl.chat;

/** Kanał tego użytkownika (jeden na sesję, refcountowany). */
function incomingChannel() {
  const channel = realtime().channelByPrefix(`chat-incoming:${h.uid}`);
  if (!channel) throw new Error("test: kanał toastów nie powstał");
  return channel;
}

function emitInsert(row: MessageRow): void {
  act(() => {
    incomingChannel().emitPostgres("messages", { eventType: "INSERT", new: row });
  });
}

/** Odczekanie na asynchroniczne `handleInsert` (mute -> profil -> toast). */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Ustaw stan wyciszenia zwracany przez `conversation_participants`. */
function setMuted(mutedUntil: string | null): void {
  from().setResponse("conversation_participants", ok({ muted_until: mutedUntil }));
}

/**
 * Znacznik liczony od REALNEGO zegara. Wyciszenie porównuje się z `Date.now()`,
 * więc `BASE_ISO` (sierpień 2026) byłby dla niego zawsze przeszłością.
 */
function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

let seq = 0;
/** Unikalny identyfikator rozmowy - `muteCache` żyje w module. */
function freshConversation(): string {
  seq += 1;
  return `conv-toast-${seq}`;
}

beforeEach(() => {
  h.uid = CHAT_IDS.me;
  h.toasts = [];
  h.rpc = vi.fn(async () => ok([peerProfile({ display_name: "Zofia Testowa" })]));
  realtime().reset();
  from().reset();
  setMuted(null);
  invalidateMuteCache();
  document.body.innerHTML = "";
});

afterEach(() => {
  cleanup();
  invalidateMuteCache();
});

describe("cykl życia kanału", () => {
  it("montowanie otwiera DOKŁADNIE jeden kanał, odmontowanie go zwalnia", () => {
    const { unmount } = renderHook(() => useIncomingChatToasts());
    expect(realtime().liveChannels(`chat-incoming:${CHAT_IDS.me}`)).toHaveLength(1);
    expect(incomingChannel().subscribeCount).toBe(1);

    unmount();
    expect(realtime().liveChannels(`chat-incoming:${CHAT_IDS.me}`)).toHaveLength(0);
  });

  it("trzy powierzchnie naraz trzymają JEDEN websocket, zwalniany dopiero przy ostatniej", () => {
    const bell = renderHook(() => useIncomingChatToasts());
    const dock = renderHook(() => useIncomingChatToasts());
    const inbox = renderHook(() => useIncomingChatToasts());
    expect(realtime().channels).toHaveLength(1);

    bell.unmount();
    dock.unmount();
    expect(realtime().liveChannels(`chat-incoming:${CHAT_IDS.me}`)).toHaveLength(1);

    inbox.unmount();
    expect(realtime().liveChannels(`chat-incoming:${CHAT_IDS.me}`)).toHaveLength(0);
  });

  it("anonim nie otwiera żadnego kanału", () => {
    h.uid = null;
    renderHook(() => useIncomingChatToasts());
    expect(realtime().channels).toHaveLength(0);
  });

  it("kanał filtruje po nadawcy - własne echo nie wraca z serwera", () => {
    renderHook(() => useIncomingChatToasts());
    const listener = incomingChannel().listeners.find((l) => l.type === "postgres_changes");
    expect(listener?.filter).toMatchObject({
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `sender_id=neq.${CHAT_IDS.me}`,
    });
  });
});

describe("bramki widoczności", () => {
  it("wiadomość od rozmówcy pokazuje nazwę nadawcy i podgląd treści", async () => {
    renderHook(() => useIncomingChatToasts());
    emitInsert(
      messageRow({
        id: "msg-toast-1",
        conversation_id: freshConversation(),
        body: "Spotkanie o dziesiątej",
      }),
    );
    await settle();

    expect(h.toasts).toHaveLength(1);
    expect(h.toasts[0]?.title).toBe("Zofia Testowa");
    expect(h.toasts[0]?.options.description).toBe("Spotkanie o dziesiątej");
    expect(h.toasts[0]?.options.action?.label).toBe(t.incoming.open);
  });

  it("WŁASNA wiadomość z innej karty nie robi toasta", async () => {
    renderHook(() => useIncomingChatToasts());
    emitInsert(
      messageRow({
        id: "msg-toast-own",
        conversation_id: freshConversation(),
        sender_id: CHAT_IDS.me,
      }),
    );
    await settle();
    expect(h.toasts).toHaveLength(0);
  });

  it("ta sama wiadomość dwa razy daje JEDEN toast", async () => {
    renderHook(() => useIncomingChatToasts());
    const row = messageRow({ id: "msg-toast-dup", conversation_id: freshConversation() });
    emitInsert(row);
    emitInsert(row);
    await settle();
    expect(h.toasts).toHaveLength(1);
  });

  it("wiadomość COFNIĘTA nie pokazuje treści ani nie budzi dzwonka", async () => {
    const seen: MessageRow[] = [];
    const off = onIncomingChatMessage((row) => seen.push(row));
    renderHook(() => useIncomingChatToasts());

    emitInsert(
      messageRow({
        id: "msg-toast-deleted",
        conversation_id: freshConversation(),
        body: "Treść, której nie wolno pokazać",
        deleted_at: isoOffset(1),
      }),
    );
    await settle();

    expect(h.toasts).toHaveLength(0);
    expect(seen).toHaveLength(0);
    off();
  });

  it("otwarta i skupiona rozmowa nie dubluje powiadomienia, ale dzwonek nadal wie", async () => {
    const conversationId = freshConversation();
    const marker = document.createElement("div");
    marker.setAttribute("data-active-conversation", conversationId);
    document.body.append(marker);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

    const seen: MessageRow[] = [];
    const off = onIncomingChatMessage((row) => seen.push(row));
    renderHook(() => useIncomingChatToasts());

    emitInsert(messageRow({ id: "msg-toast-focused", conversation_id: conversationId }));
    await settle();

    expect(h.toasts).toHaveLength(0);
    // Zdarzenie leci ZAWSZE - listy i liczniki muszą się odświeżyć.
    expect(seen).toHaveLength(1);
    off();
    vi.restoreAllMocks();
  });

  it("okno otwarte, ale karta w tle - toast MA się pokazać", async () => {
    const conversationId = freshConversation();
    const marker = document.createElement("div");
    marker.setAttribute("data-active-conversation", conversationId);
    document.body.append(marker);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    renderHook(() => useIncomingChatToasts());
    emitInsert(messageRow({ id: "msg-toast-bg", conversation_id: conversationId }));
    await settle();

    expect(h.toasts).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("INNA otwarta rozmowa nie ucisza toasta z tej, która przyszła", async () => {
    const otherId = freshConversation();
    const incomingId = freshConversation();
    const marker = document.createElement("div");
    marker.setAttribute("data-active-conversation", otherId);
    document.body.append(marker);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

    renderHook(() => useIncomingChatToasts());
    emitInsert(messageRow({ id: "msg-toast-other", conversation_id: incomingId }));
    await settle();

    expect(h.toasts).toHaveLength(1);
    vi.restoreAllMocks();
  });
});

describe("wyciszenie rozmowy", () => {
  it("wyciszona rozmowa milczy, choć dzwonek i licznik nadal ją widzą", async () => {
    const conversationId = freshConversation();
    setMuted(minutesFromNow(60));
    const seen: MessageRow[] = [];
    const off = onIncomingChatMessage((row) => seen.push(row));
    renderHook(() => useIncomingChatToasts());

    emitInsert(messageRow({ id: "msg-mute-1", conversation_id: conversationId }));
    await settle();

    expect(h.toasts).toHaveLength(0);
    expect(seen).toHaveLength(1);
    off();
  });

  it("wyciszenie, które WYGASŁO, nie ucisza niczego", async () => {
    setMuted(minutesFromNow(-60));
    renderHook(() => useIncomingChatToasts());
    emitInsert(messageRow({ id: "msg-mute-expired", conversation_id: freshConversation() }));
    await settle();
    expect(h.toasts).toHaveLength(1);
  });

  it("stan wyciszenia jest cache'owany - druga wiadomość nie pyta bazy drugi raz", async () => {
    const conversationId = freshConversation();
    setMuted(null);
    renderHook(() => useIncomingChatToasts());

    emitInsert(messageRow({ id: "msg-cache-1", conversation_id: conversationId }));
    await settle();
    emitInsert(messageRow({ id: "msg-cache-2", conversation_id: conversationId }));
    await settle();

    expect(h.toasts).toHaveLength(2);
    expect(from().chainsFor("conversation_participants")).toHaveLength(1);
  });

  it("`invalidateMuteCache` sprawia, że wyciszenie działa NATYCHMIAST, nie po 60 s", async () => {
    const conversationId = freshConversation();
    setMuted(null);
    renderHook(() => useIncomingChatToasts());

    emitInsert(messageRow({ id: "msg-inval-1", conversation_id: conversationId }));
    await settle();
    expect(h.toasts).toHaveLength(1);

    // Użytkownik wycisza rozmowę: mutacja unieważnia wpis cache'u.
    setMuted(minutesFromNow(60));
    act(() => invalidateMuteCache(conversationId));

    emitInsert(messageRow({ id: "msg-inval-2", conversation_id: conversationId }));
    await settle();
    expect(h.toasts).toHaveLength(1);
    expect(from().chainsFor("conversation_participants")).toHaveLength(2);
  });

  it("błąd odczytu wyciszenia NIE ucisza rozmowy (fail-open dla powiadomień)", async () => {
    from().setResponse("conversation_participants", { data: null, error: null });
    renderHook(() => useIncomingChatToasts());
    emitInsert(messageRow({ id: "msg-mute-error", conversation_id: freshConversation() }));
    await settle();
    expect(h.toasts).toHaveLength(1);
  });
});

describe("podgląd treści", () => {
  async function previewOf(row: Partial<MessageRow>): Promise<string | undefined> {
    renderHook(() => useIncomingChatToasts());
    emitInsert(messageRow({ conversation_id: freshConversation(), ...row }));
    await settle();
    return h.toasts.at(-1)?.options.description;
  }

  it("zdjęcie ma własny zastępnik zamiast pustej treści", async () => {
    expect(
      await previewOf({
        id: "msg-prev-img",
        kind: "image",
        body: null,
        attachment_name: "wykres.png",
      }),
    ).toBe(t.photo);
  });

  it("notatka głosowa nazywa się notatką głosową", async () => {
    expect(await previewOf({ id: "msg-prev-audio", kind: "audio", body: null })).toBe(
      t.voice.message,
    );
  });

  it("plik pokazuje nazwę - to jedyna informacja, którą użytkownik ma przed otwarciem", async () => {
    expect(
      await previewOf({
        id: "msg-prev-file",
        kind: "file",
        body: null,
        attachment_name: "raport-kwartalny.pdf",
      }),
    ).toBe(`${t.file}: raport-kwartalny.pdf`);
  });

  it("plik BEZ nazwy nie produkuje „Plik: undefined”", async () => {
    expect(
      await previewOf({
        id: "msg-prev-file-anon",
        kind: "file",
        body: null,
        attachment_name: null,
      }),
    ).toBe(t.file);
  });

  it("załącznik z podpisem skleja oba człony", async () => {
    expect(
      await previewOf({
        id: "msg-prev-caption",
        kind: "image",
        body: "Wykres zużycia",
        attachment_name: "wykres.png",
      }),
    ).toBe(`${t.photo} - Wykres zużycia`);
  });

  it("długa treść jest ucinana z wielokropkiem, a nie wylewa się na ekran", async () => {
    const preview = await previewOf({ id: "msg-prev-long", body: "z".repeat(400) });
    expect(preview).toHaveLength(140);
    expect(preview?.endsWith("...")).toBe(true);
  });

  it("dokładnie 140 znaków jeszcze się mieści bez ucinania", async () => {
    const body = "z".repeat(140);
    expect(await previewOf({ id: "msg-prev-140", body })).toBe(body);
  });

  it("pusta treść dostaje zastępnik, nie pusty dymek", async () => {
    expect(await previewOf({ id: "msg-prev-empty", body: "   " })).toBe(t.incoming.emptyBody);
  });

  it("wiadomość znikająca (TTL) jest zwykłą wiadomością - znika w wątku, nie w toaście", async () => {
    // Zdarzenie INSERT przychodzi w chwili zapisu, więc `expires_at` jest
    // ZAWSZE w przyszłości - „wygasła w momencie wstawienia" nie jest stanem
    // osiągalnym. Dowód pilnuje, że TTL nie ucisza powiadomienia po cichu.
    expect(
      await previewOf({
        id: "msg-prev-ttl",
        body: "Znika po dobie",
        expires_at: isoOffset(1440, new Date().toISOString()),
      }),
    ).toBe("Znika po dobie");
  });
});

describe("tożsamość nadawcy", () => {
  it("profil nadawcy jest cache'owany - druga wiadomość nie pyta RPC drugi raz", async () => {
    renderHook(() => useIncomingChatToasts());
    const sender = "user-cache-peer";
    h.rpc = vi.fn(async () => ok([peerProfile({ id: sender, display_name: "Zofia Testowa" })]));

    emitInsert(
      messageRow({ id: "msg-peer-1", conversation_id: freshConversation(), sender_id: sender }),
    );
    await settle();
    emitInsert(
      messageRow({ id: "msg-peer-2", conversation_id: freshConversation(), sender_id: sender }),
    );
    await settle();

    expect(h.toasts).toHaveLength(2);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("get_chat_peers", { p_user_ids: [sender] });
  });

  it("nierozpoznany nadawca dostaje neutralną etykietę, nie surowy identyfikator", async () => {
    h.rpc = vi.fn(async () => ok([]));
    renderHook(() => useIncomingChatToasts());
    emitInsert(
      messageRow({
        id: "msg-peer-unknown",
        conversation_id: freshConversation(),
        sender_id: "user-nieznany",
      }),
    );
    await settle();

    expect(h.toasts[0]?.title).toBe(t.incoming.someone);
    expect(h.toasts[0]?.title).not.toContain("user-nieznany");
  });

  it("akcja toasta otwiera DOKŁADNIE tę rozmowę", async () => {
    const conversationId = freshConversation();
    renderHook(() => useIncomingChatToasts());
    emitInsert(messageRow({ id: "msg-open", conversation_id: conversationId }));
    await settle();

    const opened: string[] = [];
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId: string }>).detail;
      opened.push(detail.conversationId);
    };
    window.addEventListener("nes:open-chat", listener);
    h.toasts[0]?.options.action?.onClick();
    window.removeEventListener("nes:open-chat", listener);

    expect(opened).toEqual([conversationId]);
  });
});

describe("zdarzenie dla animowanych dzwonków", () => {
  it("odsubskrybowanie przestaje dostarczać zdarzenia", async () => {
    const seen: MessageRow[] = [];
    const off = onIncomingChatMessage((row) => seen.push(row));
    renderHook(() => useIncomingChatToasts());

    emitInsert(messageRow({ id: "msg-bell-1", conversation_id: freshConversation() }));
    await settle();
    expect(seen).toHaveLength(1);

    off();
    emitInsert(messageRow({ id: "msg-bell-2", conversation_id: freshConversation() }));
    await settle();
    expect(seen).toHaveLength(1);
  });

  it("zdarzenie niesie cały wiersz wiadomości, nie sam identyfikator", async () => {
    const seen: MessageRow[] = [];
    const off = onIncomingChatMessage((row) => seen.push(row));
    renderHook(() => useIncomingChatToasts());
    const row = messageRow({
      id: "msg-bell-payload",
      conversation_id: freshConversation(),
      created_at: BASE_ISO,
    });
    emitInsert(row);
    await settle();

    expect(seen[0]).toMatchObject({ id: "msg-bell-payload", sender_id: CHAT_IDS.peer });
    off();
  });
});
