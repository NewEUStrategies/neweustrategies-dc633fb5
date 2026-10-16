// processPushJobs: izolacja tenantów, kolejki per urządzenie, agregacja
// raportów, deduplikacja RPC i zachowanie partii przy awarii odczytu. Krypto
// ma własny test (webpush.test.ts), więc tutaj podmieniamy WYŁĄCZNIE
// `sendWebPush` i klienta service role - reszta (clamp payloadu, temat
// kolapsu, serializacja) jedzie prawdziwym kodem.
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
  ttlSec?: number;
  urgency?: string;
}

const h = vi.hoisted(() => {
  const state = {
    jobs: [] as unknown[],
    subscriptions: [] as unknown[],
    profiles: [] as unknown[],
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    /** endpoint -> kolejne odpowiedzi usługi push (ostatnia się powtarza). */
    responses: new Map<string, Partial<PushSendResult>[]>(),
    sends: [] as {
      endpoint: string;
      payload: Record<string, unknown>;
      topic?: string;
      ttlSec?: number;
      urgency?: string;
    }[],
    tableFilters: [] as { table: string; column: string; values: unknown }[],
    /** tabela -> błąd zapytania (brak wpisu = sukces). */
    tableErrors: new Map<string, unknown>(),
    /** nazwa RPC -> błąd wywołania (brak wpisu = sukces). */
    rpcErrors: new Map<string, unknown>(),
    /** Błąd dla KONKRETNEGO wywołania (np. jednego zadania w raporcie per zadanie). */
    rpcErrorFor: null as ((name: string, args: Record<string, unknown>) => unknown) | null,
    /** endpoint -> wyjątek `sendWebPush` (timeout, błąd sieci). */
    sendThrows: new Map<string, Error>(),
    /** Konfiguracja VAPID z env; null = push wyłączony. */
    vapid: {
      publicKey: "test-public-key",
      privateKey: "test-private-key",
      subject: "mailto:test@example.com",
    } as { publicKey: string; privateKey: string; subject: string } | null,
  };
  return { state };
});

