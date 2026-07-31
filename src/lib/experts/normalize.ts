// Czyste transformacje huba eksperta - wydzielone z queries.ts, żeby dało się
// je jednostkowo testować bez klienta Supabase (asemblacja materiałów, parsing
// funkcji organizacyjnych, redukcja faset).
import { parseExpertLayoutOverrides } from "@/lib/expertLayouts";
import type {
  CategoryMeta,
  ExpertMaterial,
  ExpertProfile,
  ExpertProgram,
  ExpertiseArea,
  MaterialKind,
  MediaMention,
  OrgFunction,
  RegionMeta,
  TagMeta,
} from "./types";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Bezpieczna projekcja jsonb[] → Row[] (nieznane kształty odpadają cicho). */
export function jsonRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (r): r is Record<string, unknown> => typeof r === "object" && r !== null && !Array.isArray(r),
  );
}

/** Bezpieczna projekcja jsonb → Row | null (skalar/tablica → null). */
export function jsonRow(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Mapuje post_format na typ materiału w eksploratorze. */
export function postFormatToKind(format: string | null | undefined): MaterialKind {
  if (format === "video") return "video";
  if (format === "report") return "report";
  return "article";
}

/** Bezpieczny parsing author_profiles.org_functions (JSONB [{pl,en}]). */
export function parseOrgFunctions(raw: unknown): OrgFunction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({ pl: String(x.pl ?? ""), en: String(x.en ?? "") }))
    .filter((f) => f.pl || f.en);
}

/** Komparator materiałów: najnowsze u góry, brak daty na koniec. */
export function compareMaterialsByDateDesc(a: ExpertMaterial, b: ExpertMaterial): number {
  if (!a.date && !b.date) return 0;
  if (!a.date) return 1;
  if (!b.date) return -1;
  return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
}

export interface TaxonomyLists {
  programs: ExpertProgram[];
  regions: RegionMeta[];
  categories: CategoryMeta[];
  tags: TagMeta[];
}

/** Redukuje taksonomie do wartości faktycznie obecnych w materiałach - fasety
 *  pokazują tylko filtry, które coś zwrócą. */
export function reduceFacets(materials: ExpertMaterial[], taxonomy: TaxonomyLists): TaxonomyLists {
  const presentPrograms = new Set(materials.flatMap((m) => m.programIds));
  const presentRegions = new Set(materials.flatMap((m) => m.regionIds));
  const presentCategories = new Set(materials.flatMap((m) => m.categoryIds));
  const presentTags = new Set(materials.flatMap((m) => m.tagIds));
  return {
    programs: taxonomy.programs.filter((p) => presentPrograms.has(p.id)),
    regions: taxonomy.regions.filter((r) => presentRegions.has(r.id)),
    categories: taxonomy.categories.filter((c) => presentCategories.has(c.id)),
    tags: taxonomy.tags.filter((t) => presentTags.has(t.id)),
  };
}

// ---------- row → model (pure; IO stays in queries.ts) ---------------------

/** Buduje rdzeń profilu eksperta z wiersza profiles + author_profiles + odznak.
 *  Kontakt/socjale mają fallback z profiles, gdy author_profiles ich nie ma. */
export function buildExpertProfile(prof: Row, apRow: Row | null, badges: string[]): ExpertProfile {
  return {
    id: str(prof.id),
    tenant_id: strOrNull(prof.tenant_id),
    slug: strOrNull(prof.slug),
    display_name: strOrNull(prof.display_name),
    avatar_url: strOrNull(prof.avatar_url),
    cover_url: strOrNull(prof.cover_url),
    job_title: strOrNull(apRow?.job_title),
    company: strOrNull(apRow?.company),
    bio_pl: strOrNull(prof.bio_pl),
    bio_en: strOrNull(prof.bio_en),
    full_bio_pl: strOrNull(apRow?.full_bio_pl),
    full_bio_en: strOrNull(apRow?.full_bio_en),
    org_functions: parseOrgFunctions(apRow?.org_functions),
    verified_at: strOrNull(prof.verified_at),
    updated_at: strOrNull(prof.updated_at),
    is_expert: badges.includes("expert"),
    // Domyślnie true (kolumna NOT NULL DEFAULT true); jawne false chowa przycisk.
    expert_requests_enabled: prof.expert_requests_enabled !== false,
    contact_email: strOrNull(apRow?.contact_email),
    website_url: strOrNull(apRow?.website_url) ?? strOrNull(prof.website_url),
    twitter_url: strOrNull(apRow?.x_url) ?? strOrNull(prof.twitter_url),
    linkedin_url: strOrNull(apRow?.linkedin_url) ?? strOrNull(prof.linkedin_url),
    media_contact_name: strOrNull(apRow?.media_contact_name),
    media_contact_email: strOrNull(apRow?.media_contact_email),
    media_contact_phone: strOrNull(apRow?.media_contact_phone),
    // Kolumna layout_preset wygrywa z kluczem `preset` w jsonb; nieznane
    // klucze/typy odpadają w parserze. Brak nadpisań -> null (dziedziczenie).
    layout_overrides: parseExpertLayoutOverrides(
      apRow?.layout_overrides,
      strOrNull(apRow?.layout_preset),
    ),
  };
}

