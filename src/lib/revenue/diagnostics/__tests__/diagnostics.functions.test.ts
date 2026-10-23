// Server fn diagnostyki (S7, SPEC §5.2): obudowa, literały RPC, stany odmowy
// zamiast wyjątków, walidacja wyciszeń (odrzucenie, nigdy przycięcie) i fakty
// liczone w TS.
//
// Czego pilnuje: najemca NIGDY nie idzie w parametrach (RPC bierze go
// z sesji), nazwy RPC są literałami w miejscu wywołania (bramka
// `generate:ts-sql-contract`), 42501 → `forbidden`, 42883/PGRST202 →
// `unavailable` (okno wdrożenia), odmowa MFA z middleware → stan karty,
// a wejście ponad `REVENUE_LIMITS` nie dochodzi do bazy.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REVENUE_LIMITS } from "@/lib/revenue/limits";
import { resetServerFnContext, serverFnMeta, setServerFnContext } from "@/test/serverFn";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
}));
// Moduł waluty prezentacji importuje kurs NBP, który w środowisku z `window`
// (happy-dom) od razu sięga do sieci - na serwerze tego nie robi. Fakty
// potrzebują tylko `displayCurrencyForLang`, więc kurs jest atrapą.
vi.mock("@/lib/billing/fxRate", () => ({
  getEurPlnRate: () => 4,
  ensureFxRateLoaded: async () => 4,
  forceRefreshFxRate: async () => 4,
  getFxState: () => ({ eurPln: 4, source: "nbp" as const }),
}));

import {
  enrichRevenueFacts,
  getRevenueFacts,
  getRevenueSnoozes,
  parseRevenueSnoozes,
  RETENTION_DIALOG_STEPS,
  snoozeRevenueCheck,
  SnoozeInput,
  unsnoozeRevenueCheck,
  type RevenueFactsDeps,
} from "../diagnostics.functions";
import { parseRevenueFacts, type RevenueFacts } from "../facts";
import { middlewareDenial } from "../queries";

const SOURCE = readFileSync(
  join(process.cwd(), "src/lib/revenue/diagnostics/diagnostics.functions.ts"),
  "utf8",
);

