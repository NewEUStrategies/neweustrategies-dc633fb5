// Hooki meteringu paywalla - warstwa konsumpcji, której czyste reguły
// (metering.test.ts) nie widzą: useMeteredAccess (RPC consume_metered_view -
// jedyna droga, jaką niesubskrybent dostaje body), zasiew żywego licznika
// miesiąca po każdej konsumpcji, telemetria odmów (log_metering_event zasila
// dashboard monetyzacji) oraz useMeterQuota / fetchMeteringSettings.
//
// Egzekwowanie jest serwerowe (SECURITY DEFINER, tenant z kontekstu wołającego,
// idempotencja per byt/miesiąc) - tu dowodzimy kontraktu KLIENTA: właściwa
// droga per tożsamość (konto: RPC z auth.uid(); gość: funkcja serwerowa z
// podpisanym cookie - przeglądarka nie podaje ŻADNEGO klucza gościa, audyt
// SUB-17), EMPTY_BODY przy odmowie
// (a nie null, który cofnąłby paywall do stanu "jeszcze nie próbowano"),
// zasiew wyłącznie werdyktów z realnym limitem i cisza RPC, gdy licznik
// czyta świeżo zasiany cache.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  PAYWALL_IDS,
  consumeRow,
  meteringStateRow,
  type ConsumeMeteredViewRow,
  type MeteringStateRow,
} from "@/test/paywall/fixtures";
import { EMPTY_BODY } from "@/lib/access/gating";

interface MeteringSettingsRow {
  enabled: boolean;
  member_monthly_limit: number;
  anon_monthly_limit: number;
  meter_paid: boolean;
  meter_members: boolean;
  show_counter: boolean;
}

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  consume: { data: [] as ConsumeMeteredViewRow[], error: null as Error | null },
  quota: { data: [] as MeteringStateRow[], error: null as Error | null },
  settings: { data: null as MeteringSettingsRow | null, error: null as Error | null },
  rpc: vi.fn(),
  serverFn: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));
// Gość: konsumpcja i stan idą przez funkcje serwerowe (cookie HttpOnly
// z podpisem) - atrapa oddaje te same wiersze, co RPC konta.
vi.mock("@/lib/access/meteringVisitor.functions", () => ({
  consumeMeteredVisitorView: (opts: unknown) => h.serverFn("consume", opts),
  getMeteredVisitorQuota: () => h.serverFn("quota"),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => h.rpc(name, args),
    from: (table: string) => ({
      select: (columns: string) => ({
        maybeSingle: () => {
          h.rpc(`from:${table}`, { columns });
          return Promise.resolve({ data: h.settings.data, error: h.settings.error });
        },
      }),
    }),
  },
}));

import {
  currentMeterPeriod,
  fetchMeteringSettings,
  quotaFromMeterState,
  useMeteredAccess,
  useMeteringSettings,
  useMeterQuota,
  type MeterState,
} from "@/lib/access/metering";

/** Świeży, pozbawiony retry klient per test - zero przecieków cache między testami. */
function harness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const rpcCalls = (name: string) => h.rpc.mock.calls.filter(([called]) => called === name);
const serverCalls = (name: string) => h.serverFn.mock.calls.filter(([called]) => called === name);
const VISITOR = "visitor";

beforeEach(() => {
  h.session = null;
  h.consume = { data: [], error: null };
  h.quota = { data: [], error: null };
  h.settings = { data: null, error: null };
  h.rpc.mockReset().mockImplementation((name: string) => {
    if (name === "consume_metered_view") {
      return Promise.resolve({ data: h.consume.data, error: h.consume.error });
    }
    if (name === "metering_state") {
      return Promise.resolve({ data: h.quota.data, error: h.quota.error });
    }
    return Promise.resolve({ data: null, error: null });
  });
  h.serverFn.mockReset().mockImplementation((name: string) => {
    const source = name === "consume" ? h.consume : h.quota;
    if (source.error) return Promise.reject(source.error);
    return Promise.resolve(source.data[0] ?? null);
  });
});

