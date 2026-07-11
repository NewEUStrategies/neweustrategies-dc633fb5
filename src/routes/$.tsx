// Universal public resolver. Handles:
//   /<page-slug>
//   /<parent>/<child>/...
//   /<page-path>/<post-slug>
// Static routes (/, /blog, /login, /post/$slug, /admin/*, /api/*) match first.
import { createFileRoute, notFound, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
// Header/Footer are owned by SiteChrome (mounted in __root.tsx) so they
// persist across navigations - never re-import them here.
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { errorCopy } from "@/lib/errorCopy";
import { type CurrentPostCtx } from "@/lib/builder/currentPostContext";
import { ContentRenderer } from "@/components/content/ContentRenderer";
import { resolveContentEngine } from "@/lib/content/contentEngine";
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { processManualToc } from "@/lib/manualToc";
import { processDocFootnotes, processHtmlFootnotes } from "@/lib/footnotes";
import { FloatingShareBar } from "@/components/share/FloatingShareBar";
import { PostSidebarRenderer } from "@/components/post/PostSidebarRenderer";
import { AutoLoadNextPost } from "@/components/post/AutoLoadNextPost";
import { CustomMetaList } from "@/components/post/CustomMetaList";
import { PostOverlayMeta } from "@/components/post/PostOverlayMeta";
import { CategoryBadges } from "@/components/post/CategoryBadges";
import { RelatedPosts } from "@/components/post/RelatedPosts";
import { RelatedPostsAfterParagraph } from "@/components/post/RelatedPostsAfterParagraph";
import { relatedPostsConfigQueryOptions } from "@/lib/queries/relatedPosts";
import { mergeRelatedConfig, type RelatedPostsOverride } from "@/lib/relatedPosts";
import { useRecordPostView } from "@/hooks/useRecordPostView";
import { ContactForm } from "@/components/pages/ContactForm";
import { ArchiveListing } from "@/components/pages/ArchiveListing";
import { findPageTemplate } from "@/lib/pageTemplates";
import { useQuery } from "@tanstack/react-query";
import { listCustomMetaDefs } from "@/lib/customMeta";
import { FootnotesList, FootnoteTooltips } from "@/components/Footnotes";
import { buildBreadcrumbs, type BreadcrumbItem } from "@/lib/breadcrumbs";
import { estimateReadingMinutes } from "@/lib/readingTime";
import { useUnlockedContent } from "@/hooks/useUnlockedContent";
import { usePasswordUnlock } from "@/hooks/usePasswordUnlock";
import {
  isGatedMode,
  hasRenderableBody,
  shouldShowPaywall,
  pickBody,
  type BodyParts,
} from "@/lib/access/gating";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, buildArticleJsonLd, imagePreloadLink, splitUrl } from "@/lib/seo/meta";
import {
  applyTitleSuffix,
  resolveRobotsMeta,
  resolveSeoText,
  resolveSocialImage,
  seoCanonicalOverride,
  socialImageIsGeneratedCard,
  type SeoFieldsRow,
} from "@/lib/seo/fields";
import { breadcrumbListJsonLd, safeJsonLd } from "@/lib/seo/jsonld";
import { effectiveTitleSuffix, parseSeoSettings } from "@/lib/seo/settings";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { buildImageSrcSet } from "@/lib/cropSizes";
import { activeLang } from "@/lib/seo/head";
import { Paywall } from "@/components/Paywall";
import { PostLayoutRenderer } from "@/components/PostLayoutRenderer";
import { PostFooterBars } from "@/components/PostFooterBars";
import { CommentsSection } from "@/components/comments/CommentsSection";
import { PostContentStyle } from "@/components/PostContentStyle";
import { QuickViewInfoBar } from "@/components/post/QuickViewInfoBar";
import { NewsletterForm } from "@/components/NewsletterForm";
import { KeyTakeaways } from "@/components/molecules/KeyTakeaways";
// PostListenBar zastąpiony przez SidebarListenCard + GlobalAudioBar.
import { InlineToc } from "@/components/post/InlineToc";
import { useTocDefaults, type TocOverride } from "@/lib/toc/settings";

import { usePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import {
  mergeOverrides,
  pickLayoutId,
  findLayout,
  coverImageSizes,
  defaultPostLayoutSettings,
  type PostFormat,
  type PostLayoutSettings,
} from "@/lib/postLayouts";
import {
  resolvedContentQueryOptions,
  type PostData,
  type PageData,
  type ResolvedContent,
} from "@/lib/queries/public";
import { adjacentPostsQueryOptions, type AdjacentPostRow } from "@/lib/queries/adjacentPosts";
import { AdZone } from "@/components/AdSlot";
import { MidPostAds } from "@/components/ads/MidPostAds";
import { FooterSlideup } from "@/components/ads/FooterSlideup";
import type { AdPageType } from "@/lib/ads/types";
import { prefetchAboveFoldQueries } from "@/lib/builder/prefetch";
import { prefetchBlockQueries } from "@/lib/queries/blocks";
import { postLayoutSettingsQueryOptions } from "@/hooks/usePostLayoutSettings";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { contentCacheControl } from "@/lib/http/cachePolicy";
import { splatToSegments, metaDescription } from "@/lib/routing/publicSegments";

interface CoverPreload {
  href: string;
  imageSrcSet: string;
  imageSizes: string;
}

/**
 * LCP cover-image preload descriptor for a post, mirroring exactly what
 * `PostLayoutRenderer` paints - same responsive candidates (`buildImageSrcSet`)
 * and the same `sizes` (`coverImageSizes`) - so the preloaded candidate is the
 * one the browser renders, never a second download. Returns null when the
 * active layout shows no cover (`cover: "none"`, e.g. layout-9) or the post has
 * no cover image. Pages are excluded: their hero lives in the builder document.
 */
function buildCoverPreload(item: PostData, settings: PostLayoutSettings): CoverPreload | null {
  const cover = item.cover_image_url;
  if (!cover) return null;
  const format: PostFormat = item.layout_overrides?.format ?? item.post_format ?? "standard";
  const layoutId = pickLayoutId(settings, format, item.layout_overrides?.layout);
  const preset = findLayout(format, layoutId);
  if (preset.cover === "none") return null;
  return {
    href: cover,
    imageSrcSet: buildImageSrcSet(cover),
    imageSizes: coverImageSizes(preset),
  };
}

export const Route = createFileRoute("/$")({
  // Chrome (Header/Footer) is centralized in SiteChrome at the root - never
  // opt out here, or navigations remount the whole header/menu.
  loader: async ({ params, context }) => {
    const splat = (params as { _splat?: string })._splat ?? "";
    const segments = splatToSegments(splat);
    if (segments.length === 0) throw notFound();
    const data = await context.queryClient.ensureQueryData(resolvedContentQueryOptions(segments));
    if (!data) throw notFound();
    // ISR-like edge caching: the public SSR is the anonymous shell (gated bodies
    // are fetched client-side after hydration), so it is safe to share-cache and
    // serve stale-while-revalidate from the CDN. The language lives in the URL
    // path (PL at the bare path, EN under "/en"), so each language is its own
    // cache entry - no cookie-driven personalization, no language poisoning.
    setCacheControlHeader(contentCacheControl());
    const url = getRequestUrl() || `/${splat}`;
    const lang: "pl" | "en" = activeLang(url) === "en" ? "en" : "pl";
    const doc = parseBuilderDoc(data.item.builder_data);
    // Blocks engine: warm every data query its views will render (latest
    // posts, taxonomies, related, calendar, ...) so the SSR HTML carries the
    // real lists - without this a crawler sees only skeletons/empty markup.
    const localizedBlocks =
      (data.item as { blocks_data?: LocalizedBlocks | null }).blocks_data ?? null;
    const blocksDoc: BlocksDoc | null = localizedBlocks
      ? (localizedBlocks[lang] ?? localizedBlocks.pl ?? localizedBlocks.en ?? null)
      : null;
    await Promise.allSettled([
      data.kind === "post"
        ? context.queryClient.prefetchQuery(postLayoutSettingsQueryOptions())
        : Promise.resolve(),
      doc.sections.length > 0
        ? // Public pages/posts are edge-cached. Block the SSR response only on the
          // above-the-fold sections; below-the-fold sections Suspense-stream as
          // their data settles (see BuilderRenderer `stream`). Net effect: a cold
          // (cache-miss) render's TTFB tracks the hero, not the whole document,
          // while the streamed body stays complete for the CDN and crawlers.
          prefetchAboveFoldQueries(context.queryClient, doc, lang)
        : Promise.resolve(),
      blocksDoc && blocksDoc.blocks.length > 0
        ? prefetchBlockQueries(context.queryClient, blocksDoc, lang, {
            postId: data.kind === "post" ? data.item.id : null,
            publishedAt: data.item.published_at,
            // Mirror the client's useCurrentPostCtx-derived key exactly, or the
            // SSR-warmed related/more/author-bio entries miss on hydration and
            // crawlers see the wrong (category-agnostic) lists.
            authorId:
              data.kind === "post"
                ? ((data as { author?: { id: string } | null }).author?.id ?? null)
                : null,
            categorySlugs:
              data.kind === "post"
                ? ((data as { categories?: Array<{ slug: string }> }).categories ?? []).map(
                    (c) => c.slug,
                  )
                : [],
            tagSlugs: data.kind === "post" ? (data.tags ?? []).map((t) => t.slug) : [],
          })
        : Promise.resolve(),
      context.queryClient.prefetchQuery(relatedPostsConfigQueryOptions()),
    ]);
    // Site-wide SEO settings for head() (title suffix, twitter:site, publisher
    // logo). The root loader warms the same bulk query, so this resolves from
    // cache; head() is synchronous and cannot fetch on its own.
    const settingsMap = await context.queryClient.ensureQueryData(siteSettingsQueryOptions);
    const seoSettings = parseSeoSettings(settingsMap["seo"]);
    // Posts: attach the LCP cover preload so head() can emit it. The layout
    // settings were just warmed above, so this reads from cache (no extra
    // round-trip) and falls back to defaults if that prefetch was rejected.
    if (data.kind === "post") {
      const settings =
        context.queryClient.getQueryData<PostLayoutSettings>(
          postLayoutSettingsQueryOptions().queryKey,
        ) ?? defaultPostLayoutSettings();
      return { ...data, seoSettings, coverPreload: buildCoverPreload(data.item, settings) };
    }
    return { ...data, seoSettings };
  },
  head: ({ loaderData, params }) => {
    const it = loaderData?.item;
    if (!it) return { meta: [] };
    const splat = (params as { _splat?: string })._splat ?? "";
    const url = getRequestUrl() || `/${splat}`;
    const lang = activeLang(url);
    const isPost = loaderData.kind === "post";
    const seoSettings = loaderData.seoSettings ?? parseSeoSettings(null);
    const seoRow = it as SeoFieldsRow;

    // Derived values first, then the per-entity SEO overrides on top - the
    // exact chain the admin SERP preview simulates.
    const fallbackTitle =
      (lang === "en" ? it.title_en || it.title_pl : it.title_pl || it.title_en) || "Strona";
    const excerpt =
      "excerpt_pl" in it
        ? lang === "en"
          ? it.excerpt_en || it.excerpt_pl
          : it.excerpt_pl || it.excerpt_en
        : null;
    const tags = "tags" in loaderData ? (loaderData.tags ?? []).map((t) => t.name) : [];
    const { title, description, titleIsOverride } = resolveSeoText(
      seoRow,
      lang,
      fallbackTitle,
      metaDescription(excerpt, fallbackTitle),
    );
    const documentTitle = applyTitleSuffix(
      title,
      effectiveTitleSuffix(seoSettings),
      titleIsOverride,
    );
    const image = resolveSocialImage(seoRow, it.cover_image_url);
    const imageIsCard = socialImageIsGeneratedCard(seoRow, image);
    const head = buildContentHead({
      url,
      lang,
      type: isPost ? "article" : "website",
      title,
      documentTitle,
      description,
      image,
      publishedAt: it.published_at,
      modifiedAt: it.updated_at,
      tags,
      robots: resolveRobotsMeta(seoRow),
      canonicalOverride: seoCanonicalOverride(seoRow),
      imageWidth: imageIsCard ? 1200 : undefined,
      imageHeight: imageIsCard ? 630 : undefined,
      imageAlt: image ? title : undefined,
      twitterSite: seoSettings.twitter_site || null,
    });
    const { origin } = splitUrl(url);
    // Emit the JSON-LD graph in <head> (not the body) so crawlers parse the
    // structured data early, before the full document streams. The article
    // node carries the AEO layer (section, keywords, abstract, speakable);
    // BreadcrumbList is SSR-emitted here because the body breadcrumbs only
    // exist after hydration.
    const takeaways = (lang === "en" ? it.takeaways_en : it.takeaways_pl) ?? [];
    const parentCrumbs = [...(loaderData.crumbs ?? [])].sort((a, b) => a.depth - b.depth);
    const sectionCrumb = isPost
      ? parentCrumbs[parentCrumbs.length - 1]
      : parentCrumbs[parentCrumbs.length - 2];
    const jsonLd = buildArticleJsonLd({
      url,
      lang,
      isArticle: isPost,
      title,
      description,
      image,
      publishedAt: it.published_at,
      modifiedAt: it.updated_at,
      gated: isGatedMode(loaderData.access?.mode),
      section: sectionCrumb
        ? lang === "en"
          ? sectionCrumb.title_en || sectionCrumb.title_pl
          : sectionCrumb.title_pl || sectionCrumb.title_en
        : null,
      tags,
      takeaways,
      publisherLogoUrl:
        seoSettings.publisher_logo_url.trim() || (origin ? `${origin}/og-default.jpg` : null),
      speakable: isPost,
    });
    const breadcrumbLd = breadcrumbListJsonLd(
      buildBreadcrumbs(
        loaderData.crumbs ?? [],
        lang === "en" ? "en" : "pl",
        isPost ? title : undefined,
      ),
      origin,
      lang,
    );
    // Preload the LCP cover image (posts only) so its fetch starts from <head>,
    // before the <img> is parsed in the body. The descriptor matches the
    // rendered <img> srcSet/sizes 1:1, so no candidate is fetched twice.
    const links =
      loaderData.kind === "post" && loaderData.coverPreload
        ? [...head.links, imagePreloadLink(loaderData.coverPreload)]
        : head.links;
    return {
      ...head,
      links,
      // safeJsonLd - editor-authored titles/excerpts must not be able to close
      // the <script> element and inject markup (stored XSS).
      scripts: [
        { type: "application/ld+json", children: safeJsonLd(jsonLd) },
        { type: "application/ld+json", children: safeJsonLd(breadcrumbLd) },
      ],
    };
  },

  component: PublicPage,
  notFoundComponent: PublicNotFound,
  errorComponent: PublicErrorComponent,
});

// Named (uppercase) component - hooks inside an inline lowercase
// `errorComponent` arrow violate rules-of-hooks (ESLint cannot treat it as a
// component, and neither can React DevTools).
function PublicErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const copy = errorCopy();
  // Raw error.message is logged for diagnostics, never rendered to visitors.
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex-1 max-w-3xl mx-auto px-4 py-20 text-center">
      <h1 className="font-display text-2xl">{copy.errorTitle}</h1>
      <p className="text-sm text-muted-foreground mt-2">{copy.errorBody}</p>
      <button
        onClick={() => {
          router.invalidate();
          reset();
        }}
        className="mt-6 bg-brand text-brand-foreground px-4 py-2 rounded text-sm"
      >
        {copy.tryAgain}
      </button>
    </main>
  );
}

