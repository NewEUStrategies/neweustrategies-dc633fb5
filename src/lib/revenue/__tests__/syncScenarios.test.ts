// SCENARIUSZE SYNCHRONIZACJI HUBA (SPEC §3.5, S-A … S-F) - dowód na
// PRAWDZIWYCH kawałkach: mutator modułu (`useSaveAccessPlanPatch` nad małym
// modelem wiersza `access_plans`), aplikator szybkiej naprawy z rejestru S7,
// rdzeń mapy inwalidacji + rozszerzenie panelu (`ADMIN_HUB_INVALIDATION`
// zarejestrowane tak jak w `routes/admin.tsx`), dwa pasy kolejki inwalidacji
// (`useDebouncedInvalidation`) i klucze z fabryk producentów, spod których
// czytają karty huba.
//
// CO TEN PLIK DOWODZI (jeden `describe` na scenariusz):
//   S-A moduł → hub: zapis planu w Paywallu unieważnia LOKALNIE klucze modułu
//       i huba; zdarzenie `access_plan.changed.v1` w drugiej karcie trafia
//       listą planów w szybki pas (250 ms), a ofertę, dostęp, MRR i fakty
//       diagnostyki - w wolny (5 s).
//   S-B hub → moduł: szybka naprawa woła TEN SAM mutator (ten sam UPDATE
//       z tokenem), po zapisie świeże fakty (`refetchQueries` klucza faktów)
//       i ponowna ocena reguły dają „problem zniknął"; „Cofnij" idzie tym
//       samym mutatorem z nowym tokenem.
//   S-C płatność nieudana: zdarzenie operatora → windykacja i MRR huba,
//       szablon ścieżki „payment_failed_crm" (wyzwalacz, zadanie CRM, cel
//       „płatność odzyskana"), `crm_task.created.v1` → CRM i fakty diagnostyki.
//   S-D CRM → hub: zmiana etapu i cyklu życia leada → lejek toru Sprzedaż.
//   S-E konflikt dwóch edytorów: drugi zapis ze starym tokenem dostaje
//       0 wierszy → `40001` (stan „zmienione w innej karcie"), wiersz
//       zachowuje zmianę pierwszej karty; zdarzenie pierwszego zapisu
//       wcześniej unieważniło listę planów drugiej karty.
//   S-F bez szyny: mutacje lokalne nadal unieważniają (read-your-own-writes),
//       a powrót karty na pierwszy plan (`visibilitychange`) opróżnia wolny
//       pas od razu. Status kanału szyny (`useDomainEventStreamStatus`, I9 -
//       Z-S7-05) przechodzi w `paused` przy awarii i wraca do `live` po
//       ponownym połączeniu - z tego czyta baner huba.
import { act } from "@testing-library/react";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  tenantId: "11111111-1111-4111-8111-111111111111",
  /** Wywołanie zwrotne `.subscribe(status)` ostatniego kanału realtime. */
  channelStatus: null as ((status: string) => void) | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.db!.from(table),
    // Kanał realtime szyny (S-F): zapamiętuje wywołanie zwrotne stanu, żeby
    // scenariusz mógł zasymulować awarię i powrót połączenia.
    channel: () => {
      const channel = {
        on: () => channel,
        subscribe: (cb: (status: string) => void) => {
          h.channelStatus = cb;
          return channel;
        },
      };
      return channel;
    },
    removeChannel: async () => "ok",
  },
}));
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => h.tenantId }));
// Producent faktów S7 liczy z TEGO SAMEGO modelu wiersza planu - po zapisie
// naprawy świeże fakty widzą nowy stan, jak `admin_revenue_facts()` w bazie.
vi.mock("@/lib/revenue/diagnostics/diagnostics.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/diagnostics/diagnostics.functions")>()),
  getRevenueFacts: async () => ({ state: "ready", facts: factsFromDb() }),
}));

