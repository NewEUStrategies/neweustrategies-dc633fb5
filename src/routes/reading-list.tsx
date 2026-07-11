// Lista czytelnicza: zapisane / obserwowane / rekomendacje.
//
// Obserwowane to od teraz PRAWDZIWY feed postów obserwowanych autorów,
// kategorii i tagów (RPC get_followed_feed) z klikalnymi chipami obserwacji
// (unfollow jednym kliknięciem), a nie statyczne chipy. Rekomendacje idą przez
// get_recommended_posts_v2 - działają też dla gościa (zainteresowania z
// localStorage), więc strona nie jest już twardym login-wallem: gość przy
// włączonym allowGuests widzi rekomendacje i lokalnie zapisane artykuły.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Trash2, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useBookmarks } from "@/hooks/useBookmarks";
import { useFollows, useToggleFollow } from "@/hooks/useFollows";
import { useFollowedFeed, type FollowedFeedItem } from "@/hooks/useFollowedFeed";
import { useRecommendedPosts, type RecommendedPost } from "@/hooks/useRecommendedPosts";
import { usePersonalizedSettings } from "@/hooks/usePersonalizedSettings";
import { supabase } from "@/integrations/supabase/client";
import { openLoginPopup } from "@/lib/loginPopupBus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import "@/lib/i18n-reading-list";

type Tab = "saved" | "followed" | "recommended";
type Lang = "pl" | "en";

interface PostRow {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  parent_page_id: string;
}

// Gościnne zapisy z useSaveArticle (localStorage, to samo źródło danych).
const GUEST_SAVED_KEY = "lovable:saved-articles";
interface GuestSavedItem {
  url: string;
  title: string;
  savedAt: number;
}

function readGuestSaved(): GuestSavedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(GUEST_SAVED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? (parsed as GuestSavedItem[]).filter((s) => typeof s?.url === "string")
      : [];
  } catch {
    return [];
  }
}

export const Route = createFileRoute("/reading-list")({
  component: ReadingListPage,
  head: () => ({
    meta: [{ title: "Twoja lista do przeczytania" }, { name: "robots", content: "noindex" }],
  }),
});

function ReadingListPage() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const settings = usePersonalizedSettings();
  const [tab, setTab] = useState<Tab>("saved");

  // Wyłącznik główny personalizacji obowiązuje także tutaj.
  if (!settings.enabled) {
    return (
      <div className="min-h-screen flex flex-col">
        <main className="flex-1 max-w-2xl mx-auto px-4 py-20 text-center">
          <h1 className="font-display text-3xl mb-3">{t("readingList.disabledTitle")}</h1>
          <p className="text-muted-foreground">{t("readingList.disabledBody")}</p>
        </main>
      </div>
    );
  }

  // Gość bez trybu gościnnego: dotychczasowa zachęta do logowania.
  if (!user && !settings.allowGuests) {
    return (
      <div className="min-h-screen flex flex-col">
        <main className="flex-1 max-w-2xl mx-auto px-4 py-20 text-center">
          <h1 className="font-display text-3xl mb-3">{settings.restrictedTitle}</h1>
          <p className="text-muted-foreground mb-6">{settings.restrictedDescription}</p>
          <Button
            onClick={() =>
              openLoginPopup({
                title: settings.restrictedTitle,
                description: settings.restrictedDescription,
              })
            }
          >
            {t("readingList.signIn")}
          </Button>
        </main>
      </div>
    );
  }

  const tabs = (
    [
      {
        id: "saved" as Tab,
        label: settings.sections.saved.heading,
        enabled: settings.sections.saved.enabled,
      },
      {
        id: "followed" as Tab,
        label: settings.sections.followed.heading,
        enabled: settings.sections.followed.enabled,
      },
      {
        id: "recommended" as Tab,
        label: settings.sections.recommended.heading,
        enabled: settings.sections.recommended.enabled,
      },
    ] as const
  ).filter((t) => t.enabled);

  const currentSection = settings.sections[tab];

  return (
    <div className="min-h-screen flex flex-col bg-background">
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
                tab === t.id
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "saved" &&
          (user ? (
            <SavedSection columns={settings.sections.saved.columns} lang={lang} />
          ) : (
            <GuestSavedSection lang={lang} />
          ))}
        {tab === "followed" &&
          (user ? (
            <FollowedSection columns={settings.sections.followed.columns} lang={lang} />
          ) : (
            <GuestLoginNudge
              text={t("readingList.followedGuest")}
              title={settings.restrictedTitle}
              description={settings.restrictedDescription}
            />
          ))}
        {tab === "recommended" && (
          <RecommendedSection
            columns={settings.sections.recommended.columns}
            limit={settings.sections.recommended.postsPerPage ?? 9}
            lang={lang}
          />
        )}
      </main>
    </div>
  );
}

