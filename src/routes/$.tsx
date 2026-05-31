// Universal public resolver. Handles:
//   /<page-slug>
//   /<parent>/<child>/...
//   /<page-path>/<post-slug>
// Static routes (/, /blog, /login, /post/$slug, /admin/*, /api/*) match first.
import { createFileRoute, notFound, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { sanitizeMarkdownHtml } from "@/lib/sanitize";
import { processDocFootnotes, processHtmlFootnotes } from "@/lib/footnotes";
import { FootnotesList, FootnoteTooltips } from "@/components/Footnotes";
import { fetchPageBreadcrumbs, buildBreadcrumbs, type BreadcrumbItem } from "@/lib/breadcrumbs";

interface PageData {
  id: string; slug: string;
  title_pl: string; title_en: string;
  content_pl: string | null; content_en: string | null;
  editor: "richtext" | "markdown" | "builder";
  builder_data: unknown;
  cover_image_url: string | null;
  published_at: string | null;
}
interface PostData extends PageData {
  excerpt_pl: string | null; excerpt_en: string | null;
  read_minutes: number | null;
}

export const Route = createFileRoute("/$")({
  loader: async ({ params }) => {
    const splat = (params as { _splat?: string })._splat ?? "";
    const segments = splat.split("/").filter(Boolean);
    if (segments.length === 0) throw notFound();

    const { data: resolved, error: rErr } = await supabase
      .rpc("resolve_path", { _segments: segments });
    if (rErr) throw rErr;
    const hit = (resolved ?? [])[0] as { page_id: string | null; post_id: string | null } | undefined;
    if (!hit?.page_id) throw notFound();

    if (hit.post_id) {
      const { data, error } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, content_pl, content_en, editor, builder_data, cover_image_url, published_at, read_minutes")
        .eq("id", hit.post_id).maybeSingle();
      if (error) throw error;
      if (!data) throw notFound();
      const crumbs = await fetchPageBreadcrumbs(hit.page_id);
      return { kind: "post" as const, item: data as PostData, crumbs, parentPageId: hit.page_id };
    }

    const { data, error } = await supabase
      .from("pages")
      .select("id, slug, title_pl, title_en, content_pl, content_en, editor, builder_data, cover_image_url, published_at")
      .eq("id", hit.page_id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    const crumbs = await fetchPageBreadcrumbs(hit.page_id);
    return { kind: "page" as const, item: data as PageData, crumbs, parentPageId: hit.page_id };
  },
  head: ({ loaderData }) => {
    const it = loaderData?.item;
    if (!it) return { meta: [] };
    const title = it.title_pl || it.title_en || "Strona";
    const desc = ("excerpt_pl" in it ? (it.excerpt_pl || it.excerpt_en) : null)
      || (it.content_pl || it.content_en || "").replace(/<[^>]+>/g, "").slice(0, 155);
    const meta: Array<Record<string, string>> = [
      { title },
      { name: "description", content: desc },
      { property: "og:title", content: title },
      { property: "og:description", content: desc },
      { property: "og:type", content: "article" },
    ];
    if (it.cover_image_url) {
      meta.push({ property: "og:image", content: it.cover_image_url });
      meta.push({ name: "twitter:image", content: it.cover_image_url });
    }
    return { meta };
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
  const data = Route.useLoaderData();
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const it = data.item;
  const title = lang === "en" ? it.title_en || it.title_pl : it.title_pl || it.title_en;
  const excerpt = data.kind === "post" ? (lang === "en" ? (it as PostData).excerpt_en : (it as PostData).excerpt_pl) : null;

  const rawDoc = parseBuilderDoc(it.builder_data);
  const isBuilder = it.editor === "builder" && rawDoc.sections.length > 0;
  const rawHtml = lang === "en" ? it.content_en || it.content_pl : it.content_pl || it.content_en;

  const { doc, notes: builderNotes } = processDocFootnotes(rawDoc, lang);
  const { html: processedHtml, notes: htmlNotes } = processHtmlFootnotes(rawHtml ?? "", 1);
  const notes = isBuilder ? builderNotes : htmlNotes;
  const articleRef = useRef<HTMLDivElement>(null);

  const [crumbs, setCrumbs] = useState<BreadcrumbItem[]>([]);
  useEffect(() => {
    setCrumbs(buildBreadcrumbs(data.crumbs, lang, data.kind === "post" ? title : undefined));
  }, [data, lang, title]);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": data.kind === "post" ? "Article" : "WebPage",
    headline: title, name: title,
    description: excerpt ?? "",
    image: it.cover_image_url ?? undefined,
    datePublished: it.published_at ?? undefined,
  };

  const maxW = data.kind === "post" ? "max-w-[1000px]" : "max-w-[1200px]";

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header />
      <main className={`flex-1 ${maxW} w-full mx-auto px-4 lg:px-8 py-10`}>
        <Breadcrumbs items={crumbs} />
        <h1 className="font-display text-4xl lg:text-5xl mb-4">{title}</h1>
        {excerpt && <p className="text-lg text-muted-foreground mb-6">{excerpt}</p>}
        {data.kind === "post" && it.cover_image_url && (
          <img src={it.cover_image_url} alt={title} className="w-full rounded-lg mb-8 max-h-[480px] object-cover" loading="eager" />
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
