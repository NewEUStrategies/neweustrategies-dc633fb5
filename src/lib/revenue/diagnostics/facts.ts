// FAKTY DIAGNOSTYKI HUBA (S7, SPEC §5.7) - kontrakt `RevenueFacts v1`,
// tolerancyjny parser JSONB `admin_revenue_facts` i cegiełki oceny reguł.
//
// TOLERANCJA ZAMIAST WYJĄTKU. Inne parsery huba (lejek, inwentarz) RZUCAJĄ
// przy złym kształcie, bo ich zero jest wynikiem. Tu jest odwrotnie: fakty
// karmią 54 niezależne reguły, a obszar w trakcie wdrożenia (kolumna modułu,
// której jeszcze nie ma, równoległa zmiana I9d) nie może wyłączyć całej
// diagnozy. Pole brakujące albo zdeformowane znika (`undefined`), obszar
// spoza obiektu to `null` - reguła mówi wtedy „nie wiadomo" (`unknown`),
// NIGDY „w porządku" (SPEC §5.7: brak pola → unknown).
//
// KLUCZE camelCase WPROST Z SQL. Fakty mają jednego czytelnika (ten plik),
// więc funkcje `_revenue_facts_<obszar>` budują obiekty już w kształcie TS -
// bez drugiej mapy nazw, która rozjechałaby się przy pierwszym nowym polu.
// `REVENUE_FACTS_KEYS` (z `// rpc-shape`) jest przypięte w pgTAP i w teście
// parsera.
//
// ZERO PII. Fakty niosą liczby, flagi i identyfikatory (uuid albo klucz) -
// adres nadawcy newslettera to flaga `defaultSender`, lead to uuid. Pola
// dopisywane przez serwer (oznaczone „TS") liczy `getRevenueFacts`
// z modułów, których przeglądarka nie musi ładować (katalog zdarzeń, rejestr
// źródeł benchmarków, szablony ścieżek).
//
// LIŚĆ BEZ ZALEŻNOŚCI RUNTIME (poza typami): czyta go też `RevenueSignalChip`
// w modułach (paywall, cennik, CRM…), więc import nie może wciągać hooków ani
// klienta bazy do ich chunków.
import type { RevenueArea, RevenueSeverity } from "@/lib/admin/revenue/hubTabs";

// ---------------------------------------------------------------------------
// Kształt v1
// ---------------------------------------------------------------------------

/** Lista identyfikatorów z limitem 20 (SQL) - uuid albo `<typ>:<uuid>`. */
export type FactRefs = readonly string[];

export interface CountWithRefs {
  count?: number;
  withHits30d?: number;
  refs?: FactRefs;
}

export interface CatalogPlanFact {
  id: string;
  tierKey: string | null;
  tierFound: boolean;
  tierRank: number | null;
  active: boolean;
  forSale: boolean;
  interval: string;
  currency: string;
  /** Kwota - `null` dla redaktora (SPEC §2.5). */
  priceCents: number | null;
  catalogPair: boolean;
}

export interface CatalogTierFact {
  id: string;
  key: string;
  rank: number;
  active: boolean;
  pricingVisible: boolean;
  isDefault: boolean;
  ctaMode: string;
  plansForSale: number;
  plansNotForSale: number;
  /** Flagi `features` = true. */
  featureKeys: readonly string[];
  /** `benefits[].capability_key` - obietnice karty cennika (P20). */
  capabilityKeys: readonly string[];
}

/** Obietnica karty cennika bez bramki (TS, `capabilities.ts`). */
export interface PromiseGapFact {
  tierKey: string;
  capability: string;
  /** Warstwa w sprzedaży (aktywna, widoczna, z planem) - obietnica działa na klientów. */
  offerable: boolean;
}

export interface CatalogFacts {
  plans?: readonly CatalogPlanFact[];
  tiers?: readonly CatalogTierFact[];
  providerPriceDrift?: { forSale?: number; notForSale?: number; refs?: FactRefs };
  unknownPriceSubscriptions?: { unknownPrice?: number; missingAmount?: number };
  priceMigrations90d?: { applied?: number; pendingOver24h?: number; failed?: number };
  teamSeats?: { over?: number; atCap?: number; refs?: FactRefs };
  /** TS: flaga obiecana w benefitach, a warstwa jej nie ma (`broken`) albo bramki brak (`decorative`). */
  promiseGaps?: { broken: readonly PromiseGapFact[]; decorative: readonly PromiseGapFact[] };
}

