// Atomy testowe MODUŁU CZATU - atomic design zastosowany do testów, dokładnie
// jak w `src/test/network/fixtures.ts`. Jedno źródło prawdy dla: wierszy bazy,
// atrapy klienta PostgREST/RPC, atrapy realtime i stubu tłumaczeń.
//
// DLACZEGO TO ISTNIEJE. Czat był najsłabszą powierzchnią testową repo (17-20%
// pokrycia przy 12 tys. linii). Główną barierą nie był brak chęci, a koszt
// wejścia: `useMessages`/`useConversations` rozmawiają z bazą przez ŁAŃCUCH
// PostgREST (`.from().select().eq().order().limit()`), a nie przez pojedyncze
// `rpc()`, więc każdy test musiał budować własną atrapę łańcucha. Ten moduł
// robi to raz. Skutek: zmiana kontraktu warstwy danych psuje JEDEN plik
// (ten), nie osiemnaście plików testowych.
//
// Świadomie BEZ JSX i bez importu komponentów - moduł jest wciągany także
// z wnętrza fabryk `vi.mock` (dynamiczny import), więc musi być tani
// i wolny od side-effectów.
import { vi, type Mock } from "vitest";
import type {
  ChatContactHit,
  ChatMessage,
  ConversationRow,
  ConversationView,
  MessageRow,
  ParticipantRow,
  PeerProfile,
  ReactionRow,
} from "@/lib/chat/types";
import type { MessageSearchHit } from "@/lib/chat/useMessageSearch";

/**
 * Identyfikatory testowe. Tenant jest tu JAWNY, bo każdy zapis czatu
 * (`messages`, `message_reactions`, `user_blocks`) musi stemplować
 * `tenant_id`, a RLS liczy na to, że stempel jest prawdziwy - testy izolacji
 * tenanta odwołują się do tych stałych, nie do literałów rozsypanych po
 * plikach.
 */
export const CHAT_IDS = {
  me: "user-me",
  peer: "user-peer",
  peerTwo: "user-peer-2",
  stranger: "user-stranger",
  tenant: "tenant-alfa",
  foreignTenant: "tenant-beta",
  conversation: "conv-1",
  otherConversation: "conv-2",
  group: "conv-group",
  message: "msg-1",
  reaction: "react-1",
} as const;

/** Stabilny znacznik czasu bazowy - testy liczą od niego, nie od `Date.now()`. */
export const BASE_ISO = "2026-08-18T10:00:00.000Z";

/** `BASE_ISO` przesunięty o N minut (dodatnio = w przyszłość). */
export function isoOffset(minutes: number, from: string = BASE_ISO): string {
  return new Date(new Date(from).getTime() + minutes * 60_000).toISOString();
}

/** Znacznik „N minut temu" liczony od realnego zegara (testy okna edycji). */
export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// --- wiersze bazy -----------------------------------------------------------
// Kształty 1:1 z `Database["public"]["Tables"][...]["Row"]`, więc rozjazd
// kolumny w migracji wychodzi na typach w KAŻDYM teście, który tego wiersza
// używa - a nie dopiero w runtime na produkcji.

/**
 * Wiersz `conversations` (wątek bezpośredni). `direct_key` jest w formacie
 * `<tenant>:<uidA>:<uidB>` - to Z NIEGO, a nie z wiersza uczestnika, wynika
 * tożsamość rozmówcy, bo RLS potrafi ukryć wiersz peera (wyłączone
 * potwierdzenia odczytu).
 */
export function conversationRow(overrides: Partial<ConversationRow> = {}): ConversationRow {
  const id = overrides.id ?? CHAT_IDS.conversation;
  return {
    id,
    tenant_id: CHAT_IDS.tenant,
    kind: "direct",
    direct_key: `${CHAT_IDS.tenant}:${CHAT_IDS.me}:${CHAT_IDS.peer}`,
    title: null,
    description: null,
    created_by: CHAT_IDS.me,
    created_at: BASE_ISO,
    updated_at: BASE_ISO,
    last_message_at: BASE_ISO,
    last_message_kind: "text",
    last_message_preview: "Dzień dobry",
    last_message_sender: CHAT_IDS.peer,
    message_ttl_seconds: null,
    theme: null,
    wallpaper: null,
    quick_emoji: null,
    ...overrides,
  };
}

