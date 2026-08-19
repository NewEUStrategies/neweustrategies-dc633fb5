// Atrapa kanalow realtime (`supabase.channel`) - wspolna dla wszystkich
// powierzchni testowych.
//
// Mieszkala w `src/test/chat/fixtures.ts`, bo czat pierwszy jej potrzebowal.
// Nie ma w niej jednak niczego czatowego: `postgres_changes`, `broadcast`
// i `presence` to generyczny kontrakt supabase-js, a moduly spolecznosciowe
// (komentarze przez `tableChannelHub`, kolejka moderacji) czytaja przez ten
// sam mechanizm.
//
// Obserwowalny refcount (`subscribeCount`, `removed`, `liveChannels`) jest tu
// warunkiem sensu, nie wygoda: gubiony `removeChannel` nie psuje zadnego
// widoku od razu - dopiero po kilku przejsciach miedzy trasami konczy sie
// limit kanalow i przestaja przychodzic zdarzenia.

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