import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { QUICK_FIXES } from "@/lib/admin/revenue/quickFixes";
import { billingKeys } from "@/lib/billing/keys";
import {
  isStaleWriteError,
  saveAccessPlanPatch,
  useSaveAccessPlanPatch,
  type AccessPlanRow,
} from "@/lib/billing/planQueries";
import { crmKeys } from "@/lib/crm/keys";
import { JOURNEY_TEMPLATES } from "@/lib/journeys/templates";
import type { DomainEventRow, DomainEventType } from "@/lib/realtime/domainEvents";
import {
  invalidationKeysFor,
  registerInvalidationExtension,
} from "@/lib/realtime/eventInvalidationMap";
import { ADMIN_HUB_INVALIDATION } from "@/lib/realtime/eventInvalidationMap.admin";
import { SLOW_INVALIDATION_MS, useDebouncedInvalidation } from "@/lib/realtime/useModuleRealtime";
import {
  subscribeToDomainEvents,
  useDomainEventStreamStatus,
} from "@/lib/realtime/useDomainEventStream";
import { revenueAccessInventoryQueryOptions } from "@/lib/revenue/access/queries";
import { evaluateFindings, revenueFactsQueryOptions } from "@/lib/revenue/diagnostics/queries";
import type { RevenueFacts } from "@/lib/revenue/diagnostics/facts";
import {
  revenueDunningQueryOptions,
  revenueMrrBridgeQueryOptions,
  revenueOfferMatrixQueryOptions,
} from "@/lib/revenue/finance/queries";
import { revenueFunnelQueryOptions } from "@/lib/revenue/funnel/queries";
import { revenueKeys } from "@/lib/revenue/keys";
import { resolveRevenueRange } from "@/lib/revenue/window";
import {
  ENQUIRY_PLAN_ID,
  FACTS,
} from "@/components/admin/revenue/diagnostics/__tests__/diagnosticsFixtures";

const TENANT = h.tenantId;
const CTX = { userId: "44444444-4444-4444-a444-444444444444" };
const RANGE = resolveRevenueRange("month", Date.UTC(2026, 9, 15, 12));
const FAST_MS = 250;
const T0 = "2026-10-19T10:00:00.100001+00:00";

// ---------------------------------------------------------------------------
// Model bazy: jeden wiersz `access_plans` z semantyką UPDATE … WHERE token
// ---------------------------------------------------------------------------

let row: AccessPlanRow;
let tick = 0;
const nextToken = () => `2026-10-19T10:00:00.1000${String(++tick + 1).padStart(2, "0")}+00:00`;

/** SELECT * zwraca wiersz; UPDATE zmienia go tylko przy zgodnym `updated_at`. */
function accessPlans(chain: RecordedChain) {
  if (!chain.has("update")) return ok([row]);
  const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => c.args);
  const id = eqs.find(([col]) => col === "id")?.[1];
  const token = eqs.find(([col]) => col === "updated_at")?.[1];
  if (id !== row.id || token !== row.updated_at) return ok([]);
  const patch = chain.argsOf("update")![0] as Partial<AccessPlanRow>;
  row = { ...row, ...patch, updated_at: nextToken() };
  return ok([row]);
}

/** Fakty katalogu z bieżącego wiersza (plan na zapytanie o ofertę). */
function factsFromDb(): RevenueFacts {
  const facts = JSON.parse(JSON.stringify(FACTS)) as RevenueFacts;
  const plans = facts.areas.catalog?.plans ?? [];
  return {
    ...facts,
    areas: {
      ...facts.areas,
      catalog: {
        plans: plans.map((plan) =>
          plan.id === row.id ? { ...plan, forSale: row.for_sale, active: row.active } : plan,
        ),
      },
    },
  };
}

function eventOf(type: DomainEventType, aggregateId = ENQUIRY_PLAN_ID): DomainEventRow {
  return {
    id: "55555555-5555-4555-a555-555555555555",
    tenant_id: TENANT,
    aggregate_type: type.split(".")[0],
    aggregate_id: aggregateId,
    event_type: type,
    payload: {} as DomainEventRow["payload"],
    correlation_id: null,
    actor_id: null,
    created_at: "2026-10-19T10:00:00.000Z",
  };
}

/** Dopasowanie TanStack Query: klucz inwalidacji jest PREFIKSEM klucza zapytania. */
function covers(keys: readonly QueryKey[], queryKey: QueryKey): boolean {
  return keys.some((key) => key.every((part, index) => Object.is(queryKey[index], part)));
}

