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
import { BlocksRenderer } from "@/components/blocks/BlocksRenderer";
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { sanitizeMarkdownHtml } from "@/lib/sanitize";
import { processManualToc } from "@/lib/manualToc";
import { processDocFootnotes, processHtmlFootnotes } from "@/lib/footnotes";
import { FloatingShareBar } from "@/components/share/FloatingShareBar";
import { AutoLoadNextPost } from "@/components/post/AutoLoadNextPost";
import { CustomMetaList } from "@/components/post/CustomMetaList";
import { ContactForm } from "@/components/pages/ContactForm";
import { ArchiveListing } from "@/components/pages/ArchiveListing";
import { findPageTemplate } from "@/lib/pageTemplates";
import { useQuery } from "@tanstack/react-query";
import { listCustomMetaDefs } from "@/lib/customMeta";
import { FootnotesList, FootnoteTooltips } from "@/components/Footnotes";
import { buildBreadcrumbs, type BreadcrumbItem } from "@/lib/breadcrumbs";
import { useContentAccess } from "@/hooks/useContentAccess";
import { Paywall } from "@/components/Paywall";
import { PostLayoutRenderer } from "@/components/PostLayoutRenderer";
import { PostFooterBars } from "@/components/PostFooterBars";
import { PostContentStyle } from "@/components/PostContentStyle";
import { NewsletterForm } from "@/components/NewsletterForm";
import { KeyTakeaways, PostSidebar } from "@/components/molecules";
import { usePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import { mergeOverrides, pickLayoutId, type LayoutOverrides, type PostFormat } from "@/lib/postLayouts";
import { resolvedContentQueryOptions, type PostData } from "@/lib/queries/public";
import { AdZone } from "@/components/AdSlot";
import { MidPostAds } from "@/components/ads/MidPostAds";
import { FooterSlideup } from "@/components/ads/FooterSlideup";
import type { AdPageType } from "@/lib/ads/types";


function splatToSegments(splat: string): string[] {
  return splat.split("/").filter(Boolean);
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
    const title = it.title_pl || it.title_en || "Strona";
    const desc = ("excerpt_pl" in it ? (it.excerpt_pl || it.excerpt_en) : null)
      || (it.content_pl || it.content_en || "").replace(/<[^>]+>/g, "").slice(0, 155);
    const splat = (params as { _splat?: string })._splat ?? "";
    const path = `/${splat}`;
    const meta: Array<Record<string, string>> = [
      { title },
      { name: "description", content: desc },
      { property: "og:title", content: title },
      { property: "og:description", content: desc },
      { property: "og:type", content: "article" },
      { property: "og:url", content: path },
    ];
    if (it.cover_image_url) {
      meta.push({ property: "og:image", content: it.cover_image_url });
      meta.push({ name: "twitter:image", content: it.cover_image_url });
    }
    return {
      meta,
      links: [{ rel: "canonical", href: path }],
    };
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

  const access = useContentAccess(isPost ? "post" : "page", it.id);
  const { data: globalLayoutSettings } = usePostLayoutSettings();

  const rawDoc = parseBuilderDoc(it.builder_data);
  const isBuilder = it.editor === "builder" && rawDoc.sections.length > 0;
  const rawHtml = lang === "en" ? it.content_en || it.content_pl : it.content_pl || it.content_en;

  // Block editor (Gutenberg/Foxiz-style) — wpisy w nowym formacie
  const blocksData = (it as { blocks_data?: LocalizedBlocks | null }).blocks_data ?? null;
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

  const [crumbs, setCrumbs] = useState<BreadcrumbItem[]>([]);
  useEffect(() => {
    setCrumbs(buildBreadcrumbs(data.crumbs, lang, isPost ? title : undefined));
  }, [data, lang, title, isPost]);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": isPost ? "Article" : "WebPage",
    headline: title, name: title,
    description: excerpt ?? "",
    image: it.cover_image_url ?? undefined,
    datePublished: it.published_at ?? undefined,
  };

  const maxW = isPost ? "max-w-[1200px]" : "max-w-[1200px]";

  const takeaways: readonly string[] = post
    ? (lang === "en" ? post.takeaways_en : post.takeaways_pl) ?? []
    : [];

  const contentBlock = (
    <div ref={articleRef}>
      {access.rule && !access.hasAccess ? (
        <Paywall rule={access.rule} lang={lang} fallbackText={rawHtml} />
      ) : (
        <>
          {isPost && takeaways.length > 0 && <KeyTakeaways items={takeaways} />}
          {isBlocks ? (
            <BlocksRenderer doc={blocksDoc} lang={lang} postId={isPost ? it.id : undefined} />
          ) : isBuilder ? (
            <BuilderRenderer doc={doc} lang={lang} />
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
    <div className="min-h-screen flex flex-col bg-background text-foreground" data-template={tpl.id}>
      <Header transparent={page.header_override === "transparent"} hidden={page.header_override === "hidden"} />
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
