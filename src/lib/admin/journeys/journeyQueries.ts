// `queryOptions` edytora ścieżek (S8) - szczegół, wersja i katalog galerii.
// Uzupełnia `src/lib/journeys/queries.ts` (S5) o odczyty, których S5 nie dał
// (§4.9 pakietu S8: luki `getJourney`/`listJourneyVersions`).
//
// KLUCZE WYŁĄCZNIE Z `journeyKeys` (bramka `queryKeyLiterals`):
//   * `detail(id)` - unieważnia go szyna (`journey.changed.v1`), więc szczegół
//     odświeża się po zapisie w innej karcie i po publikacji; wersje jadą W
//     DANYCH szczegółu, bo szyna nie zna klucza `versions(id)`;
//   * `version(id, versionId)` - wersja opublikowana jest NIEZMIENNA
//     (`journey_versions` bez UPDATE), więc `staleTime: Infinity`;
//   * `templates(tenantId)` - katalog szablonów to kod, nie dane: zmienia się
//     tylko z wdrożeniem (`staleTime: Infinity`); „zainstalowany” liczy UI
//     z listy ścieżek (`JourneyListItem.templateKey`).
//
// Server fn oddają kształt „drutowy” (pola `Json` - wymóg serializacji Start);
// `queryFn` zamienia go w DTO z przeparsowanym szkicem (`toJourneyDetail`).
import { queryOptions } from "@tanstack/react-query";
import { journeyKeys } from "@/lib/journeys/keys";
import { JOURNEYS_GC_MS, JOURNEYS_STALE_MS } from "@/lib/journeys/queries";
import {
  getJourneyDetail,
  getJourneyVersion,
  listJourneyTemplateCatalog,
  toJourneyDetail,
  toJourneyVersion,
  type JourneyDetailDto,
  type JourneyDetailRead,
  type JourneyTemplateCatalogEntry,
  type JourneyVersionDto,
} from "./journeyEditor.functions";

export function journeyDetailQueryOptions(journeyId: string) {
  return queryOptions<JourneyDetailRead<JourneyDetailDto>>({
    queryKey: journeyKeys.detail(journeyId),
    queryFn: async () => toJourneyDetail(await getJourneyDetail({ data: { journeyId } })),
    staleTime: JOURNEYS_STALE_MS,
    gcTime: JOURNEYS_GC_MS,
    retry: 1,
  });
}

export function journeyVersionQueryOptions(journeyId: string, versionId: string) {
  return queryOptions<JourneyDetailRead<JourneyVersionDto>>({
    queryKey: journeyKeys.version(journeyId, versionId),
    queryFn: async () =>
      toJourneyVersion(await getJourneyVersion({ data: { journeyId, versionId } })),
    staleTime: Infinity,
    gcTime: JOURNEYS_GC_MS,
    retry: 1,
  });
}

export function journeyTemplateCatalogQueryOptions(tenantId: string | null) {
  return queryOptions<JourneyTemplateCatalogEntry[]>({
    queryKey: journeyKeys.templates(tenantId ?? ""),
    queryFn: () => listJourneyTemplateCatalog(),
    enabled: Boolean(tenantId),
    staleTime: Infinity,
    gcTime: JOURNEYS_GC_MS,
    retry: 1,
  });
}
