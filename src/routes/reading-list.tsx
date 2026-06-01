import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/hooks/useAuth";
import { useBookmarks } from "@/hooks/useBookmarks";
import { useFollows } from "@/hooks/useFollows";
import { usePersonalizedSettings } from "@/hooks/usePersonalizedSettings";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRecommendedPosts, type RecommendedPost } from "@/lib/recommendations.functions";
import { openLoginPopup } from "@/lib/loginPopupBus";
import { Button } from "@/components/ui/button";

type Tab = "saved" | "followed" | "recommended";

interface PostRow {
  id: string; slug: string;
  title_pl: string; title_en: string;
  excerpt_pl: string | null; excerpt_en: string | null;
  cover_image_url: string | null; published_at: string | null;
  parent_page_id: string;
}

export const Route = createFileRoute("/reading-list")({
  component: ReadingListPage,
  head: () => ({ meta: [{ title: "Twoja lista do przeczytania" }, { name: "robots", content: "noindex" }] }),
});

function ReadingListPage() {
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const settings = usePersonalizedSettings();
  const [tab, setTab] = useState<Tab>("saved");

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 max-w-2xl mx-auto px-4 py-20 text-center">
          <h1 className="font-display text-3xl mb-3">{settings.restrictedTitle}</h1>
          <p className="text-muted-foreground mb-6">{settings.restrictedDescription}</p>
          <Button onClick={() => openLoginPopup({ title: settings.restrictedTitle, description: settings.restrictedDescription })}>
            Zaloguj się
          </Button>
        </main>
        <Footer />
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string; enabled: boolean }> = [
    { id: "saved", label: settings.sections.saved.heading, enabled: settings.sections.saved.enabled },
    { id: "followed", label: settings.sections.followed.heading, enabled: settings.sections.followed.enabled },
    { id: "recommended", label: settings.sections.recommended.heading, enabled: settings.sections.recommended.enabled },
  ].filter((t) => t.enabled);

  const currentSection = settings.sections[tab];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 max-w-6xl mx-auto px-4 lg:px-8 py-10 w-full">
        <header className="text-center mb-8">
          <h1 className="font-display text-4xl mb-2">{currentSection.heading}</h1>
          <p className="text-muted-foreground">{currentSection.description}</p>
        </header>

        <div className="flex justify-center gap-1 mb-8 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${
                tab === t.id ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "saved" && <SavedSection columns={settings.sections.saved.columns} lang={lang} />}
        {tab === "followed" && <FollowedSection lang={lang} />}
        {tab === "recommended" && (
          <RecommendedSection columns={settings.sections.recommended.columns} limit={settings.sections.recommended.postsPerPage ?? 9} lang={lang} />
        )}
      </main>
      <Footer />
    </div>
  );
}

function gridClass(cols: number) {
  return cols === 2 ? "grid-cols-1 md:grid-cols-2"
    : cols === 4 ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
    : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
}

function SavedSection({ columns, lang }: { columns: number; lang: "pl" | "en" }) {
  const { data: bookmarks } = useBookmarks();
  const postIds = (bookmarks ?? []).filter((b) => b.entity_type === "post").map((b) => b.entity_id);
  const { data: posts } = useQuery({
    queryKey: ["saved-posts", postIds.join(",")],
    enabled: postIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id")
        .in("id", postIds)
        .eq("status", "published")
        .is("deleted_at", null);
      if (error) throw error;
      return data as PostRow[];
    },
  });
  if (postIds.length === 0) return <EmptyState text="Nie masz jeszcze żadnych zapisanych artykułów." />;
  if (!posts) return <p className="text-center text-muted-foreground">Ładowanie…</p>;
  return (
    <div className={`grid gap-6 ${gridClass(columns)}`}>
      {posts.map((p) => <PostCard key={p.id} post={p} lang={lang} />)}
    </div>
  );
}

