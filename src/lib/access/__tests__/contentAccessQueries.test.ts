// REGUŁA DOSTĘPU - wspólny odczyt i pisarz edytora wpisu oraz wyjątków
// meteringu w paywallu (`contentAccessQueries.ts`).
//
// CO TEN PLIK DOWODZI.
//   1. Blokada optymistyczna przeniesiona 1:1 z `AccessSettingsPane`: brak
//      wersji → INSERT (23505 → `40001`), wersja → UPDATE po (typ, byt,
//      token) z 0 wierszy → `40001`. Kolumny spoza listy (hash hasła, najemca,
//      encja) nie wchodzą do zapisu.
//   2. Wyjątek meteringu z paywalla to TA SAMA reguła z tokenem - patch tylko
//      `metering_policy` (dawny ślepy UPDATE po `id` cofał regułę edytora).
//   3. Lista wyjątków BEZ limitu 200: strony `range` z liczbą, wyszukiwanie po
//      tytule przez wszystkie wyjątki (partiami), tytuły wpisów/stron/plików.
//   4. Unieważnianie = reguła szyny `content_access.changed.v1` (rdzeń + panel).
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  tenantId: null as string | null,
  hasPassword: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.db!.from(table),
    rpc: (fn: string) =>
      Promise.resolve(
        fn === "content_access_has_password"
          ? { data: h.hasPassword, error: null }
          : { data: null, error: new Error(`test: nieoczekiwane RPC ${fn}`) },
      ),
  },
}));
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => h.tenantId }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: null }) }));
vi.mock("@/lib/access/meteringVisitor.functions", () => ({
  consumeMeteredVisitorView: vi.fn(),
  getMeteredVisitorQuota: vi.fn(),
}));

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { accessKeys } from "@/lib/access/keys";
import { isStaleWriteError } from "@/lib/billing/planQueries";
import type { DomainEventRow } from "@/lib/realtime/domainEvents";
import {
  invalidationKeysFor,
  registerInvalidationExtension,
} from "@/lib/realtime/eventInvalidationMap";
import { ADMIN_HUB_INVALIDATION } from "@/lib/realtime/eventInvalidationMap.admin";
import {
  METERING_OVERRIDES_PAGE_SIZE,
  contentAccessInvalidationKeys,
  contentAccessRuleQueryOptions,
  meteringOverridesQueryOptions,
  saveContentAccessRule,
  useSetMeteringOverridePolicy,
  type MeteringOverridesPage,
} from "../contentAccessQueries";

const TENANT = "11111111-1111-4111-a111-111111111111";
const POST = "22222222-2222-4222-a222-222222222222";
const TOKEN = "2026-10-19T10:00:00.123456+00:00";

beforeEach(() => {
  h.db = supabaseFromStub();
  h.tenantId = TENANT;
  h.hasPassword = false;
});

const eqs = (chain: RecordedChain) =>
  chain.calls.filter((c) => c.method === "eq").map((c) => c.args);

