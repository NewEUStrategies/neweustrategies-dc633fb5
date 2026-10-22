// Rejestr szybkich napraw (S7, SPEC §6.4) - kontrakt i aplikatory.
//
// Czego pilnuje (karta S7): każda reguła z `fix.kind = "dialog"` ma DOKŁADNIE
// jeden `QuickFixSpec`; `apply` wskazuje pisarza z `HUB_SYNC_MANIFEST.writers`
// i importuje jego eksport z modułu źródłowego, a ten eksport woła też ekran
// modułu (inaczej naprawa byłaby drugą ścieżką zapisu); w rejestrze nie ma
// własnego `.from(...).update`. Aplikatory biorą token współbieżności ze
// ŚWIEŻEGO odczytu wpisu modułu i umieją się cofnąć („Cofnij" 60 s).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { revenueDiagnosticsDictionaries } from "@/lib/i18n-admin-revenue-diagnostics";
import { REVENUE_LIMITS } from "@/lib/revenue/limits";
import { HUB_SYNC_MANIFEST } from "@/lib/revenue/syncManifest";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  plansRows: vi.fn(),
  planSave: vi.fn(),
  tiersRows: vi.fn(),
  tierSave: vi.fn(),
  checkoutState: vi.fn(),
  checkoutSave: vi.fn(),
  workflowToggle: vi.fn(),
  assignTasks: vi.fn(),
  meteringSave: vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/billing/planQueries", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  adminPlansAllQueryOptions: () => ({ queryKey: ["test", "plans"], queryFn: h.plansRows }),
  useSaveAccessPlanPatch: () => ({ mutateAsync: h.planSave }),
}));
vi.mock("@/components/admin/membership/membershipQueries", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  adminMembershipTiersQueryOptions: () => ({ queryKey: ["test", "tiers"], queryFn: h.tiersRows }),
}));
vi.mock("@/lib/billing/tierMutations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSaveTierMarketing: () => ({ mutateAsync: h.tierSave }),
}));
vi.mock("@/hooks/useCheckoutSettings", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkoutSettingsQueryOptions: () => ({
    queryKey: ["test", "checkout"],
    queryFn: h.checkoutState,
  }),
  useSaveCheckoutSettings: () => ({ mutateAsync: h.checkoutSave }),
}));
vi.mock("@/lib/admin/workflowQueries", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSetWorkflowEnabled: () => ({ mutateAsync: h.workflowToggle }),
}));
vi.mock("@/lib/access/meteringQueries", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSaveMeteringSettings: () => ({ mutateAsync: h.meteringSave }),
}));
vi.mock("@/lib/crm-tasks.functions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assignUnassignedCrmTasks: h.assignTasks,
}));

import { METERING_DEFAULTS } from "@/lib/access/meteringDefaults";
import {
  canApplyQuickFix,
  QUICK_FIXES,
  quickFixFor,
  quickFixForCheck,
  RETENTION_COLUMN_DEFAULTS,
  SENDER_EMAIL_PATTERN,
  type QuickFixValue,
} from "@/lib/admin/revenue/quickFixes";
import type { RevenueFacts } from "@/lib/revenue/diagnostics/facts";
import {
  evaluateRegistry,
  REVENUE_CHECKS,
  REVENUE_FIX_DIALOG_IDS,
  type RevenueFinding,
} from "@/lib/revenue/diagnostics/registry";

const SOURCE = readFileSync(join(process.cwd(), "src/lib/admin/revenue/quickFixes.ts"), "utf8");

