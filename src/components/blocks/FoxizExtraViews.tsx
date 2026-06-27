// Publiczne renderery dla Phase 3 batch 8 (Foxiz/Ruby custom):
// post-stats, post-rating, loginout, more-posts.

import { useMemo, useState, useEffect, useCallback } from "react";
import { useCurrentPostCtx } from "@/lib/builder/currentPostContext";
import { AppLink } from "@/components/atoms/AppLink";
import { supabase } from "@/integrations/supabase/client";
import { Clock, Eye, User, Calendar, FolderOpen, MessageSquare, Star, LogIn, LogOut } from "lucide-react";

type Lang = "pl" | "en";

const L = {
  pl: {
    minRead: (m: number) => `${m} min`,
    views: "wyświetleń",
    comments: "kom.",
    signIn: "Zaloguj się",
    signOut: "Wyloguj",
    rateTitle: "Oceń ten wpis",
    thanks: "Dziękujemy za ocenę!",
    avgOf: (a: string, n: number) => `${a} (${n})`,
    more: "Polecane dla Ciebie",
    by: "przez",
  },
  en: {
    minRead: (m: number) => `${m} min`,
    views: "views",
    comments: "cmt",
    signIn: "Sign in",
    signOut: "Sign out",
    rateTitle: "Rate this post",
    thanks: "Thanks for rating!",
    avgOf: (a: string, n: number) => `${a} (${n})`,
    more: "Recommended for you",
    by: "by",
  },
} as const;

// ============ Post Stats ============

interface PostStatsProps {
  items?: string[];
  separator?: string;
  lang?: Lang;
  cls?: string;
}