export interface PaywallFacts {
  gatedRules?: number;
  firstGatedAt?: string | null;
  lastHitAt?: string | null;
  paidWithoutOffer?: CountWithRefs;
  membersRankNoCta?: CountWithRefs;
  danglingRules?: CountWithRefs & { planIds?: FactRefs };
}

export interface MeteringFacts {
  settingsRow?: boolean;
  enabled?: boolean | null;
  anonMonthlyLimit?: number | null;
  memberMonthlyLimit?: number | null;
  meteredRules?: number;
  meteredTierGated?: number;
  /** Sonda P19 w ciele `_metered_view_consume`; `null` = funkcji nie ma. */
  rankGatePresent?: boolean | null;
}

export interface PresentationFact {
  lang: "pl" | "en";
  displayCurrency: string;
  /** Waluty planów w sprzedaży różne od prezentowanej. */
  chargeCurrencies: readonly string[];
}

export interface CheckoutFacts {
  settingsRow?: boolean;
  abandonAfterMinutes?: number | null;
  abandonedJourneyActive?: boolean;
  chargeCurrencies?: readonly string[];
  /** TS: waluta prezentacji cennika per język (P09). */
  presentation?: readonly PresentationFact[];
}

export interface CouponsFacts {
  sentWithoutCodes?: { active?: number; expired?: number; refs?: FactRefs };
  expiringUnused?: { coupons?: number; campaigns?: number; refs?: FactRefs };
  grantTier?: { coupons?: number; columnPresent?: boolean };
}

export interface RetentionFacts {
  settingsRow?: boolean;
  enabled?: boolean | null;
  discountPeriods?: number | null;
  cancellations30d?: number;
  flowBypass?: { withoutFeedback?: number; providerOnly?: number; refs?: FactRefs };
  acceptedWithoutDiscount30d?: number;
  flows30d?: { started?: number; canceled?: number; saved?: number; abandoned?: number };
  /** TS: kroki ścieżki anulowania w dialogu (`RetentionDialog`). */
  cancelPathSteps?: number;
}

export interface DunningFacts {
  openB2b?: number;
  withoutTask?: number;
  journeyActive?: boolean;
  refs?: FactRefs;
}

export interface FunnelFacts {
  signups30d?: number;
  unknownSource30d?: number;
  popupMembers7d?: number;
  popupMembers30d?: number;
}

export interface CrmFacts {
  autoTasksUnassigned?: { open?: number; overdue?: number };
  qualifiedWithoutOwner?: { mqlSql?: number; opportunity?: number; refs?: FactRefs };
  withoutUserId?: { registered?: number; customer?: number };
  defaultAssigneeSet?: boolean;
}

export interface NewsletterFacts {
  settingsRow?: boolean;
  enabled?: boolean | null;
  doubleOptIn?: boolean | null;
  popupEnabled?: boolean | null;
  defaultSender?: boolean;
  campaignsSent30d?: number;
}

export interface WorkflowRefFact {
  id: string;
  templateKey: string | null;
  trigger: string;
}

export interface JourneyOverlapFact {
  workflowId: string;
  journeyId: string;
}

export interface WorkflowsFacts {
  newsletterConfirmedNoop?: { recent?: number; older?: number; refs?: FactRefs };
  cancelRecipe?: {
    id?: string;
    enabled?: boolean;
    guarded?: boolean;
    cancelledByPause30d?: number;
  } | null;
  enabled?: readonly WorkflowRefFact[];
  /** TS: przepis zastąpiony przez aktywną ścieżkę (`duplicates`) albo ten sam wyzwalacz. */
  overlaps?: { duplicates: readonly JourneyOverlapFact[]; sharedTrigger: readonly JourneyOverlapFact[] };
}

export interface JourneyGraphFact {
  id: string;
  templateKey: string | null;
  trigger: string | null;
  reentry: string | null;
  nodeTypes: readonly string[];
}

export interface JourneysFacts {
  engineEnabled?: boolean;
  activeCount?: number;
  activeTemplates?: readonly string[];
  pendingInbox?: number;
  oldestPendingAt?: string | null;
  stepRuns24h?: { finished?: number; failed?: number };
  deadSteps?: readonly { journeyId: string; unreached: number; total: number }[];
  deadJourneys?: number;
  graphs?: readonly JourneyGraphFact[];
  /** TS: cykle wyzwalaczy między aktywnymi ścieżkami (`ACTION_EMITS`). */
  cycles?: { bounded: number; unbounded: number; refs: FactRefs };
}

export interface EventsFacts {
  upcoming30d?: number;
  upcoming7dWithRegistrations?: number;
  nurtureActive?: boolean;
  ticketClaims?: { claimedPast?: number; unredeemed?: number };
}

