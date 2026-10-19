// RETENCJA - jedyni pisarze ustawień kontroferty i katalogu powodów odejścia
// (SPEC §3.2; S1 def. 13, Z-08).
//
// CO NAPRAWIA.
//   * NAJEMCA Z SESJI, NIE Z WIERSZY. `RetentionTab` brał `tenant_id`
//     z pierwszego wiersza ustawień, powodów albo odpowiedzi - najemca bez
//     żadnego wiersza nie mógł zapisać nic („brak najemcy"), a wiersz z cache
//     po zmianie obszaru roboczego wskazywał cudzego. Teraz `useCurrentTenantId()`;
//     RLS (`tenant_id = current_tenant_id()`) i tak odrzuci każdego innego.
//   * ZAPIS Z TOKENEM. Ustawienia szły `upsert` CAŁEGO wiersza - druga karta
//     z wczorajszym szkicem cofała dzisiejszy rabat. Teraz UPDATE warunkowany
//     surowym `updated_at` (0 wierszy = `40001`), a przy braku wiersza INSERT
//     (wyścig dwóch kart: 23505 → `40001`).
//
// Mutatory nie pokazują toastów - rzucają; zakładka tłumaczy `40001` przez
// `adminPaywall.sync.*`, resztę przez `toastError`.
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { persistOrder } from "@/lib/admin/sortOrder";
import {
  assertPatchColumns,
  invalidateKeys,
  revenueDomainKeys,
  staleWriteError,
} from "@/lib/billing/planQueries";
import type { RetentionReasonRow, RetentionSettingsRow } from "@/lib/retention/queries";
import { retentionKeys } from "@/lib/retention/keys";
import { useCurrentTenantId } from "@/lib/tenant";

type ReasonWrite = Database["public"]["Tables"]["retention_reasons"]["Update"];

/** Zakresy = CHECK kolumn `retention_settings` (migracja 20260722230000). */
export const RETENTION_SETTINGS_LIMITS = {
  discount_pct: { min: 1, max: 90 },
  discount_periods: { min: 1, max: 24 },
  coupon_valid_days: { min: 1, max: 90 },
} as const;

export interface RetentionSettingsInput {
  enabled: boolean;
  discount_pct: number;
  discount_periods: number;
  coupon_valid_days: number;
}

export interface SaveRetentionSettingsInput {
  settings: RetentionSettingsInput;
  /** Surowe `updated_at` z odczytu; `null` = wiersza nie było → INSERT. */
  expectedUpdatedAt: string | null;
}

