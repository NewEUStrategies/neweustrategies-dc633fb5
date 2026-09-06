// Zbieranie adresów sitemapy per SEKCJA. Wydzielone z trasy /sitemap.xml, która
// wcześniej trzymała cały odczyt (kilkanaście zapytań) w jednym handlerze i
// emitowała jeden plik <urlset>.
//
// Podział na sekcje daje trzy rzeczy naraz:
//   * shard nie przekroczy limitu 50 000 adresów protokołu sitemap,
//   * shard czyta TYLKO swoją sekcję (dossier trackera nie kosztuje zapytań o
//     podcasty), więc crawl jednej sekcji nie budzi całej bazy,
//   * raport "Sitemapy" w GSC pokazuje pokrycie per typ treści.
//
// Wszystkie odczyty idą service rolem (omijają RLS), więc KAŻDY musi być
// zescope'owany do tenanta hosta - tak jak w oryginalnej trasie.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { SitemapSection } from "@/lib/seo/sitemapIndex";
import type { SitemapEntry } from "@/lib/seo/sitemapXml";

import { readPublishedPagePaths as buildPagePaths } from "./publishedPagePaths.server";
import { readPagedRows } from "./pagedRows.server";

type DbClient = SupabaseClient<Database>;

export type { SitemapEntry };

/** YYYY-MM-DD z pierwszej niepustej daty (albo undefined). */
function day(...candidates: Array<string | null | undefined>): string | undefined {
  for (const candidate of candidates) {
    const value = (candidate ?? "").slice(0, 10);
    if (value) return value;
  }
  return undefined;
}

/**
 * Statyczne huby serwisu - sekcja "core". Nie zależą od bazy, więc ta sekcja
 * działa też w trybie degradacji (host podglądowy, nieosiągalny katalog domen).
 */
export function coreSitemapEntries(origin: string): SitemapEntry[] {
  return [
    { loc: `${origin}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${origin}/blog`, changefreq: "daily", priority: "0.8" },
    { loc: `${origin}/podcasts`, changefreq: "weekly", priority: "0.6" },
    { loc: `${origin}/web-stories`, changefreq: "weekly", priority: "0.6" },
    { loc: `${origin}/live`, changefreq: "daily", priority: "0.6" },
    // Community surfaces - indexable, previously absent from the sitemap.
    { loc: `${origin}/events`, changefreq: "daily", priority: "0.7" },
    { loc: `${origin}/qa`, changefreq: "weekly", priority: "0.6" },
    { loc: `${origin}/polls`, changefreq: "weekly", priority: "0.5" },
    { loc: `${origin}/tracker`, changefreq: "daily", priority: "0.7" },
    { loc: `${origin}/programs`, changefreq: "weekly", priority: "0.7" },
    { loc: `${origin}/people`, changefreq: "weekly", priority: "0.5" },
    { loc: `${origin}/experts`, changefreq: "weekly", priority: "0.7" },
    { loc: `${origin}/contribute`, changefreq: "monthly", priority: "0.4" },
    { loc: `${origin}/sitemap`, changefreq: "weekly", priority: "0.3" },
  ];
}

/** Kolektory sekcji. Każdy dostaje leniwie zbudowaną mapę ścieżek stron. */
type SectionCollector = (ctx: {
  admin: DbClient;
  tenantId: string;
  origin: string;
  pagePaths: () => Promise<{ paths: Map<string, string>; noindex: Set<string> }>;
}) => Promise<SitemapEntry[]>;

