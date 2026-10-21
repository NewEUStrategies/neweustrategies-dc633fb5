// Zapytania, ocena i mutatory diagnostyki (S7, SPEC §5.4, Z-S6-08).
//
// Czego pilnuje: jeden klucz z fabryki (`revenueKeys.facts/snoozes`) dla
// zakładki, karty Kokpitu, licznika paska i chipu w modułach; czasy cache
// z kontraktu (30 s / 10 min, `retry: 1`, bez odpytywania); odmowa
// z middleware (rola, MFA) jako stan karty; licznik paska = otwarte
// krytyczne i ważne BEZ obowiązujących wyciszeń; mutatory wyciszeń
// odświeżają fakty i wyciszenia.
import { act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { revenueKeys } from "@/lib/revenue/keys";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  getRevenueFacts: vi.fn(),
  getRevenueSnoozes: vi.fn(),
  snoozeRevenueCheck: vi.fn(),
  unsnoozeRevenueCheck: vi.fn(),
}));

vi.mock("../diagnostics.functions", () => h);

import type { RevenueFacts } from "../facts";
import {
  diagnosticsBadgeCount,
  evaluateAreaFindings,
  evaluateFindings,
  FACTS_GC_MS,
  FACTS_STALE_MS,
  middlewareDenial,
  revenueFactsQueryOptions,
  revenueSnoozesQueryOptions,
  selectFactsForAreas,
  snoozeInvalidationKeys,
  useDiagnosticsBadgeCount,
  useSnoozeRevenueCheck,
  useUnsnoozeRevenueCheck,
} from "../queries";
import { REVENUE_CHECKS, type RevenueFinding, type RevenueSnooze } from "../registry";
import { findingsForAreas, signalSummary, SIGNAL_SURFACES } from "../surfaces";

const T = "tenant-a";
const NOW = "2026-10-20T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

/**
 * Fakty z trzema otwartymi problemami o różnej wadze: krytyczny (licznik bez
 * wiersza), ważny (zadania CRM bez osoby) i informacyjny (lead bez konta).
 */
const FACTS: RevenueFacts = {
  v: 1,
  computedAt: NOW,
  areas: {
    metering: { settingsRow: false, meteredRules: 2 },
    crm: {
      autoTasksUnassigned: { open: 3, overdue: 1 },
      withoutUserId: { registered: 1, customer: 0 },
      qualifiedWithoutOwner: { mqlSql: 0, opportunity: 0 },
    },
  },
};

function snooze(checkId: string, overrides: Partial<RevenueSnooze> = {}): RevenueSnooze {
  return {
    id: `s-${checkId}`,
    checkId,
    scopeKey: "*",
    kind: "days",
    until: new Date(NOW_MS + 86_400_000).toISOString(),
    reason: null,
    scopeHash: null,
    createdAt: NOW,
    ...overrides,
  };
}

const byId = (findings: RevenueFinding[], id: string) => findings.find((f) => f.checkId === id)!;

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
});

