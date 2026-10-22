// Dren kolejki - poczta związana z kontem albo zapisem (I9c-X1, RODO po
// usunięciu konta, migracja 20261020160900).
//
// Druga warstwa obrony: mail kroku ścieżki albo digest wstawiony do kolejki
// PRZED wypisem albo usunięciem konta nie może wyjść w najbliższym cyklu
// drenu. Lista wykluczeń tego nie wie (zapis na ścieżkę kończy się w bazie),
// więc dren pyta `email_queue_send_recheck`. Poczty transakcyjnej pytanie nie
// dotyczy - wychodzi bez względu na stan zapisu.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { drainEmailQueues } from "../queueDrain.server";
import { ACCOUNT_BOUND_EMAIL_LABELS } from "../suppressionPolicy";

const sendEmailMock = vi.fn();

vi.mock("../provider.server", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  emailProviderConfigured: () => true,
}));

const TENANT = "11111111-1111-4111-8111-111111111111";
const ENROLLMENT = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";

interface QueueRow {
  msg_id: number;
  read_ct: number;
  message: Record<string, unknown>;
}

interface FakeState {
  queue: QueueRow[];
  log: {
    message_id: string | null;
    status: string;
    error_message: string | null;
    recipient_email: string | null;
  }[];
  suppressed: Record<string, string>;
  deleted: number[];
  /** Werdykt bazy per klucz idempotencji (brak wpisu = "ok"). */
  verdicts: Record<string, string>;
  /** Błąd zapytania o werdykt (awaria bazy). */
  recheckError: boolean;
  recheckCalls: Record<string, unknown>[];
}

function makeState(over: Partial<FakeState> = {}): FakeState {
  return {
    queue: [],
    log: [],
    suppressed: {},
    deleted: [],
    verdicts: {},
    recheckError: false,
    recheckCalls: [],
    ...over,
  };
}

function fakeClient(state: FakeState) {
  const from = (name: string) => {
    if (name === "email_send_state") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { retry_after_until: null, batch_size: 10, send_delay_ms: 0 },
              error: null,
            }),
          }),
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
            recipient_email: (row.recipient_email as string) ?? null,
          });
          return { error: null };
        },
        select: () => ({
          in: () => ({ eq: async () => ({ data: [], error: null }) }),
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        }),
      };
    }
    throw new Error(`unexpected table ${name}`);
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    if (fn === "read_email_batch") {
      return {
        data: args.queue_name === "transactional_emails" ? state.queue : [],
        error: null,
      };
    }
    if (fn === "delete_email") {
      state.deleted.push(args.message_id as number);
      return { data: true, error: null };
    }
    if (fn === "email_filter_suppressed") {
      const emails = (args.p_emails as string[]) ?? [];
      return {
        data: emails
          .filter((e) => state.suppressed[e])
          .map((e) => ({
            email: e,
            reason: state.suppressed[e],
            scope: "permanent",
            expires_at: null,
          })),
        error: null,
      };
    }
    if (fn === "email_queue_send_recheck") {
      state.recheckCalls.push(args);
      if (state.recheckError) return { data: null, error: { message: "db down" } };
      const key = String(args.p_idempotency_key ?? "");
      return { data: state.verdicts[key] ?? "ok", error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
  };
  return { from, rpc } as never;
}

function message(label: string, key: string, msgId = 1): QueueRow {
  return {
    msg_id: msgId,
    read_ct: 0,
    message: {
      message_id: `msg-${msgId}`,
      to: "reader@example.com",
      subject: "Temat",
      html: "<p>Treść</p>",
      label,
      idempotency_key: key,
      tenant_id: TENANT,
      queued_at: new Date().toISOString(),
    },
  };
}

beforeEach(() => {
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue({ ok: true, messageId: "provider-1" });
});