/** program_members (z zagnieżdżonym programs) → ExpertProgram[] z funkcją. */
export function mapProgramMembers(rows: Row[]): ExpertProgram[] {
  return rows
    .map((r) => {
      const p = r.program as Row | null;
      if (!p) return null;
      return {
        id: str(p.id),
        slug: str(p.slug),
        name_pl: str(p.name_pl),
        name_en: str(p.name_en),
        kind: (strOrNull(p.kind) as ExpertProgram["kind"]) ?? "program",
        description_pl: strOrNull(p.description_pl),
        description_en: strOrNull(p.description_en),
        role_pl: strOrNull(r.role_pl),
        role_en: strOrNull(r.role_en),
      } satisfies ExpertProgram;
    })
    .filter((x): x is ExpertProgram => x !== null);
}

/** expert_expertise_areas (z zagnieżdżonym expertise_areas) → ExpertiseArea[]. */
export function mapExpertiseAreaRows(rows: Row[]): ExpertiseArea[] {
  return rows
    .map((r) => r.area as Row | null)
    .filter((a): a is Row => a !== null)
    .map((a) => ({
      id: str(a.id),
      slug: str(a.slug),
      name_pl: str(a.name_pl),
      name_en: str(a.name_en),
    }));
}

export function mapMediaMentionRows(rows: Row[]): MediaMention[] {
  return rows.map((row) => ({
    id: str(row.id),
    outlet: str(row.outlet),
    title: str(row.title),
    url: strOrNull(row.url),
    kind: (strOrNull(row.kind) as MediaMention["kind"]) ?? "quote",
    language: strOrNull(row.language),
    published_on: str(row.published_on),
    cover_url: strOrNull(row.cover_url),
  }));
}

export interface PostPivots {
  programs: Map<string, string[]>;
  regions: Map<string, string[]>;
  categories: Map<string, string[]>;
  tags: Map<string, string[]>;
}

/** Wiersz posta → materiał (typ z post_format, href do /post/slug, pivoty). */
export function postRowToMaterial(row: Row, coauthor: boolean, pivots: PostPivots): ExpertMaterial {
  const id = str(row.id);
  return {
    id,
    kind: postFormatToKind(strOrNull(row.post_format)),
    title_pl: str(row.title_pl),
    title_en: str(row.title_en),
    excerpt_pl: strOrNull(row.excerpt_pl),
    excerpt_en: strOrNull(row.excerpt_en),
    cover_url: strOrNull(row.cover_image_url),
    date: strOrNull(row.published_at),
    href: `/post/${str(row.slug)}`,
    programIds: pivots.programs.get(id) ?? [],
    regionIds: pivots.regions.get(id) ?? [],
    categoryIds: pivots.categories.get(id) ?? [],
    tagIds: pivots.tags.get(id) ?? [],
    isCoauthor: coauthor,
  };
}

export function podcastRowToMaterial(row: Row): ExpertMaterial {
  return {
    id: str(row.id),
    kind: "podcast",
    title_pl: str(row.title_pl),
    title_en: str(row.title_en),
    excerpt_pl: strOrNull(row.excerpt_pl),
    excerpt_en: strOrNull(row.excerpt_en),
    cover_url: strOrNull(row.cover_image_url),
    date: strOrNull(row.published_at),
    href: `/podcast/${str(row.slug)}`,
    programIds: row.program_id ? [str(row.program_id)] : [],
    regionIds: row.region_id ? [str(row.region_id)] : [],
    categoryIds: [],
    tagIds: [],
    isCoauthor: false,
  };
}