describe("queryOptions faktów i wyciszeń", () => {
  it("klucze z fabryki revenueKeys - ten sam wpis dla zakładki, karty, paska i chipu", () => {
    expect(revenueFactsQueryOptions(T).queryKey).toEqual(revenueKeys.facts(T));
    expect(revenueSnoozesQueryOptions(T).queryKey).toEqual(revenueKeys.snoozes(T));
  });

  it("czasy z kontraktu: 30 s świeżości, 10 min w cache, jedno ponowienie, bez odpytywania", () => {
    for (const options of [revenueFactsQueryOptions(T), revenueSnoozesQueryOptions(T)]) {
      expect(options.staleTime).toBe(FACTS_STALE_MS);
      expect(FACTS_STALE_MS).toBe(30_000);
      expect(options.gcTime).toBe(FACTS_GC_MS);
      expect(FACTS_GC_MS).toBe(10 * 60_000);
      expect(options.retry).toBe(1);
      expect("refetchInterval" in options).toBe(false);
    }
  });

  it("bez najemcy albo bez roli zapytanie jest wyłączone", () => {
    expect(revenueFactsQueryOptions(null).enabled).toBe(false);
    expect(revenueFactsQueryOptions(T, { roleOk: false }).enabled).toBe(false);
    expect(revenueFactsQueryOptions(T, { roleOk: true }).enabled).toBe(true);
    expect(revenueSnoozesQueryOptions(null).enabled).toBe(false);
  });

  it("queryFn: odpowiedź server fn przechodzi bez zmian", async () => {
    h.getRevenueFacts.mockResolvedValue({ state: "ready", facts: FACTS });
    const qc = new QueryClient();
    await expect(qc.fetchQuery(revenueFactsQueryOptions(T))).resolves.toEqual({
      state: "ready",
      facts: FACTS,
    });
  });

  it.each([
    [
      "Forbidden: mfa_required - verify your second factor (aal2) to perform CRM staff actions",
      "mfa_required",
    ],
    ["Forbidden: CRM staff required", "forbidden"],
  ])("odmowa middleware „%s” → stan %s (karta, nie toast)", async (message, state) => {
    h.getRevenueFacts.mockRejectedValue(new Error(message));
    h.getRevenueSnoozes.mockRejectedValue(new Error(message));
    const qc = new QueryClient();
    await expect(qc.fetchQuery(revenueFactsQueryOptions(T))).resolves.toEqual({ state });
    await expect(qc.fetchQuery(revenueSnoozesQueryOptions(T))).resolves.toEqual({ state });
  });

  it("inny wyjątek wraca jako błąd zapytania", async () => {
    h.getRevenueFacts.mockRejectedValue(new Error("network down"));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await expect(qc.fetchQuery({ ...revenueFactsQueryOptions(T), retry: false })).rejects.toThrow(
      "network down",
    );
    expect(middlewareDenial("x")).toBeNull();
  });
});

describe("evaluateFindings i wybór po obszarach", () => {
  it("jedna diagnoza na regułę rejestru; brak faktów obszaru = unknown", () => {
    const findings = evaluateFindings(FACTS, [], NOW_MS);
    expect(findings).toHaveLength(REVENUE_CHECKS.length);
    expect(byId(findings, "metering.settings_row_missing").state).toBe("error");
    expect(byId(findings, "crm.auto_tasks_without_assignee").state).toBe("error");
    expect(byId(findings, "catalog.plan_without_tier").state).toBe("unknown");
  });

  it("wyciszenie obowiązujące przypina się do diagnozy, wygasłe - nie", () => {
    const active = evaluateFindings(FACTS, [snooze("crm.auto_tasks_without_assignee")], NOW_MS);
    expect(byId(active, "crm.auto_tasks_without_assignee").snooze?.id).toBe(
      "s-crm.auto_tasks_without_assignee",
    );
    const expired = evaluateFindings(
      FACTS,
      [snooze("crm.auto_tasks_without_assignee", { until: "2026-10-01T00:00:00.000Z" })],
      NOW_MS,
    );
    expect(byId(expired, "crm.auto_tasks_without_assignee").snooze).toBeNull();
  });

  it("select chipu zostawia wyłącznie wskazane obszary; odmowa przechodzi bez zmian", () => {
    const select = selectFactsForAreas(["crm"]);
    const scoped = select({ state: "ready", facts: FACTS });
    expect(scoped.state === "ready" && Object.keys(scoped.facts.areas)).toEqual(["crm"]);
    expect(select({ state: "forbidden" })).toEqual({ state: "forbidden" });
  });

  it("evaluateAreaFindings ocenia tylko reguły obszarów chipu", () => {
    const findings = evaluateAreaFindings(FACTS, [], ["crm", "dunning"], NOW_MS);
    expect(new Set(findings.map((f) => f.area))).toEqual(new Set(["crm", "dunning"]));
    expect(findings).toHaveLength(
      REVENUE_CHECKS.filter((c) => c.area === "crm" || c.area === "dunning").length,
    );
  });

  it("powierzchnie modułów: obszary to obszary huba, chip liczy otwarte i „nie wiadomo”", () => {
    const findings = evaluateFindings(FACTS, [], NOW_MS);
    const crm = findingsForAreas(findings, SIGNAL_SURFACES.crm);
    expect(crm.map((f) => f.checkId)).toEqual([
      "crm.auto_tasks_without_assignee",
      "crm.leads_without_user_id",
    ]);
    expect(signalSummary(findings, SIGNAL_SURFACES.crm)).toEqual({
      open: 2,
      critical: 0,
      warning: 1,
      info: 1,
      worst: "warning",
      unknown: 1,
    });
    expect(signalSummary(findings, ["catalog"]).worst).toBeNull();
  });
});

