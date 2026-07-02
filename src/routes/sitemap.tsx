// Public HTML site map (/sitemap, /en/sitemap) - the human- and AI-readable
// counterpart of sitemap.xml: every published page (hierarchy preserved),
// category and the latest posts on one flat-crawlable page. Good for visitors
// (orientation), for crawl depth (every URL reachable within two clicks) and
// for answer engines mapping the site's structure (GEO).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  blogListQueryOptions,
  publicCategoriesQueryOptions,
  publicPagesTreeQueryOptions,
} from "@/lib/queries/public";
import { buildPageTree, type PageTreeNode } from "@/lib/seo/pageTree";
import { buildContentHead } from "@/lib/seo/meta";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { contentCacheControl } from "@/lib/http/cachePolicy";

const COPY = {
  pl: {
    title: "Mapa strony",
    description: "Pełna mapa serwisu: wszystkie strony, kategorie i najnowsze artykuły.",
    pages: "Strony",
    categories: "Kategorie",
    posts: "Najnowsze artykuły",
    home: "Strona główna",
    blog: "Blog",
  },
  en: {
    title: "Site map",
    description: "The full site map: every page, category and the latest articles.",
    pages: "Pages",
    categories: "Categories",
    posts: "Latest articles",
    home: "Home",
    blog: "Blog",
  },
} as const;

export const Route = createFileRoute("/sitemap")({
  loader: async ({ context }) => {
    setCacheControlHeader(contentCacheControl());
    await Promise.allSettled([
      context.queryClient.ensureQueryData(publicPagesTreeQueryOptions()),
      context.queryClient.ensureQueryData(publicCategoriesQueryOptions()),
      context.queryClient.ensureQueryData(blogListQueryOptions()),
    ]);
    return null;
  },
  head: () => {
    const url = getRequestUrl() || "/sitemap";
    const lang = activeLang(url);
    const copy = COPY[lang];
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: `${copy.title} - New European Strategies`,
      description: copy.description,
    });
  },
  component: SiteMapPage,
});

function PageTreeList({ nodes, lang }: { nodes: PageTreeNode[]; lang: "pl" | "en" }) {
  if (!nodes.length) return null;
  return (
    <ul className="space-y-1.5 pl-4 border-l border-border">
      {nodes.map((node) => (
        <li key={node.id}>
          {/* The universal splat route serves arbitrary page paths; the router
              output rewrite localizes the href ("/en/..." for EN) for free. */}
          <Link
            to="/$"
            params={{ _splat: node.path.replace(/^\//, "") }}
            className="text-sm hover:text-brand hover:underline"
          >
            {(lang === "en" ? node.title_en || node.title_pl : node.title_pl || node.title_en) ||
              node.slug}
          </Link>
          {node.children.length > 0 && (
            <div className="mt-1.5">
              <PageTreeList nodes={node.children} lang={lang} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function SiteMapPage() {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const copy = COPY[lang];
  const { data: pageRows } = useSuspenseQuery(publicPagesTreeQueryOptions());
  const { data: categories } = useSuspenseQuery(publicCategoriesQueryOptions());
  const { data: blog } = useSuspenseQuery(blogListQueryOptions());

  // The "home" root page is served at "/" - the explicit home link above the
  // tree covers it, so drop the duplicate node.
  const tree = buildPageTree(pageRows.filter((r) => !(r.parent_id === null && r.slug === "home")));

  return (
    <div className="flex flex-col bg-background text-foreground" data-page-template="sitemap">
      <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
        <h1 className="font-display text-4xl lg:text-5xl mb-2">{copy.title}</h1>
        <p className="text-sm text-muted-foreground mb-8">{copy.description}</p>

        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
          <section aria-labelledby="sitemap-pages">
            <h2 id="sitemap-pages" className="font-display text-xl font-semibold mb-3">
              {copy.pages}
            </h2>
            <ul className="space-y-1.5 mb-1.5">
              <li>
                <Link to="/" className="text-sm hover:text-brand hover:underline">
                  {copy.home}
                </Link>
              </li>
              <li>
                <Link to="/blog" className="text-sm hover:text-brand hover:underline">
                  {copy.blog}
                </Link>
              </li>
            </ul>
            <PageTreeList nodes={tree} lang={lang} />
          </section>

          <section aria-labelledby="sitemap-categories">
            <h2 id="sitemap-categories" className="font-display text-xl font-semibold mb-3">
              {copy.categories}
            </h2>
            <ul className="space-y-1.5">
              {categories.map((c) => (
                <li key={c.slug}>
                  <Link
                    to="/category/$slug"
                    params={{ slug: c.slug }}
                    className="text-sm hover:text-brand hover:underline"
                  >
                    {(lang === "en" ? c.name_en || c.name_pl : c.name_pl || c.name_en) || c.slug}
                  </Link>
                </li>
              ))}
              {!categories.length && <li className="text-sm text-muted-foreground">-</li>}
            </ul>
          </section>

          <section aria-labelledby="sitemap-posts" className="md:col-span-2 lg:col-span-1">
            <h2 id="sitemap-posts" className="font-display text-xl font-semibold mb-3">
              {copy.posts}
            </h2>
            <ul className="space-y-1.5">
              {blog.posts.map((post) => (
                <li key={post.id} className="flex items-baseline gap-2">
                  <Link
                    to="/post/$slug"
                    params={{ slug: post.slug }}
                    className="text-sm hover:text-brand hover:underline min-w-0"
                  >
                    {(lang === "en"
                      ? post.title_en || post.title_pl
                      : post.title_pl || post.title_en) || post.slug}
                  </Link>
                  {post.published_at && (
                    <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                      {post.published_at.slice(0, 10)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