const NOW_MS = Date.parse("2026-10-20T12:00:00.000Z");
const DAY = 86_400_000;
const ID = (n: number) => `e7150000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const RAW_FACTS = {
  v: 1,
  computedAt: "2026-10-20T12:00:00.000Z",
  areas: {
    checkout: {
      settingsRow: true,
      abandonAfterMinutes: 1440,
      abandonedJourneyActive: false,
      chargeCurrencies: ["PLN"],
    },
    retention: { settingsRow: true, enabled: true, cancellations30d: 2 },
    sync: { emitErrors24h: 0, emitErrors7d: 0, seenTypes90d: ["access_plan.changed.v1"] },
    crm: null,
  },
};

beforeEach(() => {
  h.rpc.mockReset();
  setServerFnContext({ supabase: { rpc: h.rpc }, userId: "user-1" });
});

afterEach(() => {
  resetServerFnContext();
  vi.useRealTimers();
});

describe("obudowa", () => {
  it.each([
    ["getRevenueFacts", getRevenueFacts, false],
    ["getRevenueSnoozes", getRevenueSnoozes, false],
    ["snoozeRevenueCheck", snoozeRevenueCheck, true],
    ["unsnoozeRevenueCheck", unsnoozeRevenueCheck, true],
  ] as const)("%s: POST za bramką sztabu CRM (admin/editor + aal2)", (_name, fn, validated) => {
    const meta = serverFnMeta(fn);
    expect(meta?.method).toBe("POST");
    expect(meta?.middleware).toEqual([{ __mw: "requireCrmStaff" }]);
    expect(meta?.hasValidator).toBe(validated);
  });

  it("nazwy RPC są literałami w miejscu wywołania", () => {
    for (const name of [
      "admin_revenue_facts",
      "admin_revenue_diagnostic_snoozes",
      "admin_revenue_diagnostic_snooze",
      "admin_revenue_diagnostic_unsnooze",
    ]) {
      expect(SOURCE).toMatch(new RegExp(`\\.rpc\\(\\s*"${name}",`));
    }
  });

  it("moduły faktów TS ładowane wyłącznie dynamicznie (poza chunkiem klienta)", () => {
    const staticImports = [...SOURCE.matchAll(/^import .* from "([^"]+)";$/gm)].map(([, m]) => m);
    for (const module of [
      "@/lib/billing/capabilities",
      "@/lib/journeys/templates",
      "@/lib/realtime/domainEvents",
      "@/lib/analytics/semantic/benchmarks/sources",
    ]) {
      expect(staticImports).not.toContain(module);
      expect(SOURCE).toContain(`import("${module}")`);
    }
  });
});

describe("getRevenueFacts", () => {
  it("woła RPC bez parametrów (najemca z sesji) i oddaje fakty v1", async () => {
    h.rpc.mockResolvedValue({ data: RAW_FACTS, error: null });
    const res = await getRevenueFacts();
    expect(h.rpc).toHaveBeenCalledWith("admin_revenue_facts", {});
    expect(res.state).toBe("ready");
    if (res.state !== "ready") return;
    expect(res.facts.v).toBe(1);
    expect(res.facts.areas.crm).toBeNull();
    expect(res.facts.areas.checkout?.abandonAfterMinutes).toBe(1440);
  });

  it("dokleja fakty TS z prawdziwych modułów (waluta prezentacji, kroki anulowania, katalog szyny)", async () => {
    h.rpc.mockResolvedValue({ data: RAW_FACTS, error: null });
    const res = await getRevenueFacts();
    if (res.state !== "ready") throw new Error(res.state);
    const presentation = res.facts.areas.checkout?.presentation ?? [];
    expect(presentation.map((p) => [p.lang, p.displayCurrency])).toEqual([
      ["pl", "PLN"],
      ["en", "PLN"],
    ]);
    expect(res.facts.areas.retention?.cancelPathSteps).toBe(RETENTION_DIALOG_STEPS.enabled);
    expect(res.facts.areas.sync?.unknownTypes).toEqual([]);
    expect(res.facts.areas.sync?.deadTypes).not.toContain("access_plan.changed.v1");
    expect(res.facts.areas.sync?.deadTypes?.length).toBeGreaterThan(0);
  });

  it.each([
    ["42501", "forbidden"],
    ["42883", "unavailable"],
    ["PGRST202", "unavailable"],
  ] as const)("błąd %s → stan %s (nie wyjątek)", async (code, state) => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "x", code } });
    await expect(getRevenueFacts()).resolves.toEqual({ state });
  });

  it("inny błąd bazy to wyjątek (ponawiany raz przez React Query)", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    await expect(getRevenueFacts()).rejects.toThrow("boom");
  });

  it("nieznana wersja faktów = zestaw pusty (każda reguła „nie wiadomo”)", async () => {
    h.rpc.mockResolvedValue({ data: { v: 2, areas: { crm: {} } }, error: null });
    const res = await getRevenueFacts();
    expect(res).toMatchObject({ state: "ready", facts: { v: 1, areas: {} } });
  });
});

describe("odmowa MFA z middleware (requireCrmStaff)", () => {
  it("komunikat bramki MFA rozpoznawany jako stan `mfa_required`, rola jako `forbidden`", () => {
    const staff = readFileSync(
      join(process.cwd(), "src/integrations/supabase/require-staff.ts"),
      "utf8",
    );
    const mfa = /`(Forbidden: mfa_required[^`]*)`/.exec(staff)?.[1];
    expect(mfa, "require-staff.ts nie rzuca już mfa_required").toBeDefined();
    const message = mfa!.replace(/\$\{[^}]+\}/g, "CRM staff");
    expect(middlewareDenial(new Error(message))).toBe("mfa_required");
    expect(middlewareDenial(new Error("Forbidden: CRM staff required"))).toBe("forbidden");
    expect(middlewareDenial(new Error("network down"))).toBeNull();
  });
});