const COLLECTORS: Record<Exclude<SitemapSection, "core">, SectionCollector> = {
  async pages({ origin, pagePaths }) {
    const { paths, noindex } = await pagePaths();
    const out: SitemapEntry[] = [];
    for (const [id, path] of paths) {
      // Strony oznaczone noindex są wykluczone - sitemapa nie może reklamować
      // adresów, które meta robots każe crawlerowi pominąć.
      if (noindex.has(id)) continue;
      out.push({ loc: `${origin}/${path}`, changefreq: "weekly", priority: "0.6" });
    }
    return out;
  },

  async posts({ admin, tenantId, origin, pagePaths }) {
    const { paths } = await pagePaths();
    const { data } = await readPagedRows((from, to) =>
      admin
        .from("posts")
        .select("slug, parent_page_id, updated_at, published_at", { count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .is("deleted_at", null)
        .eq("seo_noindex", false)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const out: SitemapEntry[] = [];
    for (const row of data ?? []) {
      const p = row as {
        slug: string;
        parent_page_id: string;
        updated_at: string | null;
        published_at: string | null;
      };
      const path = paths.get(p.parent_page_id);
      if (!path) continue;
      out.push({
        loc: `${origin}/${path}/${p.slug}`,
        lastmod: day(p.updated_at, p.published_at),
        changefreq: "monthly",
        priority: "0.7",
      });
    }
    return out;
  },

  // Archiwa kategorii i tagów są samodzielnie indeksowalne i mają własne
  // zlokalizowane metadane, breadcrumbs i schema CollectionPage.
  async taxonomy({ admin, tenantId, origin }) {
    const [{ data: categories }, { data: tags }] = await Promise.all([
      readPagedRows((from, to) =>
        admin
          .from("categories")
          .select("slug, created_at", { count: "exact" })
          .eq("tenant_id", tenantId)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      readPagedRows((from, to) =>
        admin
          .from("tags")
          .select("slug, created_at", { count: "exact" })
          .eq("tenant_id", tenantId)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);
    const out: SitemapEntry[] = [];
    for (const row of categories ?? []) {
      const category = row as { slug: string; created_at: string | null };
      out.push({
        loc: `${origin}/category/${category.slug}`,
        lastmod: day(category.created_at),
        changefreq: "weekly",
        priority: "0.6",
      });
    }
    for (const row of tags ?? []) {
      const tag = row as { slug: string; created_at: string | null };
      out.push({
        loc: `${origin}/tag/${tag.slug}`,
        lastmod: day(tag.created_at),
        changefreq: "weekly",
        priority: "0.5",
      });
    }
    return out;
  },

  // Programy podcastowe (serie) + odcinki - jedna sekcja, bo razem tworzą
  // katalog audio serwisu.
  async podcasts({ admin, tenantId, origin }) {
    const [{ data: shows }, { data: episodes }] = await Promise.all([
      readPagedRows((from, to) =>
        admin
          .from("podcast_shows")
          .select("slug, updated_at", { count: "exact" })
          .eq("tenant_id", tenantId)
          .eq("status", "published")
          .is("deleted_at", null)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      readPagedRows((from, to) =>
        admin
          .from("podcasts")
          .select("slug, updated_at, published_at", { count: "exact" })
          .eq("tenant_id", tenantId)
          .eq("status", "published")
          .is("deleted_at", null)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);
    const out: SitemapEntry[] = [];
    for (const row of shows ?? []) {
      const sh = row as { slug: string; updated_at: string | null };
      out.push({
        loc: `${origin}/podcasts/${sh.slug}`,
        lastmod: day(sh.updated_at),
        changefreq: "weekly",
        priority: "0.6",
      });
    }
    for (const row of episodes ?? []) {
      const ep = row as { slug: string; updated_at: string | null; published_at: string | null };
      out.push({
        loc: `${origin}/podcast/${ep.slug}`,
        lastmod: day(ep.updated_at, ep.published_at),
        changefreq: "monthly",
        priority: "0.6",
      });
    }
    return out;
  },

  /** Opublikowane programy badawcze (landing page specjalizacji). */
  async programs({ admin, tenantId, origin }) {
    const { data } = await readPagedRows((from, to) =>
      admin
        .from("research_programs")
        .select("slug, updated_at, created_at", { count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .order("id", { ascending: true })
        .range(from, to),
    );
    return (data ?? []).map((row) => {
      const pr = row as { slug: string; updated_at: string | null; created_at: string | null };
      return {
        loc: `${origin}/programs/${pr.slug}`,
        lastmod: day(pr.updated_at, pr.created_at),
        changefreq: "weekly" as const,
        priority: "0.6",
      };
    });
  },

  async stories({ admin, tenantId, origin }) {
    const { data } = await readPagedRows((from, to) =>
      admin
        .from("web_stories")
        .select("slug, updated_at, published_at", { count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .order("id", { ascending: true })
        .range(from, to),
    );
    return (data ?? []).map((row) => {
      const s = row as { slug: string; updated_at: string | null; published_at: string | null };
      return {
        loc: `${origin}/web-stories/${s.slug}`,
        lastmod: day(s.updated_at, s.published_at),
        changefreq: "monthly" as const,
        priority: "0.5",
      };
    });
  },

  // Dossier trackera legislacyjnego UE - tracker pozycjonuje się jako źródło
  // prawdy, każde dossier jest indeksowalną stroną.
  async tracker({ admin, tenantId, origin }) {
    const { data } = await readPagedRows((from, to) =>
      admin
        .from("eu_policy_items")
        .select("slug, updated_at, created_at", { count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .order("id", { ascending: true })
        .range(from, to),
    );
    return (data ?? []).map((row) => {
      const d = row as { slug: string; updated_at: string | null; created_at: string | null };
      return {
        loc: `${origin}/tracker/${d.slug}`,
        lastmod: day(d.updated_at, d.created_at),
        changefreq: "weekly" as const,
        priority: "0.6",
      };
    });
  },

  async events({ admin, tenantId, origin }) {
    const { data } = await readPagedRows((from, to) =>
      admin
        .from("events")
        .select("slug, updated_at, created_at", { count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .order("id", { ascending: true })
        .range(from, to),
    );
    return (data ?? []).map((row) => {
      const ev = row as { slug: string; updated_at: string | null; created_at: string | null };
      return {
        loc: `${origin}/events/${ev.slug}`,
        lastmod: day(ev.updated_at, ev.created_at),
        changefreq: "weekly" as const,
        priority: "0.6",
      };
    });
  },

  /** Publiczne sesje Q&A (poza szkicami) - strony z markupem QAPage. */
  async qa({ admin, tenantId, origin }) {
    const { data } = await readPagedRows((from, to) =>
      admin
        .from("qa_sessions")
        .select("slug, updated_at, opens_at", { count: "exact" })
        .eq("tenant_id", tenantId)
        .neq("status", "draft")
        .order("id", { ascending: true })
        .range(from, to),
    );
    return (data ?? []).map((row) => {
      const qa = row as { slug: string; updated_at: string | null; opens_at: string | null };
      return {
        loc: `${origin}/qa/${qa.slug}`,
        lastmod: day(qa.updated_at, qa.opens_at),
        changefreq: "weekly" as const,
        priority: "0.5",
      };
    });
  },

  /**
   * Huby ekspertów - profile z odznaką 'expert' i publicznym profilem autorskim
   * są pełnoprawnymi landing page (indeksowalne).
   */
  async experts({ admin, tenantId, origin }) {
    const { data: expertBadges } = await readPagedRows((from, to) =>
      admin
        .from("profile_badges")
        .select("user_id", { count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("badge", "expert")
        .order("id", { ascending: true })
        .range(from, to),
    );
    const expertIds = Array.from(
      new Set((expertBadges ?? []).map((b) => (b as { user_id: string }).user_id)),
    );
    if (expertIds.length === 0) return [];

    const [{ data: expertProfiles }, { data: publicAps }] = await Promise.all([
      readPagedRows((from, to) =>
        admin
          .from("profiles")
          .select("id, slug, updated_at", { count: "exact" })
          .in("id", expertIds)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      readPagedRows((from, to) =>
        admin
          .from("author_profiles")
          .select("user_id, is_public", { count: "exact" })
          .in("user_id", expertIds)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);
    const publicIds = new Set(
      (publicAps ?? [])
        .filter((a) => (a as { is_public: boolean }).is_public)
        .map((a) => (a as { user_id: string }).user_id),
    );
    const out: SitemapEntry[] = [];
    for (const row of expertProfiles ?? []) {
      const pr = row as { id: string; slug: string | null; updated_at: string | null };
      if (!pr.slug || !publicIds.has(pr.id)) continue;
      out.push({
        loc: `${origin}/author/${pr.slug}`,
        lastmod: day(pr.updated_at),
        changefreq: "weekly",
        priority: "0.7",
      });
    }
    return out;
  },
};

function pagePathsOnce(admin: DbClient, tenantId: string) {
  let cached: Promise<{ paths: Map<string, string>; noindex: Set<string> }> | null = null;
  return () => (cached ??= buildPagePaths(admin, tenantId));
}

/**
 * Adresy JEDNEJ sekcji. Powierzchnie crawlerskie DEGRADUJĄ, nigdy nie zwracają
 * 500: awaria odczytu to pusta sekcja (dla "core" - same statyczne huby), nie
 * zatruty crawl.
 */
export async function collectSitemapSection(
  admin: DbClient,
  tenantId: string,
  origin: string,
  section: SitemapSection,
): Promise<SitemapEntry[]> {
  if (section === "core") return coreSitemapEntries(origin);
  try {
    return await COLLECTORS[section]({
      admin,
      tenantId,
      origin,
      pagePaths: pagePathsOnce(admin, tenantId),
    });
  } catch (e) {
    console.warn(`[seo] sitemap section "${section}" read failed:`, e);
    return [];
  }
}

/**
 * Adresy WSZYSTKICH sekcji - potrzebne indeksowi, który musi znać liczbę adresów,
 * żeby policzyć shardy. Mapa ścieżek stron budowana raz na całe wywołanie.
 */
export async function collectAllSitemapSections(
  admin: DbClient,
  tenantId: string | null,
  origin: string,
): Promise<Map<SitemapSection, SitemapEntry[]>> {
  const out = new Map<SitemapSection, SitemapEntry[]>();
  out.set("core", coreSitemapEntries(origin));
  // Bez tenanta (tryb degradacji) nie ma czego czytać - zostaje sam szkielet.
  if (!tenantId) return out;

  const pagePaths = pagePathsOnce(admin, tenantId);
  const sections = Object.keys(COLLECTORS) as Array<Exclude<SitemapSection, "core">>;
  const results = await Promise.all(
    sections.map(async (section) => {
      try {
        return [
          section,
          await COLLECTORS[section]({ admin, tenantId, origin, pagePaths }),
        ] as const;
      } catch (e) {
        console.warn(`[seo] sitemap section "${section}" read failed:`, e);
        return [section, [] as SitemapEntry[]] as const;
      }
    }),
  );
  for (const [section, entries] of results) out.set(section, entries);
  return out;
}
