// Dren kolejek pocztowych - test na atrapie klienta bazy i dostawcy poczty.
//
// Pilnuje zachowań, których pomyłka jest droga i niewidoczna w produkcji:
// podwójna wysyłka, wiadomość dowieziona po wygaśnięciu ważności, dobicie się
// do adresu po skardze na spam, oraz młócenie dostawcy po odpowiedzi 429.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { drainEmailQueues } from "../queueDrain.server";

// ---------------------------------------------------------------------------
// Atrapy
// ---------------------------------------------------------------------------
const sendEmailMock = vi.fn();
const providerConfiguredMock = vi.fn(() => true);

vi.mock("../provider.server", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  emailProviderConfigured: () => providerConfiguredMock(),
}));

interface FakeState {
  /** Wiadomości per kolejka. */
  queues: Record<string, QueueRow[]>;
  /** Wiersze email_send_log. */
  log: { message_id: string | null; status: string; error_message: string | null }[];
  /** Aktywne blokady: adres -> powód. */
  suppressed: Record<string, string>;
  sendState: Record<string, unknown>;
  deleted: { queue: string; msgId: number }[];
  dlq: { queue: string; msgId: number; reason: string }[];
}

interface QueueRow {
  msg_id: number;
  read_ct: number;
  enqueued_at?: string | null;
  message: Record<string, unknown>;
}

function makeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    queues: {},
    log: [],
    suppressed: {},
    sendState: {
      retry_after_until: null,
      batch_size: 10,
      send_delay_ms: 0,
      auth_email_ttl_minutes: 15,
      transactional_email_ttl_minutes: 60,
    },
    deleted: [],
    dlq: [],
    ...overrides,
  };
}

/**
 * Minimalna atrapa klienta Supabase: tylko te wywołania, których dren naprawdę
 * używa. Świadomie NIE symuluje PostgREST-a w ogólności - test ma pokazywać
 * decyzje drenu, nie zachowanie biblioteki.
 */
function fakeClient(state: FakeState) {
  const table = (name: string) => {
    if (name === "email_send_state") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: state.sendState, error: null }) }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            Object.assign(state.sendState, patch);
            return { error: null };
          },
        }),
      };
    }
    if (name === "email_send_log") {
      return {
        insert: async (row: Record<string, unknown>) => {
          state.log.push({
            message_id: (row.message_id as string) ?? null,
            status: row.status as string,
            error_message: (row.error_message as string) ?? null,
          });
          return { error: null };
        },
        select: () => {
          const rows = state.log;
          const chain = {
            in: (_col: string, ids: string[]) => ({
              eq: async (_c: string, status: string) => ({
                data: rows.filter(
                  (r) => r.message_id && ids.includes(r.message_id) && r.status === status,
                ),
                error: null,
              }),
            }),
            eq: (_col: string, messageId: string) => ({
              eq: (_c2: string, status: string) => ({
                maybeSingle: async () => ({
                  data: rows.find((r) => r.message_id === messageId && r.status === status) ?? null,
                  error: null,
                }),
              }),
            }),
          };
          return chain;
        },
      };
    }
    throw new Error(`unexpected table ${name}`);
  };

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    if (fn === "read_email_batch") {
      const queue = args.queue_name as string;
      const rows = state.queues[queue] ?? [];
      return { data: rows.slice(0, args.batch_size as number), error: null };
    }
    if (fn === "delete_email") {
      state.deleted.push({ queue: args.queue_name as string, msgId: args.message_id as number });
      return { data: true, error: null };
    }
    if (fn === "move_to_dlq") {
      state.dlq.push({
        queue: args.source_queue as string,
        msgId: args.message_id as number,
        reason: "",
      });
      return { data: 1, error: null };
    }
    if (fn === "email_resolve_tenant_for_address") {
      return { data: "11111111-1111-4111-8111-111111111111", error: null };
    }
    if (fn === "email_filter_suppressed") {
      const emails = (args.p_emails as string[]) ?? [];
      return {
        data: emails
          .filter((e) => state.suppressed[e])
          .map((e) => ({
            email: e,
            reason: state.suppressed[e],
            scope: state.suppressed[e] === "soft_bounce" ? "transient" : "permanent",
            expires_at: null,
          })),
        error: null,
      };
    }
    throw new Error(`unexpected rpc ${fn}`);
  };

  return { from: table, rpc } as never;
}