export function PostStatsView({ items, separator = "•", lang = "pl", cls }: PostStatsProps) {
  const ctx = useCurrentPostCtx();
  const t = L[lang];
  const list = items?.length ? items : ["date", "author", "reading"];

  const dateStr = useMemo(() => {
    const d = ctx?.published_at ? new Date(ctx.published_at) : null;
    if (!d || Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(lang === "pl" ? "pl-PL" : "en-US", {
      year: "numeric", month: "long", day: "numeric",
    });
  }, [ctx?.published_at, lang]);

  const readingMin = useMemo(() => {
    if (typeof ctx?.readingTimeMin === "number" && ctx.readingTimeMin > 0) return ctx.readingTimeMin;
    const text = lang === "pl" ? ctx?.excerpt_pl : ctx?.excerpt_en;
    const w = (text ?? "").trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(w / 220));
  }, [ctx?.readingTimeMin, ctx?.excerpt_pl, ctx?.excerpt_en, lang]);

  const parts: { key: string; node: React.ReactNode }[] = [];
  for (const it of list) {
    if (it === "date" && dateStr) {
      parts.push({ key: "date", node: (
        <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" aria-hidden /> {dateStr}</span>
      ) });
    } else if (it === "author" && ctx?.author?.display_name) {
      parts.push({ key: "author", node: (
        <span className="inline-flex items-center gap-1.5"><User className="w-3.5 h-3.5" aria-hidden /> {t.by} {ctx.author.display_name}</span>
      ) });
    } else if (it === "category" && ctx?.categories?.[0]) {
      const c = ctx.categories[0];
      const name = (lang === "pl" ? c.name_pl : c.name_en) ?? c.name_pl ?? c.name_en ?? c.slug;
      parts.push({ key: "category", node: (
        <span className="inline-flex items-center gap-1.5"><FolderOpen className="w-3.5 h-3.5" aria-hidden /> {name}</span>
      ) });
    } else if (it === "reading") {
      parts.push({ key: "reading", node: (
        <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" aria-hidden /> {t.minRead(readingMin)}</span>
      ) });
    } else if (it === "views") {
      const n = typeof ctx?.viewCount === "number" ? ctx.viewCount : 0;
      const f = new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-US").format(n);
      parts.push({ key: "views", node: (
        <span className="inline-flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" aria-hidden /> {f} {t.views}</span>
      ) });
    } else if (it === "comments") {
      const n = typeof ctx?.commentsCount === "number" ? ctx.commentsCount : 0;
      parts.push({ key: "comments", node: (
        <span className="inline-flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" aria-hidden /> {n} {t.comments}</span>
      ) });
    }
  }

  if (parts.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground ${cls ?? ""}`}>
      {parts.map((p, i) => (
        <span key={p.key} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden className="text-muted-foreground/50">{separator}</span>}
          {p.node}
        </span>
      ))}
    </div>
  );
}

// ============ Post Rating (reader rating) ============

interface PostRatingProps {
  max?: number;
  label?: string;
  lang?: Lang;
  cls?: string;
}

interface AggregatedRating { avg: number; count: number }

export function PostRatingView({ max = 5, label, lang = "pl", cls }: PostRatingProps) {
  const ctx = useCurrentPostCtx();
  const t = L[lang];
  const postId = ctx?.id ?? null;
  const storageKey = postId ? `post-rating:${postId}` : null;
  const [hover, setHover] = useState<number | null>(null);
  const [mine, setMine] = useState<number | null>(null);
  const [agg, setAgg] = useState<AggregatedRating | null>(null);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const v = window.localStorage.getItem(storageKey);
      if (v) setMine(Number(v));
    } catch { /* noop */ }
  }, [storageKey]);

  const rate = useCallback((n: number) => {
    if (!storageKey) return;
    setMine(n);
    try { window.localStorage.setItem(storageKey, String(n)); } catch { /* noop */ }
    // Local aggregate update for instant feedback; canonical persistence
    // requires a dedicated reactions table — out of scope for this block.
    setAgg((a) => {
      const c = (a?.count ?? 0) + 1;
      const sum = (a?.avg ?? n) * (a?.count ?? 0) + n;
      return { avg: sum / c, count: c };
    });
  }, [storageKey]);

  const stars = Array.from({ length: max }, (_, i) => i + 1);
  const displayed = hover ?? mine ?? Math.round(agg?.avg ?? 0);
  const heading = label && label.trim() ? label : t.rateTitle;

  return (
    <div className={`inline-flex flex-col gap-1.5 ${cls ?? ""}`}>
      <div className="text-sm font-medium text-foreground">{heading}</div>
      <div
        className="inline-flex items-center gap-0.5"
        role="radiogroup"
        aria-label={heading}
        onMouseLeave={() => setHover(null)}
      >
        {stars.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={mine === n}
            aria-label={`${n}/${max}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => rate(n)}
            className="p-0.5 transition-transform hover:scale-110"
          >
            <Star
              className={`w-5 h-5 ${n <= displayed ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40"}`}
              aria-hidden
            />
          </button>
        ))}
        {agg ? (
          <span className="ml-2 text-xs text-muted-foreground tabular-nums">
            {t.avgOf(agg.avg.toFixed(1), agg.count)}
          </span>
        ) : null}
      </div>
      {mine !== null ? <span className="text-xs text-muted-foreground">{t.thanks}</span> : null}
    </div>
  );
}

// ============ LoginOut ============

interface LoginOutProps {
  loginHref?: string;
  showAvatar?: boolean;
  lang?: Lang;
  cls?: string;
}

