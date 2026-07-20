// Zapisane materiały: wpisy i strony z user_bookmarks.
//
// Widoczne są wyłącznie opublikowane, nieusunięte pozycje (jak /reading-list),
// a zakładki wskazujące treści usunięte/wycofane nie znikają po cichu - dostają
// wiersz "niedostępne" z możliwością sprzątnięcia. Liczniki w zakładkach
// odpowiadają liczbie pozycji faktycznie pokazanych na liście.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBookmarks, useToggleBookmark, type BookmarkEntityType } from "@/hooks/useBookmarks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/profile/bookmarks")({
  component: BookmarksPage,
});

interface PostLite {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
}
interface PageLite {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  fullPath: string;
}

function pickTitle(row: { title_pl: string | null; title_en: string | null }, lang: "pl" | "en") {
  return (lang === "en" ? row.title_en : row.title_pl) || row.title_pl || row.title_en || "-";
}

// Wiersz dla zakładki, której treść zniknęła (usunięta / wycofana z publikacji
// / niedostępna przez RLS) - użytkownik może sprzątnąć martwą pozycję.
function UnavailableRow({
  entityType,
  entityId,
}: {
  entityType: BookmarkEntityType;
  entityId: string;
}) {
  const { t } = useTranslation();
  const toggle = useToggleBookmark();
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <span className="truncate text-sm italic text-muted-foreground">
        {t("profile.bookmarks.unavailable")}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate({ entityType, entityId, on: false })}
      >
        {t("profile.bookmarks.remove")}
      </Button>
    </li>
  );
}

function BookmarksPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const { data: bookmarks } = useBookmarks();
  const toggle = useToggleBookmark();
  const [tab, setTab] = useState<BookmarkEntityType>("post");

  const ids = useMemo(() => {
    const out = { post: [] as string[], page: [] as string[] };
    (bookmarks ?? []).forEach((b) => {
      out[b.entity_type].push(b.entity_id);
    });
    return out;
  }, [bookmarks]);

  const postsQ = useQuery({
    queryKey: ["bookmarks.posts", ids.post],
    enabled: !!user && ids.post.length > 0,
    queryFn: async (): Promise<PostLite[]> => {
      const { data, error } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, cover_image_url, published_at")
        .in("id", ids.post)
        .eq("status", "published")
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []) as PostLite[];
    },
  });

  const pagesQ = useQuery({
    queryKey: ["bookmarks.pages", ids.page],
    enabled: !!user && ids.page.length > 0,
    queryFn: async (): Promise<PageLite[]> => {
      const { data, error } = await supabase
        .from("pages")
        .select("id, slug, title_pl, title_en")
        .in("id", ids.page)
        .eq("status", "published")
        .is("deleted_at", null);
      if (error) throw error;
      // Strony bywają zagnieżdżone - pełną ścieżkę zna DB (page_full_path).
      const withPaths = await Promise.all(
        (data ?? []).map(async (p) => {
          const { data: path } = await supabase.rpc("page_full_path", { _page_id: p.id });
          const raw = path && path.length > 0 ? path : p.slug;
          return { ...p, fullPath: raw.startsWith("/") ? raw : `/${raw}` } as PageLite;
        }),
      );
      return withPaths;
    },
  });

  // Liczniki = pozycje faktycznie widoczne (po hydracji), nie surowe id.
  const visiblePosts = postsQ.data ?? [];
  const visiblePages = pagesQ.data ?? [];
  const missingPostIds = postsQ.data
    ? ids.post.filter((id) => !postsQ.data.some((p) => p.id === id))
    : [];
  const missingPageIds = pagesQ.data
    ? ids.page.filter((id) => !pagesQ.data.some((p) => p.id === id))
    : [];
  // Licznik = wszystkie renderowane wiersze (widoczne + "niedostępne").
  const postCount = postsQ.data ? visiblePosts.length + missingPostIds.length : ids.post.length;
  const pageCount = pagesQ.data ? visiblePages.length + missingPageIds.length : ids.page.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.bookmarks.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("profile.bookmarks.subtitle")}</p>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as BookmarkEntityType)}>
          <TabsList>
            <TabsTrigger value="post">
              {t("profile.bookmarks.tabPosts")} ({postCount})
            </TabsTrigger>
            <TabsTrigger value="page">
              {t("profile.bookmarks.tabPages")} ({pageCount})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="post" className="mt-4">
            {ids.post.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("profile.bookmarks.empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {visiblePosts.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-3">
                    {p.cover_image_url ? (
                      <img
                        src={p.cover_image_url}
                        alt=""
                        className="w-16 h-12 object-cover rounded"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-16 h-12 rounded bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <Link
                        to="/post/$slug"
                        params={{ slug: p.slug }}
                        className="font-medium hover:underline truncate block"
                      >
                        {pickTitle(p, lang)}
                      </Link>
                      {p.published_at && (
                        <div className="text-xs text-muted-foreground">
                          {new Date(p.published_at).toLocaleDateString(
                            lang === "en" ? "en-GB" : "pl-PL",
                          )}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        toggle.mutate({ entityType: "post", entityId: p.id, on: false })
                      }
                    >
                      {t("profile.bookmarks.remove")}
                    </Button>
                  </li>
                ))}
                {missingPostIds.map((id) => (
                  <UnavailableRow key={id} entityType="post" entityId={id} />
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="page" className="mt-4">
            {ids.page.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("profile.bookmarks.empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {visiblePages.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                    <Link to={p.fullPath} className="font-medium hover:underline truncate">
                      {pickTitle(p, lang)}
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        toggle.mutate({ entityType: "page", entityId: p.id, on: false })
                      }
                    >
                      {t("profile.bookmarks.remove")}
                    </Button>
                  </li>
                ))}
                {missingPageIds.map((id) => (
                  <UnavailableRow key={id} entityType="page" entityId={id} />
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
