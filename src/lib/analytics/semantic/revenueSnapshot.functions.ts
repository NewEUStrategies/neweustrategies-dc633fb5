/**
 * MIGAWKA PRZYCHODU I LEJKA - jedna serwerowa funkcja dla huba, BI i pulpitu
 * (AD-19, SPEC §5.2).
 *
 * Dotąd przychód miał trzy definicje (pulpit, BI, moduł płatności) i żadnego
 * arbitra. Tutaj pięć odczytów SQL - migawka przychodu (S2), lejek (S3),
 * wydarzenia i kluby (S4), zdrowie newslettera (S1) - przechodzi przez TĘ SAMĄ
 * warstwę semantyczną co ruch: metryka kanoniczna, strumień autorytatywny,
 * uzgodnienie z obserwacją potwierdzającą (księga dokumentów vs zamówienia),
 * delta wobec okna poprzedniego. Kształt odpowiedzi jest zgodny
 * z `getSemanticSnapshot` (`entries`, `deltas`, `ratios`, `streams`), więc
 * komponenty uzgodnienia czytają oba bez adapterów.
 *
 * BEZPIECZEŃSTWO I ROLE:
 *  - tenant NIGDY nie jest parametrem - każde RPC bierze go z profilu
 *    wołającego (`current_tenant_id()`), a walidator odrzuca nieznane klucze;
 *  - rola z sesji (`has_role`): admin widzi wszystko, editor - lejek,
 *    społeczność i e-mail, ale NIGDY nie woła RPC finansowego
 *    (`admin_revenue_semantic_snapshot`); jego wpisy rozliczeń są puste,
 *    a strumień ma powód `admin_only`. Żadna z ról → odmowa 42501;
 *  - kwoty dla editora są wycinane także tutaj (obrona w głąb), choć SQL
 *    zeruje je sam - finanse są wyłącznie adminowe.
 *
 * DEGRADACJA ZAMIAST WYJĄTKU. RPC z S1-S4 wdrażają się osobnymi migracjami:
 * brak funkcji (`PGRST202`/`42883`) albo niewpięty odczyt to strumień
 * `not_configured`, inny błąd - `read_failed`, a reszta migawki dojeżdża.
 *
 * WPIĘCIA ODŁOŻONE DO WŁAŚCICIELI RPC. S6 scala się do PR przed migracjami
 * S1-S4, a literał wywołania funkcji, której nie ma w stanie końcowym
 * migracji, czerwieni `check:rpc-contract` i pgTAP `ts_sql_contract` całego PR
 * (w przeglądarce byłby to PGRST202). Dlatego S6 dostarcza scalanie, role,
 * parsery i testy, a pięć wywołań stoi w `REVENUE_DOMAIN_READS` jako `null`
 * do chwili, gdy wycinek-właściciel wpina JEDNO wywołanie przez `RpcCallable`
 * z LITERAŁEM nazwy razem ze swoją migracją - kontrakt TS ⇄ SQL i baza
 * zmieniają się wtedy w tym samym commicie.
 */
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { revenueKeys } from "@/lib/revenue/keys";
import type { MoneyByCurrency } from "@/lib/revenue/money";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import {
  REVENUE_PERIODS,
  REVENUE_SEGMENTS,
  type RevenuePeriod,
  type RevenueSegment,
} from "@/lib/revenue/search";
import { REVENUE_CUSTOM_COMPARE_MAX_DAYS, type RevenueRange } from "@/lib/revenue/window";
import type { MetricId } from "./metrics";
import { reconcileAll, type ReconciliationEntry } from "./reconcile";
import {
  parseRevenueClubsSummary,
  parseRevenueEmailHealth,
  parseRevenueEventsSummary,
  parseRevenueFunnel,
  parseRevenueSemanticSnapshot,
  revenueMoney,
  revenueObservations,
  revenueRatios,
  type RawRevenueClubs,
  type RawRevenueEmailHealth,
  type RawRevenueEvents,
  type RawRevenueFunnel,
  type RawRevenueSnapshot,
  type RevenueRawBundle,
} from "./revenueRaw";
import type { SemanticDelta, SemanticRatio } from "./snapshot.functions";
import type { StreamId } from "./streams";
import { ga4RangeFromInstants, type CanonicalWindow } from "./window";

