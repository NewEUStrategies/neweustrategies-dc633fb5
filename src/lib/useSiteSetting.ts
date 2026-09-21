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
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ZodType } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { deepMerge } from "./deepMerge";
import { edgeTtlCache } from "./ssrCache";

export type SettingsMap = Readonly<Record<string, unknown>>;

const SETTINGS_QUERY_KEY = ["site_settings_public", "all"] as const;

const SSR_TTL_MS = 60_000;

/**
 * Bulk odczyt WSZYSTKICH publicznych site_settings (za edgeTtlCache per tenant
 * host). Eksportowane dla serwerowych czytelników pojedynczych kluczy (home
 * mode/page w lib/queries/public.ts): na serwerze mapa jest już rozgrzana
 * przez root loader, więc odczyt klucza kosztuje zero round-tripów zamiast
 * dedykowanego selecta tego samego wiersza.
 */
export async function fetchAllSiteSettings(): Promise<SettingsMap> {
  return edgeTtlCache("site_settings_public:all", SSR_TTL_MS, async () => {
    const { data, error } = await supabase.from("site_settings").select("key,value");
    if (error) throw error;
    const map: Record<string, unknown> = {};
    for (const row of data ?? []) map[row.key] = row.value;
    return Object.freeze(map) as SettingsMap;
  });
}

/**
 * Kontrola wersji zapisów site_settings.
 *
 * Problem: po zapisie w panelu robimy optymistyczny `setQueryData`, ale
 * równoległy refetch (inny komponent, focus okna, edge-cache 60 s) potrafi
 * wrócić ze starą wartością i na moment cofnąć podgląd. Trzymamy więc mapę
 * "pending writes" - dopóki serwer nie potwierdzi zapisanej wartości,
 * każdy wynik fetcha jest nią nadpisywany. Wpis znika, gdy serwer zwróci
 * dokładnie to, co zapisaliśmy (deep-equal) albo gdy nadejdzie nowszy zapis.
 */
type PendingWrite = { version: number; value: unknown };
const pendingWrites = new Map<string, PendingWrite>();
let writeVersion = 0;

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Nakłada niepotwierdzone zapisy na świeżo pobraną mapę ustawień. */
export function applyPendingWrites(map: SettingsMap): SettingsMap {
  if (pendingWrites.size === 0) return map;
  const next: Record<string, unknown> = { ...map };
  for (const [key, write] of pendingWrites) {
    if (sameJson(map[key], write.value)) {
      pendingWrites.delete(key);
      continue;
    }
    next[key] = write.value;
  }
  return Object.freeze(next) as SettingsMap;
}

/** Test hook: czyści rejestr niepotwierdzonych zapisów. */
export function resetPendingWrites(): void {
  pendingWrites.clear();
  writeVersion = 0;
}

/**
 * Zapisz klucz w cache z kontrolą wersji i wymuś świeży odczyt.
 * Zwraca numer wersji zapisu (rosnący), przydatny w testach.
 */
export async function commitSiteSettingWrite(
  qc: {
    cancelQueries: (f: { queryKey: readonly unknown[] }) => Promise<void>;
    setQueryData: (k: readonly unknown[], u: (prev: unknown) => unknown) => unknown;
    invalidateQueries: (f: {
      queryKey: readonly unknown[];
      refetchType?: "all" | "active" | "inactive" | "none";
    }) => Promise<void>;
  },
  key: string,
  value: unknown,
): Promise<number> {
  writeVersion += 1;
  const version = writeVersion;
  pendingWrites.set(key, { version, value });
  await qc.cancelQueries({ queryKey: SETTINGS_QUERY_KEY });
  qc.setQueryData(SETTINGS_QUERY_KEY, (prev: unknown) =>
    Object.freeze({ ...((prev as Record<string, unknown> | undefined) ?? {}), [key]: value }),
  );
  await qc.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY, refetchType: "all" });
  return version;
}

export const siteSettingsQueryOptions = {
  queryKey: SETTINGS_QUERY_KEY,
  queryFn: async (): Promise<SettingsMap> => applyPendingWrites(await fetchAllSiteSettings()),
  // Long staleTime: site_settings rarely change; this query also feeds the
  // header, footer, navigation and alert bar, so a single fetch covers every
  // layout chunk for the whole session.
  staleTime: 10 * 60_000,
  gcTime: 60 * 60_000,
} as const;

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
export function useSiteSetting<T extends object>(key: string, defaults: T, schema?: ZodType<T>): T {
  const { data } = useQuery(siteSettingsQueryOptions);
  return useMemo(() => resolveSetting(data, key, defaults, schema), [data, key, defaults, schema]);
}