function clamp(value: number, { min, max }: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Zapis ustawień kontroferty (bez haka - testy i naprawy huba). Wartość spoza
 * zakresu jest PRZYCINANA do CHECK kolumny, zanim baza ją odrzuci - formularz
 * pokazuje te same granice.
 */
export async function saveRetentionSettings(
  tenantId: string | null,
  input: SaveRetentionSettingsInput,
): Promise<RetentionSettingsRow> {
  const { data: auth } = await supabase.auth.getSession();
  const s = input.settings;
  const patch = {
    enabled: s.enabled,
    discount_pct: clamp(s.discount_pct, RETENTION_SETTINGS_LIMITS.discount_pct),
    discount_periods: clamp(s.discount_periods, RETENTION_SETTINGS_LIMITS.discount_periods),
    coupon_valid_days: clamp(s.coupon_valid_days, RETENTION_SETTINGS_LIMITS.coupon_valid_days),
    updated_by: auth.session?.user.id ?? null,
  };

  if (input.expectedUpdatedAt === null) {
    // `retention_settings.tenant_id` nie ma wartości domyślnej - bez najemcy
    // z sesji nie ma czego wstawić.
    if (!tenantId) throw new Error("tenant_unresolved");
    const { data, error } = await supabase
      .from("retention_settings")
      .insert({ ...patch, tenant_id: tenantId })
      .select("*")
      .single();
    if (error?.code === "23505") throw staleWriteError();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("retention_settings")
    .update(patch)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("*");
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw staleWriteError();
  return row;
}

/** Kolumny powodu edytowane w panelu (kolejność ma własny mutator). */
export const RETENTION_REASON_COLUMNS = ["label_pl", "label_en", "active"] as const;

export type RetentionReasonFields = Partial<
  Pick<ReasonWrite, (typeof RETENTION_REASON_COLUMNS)[number]>
>;

export type SaveRetentionReasonInput =
  | {
      /** Nowy powód - na końcu listy (`sort_order`). */
      id: null;
      fields: { label_pl: string; label_en: string; active?: boolean };
      sortOrder: number;
    }
  | { id: string; expectedUpdatedAt: string; fields: RetentionReasonFields };

export async function saveRetentionReason(
  tenantId: string | null,
  input: SaveRetentionReasonInput,
): Promise<RetentionReasonRow> {
  if (input.id === null) {
    if (!tenantId) throw new Error("tenant_unresolved");
    const { data, error } = await supabase
      .from("retention_reasons")
      .insert({
        tenant_id: tenantId,
        label_pl: input.fields.label_pl.trim(),
        label_en: input.fields.label_en.trim(),
        active: input.fields.active ?? true,
        sort_order: input.sortOrder,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  const fields: ReasonWrite = { ...input.fields };
  assertPatchColumns(fields, RETENTION_REASON_COLUMNS);
  if (typeof fields.label_pl === "string") fields.label_pl = fields.label_pl.trim();
  if (typeof fields.label_en === "string") fields.label_en = fields.label_en.trim();
  const { data, error } = await supabase
    .from("retention_reasons")
    .update(fields)
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("*");
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw staleWriteError();
  return row;
}

export async function deleteRetentionReason(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("retention_reasons")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  // RLS nie zgłasza błędu przy braku prawa - tylko nie usuwa.
  if (!data?.length) throw Object.assign(new Error("not_found"), { code: "P0002" });
}

/** Domeny huba z reguły panelu `retention_settings|retention_reason.changed.v1`. */
const RETENTION_REVENUE_DOMAINS = ["diagnostics"] as const;

/**
 * Klucze czytelników retencji: dialog anulowania czytelnika (`public`)
 * i zakładka panelu (`admin`) - reguła rdzenia `retention_settings.changed.v1`
 * i `retention_reason.changed.v1` (ten sam zestaw) + diagnostyka huba.
 */
export function retentionInvalidationKeys(tenantId: string | null = null): QueryKey[] {
  return [
    retentionKeys.settingsPublic(),
    retentionKeys.reasonsPublic(),
    retentionKeys.admin.settings(),
    retentionKeys.admin.reasons(),
    ...revenueDomainKeys(RETENTION_REVENUE_DOMAINS, tenantId),
  ];
}

export function invalidateRetentionQueries(
  queryClient: QueryClient,
  tenantId: string | null = null,
): Promise<void> {
  return invalidateKeys(queryClient, retentionInvalidationKeys(tenantId));
}

/** Jedyny pisarz ustawień kontroferty (`syncManifest.ts`). */
export function useSaveRetentionSettings() {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: (input: SaveRetentionSettingsInput) => saveRetentionSettings(tenantId, input),
    onSuccess: () => invalidateRetentionQueries(queryClient, tenantId),
  });
}

export function useSaveRetentionReason() {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: (input: SaveRetentionReasonInput) => saveRetentionReason(tenantId, input),
    onSuccess: () => invalidateRetentionQueries(queryClient, tenantId),
  });
}

export function useDeleteRetentionReason() {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => deleteRetentionReason(id),
    onSuccess: () => invalidateRetentionQueries(queryClient, tenantId),
  });
}

export interface ReorderRetentionReasonsInput {
  /** Lista w kolejności z ekranu - tylko zmienione pozycje dostaną UPDATE. */
  rows: { id: string; sort_order: number }[];
  fromIndex: number;
  toIndex: number;
}

/**
 * Kolejność powodów. Bez tokenu świadomie: kolejność to jedna kolumna
 * zapisywana w całości przy każdym przesunięciu, a renumeracja liczy się
 * z listy na ekranie - konflikt dwóch przesunięć kończy się kolejnością
 * ostatniego, co jest dokładnie tym, co admin zobaczy po odświeżeniu.
 */
export function useReorderRetentionReasons() {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: ({ rows, fromIndex, toIndex }: ReorderRetentionReasonsInput) =>
      persistOrder("retention_reasons", rows, { fromIndex, toIndex }),
    onSuccess: () => invalidateRetentionQueries(queryClient, tenantId),
  });
}