// ---------------------------------------------------------------------------
// Kontrakt wyniku (PLAN S6 §3.1)
// ---------------------------------------------------------------------------

export interface RevenueStreamHealth {
  readonly streamId: StreamId;
  readonly available: boolean;
  /**
   * `admin_only` - rola wołającego nie czyta tego strumienia (editor
   * i rozliczenia); to stan uprawnień, nie awaria i nie brak danych.
   */
  readonly reason?: "not_configured" | "read_failed" | "no_data" | "admin_only";
}

export interface RevenueSnapshotResult {
  readonly window: {
    readonly period: RevenuePeriod;
    readonly sinceIso: string;
    readonly untilIso: string;
    readonly offsetMinutes: number;
    /** Okno domknięte (minione) - jego liczby już się nie zmienią. */
    readonly complete: boolean;
  };
  readonly previous: { readonly sinceIso: string; readonly untilIso: string } | null;
  readonly entries: readonly ReconciliationEntry[];
  readonly deltas: readonly SemanticDelta[];
  readonly ratios: readonly SemanticRatio[];
  readonly streams: readonly RevenueStreamHealth[];
  /** Pełne listy kwot per metryka pieniężna - NIGDY suma walut. */
  readonly money: Partial<Record<MetricId, MoneyByCurrency[]>>;
  readonly dataSince: string | null;
  readonly computedAt: string | null;
  readonly basisMix: { readonly provider: number; readonly catalog: number } | null;
  readonly role: "admin" | "editor";
}

/** Strumienie, które migawka czyta - kolejność zdrowia w odpowiedzi. */
export const REVENUE_SNAPSHOT_STREAMS = [
  "billing",
  "lifecycle",
  "community",
  "newsletter",
] as const satisfies readonly StreamId[];

// ---------------------------------------------------------------------------
// Odmowa roli
// ---------------------------------------------------------------------------

/** Kod Postgresa „insufficient_privilege” - ten sam, którym odmawia SQL huba. */
export const REVENUE_FORBIDDEN_CODE = "42501";

const FORBIDDEN_MESSAGE = "Forbidden: admin or editor role required";

/**
 * Czy błąd to odmowa roli (a nie awaria). Serializacja błędu server fn gubi
 * własne pola, więc rozpoznajemy oba nośniki: kod i treść. Konsument pokazuje
 * wtedy stan „dostępne dla administratora”, a nie toast z błędem.
 */
export function isRevenueForbidden(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? error.code : undefined;
  const message = "message" in error ? error.message : undefined;
  return (
    code === REVENUE_FORBIDDEN_CODE ||
    (typeof message === "string" && message.startsWith(FORBIDDEN_MESSAGE))
  );
}

function forbidden(): Error {
  return Object.assign(new Error(FORBIDDEN_MESSAGE), { code: REVENUE_FORBIDDEN_CODE });
}

// ---------------------------------------------------------------------------
// Wejście
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * Najdłuższe okno, o które wolno pytać: najdłuższy okres własny z porównaniem
 * plus zapas na miesiąc (różne długości miesięcy, zmiana czasu). Dłuższe okno
 * to nie raport, tylko pełny skan księgi na każde odświeżenie kafla.
 */
const MAX_WINDOW_DAYS = REVENUE_CUSTOM_COMPARE_MAX_DAYS + 31;

const span = z
  .object({ sinceIso: z.string().datetime(), untilIso: z.string().datetime() })
  .strict()
  .refine((w) => Date.parse(w.sinceIso) < Date.parse(w.untilIso), {
    message: "sinceIso must precede untilIso",
  })
  .refine((w) => Date.parse(w.untilIso) - Date.parse(w.sinceIso) <= MAX_WINDOW_DAYS * DAY_MS, {
    message: `window longer than ${MAX_WINDOW_DAYS} days`,
  });

/**
 * Okno huba w kształcie `RevenueRange` (granice z LOKALNYCH północy admina,
 * policzone po stronie klienta). `.strict()` celowo: nieznany klucz - także
 * `tenantId` - jest błędem, a nie cicho odrzucanym polem, żeby nikt nie uwierzył,
 * że najemcę da się tu wybrać.
 */
