// Author profile + posts archive: /author/$slug
// Slug param may also be the user UUID for back-compat.
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ExternalLink, Globe, Linkedin, Twitter } from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ArchivePostList } from "@/components/archive/ArchivePostList";
import { authorBySlugQueryOptions } from "@/lib/queries/archives";

export const Route = createFileRoute("/author/$slug")({
  loader: async ({ params, context }) => {
    const data = await context.queryClient.ensureQueryData(authorBySlugQueryOptions(params.slug));
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    const name = loaderData?.author.display_name ?? "Autor";
    return {
      meta: [
        { title: `${name} - autor` },
        { name: "description", content: loaderData?.author.bio_pl?.slice(0, 155) ?? `Wpisy autora ${name}.` },
        { property: "og:title", content: name },
        { property: "og:type", content: "profile" },
      ],
    };
  },
  component: AuthorArchivePage,
  notFoundComponent: AuthorNotFound,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 max-w-3xl mx-auto px-4 py-20 text-center">
          <h1 className="font-display text-2xl">Nie udało się załadować profilu</h1>
          <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
          <button onClick={() => { router.invalidate(); reset(); }} className="mt-6 bg-brand text-brand-foreground px-4 py-2 rounded text-sm">Spróbuj ponownie</button>
        </main>
        <Footer />
      </div>
    );
  },
});

function AuthorArchivePage() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(authorBySlugQueryOptions(slug));
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  if (!data) return <AuthorNotFound />;
  const { author, posts } = data;
  const name = author.display_name ?? "Autor";
  const bio = lang === "en" ? author.bio_en ?? author.bio_pl : author.bio_pl ?? author.bio_en;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header />
      <main className="flex-1 w-full">
        <header className="relative">
          {author.cover_url && (
            <div className="h-40 sm:h-56 w-full overflow-hidden bg-muted">
              <img src={author.cover_url} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="max-w-[1200px] mx-auto px-4 lg:px-8 py-8">
            <div className="flex flex-col sm:flex-row gap-5 items-start">
              {author.avatar_url && (
                <img
                  src={author.avatar_url}
                  alt={name}
                  className="w-24 h-24 rounded-full object-cover border-4 border-background -mt-16 shadow"
                />
              )}
              <div className="flex-1 space-y-2">
                <h1 className="font-display text-3xl lg:text-4xl">{name}</h1>
                {bio && <p className="text-muted-foreground max-w-2xl">{bio}</p>}
                <div className="flex flex-wrap gap-3 pt-1 text-sm">
                  {author.website_url && (
                    <a href={author.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-brand">
                      <Globe className="w-4 h-4" />WWW
                    </a>
                  )}
                  {author.twitter_url && (
                    <a href={author.twitter_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-brand">
                      <Twitter className="w-4 h-4" />Twitter
                    </a>
                  )}
                  {author.linkedin_url && (
                    <a href={author.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-brand">
                      <Linkedin className="w-4 h-4" />LinkedIn
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </header>
        <section className="max-w-[1200px] mx-auto px-4 lg:px-8 pb-12">
          <h2 className="font-display text-2xl mb-5">Wpisy autora</h2>
          <ArchivePostList posts={posts} lang={lang} emptyText="Brak opublikowanych wpisów." />
        </section>
      </main>
      <Footer />
    </div>
  );
}

function AuthorNotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <h1 className="font-display text-3xl">Autor nie znaleziony</h1>
          <a href="/blog" className="inline-flex items-center gap-1 text-brand hover:underline text-sm">
            <ExternalLink className="w-3 h-3" />Wróć na blog
          </a>
        </div>
      </main>
      <Footer />
    </div>
  );
}
