// Dren kolejek pocztowych - warstwa ODPORNOŚCI, dopełnienie `queueDrain.test.ts`.
//
// Tamten plik pilnuje decyzji na ŚCIEŻCE ZDROWEJ (co wysłać, czego nie wysłać,
// kiedy do DLQ). Ten pilnuje tego, co się dzieje, gdy baza, dostawca albo
// ładunek nie zachowują się jak w podręczniku - a to tutaj mieszkają awarie,
// które w produkcji objawiają się jako „poczta nie wychodzi i nikt nie wie
// dlaczego":
//   * awaria pojedynczego zapytania (odczyt porcji, licznik ponowień, zapis
//     logu, kasowanie z kolejki, przenosiny do DLQ, zapis cooldownu) NIE MOŻE
//     wywrócić całego przebiegu ani cofnąć wysyłki, która już się stała,
//   * śmieci w porcji (wiersz nie-rekord, brak msg_id, ładunek nie-obiekt) mają
//     zostać pominięte, a nie zatrzymać resztę kolejki,
//   * brak wiersza konfiguracji i zepsute wartości w nim MUSZĄ dać wartości
//     domyślne - inaczej jedna pusta tabela zatrzymuje całą pocztę platformy,
//   * budżet i deadline muszą zatrzymać przebieg TAKŻE w środku porcji, i to
//     widocznie (`stopped`), bo cichy powrót z zaległością w kolejce wygląda
//     dla wywołującego jak opróżniona kolejka,
//   * wygładzanie tempa między wysyłkami ma REALNIE czekać - to ono chroni
//     konto nadawcze przed 429 od dostawcy.
//
// Zegar jest atrapą (stała chwila bazowa + ręczne przesuwanie), więc pauza
// między wysyłkami jest MIERZONA, a nie odczekiwana.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { drainEmailQueues } from "../queueDrain.server";
import type { SendGateResult } from "../suppression.server";

/** Stała chwila bazowa - wszystkie znaczniki czasu w testach liczą się od niej. */
const NOW = new Date("2026-08-22T09:00:00.000Z");
const TENANT = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
// Atrapy modułów
// ---------------------------------------------------------------------------
const sendEmailMock = vi.fn();
const providerConfiguredMock = vi.fn(() => true);

vi.mock("../provider.server", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  emailProviderConfigured: () => providerConfiguredMock(),
}));

/** Wymuszona odpowiedź bramy higieny listy (null = prawdziwa implementacja). */
interface GateOverride {
  forced: SendGateResult | null;
}
const gate: GateOverride = vi.hoisted(() => ({ forced: null }));

// Brama zostaje PRAWDZIWA (to ona rozstrzyga o pominięciach i o tagu tenanta);
// nadpisujemy ją tylko tam, gdzie trzeba pokazać odmowę BEZ wskazanej blokady -
// stanu, do którego prawdziwa brama dochodzi wyłącznie przy pustym adresie,
// czyli po ścieżce, którą dren odcina wcześniej.
vi.mock("../suppression.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../suppression.server")>();
  return {
    ...actual,
    checkSendAllowed: (...args: Parameters<typeof actual.checkSendAllowed>) =>
      gate.forced === null ? actual.checkSendAllowed(...args) : Promise.resolve(gate.forced),
  };
});

// ---------------------------------------------------------------------------
// Atrapa klienta bazy - jak w `queueDrain.test.ts`, rozszerzona o wstrzykiwanie
// awarii per zapytanie oraz o podawanie ODPOWIEDZI WPROST (żeby dało się oddać
// kształt, którego typy nie przewidują: nie-tablicę, wiersz nie-rekord).
// ---------------------------------------------------------------------------
interface LogRow {
  message_id: string | null;
  template_name: string | null;
  recipient_email: string | null;
  status: string;
  error_message: string | null;
}

/** Komunikaty błędów wstrzykiwane w poszczególne zapytania (null = sprawne). */
interface Failures {
  readBatch: string | null;
  deleteEmail: string | null;
  moveToDlq: string | null;
  logInsert: string | null;
  failedAttempts: string | null;
  cooldownWrite: string | null;
}

