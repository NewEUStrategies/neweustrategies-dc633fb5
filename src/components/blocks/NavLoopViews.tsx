// Publiczne renderery dla bloków Phase 2 batch 5: navigation, post-navigation-link, query-loop.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentPostCtx } from "@/lib/builder/currentPostContext";
import { AppLink } from "@/components/atoms/AppLink";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";

type Lang = "pl" | "en";

interface NavCategory {
  id: string;
  slug: string;
  name_pl: string | null;
  name_en: string | null;
}

export function NavigationView({ menuKey, layout, lang, cls }: { menuKey: string; layout: string; lang: Lang; cls: string }) {
  const [items, setItems] = useState<NavCategory[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // MVP: top-level categories as primary navigation menu (menuKey for future routing).
      const { data } = await supabase
        .from("categories")
        .select("id,slug,name_pl,name_en")
        .order("name_pl", { ascending: true })
        .limit(20);
      if (!cancelled && Array.isArray(data)) setItems(data as unknown as NavCategory[]);
    })();
    return () => { cancelled = true; };
  }, [menuKey]);

  if (items.length === 0) return null;
  const vertical = layout === "vertical";
  return (
    <nav className={cls} aria-label={menuKey}>
      <ul className={`not-prose flex ${vertical ? "flex-col gap-1" : "flex-row flex-wrap gap-4"} m-0 p-0 list-none`}>
        {items.map((it) => {
          const label = (lang === "en" ? it.name_en : it.name_pl) ?? it.name_pl ?? it.name_en ?? "";
          if (!label) return null;
          return (
            <li key={it.id}>
              <AppLink href={`/category/${it.slug}`} className="text-sm font-medium hover:text-primary">{label}</AppLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

interface NeighborPost {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  parent_page_id: string | null;
  published_at: string | null;
}

export function PostNavigationLinkView({ direction, showTitle, lang, cls }: { direction: "prev" | "next"; showTitle: boolean; lang: Lang; cls: string }) {
  const ctx = useCurrentPostCtx();
  const [post, setPost] = useState<NeighborPost | null>(null);
  const [href, setHref] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!ctx?.id || !ctx.publishedAt) return;
      const asc = direction === "next" ? false : true;
      const op = direction === "next" ? "lt" : "gt";
      let q = supabase
        .from("posts")
        .select("id,slug,title_pl,title_en,parent_page_id,published_at")
        .eq("status", "published")
        .is("deleted_at", null)
        .neq("id", ctx.id)
        .order("published_at", { ascending: asc })
        .limit(1);
      if (ctx.parentPageId) q = q.eq("parent_page_id", ctx.parentPageId);
      q = q[op]("published_at", ctx.publishedAt);
      const { data } = await q;
      const row = (data ?? [])[0] as NeighborPost | undefined;
      if (cancelled || !row) return;
      setPost(row);
      if (row.parent_page_id) {
        const { data: path } = await supabase.rpc("page_full_path", { _page_id: row.parent_page_id });
        if (!cancelled) setHref(`/${typeof path === "string" ? path : "blog"}/${row.slug}`);
      } else if (!cancelled) {
        setHref(`/post/${row.slug}`);
      }
    })();
    return () => { cancelled = true; };
  }, [ctx?.id, ctx?.publishedAt, ctx?.parentPageId, direction]);

  if (!post || !href) return null;
  const title = (lang === "en" ? post.title_en : post.title_pl) ?? "";
  const arrow = direction === "next" ? "→" : "←";
  return (
    <div className={`not-prose ${cls}`}>
      <AppLink href={href} className="inline-flex items-center gap-2 text-sm font-medium hover:text-primary">
        {direction === "prev" && <span>{arrow}</span>}
        <span className="flex flex-col">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            {direction === "next" ? (lang === "en" ? "Next" : "Następny") : (lang === "en" ? "Previous" : "Poprzedni")}
          </span>
          {showTitle && <span>{title}</span>}
        </span>
        {direction === "next" && <span>{arrow}</span>}
      </AppLink>
    </div>
  );
}

interface LoopPost {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  parent_page_id: string | null;
}

export function QueryLoopView({
  categorySlug, limit, layout, showExcerpt, showDate, showImage, orderBy, lang, cls,
}: {
  categorySlug: string; limit: number; layout: "grid" | "list";
  showExcerpt: boolean; showDate: boolean; showImage: boolean;
  orderBy: "date" | "title"; lang: Lang; cls: string;
}) {
  const [posts, setPosts] = useState<LoopPost[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let categoryId: string | null = null;
      if (categorySlug) {
        const { data: cat } = await supabase.from("categories").select("id").eq("slug", categorySlug).maybeSingle();
        categoryId = (cat as { id: string } | null)?.id ?? null;
      }
      let q = supabase
        .from("posts")
        .select("id,slug,title_pl,title_en,excerpt_pl,excerpt_en,cover_image_url,published_at,parent_page_id")
        .eq("status", "published")
        .is("deleted_at", null)
        .limit(Math.max(1, Math.min(24, limit)));
      if (orderBy === "title") {
        q = q.order(lang === "en" ? "title_en" : "title_pl", { ascending: true });
      } else {
        q = q.order("published_at", { ascending: false });
      }
      if (categoryId) {
        const { data: pc } = await supabase
          .from("post_categories")
          .select("post_id")
          .eq("category_id", categoryId);
        const ids = (pc ?? []).map((r) => (r as { post_id: string }).post_id);
        if (ids.length === 0) { if (!cancelled) setPosts([]); return; }
        q = q.in("id", ids);
      }
      const { data } = await q;
      if (!cancelled) setPosts((data ?? []) as unknown as LoopPost[]);
    })();
    return () => { cancelled = true; };
  }, [categorySlug, limit, orderBy, lang]);

  if (posts.length === 0) return null;

  const isGrid = layout === "grid";
  const container = isGrid
    ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
    : "flex flex-col gap-6";

  return (
    <div className={`not-prose ${cls}`}>
      <ul className={`${container} list-none m-0 p-0`}>
        {posts.map((p) => {
          const title = (lang === "en" ? p.title_en : p.title_pl) ?? "";
          const excerpt = (lang === "en" ? p.excerpt_en : p.excerpt_pl) ?? "";
          const href = `/post/${p.slug}`;
          return (
            <li key={p.id} className="flex flex-col gap-2">
              {showImage && p.cover_image_url && (
                <AppLink href={href} className="block overflow-hidden rounded-lg" style={{ aspectRatio: "4 / 3" }}>
                  <OptimizedImage src={p.cover_image_url} alt={title} className="w-full h-full object-cover" responsive sizes="(max-width: 768px) 100vw, 400px" />
                </AppLink>
              )}
              <h3 className="font-serif text-lg leading-tight m-0">
                <AppLink href={href} className="hover:text-primary">{title}</AppLink>
              </h3>
              {showDate && p.published_at && (
                <time className="text-xs text-muted-foreground" dateTime={p.published_at}>
                  {new Intl.DateTimeFormat(lang === "en" ? "en" : "pl", { dateStyle: "medium" }).format(new Date(p.published_at))}
                </time>
              )}
              {showExcerpt && excerpt && <p className="text-sm text-muted-foreground m-0">{excerpt}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