/** Wiersz `conversations` dla kręgu (grupy) - bez `direct_key`, z tytułem. */
export function groupConversationRow(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return conversationRow({
    id: CHAT_IDS.group,
    kind: "group",
    direct_key: null,
    title: "Krąg energetyczny",
    ...overrides,
  });
}

/** Wiersz `conversation_participants`. */
export function participantRow(overrides: Partial<ParticipantRow> = {}): ParticipantRow {
  const userId = overrides.user_id ?? CHAT_IDS.me;
  const conversationId = overrides.conversation_id ?? CHAT_IDS.conversation;
  return {
    id: `part-${conversationId}-${userId}`,
    conversation_id: conversationId,
    user_id: userId,
    tenant_id: CHAT_IDS.tenant,
    unread_count: 0,
    last_read_at: null,
    last_delivered_at: null,
    pinned_at: null,
    archived_at: null,
    muted_until: null,
    cleared_before: null,
    role: "member",
    created_at: BASE_ISO,
    updated_at: BASE_ISO,
    ...overrides,
  };
}

/** Wiersz `messages`. Domyślnie tekst od rozmówcy, bez załącznika. */
export function messageRow(overrides: Partial<MessageRow> = {}): MessageRow {
  const id = overrides.id ?? CHAT_IDS.message;
  return {
    id,
    conversation_id: CHAT_IDS.conversation,
    tenant_id: CHAT_IDS.tenant,
    sender_id: CHAT_IDS.peer,
    kind: "text",
    body: "Dzień dobry",
    attachment_path: null,
    attachment_name: null,
    attachment_mime: null,
    attachment_size: null,
    attachment_duration: null,
    reply_to_id: null,
    forwarded: false,
    edited_at: null,
    deleted_at: null,
    expires_at: null,
    created_at: BASE_ISO,
    ...overrides,
  };
}

/** Wiersz `messages` z flagami optymistycznymi (dymek „wysyłanie"/„nieudane"). */
export function chatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { ...messageRow(overrides), ...overrides };
}

/** Wiersz `message_reactions`. */
export function reactionRow(overrides: Partial<ReactionRow> = {}): ReactionRow {
  return {
    id: CHAT_IDS.reaction,
    message_id: CHAT_IDS.message,
    conversation_id: CHAT_IDS.conversation,
    tenant_id: CHAT_IDS.tenant,
    user_id: CHAT_IDS.peer,
    emoji: "👍",
    created_at: BASE_ISO,
    ...overrides,
  };
}

/** Wiersz `get_chat_peers` (bezpieczna karta profilu rozmówcy). */
export function peerProfile(overrides: Partial<PeerProfile> = {}): PeerProfile {
  return {
    id: CHAT_IDS.peer,
    display_name: "Anna Nowak",
    avatar_url: "",
    slug: "anna-nowak",
    job_title: "Analityk",
    current_company: "NES",
    specialization: "Energia",
    ...overrides,
  };
}

/** Wiersz `search_chat_contacts` (wyszukiwarka odbiorców - tylko sieć kontaktów). */
export function chatContactHit(overrides: Partial<ChatContactHit> = {}): ChatContactHit {
  return {
    id: CHAT_IDS.peer,
    display_name: "Anna Nowak",
    avatar_url: "",
    slug: "anna-nowak",
    job_title: "Analityk",
    current_company: "NES",
    specialization: "Energia",
    location: "Warszawa",
    verified: true,
    total_count: 1,
    ...overrides,
  };
}