interface FakeState {
  /** Wiersze kolejek - typ `unknown`, bo test podaje też ładunki zepsute. */
  queues: Record<string, unknown[]>;
  /** Gdy ustawione: odpowiedź RPC odczytu porcji podana WPROST. */
  rawBatch: { value: unknown } | null;
  /** Baza oddaje całą kolejkę, ignorując zamówiony rozmiar porcji. */
  ignoreBatchSize: boolean;
  log: LogRow[];
  /** Gdy ustawione: odpowiedź zapytania o liczniki porażek podana WPROST. */
  rawFailedAttempts: { value: unknown } | null;
  /** Ile razy dren pytał o liczniki nieudanych prób. */
  failedAttemptQueries: number;
  suppressed: Record<string, string>;
  /** Tenant zwracany przez RPC rozwiązujący adres (null = adres bez tenanta). */
  resolvedTenant: string | null;
  /** Wiersz singletona konfiguracji (null = brak wiersza w bazie). */
  sendState: Record<string, unknown> | null;
  deleted: { queue: string; msgId: number }[];
  dlq: { queue: string; msgId: number }[];
  /** Ślad wszystkich wywołań RPC - do dowodów o zapytaniach OSZCZĘDZONYCH. */
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
  fail: Failures;
}

function makeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    queues: {},
    rawBatch: null,
    ignoreBatchSize: false,
    log: [],
    rawFailedAttempts: null,
    failedAttemptQueries: 0,
    suppressed: {},
    resolvedTenant: TENANT,
    sendState: {
      retry_after_until: null,
      batch_size: 10,
      send_delay_ms: 0,
      auth_email_ttl_minutes: 15,
      transactional_email_ttl_minutes: 60,
    },
    deleted: [],
    dlq: [],
    rpcCalls: [],
    fail: {
      readBatch: null,
      deleteEmail: null,
      moveToDlq: null,
      logInsert: null,
      failedAttempts: null,
      cooldownWrite: null,
    },
    ...overrides,
  };
}