const inputSchema = z
  .object({
    period: z.enum(REVENUE_PERIODS),
    current: span,
    previous: span.nullable(),
    offsetMinutes: z.number().int().min(-840).max(840),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    segment: z.enum(REVENUE_SEGMENTS).optional(),
  })
  .strict()
  .refine(
    (v) => v.previous === null || Date.parse(v.previous.untilIso) <= Date.parse(v.current.sinceIso),
    { message: "previous window must end before the current one starts" },
  );

export type RevenueSnapshotInput = z.infer<typeof inputSchema>;
type Span = RevenueSnapshotInput["current"];

// ---------------------------------------------------------------------------
// Wpięcia RPC domen (wycinki-właściciele)
// ---------------------------------------------------------------------------

type RpcResponse = Awaited<ReturnType<RpcCallable["rpc"]>>;

/** Domeny migawki - po jednym RPC na domenę (społeczność ma dwie). */
export const REVENUE_DOMAINS = ["snapshot", "funnel", "events", "clubs", "email"] as const;
export type RevenueDomain = (typeof REVENUE_DOMAINS)[number];

/**
 * Granice okna i segment dla RPC domeny. Najemcy tu NIE MA i nie będzie:
 * każde RPC huba bierze go z profilu wołającego (`current_tenant_id()`).
 */
export interface RevenueDomainWindow {
  readonly sinceIso: string;
  readonly untilIso: string;
  readonly segment: RevenueSegment;
}

/**
 * Odczyt jednej domeny. Nazwa funkcji SQL MUSI być literałem w miejscu
 * wywołania (`client.rpc("admin_revenue_funnel", …)`) - z literału bramki
 * `check:rpc-contract` i `generate:ts-sql-contract` wiedzą, jakiej funkcji
 * i jakiego grantu szukać w bazie (AGENTS: literalne nazwy RPC).
 */
export type RevenueDomainRead = (
  client: RpcCallable,
  window: RevenueDomainWindow,
) => PromiseLike<RpcResponse>;

/** Wpięcia wszystkich domen; `null` = funkcja SQL jeszcze nie istnieje w migracjach. */
export type RevenueDomainReads = Readonly<Record<RevenueDomain, RevenueDomainRead | null>>;

/**
 * Nazwy RPC domen - do logu awarii i do raportu wpięć. To NIE jest źródło
 * wywołania: samo wywołanie ma nazwę literałem (patrz `RevenueDomainRead`).
 */
export const REVENUE_DOMAIN_RPC: Readonly<Record<RevenueDomain, string>> = {
  snapshot: "admin_revenue_semantic_snapshot",
  funnel: "admin_revenue_funnel",
  events: "admin_revenue_events_summary",
  clubs: "admin_revenue_clubs_summary",
  email: "admin_revenue_email_health",
};

/**
 * Stan wpięć w produkcji. Od S4 wpięte `events` i `clubs`, od S2 `snapshot`,
 * od S3 `funnel`; reszta `null` -
 * DLACZEGO: S6 scala się przed migracjami S1-S4 (§8.3: S6 najwcześniej),
 * a literał wywołania funkcji, której nie tworzy żadna migracja, przewraca
 * kontrakt TS ⇄ SQL całego PR.
 * Niewpięta domena to `not_configured`: kafle pokazują „brak danych”, sekcja
 * BI mówi, że źródło jeszcze nie jest podłączone, i nic nie rzuca.
 *
 * Wycinek-właściciel podmienia `null` na jedno wywołanie w tym samym commicie,
 * w którym jego migracja tworzy funkcję (Z-S6-16; argumenty = kontrakt Z-S6-05):
 *  - `snapshot` (S2): `admin_revenue_semantic_snapshot(p_since, p_until)` -
 *    wyłącznie admin, editor nie dochodzi do wywołania;
 *  - `funnel` (S3): `admin_revenue_funnel(p_since, p_until, p_segment, p_track)`,
 *    `p_track: "all"`;
 *  - `events`, `clubs` (S4): `admin_revenue_{events,clubs}_summary(p_since, p_until)`;
 *  - `email` (S1): `admin_revenue_email_health(p_since, p_until)` - S1 oddaje
 *    kształt zagnieżdżony (`campaigns`, `list`, `doi`), a `parseRevenueEmailHealth`
 *    czyta płaski: wpięcie musi go spłaszczyć (Z-S6-17), inaczej tolerancyjny
 *    parser da ciche „brak danych”.
 * Docelowy kształt wpięć jest przypięty w `snapshot.functions.test.ts`
 * (`WPIECIA_DOCELOWE`) - test scalania biegnie dokładnie po nim.
 */
