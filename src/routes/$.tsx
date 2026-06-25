// Universal public resolver. Handles:
//   /<page-slug>
//   /<parent>/<child>/...
//   /<page-path>/<post-slug>
// Static routes (/, /blog, /login, /post/$slug, /admin/*, /api/*) match first.
import { createFileRoute, notFound, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/builder/currentPostContext";
import { BlocksRenderer } from "@/components/blocks/BlocksRenderer";
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { sanitizeMarkdownHtml } from "@/lib/sanitize";
import { processManualToc } from "@/lib/manualToc";
import { processDocFootnotes, processHtmlFootnotes } from "@/lib/footnotes";
import { FloatingShareBar } from "@/components/share/FloatingShareBar";
import { AutoLoadNextPost } from "@/components/post/AutoLoadNextPost";
import { CustomMetaList } from "@/components/post/CustomMetaList";
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
import { useUnlockedContent } from "@/hooks/useUnlockedContent";
import { isGatedMode, hasRenderableBody, shouldShowPaywall, pickBody, type BodyParts } from "@/lib/access/gating";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, buildArticleJsonLd } from "@/lib/seo/meta";
import { activeLang } from "@/lib/seo/head";
import { Paywall } from "@/components/Paywall";
import { PostLayoutRenderer } from "@/components/PostLayoutRenderer";
import { PostFooterBars } from "@/components/PostFooterBars";
import { PostContentStyle } from "@/components/PostContentStyle";
import { NewsletterForm } from "@/components/NewsletterForm";
import { KeyTakeaways, PostSidebar } from "@/components/molecules";
import { usePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import { mergeOverrides, pickLayoutId, type LayoutOverrides, type PostFormat } from "@/lib/postLayouts";
import { resolvedContentQueryOptions, type PostData, type PageData } from "@/lib/queries/public";
import { AdZone } from "@/components/AdSlot";
import { MidPostAds } from "@/components/ads/MidPostAds";
import { FooterSlideup } from "@/components/ads/FooterSlideup";
import type { AdPageType } from "@/lib/ads/types";


function splatToSegments(splat: string): string[] {
  return splat.split("/").filter(Boolean);
}

function metaDescription(raw: string | null | undefined, fallback: string): string {
  const clean = (raw ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 160) : fallback;
}

export const Route = createFileRoute("/$")({
  loader: async ({ params, context }) => {
    const splat = (params as { _splat?: string })._splat ?? "";
    const segments = splatToSegments(splat);
    if (segments.length === 0) throw notFound();
    const data = await context.queryClient.ensureQueryData(
      resolvedContentQueryOptions(segments),
    );
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData, params }) => {
    const it = loaderData?.item;
    if (!it) return { meta: [] };
    const splat = (params as { _splat?: string })._splat ?? "";
    const url = getRequestUrl() || `/${splat}`;
    const lang = activeLang(url);
    const isPost = loaderData.kind === "post";
    const title = (lang === "en" ? it.title_en || it.title_pl : it.title_pl || it.title_en) || "Strona";
    const excerpt =
      "excerpt_pl" in it ? (lang === "en" ? it.excerpt_en || it.excerpt_pl : it.excerpt_pl || it.excerpt_en) : null;
    const tags = "tags" in loaderData ? (loaderData.tags ?? []).map((t) => t.name) : [];
    return buildContentHead({
      url,
      lang,
      type: isPost ? "article" : "website",
      title,
      description: metaDescription(excerpt, title),
      image: it.cover_image_url,
      publishedAt: it.published_at,
      modifiedAt: it.updated_at,
      tags,
    });
  },

  component: PublicPage,
  notFoundComponent: PublicNotFound,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 max-w-3xl mx-auto px-4 py-20 text-center">
          <h1 className="font-display text-2xl">Nie udało się załadować strony</h1>
          <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
          <button onClick={() => { router.invalidate(); reset(); }} className="mt-6 bg-brand text-brand-foreground px-4 py-2 rounded text-sm">Spróbuj ponownie</button>
        </main>
        <Footer />
      </div>
    );
  },
});