/** Wiersz `search_messages` (trafienie wyszukiwarki treści, snippet w [[[ ]]]). */
export function messageSearchHit(overrides: Partial<MessageSearchHit> = {}): MessageSearchHit {
  return {
    id: CHAT_IDS.message,
    conversation_id: CHAT_IDS.conversation,
    sender_id: CHAT_IDS.peer,
    kind: "text",
    snippet: "[[[polityka]]] energetyczna",
    created_at: BASE_ISO,
    rank: 0.5,
    total_count: 1,
    ...overrides,
  };
}

// --- widoki domenowe --------------------------------------------------------

/**
 * `ConversationView` - wątek bezpośredni widziany przez `CHAT_IDS.me`.
 * `me`/`peers` da się nadpisać częściowo, żeby test dotykał tylko tego, co
 * bada (np. samego `unread_count`).
 */
export function conversationView(
  overrides: {
    conversation?: Partial<ConversationRow>;
    me?: Partial<ParticipantRow>;
    peers?: ParticipantRow[];
  } = {},
): ConversationView {
  const conversation = conversationRow(overrides.conversation);
  return {
    conversation,
    me: participantRow({
      conversation_id: conversation.id,
      user_id: CHAT_IDS.me,
      ...overrides.me,
    }),
    peers: overrides.peers ?? [
      participantRow({ conversation_id: conversation.id, user_id: CHAT_IDS.peer }),
    ],
  };
}

/** `ConversationView` dla kręgu z dwoma rozmówcami. */
export function groupConversationView(
  overrides: {
    conversation?: Partial<ConversationRow>;
    me?: Partial<ParticipantRow>;
    peers?: ParticipantRow[];
  } = {},
): ConversationView {
  const conversation = groupConversationRow(overrides.conversation);
  return {
    conversation,
    me: participantRow({
      conversation_id: conversation.id,
      user_id: CHAT_IDS.me,
      role: "owner",
      ...overrides.me,
    }),
    peers: overrides.peers ?? [
      participantRow({ conversation_id: conversation.id, user_id: CHAT_IDS.peer }),
      participantRow({ conversation_id: conversation.id, user_id: CHAT_IDS.peerTwo }),
    ],
  };
}

/** Mapa profili w kształcie zwracanym przez `usePeerProfiles`. */
export function peerProfileMap(
  profiles: ReadonlyArray<PeerProfile> = [peerProfile()],
): ReadonlyMap<string, PeerProfile> {
  return new Map(profiles.map((p) => [p.id, p]));
}

// --- atrapa klienta Supabase ------------------------------------------------

/**
 * Błąd PostgREST. `PostgrestError` w supabase-js DZIEDZICZY po `Error`, więc
 * atrapa też musi - inaczej test przechodzi obok gałęzi `err instanceof Error`
 * w warstwie danych i „dowodzi", że mapowanie komunikatów nie działa, choć
 * w produkcji działa (albo odwrotnie: przepuszcza kod, który w produkcji
 * poleci na `[object Object]`). Wierność atrapy jest tu warunkiem sensu testu.
 */
export interface PostgrestErrorLike extends Error {
  code?: string;
  details?: string;
  hint?: string;
}

export function pgError(message: string, code?: string): PostgrestErrorLike {
  const error: PostgrestErrorLike = new Error(message);
  error.name = "PostgrestError";
  if (code !== undefined) error.code = code;
  return error;
}

/** Odpowiedź PostgREST/RPC w kształcie, w jakim ją czyta warstwa danych. */
export interface SupabaseResult<T = unknown> {
  data: T;
  error: PostgrestErrorLike | null;
}

export function ok<T>(data: T): SupabaseResult<T> {
  return { data, error: null };
}

export function fail(message: string, code?: string): SupabaseResult<null> {
  return { data: null, error: pgError(message, code) };
}

/** Jedno ogniwo łańcucha PostgREST zapisane przez atrapę. */
export interface RecordedCall {
  readonly method: string;
  readonly args: ReadonlyArray<unknown>;
}