describe("useMeteredAccess - konsumpcja i tożsamość", () => {
  it("gość: konsumuje przez funkcję serwerową, bez klucza gościa z przeglądarki", async () => {
    h.consume.data = [consumeRow()];
    const { wrapper } = harness();
    const { result } = renderHook(() => useMeteredAccess("post", PAYWALL_IDS.entity, true), {
      wrapper,
    });

    await waitFor(() => expect(result.current.settled).toBe(true));
    // Tożsamość gościa rozstrzyga serwer z cookie HttpOnly - w ładunku jest
    // wyłącznie byt, a RPC konta (i jakikolwiek _visitor_id) nie wychodzi.
    expect(serverCalls("consume")).toEqual([
      ["consume", { data: { entityType: "post", entityId: PAYWALL_IDS.entity } }],
    ]);
    expect(rpcCalls("consume_metered_view")).toEqual([]);
    expect(result.current.body?.content_pl).toBe("<p>Pełna treść analizy.</p>");
    expect(result.current.meter).toEqual({
      granted: true,
      consumed: true,
      used: 1,
      monthlyLimit: 3,
      remaining: 2,
      requiresRegistration: false,
      showCounter: true,
    } satisfies MeterState);
    // Udana konsumpcja nie emituje debug logu - sukces loguje trigger serwera.
    expect(rpcCalls("log_metering_event")).toEqual([]);
  });

  it("konto: konsumuje po auth.uid(), bez klucza gościa w argumentach", async () => {
    h.session = { user: { id: PAYWALL_IDS.user } };
    h.consume.data = [consumeRow()];
    const { wrapper } = harness();
    const { result } = renderHook(() => useMeteredAccess("page", PAYWALL_IDS.page, true), {
      wrapper,
    });

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(rpcCalls("consume_metered_view")).toEqual([
      ["consume_metered_view", { _entity_type: "page", _entity_id: PAYWALL_IDS.page }],
    ]);
    expect(h.serverFn).not.toHaveBeenCalled();
  });

  it("wyłączony (meteringApplies=false) nie dotyka serwera i jest natychmiast rozstrzygnięty", () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useMeteredAccess("post", PAYWALL_IDS.entity, false), {
      wrapper,
    });
    expect(result.current).toEqual({ body: null, meter: null, settled: true });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.serverFn).not.toHaveBeenCalled();
  });

  it("brak bytu: konsumpcja nigdy nie startuje", () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useMeteredAccess("post", null, true), { wrapper });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.serverFn).not.toHaveBeenCalled();
    expect(result.current.settled).toBe(false);
  });

  it("błąd funkcji serwerowej gościa: rozstrzygnięty bez body i bez werdyktu (paywall zostaje zamknięty)", async () => {
    h.consume.error = new Error("rpc failed");
    const { wrapper } = harness();
    const { result } = renderHook(() => useMeteredAccess("post", PAYWALL_IDS.entity, true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.body).toBeNull();
    expect(result.current.meter).toBeNull();
  });
});

