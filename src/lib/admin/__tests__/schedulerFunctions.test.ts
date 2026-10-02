// PANEL ZDROWIA HARMONOGRAMU - WARSTWA SERWEROWA (`scheduler.functions.ts`).
//
// Do tego pliku 24 linie i 79 gałęzi na ZERZE. Jedyny inny test pliku
// (`schedulerEmailGateway.gate.test.ts`) czyta jego TEKST - dowodzi, skąd
// pochodzi flaga poczty, ale nie wykonuje handlera.
//
// PRZEDMIOT DOWODU. Panel ma rozróżnić „brak wysyłek" od „brak powiadomień do
// wysłania", więc liczy się tu każda gałąź mapowania jsonb z RPC:
//   * brakujące pole to wartość BEZPIECZNA (`false`, `0`, `null`), nie `undefined`
//     w UI i nie wyjątek - RPC i aplikacja wdrażają się osobno;
//   * liczniki z Postgresa (bigint jako napis, `null`, śmieć) czytają się jako
//     liczba skończona;
//   * odmowa RPC jest BŁĘDEM - nie zdrowym panelem z zerami;
//   * flagi środowiska, których baza nie zna (VAPID, poczta, sekret crona),
//     pochodzą z procesu aplikacji;
//   * ręczny tick idzie TĄ SAMĄ funkcją co cron, ze źródłem `admin`, najemcą
//     i operatorem - i najpierw uzbraja ścieżkę podstawową.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callServerFn,
  serverFnMiddlewareNames,
  type ServerFnContext,
} from "@/test/serverFnHarness";
import { ok, supabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  origin: "https://neweuropeanstrategies.com",
  emailConfigured: true,
  armedWith: [] as (string | null)[],
  ticks: [] as { admin: unknown; options: unknown }[],
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdminEditor: { name: "requireAdminEditor" },
}));
vi.mock("@/lib/seo/request", () => ({ getOrigin: () => h.origin }));
vi.mock("@/lib/email/provider.server", () => ({
  emailProviderConfigured: () => h.emailConfigured,
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { tag: "admin" } }));
vi.mock("@/lib/server/jobsTick.server", () => ({
  runJobsTick: async (admin: unknown, options: unknown) => {
    h.ticks.push({ admin, options });
    return { ok: true, source: "admin" };
  },
}));
vi.mock("@/lib/server/jobScheduler.server", () => ({
  ensureJobRunnerArmed: async (origin: string | null) => {
    h.armedWith.push(origin);
  },
}));

import {
  getSchedulerHealth,
  runSchedulerTickNow,
  type SchedulerHealth,
} from "@/lib/admin/scheduler.functions";

const USER = "11111111-1111-4111-8111-111111111111";
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-06-15T12:00:00.000Z");

