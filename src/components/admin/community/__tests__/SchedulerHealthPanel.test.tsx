// Panel zdrowia harmonogramu - kontrakt renderu.
//
// Panel jest jedynym miejscem, w którym operator widzi, że doręczenia stoją,
// więc test pilnuje trzech rzeczy, które łatwo cicho zepsuć:
//   1. każdy klucz i18n używany przez panel się rozwiązuje (żaden surowy
//      `adminScheduler.*` nie trafia na ekran - część kluczy jest składana
//      dynamicznie ze źródeł przebiegu i stanów świeżości),
//   2. zastój i awarie środowiska (brak VAPID) podnoszą widoczny alert,
//      a stan zdrowy go NIE podnosi,
//   3. „Uruchom tick teraz" faktycznie woła serwerową funkcję ticku.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SchedulerHealth } from "@/lib/admin/scheduler.functions";

const getSchedulerHealth = vi.fn();
const runSchedulerTickNow = vi.fn();

// Mock CZĘŚCIOWY: `useServerFn` staje się tożsamością (wywołanie idzie prosto
// do atrapy), ale reszta modułu musi zostać - `@/lib/i18n` ciągnie stąd
// `createIsomorphicFn`, więc pełna atrapa wywala import słownika.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@/lib/admin/scheduler.functions", () => ({
  getSchedulerHealth: (...args: unknown[]) => getSchedulerHealth(...args),
  runSchedulerTickNow: (...args: unknown[]) => runSchedulerTickNow(...args),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

const { SchedulerHealthPanel } = await import("@/components/admin/community/SchedulerHealthPanel");

function health(overrides: Partial<SchedulerHealth> = {}): SchedulerHealth {
  const now = Date.now();
  return {
    runner: {
      enabled: true,
      baseUrl: "https://nes.example",
      resolvedBaseUrl: "https://nes.example",
      secretSet: true,
      autoArmedAt: new Date(now - 3_600_000).toISOString(),
      lastInvokedAt: new Date(now - 30_000).toISOString(),
      lastAppRunAt: new Date(now - 30_000).toISOString(),
      lastAppOkAt: new Date(now - 30_000).toISOString(),
      lastAppError: null,
      failureStreak: 0,
      lastTickStatus: "dispatched",
      lastTickError: null,
      tickCount: 1420,
    },
    capabilities: { pgCron: true, pgNet: true },
    appUnreachable: false,
    cronJobs: [{ name: "jobs-tick", schedule: "* * * * *", active: true }],
    recentRuns: [
      {
        id: 2,
        source: "pg_cron",
        job: "all",
        ok: true,
        durationMs: 412,
        error: null,
        createdAt: new Date(now - 30_000).toISOString(),
      },
      {
        id: 1,
        source: "github_actions",
        job: "push",
        ok: false,
        durationMs: 120,
        error: "push: claim_push_jobs denied",
        createdAt: new Date(now - 300_000).toISOString(),
      },
    ],
    sources: [
      {
        source: "pg_cron",
        lastAt: new Date(now - 30_000).toISOString(),
        lastOkAt: new Date(now - 30_000).toISOString(),
        runs24h: 1420,
        failures24h: 0,
      },
    ],
    queue: {
      pushPending: 3,
      pushDueNow: 1,
      pushSent24h: 87,
      pushDead: 0,
      pushOldestPendingSeconds: 45,
      pushSubscriptionsActive: 12,
      digestDueDaily: 4,
      digestDueWeekly: 0,
    },
    env: {
      vapidConfigured: true,
      emailGatewayConfigured: true,
      communityCronSecretSet: true,
      siteUrl: "https://nes.example",
      suggestedBaseUrl: "https://nes.example",
    },
    freshness: "fresh",
    observedAt: new Date(now).toISOString(),
    ...overrides,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SchedulerHealthPanel />
    </QueryClientProvider>,
  );
}