function txMessage(over: Partial<Record<string, unknown>> = {}, msgId = 1): QueueRow {
  return {
    msg_id: msgId,
    read_ct: 1,
    enqueued_at: new Date().toISOString(),
    message: {
      message_id: `msg-${msgId}`,
      to: "reader@example.com",
      subject: "Potwierdzenie płatności",
      html: "<p>ok</p>",
      label: "payment_recovered",
      queued_at: new Date().toISOString(),
      ...over,
    },
  };
}

beforeEach(() => {
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue({ ok: true, messageId: "provider-1" });
  providerConfiguredMock.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
describe("drainEmailQueues - ścieżka podstawowa", () => {
  it("wysyła wiadomość, loguje 'sent' i usuwa ją z kolejki", async () => {
    const state = makeState({ queues: { transactional_emails: [txMessage()] } });
    const result = await drainEmailQueues(fakeClient(state), { maxMessages: 10 });

    expect(result.sent).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(state.log.filter((r) => r.status === "sent")).toHaveLength(1);
    expect(state.deleted).toEqual([{ queue: "transactional_emails", msgId: 1 }]);
  });

  it("nie robi nic, gdy żaden dostawca nie jest skonfigurowany", async () => {
    providerConfiguredMock.mockReturnValue(false);
    const state = makeState({ queues: { transactional_emails: [txMessage()] } });
    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.stopped).toBe("not_configured");
    expect(sendEmailMock).not.toHaveBeenCalled();
    // Wiadomość zostaje w kolejce - brak konfiguracji nie może jej skasować.
    expect(state.deleted).toHaveLength(0);
    expect(state.dlq).toHaveLength(0);
  });

  it("obsługuje kolejkę autoryzacyjną PRZED transakcyjną", async () => {
    const state = makeState({
      queues: {
        auth_emails: [txMessage({ message_id: "auth-1", label: "auth_magic_link" }, 7)],
        transactional_emails: [txMessage({}, 8)],
      },
    });
    await drainEmailQueues(fakeClient(state), { maxMessages: 10 });

    // Link do logowania starzeje się szybciej niż potwierdzenie płatności.
    expect(state.deleted.map((d) => d.queue)).toEqual(["auth_emails", "transactional_emails"]);
  });
});

describe("drainEmailQueues - higiena listy w chwili wysyłki", () => {
  it("pomija adres po skardze na spam i loguje powód", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage()] },
      suppressed: { "reader@example.com": "complaint" },
    });
    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.suppressed).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(state.log.at(-1)).toMatchObject({
      status: "suppressed",
      error_message: "suppressed:complaint",
    });
    // Wiadomość znika z kolejki: ponawianie jej nigdy nie da innego wyniku.
    expect(state.deleted).toHaveLength(1);
  });

  it("PRZEPUSZCZA maila transakcyjnego na adres po wypisie z newslettera", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage({ label: "payment_failed" })] },
      suppressed: { "reader@example.com": "unsubscribe" },
    });
    const result = await drainEmailQueues(fakeClient(state), {});

    // Wycofanie zgody marketingowej nie zatrzymuje ostrzeżenia o płatności.
    expect(result.sent).toBe(1);
    expect(result.suppressed).toBe(0);
  });

  it("zepsuty tenant w ładunku NIE wyłącza kontroli listy", async () => {
    // Fail-open odczytu listy jest świadomy (awaria bazy nie może zamilczeć
    // poczty), więc zepsuty tenant nie może dojechać do filtru SQL - inaczej
    // jedna literówka w ładunku po cichu wyłączałaby higienę listy.
    const state = makeState({
      queues: { transactional_emails: [txMessage({ tenant_id: "nie-uuid" })] },
      suppressed: { "reader@example.com": "complaint" },
    });
    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.suppressed).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("zatrzymuje digest na adresie po wypisie", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage({ label: "digest_daily" })] },
      suppressed: { "reader@example.com": "unsubscribe" },
    });
    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.suppressed).toBe(1);
    expect(result.sent).toBe(0);
  });
});

describe("drainEmailQueues - ochrona przed podwójną wysyłką", () => {
  it("usuwa z kolejki wiadomość, która ma już wiersz 'sent'", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage()] },
      log: [{ message_id: "msg-1", status: "sent", error_message: null }],
    });
    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.duplicates).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(state.deleted).toHaveLength(1);
  });
});