function FollowedSection({ lang }: { lang: "pl" | "en" }) {
  const { data: follows } = useFollows();
  const catIds = (follows ?? []).filter((f) => f.target_type === "category").map((f) => f.target_id);
  const tagIds = (follows ?? []).filter((f) => f.target_type === "tag").map((f) => f.target_id);
  const authorIds = (follows ?? []).filter((f) => f.target_type === "author").map((f) => f.target_id);

  const { data } = useQuery({
    queryKey: ["followed-entities", catIds.join(","), tagIds.join(","), authorIds.join(",")],
    queryFn: async () => {
      const [cats, tags, authors] = await Promise.all([
        catIds.length ? supabase.from("categories").select("id, name_pl, name_en, slug").in("id", catIds) : Promise.resolve({ data: [] as Array<{ id: string; name_pl: string; name_en: string; slug: string }> }),
        tagIds.length ? supabase.from("tags").select("id, name, slug").in("id", tagIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string; slug: string }> }),
        authorIds.length ? supabase.from("profiles").select("id, display_name, avatar_url").in("id", authorIds) : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; avatar_url: string | null }> }),
      ]);
      return { cats: cats.data ?? [], tags: tags.data ?? [], authors: authors.data ?? [] };
    },
  });

  if (!follows || follows.length === 0) return <EmptyState text="Nie obserwujesz jeszcze żadnych kategorii ani autorów." />;
  if (!data) return <p className="text-center text-muted-foreground">Ładowanie…</p>;

  return (
    <div className="space-y-8">
      {data.cats.length > 0 && (
        <section>
          <h2 className="font-display text-xl mb-3">Kategorie</h2>
          <div className="flex flex-wrap gap-2">
            {data.cats.map((c) => (
              <span key={c.id} className="px-3 py-1.5 bg-muted rounded-full text-sm">{lang === "pl" ? c.name_pl : c.name_en}</span>
            ))}
          </div>
        </section>
      )}
      {data.tags.length > 0 && (
        <section>
          <h2 className="font-display text-xl mb-3">Tagi</h2>
          <div className="flex flex-wrap gap-2">
            {data.tags.map((t) => <span key={t.id} className="px-3 py-1.5 bg-muted rounded-full text-sm">#{t.name}</span>)}
          </div>
        </section>
      )}
      {data.authors.length > 0 && (
        <section>
          <h2 className="font-display text-xl mb-3">Autorzy</h2>
          <div className="flex flex-wrap gap-3">
            {data.authors.map((a) => (
              <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-full text-sm">
                {a.avatar_url && <img src={a.avatar_url} alt="" className="w-6 h-6 rounded-full" />}
                <span>{a.display_name ?? "Anonim"}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RecommendedSection({ columns, limit, lang }: { columns: number; limit: number; lang: "pl" | "en" }) {
  const fetchFn = useServerFn(getRecommendedPosts);
  const [posts, setPosts] = useState<RecommendedPost[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetchFn({ data: { limit } }).then(setPosts).catch((e) => setErr(e instanceof Error ? e.message : "Error"));
  }, [fetchFn, limit]);
  if (err) return <p className="text-center text-destructive">{err}</p>;
  if (!posts) return <p className="text-center text-muted-foreground">Ładowanie rekomendacji…</p>;
  if (posts.length === 0) return <EmptyState text="Brak rekomendacji. Zaobserwuj kategorie lub przeczytaj kilka wpisów, abyśmy mogli dopasować propozycje." />;
  return (
    <div className={`grid gap-6 ${gridClass(columns)}`}>
      {posts.map((p) => <PostCard key={p.id} post={p} lang={lang} />)}
    </div>
  );
}

function PostCard({ post, lang }: { post: PostRow | RecommendedPost; lang: "pl" | "en" }) {
  const title = lang === "en" ? post.title_en || post.title_pl : post.title_pl || post.title_en;
  const excerpt = lang === "en" ? post.excerpt_en : post.excerpt_pl;
  return (
    <article className="group">
      <Link to="/post/$slug" params={{ slug: post.slug }} className="block">
        {post.cover_image_url && (
          <div className="aspect-[16/10] overflow-hidden rounded-lg mb-3 bg-muted">
            <img src={post.cover_image_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition" />
          </div>
        )}
        <h3 className="font-display text-lg leading-tight group-hover:text-brand transition mb-1">{title}</h3>
        {excerpt && <p className="text-sm text-muted-foreground line-clamp-2">{excerpt}</p>}
      </Link>
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-20 text-muted-foreground">
      <p>{text}</p>
      <Link to="/blog" className="inline-block mt-4 text-brand hover:underline">Przeglądaj artykuły →</Link>
    </div>
  );
}
