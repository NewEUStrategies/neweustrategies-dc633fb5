/**
 * Serwerowa funkcja warstwy semantycznej: JEDNA migawka wszystkich strumieni dla
 * JEDNEGO okna, z uzgodnionymi liczbami i klasyfikacją rozjazdu.
 *
 * To jest punkt, w którym fragmentacja przestaje być widoczna dla konsumenta.
 * Zamiast sześciu zapytań o sześć różnych przedziałów czasu (każde z własnym
 * pojęciem „odsłony”), wywołujący dostaje:
 *
 *   - `entries`   - metryki kanoniczne z JEDNĄ wartością do zacytowania,
 *                   werdyktem uzgodnienia i powodami rozjazdu,
 *   - `deltas`    - zmiana wobec okna poprzedniego, ROZŁĄCZNEGO z bieżącym,
 *   - `ratios`    - metryki złożone policzone wyłącznie wewnątrz jednego strumienia,
 *   - `streams`   - dostępność każdego strumienia (czego w liczbach NIE MA),
 *   - `window`    - granice, ziarno i zastrzeżenia okna.
 *
 * Bezpieczeństwo: bramka roli admina najemcy wywołującego, a odczyt first-party
 * idzie przez `analytics_semantic_snapshot`, który sam bierze `tenant_id` z
 * profilu wywołującego (nie z parametru ani z nagłówka hosta).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AnalyticsGatewayCtx } from "@/lib/analytics/gateway.server";
import {
  STREAMS,
  type CanonicalWindow,
  type Ga4DateRange,
  type MetricId,
  type ReconciliationEntry,
  type StreamId,
  type StreamObservation,
  type WindowNote,
  type WindowPresetId,
  previousWindow,
  reconcileAll,
  resolveCustomWindow,
  resolveWindow,
  safeRatio,
} from ".";

// ---------------------------------------------------------------------------
// Kontrakt wyniku
// ---------------------------------------------------------------------------

/**
 * Okno w odpowiedzi. Kształt jest STRUKTURALNIE zgodny z `CanonicalWindow`
 * (te same nazwy pól, w tym zagnieżdżone `ga4`), więc komponenty prezentacyjne
 * przyjmują jedno i drugie bez adapterów i bez rzutowań.
 */
export interface SemanticWindowDto {
  readonly presetId: string;
  readonly sinceIso: string;
  readonly untilIso: string;
  readonly days: number;
  readonly grain: CanonicalWindow["grain"];
  readonly crossStreamSafe: boolean;
  readonly notes: readonly WindowNote[];
  readonly ga4: Ga4DateRange;
}

export interface SemanticDelta {
  readonly metricId: MetricId;
  readonly current: number | null;
  readonly previous: number | null;
  /** Zmiana procentowa; `null`, gdy baza jest zerowa albo brak danych. */
  readonly deltaPct: number | null;
}

export interface SemanticRatio {
  readonly metricId: MetricId;
  readonly value: number | null;
  readonly reason?: string;
}

export interface SemanticStreamHealth {
  readonly streamId: StreamId;
  readonly available: boolean;
  /** Kod przyczyny niedostępności - tłumaczony w UI. */
  readonly reason?: "not_configured" | "read_failed" | "no_data";
}

export interface SemanticSnapshotResult {
  readonly window: SemanticWindowDto;
  readonly previous: Pick<SemanticWindowDto, "sinceIso" | "untilIso">;
  readonly entries: readonly ReconciliationEntry[];
  readonly deltas: readonly SemanticDelta[];
  readonly ratios: readonly SemanticRatio[];
  readonly streams: readonly SemanticStreamHealth[];
  readonly ga4Configured: boolean;
  /** Komunikat błędu GA4 (np. brak uprawnień property) - pokazywany adminowi. */
  readonly ga4Error?: string;
}

// ---------------------------------------------------------------------------
// Kształt odpowiedzi RPC (jsonb) - czytany defensywnie, bez rzutowań na any
// ---------------------------------------------------------------------------