export function LoginOutView({ loginHref = "/auth", showAvatar = true, lang = "pl", cls }: LoginOutProps) {
  const t = L[lang];
  const [email, setEmail] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      const u = data.user;
      if (!u) { setEmail(null); return; }
      setEmail(u.email ?? null);
      const meta = (u.user_metadata ?? {}) as { avatar_url?: string; display_name?: string; name?: string };
      setAvatar(meta.avatar_url ?? null);
      setName(meta.display_name ?? meta.name ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!mounted) return;
      const u = session?.user;
      if (!u) { setEmail(null); setAvatar(null); setName(null); return; }
      setEmail(u.email ?? null);
      const meta = (u.user_metadata ?? {}) as { avatar_url?: string; display_name?: string; name?: string };
      setAvatar(meta.avatar_url ?? null);
      setName(meta.display_name ?? meta.name ?? null);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const onSignOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const baseCls = "inline-flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors";

  if (!email) {
    return (
      <AppLink href={loginHref} className={`${baseCls} ${cls ?? ""}`}>
        <LogIn className="w-4 h-4" aria-hidden />
        <span>{t.signIn}</span>
      </AppLink>
    );
  }

  const initial = (name ?? email).charAt(0).toUpperCase();

  return (
    <div className={`inline-flex items-center gap-2 ${cls ?? ""}`}>
      {showAvatar ? (
        avatar ? (
          <img src={avatar} alt={name ?? email} className="w-7 h-7 rounded-full object-cover border border-border" />
        ) : (
          <span className="w-7 h-7 rounded-full bg-muted text-foreground inline-flex items-center justify-center text-xs font-semibold">
            {initial}
          </span>
        )
      ) : null}
      <span className="text-sm text-foreground hidden sm:inline truncate max-w-[160px]">{name ?? email}</span>
      <button type="button" onClick={onSignOut} className={baseCls}>
        <LogOut className="w-4 h-4" aria-hidden />
        <span>{t.signOut}</span>
      </button>
    </div>
  );
}

// ============ More Posts (promo strip) ============

interface MorePostsProps {
  limit?: number;
  strategy?: "latest" | "trending" | "category";
  heading?: string;
  lang?: Lang;
  cls?: string;
}

interface PostLite {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  parent_page_id: string | null;
}

export function MorePostsView({ limit = 4, strategy = "latest", heading, lang = "pl", cls }: MorePostsProps) {
  const ctx = useCurrentPostCtx();
  const t = L[lang];
  const [posts, setPosts] = useState<PostLite[]>([]);

  useEffect(() => {
    let mounted = true;
    const lim = Math.min(Math.max(limit, 2), 12);

    const run = async () => {
      if (strategy === "trending") {
        const { data, error } = await supabase.rpc("trending_posts", { _days: 7, _limit: lim + 1 });
        if (error || !data) return;
        if (!mounted) return;
        setPosts((data as PostLite[]).filter((p) => p.id !== ctx?.id).slice(0, lim));
        return;
      }
      let q = supabase
        .from("posts")
        .select("id,slug,title_pl,title_en,cover_image_url,published_at,parent_page_id")
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false })
        .limit(lim + 1);
      if (strategy === "category" && ctx?.categories?.[0]?.id) {
        const catId = ctx.categories[0].id;
        const { data: rels } = await supabase
          .from("post_categories")
          .select("post_id")
          .eq("category_id", catId)
          .limit(lim + 5);
        const ids = (rels ?? []).map((r) => r.post_id).filter((x): x is string => !!x);
        if (ids.length === 0) { setPosts([]); return; }
        q = q.in("id", ids);
      }
      const { data, error } = await q;
      if (error || !data) return;
      if (!mounted) return;
      setPosts((data as PostLite[]).filter((p) => p.id !== ctx?.id).slice(0, lim));
    };

    void run();
    return () => { mounted = false; };
  }, [limit, strategy, ctx?.id, ctx?.categories]);

  if (posts.length === 0) return null;

  const h = heading && heading.trim() ? heading : t.more;

  return (
    <section className={`rounded-lg border border-border bg-muted/20 p-4 ${cls ?? ""}`} aria-label={h}>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground mb-3">{h}</h3>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {posts.map((p) => {
          const title = (lang === "pl" ? p.title_pl : p.title_en) ?? p.title_pl ?? p.title_en ?? p.slug;
          const href = `/${p.slug}`;
          return (
            <li key={p.id}>
              <AppLink href={href} className="group block">
                <div className="aspect-[4/3] w-full overflow-hidden rounded-md bg-muted">
                  {p.cover_image_url ? (
                    <img
                      src={p.cover_image_url}
                      alt={title}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : null}
                </div>
                <div className="mt-2 text-xs font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
                  {title}
                </div>
              </AppLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