function gridClass(cols: number) {
  return cols === 2
    ? "grid-cols-1 md:grid-cols-2"
    : cols === 4
      ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
      : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
}

function GuestLoginNudge({
  text,
  title,
  description,
}: {
  text: string;
  title: string;
  description: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="text-center py-20 text-muted-foreground">
      <p className="mb-4">{text}</p>
      <Button onClick={() => openLoginPopup({ title, description })}>
        {t("readingList.signIn")}
      </Button>
    </div>
  );
}

function SavedSection({ columns, lang }: { columns: number; lang: Lang }) {
  const { t } = useTranslation();
  const { data: bookmarks, isLoading } = useBookmarks();
  const postIds = (bookmarks ?? []).filter((b) => b.entity_type === "post").map((b) => b.entity_id);
  const { data: posts } = useQuery({
    queryKey: ["saved-posts", postIds.join(",")],
    enabled: postIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .select(
          "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id",
        )
        .in("id", postIds)
        .eq("status", "published")
        .is("deleted_at", null);
      if (error) throw error;
      return data as PostRow[];
    },
  });
  if (isLoading)
    return <p className="text-center text-muted-foreground">{t("readingList.loading")}</p>;
  if (postIds.length === 0) return <EmptyState text={t("readingList.savedEmpty")} />;
  if (!posts)
    return <p className="text-center text-muted-foreground">{t("readingList.loading")}</p>;
  return (
    <div className={`grid gap-6 ${gridClass(columns)}`}>
      {posts.map((p) => (
        <PostCard key={p.id} post={p} lang={lang} />
      ))}
    </div>
  );
}

