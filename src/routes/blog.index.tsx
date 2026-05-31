// Public blog list. URL: /blog
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/blog/")({
  loader: async () => {
    const { data, error } = await supabase
      .from("posts")
      .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at")
      .eq("status", "published")
      .is("deleted_at", null)
      .order("published_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return { posts: data ?? [] };
  },
  head: () => ({
    meta: [
      { title: "Blog - New European Strategies" },
      { name: "description", content: "Analizy, wywiady i raporty - blog NES." },
      { property: "og:title", content: "Blog" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: BlogIndex,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 max-w-3xl mx-auto px-4 py-20 text-center">
          <h1 className="font-display text-2xl">Nie udało się załadować listy</h1>
          <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
          <button onClick={() => { router.invalidate(); reset(); }} className="mt-6 bg-brand text-brand-foreground px-4 py-2 rounded text-sm">Spróbuj ponownie</button>
        </main>
        <Footer />
      </div>
    );
  },
});

function BlogIndex() {
  const { posts } = Route.useLoaderData();
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header />
      <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
        <h1 className="font-display text-4xl lg:text-5xl mb-8">Blog</h1>
        {posts.length === 0 ? (
          <p className="text-muted-foreground">Brak opublikowanych wpisów.</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((p) => {
              const title = lang === "en" ? p.title_en || p.title_pl : p.title_pl || p.title_en;
              const excerpt = lang === "en" ? p.excerpt_en : p.excerpt_pl;
              return (
                <Link key={p.id} to="/blog/$slug" params={{ slug: p.slug }} className="bg-card border border-border rounded-lg overflow-hidden hover:border-brand transition">
                  {p.cover_image_url && <img src={p.cover_image_url} alt="" className="w-full h-44 object-cover" loading="lazy" />}
                  <div className="p-5">
                    <h2 className="font-display text-xl mb-2 line-clamp-2">{title}</h2>
                    {excerpt && <p className="text-sm text-muted-foreground line-clamp-3">{excerpt}</p>}
                    {p.published_at && (
                      <time className="block mt-3 text-xs text-muted-foreground">
                        {new Date(p.published_at).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL")}
                      </time>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
