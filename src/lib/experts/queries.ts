// Warstwa danych huba eksperta. Agreguje WSZYSTKIE relacje eksperta w jeden
// ładunek: profil + kontakty, programy z funkcjami, obszary ekspertyzy,
// obecność medialna oraz znormalizowana lista materiałów (publikacje,
// raporty, wideo, podcasty, wydarzenia) z metadanymi do filtrowania.
//
// Materiały jednego eksperta są ograniczone (rzędu setek), więc filtrowanie
// po typie/temacie/regionie/dacie/programie odbywa się po stronie klienta -
// spójnie z katalogiem osób i archiwami. Zapytanie pobiera komplet raz.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ExpertHubData, ExpertMaterial, ExpertProgram } from "./types";
import {
  buildExpertProfile,
  compareMaterialsByDateDesc,
  eventRowToMaterial,
  groupPivot,
  mapExpertiseAreaRows,
  mapMediaMentionRows,
  mapProgramMembers,
  podcastRowToMaterial,
  postRowToMaterial,
  reduceFacets,
  type PostPivots,
} from "./normalize";

const TTL = 2 * 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Zbiór materiałów eksperta z każdego źródła (posty, podcasty, wydarzenia). */
async function fetchMaterials(expertId: string): Promise<ExpertMaterial[]> {
  // Współautorstwa i wystąpienia jako prelegent - id do dołączenia.
  const [{ data: coauthorRows }, { data: speakerRows }] = await Promise.all([
    supabase.from("post_authors").select("post_id").eq("user_id", expertId),
    supabase.from("event_speakers").select("event_id").eq("user_id", expertId),
  ]);
  const coauthorPostIds = (coauthorRows ?? []).map((r) => r.post_id as string);
  const speakerEventIds = (speakerRows ?? []).map((r) => r.event_id as string);

  const POST_COLS =
    "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format, author_id";
  const PODCAST_COLS =
    "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, program_id, region_id";
  const EVENT_COLS =
    "id, slug, title_pl, title_en, description_pl, description_en, cover_url, starts_at, program_id, region_id, host_user_id";

  const [
    { data: primaryPosts },
    { data: coauthorPosts },
    { data: podcasts },
    { data: hostEvents },
    { data: speakerEvents },
  ] = await Promise.all([
    supabase
      .from("posts")
      .select(POST_COLS)
      .eq("author_id", expertId)
      .eq("status", "published")
      .is("deleted_at", null)
      .order("published_at", { ascending: false }),
    coauthorPostIds.length
      ? supabase
          .from("posts")
          .select(POST_COLS)
          .in("id", coauthorPostIds)
          .eq("status", "published")
          .is("deleted_at", null)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase
      .from("podcasts")
      .select(PODCAST_COLS)
      .eq("author_id", expertId)
      .eq("status", "published")
      .is("deleted_at", null)
      .order("published_at", { ascending: false }),
    supabase
      .from("events")
      .select(EVENT_COLS)
      .eq("host_user_id", expertId)
      .eq("status", "published"),
    speakerEventIds.length
      ? supabase
          .from("events")
          .select(EVENT_COLS)
          .in("id", speakerEventIds)
          .eq("status", "published")
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  // Posty: dedup (główny autor wygrywa nad współautorstwem) + pivoty.
  const postById = new Map<string, { row: Record<string, unknown>; coauthor: boolean }>();
  for (const row of (primaryPosts ?? []) as Record<string, unknown>[]) {
    postById.set(row.id as string, { row, coauthor: false });
  }
  for (const row of (coauthorPosts ?? []) as Record<string, unknown>[]) {
    const id = row.id as string;
    if (!postById.has(id)) postById.set(id, { row, coauthor: true });
  }
  const postIds = [...postById.keys()];

  const [{ data: pcRows }, { data: ppRows }, { data: prRows }, { data: ptRows }] = await Promise.all([
    postIds.length
      ? supabase.from("post_categories").select("post_id, category_id").in("post_id", postIds)
      : Promise.resolve({ data: [] as unknown[] }),
    postIds.length
      ? supabase.from("post_programs").select("post_id, program_id").in("post_id", postIds)
      : Promise.resolve({ data: [] as unknown[] }),
    postIds.length
      ? supabase.from("post_regions").select("post_id, region_id").in("post_id", postIds)
      : Promise.resolve({ data: [] as unknown[] }),
    postIds.length
      ? supabase.from("post_tags").select("post_id, tag_id").in("post_id", postIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const pivots: PostPivots = {
    categories: groupPivot((pcRows ?? []) as Record<string, unknown>[], "category_id"),
    programs: groupPivot((ppRows ?? []) as Record<string, unknown>[], "program_id"),
    regions: groupPivot((prRows ?? []) as Record<string, unknown>[], "region_id"),
    tags: groupPivot((ptRows ?? []) as Record<string, unknown>[], "tag_id"),
  };

  const materials: ExpertMaterial[] = [];

  for (const { row, coauthor } of postById.values()) {
    materials.push(postRowToMaterial(row, coauthor, pivots));
  }
  for (const row of (podcasts ?? []) as Record<string, unknown>[]) {
    materials.push(podcastRowToMaterial(row));
  }

  const eventById = new Map<string, Record<string, unknown>>();
  for (const row of (hostEvents ?? []) as Record<string, unknown>[])
    eventById.set(row.id as string, row);
  for (const row of (speakerEvents ?? []) as Record<string, unknown>[]) {
    const id = row.id as string;
    if (!eventById.has(id)) eventById.set(id, row);
  }
  for (const row of eventById.values()) {
    materials.push(eventRowToMaterial(row));
  }

  // Najnowsze u góry; brak daty → na koniec.
  materials.sort(compareMaterialsByDateDesc);
  return materials;
}

export const expertHubQueryOptions = (slugOrId: string) =>
  queryOptions({
    queryKey: ["public", "expert", slugOrId] as const,
    queryFn: async (): Promise<ExpertHubData | null> => {
      // Rozwiązanie profilu: slug, a dla UUID fallback po id (błędy rzucane,
      // nie zamieniane na fałszywe 404 - tylko brak wiersza daje null).
      const PROFILE_COLS =
        "id, tenant_id, slug, display_name, avatar_url, cover_url, bio_pl, bio_en, twitter_url, linkedin_url, website_url, verified_at, updated_at";
      const bySlug = await supabase
        .from("profiles")
        .select(PROFILE_COLS)
        .eq("slug", slugOrId)
        .maybeSingle();
      if (bySlug.error) throw bySlug.error;
      let prof = bySlug.data as Record<string, unknown> | null;
      if (!prof && UUID_RE.test(slugOrId)) {
        const byId = await supabase
          .from("profiles")
          .select(PROFILE_COLS)
          .eq("id", slugOrId)
          .maybeSingle();
        if (byId.error) throw byId.error;
        prof = byId.data as Record<string, unknown> | null;
      }
      if (!prof) return null;

      const expertId = prof.id as string;

      const [
        { data: ap },
        { data: badgeRows },
        { data: memberRows },
        { data: areaRows },
        { data: mentionRows },
        materials,
        { data: allPrograms },
        { data: allRegions },
        { data: allCategories },
        { data: allTags },
      ] = await Promise.all([
        supabase
          .from("author_profiles")
          .select(
            "job_title, company, contact_email, website_url, x_url, linkedin_url, full_bio_pl, full_bio_en, org_functions, media_contact_name, media_contact_email, media_contact_phone, is_public",
          )
          .eq("user_id", expertId)
          .maybeSingle(),
        supabase.from("profile_badges").select("badge").eq("user_id", expertId),
        supabase
          .from("program_members")
          .select(
            "role_pl, role_en, sort_order, program:programs(id, slug, name_pl, name_en, kind, description_pl, description_en)",
          )
          .eq("user_id", expertId)
          .order("sort_order", { ascending: true }),
        supabase
          .from("expert_expertise_areas")
          .select("sort_order, area:expertise_areas(id, slug, name_pl, name_en)")
          .eq("user_id", expertId)
          .order("sort_order", { ascending: true }),
        supabase
          .from("media_mentions")
          .select("id, outlet, title, url, kind, language, published_on")
          .eq("user_id", expertId)
          .eq("is_public", true)
          .order("published_on", { ascending: false }),
        fetchMaterials(expertId),
        supabase
          .from("programs")
          .select("id, slug, name_pl, name_en, kind, description_pl, description_en"),
        supabase.from("regions").select("id, slug, name_pl, name_en"),
        supabase.from("categories").select("id, slug, name_pl, name_en"),
        supabase.from("tags").select("id, slug, name"),
      ]);

      const apRow = (ap as Record<string, unknown> | null) ?? null;
      const badges = (badgeRows ?? []).map((b) => (b as { badge: string }).badge);

      const expert = buildExpertProfile(prof, apRow, badges);
      const programs = mapProgramMembers((memberRows ?? []) as Record<string, unknown>[]);
      const areas = mapExpertiseAreaRows((areaRows ?? []) as Record<string, unknown>[]);
      const mediaMentions = mapMediaMentionRows((mentionRows ?? []) as Record<string, unknown>[]);

      // Pełne taksonomie (znormalizowane), potem redukcja do wartości obecnych
      // w materiałach - fasety pokazują tylko filtry, które coś zwrócą.
      const programRows = (allPrograms ?? []) as Record<string, unknown>[];
      const regionRows = (allRegions ?? []) as Record<string, unknown>[];
      const categoryRows = (allCategories ?? []) as Record<string, unknown>[];
      const allProgramsMapped: ExpertProgram[] = programRows.map((p) => ({
        id: p.id as string,
        slug: p.slug as string,
        name_pl: p.name_pl as string,
        name_en: p.name_en as string,
        kind: (p.kind as ExpertProgram["kind"]) ?? "program",
        description_pl: (p.description_pl as string | null) ?? null,
        description_en: (p.description_en as string | null) ?? null,
        role_pl: null,
        role_en: null,
      }));
      const allRegionsMapped = regionRows.map((r) => ({
        id: r.id as string,
        slug: r.slug as string,
        name_pl: r.name_pl as string,
        name_en: r.name_en as string,
      }));
      const allCategoriesMapped = categoryRows.map((c) => ({
        id: c.id as string,
        slug: c.slug as string,
        name_pl: c.name_pl as string,
        name_en: c.name_en as string,
      }));
      const tagRows = (allTags ?? []) as Record<string, unknown>[];
      const allTagsMapped = tagRows.map((t) => ({
        id: t.id as string,
        slug: t.slug as string,
        name: t.name as string,
      }));

      const facets = reduceFacets(materials, {
        programs: allProgramsMapped,
        regions: allRegionsMapped,
        categories: allCategoriesMapped,
        tags: allTagsMapped,
      });

      return { expert, programs, areas, mediaMentions, materials, facets };
    },
    staleTime: TTL,
  });
