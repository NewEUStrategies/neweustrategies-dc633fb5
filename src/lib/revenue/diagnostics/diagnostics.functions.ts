// Server fns diagnostyki huba (S7, SPEC §5.2): fakty (SQL + TS), odczyt
// wyciszeń, wyciszenie i jego zdjęcie.
//
// Bramka `requireCrmStaff` (admin/editor + aal2 dla kont z MFA) = bramka SQL
// (`is_admin_or_editor()`); WYCISZENIE rozstrzyga SQL (`has_role(…, 'admin')`
// - redaktor dostaje 42501 → stan `forbidden`, nie wyjątek). Najemca NIGDY
// nie idzie w parametrach: RPC biorą go z sesji (`current_tenant_id()`).
//
// Nazwy RPC są LITERAŁAMI w miejscu wywołania (bramka
// `generate:ts-sql-contract` czyta je ze źródła i sprawdza granty), a klient
// jest rzutowany na `RpcCallable` - sygnatury dopisze do `types.ts` I9.
//
// FAKTY TS. Część faktów nie mieszka w bazie: rejestr bramek warstw
// (`capabilities.ts`), katalog szyny (`DOMAIN_EVENT_TYPES`), szablony ścieżek
// (`replacesWorkflowTemplate`, `ACTION_EMITS`), rejestr źródeł benchmarków
// S6 (moduł TYLKO dla serwera - cytaty) i waluta prezentacji cennika. Serwer
// dokleja je czystą funkcją `enrichRevenueFacts`, a moduły ładuje DYNAMICZNIE
// w handlerze - żaden z nich nie trafia do chunku przeglądarki.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCrmStaff } from "@/integrations/supabase/require-staff";
import { REVENUE_LIMITS, SNOOZE_KINDS } from "@/lib/revenue/limits";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import {
  parseRevenueFacts,
  type JourneyOverlapFact,
  type PresentationFact,
  type PromiseGapFact,
  type RevenueFacts,
} from "./facts";
import { isRevenueCheckId, UNSNOOZABLE_CHECK_IDS, type RevenueSnooze } from "./registry";

// ---------------------------------------------------------------------------
// Wyniki
// ---------------------------------------------------------------------------

/** Odmowa bez wyjątku: rola (42501), brak funkcji w bazie, brak aal2. */
export type RevenueDiagnosticsDenial = "forbidden" | "unavailable" | "mfa_required";

export type RevenueFactsRead =
  | { state: "ready"; facts: RevenueFacts }
  | { state: RevenueDiagnosticsDenial };

export type RevenueSnoozesRead =
  | { state: "ready"; snoozes: RevenueSnooze[] }
  | { state: RevenueDiagnosticsDenial };

/** Kody 22023 z `admin_revenue_diagnostic_snooze` - odrzucenie, nigdy przycięcie. */
export const SNOOZE_INVALID_CODES = [
  "check_id_invalid",
  "not_snoozable",
  "scope_key_invalid",
  "kind_invalid",
  "reason_invalid",
  "scope_hash_invalid",
  "until_invalid",
  "until_too_far",
  "scope_hash_required",
  "reason_required",
] as const;
export type SnoozeInvalidCode = (typeof SNOOZE_INVALID_CODES)[number];

export type RevenueSnoozeWrite =
  | { state: "ok"; removed?: boolean }
  | { state: "invalid"; code: SnoozeInvalidCode }
  | { state: RevenueDiagnosticsDenial };

/** „Funkcji jeszcze nie ma w tej bazie" - okno wdrożenia, nie awaria. */
const MISSING_SOURCE = new Set(["42883", "PGRST202"]);

type RpcError = { message: string; code?: string } | null;

function denialOf(error: NonNullable<RpcError>): RevenueDiagnosticsDenial | null {
  if (error.code === "42501") return "forbidden";
  if (error.code !== undefined && MISSING_SOURCE.has(error.code)) return "unavailable";
  return null;
}