function fakeClient(state: FakeState) {
  const table = (name: string) => {
    if (name === "email_send_state") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: state.sendState, error: null }) }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            if (state.fail.cooldownWrite) return { error: { message: state.fail.cooldownWrite } };
            state.sendState = { ...(state.sendState ?? {}), ...patch };
            return { error: null };
          },
        }),
      };
    }
    if (name === "email_send_log") {
      return {
        insert: async (row: Record<string, unknown>) => {
          if (state.fail.logInsert) return { error: { message: state.fail.logInsert } };
          state.log.push({
            message_id: (row.message_id as string) ?? null,
            template_name: (row.template_name as string) ?? null,
            recipient_email: (row.recipient_email as string) ?? null,
            status: row.status as string,
            error_message: (row.error_message as string) ?? null,
          });
          return { error: null };
        },
        select: () => {
          const rows = state.log;
          return {
            in: (_col: string, ids: string[]) => ({
              eq: async (_c: string, status: string) => {
                state.failedAttemptQueries += 1;
                if (state.fail.failedAttempts) {
                  return { data: null, error: { message: state.fail.failedAttempts } };
                }
                if (state.rawFailedAttempts) {
                  return { data: state.rawFailedAttempts.value, error: null };
                }
                return {
                  data: rows.filter(
                    (r) => r.message_id && ids.includes(r.message_id) && r.status === status,
                  ),
                  error: null,
                };
              },
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
        },
      };
    }
    throw new Error(`unexpected table ${name}`);
  };

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({ fn, args });
    if (fn === "read_email_batch") {
      if (state.fail.readBatch) return { data: null, error: { message: state.fail.readBatch } };
      if (state.rawBatch) return { data: state.rawBatch.value, error: null };
      const rows = state.queues[args.queue_name as string] ?? [];
      return {
        data: state.ignoreBatchSize ? rows : rows.slice(0, args.batch_size as number),
        error: null,
      };
    }
    if (fn === "delete_email") {
      if (state.fail.deleteEmail) return { data: null, error: { message: state.fail.deleteEmail } };
      state.deleted.push({ queue: args.queue_name as string, msgId: args.message_id as number });
      return { data: true, error: null };
    }
    if (fn === "move_to_dlq") {
      if (state.fail.moveToDlq) return { data: null, error: { message: state.fail.moveToDlq } };
      state.dlq.push({
        queue: args.source_queue as string,
        msgId: args.message_id as number,
      });
      return { data: 1, error: null };
    }
    if (fn === "email_resolve_tenant_for_address") {
      return { data: state.resolvedTenant, error: null };
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

interface QueueRow {
  msg_id: number;
  read_ct: number;
  enqueued_at?: string | null;
  message: Record<string, unknown>;
}

function txMessage(over: Record<string, unknown> = {}, msgId = 1): QueueRow {
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

/** Argumenty ostatniej wysyłki - do dowodów o tym, CO dren podał dostawcy. */
function lastSendInput(): Record<string, unknown> {
  const call = sendEmailMock.mock.calls.at(-1);
  return (call?.[0] ?? {}) as Record<string, unknown>;
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  gate.forced = null;
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue({ ok: true, messageId: "provider-1" });
  providerConfiguredMock.mockReturnValue(true);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
describe("drainEmailQueues - awaria pojedynczego zapytania", () => {
  it("awaria odczytu kolejki kończy przebieg spokojnie, zamiast rzucić w tick", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage()] },
      fail: { ...makeState().fail, readBatch: "pgmq: relation does not exist" },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Dren biegnie obok innych zadań ticku - jego awaria nie może zabrać im budżetu.
    expect(result).toEqual({
      sent: 0,
      failed: 0,
      suppressed: 0,
      dlq: 0,
      duplicates: 0,
      stopped: null,
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[email-queue] read failed",
      "auth_emails",
      "pgmq: relation does not exist",
    );
  });

  it("nieudany zapis logu NIE odkręca wysyłki, ale zostawia ślad w konsoli", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage()] },
      fail: { ...makeState().fail, logInsert: "duplicate key" },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Mail już poleciał: udawanie, że się nie stało, dałoby drugą wysyłkę.
    expect(result.sent).toBe(1);
    expect(state.deleted).toEqual([{ queue: "transactional_emails", msgId: 1 }]);
    expect(errorSpy).toHaveBeenCalledWith(
      "[email-queue] send log insert failed",
      "sent",
      "duplicate key",
    );
  });

  it("nieudane skasowanie wysłanej wiadomości jest widoczne w logu operacyjnym", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage()] },
      fail: { ...makeState().fail, deleteEmail: "pgmq: no such msg" },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Wiadomość wróci po wygaśnięciu VT - przed drugą wysyłką broni wtedy
    // wyłącznie wiersz 'sent', więc ten błąd musi być słyszalny.
    expect(result.sent).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[email-queue] delete failed",
      "transactional_emails",
      1,
      "pgmq: no such msg",
    );
  });

  it("nieudane przeniesienie do DLQ nie gubi się po cichu", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage({ to: "" })] },
      fail: { ...makeState().fail, moveToDlq: "dlq queue missing" },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Bez tego logu wiadomość zostaje w kolejce i wraca w kółko przy pustym DLQ.
    expect(result.dlq).toBe(1);
    expect(state.dlq).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      "[email-queue] dlq move failed",
      "transactional_emails",
      1,
      "dlq queue missing",
    );
  });

  it("awaria licznika ponowień NIE wstrzymuje poczty", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage()] },
      fail: { ...makeState().fail, failedAttempts: "statement timeout" },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Fail-open jest tu świadomy: niedostępny licznik nie może zamilczeć poczty.
    expect(result.sent).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[email-queue] failed-attempt counters unavailable",
      "statement timeout",
    );
  });

  it("nieudany zapis cooldownu nie udaje, że limit tempa minął", async () => {
    sendEmailMock.mockResolvedValueOnce({
      ok: false,
      rateLimited: true,
      retryAfterSeconds: 30,
      error: "too many requests",
    });
    const state = makeState({
      queues: { transactional_emails: [txMessage()] },
      fail: { ...makeState().fail, cooldownWrite: "read-only transaction" },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Przebieg i tak się kończy - inaczej dren młóciłby dostawcę mimo 429.
    expect(result.stopped).toBe("rate_limited");
    expect(errorSpy).toHaveBeenCalledWith(
      "[email-queue] cooldown write failed",
      "read-only transaction",
    );
  });
});