describe("getRevenueSnoozes", () => {
  it("odczyt bez parametrów, tolerancyjny parser wierszy", async () => {
    h.rpc.mockResolvedValue({
      data: {
        snoozes: [
          {
            id: ID(1),
            checkId: "crm.auto_tasks_without_assignee",
            scopeKey: "*",
            kind: "days",
            until: "2026-11-01T00:00:00Z",
            reason: null,
            scopeHash: null,
            createdAt: "2026-10-20T10:00:00Z",
          },
          { id: ID(2), checkId: "crm.qualified_without_owner", kind: "forever" },
          "zły wiersz",
        ],
      },
      error: null,
    });
    const res = await getRevenueSnoozes();
    expect(h.rpc).toHaveBeenCalledWith("admin_revenue_diagnostic_snoozes", {});
    expect(res).toEqual({
      state: "ready",
      snoozes: [
        {
          id: ID(1),
          checkId: "crm.auto_tasks_without_assignee",
          scopeKey: "*",
          kind: "days",
          until: "2026-11-01T00:00:00Z",
          reason: null,
          scopeHash: null,
          createdAt: "2026-10-20T10:00:00Z",
        },
      ],
    });
  });

  it("brak listy albo nie-obiekt = brak wyciszeń", () => {
    expect(parseRevenueSnoozes(null)).toEqual([]);
    expect(parseRevenueSnoozes({ snoozes: "x" })).toEqual([]);
  });

  it("42501 → forbidden", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "forbidden", code: "42501" } });
    await expect(getRevenueSnoozes()).resolves.toEqual({ state: "forbidden" });
  });
});