describe("drainEmailQueues - czas życia i budżet ponowień", () => {
  it("przenosi do DLQ wiadomość po przekroczeniu TTL", async () => {
    const old = new Date(Date.now() - 90 * 60_000).toISOString();
    const state = makeState({
      queues: { transactional_emails: [txMessage({ queued_at: old })] },
    });
    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.dlq).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(state.log.at(-1)?.status).toBe("dlq");
  });

  it("liczy budżet ponowień po realnych porażkach, nie po read_ct", async () => {
    // Pięć wierszy 'failed' = wyczerpany budżet, mimo read_ct = 1.
    const state = makeState({
      queues: { transactional_emails: [txMessage()] },
      log: Array.from({ length: 5 }, () => ({
        message_id: "msg-1",
        status: "failed",
        error_message: "boom",
      })),
    });
    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.dlq).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("wysoki read_ct SAM w sobie nie zabiera wiadomości do DLQ", async () => {
    // Odczyt bez próby wysyłki (cooldown, blokada) nie jest porażką.
    const msg = txMessage();
    msg.read_ct = 20;
    const state = makeState({ queues: { transactional_emails: [msg] } });
    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.sent).toBe(1);
    expect(result.dlq).toBe(0);
  });

  it("przenosi do DLQ ładunek bez adresu albo bez tematu", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage({ to: "", subject: "" })] },
    });
    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.dlq).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("drainEmailQueues - limit tempa dostawcy", () => {
  it("na 429 włącza wspólny cooldown i kończy przebieg", async () => {
    sendEmailMock.mockResolvedValueOnce({
      ok: false,
      rateLimited: true,
      retryAfterSeconds: 30,
      error: "too many requests",
    });
    const state = makeState({
      queues: { transactional_emails: [txMessage({}, 1), txMessage({ message_id: "msg-2" }, 2)] },
    });
    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.stopped).toBe("rate_limited");
    // Druga wiadomość NIE jest ruszana: limit dotyczy całego konta nadawczego.
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(state.sendState.retry_after_until).toBeTruthy();
    expect(state.deleted).toHaveLength(0);
  });

  it("nie czyta kolejek, gdy cooldown jeszcze trwa", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage()] },
      sendState: {
        retry_after_until: new Date(Date.now() + 60_000).toISOString(),
        batch_size: 10,
        send_delay_ms: 0,
        auth_email_ttl_minutes: 15,
        transactional_email_ttl_minutes: 60,
      },
    });
    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.stopped).toBe("rate_limited");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("drainEmailQueues - błędy dostawcy", () => {
  it("odmowa trwała idzie prosto do DLQ", async () => {
    sendEmailMock.mockResolvedValueOnce({
      ok: false,
      permanent: true,
      status: 403,
      error: "forbidden",
    });
    const state = makeState({ queues: { transactional_emails: [txMessage()] } });
    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.dlq).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("błąd przejściowy zostawia wiadomość w kolejce i liczy porażkę", async () => {
    sendEmailMock.mockResolvedValueOnce({ ok: false, status: 502, error: "bad gateway" });
    const state = makeState({ queues: { transactional_emails: [txMessage()] } });
    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.failed).toBe(1);
    expect(state.log.at(-1)).toMatchObject({ status: "failed" });
    // Brak delete i brak DLQ: wiadomość wróci po wygaśnięciu VT.
    expect(state.deleted).toHaveLength(0);
    expect(state.dlq).toHaveLength(0);
  });
});

describe("drainEmailQueues - budżety przebiegu", () => {
  it("respektuje limit wiadomości na przebieg", async () => {
    const state = makeState({
      queues: {
        transactional_emails: [
          txMessage({ message_id: "msg-1" }, 1),
          txMessage({ message_id: "msg-2" }, 2),
          txMessage({ message_id: "msg-3" }, 3),
        ],
      },
    });
    const result = await drainEmailQueues(fakeClient(state), { maxMessages: 2 });

    expect(result.sent).toBe(2);
    expect(result.stopped).toBe("budget");
  });

  it("kończy czysto po przekroczeniu deadline'u", async () => {
    const state = makeState({ queues: { transactional_emails: [txMessage()] } });
    const result = await drainEmailQueues(fakeClient(state), { deadlineAt: Date.now() - 1 });

    expect(result.stopped).toBe("deadline");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