vi.mock("@/integrations/supabase/client.server", () => {
  const respond = (table: string): QueryResponse => {
    const error = h.state.tableErrors.get(table);
    if (error) return { data: null, error };
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
        const error = h.state.rpcErrors.get(name) ?? h.state.rpcErrorFor?.(name, args);
        if (error) return Promise.resolve({ data: null, error });
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
    vapidFromEnv: () => h.state.vapid,
    sendWebPush: vi.fn(
      async (
        sub: PushSubscriptionKeys,
        payload: Buffer,
        _vapid: unknown,
        options?: { topic?: string; ttlSec?: number; urgency?: string },
      ): Promise<PushSendResult> => {
        h.state.sends.push({
          endpoint: sub.endpoint,
          payload: JSON.parse(payload.toString("utf8")) as Record<string, unknown>,
          topic: options?.topic,
          ttlSec: options?.ttlSec,
          urgency: options?.urgency,
        });
        const thrown = h.state.sendThrows.get(sub.endpoint);
        if (thrown) throw thrown;
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
const { pushTopic } = await import("@/lib/notifications/webpush.server");

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
/** Raporty partii: element `p_reports` zbiorczego report_push_jobs. */
const reported = (): unknown[] =>
  rpcs("report_push_jobs").flatMap((call) => call.args.p_reports as unknown[]);

describe("processPushJobs", () => {
  beforeEach(() => {
    h.state.jobs = [];
    h.state.subscriptions = [];
    h.state.profiles = [];
    h.state.rpcCalls = [];
    h.state.sends = [];
    h.state.tableFilters = [];
    h.state.responses = new Map();
    h.state.tableErrors = new Map();
    h.state.rpcErrors = new Map();
    h.state.rpcErrorFor = null;
    h.state.sendThrows = new Map();
    h.state.vapid = {
      publicKey: "test-public-key",
      privateKey: "test-private-key",
      subject: "mailto:test@example.com",
    };
    vi.restoreAllMocks();
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
    expect(rpcs("report_push_jobs")).toEqual([
      { name: "report_push_jobs", args: { p_reports: [{ id: 1, ok: true, dead: false }] } },
    ]);
    expect(rpcs("report_push_job")).toHaveLength(0);
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

  // D8 / spec B.7: push rodzaju `event` (przypomnienie o sesji, oferta miejsca)
  // żyje godzinę i ma pilność `high`; każdy inny rodzaj zostaje na domyślnych
  // (doba, `normal`) - opcji w ogóle nie podajemy.
  it("rodzaj event: TTL 3600 s i pilność high; inne rodzaje bez nadpisania", async () => {
    h.state.jobs = [
      job(1, {
        payload: {
          kind: "event",
          title_pl: "Sesja za 15 minut",
          title_en: "Session in 15 minutes",
          href: "/events/forum/me?tab=schedule#event-session-1",
        },
      }),
      job(2),
    ];
    h.state.subscriptions = [device("https://fcm.example/a")];

    await processPushJobs();

    const [eventSend, messageSend] = sends();
    expect(eventSend).toMatchObject({ ttlSec: 3600, urgency: "high" });
    expect(eventSend.topic).toEqual(expect.any(String));
    expect(messageSend.ttlSec).toBeUndefined();
    expect(messageSend.urgency).toBeUndefined();
  });

  it("dwa zadania na jedno urządzenie idą jednym torem, a temat kolapsuje wątek", async () => {
    h.state.jobs = [job(1), job(2)];
    h.state.subscriptions = [device("https://fcm.example/a")];

    await processPushJobs();

    expect(sends()).toHaveLength(2);
    expect(sends()[0].topic).toBe(sends()[1].topic); // ten sam kind + href
    expect(reported()).toEqual([
      { id: 1, ok: true, dead: false },
      { id: 2, ok: true, dead: false },
    ]);
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
    expect(reported()).toEqual([
      { id: 1, ok: false, dead: true },
      { id: 2, ok: false, dead: true },
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
    expect(reported()).toEqual([{ id: 1, ok: true, dead: false }]);
    expect(rpcs("mark_push_subscription_failed")).toHaveLength(1);
  });

  it("trwały błąd (413) dead-letteruje zadanie bez ośmiu retry", async () => {
    h.state.jobs = [job(1)];
    h.state.subscriptions = [device("https://fcm.example/a")];
    h.state.responses.set("https://fcm.example/a", [{ ok: false, permanent: true, status: 413 }]);

    await processPushJobs();

    expect(reported()).toEqual([{ id: 1, ok: false, dead: true }]);
  });

  it("błąd przechodni (500) zostawia zadanie w kolejce do retry", async () => {
    h.state.jobs = [job(1)];
    h.state.subscriptions = [device("https://fcm.example/a")];
    h.state.responses.set("https://fcm.example/a", [{ ok: false, status: 500 }]);

    await processPushJobs();

    expect(reported()).toEqual([{ id: 1, ok: false, dead: false }]);
  });

  it("odbiorca bez żywego urządzenia dostaje dead bez ruchu sieciowego", async () => {
    h.state.jobs = [job(1)];
    h.state.subscriptions = [];

    const result = await processPushJobs();

    expect(sends()).toHaveLength(0);
    expect(reported()).toEqual([{ id: 1, ok: false, dead: true }]);
    expect(result).toEqual({ claimed: 1, sent: 0 });
  });

  it("bez zadań nie rusza żadnego zapytania o subskrypcje", async () => {
    h.state.jobs = [];

    const result = await processPushJobs();

    expect(result).toEqual({ claimed: 0, sent: 0 });
    expect(h.state.tableFilters).toHaveLength(0);
    expect(rpcs("report_push_jobs")).toHaveLength(0);
    expect(rpcs("report_push_job")).toHaveLength(0);
  });

  // Zadanie trafia do kolejki WYŁĄCZNIE wtedy, gdy trigger
  // tg_notifications_enqueue_push zobaczył żywą subskrypcję odbiorcy (szukając
  // jej po samym user_id). Zero urządzeń u dyspozytora, który szuka po parze
  // (tenant_id, user_id), nie jest więc stanem normalnym, tylko dowodem, że
  // najemca subskrypcji rozjechał się z najemcą profilu - a taki wiersz idzie
  // w 'dead' bez ani jednej próby wysyłki i w logu wygląda jak pusta kolejka.
  it("zero urządzeń mimo zakolejkowanego zadania jest nazwane w logu", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.state.jobs = [job(1, { tenant_id: TENANT_A })];
    // Subskrypcja odbiorcy ISTNIEJE i żyje, ale nosi najemcę innej witryny -
    // filtr tenanta w zapytaniu jej nie zwróci.
    h.state.subscriptions = [];

    await processPushJobs();

    const message = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(message).toContain("bez ani jednego urzadzenia (liczba: 1;");
    expect(message).toContain(`${TENANT_A}|${USER}`);
    warn.mockRestore();
  });

  it("komplet urządzeń nie zapala tripwire'a kontraktu", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.state.jobs = [job(1)];
    h.state.subscriptions = [device("https://fcm.example/a")];

    await processPushJobs();

    const message = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(message).not.toContain("bez ani jednego urzadzenia");
    warn.mockRestore();
  });

  it("ten sam martwy endpoint w wielu zadaniach to JEDNO RPC oznaczenia", async () => {
    h.state.jobs = [job(1), job(2), job(3)];
    h.state.subscriptions = [device("https://fcm.example/dead")];
    h.state.responses.set("https://fcm.example/dead", [{ ok: false, gone: true, status: 410 }]);

    await processPushJobs();

    expect(rpcs("mark_push_subscription_failed")).toHaveLength(1);
  });

  // Regresja: `{ data: subs }` bez `error` zamieniało awarię odczytu w pustą
  // listę urządzeń, więc KAŻDE zadanie zajętej partii szło w 'dead' jako
  // "odbiorca bez subskrypcji" - partia przepadała bez jednej próby wysyłki.
  it("błąd odczytu subskrypcji nie finalizuje partii - zadania wracają do kolejki", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.state.jobs = [job(1), job(2)];
    h.state.subscriptions = [device("https://fcm.example/a")];
    h.state.tableErrors.set("push_subscriptions", {
      message: "canceling statement due to statement timeout",
      code: "57014",
    });

    // Rzut, nie zwrotka: wołający (runJobStep, step w community-cron) zapisują
    // komunikat w logu przebiegów, więc scheduler widzi konkretną przyczynę.
    await expect(processPushJobs()).rejects.toThrow(
      /push_subscriptions: canceling statement due to statement timeout - zadania wracają do kolejki bez raportu \(liczba zadań: 2\)/,
    );

    // Zero raportów = zadania zostają 'pending' z backoffem ustawionym przy
    // claimie; zero wysyłek i zero oznaczeń endpointów.
    expect(rpcs("report_push_jobs")).toHaveLength(0);
    expect(rpcs("report_push_job")).toHaveLength(0);
    expect(rpcs("mark_push_subscription_failed")).toHaveLength(0);
    expect(sends()).toHaveLength(0);
    error.mockRestore();
  });

  it("błąd odczytu profili degraduje do języka domyślnego, ale nie po cichu", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.state.jobs = [job(1)];
    h.state.subscriptions = [device("https://fcm.example/a")];
    h.state.tableErrors.set("profiles", { message: "connection reset", code: "08006" });

    const result = await processPushJobs();

    // Język to dodatek - push wychodzi (po polsku), partia jest raportowana.
    expect(result).toEqual({ claimed: 1, sent: 1 });
    expect(sends()[0].payload).toMatchObject({ lang: "pl", title: "Nowa wiadomość" });
    expect(reported()).toEqual([{ id: 1, ok: true, dead: false }]);
    const logged = error.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("odczyt profili odbiorców nie powiódł się");
    error.mockRestore();
  });

  it("partia jest finalizowana JEDNYM RPC niezależnie od liczby zadań", async () => {
    const users = [
      "aaaaaaaa-aaaa-aaaa-aaaa-000000000001",
      "aaaaaaaa-aaaa-aaaa-aaaa-000000000002",
      "aaaaaaaa-aaaa-aaaa-aaaa-000000000003",
    ];
    h.state.jobs = users.map((userId, i) => job(i + 1, { user_id: userId }));
    h.state.subscriptions = users.map((userId, i) =>
      device(`https://fcm.example/${i + 1}`, TENANT_A, userId),
    );

    const result = await processPushJobs();

    expect(result).toEqual({ claimed: 3, sent: 3 });
    expect(rpcs("report_push_jobs")).toHaveLength(1);
    expect(reported()).toHaveLength(3);
    expect(rpcs("report_push_job")).toHaveLength(0);
  });

  // Kod może wyprzedzić migrację (PGRST202), a zbiorczy UPDATE jest "wszystko
  // albo nic" - zadanie bez raportu poszłoby ponownie jako duplikat pusha.
  it("błąd zbiorczego raportu spada na raport per zadanie", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.state.jobs = [job(1), job(2)];
    h.state.subscriptions = [device("https://fcm.example/a")];
    h.state.responses.set("https://fcm.example/a", [
      { ok: true, status: 201 },
      { ok: false, permanent: true, status: 413 },
    ]);
    h.state.rpcErrors.set("report_push_jobs", {
      message: "Could not find the function public.report_push_jobs(p_reports)",
      code: "PGRST202",
    });

    const result = await processPushJobs();

    expect(result).toEqual({ claimed: 2, sent: 1 });
    expect(rpcs("report_push_jobs")).toHaveLength(1);
    expect(rpcs("report_push_job").map((call) => call.args)).toEqual([
      { p_id: 1, p_ok: true, p_dead: false },
      { p_id: 2, p_ok: false, p_dead: true },
    ]);
    error.mockRestore();
  });
  // Brak kluczy VAPID wygląda w logu identycznie jak pusta kolejka, więc
  // pominięcie ma nazwę - i NIE zajmuje partii, bo nic by jej nie wysłało.
  it("bez kluczy VAPID nie zajmuje partii i nazywa pominięcie", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.state.vapid = null;
    h.state.jobs = [job(1)];

    const result = await processPushJobs();

    expect(result).toEqual({ claimed: 0, sent: 0, skipped: "vapid_not_configured" });
    expect(rpcs("claim_push_jobs")).toHaveLength(0);
    expect(String(warn.mock.calls[0]?.[0])).toContain("brak VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY");
  });

  it("błąd claimu rzuca - scheduler widzi przyczynę zamiast pustej kolejki", async () => {
    const claimError = { code: "57014", message: "statement timeout" };
    h.state.rpcErrors.set("claim_push_jobs", claimError);

    await expect(processPushJobs(25)).rejects.toBe(claimError);
    expect(rpcs("claim_push_jobs")).toEqual([{ name: "claim_push_jobs", args: { p_limit: 25 } }]);
    expect(h.state.tableFilters).toHaveLength(0);
  });

  it("claim zwracający null to pusta partia", async () => {
    h.state.jobs = null as unknown as unknown[];

    expect(await processPushJobs()).toEqual({ claimed: 0, sent: 0 });
  });

  it("payload bez pól dostaje markę, pustą treść, href '/' i temat 'notification'", async () => {
    h.state.jobs = [job(1, { payload: null as unknown as Record<string, unknown> })];
    h.state.subscriptions = [device("https://fcm.example/a")];

    await processPushJobs();

    const [sent] = sends();
    expect(sent.payload).toMatchObject({
      title: "New European Strategies",
      body: "",
      href: "/",
      lang: "pl",
    });
    expect(sent.topic).toBe(pushTopic("notification", "/"));
    expect(reported()).toEqual([{ id: 1, ok: true, dead: false }]);
  });

  it("odbiorca EN bez treści EN dostaje treść PL, a odbiorca PL bez PL - EN", async () => {
    const OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    h.state.jobs = [
      job(1, { payload: { kind: "message", title_pl: "Tytuł", body_pl: "Tylko PL" } }),
      job(2, {
        user_id: OTHER,
        payload: { kind: "message", title_en: "Title", body_en: "Only EN" },
      }),
    ];
    h.state.subscriptions = [
      device("https://fcm.example/en"),
      device("https://fcm.example/pl", TENANT_A, OTHER),
    ];
    // prefs: null to profil bez ustawień - język domyślny, nie wyjątek.
    h.state.profiles = [
      { id: USER, prefs: { locale: "en" }, tenant_id: TENANT_A },
      { id: OTHER, prefs: null, tenant_id: TENANT_A },
    ];

    await processPushJobs();

    const byEndpoint = new Map(sends().map((s) => [s.endpoint, s.payload]));
    expect(byEndpoint.get("https://fcm.example/en")).toMatchObject({
      lang: "en",
      title: "Tytuł",
      body: "Tylko PL",
    });
    expect(byEndpoint.get("https://fcm.example/pl")).toMatchObject({
      lang: "pl",
      title: "Title",
      body: "Only EN",
    });
  });

  // Timeout 10 s albo błąd sieci na jednym urządzeniu: każde następne zadanie
  // tej kolejki czekałoby kolejne 10 s z 25-sekundowego budżetu ticku. Reszta
  // kolejki wraca do kolejki bez ruchu sieciowego, inne urządzenia jadą dalej.
  it("wyjątek wysyłki ucina kolejkę urządzenia jako błąd przechodni", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.state.jobs = [job(1), job(2), job(3)];
    h.state.subscriptions = [device("https://fcm.example/hung"), device("https://fcm.example/ok")];
    h.state.sendThrows.set("https://fcm.example/hung", new Error("The operation was aborted"));

    const result = await processPushJobs();

    // Jedna próba (ta, która rzuciła), dwie pozostałe bez ruchu sieciowego.
    expect(sends().filter((s) => s.endpoint === "https://fcm.example/hung")).toHaveLength(1);
    expect(sends().filter((s) => s.endpoint === "https://fcm.example/ok")).toHaveLength(3);
    // Drugie urządzenie dostarczyło - wygrywa; endpoint z wyjątkiem NIE jest
    // oznaczany jako martwy (to nie 410).
    expect(result).toEqual({ claimed: 3, sent: 3 });
    expect(rpcs("mark_push_subscription_failed")).toHaveLength(0);
    expect(String(error.mock.calls[0]?.[0])).toContain("3 zadań urządzenia wraca do kolejki");
  });

  it("wyjątek wysyłki na jedynym urządzeniu zostawia zadania do retry, nie w dead", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.state.jobs = [job(1), job(2)];
    h.state.subscriptions = [device("https://fcm.example/hung")];
    h.state.sendThrows.set("https://fcm.example/hung", new Error("fetch failed"));

    const result = await processPushJobs();

    expect(result).toEqual({ claimed: 2, sent: 0 });
    expect(reported()).toEqual([
      { id: 1, ok: false, dead: false },
      { id: 2, ok: false, dead: false },
    ]);
  });

  // RFC 8030 sek. 8.4: 429/503 z Retry-After każe odczekać. Kolejne żądania na
  // to samo urządzenie w tym ticku tylko przedłużają dławienie.
  it("odmowa z Retry-After ucina resztę kolejki urządzenia do retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.state.jobs = [job(1), job(2), job(3)];
    h.state.subscriptions = [device("https://fcm.example/busy")];
    h.state.responses.set("https://fcm.example/busy", [
      { ok: false, status: 429, retryAfterSec: 30 },
    ]);

    const result = await processPushJobs();

    expect(sends()).toHaveLength(1);
    expect(result).toEqual({ claimed: 3, sent: 0 });
    expect(reported()).toEqual([
      { id: 1, ok: false, dead: false },
      { id: 2, ok: false, dead: false },
      { id: 3, ok: false, dead: false },
    ]);
    expect(rpcs("mark_push_subscription_failed")).toHaveLength(0);
    const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("push throttled (429), retry-after 30s - 2 zadań urządzenia");
  });

  it("Retry-After przy sukcesie nie ucina kolejki", async () => {
    h.state.jobs = [job(1), job(2)];
    h.state.subscriptions = [device("https://fcm.example/a")];
    h.state.responses.set("https://fcm.example/a", [{ ok: true, status: 201, retryAfterSec: 5 }]);

    expect(await processPushJobs()).toEqual({ claimed: 2, sent: 2 });
    expect(sends()).toHaveLength(2);
  });

  it("błąd raportu jednego zadania w trybie per zadanie nie zabiera raportu reszcie", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.state.jobs = [job(1), job(2), job(3)];
    h.state.subscriptions = [device("https://fcm.example/a")];
    h.state.rpcErrors.set("report_push_jobs", { message: "deadlock detected", code: "40P01" });
    h.state.rpcErrorFor = (name, args) =>
      name === "report_push_job" && args.p_id === 2 ? { message: "row lock timeout" } : null;

    const result = await processPushJobs();

    expect(result).toEqual({ claimed: 3, sent: 3 });
    expect(rpcs("report_push_job").map((call) => call.args.p_id)).toEqual([1, 2, 3]);
    const logged = error.mock.calls.map((call) => String(call[0]));
    expect(logged).toContain("[community] report_push_jobs - przejście na raport per zadanie");
    expect(logged.filter((line) => line === "[community] report_push_job")).toHaveLength(1);
  });

  it("błąd oznaczania martwego endpointu jest logowany, a partia i tak raportowana", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.state.jobs = [job(1)];
    h.state.subscriptions = [device("https://fcm.example/dead")];
    h.state.responses.set("https://fcm.example/dead", [{ ok: false, gone: true, status: 404 }]);
    h.state.rpcErrors.set("mark_push_subscription_failed", { message: "permission denied" });

    const result = await processPushJobs();

    expect(result).toEqual({ claimed: 1, sent: 0 });
    expect(reported()).toEqual([{ id: 1, ok: false, dead: true }]);
    expect(error.mock.calls.map((call) => String(call[0]))).toContain(
      "[community] mark_push_subscription_failed",
    );
  });

  it("odczyt subskrypcji bez błędu i bez danych to odbiorcy bez urządzeń", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.state.jobs = [job(1)];
    h.state.subscriptions = null as unknown as unknown[];

    const result = await processPushJobs();

    expect(result).toEqual({ claimed: 1, sent: 0 });
    expect(sends()).toHaveLength(0);
    expect(reported()).toEqual([{ id: 1, ok: false, dead: true }]);
  });

  it("dwa urządzenia martwe: zadanie dead dopiero, gdy odpadły WSZYSTKIE", async () => {
    h.state.jobs = [job(1)];
    h.state.subscriptions = [device("https://fcm.example/x"), device("https://fcm.example/y")];
    h.state.responses.set("https://fcm.example/x", [{ ok: false, gone: true, status: 410 }]);
    h.state.responses.set("https://fcm.example/y", [{ ok: false, status: 500 }]);

    await processPushJobs();

    // Jedno urządzenie odpadło, drugie miało błąd przechodni - retry, nie dead.
    expect(reported()).toEqual([{ id: 1, ok: false, dead: false }]);
    expect(rpcs("mark_push_subscription_failed")).toHaveLength(1);
  });
});