describe("SchedulerHealthPanel", () => {
  beforeEach(() => {
    getSchedulerHealth.mockReset();
    runSchedulerTickNow.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("renderuje metryki kolejki bez surowych kluczy i18n", async () => {
    getSchedulerHealth.mockResolvedValue(health());
    renderPanel();

    // Wartości z RPC docierają na ekran (kolejka, wysłane, urządzenia).
    await waitFor(() => expect(screen.getByText("87")).toBeInTheDocument());
    expect(screen.getByText("12")).toBeInTheDocument();
    // Log przebiegów pokazuje źródło i błąd nieudanego przebiegu.
    expect(screen.getByText("push: claim_push_jobs denied")).toBeInTheDocument();
    expect(screen.getByText("jobs-tick")).toBeInTheDocument();
    // Żaden klucz nie przecieka jako surowy tekst - to jedyna bramka na
    // dynamicznie składane klucze (źródła przebiegu, stany świeżości).
    expect(document.body.textContent ?? "").not.toContain("adminScheduler.");
  });

  it("stan zdrowy nie podnosi alertu", async () => {
    getSchedulerHealth.mockResolvedValue(health());
    renderPanel();

    await waitFor(() => expect(screen.getByText("87")).toBeInTheDocument());
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("zastój, nieosiągalna aplikacja i brak VAPID podnoszą alerty", async () => {
    getSchedulerHealth.mockResolvedValue(
      health({
        freshness: "stale",
        appUnreachable: true,
        env: {
          vapidConfigured: false,
          emailGatewayConfigured: true,
          communityCronSecretSet: false,
          siteUrl: "https://nes.example",
          suggestedBaseUrl: "https://nes.example",
        },
        queue: {
          pushPending: 240,
          pushDueNow: 240,
          pushSent24h: 0,
          pushDead: 3,
          pushOldestPendingSeconds: 5400,
          pushSubscriptionsActive: 12,
          digestDueDaily: 4,
          digestDueWeekly: 1,
        },
      }),
    );
    renderPanel();

    // appUnreachable + stale + brak VAPID + backlog = cztery osobne alerty.
    await waitFor(() => expect(screen.queryAllByRole("alert").length).toBeGreaterThanOrEqual(4));
    expect(document.body.textContent ?? "").not.toContain("adminScheduler.");
  });

  it("pokazuje POWÓD pominięcia puknięcia zgłoszony przez crona", async () => {
    getSchedulerHealth.mockResolvedValue(
      health({
        freshness: "never",
        runner: {
          ...health().runner,
          enabled: true,
          lastAppOkAt: null,
          lastAppRunAt: null,
          lastTickStatus: "skipped",
          lastTickError: "pg_net_unavailable",
        },
      }),
    );
    renderPanel();

    // Kod powodu z invoke_jobs_tick() jest tłumaczony na zdanie, a nie
    // pokazywany surowo ani pomijany.
    await waitFor(() =>
      expect(document.body.textContent ?? "").toMatch(/pg_net|pg_net_unavailable/),
    );
    expect(document.body.textContent ?? "").not.toContain("adminScheduler.");
  });

  it("przycisk ticku woła serwerową funkcję i potwierdza sukces", async () => {
    getSchedulerHealth.mockResolvedValue(health());
    runSchedulerTickNow.mockResolvedValue({ push: { claimed: 2, sent: 2 } });
    renderPanel();

    await waitFor(() => expect(screen.getByText("87")).toBeInTheDocument());
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(runSchedulerTickNow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("tick z błędem joba melduje porażkę, nie sukces", async () => {
    getSchedulerHealth.mockResolvedValue(health());
    runSchedulerTickNow.mockResolvedValue({ push: { error: "vapid boom" } });
    renderPanel();

    await waitFor(() => expect(screen.getByText("87")).toBeInTheDocument());
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("błąd odczytu stanu pokazuje komunikat, nie pusty panel", async () => {
    getSchedulerHealth.mockRejectedValue(new Error("rpc down"));
    renderPanel();

    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(document.body.textContent ?? "").not.toContain("adminScheduler.");
  });
});
