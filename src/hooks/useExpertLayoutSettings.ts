// Query + mutation dla `expert_layout_settings` (per tenant). Wzorowane
// na `usePostLayoutSettings` - jedna publiczna opcja + hook zapisu dla
// panelu admin. Zapisujący jest staffem: RLS wymusza dostęp.
//
// `expertLayoutSettingsQueryOptions(tenantId?)`:
//   - bez argumentu: RLS zwraca wiersz dla bieżącego tenanta hosta
//     (public_tenant_id() dla anonima, current_tenant_id() dla staffu).
//   - z tenantId: jawnie filtrujemy po tenant_id (np. profil eksperta,
//     którego tenant NIE jest bieżącym hostem - wystawiony przez subdomenę
//     innego tenanta lub udostępniony publicznie).
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  defaultExpertLayoutSettings,
  type ExpertLayoutOverrides,
  type ExpertLayoutSettings,
} from "@/lib/expertLayouts";
import type { Json } from "@/integrations/supabase/types";
import { edgeTtlCache } from "@/lib/ssrCache";

export const expertLayoutSettingsQueryOptions = (tenantId?: string | null) =>
  queryOptions({
    queryKey: ["expert-layout-settings", tenantId ?? "__current__"] as const,
    queryFn: async (): Promise<ExpertLayoutSettings> =>
      // Per-isolate TTL (per tenant host): publiczny profil eksperta doklejał
      // ten odczyt do każdego renderu; wariant bez tenantId rozstrzyga RLS po
      // hoście żądania, co pokrywa się ze scope'em klucza cache (na kliencie
      // przezroczyste - panel admina zapisuje przez invalidateQueries).
      edgeTtlCache(`expert-layout:${tenantId ?? "current"}`, 60_000, async () => {
        let q = supabase.from("expert_layout_settings").select("*");
        if (tenantId) q = q.eq("tenant_id", tenantId);
        const { data, error } = await q.maybeSingle();
        if (error && error.code !== "PGRST116") throw error;
        if (!data) return defaultExpertLayoutSettings(tenantId ?? "");
        return data as unknown as ExpertLayoutSettings;
      }),
    staleTime: 5 * 60_000,
  });

export function useExpertLayoutSettings(tenantId?: string | null) {
  return useQuery(expertLayoutSettingsQueryOptions(tenantId));
}

export function useSaveExpertLayoutSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<ExpertLayoutSettings>) => {
      const { data: tRow, error: tErr } = await supabase.rpc("current_tenant_id");
      if (tErr) throw tErr;
      const tenant_id = (tRow as string | null) ?? undefined;
      if (!tenant_id) throw new Error("Brak tenanta w kontekście - nie mogę zapisać layoutu.");
      const payload = { ...patch, tenant_id };
      const { error } = await supabase
        .from("expert_layout_settings")
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expert-layout-settings"] }),
  });
}

/**
 * Serializacja ExpertLayoutOverrides -> jsonb `author_profiles.layout_overrides`.
 * `preset` NIE wchodzi do jsonb - żyje w dedykowanej kolumnie `layout_preset`
 * (CHECK w bazie). Klucze bez nadpisania są pomijane, więc kształt w bazie
 * zawiera wyłącznie faktyczne odstępstwa od ustawień tenanta.
 */
export function expertLayoutOverridesToJson(overrides: ExpertLayoutOverrides | null): Json {
  const out: { [key: string]: Json } = {};
  if (!overrides) return out;
  if (overrides.section_order) out.section_order = [...overrides.section_order];
  if (typeof overrides.center_hero === "boolean") out.center_hero = overrides.center_hero;
  if (typeof overrides.center_details === "boolean") out.center_details = overrides.center_details;
  if (typeof overrides.accent_color === "string") out.accent_color = overrides.accent_color;
  if (typeof overrides.accent_color_dark === "string") {
    out.accent_color_dark = overrides.accent_color_dark;
  }
  if (overrides.visibility) {
    const visibility: { [key: string]: Json } = {};
    for (const [key, value] of Object.entries(overrides.visibility)) {
      if (typeof value === "boolean") visibility[key] = value;
    }
    if (Object.keys(visibility).length > 0) out.visibility = visibility;
  }
  return out;
}

export interface SaveExpertLayoutOverridesInput {
  /** Ekspert, którego stronę nadpisujemy (author_profiles.user_id). */
  userId: string;
  /** Tenant profilu - wymagany przy INSERT pierwszego wiersza autora. */
  tenantId: string;
  /** `null` = wyczyść wszystkie nadpisania (pełny powrót do dziedziczenia). */
  overrides: ExpertLayoutOverrides | null;
}

/**
 * Zapis nadpisań per-ekspert z inline-edytora na /author/$slug. RLS: wiersz
 * zapisze właściciel profilu lub admin/super_admin tego samego tenanta -
 * dokładnie ci, którym strona w ogóle pokazuje edytor. Upsert po user_id
 * pokrywa ekspertów bez utworzonego jeszcze wiersza author_profiles
 * (nowy wiersz startuje jako niepubliczny - DEFAULT false z 20260730120000).
 */
export function useSaveExpertLayoutOverrides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, tenantId, overrides }: SaveExpertLayoutOverridesInput) => {
      const { error } = await supabase.from("author_profiles").upsert(
        {
          user_id: userId,
          tenant_id: tenantId,
          layout_preset: overrides?.preset ?? null,
          layout_overrides: expertLayoutOverridesToJson(overrides),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      // Hub /author/$slug niesie nadpisania w payloadzie - po zapisie strona
      // musi je zaciągnąć na świeżo (tak samo profil w adminie).
      qc.invalidateQueries({ queryKey: ["public", "expert"] });
      qc.invalidateQueries({ queryKey: ["public", "resolved"] });
    },
  });
}