export interface ClubsFacts {
  rankWithoutTier?: { impossible?: number; notOfferable?: number; refs?: FactRefs };
  pendingApplications?: { over7d?: number; over30d?: number; oldestAt?: string | null };
}

export interface SyncFacts {
  emitErrors24h?: number;
  emitErrors7d?: number;
  seenTypes90d?: readonly string[];
  silentWeekly?: readonly string[];
  silentDaily?: readonly string[];
  /** TS: typy katalogu szyny bez ani jednego zdarzenia w 90 dni. */
  deadTypes?: readonly string[];
  /** TS: typy z bazy spoza katalogu `DOMAIN_EVENT_TYPES` (dryf, br. 03 D7). */
  unknownTypes?: readonly string[];
}

export interface DataQualityFacts {
  documentsEnvUnknown?: { recent30d?: number; older?: number };
  /** `null` = brak migawek albo redaktor (kwoty). */
  mrrCatalogBasis?: { day?: string; share?: number | null } | null;
  ledgerDrift?: {
    day?: string;
    maxRatio?: number | null;
    currencies?: readonly { currency: string; ratio: number | null }[];
  } | null;
  live?: { subscriptions?: number; lastAt?: string | null };
  sandbox?: { subscriptions?: number; lastAt?: string | null };
  /** TS: źródła benchmarków S6 starsze niż `STALE_SOURCE_MONTHS`. */
  benchmarkSources?: { total: number; stale: number };
}

export interface RevenueFactAreas {
  catalog: CatalogFacts;
  paywall: PaywallFacts;
  metering: MeteringFacts;
  checkout: CheckoutFacts;
  coupons: CouponsFacts;
  retention: RetentionFacts;
  dunning: DunningFacts;
  funnel: FunnelFacts;
  crm: CrmFacts;
  newsletter: NewsletterFacts;
  workflows: WorkflowsFacts;
  journeys: JourneysFacts;
  events: EventsFacts;
  clubs: ClubsFacts;
  sync: SyncFacts;
  data_quality: DataQualityFacts;
}

export interface RevenueFacts {
  v: 1;
  computedAt: string | null;
  /** Obszar `null` albo nieobecny = nie wiadomo (awaria obszaru, brak źródła). */
  areas: { readonly [A in RevenueArea]?: RevenueFactAreas[A] | null };
}

// rpc-shape: admin_revenue_facts
export const REVENUE_FACTS_KEYS = {
  root: ["v", "computedAt", "areas"],
  catalog: [
    "plans",
    "tiers",
    "providerPriceDrift",
    "unknownPriceSubscriptions",
    "priceMigrations90d",
    "teamSeats",
  ],
  catalogPlan: [
    "id",
    "tierKey",
    "tierFound",
    "tierRank",
    "active",
    "forSale",
    "interval",
    "currency",
    "priceCents",
    "catalogPair",
  ],
  catalogTier: [
    "id",
    "key",
    "rank",
    "active",
    "pricingVisible",
    "isDefault",
    "ctaMode",
    "plansForSale",
    "plansNotForSale",
    "featureKeys",
    "capabilityKeys",
  ],
  paywall: [
    "gatedRules",
    "firstGatedAt",
    "lastHitAt",
    "paidWithoutOffer",
    "membersRankNoCta",
    "danglingRules",
  ],
  metering: [
    "settingsRow",
    "enabled",
    "anonMonthlyLimit",
    "memberMonthlyLimit",
    "meteredRules",
    "meteredTierGated",
    "rankGatePresent",
  ],
  checkout: ["settingsRow", "abandonAfterMinutes", "abandonedJourneyActive", "chargeCurrencies"],
  coupons: ["sentWithoutCodes", "expiringUnused", "grantTier"],
  retention: [
    "settingsRow",
    "enabled",
    "discountPeriods",
    "cancellations30d",
    "flowBypass",
    "acceptedWithoutDiscount30d",
    "flows30d",
  ],
  dunning: ["openB2b", "withoutTask", "journeyActive", "refs"],
  funnel: ["signups30d", "unknownSource30d", "popupMembers7d", "popupMembers30d"],
  crm: ["autoTasksUnassigned", "qualifiedWithoutOwner", "withoutUserId", "defaultAssigneeSet"],
  newsletter: [
    "settingsRow",
    "enabled",
    "doubleOptIn",
    "popupEnabled",
    "defaultSender",
    "campaignsSent30d",
  ],
  workflows: ["newsletterConfirmedNoop", "cancelRecipe", "enabled"],
  journeys: [
    "engineEnabled",
    "activeCount",
    "activeTemplates",
    "pendingInbox",
    "oldestPendingAt",
    "stepRuns24h",
    "deadSteps",
    "deadJourneys",
    "graphs",
  ],
  events: ["upcoming30d", "upcoming7dWithRegistrations", "nurtureActive", "ticketClaims"],
  clubs: ["rankWithoutTier", "pendingApplications"],
  sync: ["emitErrors24h", "emitErrors7d", "seenTypes90d", "silentWeekly", "silentDaily"],
  data_quality: ["documentsEnvUnknown", "mrrCatalogBasis", "ledgerDrift", "live", "sandbox"],
} as const;