/** Klucze kart huba, które zmiana planu musi odświeżyć (SPEC §3.5 S-A). */
const HUB_PLAN_KEYS = {
  offer: revenueOfferMatrixQueryOptions(TENANT).queryKey,
  access: revenueAccessInventoryQueryOptions(TENANT).queryKey,
  mrr: revenueMrrBridgeQueryOptions(TENANT, RANGE).queryKey,
  facts: revenueFactsQueryOptions(TENANT).queryKey,
} as const;

function seed(queryClient: QueryClient, keys: readonly QueryKey[]): void {
  for (const key of keys) queryClient.setQueryData(key, { seeded: true });
}

function invalidated(queryClient: QueryClient, key: QueryKey): boolean {
  return queryClient.getQueryState(key)?.isInvalidated === true;
}

let unregister: () => void = () => undefined;

beforeAll(() => {
  // Jak `routes/admin.tsx`: rozszerzenie panelu rejestrowane po sesji.
  unregister = registerInvalidationExtension(ADMIN_HUB_INVALIDATION);
});

afterAll(() => unregister());

beforeEach(() => {
  tick = 0;
  h.db = supabaseFromStub();
  h.db.setResponse("access_plans", accessPlans);
  row = {
    id: ENQUIRY_PLAN_ID,
    tenant_id: TENANT,
    name_pl: "Decision Lab",
    name_en: "Decision Lab",
    description_pl: null,
    description_en: null,
    features_pl: [],
    features_en: [],
    badge_pl: null,
    badge_en: null,
    highlighted: false,
    sort_order: 0,
    price_cents: 990_000,
    currency: "PLN",
    interval: "year",
    trial_days: 0,
    active: true,
    for_sale: true,
    tier_key: "decision_lab",
    volume_price_cents: null,
    volume_threshold_seats: null,
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: T0,
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// S-A
// ---------------------------------------------------------------------------

describe("S-A moduł → hub: zmiana planu w Paywallu", () => {
  it("karta 1: mutator modułu unieważnia lokalnie listę planów i karty huba", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useSaveAccessPlanPatch("paywall"),
    );
    const plansAll = billingKeys.admin.plansAll();
    seed(queryClient, [plansAll, ...Object.values(HUB_PLAN_KEYS)]);

    await act(async () => {
      await result.current.mutateAsync({
        id: ENQUIRY_PLAN_ID,
        expectedUpdatedAt: T0,
        patch: { price_cents: 1_190_000 },
      });
    });

    expect(row.price_cents).toBe(1_190_000);
    expect(invalidated(queryClient, plansAll)).toBe(true);
    for (const [name, key] of Object.entries(HUB_PLAN_KEYS)) {
      expect(invalidated(queryClient, key), name).toBe(true);
    }
  });

  it("karta 2: access_plan.changed.v1 - lista planów po 250 ms, karty huba po 5 s", async () => {
    vi.useFakeTimers();
    const keys = invalidationKeysFor(eventOf("access_plan.changed.v1"), CTX);
    expect(covers(keys, billingKeys.admin.plansAll())).toBe(true);
    for (const [name, key] of Object.entries(HUB_PLAN_KEYS)) {
      expect(covers(keys, key), name).toBe(true);
    }

    const { result, queryClient } = renderHookWithQueryClient(() => useDebouncedInvalidation());
    const seen: QueryKey[] = [];
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async (filters) => {
      seen.push(filters?.queryKey ?? []);
    });
    act(() => result.current(keys));

    act(() => vi.advanceTimersByTime(FAST_MS));
    expect(covers(seen, billingKeys.admin.plansAll())).toBe(true);
    expect(covers(seen, HUB_PLAN_KEYS.offer)).toBe(false);

    act(() => vi.advanceTimersByTime(SLOW_INVALIDATION_MS - FAST_MS));
    for (const [name, key] of Object.entries(HUB_PLAN_KEYS)) {
      expect(covers(seen, key), name).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// S-B
// ---------------------------------------------------------------------------

describe("S-B hub → moduł: szybka naprawa tym samym mutatorem", () => {
  const spec = QUICK_FIXES.plan_not_for_sale;

  it("pisarz naprawy = pisarz bytu z manifestu = mutator modułu", () => {
    expect(spec.apply.writer).toBe("src/lib/billing/planQueries.ts#useSaveAccessPlanPatch");
    expect(spec.apply.moduleExport).toBe("useSaveAccessPlanPatch");
    expect(spec.apply.entity).toBe("access_plan");
  });

  it("zapis UPDATE z tokenem, lokalna inwalidacja, świeże fakty → reguła „ok”; Cofnij tym samym mutatorem", async () => {
    const before = evaluateFindings(factsFromDb(), [], Date.parse("2026-10-19T10:00:00Z")).find(
      (f) => f.checkId === "catalog.enquiry_plan_buyable",
    );
    expect(before?.state).not.toBe("ok");

    const { result, queryClient } = renderHookWithQueryClient(() => spec.apply.useApplier());
    seed(queryClient, Object.values(HUB_PLAN_KEYS));

    let applied: Awaited<ReturnType<typeof result.current.apply>> | undefined;
    await act(async () => {
      applied = await result.current.apply({ planIds: [ENQUIRY_PLAN_ID] });
    });

    // Ten sam UPDATE co moduł: jawna kolumna i token z ŚWIEŻEGO odczytu.
    const update = h.db!.chainsFor("access_plans").find((c) => c.has("update"));
    expect(update?.argsOf("update")).toEqual([{ for_sale: false }]);
    expect(update?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", ENQUIRY_PLAN_ID],
      ["updated_at", T0],
    ]);
    expect(row.for_sale).toBe(false);
    expect(invalidated(queryClient, HUB_PLAN_KEYS.offer)).toBe(true);

    // Pętla „naprawa → ponowne sprawdzenie" (QuickFixDialog): refetch klucza faktów.
    await act(async () => {
      await queryClient.fetchQuery({ ...revenueFactsQueryOptions(TENANT), staleTime: 0 });
    });
    const read = queryClient.getQueryData(revenueKeys.facts(TENANT)) as {
      state: string;
      facts: RevenueFacts;
    };
    const after = evaluateFindings(read.facts, [], Date.parse("2026-10-19T10:00:00Z")).find(
      (f) => f.checkId === "catalog.enquiry_plan_buyable",
    );
    expect(after?.state).toBe("ok");

    // „Cofnij": ten sam mutator, token z zapisu naprawy.
    const tokenAfterFix = row.updated_at;
    await act(async () => {
      await applied?.revert?.();
    });
    const updates = h.db!.chainsFor("access_plans").filter((c) => c.has("update"));
    expect(
      updates.at(-1)?.calls.find((c) => c.method === "eq" && c.args[0] === "updated_at")?.args,
    ).toEqual(["updated_at", tokenAfterFix]);
    expect(row.for_sale).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S-C
// ---------------------------------------------------------------------------

describe("S-C płatność nieudana → windykacja → ścieżka → zadanie CRM", () => {
  it("payment_failed.v1 odświeża windykację i MRR huba", () => {
    const keys = invalidationKeysFor(eventOf("billing_subscription.payment_failed.v1"), CTX);
    expect(covers(keys, revenueDunningQueryOptions(TENANT, RANGE).queryKey)).toBe(true);
    expect(covers(keys, revenueMrrBridgeQueryOptions(TENANT, RANGE).queryKey)).toBe(true);
  });

  it("szablon ścieżki: wyzwalacz payment_failed, zadanie CRM, cel payment_recovered", () => {
    const template = JOURNEY_TEMPLATES.payment_failed_crm;
    expect(template.settings.triggerEventType).toBe("billing_subscription.payment_failed.v1");
    expect(template.settings.goal?.eventType).toBe("billing_subscription.payment_recovered.v1");
    expect(template.graph.nodes.map((n) => n.type)).toContain("create_crm_task");
  });

  it("crm_task.created.v1 → lista zadań CRM i fakty diagnostyki huba", () => {
    const keys = invalidationKeysFor(eventOf("crm_task.created.v1"), CTX);
    expect(covers(keys, crmKeys.tasksAll())).toBe(true);
    expect(covers(keys, HUB_PLAN_KEYS.facts)).toBe(true);
  });

  it("payment_recovered.v1 (cel ścieżki) odświeża windykację", () => {
    const keys = invalidationKeysFor(eventOf("billing_subscription.payment_recovered.v1"), CTX);
    expect(covers(keys, revenueDunningQueryOptions(TENANT, RANGE).queryKey)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S-D
// ---------------------------------------------------------------------------

describe("S-D CRM → hub: etap i cykl życia leada", () => {
  it.each(["crm_lead.stage_changed.v1", "crm_lead.lifecycle_changed.v1"] as const)(
    "%s → lejek toru Sprzedaż i lista leadów",
    (type) => {
      const keys = invalidationKeysFor(eventOf(type), CTX);
      const sales = revenueFunnelQueryOptions(TENANT, RANGE, { track: "sales" });
      expect(covers(keys, sales.queryKey)).toBe(true);
      expect(covers(keys, crmKeys.leadsAll())).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// S-E
// ---------------------------------------------------------------------------

describe("S-E konflikt dwóch edytorów", () => {
  it("drugi zapis ze starym tokenem: 0 wierszy → 40001, wiersz zachowuje pierwszą zmianę", async () => {
    // Obie karty otworzyły plan z tokenem T0.
    await saveAccessPlanPatch("paywall", {
      id: ENQUIRY_PLAN_ID,
      expectedUpdatedAt: T0,
      patch: { price_cents: 1_000_000 },
    });
    // Zdarzenie pierwszego zapisu dociera do drugiej karty wcześniej niż jej
    // zapis - lista planów (i „stan teraz") jest już unieważniona.
    const keys = invalidationKeysFor(eventOf("access_plan.changed.v1"), CTX);
    expect(covers(keys, billingKeys.admin.plansAll())).toBe(true);

    const second = saveAccessPlanPatch("paywall", {
      id: ENQUIRY_PLAN_ID,
      expectedUpdatedAt: T0,
      patch: { price_cents: 1_500_000 },
    });
    const error = await second.catch((e: unknown) => e);
    expect(isStaleWriteError(error)).toBe(true);
    expect(row.price_cents).toBe(1_000_000);
  });
});

// ---------------------------------------------------------------------------
// S-F
// ---------------------------------------------------------------------------

describe("S-F realtime niedostępny", () => {
  it("bez szyny mutacja lokalna nadal unieważnia (read-your-own-writes)", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useSaveAccessPlanPatch("paywall"),
    );
    seed(queryClient, [billingKeys.admin.plansAll(), HUB_PLAN_KEYS.offer]);
    await act(async () => {
      await result.current.mutateAsync({
        id: ENQUIRY_PLAN_ID,
        expectedUpdatedAt: T0,
        patch: { for_sale: false },
      });
    });
    expect(invalidated(queryClient, billingKeys.admin.plansAll())).toBe(true);
    expect(invalidated(queryClient, HUB_PLAN_KEYS.offer)).toBe(true);
  });

  it("ukryta karta czeka; visibilitychange opróżnia wolny pas od razu (przed 5 s)", () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try {
      const { result, queryClient } = renderHookWithQueryClient(() => useDebouncedInvalidation());
      const seen: QueryKey[] = [];
      vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async (filters) => {
        seen.push(filters?.queryKey ?? []);
      });
      act(() => result.current(invalidationKeysFor(eventOf("access_plan.changed.v1"), CTX)));
      act(() => vi.advanceTimersByTime(SLOW_INVALIDATION_MS * 2));
      expect(seen).toHaveLength(0);

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(covers(seen, HUB_PLAN_KEYS.offer)).toBe(true);
      expect(covers(seen, billingKeys.admin.plansAll())).toBe(true);
    } finally {
      // happy-dom trzyma `visibilityState` na prototypie - zdejmujemy własność instancji.
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });

  it("status szyny: awaria kanału = `paused` (baner huba), ponowne połączenie = `live`", () => {
    const { result: status } = renderHookWithQueryClient(() => useDomainEventStreamStatus());
    expect(status.current).toBe("live");

    const off = subscribeToDomainEvents(undefined, () => undefined);
    // Kanał się łączy - jeszcze bez stanu, więc bez fałszywego alarmu.
    expect(status.current).toBe("live");
    act(() => h.channelStatus?.("CHANNEL_ERROR"));
    expect(status.current).toBe("paused");
    act(() => h.channelStatus?.("SUBSCRIBED"));
    expect(status.current).toBe("live");
    act(() => h.channelStatus?.("TIMED_OUT"));
    expect(status.current).toBe("paused");

    // Ostatni słuchacz zamyka kanał - zamknięty przez nas kanał nie jest awarią.
    act(() => off());
    expect(status.current).toBe("live");
  });
});