describe("snoozeRevenueCheck - walidacja na REVENUE_LIMITS (odrzucenie, nie przycięcie)", () => {
  const future = (days: number) => new Date(Date.now() + days * DAY).toISOString();
  const days = (overrides: Record<string, unknown> = {}) => ({
    checkId: "crm.auto_tasks_without_assignee",
    kind: "days",
    until: future(7),
    ...overrides,
  });

  it("poprawne wyciszenie na czas: parametry p_*, zakres domyślny `*`, bez najemcy", async () => {
    h.rpc.mockResolvedValue({ data: { id: ID(1) }, error: null });
    const input = days();
    await expect(snoozeRevenueCheck({ data: input })).resolves.toEqual({ state: "ok" });
    expect(h.rpc).toHaveBeenCalledWith("admin_revenue_diagnostic_snooze", {
      p_check_id: "crm.auto_tasks_without_assignee",
      p_scope_key: "*",
      p_kind: "days",
      p_until: input.until,
      p_reason: null,
      p_scope_hash: null,
    });
    const args = h.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(args).some((k) => k.includes("tenant"))).toBe(false);
  });

  it.each([
    ["reguła spoza rejestru", days({ checkId: "catalog.nie_ma_takiej" }), "check_id_invalid"],
    ["zły wzorzec identyfikatora", days({ checkId: "Catalog-x" }), "check_id_invalid"],
    ["reguła niewyciszalna", days({ checkId: "sync.emit_errors" }), "not_snoozable"],
    [
      "reguła niewyciszalna (księga)",
      days({ checkId: "data_quality.ledger_drift" }),
      "not_snoozable",
    ],
    ["termin w przeszłości", days({ until: future(-1) }), "until_invalid"],
    ["brak terminu przy `days`", days({ until: null }), "until_invalid"],
    [
      "termin ponad 180 dni",
      days({ until: future(REVENUE_LIMITS.snoozeMaxDays + 1) }),
      "until_too_far",
    ],
    [
      "powód za długi o znak",
      days({ reason: "x".repeat(REVENUE_LIMITS.snoozeReasonMax + 1) }),
      "reason_invalid",
    ],
    ["powód z samych spacji", days({ reason: "      " }), "reason_invalid"],
    [
      "świadomie bez odcisku",
      { checkId: "crm.auto_tasks_without_assignee", kind: "intentional", reason: "Tak ma być" },
      "scope_hash_required",
    ],
    [
      "świadomie bez powodu",
      { checkId: "crm.auto_tasks_without_assignee", kind: "intentional", scopeHash: "f1:0a0b0c0d" },
      "reason_required",
    ],
  ])("%s → odrzucone (%s), RPC niewołane", async (_label, input, code) => {
    await expect(snoozeRevenueCheck({ data: input })).rejects.toThrow(code);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("zakres i odcisk ponad limit są ODRZUCANE, nie przycinane", () => {
    const longScope = SnoozeInput.safeParse(
      days({ scopeKey: "k".repeat(REVENUE_LIMITS.scopeKeyMax + 1) }),
    );
    expect(longScope.success).toBe(false);
    const longHash = SnoozeInput.safeParse({
      checkId: "crm.auto_tasks_without_assignee",
      kind: "intentional",
      reason: "Tak ma być",
      scopeHash: "h".repeat(REVENUE_LIMITS.scopeHashMax + 1),
    });
    expect(longHash.success).toBe(false);
    // Na granicy - przechodzi bez zmian.
    const edge = SnoozeInput.parse(
      days({
        scopeKey: "k".repeat(REVENUE_LIMITS.scopeKeyMax),
        reason: "r".repeat(REVENUE_LIMITS.snoozeReasonMax),
      }),
    );
    expect(edge.scopeKey).toHaveLength(REVENUE_LIMITS.scopeKeyMax);
    expect(edge.reason).toHaveLength(REVENUE_LIMITS.snoozeReasonMax);
  });

  it("świadome wyciszenie z odciskiem i powodem przechodzi", async () => {
    h.rpc.mockResolvedValue({ data: { id: ID(1) }, error: null });
    await snoozeRevenueCheck({
      data: {
        checkId: "catalog.not_for_sale_still_visible",
        kind: "intentional",
        reason: "Warstwa na zapytanie",
        scopeHash: "f1:0a0b0c0d",
      },
    });
    expect(h.rpc.mock.calls[0]![1]).toMatchObject({
      p_kind: "intentional",
      p_until: null,
      p_reason: "Warstwa na zapytanie",
      p_scope_hash: "f1:0a0b0c0d",
    });
  });

  it("redaktor: SQL odmawia (42501) → stan `forbidden`", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "forbidden", code: "42501" } });
    await expect(snoozeRevenueCheck({ data: days() })).resolves.toEqual({ state: "forbidden" });
  });

  it("22023 ze znanym kodem → stan `invalid`; nieznany kod → wyjątek", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "until_too_far", code: "22023" } });
    await expect(snoozeRevenueCheck({ data: days() })).resolves.toEqual({
      state: "invalid",
      code: "until_too_far",
    });
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "coś innego", code: "22023" } });
    await expect(snoozeRevenueCheck({ data: days() })).rejects.toThrow("coś innego");
  });

  it("brak funkcji w bazie → `unavailable`", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "x", code: "PGRST202" } });
    await expect(snoozeRevenueCheck({ data: days() })).resolves.toEqual({ state: "unavailable" });
  });
});