describe("useMeteredAccess - odmowy i telemetria monetyzacji", () => {
  it("konto, wyczerpany limit: EMPTY_BODY (nie null) i log denied/monthly_limit_reached", async () => {
    h.session = { user: { id: PAYWALL_IDS.user } };
    h.consume.data = [
      consumeRow({
        granted: false,
        consumed: false,
        used: 3,
        monthly_limit: 3,
        remaining: 0,
        content_pl: null,
      }),
    ];
    const { wrapper } = harness();
    const { result } = renderHook(() => useMeteredAccess("post", PAYWALL_IDS.entity, true), {
      wrapper,
    });

    await waitFor(() => expect(result.current.settled).toBe(true));
    // EMPTY_BODY odróżnia "odmówiono" od "jeszcze nie próbowano" (null) -
    // na tym rozróżnieniu stoi pickBody i wariant exhausted paywalla.
    expect(result.current.body).toEqual(EMPTY_BODY);
    expect(result.current.meter?.granted).toBe(false);
    expect(rpcCalls("log_metering_event")).toEqual([
      [
        "log_metering_event",
        {
          _entity_type: "post",
          _entity_id: PAYWALL_IDS.entity,
          _outcome: "denied",
          _reason: "monthly_limit_reached",
          _used_before: 3,
          _monthly_limit: 3,
        },
      ],
    ]);
  });

  it("gość, odmowa: EMPTY_BODY bez logu z przeglądarki (odmowy gościa loguje baza)", async () => {
    h.consume.data = [
      consumeRow({ granted: false, consumed: false, used: 1, monthly_limit: 1, remaining: 0 }),
    ];
    const { wrapper } = harness();
    const { result } = renderHook(() => useMeteredAccess("post", PAYWALL_IDS.entity, true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.body).toEqual(EMPTY_BODY);
    expect(rpcCalls("log_metering_event")).toEqual([]);
  });

  it("ściana rejestracji gościa: EMPTY_BODY i werdykt requires_registration, bez logu klienta", async () => {
    h.consume.data = [
      consumeRow({
        granted: false,
        consumed: false,
        used: 0,
        monthly_limit: 0,
        remaining: 0,
        requires_registration: true,
        content_pl: null,
      }),
    ];
    const { wrapper } = harness();
    const { result } = renderHook(() => useMeteredAccess("post", PAYWALL_IDS.entity, true), {
      wrapper,
    });

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.body).toEqual(EMPTY_BODY);
    expect(result.current.meter?.requiresRegistration).toBe(true);
    expect(rpcCalls("log_metering_event")).toEqual([]);
  });

  it("konto, odmowa bez licznika (byt poza meteringiem): reason no_access", async () => {
    h.session = { user: { id: PAYWALL_IDS.user } };
    h.consume.data = [
      consumeRow({ granted: false, consumed: false, monthly_limit: 0, used: 0, content_pl: null }),
    ];
    const { wrapper } = harness();
    const { result } = renderHook(() => useMeteredAccess("post", PAYWALL_IDS.entity, true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(rpcCalls("log_metering_event")[0][1]).toMatchObject({ _reason: "no_access" });
  });

  it("pusty wynik RPC: rozstrzygnięty, bez body, bez werdyktu i bez logu", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useMeteredAccess("post", PAYWALL_IDS.entity, true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.body).toBeNull();
    expect(result.current.meter).toBeNull();
    expect(rpcCalls("log_metering_event")).toEqual([]);
  });
});

describe("useMeteredAccess - zasiew żywego licznika miesiąca", () => {
  it("werdykt z realnym limitem zasiewa cache quoty pod kluczem tożsamości i okresu", async () => {
    h.consume.data = [consumeRow({ used: 2, remaining: 1 })];
    const { queryClient, wrapper } = harness();
    const { result } = renderHook(() => useMeteredAccess("post", PAYWALL_IDS.entity, true), {
      wrapper,
    });

    await waitFor(() => expect(result.current.settled).toBe(true));
    const seeded = queryClient.getQueryData(["metering-quota", VISITOR, currentMeterPeriod()]);
    expect(seeded).toEqual(quotaFromMeterState(result.current.meter as MeterState));
  });

  it("skrót dla uprawnionych (limit 0) nie zatruwa quoty czytelnika", async () => {
    // Wiersz bez realnego limitu nie opisuje miesięcznej puli - zasiew zrobiłby
    // z "masz pełny dostęp" licznik "0 z 0" w banerze treści.
    h.consume.data = [consumeRow({ monthly_limit: 0, remaining: 0 })];
    const { queryClient, wrapper } = harness();
    const { result } = renderHook(() => useMeteredAccess("post", PAYWALL_IDS.entity, true), {
      wrapper,
    });

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(
      queryClient.getQueryData(["metering-quota", VISITOR, currentMeterPeriod()]),
    ).toBeUndefined();
  });

  it("zasiany cache karmi useMeterQuota bez dodatkowego RPC", async () => {
    h.consume.data = [consumeRow({ used: 2, remaining: 1 })];
    const { queryClient, wrapper } = harness();
    const consume = renderHook(() => useMeteredAccess("post", PAYWALL_IDS.entity, true), {
      wrapper,
    });
    await waitFor(() => expect(consume.result.current.settled).toBe(true));

    const quota = renderHook(() => useMeterQuota(true), { wrapper });
    await waitFor(() => expect(quota.result.current.data).toBeDefined());
    expect(quota.result.current.data).toMatchObject({ used: 2, remaining: 1, monthlyLimit: 3 });
    // Licznik "zostało N" NIE wychodzi do serwera po świeżej konsumpcji.
    expect(rpcCalls("metering_state")).toEqual([]);
    expect(serverCalls("quota")).toEqual([]);
    expect(queryClient.isFetching()).toBe(0);
  });
});

describe("useMeterQuota - odczyt stanu miesiąca bez konsumpcji", () => {
  it("gość: stan z funkcji serwerowej (bez klucza gościa), zmapowany na MeterQuota", async () => {
    h.quota.data = [meteringStateRow({ used: 2, remaining: 1 })];
    const { wrapper } = harness();
    const { result } = renderHook(() => useMeterQuota(true), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(serverCalls("quota")).toEqual([["quota"]]);
    expect(rpcCalls("metering_state")).toEqual([]);
    expect(result.current.data).toEqual({
      enabled: true,
      monthlyLimit: 3,
      used: 2,
      remaining: 1,
      requiresRegistration: false,
      showCounter: true,
    });
  });

  it("konto: metering_state bez argumentów (tożsamość z auth.uid())", async () => {
    h.session = { user: { id: PAYWALL_IDS.user } };
    h.quota.data = [meteringStateRow()];
    const { wrapper } = harness();
    const { result } = renderHook(() => useMeterQuota(true), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(rpcCalls("metering_state")).toEqual([["metering_state", undefined]]);
    expect(h.serverFn).not.toHaveBeenCalled();
  });

  it("pusty wynik daje null; enabled=false nie odpytuje serwera", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useMeterQuota(true), { wrapper });
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.data).toBeNull();

    // Świeży klient: wyłączony licznik nie ma prawa ani czytać cudzego cache,
    // ani wywołać RPC (np. baner zamontowany warunkowo z visible=false).
    h.rpc.mockClear();
    h.serverFn.mockClear();
    const off = renderHook(() => useMeterQuota(false), { wrapper: harness().wrapper });
    expect(off.result.current.data).toBeUndefined();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.serverFn).not.toHaveBeenCalled();
  });
});

