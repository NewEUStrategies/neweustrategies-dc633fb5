// Public page renderer at root. URL: /<slug>
// Static routes (index, login, blog, post, admin, api, p) match before this dynamic route.
import { createFileRoute, notFound, Link, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { sanitizeMarkdownHtml } from "@/lib/sanitize";

export const Route = createFileRoute("/$slug")({
  loader: async ({ params }) => {
    const { data, error } = await supabase
      .from("pages")
      .select("id, slug, title_pl, title_en, content_pl, content_en, editor, builder_data, cover_image_url, published_at")
      .eq("slug", params.slug)
      .eq("status", "published")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    return { page: data };
  },
  head: ({ loaderData }) => {
    const p = loaderData?.page;
    if (!p) return { meta: [] };
    const title = p.title_pl || p.title_en || "Strona";
    const desc = (p.content_pl || p.content_en || "").replace(/<[^>]+>/g, "").slice(0, 155);
    const meta = [
      { title },
      { name: "description", content: desc },
      { property: "og:title", content: title },
      { property: "og:description", content: desc },
      { property: "og:type", content: "article" },
    ];
    if (p.cover_image_url) {
      meta.push({ property: "og:image", content: p.cover_image_url });
      meta.push({ name: "twitter:image", content: p.cover_image_url });
    }
    return { meta };
  },
  component: PagePublic,
  notFoundComponent: PageNotFound,
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

function PagePublic() {
  const { page } = Route.useLoaderData();
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const title = lang === "en" ? page.title_en || page.title_pl : page.title_pl || page.title_en;
  const doc = parseBuilderDoc(page.builder_data);
  const isBuilder = page.editor === "builder" && doc.sections.length > 0;
  const html = lang === "en" ? page.content_en || page.content_pl : page.content_pl || page.content_en;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    image: page.cover_image_url ?? undefined,
    datePublished: page.published_at ?? undefined,
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header />
      <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
        <h1 className="font-display text-4xl lg:text-5xl mb-8">{title}</h1>
        {isBuilder ? (
          <BuilderRenderer doc={doc} lang={lang} />
        ) : (
          <article className="prose prose-lg dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeMarkdownHtml(html ?? "") }} />
        )}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </main>
      <Footer />
    </div>
  );
}

function PageNotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="font-display text-3xl">404 - strona nie znaleziona</h1>
          <Link to="/" className="inline-block mt-6 bg-brand text-brand-foreground px-4 py-2 rounded text-sm">Strona główna</Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