// ---------------------------------------------------------------------------
// Parser (tolerancyjny)
// ---------------------------------------------------------------------------

type Bag = Readonly<Record<string, unknown>>;

function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Liczba skończona; `bigint` z PostgREST bywa napisem - przyjmujemy cyfry. */
function num(source: Bag, key: string): number | undefined {
  const value = source[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return undefined;
}

function numOrNull(source: Bag, key: string): number | null | undefined {
  return source[key] === null ? null : num(source, key);
}

function bool(source: Bag, key: string): boolean | undefined {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

function boolOrNull(source: Bag, key: string): boolean | null | undefined {
  return source[key] === null ? null : bool(source, key);
}

function text(source: Bag, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function textOrNull(source: Bag, key: string): string | null | undefined {
  return source[key] === null ? null : text(source, key);
}

function texts(source: Bag, key: string): readonly string[] | undefined {
  const value = source[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function bag(source: Bag, key: string): Bag | undefined {
  const value = source[key];
  return isBag(value) ? value : undefined;
}

/** Obiekt pól liczbowych (`{active, expired}`) - tylko klucze z listy. */
function counts<K extends string>(
  source: Bag,
  key: string,
  fields: readonly K[],
): Partial<Record<K, number>> | undefined {
  const inner = bag(source, key);
  if (!inner) return undefined;
  const out: Partial<Record<K, number>> = {};
  for (const field of fields) {
    const value = num(inner, field);
    if (value !== undefined) out[field] = value;
  }
  return out;
}

function countsWithRefs<K extends string>(
  source: Bag,
  key: string,
  fields: readonly K[],
): (Partial<Record<K, number>> & { refs?: FactRefs }) | undefined {
  const inner = bag(source, key);
  if (!inner) return undefined;
  const out: Partial<Record<K, number>> & { refs?: FactRefs } = { ...counts(source, key, fields) };
  const refs = texts(inner, "refs");
  if (refs) out.refs = refs;
  return out;
}

/** Usuwa pola `undefined` - fakty mają mówić tylko to, co wiadomo. */
function compact<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = v;
  return out as T;
}

function list<T>(source: Bag, key: string, item: (raw: Bag) => T | null): readonly T[] | undefined {
  const value = source[key];
  if (!Array.isArray(value)) return undefined;
  const out: T[] = [];
  for (const raw of value) {
    if (!isBag(raw)) continue;
    const parsed = item(raw);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

function parsePlan(raw: Bag): CatalogPlanFact | null {
  const id = text(raw, "id");
  const tierFound = bool(raw, "tierFound");
  const active = bool(raw, "active");
  const forSale = bool(raw, "forSale");
  const catalogPair = bool(raw, "catalogPair");
  const interval = text(raw, "interval");
  if (
    id === undefined ||
    tierFound === undefined ||
    active === undefined ||
    forSale === undefined ||
    catalogPair === undefined ||
    interval === undefined
  ) {
    return null;
  }
  return {
    id,
    tierKey: text(raw, "tierKey") ?? null,
    tierFound,
    tierRank: num(raw, "tierRank") ?? null,
    active,
    forSale,
    interval,
    currency: (text(raw, "currency") ?? "").toUpperCase(),
    priceCents: num(raw, "priceCents") ?? null,
    catalogPair,
  };
}

function parseTier(raw: Bag): CatalogTierFact | null {
  const id = text(raw, "id");
  const key = text(raw, "key");
  const rank = num(raw, "rank");
  const active = bool(raw, "active");
  const pricingVisible = bool(raw, "pricingVisible");
  if (
    id === undefined ||
    key === undefined ||
    rank === undefined ||
    active === undefined ||
    pricingVisible === undefined
  ) {
    return null;
  }
  return {
    id,
    key,
    rank,
    active,
    pricingVisible,
    isDefault: bool(raw, "isDefault") ?? false,
    ctaMode: text(raw, "ctaMode") ?? "auto",
    plansForSale: num(raw, "plansForSale") ?? 0,
    plansNotForSale: num(raw, "plansNotForSale") ?? 0,
    featureKeys: texts(raw, "featureKeys") ?? [],
    capabilityKeys: texts(raw, "capabilityKeys") ?? [],
  };
}

function parsePromiseGaps(source: Bag): CatalogFacts["promiseGaps"] {
  const inner = bag(source, "promiseGaps");
  if (!inner) return undefined;
  const gap = (raw: Bag): PromiseGapFact | null => {
    const tierKey = text(raw, "tierKey");
    const capability = text(raw, "capability");
    if (tierKey === undefined || capability === undefined) return null;
    return { tierKey, capability, offerable: bool(raw, "offerable") ?? false };
  };
  return { broken: list(inner, "broken", gap) ?? [], decorative: list(inner, "decorative", gap) ?? [] };
}

function parseCatalog(raw: Bag): CatalogFacts {
  return compact({
    plans: list(raw, "plans", parsePlan),
    tiers: list(raw, "tiers", parseTier),
    providerPriceDrift: countsWithRefs(raw, "providerPriceDrift", ["forSale", "notForSale"]),
    unknownPriceSubscriptions: counts(raw, "unknownPriceSubscriptions", [
      "unknownPrice",
      "missingAmount",
    ]),
    priceMigrations90d: counts(raw, "priceMigrations90d", ["applied", "pendingOver24h", "failed"]),
    teamSeats: countsWithRefs(raw, "teamSeats", ["over", "atCap"]),
    promiseGaps: parsePromiseGaps(raw),
  });
}

function parseDeadEnd(source: Bag, key: string): CountWithRefs | undefined {
  return countsWithRefs(source, key, ["count", "withHits30d"]);
}

function parsePaywall(raw: Bag): PaywallFacts {
  const dangling = parseDeadEnd(raw, "danglingRules");
  const planIds = bag(raw, "danglingRules") ? texts(bag(raw, "danglingRules")!, "planIds") : undefined;
  return compact({
    gatedRules: num(raw, "gatedRules"),
    firstGatedAt: textOrNull(raw, "firstGatedAt"),
    lastHitAt: textOrNull(raw, "lastHitAt"),
    paidWithoutOffer: parseDeadEnd(raw, "paidWithoutOffer"),
    membersRankNoCta: parseDeadEnd(raw, "membersRankNoCta"),
    danglingRules: dangling ? compact({ ...dangling, planIds }) : undefined,
  });
}

function parseMetering(raw: Bag): MeteringFacts {
  return compact({
    settingsRow: bool(raw, "settingsRow"),
    enabled: boolOrNull(raw, "enabled"),
    anonMonthlyLimit: numOrNull(raw, "anonMonthlyLimit"),
    memberMonthlyLimit: numOrNull(raw, "memberMonthlyLimit"),
    meteredRules: num(raw, "meteredRules"),
    meteredTierGated: num(raw, "meteredTierGated"),
    rankGatePresent: boolOrNull(raw, "rankGatePresent"),
  });
}

function parsePresentation(raw: Bag): PresentationFact | null {
  const lang = text(raw, "lang");
  const displayCurrency = text(raw, "displayCurrency");
  if ((lang !== "pl" && lang !== "en") || displayCurrency === undefined) return null;
  return { lang, displayCurrency, chargeCurrencies: texts(raw, "chargeCurrencies") ?? [] };
}

function parseCheckout(raw: Bag): CheckoutFacts {
  return compact({
    settingsRow: bool(raw, "settingsRow"),
    abandonAfterMinutes: numOrNull(raw, "abandonAfterMinutes"),
    abandonedJourneyActive: bool(raw, "abandonedJourneyActive"),
    chargeCurrencies: texts(raw, "chargeCurrencies"),
    presentation: list(raw, "presentation", parsePresentation),
  });
}

function parseCoupons(raw: Bag): CouponsFacts {
  const grant = bag(raw, "grantTier");
  return compact({
    sentWithoutCodes: countsWithRefs(raw, "sentWithoutCodes", ["active", "expired"]),
    expiringUnused: countsWithRefs(raw, "expiringUnused", ["coupons", "campaigns"]),
    grantTier: grant
      ? compact({ coupons: num(grant, "coupons"), columnPresent: bool(grant, "columnPresent") })
      : undefined,
  });
}

function parseRetention(raw: Bag): RetentionFacts {
  return compact({
    settingsRow: bool(raw, "settingsRow"),
    enabled: boolOrNull(raw, "enabled"),
    discountPeriods: numOrNull(raw, "discountPeriods"),
    cancellations30d: num(raw, "cancellations30d"),
    flowBypass: countsWithRefs(raw, "flowBypass", ["withoutFeedback", "providerOnly"]),
    acceptedWithoutDiscount30d: num(raw, "acceptedWithoutDiscount30d"),
    flows30d: counts(raw, "flows30d", ["started", "canceled", "saved", "abandoned"]),
    cancelPathSteps: num(raw, "cancelPathSteps"),
  });
}

function parseDunning(raw: Bag): DunningFacts {
  return compact({
    openB2b: num(raw, "openB2b"),
    withoutTask: num(raw, "withoutTask"),
    journeyActive: bool(raw, "journeyActive"),
    refs: texts(raw, "refs"),
  });
}

function parseFunnel(raw: Bag): FunnelFacts {
  return compact({
    signups30d: num(raw, "signups30d"),
    unknownSource30d: num(raw, "unknownSource30d"),
    popupMembers7d: num(raw, "popupMembers7d"),
    popupMembers30d: num(raw, "popupMembers30d"),
  });
}

function parseCrm(raw: Bag): CrmFacts {
  return compact({
    autoTasksUnassigned: counts(raw, "autoTasksUnassigned", ["open", "overdue"]),
    qualifiedWithoutOwner: countsWithRefs(raw, "qualifiedWithoutOwner", ["mqlSql", "opportunity"]),
    withoutUserId: counts(raw, "withoutUserId", ["registered", "customer"]),
    defaultAssigneeSet: bool(raw, "defaultAssigneeSet"),
  });
}

function parseNewsletter(raw: Bag): NewsletterFacts {
  return compact({
    settingsRow: bool(raw, "settingsRow"),
    enabled: boolOrNull(raw, "enabled"),
    doubleOptIn: boolOrNull(raw, "doubleOptIn"),
    popupEnabled: boolOrNull(raw, "popupEnabled"),
    defaultSender: bool(raw, "defaultSender"),
    campaignsSent30d: num(raw, "campaignsSent30d"),
  });
}

function parseOverlap(raw: Bag): JourneyOverlapFact | null {
  const workflowId = text(raw, "workflowId");
  const journeyId = text(raw, "journeyId");
  return workflowId !== undefined && journeyId !== undefined ? { workflowId, journeyId } : null;
}

function parseWorkflows(raw: Bag): WorkflowsFacts {
  const recipe = raw.cancelRecipe;
  const overlaps = bag(raw, "overlaps");
  return compact({
    newsletterConfirmedNoop: countsWithRefs(raw, "newsletterConfirmedNoop", ["recent", "older"]),
    cancelRecipe:
      recipe === null
        ? null
        : isBag(recipe)
          ? compact({
              id: text(recipe, "id"),
              enabled: bool(recipe, "enabled"),
              guarded: bool(recipe, "guarded"),
              cancelledByPause30d: num(recipe, "cancelledByPause30d"),
            })
          : undefined,
    enabled: list(raw, "enabled", (item): WorkflowRefFact | null => {
      const id = text(item, "id");
      const trigger = text(item, "trigger");
      if (id === undefined || trigger === undefined) return null;
      return { id, trigger, templateKey: text(item, "templateKey") ?? null };
    }),
    overlaps: overlaps
      ? {
          duplicates: list(overlaps, "duplicates", parseOverlap) ?? [],
          sharedTrigger: list(overlaps, "sharedTrigger", parseOverlap) ?? [],
        }
      : undefined,
  });
}

function parseJourneys(raw: Bag): JourneysFacts {
  const cycles = bag(raw, "cycles");
  return compact({
    engineEnabled: bool(raw, "engineEnabled"),
    activeCount: num(raw, "activeCount"),
    activeTemplates: texts(raw, "activeTemplates"),
    pendingInbox: num(raw, "pendingInbox"),
    oldestPendingAt: textOrNull(raw, "oldestPendingAt"),
    stepRuns24h: counts(raw, "stepRuns24h", ["finished", "failed"]),
    deadSteps: list(raw, "deadSteps", (item) => {
      const journeyId = text(item, "journeyId");
      const unreached = num(item, "unreached");
      const total = num(item, "total");
      if (journeyId === undefined || unreached === undefined || total === undefined) return null;
      return { journeyId, unreached, total };
    }),
    deadJourneys: num(raw, "deadJourneys"),
    graphs: list(raw, "graphs", (item): JourneyGraphFact | null => {
      const id = text(item, "id");
      if (id === undefined) return null;
      return {
        id,
        templateKey: text(item, "templateKey") ?? null,
        trigger: text(item, "trigger") ?? null,
        reentry: text(item, "reentry") ?? null,
        nodeTypes: texts(item, "nodeTypes") ?? [],
      };
    }),
    cycles: cycles
      ? {
          bounded: num(cycles, "bounded") ?? 0,
          unbounded: num(cycles, "unbounded") ?? 0,
          refs: texts(cycles, "refs") ?? [],
        }
      : undefined,
  });
}

function parseEvents(raw: Bag): EventsFacts {
  return compact({
    upcoming30d: num(raw, "upcoming30d"),
    upcoming7dWithRegistrations: num(raw, "upcoming7dWithRegistrations"),
    nurtureActive: bool(raw, "nurtureActive"),
    ticketClaims: counts(raw, "ticketClaims", ["claimedPast", "unredeemed"]),
  });
}

function parseClubs(raw: Bag): ClubsFacts {
  const pending = bag(raw, "pendingApplications");
  return compact({
    rankWithoutTier: countsWithRefs(raw, "rankWithoutTier", ["impossible", "notOfferable"]),
    pendingApplications: pending
      ? compact({
          over7d: num(pending, "over7d"),
          over30d: num(pending, "over30d"),
          oldestAt: textOrNull(pending, "oldestAt"),
        })
      : undefined,
  });
}

function parseSync(raw: Bag): SyncFacts {
  return compact({
    emitErrors24h: num(raw, "emitErrors24h"),
    emitErrors7d: num(raw, "emitErrors7d"),
    seenTypes90d: texts(raw, "seenTypes90d"),
    silentWeekly: texts(raw, "silentWeekly"),
    silentDaily: texts(raw, "silentDaily"),
    deadTypes: texts(raw, "deadTypes"),
    unknownTypes: texts(raw, "unknownTypes"),
  });
}

function parseDataQuality(raw: Bag): DataQualityFacts {
  const basis = raw.mrrCatalogBasis;
  const drift = raw.ledgerDrift;
  const live = bag(raw, "live");
  const sandbox = bag(raw, "sandbox");
  const sources = bag(raw, "benchmarkSources");
  return compact({
    documentsEnvUnknown: counts(raw, "documentsEnvUnknown", ["recent30d", "older"]),
    mrrCatalogBasis:
      basis === null
        ? null
        : isBag(basis)
          ? compact({ day: text(basis, "day"), share: numOrNull(basis, "share") })
          : undefined,
    ledgerDrift:
      drift === null
        ? null
        : isBag(drift)
          ? compact({
              day: text(drift, "day"),
              maxRatio: numOrNull(drift, "maxRatio"),
              currencies: list(drift, "currencies", (item) => {
                const currency = text(item, "currency");
                if (currency === undefined) return null;
                return { currency, ratio: num(item, "ratio") ?? null };
              }),
            })
          : undefined,
    live: live
      ? compact({ subscriptions: num(live, "subscriptions"), lastAt: textOrNull(live, "lastAt") })
      : undefined,
    sandbox: sandbox
      ? compact({
          subscriptions: num(sandbox, "subscriptions"),
          lastAt: textOrNull(sandbox, "lastAt"),
        })
      : undefined,
    benchmarkSources:
      sources && num(sources, "total") !== undefined && num(sources, "stale") !== undefined
        ? { total: num(sources, "total") as number, stale: num(sources, "stale") as number }
        : undefined,
  });
}

const AREA_PARSERS: {
  readonly [A in RevenueArea]: (raw: Bag) => RevenueFactAreas[A];
} = {
  catalog: parseCatalog,
  paywall: parsePaywall,
  metering: parseMetering,
  checkout: parseCheckout,
  coupons: parseCoupons,
  retention: parseRetention,
  dunning: parseDunning,
  funnel: parseFunnel,
  crm: parseCrm,
  newsletter: parseNewsletter,
  workflows: parseWorkflows,
  journeys: parseJourneys,
  events: parseEvents,
  clubs: parseClubs,
  sync: parseSync,
  data_quality: parseDataQuality,
};

/** Pusty zestaw faktów - każda reguła ocenia go jako „nie wiadomo". */
export const EMPTY_REVENUE_FACTS: RevenueFacts = { v: 1, computedAt: null, areas: {} };

/**
 * JSONB `admin_revenue_facts` (albo fakty już scalone przez serwer) →
 * `RevenueFacts`. Nieznana wersja albo nie-obiekt = zestaw pusty („nie
 * wiadomo" w każdej regule), nigdy wyjątek.
 */
export function parseRevenueFacts(raw: unknown): RevenueFacts {
  if (!isBag(raw) || raw.v !== 1) return EMPTY_REVENUE_FACTS;
  const areasRaw = bag(raw, "areas") ?? {};
  const areas: Record<string, unknown> = {};
  for (const [area, parse] of Object.entries(AREA_PARSERS) as [RevenueArea, (raw: Bag) => unknown][]) {
    const value = areasRaw[area];
    if (value === null) areas[area] = null;
    else if (isBag(value)) areas[area] = parse(value);
  }
  return {
    v: 1,
    computedAt: text(raw, "computedAt") ?? null,
    areas: areas as RevenueFacts["areas"],
  };
}

/** Fakty obszaru albo `null` (nie wiadomo) - jeden odczyt dla każdej reguły. */
export function areaFacts<A extends RevenueArea>(
  facts: RevenueFacts,
  area: A,
): RevenueFactAreas[A] | null {
  return facts.areas[area] ?? null;
}

// ---------------------------------------------------------------------------
// Ocena reguły - wynik i cegiełki
// ---------------------------------------------------------------------------

export type RevenueCheckState = "ok" | "warn" | "error" | "unknown";
export type RevenueImpact = "high" | "medium" | "low";

/** Dowód: klucz słownika `adminRevenue.evidence.<key>` + parametry (liczby, kody). */
export interface RevenueEvidence {
  key: string;
  params: Readonly<Record<string, string | number>>;
}

export interface RevenueCheckResult {
  state: RevenueCheckState;
  count?: number;
  refs?: readonly string[];
  evidence?: readonly RevenueEvidence[];
  impact?: RevenueImpact;
  factHash?: string;
}

export const OK: RevenueCheckResult = { state: "ok" };
export const UNKNOWN: RevenueCheckResult = { state: "unknown" };

/** Wynik „problem": `error` = skutek trwa teraz, `warn` = problem uśpiony albo ograniczony. */
export function finding(
  state: "warn" | "error",
  input: {
    count?: number;
    refs?: readonly string[];
    evidence: RevenueEvidence | readonly RevenueEvidence[];
    impact?: RevenueImpact;
  },
): RevenueCheckResult {
  const evidence: readonly RevenueEvidence[] = Array.isArray(input.evidence)
    ? (input.evidence as readonly RevenueEvidence[])
    : [input.evidence as RevenueEvidence];
  return compact({ state, count: input.count, refs: input.refs, evidence, impact: input.impact });
}

/** Dowód z parametrami (kod klucza bez prefiksu `adminRevenue.evidence.`). */
export function ev(key: string, params: Record<string, string | number> = {}): RevenueEvidence {
  return { key, params };
}

/**
 * Wpływ, gdy reguła go nie poda: skutek trwający (`error`) przy wadze
 * krytycznej albo ważnej = wysoki; ważna uśpiona i informacyjna trwająca =
 * średni; reszta = niski. Ta sama skala co kondycja obszarów (krytyczna
 * kosztuje najwięcej), więc „Wymaga uwagi" i wynik 0-100 mówią to samo.
 */
export function defaultImpact(severity: RevenueSeverity, state: RevenueCheckState): RevenueImpact {
  if (state === "error") return severity === "info" ? "medium" : "high";
  if (state === "warn") return severity === "critical" ? "medium" : "low";
  return "low";
}

/**
 * Odcisk faktów diagnozy (FNV-1a, 32 bity, szesnastkowo) - `scope_hash`
 * wyciszenia „świadomie tak ma być": zmiana liczby albo listy obiektów
 * zmienia odcisk, więc wyciszenie przestaje obowiązywać i diagnoza wraca.
 * Kolejność `refs` nie ma znaczenia (sortujemy), stan ma.
 */
export function factHashOf(result: Pick<RevenueCheckResult, "state" | "count" | "refs">): string {
  const input = `${result.state}|${result.count ?? ""}|${[...(result.refs ?? [])].sort().join(",")}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `f1:${hash.toString(16).padStart(8, "0")}`;
}

/** Suma pól liczbowych z pominięciem brakujących; `undefined`, gdy brak wszystkich. */
export function sumKnown(...values: (number | undefined)[]): number | undefined {
  const known = values.filter((v): v is number => v !== undefined);
  return known.length === 0 ? undefined : known.reduce((a, b) => a + b, 0);
}
