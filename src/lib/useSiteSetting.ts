// World-class site_settings reader.
//
// Strategy:
//  1. ONE bulk query for every public site_settings row, shared between every
//     useSiteSetting() call (single network round-trip per tenant render).
//  2. Defaults are deep-merged so partial DB values never leave nested keys
//     undefined (root cause of the recent Header crash).
//  3. Optional Zod schema validates the merged value and falls back to defaults
//     on parse failure, so a corrupted setting cannot take the page down.
//  4. 5-minute staleTime / 30-minute gcTime - settings rarely change; we trade
//     a few seconds of staleness for a fast, quiet UI.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ZodType } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { deepMerge } from "./deepMerge";
import { edgeTtlCache } from "./ssrCache";

type SettingsMap = Readonly<Record<string, unknown>>;

const SETTINGS_QUERY_KEY = ["site_settings_public", "all"] as const;

const SSR_TTL_MS = 60_000;

async function fetchAllSiteSettings(): Promise<SettingsMap> {
  return edgeTtlCache("site_settings_public:all", SSR_TTL_MS, async () => {
    const { data, error } = await supabase.from("site_settings").select("key,value");
    if (error) throw error;
    const map: Record<string, unknown> = {};
    for (const row of data ?? []) map[row.key] = row.value;
    return Object.freeze(map) as SettingsMap;
  });
}

export const siteSettingsQueryOptions = {
  queryKey: SETTINGS_QUERY_KEY,
  queryFn: fetchAllSiteSettings,
  // Long staleTime: site_settings rarely change; this query also feeds the
  // header, footer, navigation and alert bar, so a single fetch covers every
  // layout chunk for the whole session.
  staleTime: 10 * 60_000,
  gcTime: 60 * 60_000,
} as const;

/** Prefetch all site_settings from a route loader (server-friendly). */
export function prefetchSiteSettings(qc: QueryClient): Promise<SettingsMap> {
  return qc.ensureQueryData(siteSettingsQueryOptions);
}

/** Resolve one setting against an in-memory bulk map (no network). */
export function resolveSetting<T extends object>(
  map: SettingsMap | undefined,
  key: string,
  defaults: T,
  schema?: ZodType<T>,
): T {
  const raw = map?.[key];
  const merged = raw && typeof raw === "object" ? deepMerge(defaults, raw) : defaults;
  if (!schema) return merged;
  const parsed = schema.safeParse(merged);
  return parsed.success ? parsed.data : defaults;
}

/**
 * Subscribe to one site_settings key.
 *
 * Reads from the shared bulk query - the second call costs nothing.
 * Pass a Zod schema to enforce shape; invalid rows fall back to `defaults`.
 */
export function useSiteSetting<T extends object>(
  key: string,
  defaults: T,
  schema?: ZodType<T>,
): T {
  const { data } = useQuery(siteSettingsQueryOptions);
  return useMemo(() => resolveSetting(data, key, defaults, schema), [data, key, defaults, schema]);
}

/** Subscribe to the full bulk map (rarely needed; prefer useSiteSetting). */
export function useAllSiteSettings(): SettingsMap {
  const { data } = useQuery(siteSettingsQueryOptions);
  return data ?? {};
}