describe("fetchMeteringSettings - konfiguracja tenanta", () => {
  it("czyta publiczny singleton (kolumny bez tenant_id - izolację daje RLS)", async () => {
    h.settings.data = {
      enabled: true,
      member_monthly_limit: 5,
      anon_monthly_limit: 1,
      meter_paid: true,
      meter_members: false,
      show_counter: true,
    };
    await expect(fetchMeteringSettings()).resolves.toEqual(h.settings.data);
    expect(rpcCalls("from:metering_settings")).toEqual([
      [
        "from:metering_settings",
        {
          columns:
            "enabled, member_monthly_limit, anon_monthly_limit, meter_paid, meter_members, show_counter",
        },
      ],
    ]);
  });

  it("brak wiersza to null (tenant bez konfiguracji), błąd leci wyżej", async () => {
    await expect(fetchMeteringSettings()).resolves.toBeNull();
    h.settings.error = new Error("permission denied");
    await expect(fetchMeteringSettings()).rejects.toThrow("permission denied");
  });

  it("useMeteringSettings podaje konfigurację warstwie treści przez react-query", async () => {
    h.settings.data = {
      enabled: true,
      member_monthly_limit: 3,
      anon_monthly_limit: 0,
      meter_paid: true,
      meter_members: true,
      show_counter: true,
    };
    const { wrapper } = harness();
    const { result } = renderHook(() => useMeteringSettings(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(h.settings.data));
  });
});