/** Pełny przebieg jednego łańcucha: tabela + kolejność wywołanych ogniw. */
export interface RecordedChain {
  readonly table: string;
  readonly calls: RecordedCall[];
  /** Skrót: czy w łańcuchu wystąpiło dane ogniwo. */
  has(method: string): boolean;
  /** Argumenty pierwszego wystąpienia ogniwa (undefined, gdy go nie było). */
  argsOf(method: string): ReadonlyArray<unknown> | undefined;
}

/**
 * Wynik, jaki atrapa ma zwrócić dla danej tabeli. Funkcja dostaje zapisany
 * łańcuch, więc test może odpowiedzieć RÓŻNIE w zależności od filtrów
 * (np. inna strona historii dla innego kursora) bez budowania własnej atrapy.
 */
export type TableResponder = (chain: RecordedChain) => SupabaseResult;

/**
 * Atrapa `supabase.from(...)`: pełny, thenable łańcuch PostgREST.
 *
 * Kontrakt jest ważniejszy niż wygoda: łańcuch ROZWIĄZUJE SIĘ dopiero przy
 * `await` (albo `.single()`/`.maybeSingle()`), więc test widzi dokładnie te
 * ogniwa, które produkcyjny kod naprawdę wywołał - w tym `.order()` dwa razy
 * (created_at, potem id) i `.or()` z kursorem złożonym. Test, który sprawdza
 * TYLKO dane, przechodzi tak samo; test kontraktu paginacji ma z czego czytać.
 */
export interface SupabaseFromStub {
  /** Podmienialna funkcja `from` do wstrzyknięcia w atrapę klienta. */
  from: (table: string) => unknown;
  /** Ustaw odpowiedź dla tabeli (ostatnie ustawienie wygrywa). */
  setResponse(table: string, responder: TableResponder | SupabaseResult): void;
  /** Wszystkie zapisane łańcuchy, w kolejności wywołań. */
  chains: RecordedChain[];
  /** Łańcuchy dotyczące jednej tabeli. */
  chainsFor(table: string): RecordedChain[];
  /** Ostatni łańcuch dla tabeli - najczęstsza asercja. */
  lastChain(table: string): RecordedChain | undefined;
  reset(): void;
}

/** Ogniwa, które KOŃCZĄ łańcuch (zwracają wynik, nie builder). */
const TERMINAL_METHODS: ReadonlySet<string> = new Set(["single", "maybeSingle", "csv"]);

/**
 * Ogniwa filtrujące/kształtujące. Lista jest jawna (a nie „cokolwiek przez
 * Proxy"), bo literówka w nazwie ogniwa w kodzie produkcyjnym MA być błędem
 * testu, a nie cicho pochłoniętym wywołaniem.
 */
const CHAIN_METHODS: readonly string[] = [
  "select",
  "insert",
  "update",
  "upsert",
  "delete",
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "is",
  "not",
  "or",
  "filter",
  "match",
  "contains",
  "overlaps",
  "order",
  "limit",
  "range",
  "returns",
  "abortSignal",
];