export const REVENUE_DOMAIN_READS: RevenueDomainReads = {
  // Integrator S2 (2026-10-19, Z-S6-16): migracja 20261020110400 tworzy
  // `admin_revenue_semantic_snapshot` z kluczami `REVENUE_SNAPSHOT_KEYS`
  // (pgTAP `revenue_aggregates` przypina zbiór) - wpięcie bez adaptera. Editor
  // nie dochodzi do wywołania (rozliczenia `admin_only`), a przed wdrożeniem
  // migracji PGRST202 = `not_configured`, ten sam stan co `null`.
  snapshot: (c, w) =>
    c.rpc("admin_revenue_semantic_snapshot", { p_since: w.sinceIso, p_until: w.untilIso }),
  // Integrator S3 (2026-10-20, Z-S6-16): migracja 20261020120400 tworzy
  // `admin_revenue_funnel` z kluczami płaskimi `REVENUE_FUNNEL_KEYS`
  // (`_funnel_counts`, pgTAP `revenue_funnel_access` przypina zbiór) - wpięcie
  // bez adaptera; migawka czyta tor samoobsługowy razem z kanałem sprzedaży
  // (`p_track: "all"`). Przed wdrożeniem migracji PGRST202 = `not_configured`.
  funnel: (c, w) =>
    c.rpc("admin_revenue_funnel", {
      p_since: w.sinceIso,
      p_until: w.untilIso,
      p_segment: w.segment,
      p_track: "all",
    }),
  // Integrator S4 (2026-10-19, Z-S6-16): migracja 20261020130700 tworzy obie
  // funkcje, a ich kształt jsonb jest płaski jak `REVENUE_{EVENTS,CLUBS}_KEYS`
  // (`by_currency` z `ticket_revenue_net_minor`, liczniki, `applications`,
  // `decision_hours_median`) - wpięcie bez adaptera. Przed wdrożeniem
  // migracji PGRST202 = `not_configured`, czyli ten sam stan co `null`.
  events: (c, w) =>
    c.rpc("admin_revenue_events_summary", { p_since: w.sinceIso, p_until: w.untilIso }),
  clubs: (c, w) =>
    c.rpc("admin_revenue_clubs_summary", { p_since: w.sinceIso, p_until: w.untilIso }),
  email: null,
};

// ---------------------------------------------------------------------------
// Odczyt RPC
// ---------------------------------------------------------------------------

type RpcStatus = "ok" | "not_configured" | "read_failed" | "admin_only";

interface RpcOutcome<T> {
  readonly status: RpcStatus;
  /** `null` przy statusie innym niż `ok` albo gdy odpowiedź nie była obiektem. */
  readonly value: T | null;
}

/** Brak funkcji w bazie: migracja wycinka jeszcze nie doszła - stan normalny. */
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

function outcomeOf<T>(
  fn: string,
  settled: PromiseSettledResult<RpcResponse>,
  parse: (raw: unknown) => T | null,
): RpcOutcome<T> {
  if (settled.status === "rejected") {
    const reason =
      settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
    console.warn(`[revenue] ${fn} RPC failed:`, reason);
    return { status: "read_failed", value: null };
  }
  const { data, error } = settled.value;
  if (error) {
    if (error.code && MISSING_FUNCTION.has(error.code)) {
      return { status: "not_configured", value: null };
    }
    // Odmowa SQL dla roli to stan uprawnień, nie awaria do logu.
    if (error.code === REVENUE_FORBIDDEN_CODE) return { status: "admin_only", value: null };
    console.warn(`[revenue] ${fn} RPC failed:`, error.message);
    return { status: "read_failed", value: null };
  }
  return { status: "ok", value: parse(data) };
}