function PublicPage() {
  const params = Route.useParams() as { _splat?: string };
  const segments = splatToSegments(params._splat ?? "");
  const { data } = useSuspenseQuery(resolvedContentQueryOptions(segments));
  if (!data) return <PublicNotFound />;

  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const it = data.item;
  const title = lang === "en" ? it.title_en || it.title_pl : it.title_pl || it.title_en;
  const isPost = data.kind === "post";
  const post = isPost ? (it as PostData) : null;
  const excerpt = post ? (lang === "en" ? post.excerpt_en : post.excerpt_pl) : null;
  const postTags = isPost ? (data as { tags?: Array<{ slug: string; name: string }> }).tags : undefined;

  // Access rule (mode/teaser/plans/price) is non-sensitive and arrives from the
  // resolver, so the paywall teaser renders correctly even in anonymous SSR.
  const accessRule = data.access;
  const { data: globalLayoutSettings } = usePostLayoutSettings();
  useRecordPostView(isPost ? it.id : null);

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
  const unlocked = useUnlockedContent(isPost ? "post" : "page", it.id, needsUnlock);
  const body = pickBody(ssrBody, unlocked);

  const rawDoc = parseBuilderDoc(body.builder_data);
  const isBuilder = it.editor === "builder" && rawDoc.sections.length > 0;
  const rawHtml = lang === "en" ? body.content_en || body.content_pl : body.content_pl || body.content_en;

  // Block editor (Gutenberg/Foxiz-style) - wpisy w nowym formacie
  const blocksData = (body.blocks_data as LocalizedBlocks | null) ?? null;
  const blocksDoc: BlocksDoc | null = blocksData ? (blocksData[lang] ?? blocksData.pl ?? blocksData.en ?? null) : null;
  const isBlocks = it.editor === "blocks" && !!blocksDoc?.blocks?.length;

  const { doc, notes: builderNotes } = processDocFootnotes(rawDoc, lang);
  const { html: footnoteHtml, notes: htmlNotes } = processHtmlFootnotes(rawHtml ?? "", 1);
  // Manual <!--TOC--> marker -> inline auto-generated table of contents;
  // also assigns stable IDs to h2/h3 so deep links work.
  const { html: processedHtml } = processManualToc(footnoteHtml, lang);
  const notes = isBuilder ? builderNotes : htmlNotes;
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

  const [crumbs, setCrumbs] = useState<BreadcrumbItem[]>([]);
  useEffect(() => {
    setCrumbs(buildBreadcrumbs(data.crumbs, lang, isPost ? title : undefined));
  }, [data, lang, title, isPost]);

  const jsonLd = buildArticleJsonLd({
    url: getRequestUrl(),
    lang,
    isArticle: isPost,
    title,
    description: metaDescription(excerpt, title),
    image: it.cover_image_url,
    publishedAt: it.published_at,
    modifiedAt: it.updated_at,
    gated: isGatedMode(accessRule?.mode),
  });

  const maxW = "max-w-[1200px]";
  const showPaywall = shouldShowPaywall(accessRule?.mode, body);

  const takeaways: readonly string[] = post
    ? (lang === "en" ? post.takeaways_en : post.takeaways_pl) ?? []
    : [];

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
    readingTimeMin: post?.read_minutes ?? undefined,
    author: null,
    tags: postTags ?? [],
    categories: (data as { categories?: Array<{ slug: string; name: string }> }).categories ?? [],
    breadcrumbs: crumbs.map((b) => ({ label: b.label, href: b.href ?? undefined })),
  };

  const contentBlock = (
    <div ref={articleRef} className="article-body">
      {accessRule && showPaywall ? (
        <Paywall rule={accessRule} lang={lang} fallbackText={excerpt} />
      ) : (
        <>
          {isPost && takeaways.length > 0 && <KeyTakeaways items={takeaways} />}
          {isBlocks ? (
            <BlocksRenderer doc={blocksDoc} lang={lang} postId={isPost ? it.id : undefined} />
          ) : isBuilder ? (
            <CurrentPostProvider value={currentPostCtx}>
              <BuilderRenderer doc={doc} lang={lang} />
            </CurrentPostProvider>
          ) : (
            <article className="single-post-content prose prose-lg dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeMarkdownHtml(processedHtml) }} />
          )}
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
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        <PostContentStyle />
        <Header />
        <main className={`flex-1 ${maxW} w-full mx-auto px-4 lg:px-8 py-10`}>
          <Breadcrumbs items={crumbs} />
          <AdZone position="top_of_post" pageType={adPageType} pageId={it.id} className="mb-6" />
          <PostLayoutRenderer
            format={format}
            layoutId={layoutId}
            settings={merged}
            title={title}
            excerpt={excerpt}
            coverImageUrl={it.cover_image_url}
            meta={
              <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                {post.read_minutes ? <span>{post.read_minutes} min</span> : null}
                <CustomMetaList
                  defs={customMetaDefs}
                  values={post.custom_meta}
                  lang={lang}
                />
              </span>
            }
            content={
              <>
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
                />
              </>
            }
            sidebar={
              <>
                <AdZone position="sidebar" pageType={adPageType} pageId={it.id} />
                <PostSidebar
                  articleRef={articleRef}
                  tags={postTags}
                  scanKey={`${it.id}-${lang}`}
                />
                {relatedCfg.enabled && relatedCfg.position === "sidebar" && (
                  <RelatedPosts
                    postId={post.id}
                    lang={lang}
                    override={relatedOverride}
                    forceLayout="list"
                    className="mt-6"
                  />
                )}
              </>
            }
            footer={
              <>
                <PostFooterBars
                  settings={merged}
                  lang={lang}
                  tags={postTags}
                  sources={null}
                  via={null}
                  author={null}
                />
                {relatedCfg.enabled && relatedCfg.position === "end" && (
                  <RelatedPosts postId={post.id} lang={lang} override={relatedOverride} />
                )}
                <AdZone position="bottom_of_post" pageType={adPageType} pageId={it.id} className="my-6" />
                {merged.show_bottom_newsletter && <NewsletterForm lang={lang} source={`post:${post.slug}`} />}
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
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        </main>
        <Footer />
        <FooterSlideup pageType={adPageType} pageId={it.id} />
        {merged.show_floating_share_bar && (
          <FloatingShareBar title={title} lang={lang} />
        )}
      </div>
    );
  }

  // Pages: pick template (default/full_width/landing/archive_listing/contact).
  const page = it as PageData;
  const tpl = findPageTemplate(page.template_type ?? "default");
  const pageMaxW = tpl.fullWidth ? "max-w-none" : "max-w-[1200px]";
  const parentPath = data.crumbs
    .slice(0, -1)
    .map((c) => c.slug)
    .concat(page.slug)
    .join("/");

  const pageBody = (
    <>
      {tpl.id !== "landing" && <Breadcrumbs items={crumbs} />}
      <AdZone position="top_of_post" pageType={adPageType} pageId={it.id} className="mb-6" />
      <h1 className="font-display text-4xl lg:text-5xl mb-4">{title}</h1>
      {contentBlock}
      {tpl.id === "archive_listing" && (
        <ArchiveListing parentPageId={it.id} lang={lang} parentPath={parentPath} />
      )}
      {tpl.id === "contact" && <ContactForm lang={lang} />}
      <AdZone position="bottom_of_post" pageType={adPageType} pageId={it.id} className="my-6" />
      <FootnoteTooltips notes={notes} containerRef={articleRef} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );

  if (tpl.bare) {
    return (
      <div className="min-h-screen flex flex-col bg-background text-foreground" data-template={tpl.id}>
        <main className="flex-1 w-full">{pageBody}</main>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col bg-background text-foreground"
      data-template={tpl.id}
      data-header-override={page.header_override ?? "default"}
    >
      {page.header_override !== "hidden" && <Header />}
      <main className={`flex-1 ${pageMaxW} w-full mx-auto px-4 lg:px-8 py-10`}>
        {pageBody}
      </main>
      <Footer />
      <FooterSlideup pageType={adPageType} pageId={it.id} />
    </div>
  );
}

function PublicNotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="font-display text-3xl">404 - nie znaleziono</h1>
          <Link to="/" className="inline-block mt-6 bg-brand text-brand-foreground px-4 py-2 rounded text-sm">Strona główna</Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