export function supabaseFromStub(): SupabaseFromStub {
  const responders = new Map<string, TableResponder>();
  const chains: RecordedChain[] = [];

  function makeChain(table: string): RecordedChain {
    const calls: RecordedCall[] = [];
    return {
      table,
      calls,
      has: (method) => calls.some((c) => c.method === method),
      argsOf: (method) => calls.find((c) => c.method === method)?.args,
    };
  }

  function resolve(chain: RecordedChain): SupabaseResult {
    const responder = responders.get(chain.table);
    // Brak odpowiedzi to nie „pusta lista", a błąd testu: cichy `[]` udawałby
    // poprawny odczyt tabeli, której test nie zaplanował.
    if (!responder) {
      return fail(`test: brak zaplanowanej odpowiedzi dla tabeli "${chain.table}"`);
    }
    return responder(chain);
  }

  function builderFor(chain: RecordedChain): Record<string, unknown> {
    const builder: Record<string, unknown> = {};
    for (const method of CHAIN_METHODS) {
      builder[method] = (...args: unknown[]) => {
        chain.calls.push({ method, args });
        return builder;
      };
    }
    for (const method of TERMINAL_METHODS) {
      builder[method] = (...args: unknown[]) => {
        chain.calls.push({ method, args });
        return Promise.resolve(resolve(chain));
      };
    }
    // Thenable: `await q` bez ogniwa terminalnego (tak czyta większość zapytań).
    builder.then = (
      onFulfilled?: (value: SupabaseResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(resolve(chain)).then(onFulfilled, onRejected);
    return builder;
  }

  return {
    from: (table: string) => {
      const chain = makeChain(table);
      chains.push(chain);
      return builderFor(chain);
    },
    setResponse(table, responder) {
      responders.set(table, typeof responder === "function" ? responder : () => responder);
    },
    chains,
    chainsFor: (table) => chains.filter((c) => c.table === table),
    lastChain: (table) => chains.filter((c) => c.table === table).at(-1),
    reset() {
      responders.clear();
      chains.length = 0;
    },
  };
}

// --- atrapa realtime --------------------------------------------------------

/**
 * Ładunek zdarzenia realtime w atrapie - suma pól, których używa warstwa
 * danych czatu: `postgres_changes` czyta `eventType`/`new`/`old`, `broadcast`
 * czyta `payload`.
 *
 * JEDEN typ dla obu rodzajów jest tu decyzją, nie skrótem: dwa osobne typy
 * handlerów wymuszały rzutowanie `as unknown as` przy zapisie do wspólnej
 * listy nasłuchujących, a to omija kontrolę typów dokładnie tak samo jak
 * `as any`. Wszystkie pola są opcjonalne, więc handler zadeklarowany na
 * węższym kształcie pozostaje przypisywalny (kontrawariancja parametru).
 */
export interface RealtimeEventPayload {
  eventType?: string;
  new?: unknown;
  old?: unknown;
  payload?: unknown;
}

/** Handler zdarzenia realtime w atrapie (postgres_changes / broadcast / presence). */
export type RealtimeHandler = (payload: RealtimeEventPayload) => void;

export interface RecordedListener {
  readonly type: "postgres_changes" | "broadcast" | "presence";
  readonly filter: Record<string, unknown>;
  readonly handler: RealtimeHandler;
}

export interface FakeChannel {
  readonly name: string;
  readonly config: Record<string, unknown> | undefined;
  readonly listeners: RecordedListener[];
  readonly sent: Array<Record<string, unknown>>;
  /** Ile razy `subscribe()` zostało wywołane na TYM kanale. */
  subscribeCount: number;
  removed: boolean;
  on(type: string, filter: Record<string, unknown>, handler: RealtimeHandler): FakeChannel;
  subscribe(cb?: (status: string) => void): FakeChannel;
  send(payload: Record<string, unknown>): Promise<"ok">;
  track(payload: Record<string, unknown>): Promise<"ok">;
  presenceState(): Record<string, Array<{ user_id: string }>>;
  /** Test: wywołaj handler pasujący do zdarzenia/tabeli. */
  emitPostgres(table: string, payload: RealtimeEventPayload): void;
  /** Test: wywołaj handler broadcastu o danej nazwie zdarzenia. */
  emitBroadcast(event: string, payload: unknown): void;
  /** Test: ponów callback statusu (symulacja re-subscribe po zerwaniu). */
  emitStatus(status: string): void;
}

export interface RealtimeStub {
  channel(name: string, config?: Record<string, unknown>): FakeChannel;
  removeChannel(channel: FakeChannel): Promise<"ok">;
  /** Wszystkie utworzone kanały (także usunięte). */
  channels: FakeChannel[];
  /** Kanały o nazwie zaczynającej się prefiksem, jeszcze nieusunięte. */
  liveChannels(prefix?: string): FakeChannel[];
  channelByPrefix(prefix: string): FakeChannel | undefined;
  reset(): void;
}

export function realtimeStub(
  presence: Record<string, Array<{ user_id: string }>> = {},
): RealtimeStub {
  const channels: FakeChannel[] = [];
  return {
    channel(name, config) {
      const statusCallbacks: Array<(status: string) => void> = [];
      const channel: FakeChannel = {
        name,
        config,
        listeners: [],
        sent: [],
        subscribeCount: 0,
        removed: false,
        on(type, filter, handler) {
          channel.listeners.push({
            type: type as RecordedListener["type"],
            filter,
            handler,
          });
          return channel;
        },
        subscribe(cb) {
          channel.subscribeCount += 1;
          if (cb) {
            statusCallbacks.push(cb);
            cb("SUBSCRIBED");
          }
          return channel;
        },
        async send(payload) {
          channel.sent.push(payload);
          return "ok";
        },
        async track(payload) {
          channel.sent.push({ type: "presence", ...payload });
          return "ok";
        },
        presenceState: () => presence,
        emitPostgres(table, payload) {
          for (const listener of channel.listeners) {
            if (listener.type !== "postgres_changes") continue;
            if (listener.filter.table !== table) continue;
            const event = listener.filter.event;
            const payloadEvent = payload.eventType;
            if (event !== "*" && payloadEvent && event !== payloadEvent) continue;
            listener.handler(payload);
          }
        },
        emitBroadcast(event, payload) {
          for (const listener of channel.listeners) {
            if (listener.type !== "broadcast") continue;
            if (listener.filter.event !== event) continue;
            listener.handler({ payload });
          }
        },
        emitStatus(status) {
          for (const cb of statusCallbacks) cb(status);
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      channel.removed = true;
      return "ok";
    },
    channels,
    liveChannels: (prefix) =>
      channels.filter((c) => !c.removed && (!prefix || c.name.startsWith(prefix))),
    channelByPrefix: (prefix) => channels.find((c) => c.name.startsWith(prefix)),
    reset() {
      channels.length = 0;
    },
  };
}

// --- atrapa storage ---------------------------------------------------------

export interface StorageStub {
  from: Mock;
  createSignedUrl: Mock;
  createSignedUrls: Mock;
  createSignedUploadUrl: Mock;
  reset(): void;
}

/** Atrapa `supabase.storage` dla załączników (podpisy 15-minutowe, batch). */
export function storageStub(): StorageStub {
  const createSignedUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://signed.test/${path}` },
    error: null,
  }));
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${path}`, error: null })),
    error: null,
  }));
  const createSignedUploadUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://upload.test/${path}`, path, token: "tok" },
    error: null,
  }));
  const stub: StorageStub = {
    from: vi.fn(() => ({ createSignedUrl, createSignedUrls, createSignedUploadUrl })),
    createSignedUrl,
    createSignedUrls,
    createSignedUploadUrl,
    reset() {
      createSignedUrl.mockClear();
      createSignedUrls.mockClear();
      createSignedUploadUrl.mockClear();
      stub.from.mockClear();
    },
  };
  return stub;
}

// --- i18n -------------------------------------------------------------------

/**
 * Echo klucza i18n: `t("a.b")` -> `"a.b"`, a z opcjami -> `a.b {"count":3}`.
 * Testy asertują KLUCZ, nie polski tekst, więc zmiana copy nie psuje testów,
 * a rozjazd klucza owszem (za parytet PL/EN odpowiada `i18nChat.test.ts`).
 */
export function translateKey(key: string, options?: Record<string, unknown>): string {
  if (options === undefined) return key;
  const entries = Object.entries(options);
  return entries.length === 0 ? key : `${key} ${JSON.stringify(Object.fromEntries(entries))}`;
}

/** Ten sam stub `react-i18next` dla wszystkich testów czatu. */
export function reactI18nextStub(getLanguage: () => string = () => "pl"): {
  useTranslation: () => { t: typeof translateKey; i18n: { language: string } };
  initReactI18next: { type: string; init: () => void };
  Trans: (props: { children?: unknown }) => unknown;
} {
  return {
    useTranslation: () => ({ t: translateKey, i18n: { language: getLanguage() } }),
    initReactI18next: { type: "3rdParty", init: () => {} },
    Trans: (props: { children?: unknown }) => props.children ?? null,
  };
}