export function eventRowToMaterial(row: Row): ExpertMaterial {
  return {
    id: str(row.id),
    kind: "event",
    title_pl: str(row.title_pl),
    title_en: str(row.title_en),
    excerpt_pl: strOrNull(row.description_pl),
    excerpt_en: strOrNull(row.description_en),
    cover_url: strOrNull(row.cover_url),
    date: strOrNull(row.starts_at),
    href: `/events/${str(row.slug)}`,
    programIds: row.program_id ? [str(row.program_id)] : [],
    regionIds: row.region_id ? [str(row.region_id)] : [],
    categoryIds: [],
    tagIds: [],
    isCoauthor: false,
  };
}

/** Grupuje wiersze pivotów (post_id → [wartości]) - do budowy PostPivots. */
export function groupPivot<T extends Row>(rows: T[], valueKey: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const k = str(r.post_id);
    const v = str(r[valueKey]);
    const list = m.get(k) ?? [];
    list.push(v);
    m.set(k, list);
  }
  return m;
}

// ---------- surowe zbiory → materiały (wspólne jądro RPC i legacy) ---------

/** Surowe zbiory wierszy składające się na materiały eksperta. Ten sam kształt
 *  produkują: legacy fetchMaterials (osobne zapytania) i RPC get_expert_hub
 *  (jeden round-trip) - asemblacja jest jedna, więc obie ścieżki nie mogą się
 *  rozjechać na dedupe/pivotach/sortowaniu. */
export interface ExpertMaterialRows {
  primaryPosts: Row[];
  coauthorPosts: Row[];
  podcasts: Row[];
  hostEvents: Row[];
  speakerEvents: Row[];
  postCategories: Row[];
  postPrograms: Row[];
  postRegions: Row[];
  postTags: Row[];
}

/** Złóż znormalizowaną listę materiałów: dedupe postów (autor główny wygrywa
 *  nad współautorstwem), dedupe wydarzeń (host nad prelegentem), pivoty
 *  taksonomii, sort malejąco po dacie. Czysta funkcja - testowalna bez IO. */
export function assembleMaterials(rows: ExpertMaterialRows): ExpertMaterial[] {
  const postById = new Map<string, { row: Row; coauthor: boolean }>();
  for (const row of rows.primaryPosts) postById.set(str(row.id), { row, coauthor: false });
  for (const row of rows.coauthorPosts) {
    const id = str(row.id);
    if (!postById.has(id)) postById.set(id, { row, coauthor: true });
  }

  const pivots: PostPivots = {
    categories: groupPivot(rows.postCategories, "category_id"),
    programs: groupPivot(rows.postPrograms, "program_id"),
    regions: groupPivot(rows.postRegions, "region_id"),
    tags: groupPivot(rows.postTags, "tag_id"),
  };

  const materials: ExpertMaterial[] = [];
  for (const { row, coauthor } of postById.values()) {
    materials.push(postRowToMaterial(row, coauthor, pivots));
  }
  for (const row of rows.podcasts) materials.push(podcastRowToMaterial(row));

  const eventById = new Map<string, Row>();
  for (const row of rows.hostEvents) eventById.set(str(row.id), row);
  for (const row of rows.speakerEvents) {
    const id = str(row.id);
    if (!eventById.has(id)) eventById.set(id, row);
  }
  for (const row of eventById.values()) materials.push(eventRowToMaterial(row));

  materials.sort(compareMaterialsByDateDesc);
  return materials;
}

// ---------- wiersze taksonomii → meta (wspólne dla RPC i legacy) -----------

/** Wiersze `programs` → ExpertProgram[] (bez funkcji roli - to katalog). */
export function mapProgramRows(rows: Row[]): ExpertProgram[] {
  return rows.map((p) => ({
    id: str(p.id),
    slug: str(p.slug),
    name_pl: str(p.name_pl),
    name_en: str(p.name_en),
    kind: (strOrNull(p.kind) as ExpertProgram["kind"]) ?? "program",
    description_pl: strOrNull(p.description_pl),
    description_en: strOrNull(p.description_en),
    role_pl: null,
    role_en: null,
  }));
}

export function mapRegionRows(rows: Row[]): RegionMeta[] {
  return rows.map((r) => ({
    id: str(r.id),
    slug: str(r.slug),
    name_pl: str(r.name_pl),
    name_en: str(r.name_en),
  }));
}

export function mapCategoryRows(rows: Row[]): CategoryMeta[] {
  return rows.map((c) => ({
    id: str(c.id),
    slug: str(c.slug),
    name_pl: str(c.name_pl),
    name_en: str(c.name_en),
  }));
}

export function mapTagRows(rows: Row[]): TagMeta[] {
  return rows.map((t) => ({
    id: str(t.id),
    slug: str(t.slug),
    name: str(t.name),
  }));
}
