// Hub eksperta jednym round-tripem: klient RPC `get_expert_hub` (migracja
// 20260724150500). Funkcja SQL (SECURITY INVOKER - pełny RLS anon, tenant
// scoping jak przy zapytaniach bezpośrednich) zwraca wszystkie surowe zbiory
// huba w jednym jsonb: profil + nakładka autora + odznaki + programy + obszary
// + wzmianki + materiały (posty/podcasty/wydarzenia z pivotami) + ZAWĘŻONE
// w bazie taksonomie faset + layout tenanta profilu.
//
// Wcześniej ta sama strona kosztowała ~22 round-tripy w 4-5 sekwencyjnych
// falach (najcięższa publiczna trasa platformy). Mapowanie wierszy zostaje w
// TS (współdzielone z legacy przez normalize.ts), więc obie ścieżki nie mogą
// się rozjechać; SQL robi wyłącznie to, w czym baza jest najlepsza - zebranie
// zbiorów jednym wywołaniem.
//
// Odporność wdrożeniowa: brak funkcji (okno między deployem kodu a migracją)
// zwraca "unavailable" i wołający spada na ścieżkę legacy - ten sam wzorzec
// co search_autosuggest / popular_post_ids.
import { supabase } from "@/integrations/supabase/client";
import type { ExpertHubData } from "./types";
import {
  assembleMaterials,
  buildExpertProfile,
  jsonRow,
  jsonRows,
  mapCategoryRows,
  mapExpertiseAreaRows,
  mapMediaMentionRows,
  mapProgramMembers,
  mapProgramRows,
  mapRegionRows,
  mapTagRows,
  reduceFacets,
} from "./normalize";

export type RpcHubResult =
  { kind: "ok"; hub: ExpertHubData } | { kind: "not-found" } | { kind: "unavailable" };

// Guardy jsonb → Row współdzielone z resztą warstwy danych huba (normalize).
const rowsOf = jsonRows;
const rowOrNull = jsonRow;

function stringsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export async function fetchExpertHubFromRpc(slugOrId: string): Promise<RpcHubResult> {
  // Cast przez `unknown`: wygenerowane typy Supabase nie znają jeszcze funkcji
  // z migracji 20260724150500 (regeneracja typów następuje po jej wdrożeniu).
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: { _slug_or_id: string },
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  )("get_expert_hub", { _slug_or_id: slugOrId });
  if (error) return { kind: "unavailable" };

  const payload = rowOrNull(data);
  if (!payload) return { kind: "unavailable" };
  const profile = rowOrNull(payload.profile);
  if (!profile) return { kind: "not-found" };

  const authorProfile = rowOrNull(payload.author_profile);
  const badges = stringsOf(payload.badges);

  const expert = buildExpertProfile(profile, authorProfile, badges);
  const programs = mapProgramMembers(rowsOf(payload.program_members));
  const areas = mapExpertiseAreaRows(rowsOf(payload.expertise_areas));
  const mediaMentions = mapMediaMentionRows(rowsOf(payload.media_mentions));

  const materials = assembleMaterials({
    primaryPosts: rowsOf(payload.primary_posts),
    coauthorPosts: rowsOf(payload.coauthor_posts),
    podcasts: rowsOf(payload.podcasts),
    hostEvents: rowsOf(payload.host_events),
    speakerEvents: rowsOf(payload.speaker_events),
    postCategories: rowsOf(payload.post_categories),
    postPrograms: rowsOf(payload.post_programs),
    postRegions: rowsOf(payload.post_regions),
    postTags: rowsOf(payload.post_tags),
  });

  // Taksonomie przychodzą już zawężone w SQL do wartości obecnych w
  // materiałach; reduceFacets zostaje jako inwariant spójności (idempotentne
  // na zawężonych zbiorach) - fasety NIGDY nie pokazują pustych filtrów.
  const facets = reduceFacets(materials, {
    programs: mapProgramRows(rowsOf(payload.programs)),
    regions: mapRegionRows(rowsOf(payload.regions)),
    categories: mapCategoryRows(rowsOf(payload.categories)),
    tags: mapTagRows(rowsOf(payload.tags)),
  });

  return {
    kind: "ok",
    hub: {
      expert,
      programs,
      areas,
      mediaMentions,
      materials,
      facets,
      layoutSettings: rowOrNull(payload.layout_settings),
    },
  };
}
