// Warstwa danych paginacji serwerowej materiałów eksperta: klient RPC
// get_expert_materials (migracja 20260731193000) + query options z kluczem
// odzwierciedlającym PEŁNĄ parametryzację strony wyników (slug, strona,
// filtry) - jak w archiwach taksonomii.
//
// Baza filtruje (AND), liczy total i wycina stronę (LIMIT/OFFSET); klient
// dostaje tylko bieżące okno + pivoty taksonomii dla pozycji strony.
// Mapowanie wierszy zostaje w TS (materialsPage.ts → normalize.ts), więc
// RPC, hub i legacy dzielą jedną asemblację ExpertMaterial.
//
// Odporność wdrożeniowa: brak funkcji (okno między deployem kodu a migracją)
// spada na ścieżkę legacy - hub przez WSPÓLNY klucz edge-cache (ciepły wpis
// na serwerze) + filtr po slugach + wycięcie strony z semantyką parytetną
// do SQL. Ten sam wzorzec co fetchExpertHubFromRpc / search_autosuggest.
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { edgeTtlCache } from "@/lib/ssrCache";
import {
  EXPERT_MATERIALS_PAGE_SIZE,
  filterMaterialsBySlugs,
  mapExpertMaterialsPayload,
  paginateMaterials,
} from "./materialsPage";
import { fetchExpertHubCached } from "./queries";
import type { ExpertMaterialsPage, MaterialFilterSlugs } from "./types";

const TTL = 2 * 60_000;
/** TTL per-isolate stron materiałów - to samo okno świeżości co hub i archiwa. */
const MATERIALS_SSR_TTL_MS = 60_000;

export interface ExpertMaterialsParams {
  page: number;
  filters: MaterialFilterSlugs;
}

type RpcMaterialsResult =
  { kind: "ok"; page: ExpertMaterialsPage } | { kind: "not-found" } | { kind: "unavailable" };

async function fetchMaterialsPageFromRpc(
  slugOrId: string,
  page: number,
  filters: MaterialFilterSlugs,
): Promise<RpcMaterialsResult> {
  // Cast przez `unknown`: wygenerowane typy Supabase nie znają jeszcze funkcji
  // z migracji 20260731193000 (regeneracja typów następuje po jej wdrożeniu).
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, string | number | undefined>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  )("get_expert_materials", {
    _slug_or_id: slugOrId,
    _kind: filters.kind ?? undefined,
    _program_slug: filters.program ?? undefined,
    _region_slug: filters.region ?? undefined,
    _tag_slug: filters.topic ?? undefined,
    _year: filters.year ?? undefined,
    _page: page,
    _page_size: EXPERT_MATERIALS_PAGE_SIZE,
  });
  if (error) return { kind: "unavailable" };
  const mapped = mapExpertMaterialsPayload(data);
  if (mapped.kind === "invalid") return { kind: "unavailable" };
  return mapped;
}

/** Ścieżka legacy: pełny zbiór z huba + filtr slugowy + wycięcie strony. */
async function fetchMaterialsPageLegacy(
  slugOrId: string,
  page: number,
  filters: MaterialFilterSlugs,
): Promise<ExpertMaterialsPage | null> {
  const hub = await fetchExpertHubCached(slugOrId);
  if (!hub) return null;
  return paginateMaterials(
    filterMaterialsBySlugs(hub.materials, hub.facets, filters),
    page,
    EXPERT_MATERIALS_PAGE_SIZE,
  );
}

async function fetchExpertMaterialsPage(
  slugOrId: string,
  page: number,
  filters: MaterialFilterSlugs,
): Promise<ExpertMaterialsPage | null> {
  const viaRpc = await fetchMaterialsPageFromRpc(slugOrId, page, filters);
  if (viaRpc.kind === "ok") return viaRpc.page;
  if (viaRpc.kind === "not-found") return null;
  return fetchMaterialsPageLegacy(slugOrId, page, filters);
}

export const expertMaterialsQueryOptions = (slugOrId: string, params: ExpertMaterialsParams) => {
  const page = Math.max(1, Math.floor(params.page));
  const { kind, program, region, topic, year } = params.filters;
  const filters: MaterialFilterSlugs = { kind, program, region, topic, year };
  return queryOptions({
    queryKey: [
      "public",
      "expert-materials",
      slugOrId,
      { page, pageSize: EXPERT_MATERIALS_PAGE_SIZE, kind, program, region, topic, year },
    ] as const,
    queryFn: async (): Promise<ExpertMaterialsPage | null> =>
      // Per-isolate TTL (per tenant host) - klucz niesie pełną parametryzację
      // strony wyników, jak `public:archive:*` w taksonomii.
      edgeTtlCache(
        `public:expert-materials:${slugOrId}:${page}:${kind ?? ""}:${program ?? ""}:${region ?? ""}:${topic ?? ""}:${year ?? ""}`,
        MATERIALS_SSR_TTL_MS,
        () => fetchExpertMaterialsPage(slugOrId, page, filters),
      ),
    staleTime: TTL,
    // Zmiana strony/filtra podmienia dane bez zrzucania siatki do skeletonu -
    // poprzednie okno zostaje widoczne do nadejścia nowego (płynna paginacja).
    placeholderData: keepPreviousData,
  });
};
