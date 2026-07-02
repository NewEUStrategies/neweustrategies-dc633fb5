// Section-level A/B experiments.
//
// The page document is the source of truth for WHAT is tested: two sibling
// sections tagged `advanced.abTest = { experimentId, variant: "a" | "b" }`.
// The tables hold the registry (builder_experiments) and the funnel events
// (builder_experiment_events, written anonymously - RLS only accepts events
// for running experiments).
//
// Assignment is deterministic per visitor (FNV-1a over visitorId+experimentId)
// and computed client-side after hydration: SSR and the first client render
// always show variant A, then visitors bucketed into B swap post-mount. This
// keeps SSR/CSR markup identical (no hydration mismatch) at the cost of a
// brief flash for the B bucket - the standard client-side testing trade-off.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTenantId } from "@/lib/tenant";
import type { SectionNode } from "./types";

export type AbVariant = "a" | "b";
export type ExperimentEvent = "exposure" | "conversion";
export type ExperimentStatus = "running" | "paused" | "completed";

export interface BuilderExperiment {
  id: string;
  name: string;
  status: ExperimentStatus;
  created_at: string;
  updated_at: string;
}

// ---------- visitor identity ----------

const VISITOR_KEY = "cms_visitor_id";

/** Stable anonymous visitor id (localStorage). Empty string during SSR. */
export function getVisitorId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return "";
  }
}

// ---------- deterministic assignment ----------

/** FNV-1a 32-bit hash - tiny, stable, uniform enough for bucketing. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic 50/50 split: the same visitor always lands in the same bucket
 * for a given experiment, and buckets are independent across experiments.
 */
export function assignVariant(experimentId: string, visitorId: string): AbVariant {
  if (!visitorId) return "a";
  return fnv1a(`${experimentId}:${visitorId}`) % 2 === 0 ? "a" : "b";
}

