import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useFollows, useToggleFollow, type FollowTargetType } from "@/hooks/useFollows";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/profile/follows")({
  component: FollowsPage,
});

interface AuthorLite { id: string; display_name: string | null; slug: string | null; avatar_url: string | null }
interface TaxonomyLite { id: string; slug: string; name_pl: string | null; name_en: string | null }

function localize(name_pl: string | null, name_en: string | null, lang: "pl" | "en") {
  return (lang === "en" ? name_en : name_pl) || name_pl || name_en || "-";
}

function FollowsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const { data: follows } = useFollows();
  const toggle = useToggleFollow();
  const [tab, setTab] = useState<FollowTargetType>("author");

  const ids = useMemo(() => {
    const out = { author: [] as string[], category: [] as string[], tag: [] as string[] };
    (follows ?? []).forEach((f) => { out[f.target_type].push(f.target_id); });
    return out;
  }, [follows]);

  const authorsQ = useQuery({
    queryKey: ["follows.authors", ids.author],
    enabled: !!user && ids.author.length > 0,
    queryFn: async (): Promise<AuthorLite[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, slug, avatar_url")
        .in("id", ids.author);
      if (error) throw error;
      return (data ?? []) as AuthorLite[];
    },
  });

  const categoriesQ = useQuery({
    queryKey: ["follows.categories", ids.category],
    enabled: !!user && ids.category.length > 0,
    queryFn: async (): Promise<TaxonomyLite[]> => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, slug, name_pl, name_en")
        .in("id", ids.category);
      if (error) throw error;
      return (data ?? []) as TaxonomyLite[];
    },
  });

  const tagsQ = useQuery({
    queryKey: ["follows.tags", ids.tag],
    enabled: !!user && ids.tag.length > 0,
    queryFn: async (): Promise<TaxonomyLite[]> => {
      const { data, error } = await supabase
        .from("tags")
        .select("id, slug, name_pl, name_en")
        .in("id", ids.tag);
      if (error) throw error;
      return (data ?? []) as TaxonomyLite[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.follows.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("profile.follows.subtitle")}</p>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as FollowTargetType)}>
          <TabsList>
            <TabsTrigger value="author">{t("profile.follows.tabAuthors")} ({ids.author.length})</TabsTrigger>
            <TabsTrigger value="category">{t("profile.follows.tabCategories")} ({ids.category.length})</TabsTrigger>
            <TabsTrigger value="tag">{t("profile.follows.tabTags")} ({ids.tag.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="author" className="mt-4">
            {ids.author.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("profile.follows.empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {(authorsQ.data ?? []).map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-3">
                    {a.avatar_url
                      ? <img src={a.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                      : <div className="w-10 h-10 rounded-full bg-muted" />}
                    <div className="flex-1 min-w-0">
                      {a.slug ? (
                        <Link to="/author/$slug" params={{ slug: a.slug }} className="font-medium hover:underline truncate block">
                          {a.display_name ?? "-"}
                        </Link>
                      ) : (
                        <span className="font-medium truncate block">{a.display_name ?? "-"}</span>
                      )}
                    </div>
                    <Button variant="outline" size="sm"
                      onClick={() => toggle.mutate({ targetType: "author", targetId: a.id, on: false })}>
                      {t("profile.follows.unfollow")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="category" className="mt-4">
            {ids.category.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("profile.follows.empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {(categoriesQ.data ?? []).map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-3">
                    <Link to="/category/$slug" params={{ slug: c.slug }} className="flex-1 font-medium hover:underline truncate">
                      {localize(c.name_pl, c.name_en, lang)}
                    </Link>
                    <Button variant="outline" size="sm"
                      onClick={() => toggle.mutate({ targetType: "category", targetId: c.id, on: false })}>
                      {t("profile.follows.unfollow")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="tag" className="mt-4">
            {ids.tag.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("profile.follows.empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {(tagsQ.data ?? []).map((tg) => (
                  <li key={tg.id} className="flex items-center gap-3 py-3">
                    <Link to="/tag/$slug" params={{ slug: tg.slug }} className="flex-1 font-medium hover:underline truncate">
                      #{localize(tg.name_pl, tg.name_en, lang)}
                    </Link>
                    <Button variant="outline" size="sm"
                      onClick={() => toggle.mutate({ targetType: "tag", targetId: tg.id, on: false })}>
                      {t("profile.follows.unfollow")}
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
