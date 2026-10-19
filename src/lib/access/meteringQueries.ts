// METERING - warstwa PANELU: stan serwera, jedyny pisarz ustawień i podgląd
// skutku zmiany limitu (SPEC §3.2; S1 def. 14).
//
// DLACZEGO OSOBNY MODUŁ. `metering.ts` jedzie do czytelnika (bundel `public`
// przez `routes/$.tsx`), więc trzyma tylko odczyt. Zapis, podgląd i stan
// „brak wiersza" potrzebuje wyłącznie panel - tu, poza bundlem publicznym.
//
// BRAK WIERSZA = WYŁĄCZONY. Serwer (`consume_metered_view`) bez wiersza
// `metering_settings` nie liczy niczego. Dawny formularz pokazywał w tej
// sytuacji `DEFAULT_METERING_SETTINGS` („włączony, 5 artykułów") i admin był
// pewien, że licznik działa. `MeteringServerState` rozróżnia oba stany, więc
// UI pokaże „wyłączony - brak konfiguracji", a domyślne podsunie dopiero jako
// propozycję do zapisania.
import { queryOptions, useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { meteringKeys } from "@/lib/access/keys";
import type { MeteringSettings, MeteringSettingsRow } from "@/lib/access/metering";
import { invalidateKeys, revenueDomainKeys, staleWriteError } from "@/lib/billing/planQueries";
import { crmKeys } from "@/lib/crm/keys";
import type { RevenueDomain } from "@/lib/revenue/keys";
import { useCurrentTenantId } from "@/lib/tenant";

export { meteringSettingsQueryOptions } from "@/lib/access/metering";

/** Stan ustawień PO STRONIE SERWERA - nie to, co formularz chciałby pokazać. */
export type MeteringServerState =
  { kind: "missing" } | { kind: "row"; settings: MeteringSettings; updatedAt: string };

/** Wiersz z odczytu → stan serwera (`null`/`undefined` = brak wiersza). */
export function meteringServerState(
  row: MeteringSettingsRow | null | undefined,
): MeteringServerState {
  if (!row) return { kind: "missing" };
  const { updated_at, ...settings } = row;
  return { kind: "row", settings, updatedAt: updated_at };
}

/** Limit artykułów - ten sam zakres, co CHECK kolumn (`BETWEEN 0 AND 1000`). */
export const METERING_LIMIT_MAX = 1000;

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(METERING_LIMIT_MAX, Math.round(value)));
}

export interface SaveMeteringSettingsInput {
  settings: MeteringSettings;
  /**
   * Surowe `updated_at` wiersza, na którym admin zaczął edycję; `null` =
   * wiersza nie było (stan `missing`) - wtedy INSERT, a wyścig dwóch kart,
   * które obie tworzą wiersz, kończy się konfliktem `40001` (23505).
   */
  expectedUpdatedAt: string | null;
}

type MeteringWrite = Database["public"]["Tables"]["metering_settings"]["Insert"];

const SETTINGS_SELECT =
  "enabled, member_monthly_limit, anon_monthly_limit, meter_paid, meter_members, show_counter, updated_at" as const;

/**
 * Zapis ustawień (bez haka - testy i naprawy huba). Patch to DOKŁADNIE
 * kolumny ustawień + `updated_by`; najemca przy INSERT z sesji albo
 * z domyślnej kolumny - nigdy z wiersza.
 */
export async function saveMeteringSettings(
  tenantId: string | null,
  input: SaveMeteringSettingsInput,
): Promise<MeteringSettingsRow> {
  const { data: auth } = await supabase.auth.getSession();
  const s = input.settings;
  const patch: MeteringWrite = {
    enabled: s.enabled,
    member_monthly_limit: clampLimit(s.member_monthly_limit),
    anon_monthly_limit: clampLimit(s.anon_monthly_limit),
    meter_paid: s.meter_paid,
    meter_members: s.meter_members,
    show_counter: s.show_counter,
    updated_by: auth.session?.user.id ?? null,
  };

  if (input.expectedUpdatedAt === null) {
    const { data, error } = await supabase
      .from("metering_settings")
      .insert({ ...patch, ...(tenantId ? { tenant_id: tenantId } : {}) })
      .select(SETTINGS_SELECT)
      .single();
    // 23505: druga karta utworzyła wiersz między naszym odczytem a zapisem.
    // To ten sam konflikt co nieaktualny token - admin musi zobaczyć cudzy zapis.
    if (error?.code === "23505") throw staleWriteError();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("metering_settings")
    .update(patch)
    .eq("updated_at", input.expectedUpdatedAt)
    .select(SETTINGS_SELECT);
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw staleWriteError();
  return row;
}

/** Domeny huba z reguły panelu `metering_settings.changed.v1`. */
const METERING_REVENUE_DOMAINS = [
  "access",
  "diagnostics",
] as const satisfies readonly RevenueDomain[];

/**
 * Klucze czytelników ustawień: reguła rdzenia `metering_settings.changed.v1`
 * + dziedziny huba. `["public", "resolved"]` stoi literałem jak w regule I0:
 * to rozstrzygnięty dostęp treści czytelnika, który nie ma fabryki-liścia
 * (zgłoszenie „Do integracji"); bramka literałów go nie dotyczy, bo nie jest
 * prefiksem żadnej fabryki.
 */
export function meteringInvalidationKeys(tenantId: string | null): QueryKey[] {
  return [
    meteringKeys.settings(),
    meteringKeys.impactPreviewAll(),
    crmKeys.leadMeteringAll(),
    ["public", "resolved"],
    ...revenueDomainKeys(METERING_REVENUE_DOMAINS, tenantId),
  ];
}

/** Jedyny pisarz `metering_settings` (`syncManifest.ts`). Rzuca, nie pokazuje toastów. */
export function useSaveMeteringSettings() {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: (input: SaveMeteringSettingsInput) => saveMeteringSettings(tenantId, input),
    onSuccess: (row) => {
      // Nowy token od razu w cache: kolejny zapis z tej karty nie czeka na
      // odświeżenie i nie zgłasza konfliktu z samym sobą.
      queryClient.setQueryData(meteringKeys.settings(), row);
      return invalidateKeys(queryClient, meteringInvalidationKeys(tenantId));
    },
  });
}

/** Skutek proponowanego limitu członków w bieżącym miesiącu (RPC staff-only). */
export interface MeteringImpactRow {
  total_members: number;
  members_blocked: number;
  members_warning: number;
  members_safe: number;
  total_anon: number;
  anon_blocked: number;
  avg_used: number;
  max_used: number;
  total_views: number;
}

export function meteringImpactPreviewQueryOptions(proposedMemberLimit: number, enabled: boolean) {
  const limit = clampLimit(proposedMemberLimit);
  return queryOptions({
    queryKey: meteringKeys.impactPreview(limit),
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<MeteringImpactRow | null> => {
      const { data, error } = await supabase.rpc("metering_impact_preview", {
        _proposed_member_limit: limit,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}