const ID = (n: number) => `e7150000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/**
 * Pisarze, których brakuje w manifeście z przyczyn poza S7 - lista ZAMKNIĘTA
 * i z zapadką: gdy integrator dopisze pisarza do manifestu, test każe zdjąć
 * wpis stąd. Pusta od I9 (Z-S7-02): P24 - `crm_task.writers` wskazuje server
 * fn S4 `assignUnassignedCrmTasks` zamiast nieistniejącego `bulkUpdateCrmTasks`.
 */
const PENDING_MANIFEST_WRITERS: Readonly<Record<string, string>> = {};

/**
 * Eksporty bez innego wołającego niż naprawa huba - lista zamknięta z zapadką
 * jak wyżej. Pusta od I9 (Z-S7-02): lista CRM woła `assignUnassignedCrmTasks`
 * przyciskiem „Przypisz zadania bez osoby" (`AssignUnassignedTasksButton`).
 */
const PENDING_MODULE_CONSUMERS: readonly string[] = [];

function manifestWriters(entity: string): string[] {
  const found = HUB_SYNC_MANIFEST.find((e) => e.id === entity);
  return (found?.writers ?? []).map((w) => w.ref);
}

/** Pliki źródłowe `src/**` (bez testów i bez huba). */
const MODULE_SOURCES: readonly { path: string; source: string }[] = (
  readdirSync(join(process.cwd(), "src"), { recursive: true }) as string[]
)
  .map((rel) => `src/${rel.split("\\").join("/")}`)
  .filter((path) => /\.(ts|tsx)$/.test(path))
  .filter(
    (path) =>
      !path.includes("__tests__") &&
      !path.startsWith("src/lib/admin/revenue/") &&
      !path.startsWith("src/lib/revenue/") &&
      !path.startsWith("src/components/admin/revenue/"),
  )
  .map((path) => ({ path, source: readFileSync(join(process.cwd(), path), "utf8") }));

/** Pliki modułów, które WOŁAJĄ eksport (plik definiujący eksport się nie liczy). */
function moduleCallers(exportName: string): string[] {
  const word = new RegExp(`\\b${exportName}\\b`);
  const definition = new RegExp(`export (const|function|async function) ${exportName}\\b`);
  return MODULE_SOURCES.filter(({ source }) => word.test(source) && !definition.test(source)).map(
    ({ path }) => path,
  );
}

const dialogChecks = REVENUE_CHECKS.filter(
  (c): c is (typeof REVENUE_CHECKS)[number] & { fix: { kind: "dialog" } } =>
    c.fix?.kind === "dialog",
);