/** Experiment ids present in a list of sections (order-preserving, unique). */
export function collectExperimentIds(sections: ReadonlyArray<SectionNode>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sections) {
    const id = s?.advanced?.abTest?.experimentId;
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Should this section render for the given assignments? Untagged sections
 * always render; tagged ones only when their variant matches the assignment
 * (variant A until assignments resolve, keeping SSR and hydration identical).
 */
export function isSectionVisibleForAssignments(
  section: SectionNode,
  assignments: ReadonlyMap<string, AbVariant> | null,
): boolean {
  const tag = section.advanced?.abTest;
  if (!tag) return true;
  const assigned = assignments?.get(tag.experimentId) ?? "a";
  return tag.variant === assigned;
}

/** Client-side variant assignments for every experiment on the page. */
export function useExperimentAssignments(
  sections: ReadonlyArray<SectionNode>,
  enabled: boolean,
): ReadonlyMap<string, AbVariant> | null {
  const ids = collectExperimentIds(sections);
  const idsKey = ids.join("|");
  const [assignments, setAssignments] = useState<ReadonlyMap<string, AbVariant> | null>(null);

  useEffect(() => {
    if (!enabled || !idsKey) {
      setAssignments(null);
      return;
    }
    const visitorId = getVisitorId();
    const map = new Map<string, AbVariant>();
    for (const id of idsKey.split("|")) map.set(id, assignVariant(id, visitorId));
    setAssignments(map);
  }, [enabled, idsKey]);

  return assignments;
}

// ---------- event tracking ----------

const sessionDedup = (kind: ExperimentEvent, experimentId: string) =>
  `cms_ab_${kind}_${experimentId}`;

/**
 * Record an experiment event (deduplicated per browser session). Fire and
 * forget - tracking must never affect rendering.
 */
export function recordExperimentEvent(
  experimentId: string,
  variant: AbVariant,
  event: ExperimentEvent,
): void {
  if (typeof window === "undefined") return;
  try {
    const key = sessionDedup(event, experimentId);
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
  } catch {
    // storage unavailable - still attempt the insert, just without dedup
  }
  const visitorId = getVisitorId();
  if (!visitorId) return;
  void supabase
    .from("builder_experiment_events")
    .insert({
      experiment_id: experimentId,
      variant,
      event,
      visitor_id: visitorId,
      path: window.location.pathname,
    })
    .then(({ error }) => {
      if (error && import.meta.env.DEV) console.warn("[ab] event insert failed", error.message);
    });
}

// ---------- admin: registry CRUD + results ----------

export interface ExperimentStats {
  exposures: { a: number; b: number };
  conversions: { a: number; b: number };
}

export function conversionRate(exposures: number, conversions: number): number {
  return exposures > 0 ? conversions / exposures : 0;
}

/**
 * Two-proportion z-score for conversion rates. |z| >= 1.96 ~ 95% confidence.
 * Returns 0 when either variant has no exposures.
 */
export function zScore(stats: ExperimentStats): number {
  const { a, b } = stats.exposures;
  if (a === 0 || b === 0) return 0;
  const pa = stats.conversions.a / a;
  const pb = stats.conversions.b / b;
  const p = (stats.conversions.a + stats.conversions.b) / (a + b);
  const se = Math.sqrt(p * (1 - p) * (1 / a + 1 / b));
  return se > 0 ? (pb - pa) / se : 0;
}

const toStatus = (raw: string): ExperimentStatus =>
  raw === "paused" || raw === "completed" ? raw : "running";

export function useExperimentsAdmin() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ["builder-experiments", tenantId ?? ""],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<BuilderExperiment[]> => {
      const { data, error } = await supabase
        .from("builder_experiments")
        .select("id, name, status, created_at, updated_at")
        .eq("tenant_id", tenantId ?? "")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        status: toStatus(r.status),
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
    },
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["builder-experiments"] });
    void queryClient.invalidateQueries({ queryKey: ["builder-experiment-stats"] });
  }, [queryClient]);

  const create = useCallback(
    async (name: string): Promise<string | null> => {
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("builder_experiments")
        .insert({ name, created_by: u.user?.id ?? null })
        .select("id")
        .single();
      if (error) return null;
      invalidate();
      return data.id;
    },
    [invalidate],
  );

  const setStatus = useCallback(
    async (id: string, status: ExperimentStatus) => {
      await supabase.from("builder_experiments").update({ status }).eq("id", id);
      invalidate();
    },
    [invalidate],
  );

  const remove = useCallback(
    async (id: string) => {
      await supabase.from("builder_experiments").delete().eq("id", id);
      invalidate();
    },
    [invalidate],
  );

  return useMemo(
    () => ({
      items: q.data ?? [],
      loading: q.isLoading,
      create,
      setStatus,
      remove,
    }),
    [q.data, q.isLoading, create, setStatus, remove],
  );
}

async function countEvents(
  experimentId: string,
  variant: AbVariant,
  event: ExperimentEvent,
): Promise<number> {
  const { count } = await supabase
    .from("builder_experiment_events")
    .select("id", { count: "exact", head: true })
    .eq("experiment_id", experimentId)
    .eq("variant", variant)
    .eq("event", event);
  return count ?? 0;
}

export function useExperimentStats(experimentId: string | null) {
  return useQuery({
    queryKey: ["builder-experiment-stats", experimentId ?? ""],
    enabled: Boolean(experimentId),
    staleTime: 30_000,
    queryFn: async (): Promise<ExperimentStats> => {
      const id = experimentId ?? "";
      const [ea, eb, ca, cb] = await Promise.all([
        countEvents(id, "a", "exposure"),
        countEvents(id, "b", "exposure"),
        countEvents(id, "a", "conversion"),
        countEvents(id, "b", "conversion"),
      ]);
      return { exposures: { a: ea, b: eb }, conversions: { a: ca, b: cb } };
    },
  });
}