describe("unsnoozeRevenueCheck", () => {
  it("zakres domyślny `*`, wynik `removed` z RPC", async () => {
    h.rpc.mockResolvedValue({ data: { removed: true }, error: null });
    await expect(
      unsnoozeRevenueCheck({ data: { checkId: "crm.auto_tasks_without_assignee" } }),
    ).resolves.toEqual({ state: "ok", removed: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_revenue_diagnostic_unsnooze", {
      p_check_id: "crm.auto_tasks_without_assignee",
      p_scope_key: "*",
    });
  });

  it("brak wyciszenia = `removed: false`, nie błąd", async () => {
    h.rpc.mockResolvedValue({ data: { removed: false }, error: null });
    await expect(
      unsnoozeRevenueCheck({ data: { checkId: "crm.auto_tasks_without_assignee" } }),
    ).resolves.toEqual({ state: "ok", removed: false });
  });

  it("reguła spoza rejestru odrzucona przed RPC", async () => {
    await expect(unsnoozeRevenueCheck({ data: { checkId: "x.y" } })).rejects.toThrow(
      "check_id_invalid",
    );
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("enrichRevenueFacts - fakty TS (czysta funkcja)", () => {
  const deps = (overrides: Partial<RevenueFactsDeps> = {}): RevenueFactsDeps => ({
    isEnforcedCapability: (key) => key === "reports",
    planDisplayCurrency: (currency) => currency.toUpperCase(),
    replacesWorkflowTemplate: (key) => (key === "cancel_scheduled_save" ? "cancel-recipe" : null),
    actionEmits: (type) => (type === "create_crm_task" ? ["crm_task.created.v1"] : []),
    domainEventTypes: ["access_plan.changed.v1", "crm_task.created.v1"],
    benchmarkPublished: ["2026-01", "2023-05", "2019"],
    ageMonths: (published, asOf) => {
      const [py, pm = "12"] = published.split("-");
      const [ry, rm] = asOf.split("-");
      return Number(ry) * 12 + Number(rm) - (Number(py) * 12 + Number(pm));
    },
    staleSourceMonths: 18,
    ...overrides,
  });

  const facts = (areas: Record<string, unknown>): RevenueFacts =>
    parseRevenueFacts({ v: 1, computedAt: "2026-10-20T12:00:00.000Z", areas });

  const tier = (key: string, featureKeys: string[], capabilityKeys: string[], extra = {}) => ({
    id: ID(10),
    key,
    rank: 2,
    active: true,
    pricingVisible: true,
    isDefault: false,
    ctaMode: "auto",
    plansForSale: 1,
    plansNotForSale: 0,
    featureKeys,
    capabilityKeys,
    ...extra,
  });

  it("obietnice: brak flagi = `broken`, flaga bez bramki = `decorative`; nieaktywna warstwa pominięta", () => {
    const out = enrichRevenueFacts(
      facts({
        catalog: {
          tiers: [
            tier("pro", ["reports", "gifts"], ["reports", "gifts", "team"]),
            tier("old", [], ["team"], { active: false }),
          ],
        },
      }),
      deps(),
      NOW_MS,
    );
    expect(out.areas.catalog?.promiseGaps).toEqual({
      broken: [{ tierKey: "pro", capability: "team", offerable: true }],
      decorative: [{ tierKey: "pro", capability: "gifts", offerable: true }],
    });
  });

  it("prezentacja: waluta cennika per język vs waluty obciążenia planów w sprzedaży", () => {
    const out = enrichRevenueFacts(
      facts({ checkout: { chargeCurrencies: ["PLN"] } }),
      deps(),
      NOW_MS,
    );
    expect(out.areas.checkout?.presentation).toEqual([
      { lang: "pl", displayCurrency: "PLN", chargeCurrencies: ["PLN"] },
      { lang: "en", displayCurrency: "PLN", chargeCurrencies: ["PLN"] },
    ]);
  });

  it("kroki anulowania: przepływ włączony = 2, bez przepływu = 1; bez wiersza ustawień - nie wiadomo", () => {
    const on = enrichRevenueFacts(
      facts({ retention: { settingsRow: true, enabled: true } }),
      deps(),
      NOW_MS,
    );
    const off = enrichRevenueFacts(facts({ retention: { settingsRow: false } }), deps(), NOW_MS);
    const unknown = enrichRevenueFacts(facts({ retention: {} }), deps(), NOW_MS);
    expect(on.areas.retention?.cancelPathSteps).toBe(2);
    expect(off.areas.retention?.cancelPathSteps).toBe(1);
    expect(unknown.areas.retention?.cancelPathSteps).toBeUndefined();
  });

  it("przepisy vs ścieżki: zastąpiony szablon = duplikat, ten sam wyzwalacz = wspólny", () => {
    const out = enrichRevenueFacts(
      facts({
        workflows: {
          enabled: [
            {
              id: ID(30),
              templateKey: "cancel-recipe",
              trigger: "billing_subscription.cancel_scheduled.v1",
            },
            { id: ID(31), templateKey: null, trigger: "account.registered.v1" },
          ],
        },
        journeys: {
          graphs: [
            {
              id: ID(40),
              templateKey: "cancel_scheduled_save",
              trigger: "billing_subscription.cancel_scheduled.v1",
              reentry: "never",
              nodeTypes: [],
            },
            {
              id: ID(41),
              templateKey: null,
              trigger: "account.registered.v1",
              reentry: "never",
              nodeTypes: [],
            },
          ],
        },
      }),
      deps(),
      NOW_MS,
    );
    expect(out.areas.workflows?.overlaps).toEqual({
      duplicates: [{ workflowId: ID(30), journeyId: ID(40) }],
      sharedTrigger: [{ workflowId: ID(31), journeyId: ID(41) }],
    });
  });

  it("cykle wyzwalaczy: pętla z ponownym wejściem = nieograniczona, bez - ograniczona", () => {
    const graph = (id: number, trigger: string, reentry: string, nodeTypes: string[]) => ({
      id: ID(id),
      templateKey: null,
      trigger,
      reentry,
      nodeTypes,
    });
    const looping = enrichRevenueFacts(
      facts({
        journeys: {
          graphs: [
            graph(50, "crm_task.created.v1", "always", ["create_crm_task"]),
            graph(51, "account.registered.v1", "never", ["create_crm_task"]),
          ],
        },
      }),
      deps(),
      NOW_MS,
    );
    expect(looping.areas.journeys?.cycles).toEqual({ bounded: 0, unbounded: 1, refs: [ID(50)] });
    const bounded = enrichRevenueFacts(
      facts({
        journeys: { graphs: [graph(52, "crm_task.created.v1", "never", ["create_crm_task"])] },
      }),
      deps(),
      NOW_MS,
    );
    expect(bounded.areas.journeys?.cycles).toEqual({ bounded: 1, unbounded: 0, refs: [ID(52)] });
  });

  it("katalog szyny: typ bez zdarzeń = martwy, typ spoza katalogu = dryf", () => {
    const out = enrichRevenueFacts(
      facts({ sync: { seenTypes90d: ["access_plan.changed.v1", "legacy.thing.v0"] } }),
      deps(),
      NOW_MS,
    );
    expect(out.areas.sync?.deadTypes).toEqual(["crm_task.created.v1"]);
    expect(out.areas.sync?.unknownTypes).toEqual(["legacy.thing.v0"]);
  });

  it("źródła benchmarków starsze niż próg S6 (18 mies.) liczone względem `computedAt`", () => {
    const out = enrichRevenueFacts(facts({ data_quality: {} }), deps(), NOW_MS);
    expect(out.areas.data_quality?.benchmarkSources).toEqual({ total: 3, stale: 2 });
  });

  it("obszar `null` albo nieobecny zostaje nietknięty (nie wiadomo)", () => {
    const out = enrichRevenueFacts(facts({ catalog: null }), deps(), NOW_MS);
    expect(out.areas.catalog).toBeNull();
    expect(out.areas.checkout).toBeUndefined();
  });

  it("awaria jednej zależności zostawia jej pole nieobecne, resztę liczy", () => {
    const out = enrichRevenueFacts(
      facts({ checkout: { chargeCurrencies: ["PLN"] }, sync: { seenTypes90d: [] } }),
      deps({
        planDisplayCurrency: () => {
          throw new Error("moduł waluty");
        },
      }),
      NOW_MS,
    );
    expect(out.areas.checkout?.presentation).toBeUndefined();
    expect(out.areas.sync?.deadTypes).toHaveLength(2);
  });
});