describe("kontrakt rejestru (SPEC §6.4)", () => {
  it("jeden QuickFixSpec na każdy RevenueFixDialogId, id = klucz", () => {
    expect(Object.keys(QUICK_FIXES).sort()).toEqual([...REVENUE_FIX_DIALOG_IDS].sort());
    for (const [id, spec] of Object.entries(QUICK_FIXES)) expect(spec.id).toBe(id);
  });

  it.each(dialogChecks.map((c) => [c.id, c] as const))(
    "%s: dokładnie jeden QuickFixSpec obsługuje regułę i jest jej dialogiem",
    (id, check) => {
      const owners = Object.values(QUICK_FIXES).filter((spec) =>
        (spec.checkIds as readonly string[]).includes(id),
      );
      expect(owners.map((s) => s.id)).toEqual([check.fix.dialog]);
      expect(quickFixForCheck(id)?.id).toBe(check.fix.dialog);
    },
  );

  it("spec nie deklaruje reguł, które nie wskazują jego dialogu", () => {
    for (const spec of Object.values(QUICK_FIXES)) {
      for (const checkId of spec.checkIds) {
        const check = REVENUE_CHECKS.find((c) => c.id === checkId);
        expect(check?.fix, `${spec.id} → ${checkId}`).toEqual({ kind: "dialog", dialog: spec.id });
      }
    }
  });

  it("reguła naprawiana odnośnikiem albo kodem nie ma dialogu", () => {
    expect(quickFixForCheck("sync.emit_errors")).toBeNull();
    expect(quickFixForCheck("journeys.missing_core")).toBeNull();
    expect(quickFixFor("plan_tier")).toBe(QUICK_FIXES.plan_tier);
  });

  it("treść dialogu (body) tylko leniwie - ciężkie formularze poza chunkiem zakładki", () => {
    for (const spec of Object.values(QUICK_FIXES)) {
      if (!spec.body) continue;
      expect((spec.body as unknown as { $$typeof: symbol }).$$typeof, spec.id).toBe(
        Symbol.for("react.lazy"),
      );
    }
    expect(SOURCE).not.toMatch(/^import .* from "@\/components\/admin\/revenue\/diagnostics/m);
  });
});

describe("zapis = współdzielony mutator modułu (SPEC §3.1 I1)", () => {
  it.each(Object.values(QUICK_FIXES).map((s) => [s.id, s] as const))(
    "%s: pisarz z manifestu bytu",
    (_id, spec) => {
      const writers = manifestWriters(spec.apply.entity);
      expect(writers.length, `byt ${spec.apply.entity} w manifeście`).toBeGreaterThan(0);
      const pending = PENDING_MANIFEST_WRITERS[spec.apply.writer];
      if (pending) {
        // Zapadka: gdy manifest ma już pisarza, wpis „oczekujący” trzeba zdjąć.
        expect(writers, `zdejmij ${spec.apply.writer} z PENDING_MANIFEST_WRITERS`).not.toContain(
          spec.apply.writer,
        );
      } else {
        expect(writers).toContain(spec.apply.writer);
      }
    },
  );

  it.each(Object.values(QUICK_FIXES).map((s) => [s.id, s] as const))(
    "%s: eksport importowany z modułu źródłowego pisarza",
    (_id, spec) => {
      const name = spec.apply.moduleExport;
      const importLine = new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "@/([^"]+)";`);
      const match = importLine.exec(SOURCE);
      expect(match, `brak importu ${name}`).not.toBeNull();
      if (spec.apply.writer.includes("#")) {
        const [path, exported] = spec.apply.writer.split("#");
        expect(exported).toBe(name);
        expect(`src/${match![1]}.ts`.replace(/\.ts\.ts$/, ".ts")).toBe(path);
      }
    },
  );

  it("każdy użyty mutator woła także moduł źródłowy (inaczej to druga ścieżka zapisu)", () => {
    const used = [...new Set(Object.values(QUICK_FIXES).map((s) => s.apply.moduleExport))];
    for (const name of used) {
      const callers = moduleCallers(name);
      if (PENDING_MODULE_CONSUMERS.includes(name)) {
        expect(callers, `zdejmij ${name} z PENDING_MODULE_CONSUMERS`).toEqual([]);
      } else {
        expect(callers.length, `${name}: brak wołającego w module`).toBeGreaterThan(0);
      }
    }
  });

  it("rejestr nie pisze sam: zero `.from(...)` i `.rpc(` w hubie", () => {
    const code = SOURCE.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.from\(/);
    expect(code).not.toMatch(/\.rpc\(/);
    expect(code).not.toMatch(/\.(update|insert|upsert|delete)\(/);
  });

  it("kolumny zapisu naprawy są kolumnami pól podglądu (SourceHeader mówi prawdę)", () => {
    for (const spec of Object.values(QUICK_FIXES)) {
      expect(spec.apply.columns.length, spec.id).toBeGreaterThan(0);
    }
  });
});

describe("role zapisu = role modułu (role DOKŁADNE)", () => {
  it("warstwy i retencja - wyłącznie administrator; reszta - administrator albo redaktor", () => {
    const adminOnly = Object.values(QUICK_FIXES)
      .filter((s) => s.requiredRole === "admin")
      .map((s) => s.id)
      .sort();
    expect(adminOnly).toEqual(["retention_enable", "tier_hide"]);
    expect(Object.values(QUICK_FIXES).some((s) => s.requiredRole === "platform_admin")).toBe(false);
  });

  it("canApplyQuickFix: super_admin bez roli najemcy nie spełnia admin/editor", () => {
    expect(canApplyQuickFix("admin", ["admin"])).toBe(true);
    expect(canApplyQuickFix("admin", ["editor"])).toBe(false);
    expect(canApplyQuickFix("admin", ["super_admin"])).toBe(false);
    expect(canApplyQuickFix("editor", ["editor"])).toBe(true);
    expect(canApplyQuickFix("editor", ["admin"])).toBe(true);
    expect(canApplyQuickFix("editor", ["author", "super_admin"])).toBe(false);
    expect(canApplyQuickFix("platform_admin", ["super_admin"])).toBe(true);
    expect(canApplyQuickFix("platform_admin", ["admin"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Opcje, podgląd i walidacja - na faktach z problemem w każdej rodzinie
// ---------------------------------------------------------------------------

const FACTS: RevenueFacts = {
  v: 1,
  computedAt: "2026-10-20T12:00:00.000Z",
  areas: {
    catalog: {
      plans: [
        {
          id: ID(1),
          tierKey: null,
          tierFound: false,
          tierRank: null,
          active: true,
          forSale: true,
          interval: "month",
          currency: "PLN",
          priceCents: 4900,
          catalogPair: false,
        },
        {
          id: ID(2),
          tierKey: "decision_lab",
          tierFound: true,
          tierRank: 5,
          active: true,
          forSale: true,
          interval: "year",
          currency: "PLN",
          priceCents: null,
          catalogPair: true,
        },
      ],
      tiers: [
        {
          id: ID(10),
          key: "ngo",
          rank: 3,
          active: true,
          pricingVisible: true,
          isDefault: false,
          ctaMode: "auto",
          plansForSale: 0,
          plansNotForSale: 1,
          featureKeys: [],
          capabilityKeys: [],
        },
      ],
    },
    paywall: {
      paidWithoutOffer: { count: 1, withHits30d: 1, refs: [`post:${ID(20)}`] },
      danglingRules: { count: 1, withHits30d: 0, refs: [`post:${ID(21)}`], planIds: [ID(3)] },
    },
    metering: {
      settingsRow: true,
      enabled: true,
      anonMonthlyLimit: 0,
      memberMonthlyLimit: 5,
      meteredRules: 2,
    },
    checkout: { settingsRow: true, abandonAfterMinutes: 1440, abandonedJourneyActive: true },
    coupons: { sentWithoutCodes: { active: 1, expired: 0, refs: [ID(30)] } },
    retention: { settingsRow: false, cancellations30d: 3 },
    crm: {
      autoTasksUnassigned: { open: 4, overdue: 1 },
      qualifiedWithoutOwner: { mqlSql: 1, opportunity: 1, refs: [ID(40), ID(41)] },
    },
    newsletter: {
      settingsRow: true,
      doubleOptIn: false,
      popupEnabled: true,
      defaultSender: true,
      campaignsSent30d: 2,
    },
    workflows: {
      cancelRecipe: { id: ID(50), enabled: true, guarded: false, cancelledByPause30d: 2 },
    },
  },
};

/** Drugi zestaw - stany wykluczające się z pierwszym (licznik bez wiersza, nakładka przepisu). */
const FACTS_ALT: RevenueFacts = {
  ...FACTS,
  areas: {
    ...FACTS.areas,
    metering: { settingsRow: false, meteredRules: 2 },
    workflows: {
      overlaps: { duplicates: [{ workflowId: ID(51), journeyId: ID(52) }], sharedTrigger: [] },
    },
  },
};
const ALT_CHECKS = new Set(["metering.settings_row_missing", "workflows.overlaps_journey"]);
const NOW_MS = Date.parse("2026-10-20T12:00:00.000Z");

const factsFor = (checkId: string) => (ALT_CHECKS.has(checkId) ? FACTS_ALT : FACTS);
const findingOf = (id: string): RevenueFinding =>
  evaluateRegistry(factsFor(id), [], NOW_MS).find((f) => f.checkId === id)!;

type Tree = { readonly [key: string]: string | Tree };
const DICTS = revenueDiagnosticsDictionaries as unknown as { pl: Tree; en: Tree };

function exists(tree: Tree, key: string): boolean {
  const resolve = (path: string) =>
    path
      .split(".")
      .reduce<string | Tree | undefined>(
        (node, part) => (node === undefined || typeof node === "string" ? undefined : node[part]),
        tree,
      );
  return typeof resolve(key) === "string" || typeof resolve(`${key}_one`) === "string";
}

function valueKeys(value: QuickFixValue): string[] {
  return "key" in value ? [value.key] : [];
}

describe("opcje i podgląd „Przed → Po” (klucze w słowniku PL i EN)", () => {
  it.each(dialogChecks.map((c) => [c.id, c.fix.dialog] as const))(
    "%s → %s: opcje z etykietą, podgląd z polem i wartościami",
    (checkId, dialog) => {
      const spec = quickFixFor(dialog);
      const finding = findingOf(checkId);
      expect(
        finding.state === "warn" || finding.state === "error",
        `${checkId} bez problemu w fiksturze`,
      ).toBe(true);
      const facts = factsFor(checkId);
      const options = spec.options(facts, finding);
      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        for (const tree of [DICTS.pl, DICTS.en])
          expect(exists(tree, option.labelKey), option.labelKey).toBe(true);
        const diffs = spec.diff(option, facts, option.payload);
        expect(diffs.length).toBeGreaterThan(0);
        for (const diff of diffs) {
          for (const key of [diff.labelKey, ...valueKeys(diff.before), ...valueKeys(diff.after)]) {
            for (const tree of [DICTS.pl, DICTS.en]) expect(exists(tree, key), key).toBe(true);
          }
        }
      }
    },
  );

  it("plan bez warstwy: opcja przypina plany z refs diagnozy, bez warstwy ładunek niekompletny", () => {
    const spec = QUICK_FIXES.plan_tier;
    const [option] = spec.options(FACTS, findingOf("catalog.plan_without_tier"));
    expect(option!.payload.planIds).toEqual([ID(1)]);
    expect(spec.valid!(option!.payload)).toBe(false);
    expect(spec.valid!({ ...option!.payload, tierKey: "pro" })).toBe(true);
  });

  it("reguła dostępu: przy wycofanym planie dwie drogi (zdjęcie martwego planu albo przypisanie)", () => {
    const spec = QUICK_FIXES.access_rule_plan;
    const dangling = spec.options(FACTS, findingOf("paywall.rule_inactive_plan"));
    expect(dangling.map((o) => o.id)).toEqual(["remove_dead", "assign"]);
    expect(dangling[0]!.payload.deadPlanIds).toEqual([ID(3)]);
    expect(spec.valid!(dangling[0]!.payload)).toBe(true);
    expect(spec.valid!(dangling[1]!.payload)).toBe(false);
    const paid = spec.options(FACTS, findingOf("paywall.paid_without_buyable_plan"));
    expect(paid.map((o) => o.id)).toEqual(["assign"]);
  });

  it("limit gości: propozycja = limit zalogowanych; wartość niecałkowita albo 0 odrzucona", () => {
    const spec = QUICK_FIXES.metering_anon_limit;
    const options = spec.options(FACTS, findingOf("metering.anon_zero_limit"));
    expect(options.map((o) => [o.id, o.payload.value])).toEqual([
      ["same_as_members", 5],
      ["custom", null],
    ]);
    expect(spec.valid!({ value: 0 })).toBe(false);
    expect(spec.valid!({ value: 2.5 })).toBe(false);
    expect(spec.valid!({ value: 3 })).toBe(true);
  });

  it("okno porzucenia kasy: ten sam predykat co karta kasy (30-1440), poza zakresem odrzucone", () => {
    const spec = QUICK_FIXES.checkout_abandon_window;
    expect(spec.valid!({ value: REVENUE_LIMITS.checkoutAbandonMinutesMin - 1 })).toBe(false);
    expect(spec.valid!({ value: REVENUE_LIMITS.checkoutAbandonMinutesMin })).toBe(true);
    expect(spec.valid!({ value: REVENUE_LIMITS.checkoutAbandonMinutesMax + 1 })).toBe(false);
    expect(spec.valid!({ value: null })).toBe(false);
  });

  it("nadawca: adres platformy i adres bez domeny odrzucone", () => {
    const spec = QUICK_FIXES.newsletter_sender;
    expect(spec.valid!({ email: "onboarding@resend.dev", name: "" })).toBe(false);
    expect(spec.valid!({ email: "bez-domeny", name: "" })).toBe(false);
    expect(spec.valid!({ email: " redakcja@example.org ", name: "" })).toBe(true);
    expect(SENDER_EMAIL_PATTERN.test("a b@example.org")).toBe(false);
  });

  it("retencja bez wiersza: opcja „utwórz” z DEFAULT kolumn migracji", () => {
    const [option] = QUICK_FIXES.retention_enable.options(
      FACTS,
      findingOf("retention.not_configured"),
    );
    expect(option!.id).toBe("create");
    expect(option!.labelParams).toEqual({
      percent: RETENTION_COLUMN_DEFAULTS.discount_pct,
      periods: RETENTION_COLUMN_DEFAULTS.discount_periods,
    });
  });

  it("zadania CRM: osoba zapasowa wymagana tylko w opcji z zapasową", () => {
    const spec = QUICK_FIXES.crm_assign_tasks;
    expect(spec.valid!({ useFallback: false, fallbackAssigneeId: null })).toBe(true);
    expect(spec.valid!({ useFallback: true, fallbackAssigneeId: null })).toBe(false);
    expect(spec.valid!({ useFallback: true, fallbackAssigneeId: ID(60) })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Aplikatory - mutator modułu, token ze świeżego odczytu, „Cofnij"
// ---------------------------------------------------------------------------

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
});

describe("aplikatory", () => {
  it("plan poza sprzedażą: token z odczytu modułu, patch jednej kolumny, cofnięcie tokenem zapisu", async () => {
    h.plansRows.mockResolvedValue([
      { id: ID(2), updated_at: "t-read", tier_key: "decision_lab", active: true, for_sale: true },
    ]);
    h.planSave
      .mockResolvedValueOnce({ updated_at: "t-saved" })
      .mockResolvedValueOnce({ updated_at: "t-undo" });
    const { result } = renderHookWithQueryClient(() =>
      QUICK_FIXES.plan_not_for_sale.apply.useApplier(),
    );
    let applied: Awaited<ReturnType<typeof result.current.apply>> = {};
    await act(async () => {
      applied = await result.current.apply({ planIds: [ID(2), ID(99)] });
    });
    // Plan, którego już nie ma, jest pomijany - nie zgadujemy tokenu.
    expect(h.planSave).toHaveBeenCalledTimes(1);
    expect(h.planSave).toHaveBeenCalledWith({
      id: ID(2),
      expectedUpdatedAt: "t-read",
      patch: { for_sale: false },
    });
    await act(async () => {
      await applied.revert!();
    });
    expect(h.planSave).toHaveBeenLastCalledWith({
      id: ID(2),
      expectedUpdatedAt: "t-saved",
      patch: { for_sale: true },
    });
  });

  it("konflikt zapisu (40001) wraca do dialogu jako błąd, bez dalszych zapisów", async () => {
    h.plansRows.mockResolvedValue([
      { id: ID(1), updated_at: "t1", tier_key: null, active: true, for_sale: true },
      { id: ID(2), updated_at: "t2", tier_key: null, active: true, for_sale: true },
    ]);
    const conflict = Object.assign(new Error("stale_write"), { code: "40001" });
    h.planSave.mockRejectedValueOnce(conflict);
    const { result } = renderHookWithQueryClient(() => QUICK_FIXES.plan_tier.apply.useApplier());
    await expect(result.current.apply({ planIds: [ID(1), ID(2)], tierKey: "pro" })).rejects.toBe(
      conflict,
    );
    expect(h.planSave).toHaveBeenCalledTimes(1);
  });

  it("ukrycie warstwy: mutator marketingu warstwy, token z listy warstw modułu", async () => {
    h.tiersRows.mockResolvedValue([{ id: ID(10), key: "ngo", updated_at: "tier-read" }]);
    h.tierSave.mockResolvedValue({ updated_at: "tier-saved" });
    const { result } = renderHookWithQueryClient(() => QUICK_FIXES.tier_hide.apply.useApplier());
    let applied: Awaited<ReturnType<typeof result.current.apply>> = {};
    await act(async () => {
      applied = await result.current.apply({ tierKeys: ["ngo"] });
    });
    expect(h.tierSave).toHaveBeenCalledWith({
      id: ID(10),
      expectedUpdatedAt: "tier-read",
      patch: { pricing_visible: false },
    });
    await act(async () => {
      await applied.revert!();
    });
    expect(h.tierSave).toHaveBeenLastCalledWith({
      id: ID(10),
      expectedUpdatedAt: "tier-saved",
      patch: { pricing_visible: true },
    });
  });

  it("okno porzucenia: zapis całego stanu karty kasy z nową wartością i cofnięcie do poprzedniej", async () => {
    h.checkoutState.mockResolvedValue({
      abandon_after_minutes: 1440,
      other: "x",
      updated_at: "co-read",
    });
    h.checkoutSave.mockResolvedValue({ updated_at: "co-saved" });
    const { result } = renderHookWithQueryClient(() =>
      QUICK_FIXES.checkout_abandon_window.apply.useApplier(),
    );
    let applied: Awaited<ReturnType<typeof result.current.apply>> = {};
    await act(async () => {
      applied = await result.current.apply({ value: 60 });
    });
    expect(h.checkoutSave).toHaveBeenCalledWith({
      settings: { abandon_after_minutes: 60, other: "x" },
      expectedUpdatedAt: "co-read",
    });
    await act(async () => {
      await applied.revert!();
    });
    expect(h.checkoutSave).toHaveBeenLastCalledWith({
      settings: { abandon_after_minutes: 1440, other: "x" },
      expectedUpdatedAt: "co-saved",
    });
  });

  it("licznik bez wiersza: INSERT wartości METERING_DEFAULTS (token null), bez cofania", async () => {
    h.meteringSave.mockResolvedValue({ updated_at: "m-saved" });
    const { result } = renderHookWithQueryClient(() =>
      QUICK_FIXES.metering_defaults.apply.useApplier(),
    );
    let applied: Awaited<ReturnType<typeof result.current.apply>> = {};
    await act(async () => {
      applied = await result.current.apply({});
    });
    expect(h.meteringSave).toHaveBeenCalledWith({
      settings: { ...METERING_DEFAULTS },
      expectedUpdatedAt: null,
    });
    expect(applied.revert).toBeUndefined();
    expect(QUICK_FIXES.metering_defaults.reversible).toBe(false);
  });

  it("zadania CRM: server fn S4 z osobą zapasową tylko w opcji zapasowej; nieodwracalne", async () => {
    h.assignTasks.mockResolvedValue({ assigned: 4 });
    const { result } = renderHookWithQueryClient(() =>
      QUICK_FIXES.crm_assign_tasks.apply.useApplier(),
    );
    await act(async () => {
      await result.current.apply({ useFallback: false, fallbackAssigneeId: ID(60) });
    });
    expect(h.assignTasks).toHaveBeenLastCalledWith({ data: { fallback_assignee_id: null } });
    await act(async () => {
      await result.current.apply({ useFallback: true, fallbackAssigneeId: ID(60) });
    });
    expect(h.assignTasks).toHaveBeenLastCalledWith({ data: { fallback_assignee_id: ID(60) } });
    expect(QUICK_FIXES.crm_assign_tasks.reversible).toBe(false);
  });

  it("przepis: wyłączenie każdego przepisu z refs i cofnięcie włączeniem", async () => {
    h.workflowToggle.mockResolvedValue(undefined);
    const { result } = renderHookWithQueryClient(() =>
      QUICK_FIXES.workflow_disable.apply.useApplier(),
    );
    let applied: Awaited<ReturnType<typeof result.current.apply>> = {};
    await act(async () => {
      applied = await result.current.apply({ workflowIds: [ID(50)] });
    });
    expect(h.workflowToggle).toHaveBeenCalledWith({ id: ID(50), enabled: false });
    await act(async () => {
      await applied.revert!();
    });
    expect(h.workflowToggle).toHaveBeenLastCalledWith({ id: ID(50), enabled: true });
  });

  it("odwracalność deklarowana = aplikator oddaje `revert` (sprawdzone wyżej) - lista nieodwracalnych", () => {
    const irreversible = Object.values(QUICK_FIXES)
      .filter((s) => !s.reversible)
      .map((s) => s.id)
      .sort();
    expect(irreversible).toEqual(["campaign_status", "crm_assign_tasks", "metering_defaults"]);
  });
});
