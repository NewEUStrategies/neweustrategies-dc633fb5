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
  id: string; slug: string;
  title_pl: string | null; title_en: string | null;
  cover_image_url: string | null; published_at: string | null;
}
interface PageLite {
  id: string; slug: string;
  title_pl: string | null; title_en: string | null;
}

function pickTitle(row: { title_pl: string | null; title_en: string | null }, lang: "pl" | "en") {
  return (lang === "en" ? row.title_en : row.title_pl) || row.title_pl || row.title_en || "-";
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
    (bookmarks ?? []).forEach((b) => { out[b.entity_type].push(b.entity_id); });
    return out;
  }, [bookmarks]);

  const postsQ = useQuery({
    queryKey: ["bookmarks.posts", ids.post],
    enabled: !!user && ids.post.length > 0,
    queryFn: async (): Promise<PostLite[]> => {
      const { data, error } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, cover_image_url, published_at")
        .in("id", ids.post);
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
        .in("id", ids.page);
      if (error) throw error;
      return (data ?? []) as PageLite[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.bookmarks.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("profile.bookmarks.subtitle")}</p>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as BookmarkEntityType)}>
          <TabsList>
            <TabsTrigger value="post">{t("profile.bookmarks.tabPosts")} ({ids.post.length})</TabsTrigger>
            <TabsTrigger value="page">{t("profile.bookmarks.tabPages")} ({ids.page.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="post" className="mt-4">
            {ids.post.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("profile.bookmarks.empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {(postsQ.data ?? []).map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-3">
                    {p.cover_image_url ? (
                      <img src={p.cover_image_url} alt="" className="w-16 h-12 object-cover rounded" loading="lazy" />
                    ) : (
                      <div className="w-16 h-12 rounded bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <Link to="/post/$slug" params={{ slug: p.slug }} className="font-medium hover:underline truncate block">
                        {pickTitle(p, lang)}
                      </Link>
                      {p.published_at && (
                        <div className="text-xs text-muted-foreground">
                          {new Date(p.published_at).toLocaleDateString(lang === "en" ? "en-US" : "pl-PL")}
                        </div>
                      )}
                    </div>
                    <Button variant="ghost" size="sm"
                      onClick={() => toggle.mutate({ entityType: "post", entityId: p.id, on: false })}>
                      {t("profile.bookmarks.remove")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="page" className="mt-4">
            {ids.page.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("profile.bookmarks.empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {(pagesQ.data ?? []).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                    <span className="font-medium truncate">{pickTitle(p, lang)}</span>
                    <Button variant="ghost" size="sm"
                      onClick={() => toggle.mutate({ entityType: "page", entityId: p.id, on: false })}>
                      {t("profile.bookmarks.remove")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