describe("licznik paska Diagnostyki (Z-S6-08)", () => {
  it("otwarte krytyczne + ważne; informacyjne, wyciszone, ok i unknown się nie liczą", () => {
    expect(diagnosticsBadgeCount(evaluateFindings(FACTS, [], NOW_MS))).toBe(2);
    expect(
      diagnosticsBadgeCount(
        evaluateFindings(FACTS, [snooze("crm.auto_tasks_without_assignee")], NOW_MS),
      ),
    ).toBe(1);
    expect(
      diagnosticsBadgeCount(evaluateFindings({ v: 1, computedAt: NOW, areas: {} }, [], NOW_MS)),
    ).toBe(0);
  });

  it("hak: `null` do czasu faktów, potem liczba z aktywnymi wyciszeniami z tego samego cache", async () => {
    h.getRevenueFacts.mockResolvedValue({ state: "ready", facts: FACTS });
    h.getRevenueSnoozes.mockResolvedValue({
      state: "ready",
      snoozes: [snooze("crm.auto_tasks_without_assignee", { until: "2099-01-01T00:00:00.000Z" })],
    });
    const { result, queryClient } = renderHookWithQueryClient(() => useDiagnosticsBadgeCount(T));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(1));
    expect(queryClient.getQueryData(revenueKeys.facts(T))).toMatchObject({ state: "ready" });
  });

  it("hak: odmowa albo brak najemcy = `null` (pasek nie pokazuje fałszywego 0)", async () => {
    h.getRevenueFacts.mockResolvedValue({ state: "forbidden" });
    h.getRevenueSnoozes.mockResolvedValue({ state: "forbidden" });
    const denied = renderHookWithQueryClient(() => useDiagnosticsBadgeCount(T));
    await waitFor(() => expect(h.getRevenueFacts).toHaveBeenCalled());
    expect(denied.result.current).toBeNull();
    const noTenant = renderHookWithQueryClient(() => useDiagnosticsBadgeCount(null));
    expect(noTenant.result.current).toBeNull();
    expect(
      noTenant.queryClient.getQueryCache().find({ queryKey: revenueKeys.facts("") })?.state
        .fetchStatus,
    ).not.toBe("fetching");
  });
});

describe("mutatory wyciszeń", () => {
  it("klucze odświeżane po zmianie: fakty i wyciszenia najemcy", () => {
    expect(snoozeInvalidationKeys(T)).toEqual([revenueKeys.facts(T), revenueKeys.snoozes(T)]);
  });

  it("wyciszenie woła server fn i unieważnia fakty + wyciszenia", async () => {
    h.snoozeRevenueCheck.mockResolvedValue({ state: "ok" });
    const { result, queryClient } = renderHookWithQueryClient(() => useSnoozeRevenueCheck(T));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const input = {
      checkId: "crm.auto_tasks_without_assignee",
      kind: "days" as const,
      until: "2026-10-27T12:00:00.000Z",
    };
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    expect(h.snoozeRevenueCheck).toHaveBeenCalledWith({ data: input });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: revenueKeys.facts(T) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: revenueKeys.snoozes(T) });
  });

  it("zdjęcie wyciszenia: zakres domyślny `*` i te same inwalidacje (także po odmowie)", async () => {
    h.unsnoozeRevenueCheck.mockResolvedValue({ state: "forbidden" });
    const { result, queryClient } = renderHookWithQueryClient(() => useUnsnoozeRevenueCheck(T));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync({ checkId: "crm.auto_tasks_without_assignee" });
    });
    expect(h.unsnoozeRevenueCheck).toHaveBeenCalledWith({
      data: { scopeKey: "*", checkId: "crm.auto_tasks_without_assignee" },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: revenueKeys.facts(T) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: revenueKeys.snoozes(T) });
  });

  it("bez najemcy mutacja nie unieważnia cudzych kluczy", async () => {
    h.snoozeRevenueCheck.mockResolvedValue({ state: "ok" });
    const { result, queryClient } = renderHookWithQueryClient(() => useSnoozeRevenueCheck(null));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync({
        checkId: "crm.auto_tasks_without_assignee",
        kind: "days",
        until: "2026-10-27T12:00:00.000Z",
      });
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