const ENV_KEYS = [
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "COMMUNITY_CRON_SECRET",
  "PUBLIC_SITE_URL",
  "SITE_URL",
  "URL",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function healthContext(result: {
  data: unknown;
  error: { message: string } | null;
}): ServerFnContext {
  return {
    supabase: { rpc: async (name: string) => (name === "job_scheduler_health" ? result : null) },
    userId: USER,
  };
}

async function health(result: { data: unknown; error: { message: string } | null }) {
  return callServerFn<SchedulerHealth>(getSchedulerHealth, { context: healthContext(result) });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  h.origin = "https://neweuropeanstrategies.com";
  h.emailConfigured = true;
  h.armedWith = [];
  h.ticks = [];
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("harmonogram - obudowa", () => {
  it("obie funkcje stoją za `requireAdminEditor` - tą samą bramką, co RPC w bazie", () => {
    expect(serverFnMiddlewareNames(getSchedulerHealth)).toEqual(["requireAdminEditor"]);
    expect(serverFnMiddlewareNames(runSchedulerTickNow)).toEqual(["requireAdminEditor"]);
    expect(Reflect.get(getSchedulerHealth as object, "method")).toBe("GET");
    expect(Reflect.get(runSchedulerTickNow as object, "method")).toBe("POST");
  });
});

describe("getSchedulerHealth - mapowanie RPC", () => {
  it("odmowa RPC jest błędem z komunikatem bazy - nie zdrowym panelem z zerami", async () => {
    await expect(
      health({
        data: null,
        error: { message: "permission denied for function job_scheduler_health" },
      }),
    ).rejects.toThrow("permission denied for function job_scheduler_health");
  });

  it("PUSTY ładunek (RPC starsze niż aplikacja) daje wartości bezpieczne, nie `undefined`", async () => {
    h.emailConfigured = false;
    h.origin = "http://localhost:3000";
    const result = await health({ data: null, error: null });
    expect(result.runner).toEqual({
      enabled: false,
      baseUrl: "",
      resolvedBaseUrl: "",
      secretSet: false,
      autoArmedAt: null,
      lastInvokedAt: null,
      lastAppRunAt: null,
      lastAppOkAt: null,
      lastAppError: null,
      failureStreak: 0,
      lastTickStatus: null,
      lastTickError: null,
      tickCount: 0,
      communityCron: { lastTickAt: null, lastTickStatus: null, lastTickError: null, tickCount: 0 },
    });
    expect(result.capabilities).toEqual({ pgCron: false, pgNet: false });
    expect(result.appUnreachable).toBe(false);
    expect(result.cronJobs).toEqual([]);
    expect(result.recentRuns).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(Object.values(result.queue).every((value) => value === 0)).toBe(true);
    // Origin z `localhost` nie jest podpowiedzią dla `base_url` - cron z bazy
    // nie dopuka się do maszyny dewelopera.
    expect(result.env).toEqual({
      vapidConfigured: false,
      emailGatewayConfigured: false,
      communityCronSecretSet: false,
      siteUrl: "",
      suggestedBaseUrl: "",
    });
    // Brak udanego przebiegu w historii to „nigdy”, a nie „świeżo”.
    expect(result.freshness).toBe("never");
    expect(result.observedAt).toBe(NOW.toISOString());
  });

  it("PEŁNY ładunek: każde pole trafia pod swoją nazwę, liczniki-napisy stają się liczbami", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.COMMUNITY_CRON_SECRET = "s3cret";
    const lastOk = new Date(NOW.getTime() - 60_000).toISOString();
    const result = await health({
      data: {
        runner: {
          enabled: true,
          base_url: "https://app.example.com",
          resolved_base_url: "https://app.example.com/api/jobs",
          secret_set: true,
          auto_armed_at: "2026-06-01T00:00:00Z",
          last_invoked_at: "2026-06-15T11:59:00Z",
          last_app_run_at: "2026-06-15T11:59:01Z",
          last_app_ok_at: lastOk,
          last_app_error: "boom",
          failure_streak: "3",
          last_tick_status: "dispatched",
          last_tick_error: null,
          tick_count: "1234567",
          community_cron: {
            last_tick_at: "2026-06-15T11:55:00Z",
            last_tick_status: "skipped",
            last_tick_error: "no_secret",
            tick_count: 7,
          },
        },
        capabilities: { pg_cron: true, pg_net: true },
        app_unreachable: true,
        cron_jobs: [
          { name: "jobs-tick", schedule: "* * * * *", active: true },
          { name: null, schedule: null },
        ],
        recent_runs: [
          {
            id: "41",
            source: "GitHub-Actions",
            job: "push",
            ok: true,
            duration_ms: "250",
            error: null,
            created_at: "2026-06-15T11:59:00Z",
          },
          {},
        ],
        sources: [
          {
            source: "pgcron",
            last_at: "2026-06-15T11:59:00Z",
            last_ok_at: "2026-06-15T11:58:00Z",
            runs_24h: "1440",
            failures_24h: 2,
          },
          {},
        ],
        queue: {
          push_pending: "5",
          push_due_now: 2,
          push_sent_24h: "900",
          push_dead: 1,
          push_oldest_pending_seconds: "75.5",
          push_subscriptions_active: 30,
          digest_due_daily: 4,
          digest_due_weekly: "nonsens",
        },
      },
      error: null,
    });

    expect(result.runner).toMatchObject({
      enabled: true,
      baseUrl: "https://app.example.com",
      resolvedBaseUrl: "https://app.example.com/api/jobs",
      secretSet: true,
      autoArmedAt: "2026-06-01T00:00:00Z",
      lastAppError: "boom",
      failureStreak: 3,
      lastTickStatus: "dispatched",
      tickCount: 1234567,
      communityCron: {
        lastTickAt: "2026-06-15T11:55:00Z",
        lastTickStatus: "skipped",
        lastTickError: "no_secret",
        tickCount: 7,
      },
    });
    expect(result.capabilities).toEqual({ pgCron: true, pgNet: true });
    expect(result.appUnreachable).toBe(true);
    expect(result.cronJobs).toEqual([
      { name: "jobs-tick", schedule: "* * * * *", active: true },
      { name: "-", schedule: "-", active: false },
    ]);
    expect(result.recentRuns).toEqual([
      {
        id: 41,
        source: "github_actions",
        job: "push",
        ok: true,
        durationMs: 250,
        error: null,
        createdAt: "2026-06-15T11:59:00Z",
      },
      // Wiersz bez pól: job „all”, źródło nieznane = zewnętrzne, NIE udany.
      {
        id: 0,
        source: "external",
        job: "all",
        ok: false,
        durationMs: 0,
        error: null,
        createdAt: "",
      },
    ]);
    expect(result.sources).toEqual([
      {
        source: "pg_cron",
        lastAt: "2026-06-15T11:59:00Z",
        lastOkAt: "2026-06-15T11:58:00Z",
        runs24h: 1440,
        failures24h: 2,
      },
      { source: "external", lastAt: null, lastOkAt: null, runs24h: 0, failures24h: 0 },
    ]);
    expect(result.queue).toEqual({
      pushPending: 5,
      pushDueNow: 2,
      pushSent24h: 900,
      pushDead: 1,
      pushOldestPendingSeconds: 75.5,
      pushSubscriptionsActive: 30,
      digestDueDaily: 4,
      // Śmieć z bazy to zero, nie `NaN` w kaflu.
      digestDueWeekly: 0,
    });
    expect(result.env).toEqual({
      vapidConfigured: true,
      emailGatewayConfigured: true,
      communityCronSecretSet: true,
      siteUrl: "https://neweuropeanstrategies.com",
      suggestedBaseUrl: "https://neweuropeanstrategies.com",
    });
    expect(result.freshness).toBe("fresh");
  });

  it("VAPID wymaga OBU kluczy - sam publiczny nie wystarcza do wysyłki push", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    expect((await health({ data: {}, error: null })).env.vapidConfigured).toBe(false);
  });

  it("adres serwisu: PUBLIC_SITE_URL > SITE_URL > URL > origin żądania", async () => {
    process.env.URL = "https://url.example.com";
    expect((await health({ data: {}, error: null })).env.siteUrl).toBe("https://url.example.com");
    process.env.SITE_URL = "https://site.example.com";
    expect((await health({ data: {}, error: null })).env.siteUrl).toBe("https://site.example.com");
    process.env.PUBLIC_SITE_URL = "https://public.example.com";
    expect((await health({ data: {}, error: null })).env.siteUrl).toBe(
      "https://public.example.com",
    );
  });

  it("świeżość liczy serwer z `last_app_ok_at`: stary przebieg to „stale”", async () => {
    const result = await health({
      data: { runner: { last_app_ok_at: "2026-06-15T10:00:00Z" } },
      error: null,
    });
    expect(result.freshness).toBe("stale");
  });
});

describe("runSchedulerTickNow - ręczny tick z panelu", () => {
  function tickContext(profile: unknown): ServerFnContext {
    const user = supabaseFromStub();
    user.setResponse("profiles", ok(profile));
    return { supabase: { from: user.from }, userId: USER };
  }

  it("uzbraja ścieżkę podstawową originem żądania i woła runJobsTick ze źródłem `admin`, najemcą i operatorem", async () => {
    const result = await callServerFn(runSchedulerTickNow, {
      context: tickContext({ tenant_id: TENANT }),
    });
    expect(result).toEqual({ ok: true, source: "admin" });
    expect(h.armedWith).toEqual(["https://neweuropeanstrategies.com"]);
    expect(h.ticks).toEqual([
      { admin: { tag: "admin" }, options: { source: "admin", tenantId: TENANT, actorId: USER } },
    ]);
  });

  it("operator bez profilu: tick biegnie, a ślad niesie `tenantId: null` zamiast cudzego najemcy", async () => {
    await callServerFn(runSchedulerTickNow, { context: tickContext(null) });
    expect(h.ticks[0].options).toEqual({ source: "admin", tenantId: null, actorId: USER });
  });
});