// ---------------------------------------------------------------------------
describe("drainEmailQueues - zepsuta odpowiedź kolejki", () => {
  it("odpowiedź, która nie jest listą wiadomości, daje przebieg pusty, nie awarię", async () => {
    const state = makeState({ rawBatch: { value: { unexpected: "shape" } } });

    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.sent).toBe(0);
    expect(result.stopped).toBeNull();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("śmieci w porcji są pomijane, a czytelny wiersz nadal jest obsłużony", async () => {
    // Wiersz nie-rekord, wiersz bez liczbowego msg_id i ładunek, który nie jest
    // obiektem - każdy z nich mógłby wywrócić pętlę i zatrzymać całą kolejkę.
    const state = makeState({
      queues: {
        transactional_emails: [
          null,
          { msg_id: "nie-liczba", message: { to: "x@example.com" } },
          { msg_id: 42, read_ct: 0, message: "to nie jest obiekt" },
        ],
      },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Pusty ładunek nie ma adresata: jedyne sensowne miejsce to DLQ.
    expect(result.dlq).toBe(1);
    expect(state.dlq).toEqual([{ queue: "transactional_emails", msgId: 42 }]);
    expect(sendEmailMock).not.toHaveBeenCalled();
    // Etykieta w logu spada na nazwę kolejki - inaczej wiersz DLQ byłby bezimienny.
    expect(state.log.at(-1)).toMatchObject({
      status: "dlq",
      template_name: "transactional_emails",
      error_message: "invalid_payload (missing recipient or subject)",
    });
  });

  it("liczniki porażek są pomijane dla wierszy bez identyfikatora wiadomości", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage()] },
      rawFailedAttempts: { value: [null, { message_id: null }, { message_id: "msg-1" }] },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Jedna realna porażka to wciąż daleko do progu DLQ - mail ma wyjść.
    expect(result.sent).toBe(1);
    expect(result.dlq).toBe(0);
  });

  it("brak wierszy licznika porażek czyta się jak zero prób, nie jak awaria", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage()] },
      rawFailedAttempts: { value: null },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.sent).toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("drainEmailQueues - konfiguracja przebiegu", () => {
  it("brak wiersza konfiguracji nie zatrzymuje poczty - obowiązują wartości domyślne", async () => {
    const halfHourAgo = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const state = makeState({
      sendState: null,
      queues: {
        auth_emails: [txMessage({ message_id: "auth-1", queued_at: halfHourAgo }, 5)],
        transactional_emails: [txMessage({ queued_at: halfHourAgo }, 6)],
      },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Domyślne TTL: 15 minut dla linku do logowania, 60 dla transakcyjnego.
    expect(result.dlq).toBe(1);
    expect(state.dlq).toEqual([{ queue: "auth_emails", msgId: 5 }]);
    expect(result.sent).toBe(1);
  });

  it("nieliczbowe wartości w konfiguracji spadają na wartości domyślne", async () => {
    const twoHoursAgo = new Date(NOW.getTime() - 120 * 60_000).toISOString();
    const state = makeState({
      sendState: {
        retry_after_until: null,
        batch_size: "20",
        send_delay_ms: null,
        auth_email_ttl_minutes: {},
        transactional_email_ttl_minutes: "godzina",
      },
      queues: { transactional_emails: [txMessage({ queued_at: twoHoursAgo })] },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Domyślne 60 minut zadziałało: dwugodzinny mail nie jedzie do adresata.
    expect(result.dlq).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("ujemne limity w konfiguracji są dociskane do minimum, nie wyłączają drenu", async () => {
    const twoMinutesAgo = new Date(NOW.getTime() - 2 * 60_000).toISOString();
    const state = makeState({
      sendState: {
        retry_after_until: null,
        batch_size: -5,
        send_delay_ms: -100,
        auth_email_ttl_minutes: -1,
        transactional_email_ttl_minutes: -1,
      },
      queues: {
        transactional_emails: [
          txMessage({ message_id: "msg-1", queued_at: twoMinutesAgo }, 1),
          txMessage({ message_id: "msg-2" }, 2),
        ],
      },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Porcja dociśnięta do 1 wiersza: druga wiadomość zostaje na następny tick.
    expect(result.dlq).toBe(1);
    expect(result.sent).toBe(0);
    // TTL dociśnięty do 1 minuty: dwuminutowa wiadomość jest już przeterminowana.
    expect(state.log.at(-1)?.error_message).toBe("TTL exceeded (1 minutes)");
  });

  it("niedająca się odczytać data cooldownu nie blokuje wysyłki na zawsze", async () => {
    const state = makeState({
      sendState: {
        retry_after_until: "wczoraj",
        batch_size: 10,
        send_delay_ms: 0,
        auth_email_ttl_minutes: 15,
        transactional_email_ttl_minutes: 60,
      },
      queues: { transactional_emails: [txMessage()] },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Zepsuty znacznik nie może uziemić poczty platformy w nieskończoność.
    expect(result.stopped).toBeNull();
    expect(result.sent).toBe(1);
  });

  it("wskazanie kolejki ogranicza przebieg wyłącznie do niej", async () => {
    const state = makeState({
      queues: {
        auth_emails: [txMessage({ message_id: "auth-1" }, 9)],
        transactional_emails: [txMessage({}, 10)],
      },
    });

    const result = await drainEmailQueues(fakeClient(state), { queues: ["transactional_emails"] });

    // Diagnostyka jednej kolejki nie może przy okazji ruszyć linków do logowania.
    expect(result.sent).toBe(1);
    expect(state.deleted).toEqual([{ queue: "transactional_emails", msgId: 10 }]);
    expect(state.rpcCalls.filter((c) => c.fn === "read_email_batch")).toHaveLength(1);
  });

  it("obie kolejki puste dają wynik zerowy bez powodu zatrzymania", async () => {
    const state = makeState();

    const result = await drainEmailQueues(fakeClient(state), {});

    // `stopped: null` znaczy dla wywołującego „nie ma po co wracać" - i tu jest prawdą.
    expect(result).toEqual({
      sent: 0,
      failed: 0,
      suppressed: 0,
      dlq: 0,
      duplicates: 0,
      stopped: null,
    });
  });
});

// ---------------------------------------------------------------------------
describe("drainEmailQueues - ładunek bez pełnych danych", () => {
  it("wiadomość bez identyfikatora korelacyjnego i tak wychodzi", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage({ message_id: null }, 3)] },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.sent).toBe(1);
    expect(lastSendInput().messageId).toBeUndefined();
    // Bez identyfikatorów nie ma o co pytać licznika porażek - to zapytanie odpada.
    expect(state.failedAttemptQueries).toBe(0);
  });

  it("bez identyfikatora budżet ponowień liczy się po liczbie odczytów", async () => {
    const msg = txMessage({ message_id: null }, 4);
    msg.read_ct = 5;
    const state = makeState({ queues: { transactional_emails: [msg] } });

    const result = await drainEmailQueues(fakeClient(state), {});

    // To jedyny licznik, jaki wtedy istnieje - inaczej taka wiadomość krążyłaby wiecznie.
    expect(result.dlq).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("porażka wiadomości bez identyfikatora nie wywraca licznika ponowień", async () => {
    sendEmailMock.mockResolvedValueOnce({ ok: false, status: 502, error: "bad gateway" });
    const state = makeState({
      queues: { transactional_emails: [txMessage({ message_id: null }, 12)] },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Nie ma klucza, pod którym dałoby się doliczyć próbę w pamięci przebiegu;
    // budżet takiej wiadomości pilnuje licznik odczytów po stronie kolejki.
    expect(result.failed).toBe(1);
    expect(state.deleted).toHaveLength(0);
    expect(state.dlq).toHaveLength(0);
  });

  it("wiadomość bez etykiety jest wysyłana pod nazwą swojej kolejki", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage({ label: "" })] },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.sent).toBe(1);
    expect(lastSendInput().label).toBe("transactional_emails");
    // Bez etykiety w tagach webhook odbicia nie miałby czego przypisać do kanału.
    expect(lastSendInput().tags).toMatchObject({ label: "transactional_emails" });
  });

  it("brak znacznika czasu w ładunku nie wyłącza TTL - liczy się czas z kolejki", async () => {
    const row = txMessage({ queued_at: null }, 11);
    row.enqueued_at = new Date(NOW.getTime() - 90 * 60_000).toISOString();
    const state = makeState({ queues: { transactional_emails: [row] } });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Inaczej wiadomość bez `queued_at` byłaby wieczna i dowiozłaby link po godzinach.
    expect(result.dlq).toBe(1);
    expect(state.log.at(-1)?.error_message).toBe("TTL exceeded (60 minutes)");
  });

  it("poprawny tenant w ładunku oszczędza zapytanie rozwiązujące adres", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage({ tenant_id: TENANT })] },
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.sent).toBe(1);
    expect(state.rpcCalls.filter((c) => c.fn === "email_resolve_tenant_for_address")).toHaveLength(
      0,
    );
    // Zakres listy wykluczeń to nadal ten tenant - kontrola nie została pominięta.
    expect(state.rpcCalls.find((c) => c.fn === "email_filter_suppressed")?.args.p_tenant).toBe(
      TENANT,
    );
  });

  it("adres bez przypisanego tenanta wychodzi bez tagu tenanta", async () => {
    const state = makeState({
      queues: { transactional_emails: [txMessage()] },
      resolvedTenant: null,
    });

    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.sent).toBe(1);
    // Pusty tag byłby gorszy niż jego brak: webhook przypisałby odbicie do „niczego".
    expect(lastSendInput().tags).toEqual({
      label: "payment_recovered",
      queue: "transactional_emails",
    });
  });

  it("odmowa bramy bez wskazanej blokady trafia do logu jako ogólne 'suppressed'", async () => {
    gate.forced = { allowed: false, hit: null, tenantId: null };
    const state = makeState({ queues: { transactional_emails: [txMessage()] } });

    const result = await drainEmailQueues(fakeClient(state), {});

    // Powód nieznany, ale decyzja jednoznaczna: nie wysyłamy i nie ponawiamy.
    expect(result.suppressed).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(state.log.at(-1)).toMatchObject({ status: "suppressed", error_message: "suppressed" });
    expect(state.deleted).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("drainEmailQueues - odmowy dostawcy bez szczegółów", () => {
  it("limit tempa bez podanego czasu karencji włącza minutę wstrzymania", async () => {
    sendEmailMock.mockResolvedValueOnce({ ok: false, rateLimited: true });
    const state = makeState({ queues: { transactional_emails: [txMessage()] } });

    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.stopped).toBe("rate_limited");
    // Domyślna minuta zamiast natychmiastowego powrotu pod ten sam 429.
    expect(state.sendState?.retry_after_until).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    expect(state.log.at(-1)).toMatchObject({ status: "failed", error_message: "rate_limited" });
  });

  it("trwała odmowa bez treści błędu i tak niesie do DLQ czytelny powód", async () => {
    sendEmailMock.mockResolvedValueOnce({ ok: false, permanent: true });
    const state = makeState({ queues: { transactional_emails: [txMessage()] } });

    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.dlq).toBe(1);
    // „http_4xx" to mało, ale wystarczy, żeby wiersz DLQ dało się odróżnić od TTL.
    expect(state.log.at(-1)).toMatchObject({ status: "dlq", error_message: "http_4xx" });
  });

  it("milcząca porażka dostawcy zostawia wiadomość w kolejce z nazwanym powodem", async () => {
    sendEmailMock.mockResolvedValueOnce({ ok: false });
    const state = makeState({ queues: { transactional_emails: [txMessage()] } });

    const result = await drainEmailQueues(fakeClient(state), {});

    expect(result.failed).toBe(1);
    expect(state.log.at(-1)).toMatchObject({ status: "failed", error_message: "http_unknown" });
    expect(state.deleted).toHaveLength(0);
    expect(state.dlq).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("drainEmailQueues - przerwanie w połowie", () => {
  it("budżet zjedzony przez pierwszą kolejkę nie pozwala tknąć drugiej", async () => {
    const state = makeState({
      queues: {
        auth_emails: [txMessage({ message_id: "auth-1" }, 1)],
        transactional_emails: [txMessage({ message_id: "tx-1" }, 2)],
      },
    });

    const result = await drainEmailQueues(fakeClient(state), { maxMessages: 1 });

    expect(result.sent).toBe(1);
    expect(state.deleted).toEqual([{ queue: "auth_emails", msgId: 1 }]);
    // Kolejka transakcyjna nie jest nawet czytana - i wywołujący o tym wie.
    expect(state.rpcCalls.filter((c) => c.fn === "read_email_batch")).toHaveLength(1);
    expect(result.stopped).toBe("budget");
  });

  it("większa porcja niż zamówiona nie przebija budżetu przebiegu", async () => {
    // Rozmiar porcji egzekwuje baza; gdyby oddała więcej wierszy, jedynym
    // hamulcem zostaje budżet - bez niego tick wysłałby więcej, niż mu wolno.
    const state = makeState({
      ignoreBatchSize: true,
      queues: {
        transactional_emails: [
          txMessage({ message_id: "msg-1" }, 1),
          txMessage({ message_id: "msg-2" }, 2),
          txMessage({ message_id: "msg-3" }, 3),
        ],
      },
      sendState: {
        retry_after_until: null,
        batch_size: 10,
        send_delay_ms: 50,
        auth_email_ttl_minutes: 15,
        transactional_email_ttl_minutes: 60,
      },
    });

    const run = drainEmailQueues(fakeClient(state), { maxMessages: 2 });
    await vi.advanceTimersByTimeAsync(50);
    const result = await run;

    expect(result.sent).toBe(2);
    expect(result.stopped).toBe("budget");
    expect(state.deleted.map((d) => d.msgId)).toEqual([1, 2]);
  });

  it("deadline przekroczony w środku porcji zostawia resztę na następny tick", async () => {
    sendEmailMock.mockImplementation(async () => {
      // Wysyłka trwa - dostawca odpowiada po pięciu sekundach.
      vi.setSystemTime(NOW.getTime() + 5_000);
      return { ok: true, messageId: "provider-1" };
    });
    const state = makeState({
      queues: {
        transactional_emails: [
          txMessage({ message_id: "msg-1" }, 1),
          txMessage({ message_id: "msg-2" }, 2),
        ],
      },
    });

    const result = await drainEmailQueues(fakeClient(state), {
      maxMessages: 10,
      deadlineAt: NOW.getTime() + 1_000,
    });

    expect(result.sent).toBe(1);
    // Bez tego powodu wywołujący uznałby kolejkę za opróżnioną.
    expect(result.stopped).toBe("deadline");
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
describe("drainEmailQueues - wygładzanie tempa", () => {
  it("odczekuje ustawioną pauzę między wysyłkami, zamiast strzelać salwą", async () => {
    const state = makeState({
      queues: {
        transactional_emails: [
          txMessage({ message_id: "msg-1" }, 1),
          txMessage({ message_id: "msg-2" }, 2),
        ],
      },
      sendState: {
        retry_after_until: null,
        batch_size: 10,
        send_delay_ms: 200,
        auth_email_ttl_minutes: 15,
        transactional_email_ttl_minutes: 60,
      },
    });

    const run = drainEmailQueues(fakeClient(state), { maxMessages: 10 });
    await vi.advanceTimersByTimeAsync(0);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(199);
    // Pauza jeszcze trwa - to ona chroni konto nadawcze przed odpowiedzią 429.
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const result = await run;

    expect(result.sent).toBe(2);
    // Ostatnia wiadomość w porcji nie dokłada pauzy - przebieg kończy się od razu.
    expect(vi.getTimerCount()).toBe(0);
  });
});
