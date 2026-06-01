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
import { parseBuilderDoc } from "@/lib/builder/parse";
import { sanitizeMarkdownHtml } from "@/lib/sanitize";
import { processDocFootnotes, processHtmlFootnotes } from "@/lib/footnotes";
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

  const { doc, notes: builderNotes } = processDocFootnotes(rawDoc, lang);
  const { html: processedHtml, notes: htmlNotes } = processHtmlFootnotes(rawHtml ?? "", 1);
  const notes = isBuilder ? builderNotes : htmlNotes;
  const articleRef = useRef<HTMLDivElement>(null);

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
          {isBuilder ? (
            <BuilderRenderer doc={doc} lang={lang} />
          ) : (
            <article className="single-post-content prose prose-lg dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeMarkdownHtml(processedHtml) }} />
          )}
          <FootnotesList notes={notes} />
        </>
      )}
    </div>
  );


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
          <PostLayoutRenderer
            format={format}
            layoutId={layoutId}
            settings={merged}
            title={title}
            excerpt={excerpt}
            coverImageUrl={it.cover_image_url}
            meta={post.read_minutes ? <span>{post.read_minutes} min</span> : null}
            content={contentBlock}
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
                {merged.show_bottom_newsletter && <NewsletterForm lang={lang} source={`post:${post.slug}`} />}
              </>
            }
          />
          <FootnoteTooltips notes={notes} containerRef={articleRef} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        </main>
        <Footer />
      </div>
    );
  }

  // Pages: keep original simple layout.
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header />
      <main className={`flex-1 ${maxW} w-full mx-auto px-4 lg:px-8 py-10`}>
        <Breadcrumbs items={crumbs} />
        <h1 className="font-display text-4xl lg:text-5xl mb-4">{title}</h1>
        {contentBlock}
        <FootnoteTooltips notes={notes} containerRef={articleRef} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </main>
      <Footer />
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
