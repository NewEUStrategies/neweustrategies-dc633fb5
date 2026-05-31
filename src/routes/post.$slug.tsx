// Public post renderer. URL: /post/<slug>
import { createFileRoute, notFound, Link, useRouter } from "@tanstack/react-router";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { sanitizeMarkdownHtml } from "@/lib/sanitize";
import { processDocFootnotes, processHtmlFootnotes } from "@/lib/footnotes";
import { FootnotesList, FootnoteTooltips } from "@/components/Footnotes";

export const Route = createFileRoute("/post/$slug")({
  loader: async ({ params }) => {
    const { data, error } = await supabase
      .from("posts")
      .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, content_pl, content_en, editor, builder_data, cover_image_url, published_at, read_minutes")
      .eq("slug", params.slug)
      .eq("status", "published")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    return { post: data };
  },
  head: ({ loaderData }) => {
    const p = loaderData?.post;
    if (!p) return { meta: [] };
    const title = p.title_pl || p.title_en || "Wpis";
    const desc = (p.excerpt_pl || p.excerpt_en || (p.content_pl || p.content_en || "").replace(/<[^>]+>/g, "")).slice(0, 155);
    const meta = [
      { title },
      { name: "description", content: desc },
      { property: "og:title", content: title },
      { property: "og:description", content: desc },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ];
    if (p.cover_image_url) {
      meta.push({ property: "og:image", content: p.cover_image_url });
      meta.push({ name: "twitter:image", content: p.cover_image_url });
    }
    if (p.published_at) {
      meta.push({ property: "article:published_time", content: p.published_at });
    }
    return { meta };
  },
  component: PostPublic,
  notFoundComponent: PostNotFound,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 max-w-3xl mx-auto px-4 py-20 text-center">
          <h1 className="font-display text-2xl">Nie udało się załadować wpisu</h1>
          <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
          <button onClick={() => { router.invalidate(); reset(); }} className="mt-6 bg-brand text-brand-foreground px-4 py-2 rounded text-sm">Spróbuj ponownie</button>
        </main>
        <Footer />
      </div>
    );
  },
});

function PostPublic() {
  const { post } = Route.useLoaderData();
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const title = lang === "en" ? post.title_en || post.title_pl : post.title_pl || post.title_en;
  const excerpt = lang === "en" ? post.excerpt_en : post.excerpt_pl;
  const rawDoc = parseBuilderDoc(post.builder_data);
  const isBuilder = post.editor === "builder" && rawDoc.sections.length > 0;
  const rawHtml = lang === "en" ? post.content_en || post.content_pl : post.content_pl || post.content_en;

  const { doc, notes: builderNotes } = processDocFootnotes(rawDoc, lang);
  const { html: processedHtml, notes: htmlNotes } = processHtmlFootnotes(rawHtml ?? "", 1);
  const notes = isBuilder ? builderNotes : htmlNotes;
  const articleRef = useRef<HTMLDivElement>(null);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description: excerpt ?? "",
    image: post.cover_image_url ?? undefined,
    datePublished: post.published_at ?? undefined,
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header />
      <main className="flex-1 max-w-[1000px] w-full mx-auto px-4 lg:px-8 py-10">
        <Link to="/blog" className="text-sm text-muted-foreground hover:text-brand">← Blog</Link>
        <h1 className="font-display text-4xl lg:text-5xl mt-4 mb-4">{title}</h1>
        {excerpt && <p className="text-lg text-muted-foreground mb-6">{excerpt}</p>}
        {post.cover_image_url && (
          <img src={post.cover_image_url} alt={title} className="w-full rounded-lg mb-8 max-h-[480px] object-cover" loading="eager" />
        )}
        <div ref={articleRef}>
          {isBuilder ? (
            <BuilderRenderer doc={doc} lang={lang} />
          ) : (
            <article className="prose prose-lg dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeMarkdownHtml(processedHtml) }} />
          )}
          <FootnotesList notes={notes} />
        </div>
        <FootnoteTooltips notes={notes} containerRef={articleRef} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </main>
      <Footer />
    </div>
  );
}

function PostNotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="font-display text-3xl">404 - wpis nie znaleziony</h1>
          <Link to="/blog" className="inline-block mt-6 bg-brand text-brand-foreground px-4 py-2 rounded text-sm">Wróć do bloga</Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