interface RawFirstParty {
  events_total?: number;
  page_views?: number;
  entity_views?: number;
  cta_clicks?: number;
  searches?: number;
  sessions?: number;
  visitors?: number;
  signed_in_users?: number;
}
interface RawVitalsMetric {
  p75?: number;
  samples?: number;
}
interface RawVitals {
  samples?: number;
  metrics?: Record<string, RawVitalsMetric>;
}
interface RawAds {
  impressions?: number;
  clicks?: number;
}
interface RawNewsletter {
  opens?: number;
  clicks?: number;
  distinct_openers?: number;
  distinct_clickers?: number;
  campaigns?: number;
}
interface RawContent {
  content_views?: number;
  unique_viewers?: number;
  related_clicks?: number;
  reads?: number;
}
interface RawSnapshot {
  first_party?: RawFirstParty;
  web_vitals?: RawVitals;
  ad_events?: RawAds;
  newsletter?: RawNewsletter;
  content_views?: RawContent;
}

/** Liczba albo `null` - nigdy `0` w zastępstwie brakującej wartości. */
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Bezpieczne odczytanie migawki z `jsonb` zwróconego przez PostgREST. */
function parseSnapshot(raw: unknown): RawSnapshot {
  if (!isRecord(raw)) return {};
  return raw as RawSnapshot;
}

/** Okno kanoniczne jako DTO odpowiedzi (bez pól potrzebnych tylko po stronie serwera). */
const toWindowDto = (w: CanonicalWindow): SemanticWindowDto => ({
  presetId: w.presetId,
  sinceIso: w.sinceIso,
  untilIso: w.untilIso,
  days: w.days,
  grain: w.grain,
  crossStreamSafe: w.crossStreamSafe,
  notes: w.notes,
  ga4: w.ga4,
});

// ---------------------------------------------------------------------------
// Mapowanie obserwacji: strumień -> metryka kanoniczna
// ---------------------------------------------------------------------------

interface StreamValues {
  readonly firstParty: RawFirstParty;
  readonly vitals: RawVitals;
  readonly ads: RawAds;
  readonly newsletter: RawNewsletter;
  readonly content: RawContent;
  readonly ga4: ReadonlyMap<string, number>;
}

/** Metryki GA4 potrzebne warstwie semantycznej (totale, bez wymiarów). */
const GA4_METRICS: readonly string[] = [
  "sessions",
  "activeUsers",
  "screenPageViews",
  "engagementRate",
];

function vitalP75(vitals: RawVitals, metric: "LCP" | "INP" | "CLS"): number | null {
  return num(vitals.metrics?.[metric]?.p75);
}

/**
 * Obserwacje per metryka kanoniczna. Każda wartość jest podpisana strumieniem,
 * z którego pochodzi - dzięki temu `reconcileAll` może zastosować reguły
 * porównywalności ze słownika, a nie zgadywać.
 */
function buildObservations(
  v: StreamValues,
): ReadonlyArray<{ metricId: MetricId; observations: readonly StreamObservation[] }> {
  const ga4 = (name: string): number | null => {
    const found = v.ga4.get(name);
    return typeof found === "number" ? found : null;
  };

  return [
    {
      metricId: "sessions",
      observations: [
        { streamId: "ga4", value: ga4("sessions") },
        { streamId: "first_party", value: num(v.firstParty.sessions) },
      ],
    },
    {
      metricId: "visitors",
      observations: [
        { streamId: "ga4", value: ga4("activeUsers") },
        { streamId: "first_party", value: num(v.firstParty.visitors) },
      ],
    },
    {
      metricId: "page_views",
      observations: [
        { streamId: "ga4", value: ga4("screenPageViews") },
        { streamId: "first_party", value: num(v.firstParty.page_views) },
      ],
    },
    {
      metricId: "engagement_rate",
      observations: [{ streamId: "ga4", value: ga4("engagementRate") }],
    },
    {
      metricId: "cta_clicks",
      observations: [{ streamId: "first_party", value: num(v.firstParty.cta_clicks) }],
    },
    {
      metricId: "internal_searches",
      observations: [{ streamId: "first_party", value: num(v.firstParty.searches) }],
    },
    {
      metricId: "lcp_p75",
      observations: [
        {
          streamId: "web_vitals",
          value: vitalP75(v.vitals, "LCP"),
          samples: num(v.vitals.metrics?.LCP?.samples) ?? undefined,
        },
      ],
    },
    {
      metricId: "inp_p75",
      observations: [
        {
          streamId: "web_vitals",
          value: vitalP75(v.vitals, "INP"),
          samples: num(v.vitals.metrics?.INP?.samples) ?? undefined,
        },
      ],
    },
    {
      metricId: "cls_p75",
      observations: [
        {
          streamId: "web_vitals",
          value: vitalP75(v.vitals, "CLS"),
          samples: num(v.vitals.metrics?.CLS?.samples) ?? undefined,
        },
      ],
    },
    {
      metricId: "ad_impressions",
      observations: [{ streamId: "ad_events", value: num(v.ads.impressions) }],
    },
    {
      metricId: "ad_clicks",
      observations: [{ streamId: "ad_events", value: num(v.ads.clicks) }],
    },
    {
      metricId: "email_opens",
      observations: [{ streamId: "newsletter", value: num(v.newsletter.opens) }],
    },
    {
      metricId: "email_clicks",
      observations: [{ streamId: "newsletter", value: num(v.newsletter.clicks) }],
    },
    {
      metricId: "content_views",
      observations: [{ streamId: "content_views", value: num(v.content.content_views) }],
    },
    {
      metricId: "related_clicks",
      observations: [{ streamId: "content_views", value: num(v.content.related_clicks) }],
    },
    {
      metricId: "reads",
      observations: [{ streamId: "content_views", value: num(v.content.reads) }],
    },
  ];
}