/**
 * Jedno wywołanie RPC jako wynik, który NIGDY nie rzuca: `allSettled` łapie
 * odrzucenie obietnicy, a wywołanie przez funkcję - także wyjątek rzucony
 * synchronicznie przez klienta. Awaria jednego źródła nie może wywrócić
 * czterech pozostałych.
 */
async function settle<T>(
  fn: string,
  parse: (raw: unknown) => T | null,
  call: () => PromiseLike<RpcResponse>,
): Promise<RpcOutcome<T>> {
  const [settled] = await Promise.allSettled([Promise.resolve().then(call)]);
  return outcomeOf(fn, settled, parse);
}

interface WindowReads {
  readonly snapshot: RpcOutcome<RawRevenueSnapshot>;
  readonly funnel: RpcOutcome<RawRevenueFunnel>;
  readonly events: RpcOutcome<RawRevenueEvents>;
  readonly clubs: RpcOutcome<RawRevenueClubs>;
  readonly email: RpcOutcome<RawRevenueEmailHealth>;
}

/** Domena bez wpięcia: to samo, co funkcja nieobecna w bazie - nie awaria. */
const NOT_CONFIGURED: RpcOutcome<never> = { status: "not_configured", value: null };
const ADMIN_ONLY: RpcOutcome<never> = { status: "admin_only", value: null };

/**
 * Czy sparsowany ładunek niesie choć jedną liczbę różną od zera (także ujemną -
 * spadek listy to też pomiar). Napisy (daty) się nie liczą: sama data
 * początku księgi nie jest danymi z okna.
 */
function hasData(value: unknown): boolean {
  if (typeof value === "number") return value !== 0;
  if (Array.isArray(value)) return value.some(hasData);
  if (typeof value === "object" && value !== null) return Object.values(value).some(hasData);
  return false;
}

/**
 * Zdrowie strumienia z wyników jego RPC (społeczność ma dwa). Kolejność
 * rozstrzygania: brak uprawnień, potem awaria odczytu (część danych może
 * stać, ale admin musi wiedzieć, że nie wszystko), potem brak funkcji
 * w bazie, na końcu - czy cokolwiek zmierzono.
 */
function healthOf(
  streamId: StreamId,
  outcomes: readonly RpcOutcome<unknown>[],
): RevenueStreamHealth {
  const statuses = outcomes.map((o) => o.status);
  if (statuses.includes("admin_only")) return { streamId, available: false, reason: "admin_only" };
  if (statuses.includes("read_failed"))
    return { streamId, available: false, reason: "read_failed" };
  if (statuses.every((s) => s === "not_configured")) {
    return { streamId, available: false, reason: "not_configured" };
  }
  return outcomes.some((o) => o.status === "ok" && hasData(o.value))
    ? { streamId, available: true }
    : { streamId, available: false, reason: "no_data" };
}

/**
 * Okno kanoniczne dla `reconcileAll` z granic huba. `crossStreamSafe: true`
 * świadomie: zastrzeżenie dotyczy dnia niedomkniętego przez GA4, a strumienie
 * huba mają zerowe opóźnienie - księga i zamówienia widzą ten sam dzień.
 */
function canonicalOf(w: Span): CanonicalWindow {
  const sinceMs = Date.parse(w.sinceIso);
  const untilMs = Date.parse(w.untilIso);
  const days = Math.max(1, Math.round((untilMs - sinceMs) / DAY_MS));
  return {
    presetId: "custom",
    sinceIso: w.sinceIso,
    untilIso: w.untilIso,
    days,
    grain: "day",
    crossStreamSafe: true,
    ga4: ga4RangeFromInstants(sinceMs, untilMs - 1),
    rpcDays: days,
    notes: [],
  };
}

/** Pierwsza waluta pierwszej niepustej listy - waluta wiodąca najemcy. */
function firstCurrency(
  ...lists: readonly (readonly MoneyByCurrency[] | null | undefined)[]
): string | undefined {
  for (const list of lists) {
    const currency = list?.[0]?.currency;
    if (currency) return currency;
  }
  return undefined;
}

/** Zmiana procentowa liczona od |bazy| - ujemna baza (spadek MRR) nie odwraca znaku. */
function deltaPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// ---------------------------------------------------------------------------
// Serwerowa funkcja
// ---------------------------------------------------------------------------