// Zapisane gościa: lista z localStorage (url+tytuł), z usuwaniem pozycji.
function GuestSavedSection({ lang }: { lang: Lang }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<GuestSavedItem[]>(() => readGuestSaved());

  const removeItem = useCallback((url: string) => {
    setItems((prev) => {
      const next = prev.filter((s) => s.url !== url);
      try {
        window.localStorage.setItem(GUEST_SAVED_KEY, JSON.stringify(next));
      } catch {
        /* private mode - stan i tak zaktualizowany w pamięci */
      }
      return next;
    });
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <p className="rounded-[6px] border border-border/60 bg-muted/30 px-3 py-2 text-center text-xs text-muted-foreground">
        {t("readingList.guestSavedInfo")}
      </p>
      {items.length === 0 ? (
        <EmptyState text={t("readingList.guestSavedEmpty")} />
      ) : (
        <ul className="divide-y divide-border/60 rounded-[6px] border border-border/60">
          {items.map((item) => (
            <li key={item.url} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <a href={item.url} className="block truncate text-sm font-medium hover:underline">
                  {item.title || item.url}
                </a>
                {Number.isFinite(item.savedAt) && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("readingList.savedAt", {
                      date: new Date(item.savedAt).toLocaleDateString(
                        lang === "en" ? "en-US" : "pl-PL",
                      ),
                    })}
                  </p>
                )}
              </div>
              <a
                href={item.url}
                className="text-muted-foreground hover:text-foreground"
                aria-hidden
                tabIndex={-1}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                type="button"
                onClick={() => removeItem(item.url)}
                className="text-muted-foreground transition-colors hover:text-destructive"
                aria-label={t("readingList.guestRemove")}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface FollowChip {
  type: "author" | "category" | "tag";
  id: string;
  label: string;
  href: { to: string; params: Record<string, string> } | null;
  avatarUrl?: string | null;
}

// Chipy obserwacji: klikalne (archiwum/profil) + unfollow jednym kliknięciem.
function FollowChips({ chips }: { chips: FollowChip[] }) {
  const { t } = useTranslation();
  const toggle = useToggleFollow();
  if (chips.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="font-display mb-3 text-sm uppercase tracking-wide text-muted-foreground">
        {t("readingList.yourFollows")}
      </h2>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span
            key={`${chip.type}:${chip.id}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted py-1 pl-3 pr-1.5 text-sm"
          >
            {chip.avatarUrl && <img src={chip.avatarUrl} alt="" className="h-5 w-5 rounded-full" />}
            {chip.href ? (
              <Link to={chip.href.to} params={chip.href.params} className="hover:underline">
                {chip.label}
              </Link>
            ) : (
              <span>{chip.label}</span>
            )}
            <button
              type="button"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate({ targetType: chip.type, targetId: chip.id, on: false })}
              className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-destructive disabled:opacity-50"
              aria-label={t("readingList.unfollow", { name: chip.label })}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        ))}
      </div>
    </section>
  );
}

function FollowedSection({ columns, lang }: { columns: number; lang: Lang }) {
  const { t } = useTranslation();
  const { data: follows } = useFollows();
  const feed = useFollowedFeed();

  const catIds = useMemo(
    () => (follows ?? []).filter((f) => f.target_type === "category").map((f) => f.target_id),
    [follows],
  );
  const tagIds = useMemo(
    () => (follows ?? []).filter((f) => f.target_type === "tag").map((f) => f.target_id),
    [follows],
  );
  const authorIds = useMemo(
    () => (follows ?? []).filter((f) => f.target_type === "author").map((f) => f.target_id),
    [follows],
  );

  const { data: entities } = useQuery({
    queryKey: ["followed-entities", catIds.join(","), tagIds.join(","), authorIds.join(",")],
    enabled: (follows ?? []).length > 0,
    queryFn: async () => {
      const [cats, tags, authors] = await Promise.all([
        catIds.length
          ? supabase.from("categories").select("id, name_pl, name_en, slug").in("id", catIds)
          : Promise.resolve({
              data: [] as Array<{ id: string; name_pl: string; name_en: string; slug: string }>,
            }),
        tagIds.length
          ? supabase.from("tags").select("id, name, slug").in("id", tagIds)
          : Promise.resolve({ data: [] as Array<{ id: string; name: string; slug: string }> }),
        authorIds.length
          ? supabase
              .from("profiles")
              .select("id, display_name, avatar_url, slug")
              .in("id", authorIds)
          : Promise.resolve({
              data: [] as Array<{
                id: string;
                display_name: string | null;
                avatar_url: string | null;
                slug: string | null;
              }>,
            }),
      ]);
      return { cats: cats.data ?? [], tags: tags.data ?? [], authors: authors.data ?? [] };
    },
  });

  const chips = useMemo<FollowChip[]>(() => {
    if (!entities) return [];
    const authorChips: FollowChip[] = entities.authors.map((a) => ({
      type: "author",
      id: a.id,
      label: a.display_name ?? t("readingList.anonymousAuthor"),
      href: a.slug ? { to: "/author/$slug", params: { slug: a.slug } } : null,
      avatarUrl: a.avatar_url,
    }));
    const catChips: FollowChip[] = entities.cats.map((c) => ({
      type: "category",
      id: c.id,
      label: (lang === "pl" ? c.name_pl : c.name_en) || c.name_pl,
      href: { to: "/category/$slug", params: { slug: c.slug } },
    }));
    const tagChips: FollowChip[] = entities.tags.map((tg) => ({
      type: "tag",
      id: tg.id,
      label: `#${tg.name}`,
      href: { to: "/tag/$slug", params: { slug: tg.slug } },
    }));
    return [...authorChips, ...catChips, ...tagChips];
  }, [entities, lang, t]);

  if (!follows || follows.length === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p>{t("readingList.followedEmpty")}</p>
        <Link to="/profile/interests" className="mt-4 inline-block text-brand hover:underline">
          {t("readingList.followedEmptyCta")}
        </Link>
      </div>
    );
  }

  // Dedupe po id: publikacja nowego posta między stronami przesuwa okno
  // offsetu i ten sam rekord może wrócić na kolejnej stronie.
  const items = Array.from(new Map((feed.data?.pages ?? []).flat().map((p) => [p.id, p])).values());

  return (
    <div>
      <FollowChips chips={chips} />

      {feed.isLoading ? (
        <p className="text-center text-muted-foreground">{t("readingList.loading")}</p>
      ) : items.length === 0 ? (
        <EmptyState text={t("readingList.followedFeedEmpty")} />
      ) : (
        <>
          <div className={`grid gap-6 ${gridClass(columns)}`}>
            {items.map((p) => (
              <PostCard key={p.id} post={p} lang={lang} reasons={p.reasons} />
            ))}
          </div>
          {feed.hasNextPage && (
            <div className="mt-8 flex justify-center">
              <Button
                type="button"
                variant="outline"
                disabled={feed.isFetchingNextPage}
                onClick={() => void feed.fetchNextPage()}
              >
                {feed.isFetchingNextPage ? t("readingList.loading") : t("readingList.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RecommendedSection({
  columns,
  limit,
  lang,
}: {
  columns: number;
  limit: number;
  lang: Lang;
}) {
  const { t } = useTranslation();
  const { data: posts, error, refetch } = useRecommendedPosts(limit);
  if (error)
    return (
      <div className="text-center py-10">
        <p className="mb-3 text-destructive">{t("readingList.recommendedError")}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
          {t("readingList.retry")}
        </Button>
      </div>
    );
  if (!posts)
    return (
      <p className="text-center text-muted-foreground">{t("readingList.loadingRecommendations")}</p>
    );
  if (posts.length === 0) return <EmptyState text={t("readingList.recommendedEmpty")} />;
  return (
    <div className={`grid gap-6 ${gridClass(columns)}`}>
      {posts.map((p) => (
        <PostCard key={p.id} post={p} lang={lang} reasons={p.reasons} />
      ))}
    </div>
  );
}

type CardPost = PostRow | RecommendedPost | FollowedFeedItem;

// Kolejność = priorytet wyświetlania (najbardziej osobisty powód wygrywa).
const REASON_PRIORITY = ["author", "category", "tag", "history", "fresh"] as const;

function PostCard({ post, lang, reasons }: { post: CardPost; lang: Lang; reasons?: string[] }) {
  const { t } = useTranslation();
  const title = lang === "en" ? post.title_en || post.title_pl : post.title_pl || post.title_en;
  const excerpt = lang === "en" ? post.excerpt_en : post.excerpt_pl;
  // Badge tylko dla najistotniejszego powodu (autor > kategoria > tag > reszta),
  // żeby karta nie tonęła w metadanych.
  const reason = REASON_PRIORITY.find((r) => (reasons ?? []).includes(r));
  return (
    <article className="group">
      <Link to="/post/$slug" params={{ slug: post.slug }} className="block">
        {post.cover_image_url && (
          <div className="aspect-[16/10] overflow-hidden rounded-lg mb-3 bg-muted">
            <img
              src={post.cover_image_url}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition"
            />
          </div>
        )}
        {reason && (
          <Badge variant="secondary" className="mb-1.5 text-[10px]">
            {t(`readingList.reasons.${reason}`)}
          </Badge>
        )}
        <h3 className="font-display text-lg leading-tight group-hover:text-brand transition mb-1">
          {title}
        </h3>
        {excerpt && <p className="text-sm text-muted-foreground line-clamp-2">{excerpt}</p>}
      </Link>
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <div className="text-center py-20 text-muted-foreground">
      <p>{text}</p>
      <Link to="/blog" className="inline-block mt-4 text-brand hover:underline">
        {t("readingList.browseArticles")}
      </Link>
    </div>
  );
}
