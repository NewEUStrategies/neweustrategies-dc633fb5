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
import { edgeTtlCache } from "@/lib/ssrCache";
import type { ExpertHubData, ExpertMaterial } from "./types";
import {
  assembleMaterials,
  buildExpertProfile,
  mapCategoryRows,
  mapExpertiseAreaRows,
  mapMediaMentionRows,
  mapProgramMembers,
  mapProgramRows,
  mapRegionRows,
  mapTagRows,
  reduceFacets,
} from "./normalize";
import { fetchExpertHubFromRpc } from "./rpcHub";

const TTL = 2 * 60_000;
/** TTL per-isolate huba: najcięższa publiczna trasa nie może płacić pełnego
 *  fan-outu na każde żądanie; minuta spina się z oknem świeżości dokumentów. */
const HUB_SSR_TTL_MS = 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Zbiór materiałów eksperta z każdego źródła (posty, podcasty, wydarzenia).
 *  Ścieżka legacy (fallback, gdy RPC get_expert_hub jeszcze nie wdrożone). */
async function fetchMaterials(expertId: string): Promise<ExpertMaterial[]> {
  const POST_COLS =
    "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format, author_id";
  const PODCAST_COLS =
    "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, program_id, region_id";
  const EVENT_COLS =
    "id, slug, title_pl, title_en, description_pl, description_en, cover_url, starts_at, program_id, region_id, host_user_id";

  // Fala 1: wszystko, co zależy wyłącznie od id eksperta - w tym listy id
  // współautorstw/prelekcji ORAZ niezależne od nich materiały główne. Dawniej
  // te trzy zapytania czekały w drugiej fali na listy id, których nie używały.
  const [
    { data: coauthorRows },
    { data: speakerRows },
    { data: primaryPosts },
    { data: podcasts },
    { data: hostEvents },
  ] = await Promise.all([
    supabase.from("post_authors").select("post_id").eq("user_id", expertId),
    supabase.from("event_speakers").select("event_id").eq("user_id", expertId),
    supabase
      .from("posts")
      .select(POST_COLS)
      .eq("author_id", expertId)
      .eq("status", "published")
      .is("deleted_at", null)
      .order("published_at", { ascending: false }),
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
  ]);
  const coauthorPostIds = (coauthorRows ?? []).map((r) => r.post_id as string);
  const speakerEventIds = (speakerRows ?? []).map((r) => r.event_id as string);

  // Fala 2: rekordy wskazywane przez listy id z fali 1.
  const [{ data: coauthorPosts }, { data: speakerEvents }] = await Promise.all([
    coauthorPostIds.length
      ? supabase
          .from("posts")
          .select(POST_COLS)
          .in("id", coauthorPostIds)
          .eq("status", "published")
          .is("deleted_at", null)
      : Promise.resolve({ data: [] as unknown[] }),
    speakerEventIds.length
      ? supabase
          .from("events")
          .select(EVENT_COLS)
          .in("id", speakerEventIds)
          .eq("status", "published")
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const primaryRows = (primaryPosts ?? []) as Record<string, unknown>[];
  const coauthorRowsFull = (coauthorPosts ?? []) as Record<string, unknown>[];
  const postIds = Array.from(
    new Set([...primaryRows, ...coauthorRowsFull].map((row) => row.id as string)),
  );

  // Fala 3: pivoty taksonomii dla pełnego zbioru postów.
  const [{ data: pcRows }, { data: ppRows }, { data: prRows }, { data: ptRows }] =
    await Promise.all([
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

  // Wspólne jądro asemblacji (to samo, którym RPC składa swój payload).
  return assembleMaterials({
    primaryPosts: primaryRows,
    coauthorPosts: coauthorRowsFull,
    podcasts: (podcasts ?? []) as Record<string, unknown>[],
    hostEvents: (hostEvents ?? []) as Record<string, unknown>[],
    speakerEvents: (speakerEvents ?? []) as Record<string, unknown>[],
    postCategories: (pcRows ?? []) as Record<string, unknown>[],
    postPrograms: (ppRows ?? []) as Record<string, unknown>[],
    postRegions: (prRows ?? []) as Record<string, unknown>[],
    postTags: (ptRows ?? []) as Record<string, unknown>[],
  });
}

/**
 * Ścieżka legacy huba: rezolucja profilu + fan-out osobnych zapytań. Zostaje
 * jako fallback na okno między deployem kodu a wdrożeniem migracji RPC oraz
 * jako ścieżka awaryjna, gdy RPC zwróci błąd.
 */
async function fetchExpertHubLegacy(slugOrId: string): Promise<ExpertHubData | null> {
  // Rozwiązanie profilu: slug, a dla UUID fallback po id (błędy rzucane,
  // nie zamieniane na fałszywe 404 - tylko brak wiersza daje null).
  const PROFILE_COLS =
    "id, tenant_id, slug, display_name, avatar_url, cover_url, bio_pl, bio_en, twitter_url, linkedin_url, website_url, verified_at, updated_at, expert_requests_enabled";
  const bySlug = await supabase
    .from("profiles_public")
    .select(PROFILE_COLS)
    .eq("slug", slugOrId)
    .maybeSingle();
  if (bySlug.error) throw bySlug.error;
  let prof = bySlug.data as Record<string, unknown> | null;
  if (!prof && UUID_RE.test(slugOrId)) {
    const byId = await supabase
      .from("profiles_public")
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
    // author_profiles_public: publiczna projekcja (is_public = true, tenant
    // z public_tenant_id()) BEZ zrewokowanego PII. Czytanie WPROST z
    // author_profiles zwracało `42501 permission denied for column
    // contact_email` dla anon/authenticated (migracja 20260720131542 odebrała
    // SELECT na phone/contact_email/media_contact_email/media_contact_phone) -
    // a że błąd był tu połykany (`{ data: ap }` bez sprawdzenia), CAŁA nakładka
    // autora (tytuł, firma, pełne bio, org_functions, socjale, media_contact_name)
    // znikała z każdej strony /author/$slug. Od 20260730120000 widok nie niesie
    // też contact_email - żadne PII kontaktowe nie jest publiczne; owner czyta
    // je przez get_own_author_profile(), staff przez admin_get_author_profile().
    // Nakładka jest best-effort: gdy jej brak, hub degraduje się do danych
    // z profiles_public zamiast 500-ować stronę.
    supabase
      .from("author_profiles_public")
      .select(
        "job_title, company, website_url, x_url, linkedin_url, facebook_url, instagram_url, spotify_url, custom_socials, full_bio_pl, full_bio_en, org_functions, media_contact_name, is_public, layout_preset, layout_overrides",
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
      .select("id, outlet, title, url, kind, language, published_on, cover_url")
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
  const facets = reduceFacets(materials, {
    programs: mapProgramRows((allPrograms ?? []) as Record<string, unknown>[]),
    regions: mapRegionRows((allRegions ?? []) as Record<string, unknown>[]),
    categories: mapCategoryRows((allCategories ?? []) as Record<string, unknown>[]),
    tags: mapTagRows((allTags ?? []) as Record<string, unknown>[]),
  });

  return { expert, programs, areas, mediaMentions, materials, facets };
}

/**
 * Pełny hub: najpierw JEDEN round-trip RPC `get_expert_hub` (z fasetami
 * zawężonymi w bazie i layoutem tenanta profilu w tym samym wywołaniu);
 * ścieżka legacy zostaje fallbackiem wdrożeniowo-awaryjnym.
 */
async function fetchExpertHub(slugOrId: string): Promise<ExpertHubData | null> {
  const viaRpc = await fetchExpertHubFromRpc(slugOrId);
  if (viaRpc.kind === "ok") return viaRpc.hub;
  if (viaRpc.kind === "not-found") return null;
  return fetchExpertHubLegacy(slugOrId);
}

export const expertHubQueryOptions = (slugOrId: string) =>
  queryOptions({
    queryKey: ["public", "expert", slugOrId] as const,
    queryFn: async (): Promise<ExpertHubData | null> =>
      // Per-isolate TTL (per tenant host): profil publiczny jest anonimową
      // projekcją, więc współdzielenie między żądaniami jest bezpieczne;
      // minuta amortyzuje najcięższą trasę bez opóźniania edycji profilu
      // ponad okno świeżości dokumentów.
      edgeTtlCache(`public:expert-hub:${slugOrId}`, HUB_SSR_TTL_MS, () => fetchExpertHub(slugOrId)),
    staleTime: TTL,
  });
