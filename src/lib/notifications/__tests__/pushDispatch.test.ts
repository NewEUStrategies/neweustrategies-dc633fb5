// processPushJobs: izolacja tenantów, kolejki per urządzenie, agregacja
// raportów i deduplikacja RPC. Krypto ma własny test (webpush.test.ts), więc
// tutaj podmieniamy WYŁĄCZNIE `sendWebPush` i klienta service role - reszta
// (clamp payloadu, temat kolapsu, serializacja) jedzie prawdziwym kodem.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PushSendResult, PushSubscriptionKeys } from "@/lib/notifications/webpush.server";

interface QueryResponse {
  data: unknown;
  error: unknown;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface SendCall {
  endpoint: string;
  payload: Record<string, unknown>;
  topic?: string;
}

const h = vi.hoisted(() => {
  const state = {
    jobs: [] as unknown[],
    subscriptions: [] as unknown[],
    profiles: [] as unknown[],
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    /** endpoint -> kolejne odpowiedzi usługi push (ostatnia się powtarza). */
    responses: new Map<string, Partial<PushSendResult>[]>(),
    sends: [] as { endpoint: string; payload: Record<string, unknown>; topic?: string }[],
    tableFilters: [] as { table: string; column: string; values: unknown }[],
  };
  return { state };
});

vi.mock("@/integrations/supabase/client.server", () => {
  const respond = (table: string): QueryResponse => {
    if (table === "push_subscriptions") return { data: h.state.subscriptions, error: null };
    if (table === "profiles") return { data: h.state.profiles, error: null };
    return { data: [], error: null };
  };

  interface Chain extends PromiseLike<QueryResponse> {
    select: (...args: unknown[]) => Chain;
    in: (column: string, values: unknown) => Chain;
    is: (...args: unknown[]) => Chain;
  }

  const chainFor = (table: string): Chain => {
    const chain: Chain = {
      select: () => chain,
      in: (column, values) => {
        h.state.tableFilters.push({ table, column, values });
        return chain;
      },
      is: () => chain,
      then: (onFulfilled, onRejected) =>
        Promise.resolve(respond(table)).then(onFulfilled, onRejected),
    };
    return chain;
  };

  return {
    supabaseAdmin: {
      from: (table: string) => chainFor(table),
      rpc: (name: string, args: Record<string, unknown>) => {
        h.state.rpcCalls.push({ name, args });
        if (name === "claim_push_jobs") return Promise.resolve({ data: h.state.jobs, error: null });
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

vi.mock("@/lib/notifications/webpush.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/webpush.server")>();
  return {
    ...actual,
    vapidFromEnv: () => ({
      publicKey: "test-public-key",
      privateKey: "test-private-key",
      subject: "mailto:test@example.com",
    }),
    sendWebPush: vi.fn(
      async (
        sub: PushSubscriptionKeys,
        payload: Buffer,
        _vapid: unknown,
        options?: { topic?: string },
      ): Promise<PushSendResult> => {
        h.state.sends.push({
          endpoint: sub.endpoint,
          payload: JSON.parse(payload.toString("utf8")) as Record<string, unknown>,
          topic: options?.topic,
        });
        const queue = h.state.responses.get(sub.endpoint);
        const next = queue && queue.length > 1 ? queue.shift() : queue?.[0];
        return {
          ok: true,
          gone: false,
          permanent: false,
          status: 201,
          retryAfterSec: null,
          ...next,
        };
      },
    ),
  };
});

const { processPushJobs } = await import("@/lib/notifications/dispatch.server");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function job(
  id: number,
  overrides: Partial<{
    tenant_id: string;
    user_id: string;
    payload: Record<string, unknown>;
  }> = {},
): Record<string, unknown> {
  return {
    id,
    tenant_id: TENANT_A,
    user_id: USER,
    notification_id: null,
    payload: {
      kind: "message",
      title_pl: "Nowa wiadomość",
      title_en: "New message",
      body_pl: "Treść PL",
      body_en: "Body EN",
      href: "/messages/conv-1",
    },
    status: "pending",
    attempts: 1,
    next_attempt_at: "2026-07-25T00:00:00Z",
    created_at: "2026-07-25T00:00:00Z",
    sent_at: null,
    ...overrides,
  };
}

function device(endpoint: string, tenantId = TENANT_A, userId = USER): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    user_id: userId,
    endpoint,
    p256dh: "p256dh-placeholder",
    auth: "auth-placeholder",
  };
}

const rpcs = (name: string): RpcCall[] => h.state.rpcCalls.filter((call) => call.name === name);
const sends = (): SendCall[] => h.state.sends;

describe("processPushJobs", () => {
  beforeEach(() => {
    h.state.jobs = [];
    h.state.subscriptions = [];
    h.state.profiles = [];
    h.state.rpcCalls = [];
    h.state.sends = [];
    h.state.tableFilters = [];
    h.state.responses = new Map();
  });

  it("wysyła na wszystkie urządzenia odbiorcy i raportuje sukces raz na zadanie", async () => {
    h.state.jobs = [job(1)];
    h.state.subscriptions = [device("https://fcm.example/a"), device("https://fcm.example/b")];

    const result = await processPushJobs();

    expect(result).toEqual({ claimed: 1, sent: 1 });
    expect(sends().map((s) => s.endpoint)).toEqual([
      "https://fcm.example/a",
      "https://fcm.example/b",
    ]);
    expect(rpcs("report_push_job")).toEqual([
      { name: "report_push_job", args: { p_id: 1, p_ok: true, p_dead: false } },
    ]);
  });

  it("nie wysyła powiadomienia tenanta A na urządzenie tenanta B", async () => {
    h.state.jobs = [job(1, { tenant_id: TENANT_A })];
    h.state.subscriptions = [
      device("https://fcm.example/tenant-a", TENANT_A),
      device("https://fcm.example/tenant-b", TENANT_B),
    ];

    await processPushJobs();

    expect(sends().map((s) => s.endpoint)).toEqual(["https://fcm.example/tenant-a"]);
    // Filtr tenanta jedzie też do zapytania, nie tylko do grupowania w pamięci.
    expect(
      h.state.tableFilters.some(
        (f) => f.table === "push_subscriptions" && f.column === "tenant_id",
      ),
    ).toBe(true);
  });

  it("payload niesie język odbiorcy i temat kolapsu (kontrakt service workera)", async () => {
    h.state.jobs = [job(1)];
    h.state.subscriptions = [device("https://fcm.example/a")];
    h.state.profiles = [{ id: USER, prefs: { locale: "en" } }];

    await processPushJobs();

    const [sent] = sends();
    expect(sent.payload).toMatchObject({
      title: "New message",
      body: "Body EN",
      href: "/messages/conv-1",
      lang: "en",
    });
    expect(sent.payload.tag).toBe(sent.topic);
    expect(String(sent.payload.tag)).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("dwa zadania na jedno urządzenie idą jednym torem, a temat kolapsuje wątek", async () => {
    h.state.jobs = [job(1), job(2)];
    h.state.subscriptions = [device("https://fcm.example/a")];

    await processPushJobs();

    expect(sends()).toHaveLength(2);
    expect(sends()[0].topic).toBe(sends()[1].topic); // ten sam kind + href
    expect(rpcs("report_push_job").map((c) => c.args.p_id)).toEqual([1, 2]);
  });

  it("martwy endpoint (410) oznacza subskrypcję raz i ucina resztę jego kolejki", async () => {
    h.state.jobs = [job(1), job(2)];
    h.state.subscriptions = [device("https://fcm.example/dead")];
    h.state.responses.set("https://fcm.example/dead", [{ ok: false, gone: true, status: 410 }]);

    const result = await processPushJobs();

    // Drugie zadanie nie generuje ruchu - dostałoby to samo 410.
    expect(sends()).toHaveLength(1);
    expect(rpcs("mark_push_subscription_failed")).toEqual([
      { name: "mark_push_subscription_failed", args: { p_endpoint: "https://fcm.example/dead" } },
    ]);
    expect(rpcs("report_push_job").map((c) => c.args)).toEqual([
      { p_id: 1, p_ok: false, p_dead: true },
      { p_id: 2, p_ok: false, p_dead: true },
    ]);
    expect(result).toEqual({ claimed: 2, sent: 0 });
  });

  it("dostarczenie na drugie urządzenie wygrywa z martwym pierwszym", async () => {
    h.state.jobs = [job(1)];
    h.state.subscriptions = [
      device("https://fcm.example/dead"),
      device("https://fcm.example/live"),
    ];
    h.state.responses.set("https://fcm.example/dead", [{ ok: false, gone: true, status: 410 }]);

    const result = await processPushJobs();

    expect(result).toEqual({ claimed: 1, sent: 1 });
    expect(rpcs("report_push_job")[0].args).toEqual({ p_id: 1, p_ok: true, p_dead: false });
    expect(rpcs("mark_push_subscription_failed")).toHaveLength(1);
  });

  it("trwały błąd (413) dead-letteruje zadanie bez ośmiu retry", async () => {
    h.state.jobs = [job(1)];
    h.state.subscriptions = [device("https://fcm.example/a")];
    h.state.responses.set("https://fcm.example/a", [{ ok: false, permanent: true, status: 413 }]);

    await processPushJobs();

    expect(rpcs("report_push_job")[0].args).toEqual({ p_id: 1, p_ok: false, p_dead: true });
  });

  it("błąd przechodni (500) zostawia zadanie w kolejce do retry", async () => {
    h.state.jobs = [job(1)];
    h.state.subscriptions = [device("https://fcm.example/a")];
    h.state.responses.set("https://fcm.example/a", [{ ok: false, status: 500 }]);

    await processPushJobs();

    expect(rpcs("report_push_job")[0].args).toEqual({ p_id: 1, p_ok: false, p_dead: false });
  });

  it("odbiorca bez żywego urządzenia dostaje dead bez ruchu sieciowego", async () => {
    h.state.jobs = [job(1)];
    h.state.subscriptions = [];

    const result = await processPushJobs();

    expect(sends()).toHaveLength(0);
    expect(rpcs("report_push_job")[0].args).toEqual({ p_id: 1, p_ok: false, p_dead: true });
    expect(result).toEqual({ claimed: 1, sent: 0 });
  });

  it("bez zadań nie rusza żadnego zapytania o subskrypcje", async () => {
    h.state.jobs = [];

    const result = await processPushJobs();

    expect(result).toEqual({ claimed: 0, sent: 0 });
    expect(h.state.tableFilters).toHaveLength(0);
    expect(rpcs("report_push_job")).toHaveLength(0);
  });

  it("ten sam martwy endpoint w wielu zadaniach to JEDNO RPC oznaczenia", async () => {
    h.state.jobs = [job(1), job(2), job(3)];
    h.state.subscriptions = [device("https://fcm.example/dead")];
    h.state.responses.set("https://fcm.example/dead", [{ ok: false, gone: true, status: 410 }]);

    await processPushJobs();

    expect(rpcs("mark_push_subscription_failed")).toHaveLength(1);
  });
});