function asRpc(client: unknown): RpcCallable {
  return client as RpcCallable;
}

// ---------------------------------------------------------------------------
// Fakty TS (czysta funkcja - testowana bez serwera)
// ---------------------------------------------------------------------------

/**
 * Kroki dialogu anulowania (`RetentionDialog`: „NAJWYŻEJ 2 KROKI" - powód,
 * potem oferta; bez przepływu sam krok potwierdzenia). Dialog nie eksportuje
 * stałej - zgłoszenie do integracji: `RETENTION_DIALOG_STEPS` w module
 * dialogu, wtedy ten wpis staje się importem.
 */
export const RETENTION_DIALOG_STEPS = { enabled: 2, disabled: 1 } as const;

export interface RevenueFactsDeps {
  /** `capabilities.ts` - czy flaga ma realną bramkę. */
  isEnforcedCapability(key: string): boolean;
  /** `displayCurrency.ts` - waluta prezentacji cennika w języku. */
  displayCurrencyForLang(lang: string): string;
  /** Szablon ścieżki → przepis, który zastępuje (`replacesWorkflowTemplate`). */
  replacesWorkflowTemplate(templateKey: string): string | null;
  /** `ACTION_EMITS` - zdarzenia emitowane przez węzeł danego typu. */
  actionEmits(nodeType: string): readonly string[];
  /** `DOMAIN_EVENT_TYPES` - katalog szyny. */
  domainEventTypes: readonly string[];
  /** Daty publikacji źródeł benchmarków S6 i próg „przeterminowane". */
  benchmarkPublished: readonly string[];
  ageMonths(published: string, asOf: string): number | null;
  staleSourceMonths: number;
}

function promiseGaps(facts: RevenueFacts, deps: RevenueFactsDeps) {
  const tiers = facts.areas.catalog?.tiers;
  if (!tiers) return undefined;
  const broken: PromiseGapFact[] = [];
  const decorative: PromiseGapFact[] = [];
  for (const tier of tiers) {
    if (!tier.active) continue;
    const offerable =
      tier.pricingVisible && tier.ctaMode === "auto" && tier.plansForSale > 0;
    for (const capability of tier.capabilityKeys) {
      const gap = { tierKey: tier.key, capability, offerable };
      // Karta obiecuje flagę, której warstwa nie ma - P20 (obietnica ≠ bramka).
      if (!tier.featureKeys.includes(capability)) broken.push(gap);
      // Flaga jest, ale żadna bramka jej nie czyta - obietnica „na słowo".
      else if (!deps.isEnforcedCapability(capability)) decorative.push(gap);
    }
  }
  return { broken, decorative };
}

function presentation(facts: RevenueFacts, deps: RevenueFactsDeps): PresentationFact[] | undefined {
  const charged = facts.areas.checkout?.chargeCurrencies;
  if (!charged) return undefined;
  return (["pl", "en"] as const).map((lang) => ({
    lang,
    displayCurrency: deps.displayCurrencyForLang(lang),
    chargeCurrencies: charged,
  }));
}

function overlaps(facts: RevenueFacts, deps: RevenueFactsDeps) {
  const enabled = facts.areas.workflows?.enabled;
  const graphs = facts.areas.journeys?.graphs;
  if (!enabled || !graphs) return undefined;
  const duplicates: JourneyOverlapFact[] = [];
  const sharedTrigger: JourneyOverlapFact[] = [];
  for (const workflow of enabled) {
    for (const journey of graphs) {
      const replaced = journey.templateKey ? deps.replacesWorkflowTemplate(journey.templateKey) : null;
      if (replaced !== null && replaced === workflow.templateKey) {
        duplicates.push({ workflowId: workflow.id, journeyId: journey.id });
      } else if (journey.trigger !== null && journey.trigger === workflow.trigger) {
        sharedTrigger.push({ workflowId: workflow.id, journeyId: journey.id });
      }
    }
  }
  return { duplicates, sharedTrigger };
}