/** Kontekst handlera po `requireSupabaseAuth`: klient z JWT wołającego i jego id. */
export interface RevenueSnapshotContext {
  readonly supabase: SupabaseClient<Database>;
  readonly userId: string;
}

/**
 * Handler migawki z jawnie podanymi wpięciami domen. Produkcja podaje
 * `REVENUE_DOMAIN_READS`; test - docelowe wpięcia po S1-S4, żeby scalanie,
 * role i rejestr wywołań były dowiedzione przed migracjami właścicieli.
 */
export async function revenueSnapshotHandler(
  { data, context }: { data: RevenueSnapshotInput; context: RevenueSnapshotContext },
  reads: RevenueDomainReads,
): Promise<RevenueSnapshotResult> {
  // --- rola z sesji: admin, potem editor; żadna - odmowa przed odczytem ---
  const asAdmin = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (asAdmin.error) throw new Error(asAdmin.error.message);
  let role: "admin" | "editor" = "admin";
  if (asAdmin.data !== true) {
    const asEditor = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "editor",
    });
    if (asEditor.error) throw new Error(asEditor.error.message);
    if (asEditor.data !== true) throw forbidden();
    role = "editor";
  }

  const segment: RevenueSegment = data.segment ?? "all";

  const client = context.supabase as unknown as RpcCallable;
  // Domena niewpięta = `not_configured` bez dotykania bazy; wpięta - jedno
  // wywołanie, które nigdy nie rzuca (`settle`).
  const readDomain = <T>(
    domain: RevenueDomain,
    parse: (raw: unknown) => T | null,
    w: Span,
  ): Promise<RpcOutcome<T>> => {
    const read = reads[domain];
    if (read === null) return Promise.resolve(NOT_CONFIGURED);
    const args: RevenueDomainWindow = { sinceIso: w.sinceIso, untilIso: w.untilIso, segment };
    return settle(REVENUE_DOMAIN_RPC[domain], parse, () => read(client, args));
  };

  // Pięć odczytów jednego okna naraz; awaria jednego gasi wyłącznie jego pola.
  const readWindow = async (w: Span): Promise<WindowReads> => {
    const [snapshot, funnel, events, clubs, email] = await Promise.all([
      // Editor NIGDY nie woła RPC finansowego - nie „woła i dostaje odmowę”.
      role === "admin"
        ? readDomain("snapshot", parseRevenueSemanticSnapshot, w)
        : Promise.resolve(ADMIN_ONLY),
      readDomain("funnel", parseRevenueFunnel, w),
      readDomain("events", parseRevenueEventsSummary, w),
      readDomain("clubs", parseRevenueClubsSummary, w),
      readDomain("email", parseRevenueEmailHealth, w),
    ]);
    return {
      snapshot,
      funnel,
      // Obrona w głąb: kwoty biletów dla editora wycinamy, nawet gdy SQL
      // przez pomyłkę by je oddał - finanse są wyłącznie adminowe.
      events:
        role === "editor" && events.value
          ? { ...events, value: { ...events.value, ticketRevenue: null } }
          : events,
      clubs,
      email,
    };
  };

  const [current, previous] = await Promise.all([
    readWindow(data.current),
    data.previous ? readWindow(data.previous) : Promise.resolve(null),
  ]);

  // JEDNA waluta wiodąca dla obu okien: filtr, a bez niego pierwsza waluta
  // z danych bieżących. Delta kwoty liczona w dwóch różnych walutach
  // porównywałaby złotówki z euro.
  const snap = current.snapshot.value;
  const currency =
    data.currency ??
    firstCurrency(
      snap?.money.mrr,
      snap?.money.revenue_realized,
      snap?.money.revenue_realized_orders,
      current.events.value?.ticketRevenue,
    );

  const bundleOf = (reads: WindowReads, w: Span): RevenueRawBundle => ({
    snapshot: reads.snapshot.value,
    funnel: reads.funnel.value,
    events: reads.events.value,
    clubs: reads.clubs.value,
    email: reads.email.value,
    window: {
      days: (Date.parse(w.untilIso) - Date.parse(w.sinceIso)) / DAY_MS,
      // Churn ROCZNY tylko na 12 pełnych miesiącach kalendarzowych.
      annual: data.period === "ltm",
    },
    ...(currency ? { currency } : {}),
  });

  const currentBundle = bundleOf(current, data.current);
  const entries = reconcileAll(revenueObservations(currentBundle), {
    window: canonicalOf(data.current),
  });

  const previousByMetric = new Map<MetricId, number | null>();
  if (previous && data.previous) {
    const prevEntries = reconcileAll(revenueObservations(bundleOf(previous, data.previous)), {
      window: canonicalOf(data.previous),
    });
    for (const e of prevEntries) previousByMetric.set(e.metricId, e.canonicalValue);
  }

  const deltas: SemanticDelta[] = entries.map((e) => {
    const prev = previousByMetric.get(e.metricId) ?? null;
    return {
      metricId: e.metricId,
      current: e.canonicalValue,
      previous: prev,
      deltaPct: deltaPct(e.canonicalValue, prev),
    };
  });

  // Strumień → jego RPC. Zamówienia (lifecycle) jadą wprawdzie w migawce
  // rozliczeń, ale o zdrowiu lejka mówi wyłącznie RPC lejka.
  const readsOf: Record<(typeof REVENUE_SNAPSHOT_STREAMS)[number], RpcOutcome<unknown>[]> = {
    billing: [current.snapshot],
    lifecycle: [current.funnel],
    community: [current.events, current.clubs],
    newsletter: [current.email],
  };
  const streams = REVENUE_SNAPSHOT_STREAMS.map((id) => healthOf(id, readsOf[id]));

  return {
    window: {
      period: data.period,
      sinceIso: data.current.sinceIso,
      untilIso: data.current.untilIso,
      offsetMinutes: data.offsetMinutes,
      complete: Date.parse(data.current.untilIso) <= Date.now(),
    },
    previous: data.previous
      ? { sinceIso: data.previous.sinceIso, untilIso: data.previous.untilIso }
      : null,
    entries,
    deltas,
    ratios: revenueRatios(currentBundle),
    streams,
    money: role === "admin" ? revenueMoney(currentBundle) : {},
    dataSince: snap?.dataSince ?? null,
    computedAt: snap?.computedAt ?? null,
    basisMix: snap?.basisMix ?? null,
    role,
  };
}