describe("dren - poczta związana z kontem albo zapisem", () => {
  it("wypis w trakcie cyklu: mail ścieżki marketingowej pominięty, powód w dzienniku, wiadomość znika", async () => {
    const key = `journey:${ENROLLMENT}:email-1`;
    const state = makeState({
      queue: [message("journey", key)],
      verdicts: { [key]: "skipped:unsubscribed" },
    });

    const result = await drainEmailQueues(fakeClient(state), { maxMessages: 10 });

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sent: 0, suppressed: 1 });
    expect(state.recheckCalls).toEqual([{ p_label: "journey", p_idempotency_key: key }]);
    // Wypis to nie usunięcie konta: adres zostaje jak w każdym wpisie listy.
    expect(state.log).toEqual([
      {
        message_id: "msg-1",
        status: "suppressed",
        error_message: "skipped:unsubscribed",
        recipient_email: "reader@example.com",
      },
    ]);
    expect(state.deleted).toEqual([1]);
  });

  it("usunięcie konta: krok ścieżki (także usługowej) i digest konta pominięte", async () => {
    const journeyKey = `journey:${ENROLLMENT}:email-2`;
    const digestKey = `digest:daily:${ACCOUNT}:2026-10-20`;
    const state = makeState({
      queue: [message("journey_service", journeyKey, 1), message("digest_daily", digestKey, 2)],
      verdicts: {
        [journeyKey]: "skipped:exited:account_deleted",
        [digestKey]: "skipped:account_deleted",
      },
    });

    const result = await drainEmailQueues(fakeClient(state), { maxMessages: 10 });

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(result.suppressed).toBe(2);
    expect(state.log.map((r) => r.error_message)).toEqual([
      "skipped:exited:account_deleted",
      "skipped:account_deleted",
    ]);
    // Konto usunięte: wpis zatrzymania bez adresu (jak anulowanie w SQL).
    expect(state.log.map((r) => r.recipient_email)).toEqual(["[redacted]", "[redacted]"]);
    expect(state.deleted).toEqual([1, 2]);
  });

  it("mail transakcyjny wychodzi bez pytania o zapis (także na adres po wypisie)", async () => {
    const state = makeState({
      queue: [message("payment_failed", "invoice:2026-10:1")],
      suppressed: { "reader@example.com": "unsubscribe" },
    });

    const result = await drainEmailQueues(fakeClient(state), { maxMessages: 10 });

    expect(result).toMatchObject({ sent: 1, suppressed: 0 });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(state.recheckCalls).toEqual([]);
  });

  it("zapis i zgoda obowiązują: mail ścieżki wychodzi", async () => {
    const key = `journey:${ENROLLMENT}:email-3`;
    const state = makeState({ queue: [message("journey", key)] });

    const result = await drainEmailQueues(fakeClient(state), { maxMessages: 10 });

    expect(result.sent).toBe(1);
    expect(state.recheckCalls).toHaveLength(1);
    expect(state.log.map((r) => r.status)).toEqual(["sent"]);
  });

  it("lista wykluczeń zatrzymuje mail masowy, zanim dren zapyta o zapis", async () => {
    const state = makeState({
      queue: [message("digest_weekly", `digest:weekly:${ACCOUNT}:2026-10-20`)],
      suppressed: { "reader@example.com": "unsubscribe" },
    });

    const result = await drainEmailQueues(fakeClient(state), { maxMessages: 10 });

    expect(result.suppressed).toBe(1);
    expect(state.log[0]?.error_message).toBe("suppressed:unsubscribe");
    expect(state.recheckCalls).toEqual([]);
  });

  it("awaria bazy przy pytaniu: bez wysyłki i bez kasowania - wiadomość wraca w kolejnym cyklu", async () => {
    const state = makeState({
      queue: [message("journey_test", `journey:${ENROLLMENT}:email-4`)],
      recheckError: true,
    });

    const result = await drainEmailQueues(fakeClient(state), { maxMessages: 10 });

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(state.deleted).toEqual([]);
    expect(state.log).toEqual([]);
    expect(result).toMatchObject({ sent: 0, suppressed: 0, failed: 0, dlq: 0 });
  });

  it("każda etykieta z listy pyta bazę, inne nie", async () => {
    const labels = [...ACCOUNT_BOUND_EMAIL_LABELS, "newsletter_confirmed", "event_ticket_issued"];
    const state = makeState({
      queue: labels.map((label, i) => message(label, `k:${i}`, i + 1)),
    });

    await drainEmailQueues(fakeClient(state), { maxMessages: 20 });

    expect(state.recheckCalls.map((c) => c.p_label)).toEqual([...ACCOUNT_BOUND_EMAIL_LABELS]);
  });
});