/**
 * Cykle wyzwalaczy: krawędź A → B, gdy węzeł A emituje zdarzenie, na którym
 * startuje B (także A → A). Ścieżka w cyklu z `reentry` innym niż `never`
 * może przyjmować ten sam kontakt w kółko (cykl nieograniczony).
 */
function cycles(facts: RevenueFacts, deps: RevenueFactsDeps) {
  const graphs = facts.areas.journeys?.graphs;
  if (!graphs) return undefined;
  const edges = new Map<string, string[]>();
  for (const from of graphs) {
    const emitted = new Set(from.nodeTypes.flatMap((type) => [...deps.actionEmits(type)]));
    edges.set(
      from.id,
      graphs.filter((to) => to.trigger !== null && emitted.has(to.trigger)).map((to) => to.id),
    );
  }
  // Tarjan - silnie spójne składowe; cykl = składowa > 1 albo pętla własna.
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indexOf = new Map<string, number>();
  const low = new Map<string, number>();
  const components: string[][] = [];
  const visit = (id: string) => {
    indexOf.set(id, index);
    low.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);
    for (const next of edges.get(id) ?? []) {
      if (!indexOf.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id) as number, low.get(next) as number));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id) as number, indexOf.get(next) as number));
      }
    }
    if (low.get(id) === indexOf.get(id)) {
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop() as string;
        onStack.delete(member);
        component.push(member);
      } while (member !== id);
      components.push(component);
    }
  };
  for (const graph of graphs) if (!indexOf.has(graph.id)) visit(graph.id);
  const looping = components.filter(
    (c) => c.length > 1 || (edges.get(c[0]) ?? []).includes(c[0]),
  );
  const reentryOf = new Map(graphs.map((g) => [g.id, g.reentry]));
  const unbounded = looping.filter((c) => c.some((id) => (reentryOf.get(id) ?? "never") !== "never"));
  return {
    bounded: looping.length - unbounded.length,
    unbounded: unbounded.length,
    refs: looping.flat().sort(),
  };
}

function eventTypes(facts: RevenueFacts, deps: RevenueFactsDeps) {
  const seen = facts.areas.sync?.seenTypes90d;
  if (!seen) return undefined;
  const catalog = new Set(deps.domainEventTypes);
  const seenSet = new Set(seen);
  return {
    deadTypes: deps.domainEventTypes.filter((type) => !seenSet.has(type)),
    unknownTypes: seen.filter((type) => !catalog.has(type)),
  };
}

function benchmarkSources(facts: RevenueFacts, deps: RevenueFactsDeps, nowMs: number) {
  const asOf = new Date(facts.computedAt ? Date.parse(facts.computedAt) : nowMs)
    .toISOString()
    .slice(0, 7);
  const stale = deps.benchmarkPublished.filter((published) => {
    const age = deps.ageMonths(published, asOf);
    return age !== null && age > deps.staleSourceMonths;
  }).length;
  return { total: deps.benchmarkPublished.length, stale };
}

/** Każdy fakt TS osobno: awaria jednego zostawia go „nie wiadomo", resztę liczy. */
function attempt<T>(compute: () => T): T | undefined {
  try {
    return compute();
  } catch {
    return undefined;
  }
}

/**
 * Dokleja fakty TS do faktów SQL. Obszar `null`/nieobecny zostaje nietknięty
 * (nie wiadomo), a pole liczone z brakującego wejścia - nieobecne.
 */
