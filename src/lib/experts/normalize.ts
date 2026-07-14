// Czyste transformacje huba eksperta - wydzielone z queries.ts, żeby dało się
// je jednostkowo testować bez klienta Supabase (asemblacja materiałów, parsing
// funkcji organizacyjnych, redukcja faset).
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
export function reduceFacets(
  materials: ExpertMaterial[],
  taxonomy: TaxonomyLists,
): TaxonomyLists {
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
export function buildExpertProfile(
  prof: Row,
  apRow: Row | null,
  badges: string[],
): ExpertProfile {
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
    contact_email: strOrNull(apRow?.contact_email),
    website_url: strOrNull(apRow?.website_url) ?? strOrNull(prof.website_url),
    twitter_url: strOrNull(apRow?.x_url) ?? strOrNull(prof.twitter_url),
    linkedin_url: strOrNull(apRow?.linkedin_url) ?? strOrNull(prof.linkedin_url),
    media_contact_name: strOrNull(apRow?.media_contact_name),
    media_contact_email: strOrNull(apRow?.media_contact_email),
    media_contact_phone: strOrNull(apRow?.media_contact_phone),
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