export const getRevenueSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => inputSchema.parse(i))
  .handler((ctx) => revenueSnapshotHandler(ctx, REVENUE_DOMAIN_READS));

// ---------------------------------------------------------------------------
// queryOptions - jedyny producent zapytania migawki (hub, BI, pulpit)
// ---------------------------------------------------------------------------

/**
 * Zapytanie migawki dla okna huba.
 *
 * Klucz z fabryki `revenueKeys.query("snapshot", …)` - reguły szyny zdarzeń
 * unieważniają prefiks `["admin-revenue", "snapshot", tenant]`, więc literał
 * gdziekolwiek indziej wypadłby spod inwalidacji. Okno rosnące odświeżamy
 * co minutę, domknięte trzyma się 30 minut (jak pulpit); poprzedni wynik
 * zostaje na ekranie przy zmianie okna (`keepPreviousData`), żeby kafle nie
 * skakały do zera. Bez najemcy zapytanie nie rusza - nie ma czyjej migawki
 * pytać.
 */
export function revenueSnapshotQueryOptions(
  tenantId: string | null,
  range: RevenueRange,
  filters: { currency?: string; segment?: RevenueSegment } = {},
) {
  return queryOptions({
    queryKey: revenueKeys.query("snapshot", tenantId ?? "", range, {
      currency: filters.currency ?? null,
      segment: filters.segment ?? null,
    }),
    queryFn: () =>
      getRevenueSnapshot({
        data: {
          period: range.period,
          current: range.current,
          previous: range.previous,
          offsetMinutes: range.offsetMinutes,
          ...(filters.currency ? { currency: filters.currency } : {}),
          ...(filters.segment ? { segment: filters.segment } : {}),
        },
      }),
    staleTime: range.complete ? 30 * 60_000 : 60_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
    enabled: Boolean(tenantId),
  });
}