export function enrichRevenueFacts(
  facts: RevenueFacts,
  deps: RevenueFactsDeps,
  nowMs: number,
): RevenueFacts {
  const areas = { ...facts.areas };
  if (areas.catalog) {
    const gaps = attempt(() => promiseGaps(facts, deps));
    if (gaps) areas.catalog = { ...areas.catalog, promiseGaps: gaps };
  }
  if (areas.checkout) {
    const shown = attempt(() => presentation(facts, deps));
    if (shown) areas.checkout = { ...areas.checkout, presentation: shown };
  }
  if (areas.retention && areas.retention.settingsRow !== undefined) {
    const on = areas.retention.settingsRow && areas.retention.enabled === true;
    areas.retention = {
      ...areas.retention,
      cancelPathSteps: on ? RETENTION_DIALOG_STEPS.enabled : RETENTION_DIALOG_STEPS.disabled,
    };
  }
  if (areas.workflows) {
    const found = attempt(() => overlaps(facts, deps));
    if (found) areas.workflows = { ...areas.workflows, overlaps: found };
  }
  if (areas.journeys) {
    const found = attempt(() => cycles(facts, deps));
    if (found) areas.journeys = { ...areas.journeys, cycles: found };
  }
  if (areas.sync) {
    const found = attempt(() => eventTypes(facts, deps));
    if (found) areas.sync = { ...areas.sync, ...found };
  }
  if (areas.data_quality) {
    const found = attempt(() => benchmarkSources(facts, deps, nowMs));
    if (found) areas.data_quality = { ...areas.data_quality, benchmarkSources: found };
  }
  return { ...facts, areas };
}

/** Moduły faktów TS - wyłącznie dynamicznie, w handlerze (nie w chunku klienta). */
async function loadFactsDeps(): Promise<RevenueFactsDeps> {
  const [capabilities, currency, templates, graph, events, sources, adapter] = await Promise.all([
    import("@/lib/billing/capabilities"),
    import("@/lib/billing/displayCurrency"),
    import("@/lib/journeys/templates"),
    import("@/lib/journeys/graph"),
    import("@/lib/realtime/domainEvents"),
    import("@/lib/analytics/semantic/benchmarks/sources"),
    import("@/lib/analytics/semantic/benchmarks/adapter"),
  ]);
  const emits = graph.ACTION_EMITS as Readonly<Record<string, readonly string[] | undefined>>;
  return {
    isEnforcedCapability: capabilities.isEnforcedCapability,
    displayCurrencyForLang: currency.displayCurrencyForLang,
    replacesWorkflowTemplate: (key) =>
      templates.journeyTemplate(key)?.replacesWorkflowTemplate ?? null,
    actionEmits: (type) => emits[type] ?? [],
    domainEventTypes: events.DOMAIN_EVENT_TYPES,
    benchmarkPublished: sources.BENCHMARK_SOURCES.map((s) => s.published),
    ageMonths: adapter.ageMonths,
    staleSourceMonths: adapter.STALE_SOURCE_MONTHS,
  };
}

// ---------------------------------------------------------------------------
// Server fns
// ---------------------------------------------------------------------------

export const getRevenueFacts = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .handler(async ({ context }): Promise<RevenueFactsRead> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc("admin_revenue_facts", {});
    if (error) {
      const denial = denialOf(error);
      if (denial) return { state: denial };
      throw new Error(error.message);
    }
    const facts = parseRevenueFacts(raw);
    // Brak modułu faktów TS (awaria importu) nie wyłącza diagnozy: reguły
    // tych pól mówią „nie wiadomo", reszta działa na faktach SQL.
    const deps = await loadFactsDeps().catch(() => null);
    return { state: "ready", facts: deps ? enrichRevenueFacts(facts, deps, Date.now()) : facts };
  });

/** Wiersz odczytu wyciszeń → `RevenueSnooze` (tolerancyjnie: zły wiersz odpada). */
export function parseRevenueSnoozes(raw: unknown): RevenueSnooze[] {
  if (typeof raw !== "object" || raw === null) return [];
  const list = (raw as { snoozes?: unknown }).snoozes;
  if (!Array.isArray(list)) return [];
  const out: RevenueSnooze[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const kind = row.kind;
    if (typeof row.id !== "string" || typeof row.checkId !== "string") continue;
    if (kind !== "days" && kind !== "intentional") continue;
    const str = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);
    out.push({
      id: row.id,
      checkId: row.checkId,
      scopeKey: str("scopeKey") ?? "*",
      kind,
      until: str("until"),
      reason: str("reason"),
      scopeHash: str("scopeHash"),
      createdAt: str("createdAt"),
    });
  }
  return out;
}

