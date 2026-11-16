// Section-level A/B experiments.
//
// The page document is the source of truth for WHAT is tested: two sibling
// sections tagged `advanced.abTest = { experimentId, variant: "a" | "b" }`.
// The tables hold the registry (builder_experiments) and the funnel events
// (builder_experiment_events, written ONLY through the
// /api/public/experiment-event beacon - direct anon inserts are blocked at
// the RLS layer, see migration 20260730140000).
//
// Assignment is deterministic per visitor (FNV-1a over visitorId+experimentId)
// and computed client-side after hydration: SSR and the first client render
// always show variant A, then visitors bucketed into B swap post-mount. This
// keeps SSR/CSR markup identical (no hydration mismatch) at the cost of a
// brief flash for the B bucket - the standard client-side testing trade-off.
//
// Rejestr eksperymentów i wyniki lejka (panel `/admin/experiments`, menu
// sekcji w builderze) mieszkają w `experimentsAdmin.ts`: ten moduł importuje
// renderer bloków, więc jest w chunku startowym każdej strony. Nie importuj
// tu `experimentsAdmin.ts` (roadmapa ładowania §9.1 J3).
import { useEffect, useState } from "react";
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
function getVisitorId(): string {
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

/** Znacznik dedupu w sessionStorage; niedostępny magazyn = brak dedupu. */
function readDedup(key: string): boolean {
  try {
    return Boolean(window.sessionStorage.getItem(key));
  } catch {
    return false;
  }
}

function writeDedup(key: string, sent: boolean): void {
  try {
    if (sent) window.sessionStorage.setItem(key, "1");
    else window.sessionStorage.removeItem(key);
  } catch {
    // storage unavailable - wysyłka już poszła, tylko bez dedupu
  }
}

/**
 * Record an experiment event (deduplicated per browser session). Fire and
 * forget - tracking must never affect rendering. Zapis idzie przez beacon
 * /api/public/experiment-event (walidacja + rate limit + insert service_role)
 * - bezpośredni INSERT do builder_experiment_events kluczem anon jest
 * zablokowany na poziomie RLS (migracja 20260730140000).
 *
 * Znacznik dedupu powstaje DOPIERO po przekazaniu zdarzenia przeglądarce
 * (beacon przyjęty albo fetch wysłany); brak identyfikatora odwiedzającego,
 * wyjątek przy budowie ładunku, odrzucony beacon czy odrzucony fetch nie
 * zostawiają znacznika, więc kolejna próba w tej sesji może się udać.
 */
export function recordExperimentEvent(
  experimentId: string,
  variant: AbVariant,
  event: ExperimentEvent,
): void {
  if (typeof window === "undefined") return;
  const key = sessionDedup(event, experimentId);
  if (readDedup(key)) return;
  const visitorId = getVisitorId();
  if (!visitorId) return;
  try {
    const url = "/api/public/experiment-event";
    const payload = JSON.stringify({
      experimentId,
      variant,
      event,
      visitorId,
      path: window.location.pathname,
    });
    // sendBeacon nie blokuje nawigacji (konwersja to zwykle klik w link)
    const blob = new Blob([payload], { type: "application/json" });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      // `false` = przeglądarka nie przyjęła beaconu do kolejki - wtedy fetch.
      if (navigator.sendBeacon(url, blob)) {
        writeDedup(key, true);
        return;
      }
    }
    // Znacznik po wywołaniu fetch (synchroniczny wyjątek go nie zostawi);
    // odrzucenie zdejmuje go asynchronicznie, żeby kolejna próba mogła pójść.
    void fetch(url, {
      method: "POST",
      body: payload,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => writeDedup(key, false));
    writeDedup(key, true);
  } catch {
    // silent - beacon jest opcjonalny, nie może psuć UX
  }
}
