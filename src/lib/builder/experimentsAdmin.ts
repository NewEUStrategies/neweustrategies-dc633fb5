// Eksperymenty A/B - część PANELU: rejestr (lista, tworzenie, status,
// usuwanie) i liczniki lejka z testem z dla `/admin/experiments`. Model
// eksperymentu, przydział wariantu i beacon zdarzeń opisuje nagłówek
// `experiments.ts`.
//
// OSOBNY MODUŁ, CELOWO (chunk startowy, roadmapa ładowania §9.1 J3).
// `experiments.ts` importuje renderer bloków (`BuilderRenderer`), więc siedzi
// w `app-initial` każdej strony; dopóki rejestr mieszkał w nim, przeglądarka
// czytelnika pobierała ok. 2 KB surowego kodu panelu. Tu importuje wyłącznie
// panel; `experiments.ts` NIE importuje stąd niczego - także reeksportem.
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTenantId } from "@/lib/tenant";
import type {
  AbVariant,
  BuilderExperiment,
  ExperimentEvent,
  ExperimentStatus,
} from "./experiments";

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

  /**
   * Id nowego eksperymentu albo `null`. Najemca idzie jawnie z sesji (nie
   * z DEFAULT kolumny), a przy nieznanym najemcy nic nie leci do bazy.
   */
  const create = useCallback(
    async (name: string): Promise<string | null> => {
      if (!tenantId) return null;
      const { data: s } = await supabase.auth.getSession();
      const { data, error } = await supabase
        .from("builder_experiments")
        .insert({ tenant_id: tenantId, name, created_by: s.session?.user?.id ?? null })
        .select("id")
        .single();
      if (error || !data) return null;
      invalidate();
      return data.id;
    },
    [invalidate, tenantId],
  );

  /** `true` przy powodzeniu; odmowa NIE unieważnia cache i nie udaje sukcesu. */
  const setStatus = useCallback(
    async (id: string, status: ExperimentStatus): Promise<boolean> => {
      if (!tenantId) return false;
      const { error } = await supabase
        .from("builder_experiments")
        .update({ status })
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (error) return false;
      invalidate();
      return true;
    },
    [invalidate, tenantId],
  );

  /** `true` przy powodzeniu; odmowa NIE unieważnia cache i nie udaje sukcesu. */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      if (!tenantId) return false;
      const { error } = await supabase
        .from("builder_experiments")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (error) return false;
      invalidate();
      return true;
    },
    [invalidate, tenantId],
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

/**
 * COUNT zdarzeń jednego kubełka lejka, zawężony do najemcy. `tenantId`
 * przychodzi wyłącznie z sesji (`useCurrentTenantId` - `profiles.tenant_id`
 * zalogowanego, ta sama wartość co `current_tenant_id()` w politykach), nigdy
 * z wejścia panelu.
 */
async function countEvents(
  tenantId: string,
  experimentId: string,
  variant: AbVariant,
  event: ExperimentEvent,
): Promise<number> {
  const { count } = await supabase
    .from("builder_experiment_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("experiment_id", experimentId)
    .eq("variant", variant)
    .eq("event", event);
  return count ?? 0;
}

/**
 * Liczniki lejka. Klucz cache niesie najemcę (jak lista rejestru), więc
 * przełączenie obszaru roboczego nie pokazuje wpisu policzonego w poprzednim.
 * Zapytanie o zdarzenia zawęża po `tenant_id` z sesji - kolumnę wyprowadza
 * trigger z eksperymentu (migracja 20261019090000), więc liczniki nie opierają
 * się wyłącznie na polityce SELECT, a filtr trafia w indeks prowadzony
 * najemcą.
 */
export function useExperimentStats(experimentId: string | null) {
  const tenantId = useCurrentTenantId();
  return useQuery({
    queryKey: ["builder-experiment-stats", tenantId ?? "", experimentId ?? ""],
    enabled: Boolean(experimentId && tenantId),
    staleTime: 30_000,
    queryFn: async (): Promise<ExperimentStats> => {
      const id = experimentId ?? "";
      const tenant = tenantId ?? "";
      const [ea, eb, ca, cb] = await Promise.all([
        countEvents(tenant, id, "a", "exposure"),
        countEvents(tenant, id, "b", "exposure"),
        countEvents(tenant, id, "a", "conversion"),
        countEvents(tenant, id, "b", "conversion"),
      ]);
      return { exposures: { a: ea, b: eb }, conversions: { a: ca, b: cb } };
    },
  });
}
