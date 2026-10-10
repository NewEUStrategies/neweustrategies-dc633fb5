// Wpisy Google News sitemapy dla tenanta - JEDNO źródło dla dwóch tras:
// pliku (/news-sitemap.xml) i indeksu (/sitemap.xml).
//
// PO CO WSPÓLNY ODCZYT. Indeks ogłaszał news-sitemapę na podstawie samej
// flagi `news_sitemap_enabled` - bez sprawdzenia, czy plik ma co pokazać. Tak
// trafiał do Search Console dokument pusty, raportowany jako „Brak tagu XML:
// url". Indeks liczy teraz plan TYM SAMYM odczytem i TĄ SAMĄ funkcją
// (`planNewsSitemap`), co trasa pliku - ta sama zasada, którą shardy sekcji
// stosują od początku („indeks nigdy nie ogłasza pliku, który wyszedłby
// pusty"). Odczyt jest z `edgeTtlCache`, więc drugi odbiorca nie kosztuje
// drugiego zapytania.
import { localizedPath } from "@/lib/i18n/localePath";
import type { NewsSitemapEntry } from "@/lib/seo/newsSitemap";
import { fetchPublishedPosts } from "./publishedContent.server";

/** 200 najnowszych wpisów z zapasem pokrywa każde 48-godzinne okno publikacji. */
const NEWS_SITEMAP_POST_LIMIT = 200;

export async function loadNewsSitemapEntries(
  tenantId: string,
  origin: string,
): Promise<NewsSitemapEntry[]> {
  const posts = await fetchPublishedPosts(tenantId, NEWS_SITEMAP_POST_LIMIT);
  const entries: NewsSitemapEntry[] = [];
  for (const post of posts) {
    if (!post.published_at) continue;
    if (post.title_pl) {
      entries.push({
        url: `${origin}${localizedPath(post.path, "pl")}`,
        title: post.title_pl,
        publishedAt: post.published_at,
        language: "pl",
      });
    }
    if (post.title_en) {
      entries.push({
        url: `${origin}${localizedPath(post.path, "en")}`,
        title: post.title_en,
        publishedAt: post.published_at,
        language: "en",
      });
    }
  }
  return entries;
}