/** Metryki, dla których pokazujemy zmianę wobec okna poprzedniego. */
const DELTA_METRICS: readonly MetricId[] = [
  "sessions",
  "visitors",
  "page_views",
  "content_views",
  "engagement_rate",
  "cta_clicks",
  "related_clicks",
];

function deltaPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

// ---------------------------------------------------------------------------
// Serwerowa funkcja
// ---------------------------------------------------------------------------

const inputSchema = z
  .object({
    presetId: z.enum(["24h", "7d", "14d", "28d", "30d", "90d"]).default("28d"),
    sinceIso: z.string().datetime().optional(),
    untilIso: z.string().datetime().optional(),
    includeOpenDay: z.boolean().default(false),
  })
  .refine((v) => (v.sinceIso === undefined) === (v.untilIso === undefined), {
    message: "sinceIso and untilIso must be provided together",
  });

export const getSemanticSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => inputSchema.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<SemanticSnapshotResult> => {
    const { requireAnalyticsAdmin, readStoredAnalyticsSettings } =
      await import("@/lib/analytics/gateway.server");
    const ctx = context as unknown as AnalyticsGatewayCtx;
    await requireAnalyticsAdmin(ctx);

    const current =
      data.sinceIso && data.untilIso
        ? resolveCustomWindow(data.sinceIso, data.untilIso)
        : resolveWindow({
            presetId: data.presetId as WindowPresetId,
            includeOpenDay: data.includeOpenDay,
          });
    const previous = previousWindow(current);

    // --- strumienie first-party: jeden RPC na okno, identyczne granice ---
    const readSnapshot = async (w: CanonicalWindow): Promise<RawSnapshot | null> => {
      const { data: raw, error } = await ctx.supabase.rpc("analytics_semantic_snapshot", {
        p_since: w.sinceIso,
        p_until: w.untilIso,
      });
      if (error) {
        console.warn("[semantic] snapshot RPC failed:", error.message);
        return null;
      }
      return parseSnapshot(raw);
    };

    const [currentRaw, previousRaw] = await Promise.all([
      readSnapshot(current),
      readSnapshot(previous),
    ]);

    // --- GA4: te same dni co Postgres, wyprowadzone z granic okna ---
    const stored = await readStoredAnalyticsSettings(ctx);
    const {
      EMPTY_GA4_REPORT,
      ga4TotalsMap,
      resolveGa4AccessToken,
      resolveGa4PropertyId,
      runGa4DataApiReport,
    } = await import("@/lib/analytics/ga4.server");

    const propertyId =
      stored.ga4_enabled === false ? undefined : resolveGa4PropertyId(stored.ga4_property_id);
    const auth = propertyId ? await resolveGa4AccessToken() : null;
    const ga4Configured = Boolean(propertyId && auth);

    const [ga4Current, ga4Previous] =
      ga4Configured && propertyId && auth
        ? await Promise.all([
            runGa4DataApiReport(
              {
                propertyId,
                startDate: current.ga4.startDate,
                endDate: current.ga4.endDate,
                dimensions: [],
                metrics: GA4_METRICS,
                limit: 1,
              },
              auth.token,
            ),
            runGa4DataApiReport(
              {
                propertyId,
                startDate: previous.ga4.startDate,
                endDate: previous.ga4.endDate,
                dimensions: [],
                metrics: GA4_METRICS,
                limit: 1,
              },
              auth.token,
            ),
          ])
        : [EMPTY_GA4_REPORT, EMPTY_GA4_REPORT];

    const valuesFor = (
      raw: RawSnapshot | null,
      ga4: ReadonlyMap<string, number>,
    ): StreamValues => ({
      firstParty: raw?.first_party ?? {},
      vitals: raw?.web_vitals ?? {},
      ads: raw?.ad_events ?? {},
      newsletter: raw?.newsletter ?? {},
      content: raw?.content_views ?? {},
      ga4,
    });

    const currentValues = valuesFor(currentRaw, ga4TotalsMap(ga4Current));
    const previousValues = valuesFor(previousRaw, ga4TotalsMap(ga4Previous));

    const currentObservations = buildObservations(currentValues);
    const entries = reconcileAll(currentObservations, { window: current });
    const previousEntries = reconcileAll(buildObservations(previousValues), { window: previous });

    const previousByMetric = new Map(previousEntries.map((e) => [e.metricId, e.canonicalValue]));
    const currentByMetric = new Map(entries.map((e) => [e.metricId, e.canonicalValue]));

    const deltas: SemanticDelta[] = DELTA_METRICS.map((metricId) => {
      const cur = currentByMetric.get(metricId) ?? null;
      const prev = previousByMetric.get(metricId) ?? null;
      return { metricId, current: cur, previous: prev, deltaPct: deltaPct(cur, prev) };
    });

    // Metryki złożone liczone WYŁĄCZNIE wewnątrz jednego strumienia - inaczej
    // bramka zgody się nie skraca (patrz safeRatio).
    const ratios: SemanticRatio[] = [
      {
        metricId: "ad_ctr",
        ...safeRatio(
          { metricId: "ad_clicks", value: currentByMetric.get("ad_clicks") ?? null },
          { metricId: "ad_impressions", value: currentByMetric.get("ad_impressions") ?? null },
        ),
      },
      {
        metricId: "email_ctr",
        ...safeRatio(
          { metricId: "email_clicks", value: currentByMetric.get("email_clicks") ?? null },
          { metricId: "email_opens", value: currentByMetric.get("email_opens") ?? null },
        ),
      },
    ];

    // Strumienie, które W TYM OKNIE dowiozły choć jedną niezerową liczbę.
    //
    // Liczone po WSZYSTKICH obserwacjach, nie po metrykach, dla których strumień
    // jest autorytatywny. Wcześniejsza wersja pytała wyłącznie o metryki własne,
    // więc workspace bez CTA i bez wyszukiwarki wewnętrznej dostawał w `streams`
    // zdanie „first-party nie ma w liczbach”, choć TA SAMA odpowiedź niosła w
    // `entries` tysiące odsłon i sesji z `analytics_events` (te są autorytatywnie
    // GA4, ale first-party jest tam obserwacją potwierdzającą). Panel podawał
    // liczbę i zaprzeczał jej istnieniu w jednym widoku. Pytanie „czy ten
    // strumień dowozi dane” dotyczy RURY, nie tego, kto wygrał uzgodnienie.
    const contributingStreams = new Set<StreamId>();
    for (const { observations } of currentObservations) {
      for (const o of observations) {
        if (typeof o.value === "number" && o.value > 0) contributingStreams.add(o.streamId);
      }
    }

    // Zdrowie strumieni: odróżniamy „nie skonfigurowany”, „odczyt padł” i „brak
    // danych w oknie”. Raport zarządczy musi wiedzieć, czego w liczbach NIE MA.
    const firstPartyRead = currentRaw !== null;
    const streams: SemanticStreamHealth[] = STREAMS.map((s) => {
      if (s.id === "ga4") {
        if (!ga4Configured) return { streamId: s.id, available: false, reason: "not_configured" };
        if (ga4Current.error) return { streamId: s.id, available: false, reason: "read_failed" };
        return { streamId: s.id, available: true };
      }
      if (!firstPartyRead) return { streamId: s.id, available: false, reason: "read_failed" };
      return contributingStreams.has(s.id)
        ? { streamId: s.id, available: true }
        : { streamId: s.id, available: false, reason: "no_data" };
    });

    return {
      window: toWindowDto(current),
      previous: { sinceIso: previous.sinceIso, untilIso: previous.untilIso },
      entries,
      deltas,
      ratios,
      streams,
      ga4Configured,
      ...(ga4Current.error ? { ga4Error: ga4Current.error } : {}),
    };
  });
