// Zapytania i WSPÓLNE mutatory karty „Retencja danych" (I9c-X2).
//
// Klucze z fabryki (`dataRetentionKeys`) - te same, które unieważnia reguła
// szyny `data_retention.changed.v1` (rozszerzenie panelu), więc zapis w jednej
// karcie odświeża drugą bez przeładowania. Mutatory nie pokazują toastów
// i nie importują i18n: zwracają wynik `{ ok }`, a ekran mówi to swoimi
// słowami (jak mutatory S1).
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { journeyKeys } from "@/lib/journeys/keys";
import { saveJourneySettings } from "@/lib/journeys/journeys.functions";
import {
  extendDataRetentionContact,
  getDataRetention,
  getDataRetentionCrmDue,
  getDataRetentionPreview,
  runDataRetentionNow,
  saveDataRetentionCategory,
  setDataRetentionEnforcement,
  type DataRetentionMutation,
  type DataRetentionRead,
  type EnforcementInput,
  type ExtendContactInput,
  type SaveCategoryInput,
} from "./dataRetention.functions";
import type {
  DataRetentionCrmDueDto,
  DataRetentionPreviewDto,
  DataRetentionStateDto,
} from "./dataRetentionParse";
import { dataRetentionKeys } from "./keys";

const STALE_MS = 60_000;

export function dataRetentionQueryOptions(tenantId: string | null) {
  return queryOptions<DataRetentionRead<DataRetentionStateDto>>({
    queryKey: dataRetentionKeys.settings(tenantId ?? ""),
    queryFn: () => getDataRetention(),
    enabled: Boolean(tenantId),
    staleTime: STALE_MS,
    retry: 1,
  });
}

export function dataRetentionPreviewQueryOptions(tenantId: string | null) {
  return queryOptions<DataRetentionRead<DataRetentionPreviewDto>>({
    queryKey: dataRetentionKeys.preview(tenantId ?? ""),
    queryFn: () => getDataRetentionPreview(),
    enabled: Boolean(tenantId),
    staleTime: STALE_MS,
    retry: 1,
  });
}

export function dataRetentionCrmDueQueryOptions(tenantId: string | null) {
  return queryOptions<DataRetentionRead<DataRetentionCrmDueDto>>({
    queryKey: dataRetentionKeys.crmDue(tenantId ?? ""),
    queryFn: () => getDataRetentionCrmDue(),
    enabled: Boolean(tenantId),
    staleTime: STALE_MS,
    retry: 1,
  });
}

/** Po każdym zapisie: cały prefiks najemcy (ustawienia, podgląd, lista). */
function useInvalidateTenant(tenantId: string) {
  const queryClient = useQueryClient();
  return (state?: DataRetentionStateDto) => {
    if (state) {
      queryClient.setQueryData(dataRetentionKeys.settings(tenantId), {
        state: "ready",
        data: state,
      } satisfies DataRetentionRead<DataRetentionStateDto>);
    }
    return queryClient.invalidateQueries({ queryKey: dataRetentionKeys.tenant(tenantId) });
  };
}

export function useSaveDataRetentionCategory(tenantId: string) {
  const refresh = useInvalidateTenant(tenantId);
  return useMutation({
    mutationFn: (input: SaveCategoryInput) => saveDataRetentionCategory({ data: input }),
    onSuccess: async (result) => {
      await refresh(result.ok ? result.data : undefined);
    },
  });
}

export function useDataRetentionEnforcement(tenantId: string) {
  const refresh = useInvalidateTenant(tenantId);
  return useMutation({
    mutationFn: (input: EnforcementInput) => setDataRetentionEnforcement({ data: input }),
    onSuccess: async (result) => {
      await refresh(result.ok ? result.data : undefined);
    },
  });
}

export function useExtendDataRetentionContact(tenantId: string) {
  const refresh = useInvalidateTenant(tenantId);
  return useMutation({
    mutationFn: (input: ExtendContactInput) => extendDataRetentionContact({ data: input }),
    onSuccess: async () => {
      await refresh();
    },
  });
}

export function useRunDataRetentionNow(tenantId: string) {
  const refresh = useInvalidateTenant(tenantId);
  return useMutation({
    mutationFn: () => runDataRetentionNow({ data: { confirm: true } }),
    onSuccess: async () => {
      await refresh();
    },
  });
}

/**
 * Piksel otwarć - ustawienie SILNIKA ŚCIEŻEK (S5, `admin_journey_settings_save`),
 * pokazane też w karcie retencji. Ten sam serwerowy pisarz i token
 * współbieżności co ustawienia silnika; odświeża oba widoki.
 */
export function useSaveOpenTracking(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { enabled: boolean; expectedUpdatedAt: string | null }) =>
      saveJourneySettings({
        data: {
          patch: { open_tracking_enabled: input.enabled },
          expectedUpdatedAt: input.expectedUpdatedAt,
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dataRetentionKeys.tenant(tenantId) }),
        queryClient.invalidateQueries({ queryKey: journeyKeys.settings(tenantId) }),
      ]);
    },
  });
}

export type { DataRetentionMutation };