describe("contentAccessRuleQueryOptions", () => {
  it("klucz z fabryki, wyłączony bez encji, reguła z tokenem i flagą hasła", async () => {
    const opts = contentAccessRuleQueryOptions("post", POST);
    expect(opts.queryKey).toEqual(accessKeys.rule("post", POST));
    expect(opts.enabled).toBe(true);
    expect(contentAccessRuleQueryOptions("post", null).enabled).toBe(false);

    h.hasPassword = true;
    h.db!.setResponse("content_access", ok({ id: "r1", mode: "password", updated_at: TOKEN }));
    const rule = await (opts.queryFn as () => Promise<unknown>)();
    expect(rule).toEqual({ id: "r1", mode: "password", updated_at: TOKEN, has_password: true });
    const select = h.db!.lastChain("content_access")!.argsOf("select")![0] as string;
    expect(select).toContain("updated_at");
    expect(select).not.toContain("password");
  });

  it("udany odczyt bez reguły = null; nieudany RZUCA (nie udaje braku reguły)", async () => {
    const opts = contentAccessRuleQueryOptions("page", POST);
    h.db!.setResponse("content_access", ok(null));
    await expect((opts.queryFn as () => Promise<unknown>)()).resolves.toBeNull();
    h.db!.setResponse("content_access", fail("permission denied", "42501"));
    await expect((opts.queryFn as () => Promise<unknown>)()).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("saveContentAccessRule - blokada optymistyczna (1:1 z AccessSettingsPane)", () => {
  it("wersja znana → UPDATE po (typ, byt, SUROWY token)", async () => {
    h.db!.setResponse("content_access", ok([{ id: "r1", updated_at: "nowy" }]));
    const row = await saveContentAccessRule({
      entityType: "post",
      entityId: POST,
      fields: { mode: "members", plan_ids: [] },
      expectedUpdatedAt: TOKEN,
    });
    const chain = h.db!.lastChain("content_access")!;
    expect(chain.argsOf("update")).toEqual([{ mode: "members", plan_ids: [] }]);
    expect(eqs(chain)).toEqual([
      ["entity_type", "post"],
      ["entity_id", POST],
      ["updated_at", TOKEN],
    ]);
    expect(row.updated_at).toBe("nowy");
  });

  it("0 wierszy przy UPDATE = 40001 (reguła zmieniona w innej karcie)", async () => {
    h.db!.setResponse("content_access", ok([]));
    const err = await saveContentAccessRule({
      entityType: "post",
      entityId: POST,
      fields: { mode: "public" },
      expectedUpdatedAt: TOKEN,
    }).catch((e: unknown) => e);
    expect(isStaleWriteError(err)).toBe(true);
  });

  it("brak wersji → INSERT z encją; 23505 = ktoś utworzył regułę → 40001", async () => {
    h.db!.setResponse("content_access", ok({ id: "r1", updated_at: TOKEN }));
    await saveContentAccessRule({
      entityType: "page",
      entityId: POST,
      fields: { mode: "paid" },
      expectedUpdatedAt: null,
    });
    expect(h.db!.lastChain("content_access")!.argsOf("insert")).toEqual([
      { mode: "paid", entity_type: "page", entity_id: POST },
    ]);

    h.db!.setResponse("content_access", fail("duplicate", "23505"));
    const err = await saveContentAccessRule({
      entityType: "page",
      entityId: POST,
      fields: { mode: "paid" },
      expectedUpdatedAt: null,
    }).catch((e: unknown) => e);
    expect(isStaleWriteError(err)).toBe(true);
  });

  it.each(["password_hash", "tenant_id", "entity_id", "id", "updated_at"])(
    "`%s` nie wchodzi do zapisu",
    async (column) => {
      await expect(
        saveContentAccessRule({
          entityType: "post",
          entityId: POST,
          fields: { mode: "public", [column]: "x" } as never,
          expectedUpdatedAt: TOKEN,
        }),
      ).rejects.toThrow(`column_not_owned:${column}`);
      expect(h.db!.chains).toEqual([]);
    },
  );
});

describe("useSetMeteringOverridePolicy", () => {
  it("patch wyłącznie `metering_policy` z tokenem wiersza listy, unieważnia regułę encji", async () => {
    h.db!.setResponse("content_access", ok([{ id: "r1", updated_at: "nowy" }]));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useSetMeteringOverridePolicy(), { wrapper });
    await result.current.mutateAsync({
      entityType: "post",
      entityId: POST,
      policy: "exempt",
      expectedUpdatedAt: TOKEN,
    });
    const chain = h.db!.lastChain("content_access")!;
    expect(chain.argsOf("update")).toEqual([{ metering_policy: "exempt" }]);
    expect(eqs(chain)).toContainEqual(["updated_at", TOKEN]);
    const keys = spy.mock.calls.map(([f]) => (f as { queryKey: QueryKey }).queryKey);
    expect(keys).toContainEqual(accessKeys.rule("post", POST));
    expect(keys).toContainEqual(accessKeys.overrides());
  });
});

/* ---------------------------------------------------- wyjątki meteringu */

function overrideRow(i: number, type: "post" | "page" | "media" = "post") {
  return {
    id: `rule-${i}`,
    entity_type: type,
    entity_id: `ent-${i}`,
    mode: "paid",
    metering_policy: i % 2 ? "metered" : "exempt",
    updated_at: `2026-10-19T10:00:00.${String(i).padStart(6, "0")}+00:00`,
  };
}

describe("meteringOverridesQueryOptions", () => {
  it("klucz pod prefiksem `accessKeys.overrides()` z frazą i stroną; staleTime", () => {
    const opts = meteringOverridesQueryOptions({ search: "  raport ", page: 2 });
    expect(opts.queryKey).toEqual([...accessKeys.overrides(), "raport", 2]);
    expect(opts.staleTime).toBe(30_000);
    expect(meteringOverridesQueryOptions({ search: "", page: -1 }).queryKey).toEqual([
      ...accessKeys.overrides(),
      "",
      0,
    ]);
  });

  it("bez frazy: strona `range` po stronie bazy + liczba exact + tytuły wpisów, stron i plików", async () => {
    h.db!.setResponse("content_access", {
      data: [overrideRow(1, "post"), overrideRow(2, "page"), overrideRow(3, "media")],
      error: null,
      count: 123,
    });
    h.db!.setResponse(
      "posts",
      ok([{ id: "ent-1", title_pl: "", title_en: "Report", slug: "report" }]),
    );
    h.db!.setResponse(
      "pages",
      ok([{ id: "ent-2", title_pl: "O nas", title_en: null, slug: "o-nas" }]),
    );
    h.db!.setResponse("media", ok([{ id: "ent-3", alt_text: null, filename: "raport.pdf" }]));

    const opts = meteringOverridesQueryOptions({ search: "", page: 1 });
    const page = await (opts.queryFn as () => Promise<MeteringOverridesPage>)();

    const chain = h.db!.lastChain("content_access")!;
    expect(chain.argsOf("select")).toEqual([
      expect.stringContaining("updated_at"),
      { count: "exact" },
    ]);
    expect(chain.argsOf("neq")).toEqual(["metering_policy", "inherit"]);
    expect(chain.argsOf("range")).toEqual([
      METERING_OVERRIDES_PAGE_SIZE,
      2 * METERING_OVERRIDES_PAGE_SIZE - 1,
    ]);
    expect(chain.has("limit")).toBe(false);
    expect(page.total).toBe(123);
    expect(page.rows.map((r) => [r.title, r.slug, r.metering_policy])).toEqual([
      ["Report", "report", "metered"],
      ["O nas", "o-nas", "exempt"],
      ["raport.pdf", null, "metered"],
    ]);
    expect(page.rows[0].updated_at).toBe(overrideRow(1).updated_at);
  });

  it("z frazą: przegląd WSZYSTKICH wyjątków partiami (bez limitu 200), filtr po tytule, stronicowanie", async () => {
    // 1001 wyjątków - dawny `limit(200)` nie widział 801 z nich.
    const all = Array.from({ length: 1001 }, (_, i) => overrideRow(i));
    h.db!.setResponse("content_access", (chain) => {
      const [from, to] = chain.argsOf("range") as [number, number];
      return ok(all.slice(from, to + 1));
    });
    h.db!.setResponse("posts", (chain) => {
      const ids = chain.argsOf("in")![1] as string[];
      expect(ids.length).toBeLessThanOrEqual(100);
      return ok(
        ids.map((id) => ({
          id,
          title_pl: id === "ent-1000" ? "Raport roczny" : `Wpis ${id}`,
          title_en: null,
          slug: id,
        })),
      );
    });

    const opts = meteringOverridesQueryOptions({ search: "RAPORT", page: 0 });
    const page = await (opts.queryFn as () => Promise<MeteringOverridesPage>)();

    expect(h.db!.chainsFor("content_access").map((c) => c.argsOf("range"))).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(page.total).toBe(1);
    expect(page.rows.map((r) => r.title)).toEqual(["Raport roczny"]);
  });
});

/* ---------------------------------------------------------- unieważnianie */

function eventOf(payload: Record<string, unknown>): DomainEventRow {
  return {
    id: "55555555-5555-4555-a555-555555555555",
    tenant_id: TENANT,
    aggregate_type: "content_access",
    aggregate_id: "r1",
    event_type: "content_access.changed.v1",
    payload: payload as DomainEventRow["payload"],
    correlation_id: null,
    actor_id: null,
    created_at: "2026-10-19T10:00:00.000Z",
  };
}

const sorted = (keys: readonly QueryKey[]) => keys.map((k) => JSON.stringify(k)).sort();

describe("unieważnianie = reguła `content_access.changed.v1`", () => {
  let unregister: () => void = () => {};
  beforeAll(() => {
    unregister = registerInvalidationExtension(ADMIN_HUB_INVALIDATION);
  });
  afterAll(() => unregister());

  it("encja znana: reguła encji (rdzeń + panel)", () => {
    expect(sorted(contentAccessInvalidationKeys("post", POST, TENANT))).toEqual(
      sorted(
        invalidationKeysFor(eventOf({ entity_type: "post", entity_id: POST }), {
          userId: undefined,
        }),
      ),
    );
  });

  it("bez encji: wszystkie reguły - jak szyna przy payloadzie bez pól encji", () => {
    expect(sorted(contentAccessInvalidationKeys(undefined, undefined, TENANT))).toEqual(
      sorted(invalidationKeysFor(eventOf({}), { userId: undefined })),
    );
  });
});