function PublicPage() {
  const params = Route.useParams() as { _splat?: string };
  const segments = splatToSegments(params._splat ?? "");
  const { data } = useSuspenseQuery(resolvedContentQueryOptions(segments));
  // The early return lives in this thin wrapper so ResolvedPage's hooks run
  // unconditionally (rules-of-hooks: a guard ABOVE hooks in the same component
  // changes the hook order between renders and crashes on the busiest route).
  if (!data) return <PublicNotFound />;
  return <ResolvedPage data={data} />;
}

function ResolvedPage({ data }: { data: ResolvedContent }) {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const it = data.item;
  const title = lang === "en" ? it.title_en || it.title_pl : it.title_pl || it.title_en;
  const isPost = data.kind === "post";
  const post = isPost ? (it as PostData) : null;
  const excerpt = post ? (lang === "en" ? post.excerpt_en : post.excerpt_pl) : null;
  const postTags = isPost
    ? (data as { tags?: Array<{ slug: string; name: string }> }).tags
    : undefined;
  const postCategories = isPost
    ? ((data as { categories?: Array<{ slug: string; name_pl: string; name_en: string }> })
        .categories ?? [])
    : [];
  // Kontekst targetingu reklam: slugi kategorii/tagów bieżącego posta.
  const adContent = isPost
    ? {
        categorySlugs: postCategories.map((c) => c.slug),
        tagSlugs: (postTags ?? []).map((tg) => tg.slug),
      }
    : undefined;
  const postAuthor = isPost
    ? ((
        data as {
          author?: {
            id: string;
            slug: string | null;
            display_name: string | null;
            first_name: string | null;
            last_name: string | null;
            avatar_url: string | null;
            author_profile?: {
              avatar_url: string | null;
              job_title: string | null;
              company: string | null;
              bio_pl: string | null;
              bio_en: string | null;
              contact_email: string | null;
              phone: string | null;
              website_url: string | null;
              x_url: string | null;
              linkedin_url: string | null;
              facebook_url: string | null;
              instagram_url: string | null;
              spotify_url: string | null;
              custom_socials: Array<{ label: string; url: string; iconUrl?: string }>;
            } | null;
          } | null;
        }
      ).author ?? null)
    : null;

  // Access rule (mode/teaser/plans/price) is non-sensitive and arrives from the
  // resolver, so the paywall teaser renders correctly even in anonymous SSR.
  const accessRule = data.access;
  const { data: globalLayoutSettings } = usePostLayoutSettings();
  const tocDefaults = useTocDefaults();
  useRecordPostView(isPost ? it.id : null, postAuthor?.id ?? null);

  // Body columns arrive gated from the server: an unentitled / anonymous (SSR)
  // caller gets an all-null body, so premium content is never shipped. For an
  // entitled user who hard-loaded the page (anon SSR), re-request the body
  // client-side; `pickBody` then prefers the unlocked copy.
  const ssrBody: BodyParts = {
    content_pl: it.content_pl,
    content_en: it.content_en,
    builder_data: it.builder_data,
    blocks_data: (it as { blocks_data?: LocalizedBlocks | null }).blocks_data ?? null,
  };
  const needsUnlock = isGatedMode(accessRule?.mode) && !hasRenderableBody(ssrBody);
  const nonPasswordGate = needsUnlock && accessRule?.mode !== "password";
  const unlocked = useUnlockedContent(isPost ? "post" : "page", it.id, nonPasswordGate);
  // Password-gated entities take a separate unlock path (see Paywall below).
  const pwdUnlock = usePasswordUnlock(
    isPost ? "post" : "page",
    it.id,
    needsUnlock && accessRule?.mode === "password",
  );
  const body = pickBody(pickBody(ssrBody, unlocked), pwdUnlock.body);

  const rawDoc = parseBuilderDoc(body.builder_data);
  const rawHtml =
    lang === "en" ? body.content_en || body.content_pl : body.content_pl || body.content_en;

  // Block editor (Gutenberg/Foxiz-style) - wpisy w nowym formacie
  const blocksData = (body.blocks_data as LocalizedBlocks | null) ?? null;
  const blocksDoc: BlocksDoc | null = blocksData
    ? (blocksData[lang] ?? blocksData.pl ?? blocksData.en ?? null)
    : null;

  const { doc, notes: builderNotes } = processDocFootnotes(rawDoc, lang);
  const { html: footnoteHtml, notes: htmlNotes } = processHtmlFootnotes(rawHtml ?? "", 1);
  // Manual <!--TOC--> marker -> inline auto-generated table of contents;
  // also assigns stable IDs to h2/h3 so deep links work.
  const { html: processedHtml } = processManualToc(footnoteHtml, lang);
  // Single source of truth for the rendering engine (builder | blocks | html).
  const engine = resolveContentEngine({ editor: it.editor, builderDoc: doc, blocksDoc });
  // Blocks render their own footnotes section + inline [n] tooltips inside
  // BlocksRenderer, so the page-level FootnotesList / FootnoteTooltips below must
  // stay empty for the blocks engine. Otherwise a legacy content_pl/en field that
  // still contains [fn] markers would emit a SECOND, mismatched footnotes list
  // with duplicate #fn-/#footnotes-heading ids.
  const notes = engine === "builder" ? builderNotes : engine === "html" ? htmlNotes : [];
  const articleRef = useRef<HTMLDivElement>(null);

  // Custom meta definitions (publicly readable, cached).
  const { data: customMetaDefs = [] } = useQuery({
    queryKey: ["customMetaDefs", "public"] as const,
    queryFn: () => listCustomMetaDefs(),
    staleTime: 5 * 60_000,
  });

  // Related posts global config (singleton). Per-post override merges on top.
  const { data: relatedGlobalCfg } = useQuery(relatedPostsConfigQueryOptions());
  const relatedOverride = (post?.related_override ?? null) as RelatedPostsOverride | null;
  const relatedCfg = mergeRelatedConfig(relatedGlobalCfg, relatedOverride);

  // Prev/next footer navigation (show_prev_next). Client-side only and gated:
  // the query fires exclusively when the toggle is effectively on (global
  // setting or per-post override) for a published post, so it costs nothing
  // otherwise. parent_path="post" routes the links through the dedicated
  // /post/$slug resolver, which always works regardless of parent page paths.
  const prevNextEnabled = Boolean(
    isPost &&
    post &&
    globalLayoutSettings &&
    mergeOverrides(globalLayoutSettings, post.layout_overrides ?? null).show_prev_next,
  );
  const { data: adjacentPosts } = useQuery(
    adjacentPostsQueryOptions(
      prevNextEnabled ? (post?.id ?? null) : null,
      prevNextEnabled ? (post?.published_at ?? null) : null,
    ),
  );
  const toNeighbor = (row: AdjacentPostRow | null | undefined) =>
    row
      ? {
          slug: row.slug,
          title: lang === "en" ? row.title_en || row.title_pl : row.title_pl || row.title_en,
          parent_path: "post",
        }
      : null;
  const prevPost = toNeighbor(adjacentPosts?.prev);
  const nextPost = toNeighbor(adjacentPosts?.next);

  const [crumbs, setCrumbs] = useState<BreadcrumbItem[]>([]);
  useEffect(() => {
    setCrumbs(buildBreadcrumbs(data.crumbs, lang, isPost ? title : undefined));
  }, [data, lang, title, isPost]);

  // JSON-LD is emitted in <head> via the route head() above, not in the body.

  // Outer article/page width honours /admin/content-area → wide_align_max_width
  // (fallback 1200 px). Bez tego, mimo ustawień w kokpicie, treść zawsze
  // "wpadałaby" w wąski kontener i po bokach zostawałaby pusta przestrzeń.
  const outerMaxWidthPx =
    globalLayoutSettings?.wide_align_max_width && globalLayoutSettings.wide_align_max_width > 0
      ? globalLayoutSettings.wide_align_max_width
      : 1200;
  const outerMaxStyle = { maxWidth: `${outerMaxWidthPx}px` } as const;
  const showPaywall = shouldShowPaywall(accessRule?.mode, body);

  const takeaways: readonly string[] = (lang === "en" ? it.takeaways_en : it.takeaways_pl) ?? [];

  const currentPostCtx: CurrentPostCtx = {
    kind: isPost ? "post" : "page",
    id: it.id,
    slug: it.slug ?? undefined,
    title_pl: it.title_pl ?? undefined,
    title_en: it.title_en ?? undefined,
    excerpt_pl: post?.excerpt_pl ?? undefined,
    excerpt_en: post?.excerpt_en ?? undefined,
    coverUrl: it.cover_image_url ?? undefined,
    publishedAt: it.published_at ?? undefined,
    readingTimeMin: isPost
      ? estimateReadingMinutes(
          {
            html: processedHtml,
            docs: [doc, blocksDoc],
            extraText: post?.excerpt_pl || post?.excerpt_en || undefined,
          },
          { lang },
        ) ||
        post?.read_minutes ||
        undefined
      : undefined,
    author: postAuthor
      ? {
          id: postAuthor.id,
          name:
            postAuthor.display_name ||
            [postAuthor.first_name, postAuthor.last_name].filter(Boolean).join(" ") ||
            undefined,
          slug: postAuthor.slug ?? undefined,
          avatarUrl: postAuthor.author_profile?.avatar_url ?? postAuthor.avatar_url ?? undefined,
          jobTitle: postAuthor.author_profile?.job_title ?? undefined,
          company: postAuthor.author_profile?.company ?? undefined,
          bio_pl: postAuthor.author_profile?.bio_pl ?? undefined,
          bio_en: postAuthor.author_profile?.bio_en ?? undefined,
          contactEmail: postAuthor.author_profile?.contact_email ?? undefined,
          phone: postAuthor.author_profile?.phone ?? undefined,
          websiteUrl: postAuthor.author_profile?.website_url ?? undefined,
          xUrl: postAuthor.author_profile?.x_url ?? undefined,
          linkedinUrl: postAuthor.author_profile?.linkedin_url ?? undefined,
          facebookUrl: postAuthor.author_profile?.facebook_url ?? undefined,
          instagramUrl: postAuthor.author_profile?.instagram_url ?? undefined,
          spotifyUrl: postAuthor.author_profile?.spotify_url ?? undefined,
          customSocials: postAuthor.author_profile?.custom_socials ?? undefined,
        }
      : null,
    tags: postTags ?? [],
    categories: postCategories.map((c) => ({
      slug: c.slug,
      name: lang === "en" ? c.name_en || c.name_pl : c.name_pl || c.name_en,
    })),
    breadcrumbs: crumbs.map((b) => ({ label: b.label, href: b.href ?? undefined })),
  };

  const contentBlock = (
    <div ref={articleRef} className="article-body">
      {accessRule && showPaywall ? (
        <Paywall
          rule={accessRule}
          lang={lang}
          fallbackText={excerpt}
          onPasswordVerify={pwdUnlock.verify}
          passwordVerifying={pwdUnlock.loading}
        />
      ) : (
        <>
          {(() => {
            const hasBullets = takeaways.length > 0;
            const tocOverride = (post?.toc_override ?? null) as TocOverride | null;
            const readMinutes = post?.read_minutes ?? null;
            return (
              <>
                {/* Tylko realne punkty trafiają na stronę publiczną - placeholder
                    „uzupełnij punkty" był widoczny dla czytelników przy postach
                    bez takeaways. Puste = nie renderujemy sekcji. */}
                {hasBullets && (
                  <KeyTakeaways
                    items={takeaways}
                    variantOverride={it.takeaways_variant ?? undefined}
                  />
                )}
                {/* Widget odsłuchu został przeniesiony do sidebar (nad "Spis treści"). */}
                {isPost && (
                  <InlineToc
                    blocksDoc={blocksDoc}
                    defaults={tocDefaults}
                    override={tocOverride}
                    lang={lang}
                  />
                )}
              </>
            );
          })()}
          <ContentRenderer
            editor={it.editor}
            builderDoc={doc}
            blocksDoc={blocksDoc}
            html={processedHtml}
            lang={lang}
            postId={isPost ? it.id : undefined}
            currentPostCtx={currentPostCtx}
            stream
          />
          <FootnotesList notes={notes} lang={lang} />
        </>
      )}
    </div>
  );

  const adPageType: AdPageType = isPost ? "post" : "page";

  // Posts: render via PostLayoutRenderer with merged global+override settings.
  if (isPost && post && globalLayoutSettings) {
    const overrides = post.layout_overrides ?? null;
    const format: PostFormat = (overrides?.format ?? post.post_format ?? "standard") as PostFormat;
    const layoutId = pickLayoutId(globalLayoutSettings, format, overrides?.layout);
    const merged = mergeOverrides(globalLayoutSettings, overrides);
    return (
      <div className="flex flex-col bg-background text-foreground" data-page-template="post">
        <PostContentStyle />
        <main style={outerMaxStyle} className="flex-1 w-full mx-auto px-4 lg:px-8 py-10">
          <Breadcrumbs items={crumbs} />
          <AdZone
            position="top_of_post"
            pageType={adPageType}
            pageId={it.id}
            className="mb-6"
            content={adContent}
          />
          <PostLayoutRenderer
            format={format}
            layoutId={layoutId}
            settings={merged}
            title={title}
            excerpt={excerpt}
            coverImageUrl={it.cover_image_url}
            coverViewTransitionId={it.id}
            meta={
              <PostOverlayMeta
                lang={lang}
                author={postAuthor}
                publishedAt={it.published_at}
                readMinutes={post.read_minutes}
                customMeta={
                  <CustomMetaList defs={customMetaDefs} values={post.custom_meta} lang={lang} />
                }
              />
            }
            categoryBadges={
              postCategories.length > 0 ? (
                <CategoryBadges items={postCategories} lang={lang} />
              ) : null
            }
            content={
              <>
                {merged.quick_view_info && (
                  <QuickViewInfoBar
                    lang={lang}
                    readMinutes={post.read_minutes}
                    publishedAt={it.published_at}
                    updatedAt={it.updated_at}
                    primaryCategory={postCategories[0]}
                  />
                )}
                {contentBlock}
                {relatedCfg.enabled && relatedCfg.position === "after_paragraph" && (
                  <RelatedPostsAfterParagraph
                    containerRef={articleRef}
                    afterParagraph={relatedCfg.after_paragraph}
                    scanKey={`${it.id}-${lang}`}
                    postId={post.id}
                    lang={lang}
                    override={relatedOverride}
                  />
                )}
                <MidPostAds
                  articleRef={articleRef}
                  pageType={adPageType}
                  pageId={it.id}
                  scanKey={`${it.id}-${lang}`}
                  content={adContent}
                />
              </>
            }
            sidebar={
              <>
                {post ? (
                  <PostSidebarRenderer
                    postId={post.id}
                    postTitle={title}
                    lang={lang}
                    tags={postTags}
                    adContent={adContent}
                    layoutId={
                      (post as unknown as { sidebar_layout_id?: string | null })
                        .sidebar_layout_id ?? null
                    }
                    listen={
                      format !== "audio" && format !== "video"
                        ? {
                            postId: post.id,
                            title,
                            author:
                              postAuthor?.display_name ||
                              [postAuthor?.first_name, postAuthor?.last_name]
                                .filter(Boolean)
                                .join(" ") ||
                              null,
                            authorHref: postAuthor?.slug ? `/author/${postAuthor.slug}` : null,
                            readMinutes: post.read_minutes ?? null,
                          }
                        : null
                    }
                  />
                ) : (
                  <FloatingShareBar title={title} lang={lang} variant="sidebar" />
                )}
              </>
            }
            footer={
              <>
                <PostFooterBars
                  settings={merged}
                  lang={lang}
                  tags={postTags}
                  prev={prevPost}
                  next={nextPost}
                  author={
                    postAuthor
                      ? {
                          display_name:
                            postAuthor.display_name ||
                            [postAuthor.first_name, postAuthor.last_name]
                              .filter(Boolean)
                              .join(" ") ||
                            null,
                          avatar_url:
                            postAuthor.author_profile?.avatar_url ?? postAuthor.avatar_url ?? null,
                          bio:
                            (lang === "en"
                              ? postAuthor.author_profile?.bio_en
                              : postAuthor.author_profile?.bio_pl) ?? null,
                        }
                      : null
                  }
                />
                {relatedCfg.enabled && relatedCfg.position === "end" && (
                  <RelatedPosts postId={post.id} lang={lang} override={relatedOverride} />
                )}
                <AdZone
                  position="bottom_of_post"
                  pageType={adPageType}
                  pageId={it.id}
                  className="my-6"
                  content={adContent}
                />
                {merged.show_bottom_newsletter && (
                  <NewsletterForm lang={lang} source={`post:${post.slug}`} />
                )}
                <CommentsSection postId={post.id} lang={lang} />
              </>
            }
          />
          <FootnoteTooltips notes={notes} containerRef={articleRef} />
          {merged.auto_load_next_post && (
            <AutoLoadNextPost
              currentPostId={post.id}
              parentPageId={data.parentPageId}
              currentPublishedAt={post.published_at}
              lang={lang}
            />
          )}
        </main>

        <FooterSlideup pageType={adPageType} pageId={it.id} />
      </div>
    );
  }

  // Pages authored in the CMS builder are self-contained (hero, sections,
  // own headings, own container widths). Render them bare and full width so
  // the published page matches the builder canvas 1:1 - no auto-injected
  // max-w wrapper, breadcrumbs, ads, or duplicate H1 above the document.
  const page = it as PageData;
  if (it.editor === "builder") {
    return (
      <div
        className="flex flex-col bg-background text-foreground"
        data-page-template="builder"
        data-page-header-override={page.header_override ?? "default"}
      >
        <h1 className="sr-only">{title}</h1>
        <main className="flex-1 w-full">{contentBlock}</main>
        <FooterSlideup pageType={adPageType} pageId={it.id} />
      </div>
    );
  }

  // Pages: pick template (default/full_width/landing/archive_listing/contact).
  const tpl = findPageTemplate(page.template_type ?? "default");
  const pageFullWidth = tpl.fullWidth;
  const parentPath = data.crumbs
    .slice(0, -1)
    .map((c) => c.slug)
    .concat(page.slug)
    .join("/");

  const pageBody = (
    <>
      {tpl.id !== "landing" && <Breadcrumbs items={crumbs} />}
      <AdZone
        position="top_of_post"
        pageType={adPageType}
        pageId={it.id}
        className="mb-6"
        content={adContent}
      />
      <h1 className="font-display text-4xl lg:text-5xl mb-4">{title}</h1>
      {contentBlock}
      {tpl.id === "archive_listing" && (
        <ArchiveListing parentPageId={it.id} lang={lang} parentPath={parentPath} />
      )}
      {tpl.id === "contact" && <ContactForm lang={lang} />}
      <AdZone
        position="bottom_of_post"
        pageType={adPageType}
        pageId={it.id}
        className="my-6"
        content={adContent}
      />
      <FootnoteTooltips notes={notes} containerRef={articleRef} />
    </>
  );

  if (tpl.bare) {
    return (
      <div className="flex flex-col bg-background text-foreground" data-page-template={tpl.id}>
        <main className="flex-1 w-full">{pageBody}</main>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col bg-background text-foreground"
      data-page-template={tpl.id}
      data-page-header-override={page.header_override ?? "default"}
    >
      <main
        style={pageFullWidth ? undefined : outerMaxStyle}
        className={`flex-1 ${pageFullWidth ? "max-w-none" : ""} w-full mx-auto px-4 lg:px-8 py-10`}
      >
        {pageBody}
      </main>
      <FooterSlideup pageType={adPageType} pageId={it.id} />
    </div>
  );
}

function PublicNotFound() {
  const copy = errorCopy();
  return (
    <main className="flex-1 flex items-center justify-center px-4 py-20">
      <div className="text-center">
        <h1 className="font-display text-3xl">404 &middot; {copy.notFoundTitle}</h1>
        <p className="text-sm text-muted-foreground mt-2">{copy.notFoundBody}</p>
        <Link
          to="/"
          className="inline-block mt-6 bg-brand text-brand-foreground px-4 py-2 rounded text-sm"
        >
          {copy.goHome}
        </Link>
      </div>
    </main>
  );
}