export const getRevenueSnoozes = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .handler(async ({ context }): Promise<RevenueSnoozesRead> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc(
      "admin_revenue_diagnostic_snoozes",
      {},
    );
    if (error) {
      const denial = denialOf(error);
      if (denial) return { state: denial };
      throw new Error(error.message);
    }
    return { state: "ready", snoozes: parseRevenueSnoozes(raw) };
  });

// Walidacja = CHECK-i tabeli (lustro `REVENUE_LIMITS`, parytet
// `revenueLimitsParity.test.ts`): wartość za długa jest ODRZUCANA, nigdy
// przycinana - licznik w formularzu zna ten sam limit.
const CheckId = z
  .string()
  .regex(REVENUE_LIMITS.checkIdPattern, "check_id_invalid")
  .refine((id) => isRevenueCheckId(id), "check_id_invalid");
const ScopeKey = z.string().min(1).max(REVENUE_LIMITS.scopeKeyMax).default("*");

export const SnoozeInput = z
  .object({
    checkId: CheckId,
    scopeKey: ScopeKey,
    kind: z.enum(SNOOZE_KINDS),
    until: z.string().datetime({ offset: true }).nullable().default(null),
    reason: z
      .string()
      .refine(
        (text) =>
          text.trim().length >= REVENUE_LIMITS.snoozeReasonMin &&
          text.trim().length <= REVENUE_LIMITS.snoozeReasonMax,
        "reason_invalid",
      )
      .nullable()
      .default(null),
    scopeHash: z.string().min(1).max(REVENUE_LIMITS.scopeHashMax).nullable().default(null),
  })
  .refine((s) => !(UNSNOOZABLE_CHECK_IDS as readonly string[]).includes(s.checkId), {
    message: "not_snoozable",
  })
  .refine((s) => s.kind !== "days" || s.until !== null, { message: "until_invalid" })
  .refine((s) => s.kind !== "intentional" || (s.scopeHash !== null && s.reason !== null), {
    message: "scope_hash_required",
  });
export type SnoozeInputValue = z.input<typeof SnoozeInput>;

const UnsnoozeInput = z.object({ checkId: CheckId, scopeKey: ScopeKey });

function invalidCode(message: string): SnoozeInvalidCode | null {
  return (SNOOZE_INVALID_CODES as readonly string[]).includes(message)
    ? (message as SnoozeInvalidCode)
    : null;
}

export const snoozeRevenueCheck = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => SnoozeInput.parse(input))
  .handler(async ({ data, context }): Promise<RevenueSnoozeWrite> => {
    const { error } = await asRpc(context.supabase).rpc("admin_revenue_diagnostic_snooze", {
      p_check_id: data.checkId,
      p_scope_key: data.scopeKey,
      p_kind: data.kind,
      p_until: data.until,
      p_reason: data.reason,
      p_scope_hash: data.scopeHash,
    });
    if (error) {
      const denial = denialOf(error);
      if (denial) return { state: denial };
      const code = error.code === "22023" ? invalidCode(error.message) : null;
      if (code) return { state: "invalid", code };
      throw new Error(error.message);
    }
    return { state: "ok" };
  });

export const unsnoozeRevenueCheck = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => UnsnoozeInput.parse(input))
  .handler(async ({ data, context }): Promise<RevenueSnoozeWrite> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc(
      "admin_revenue_diagnostic_unsnooze",
      { p_check_id: data.checkId, p_scope_key: data.scopeKey },
    );
    if (error) {
      const denial = denialOf(error);
      if (denial) return { state: denial };
      const code = error.code === "22023" ? invalidCode(error.message) : null;
      if (code) return { state: "invalid", code };
      throw new Error(error.message);
    }
    const removed =
      typeof raw === "object" && raw !== null && (raw as { removed?: unknown }).removed === true;
    return { state: "ok", removed };
  });
