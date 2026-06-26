// Dynamic-tag widget renderers. Surface the current post/archive context
// in a structural, non-HTML way. Falls back to placeholder data in the
// admin canvas so authors see realistic previews.
import { createElement, type ReactElement } from "react";
import { Link } from "@tanstack/react-router";
import type { WidgetNode } from "@/lib/builder/types";
import { useCurrentPostCtx, PLACEHOLDER_POST_CTX, type CurrentPostCtx } from "@/lib/builder/currentPostContext";
import { sanitizeHtml, safeUrl } from "@/lib/sanitize";
import { User as UserIcon, Clock, Eye, ChevronRight, Search as SearchIcon } from "@/lib/lucide-shim";

type Lang = "pl" | "en";

function useCtx(): CurrentPostCtx {
  return useCurrentPostCtx() ?? PLACEHOLDER_POST_CTX;
}

function pickLocalized(ctx: CurrentPostCtx, lang: Lang, key: "title" | "excerpt"): string {
  if (key === "title") return (lang === "en" ? ctx.title_en : ctx.title_pl) || ctx.title_pl || ctx.title_en || "";
  return (lang === "en" ? ctx.excerpt_en : ctx.excerpt_pl) || ctx.excerpt_pl || ctx.excerpt_en || "";
}

function fmtDate(iso: string | undefined, lang: Lang, fmt: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (fmt === "relative") {
      const diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60) return lang === "en" ? "just now" : "przed chwilą";
      if (diff < 3600) return lang === "en" ? `${Math.floor(diff / 60)} min ago` : `${Math.floor(diff / 60)} min temu`;
      if (diff < 86400) return lang === "en" ? `${Math.floor(diff / 3600)} h ago` : `${Math.floor(diff / 3600)} godz. temu`;
    }
    return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pl-PL", {
      day: "2-digit", month: fmt === "short" ? "2-digit" : "long", year: "numeric",
    }).format(d);
  } catch { return iso; }
}

function getStr(c: WidgetNode["content"], k: string, fb = ""): string {
  const v = c?.[k]; return typeof v === "string" ? v : fb;
}
function getBool(c: WidgetNode["content"], k: string, fb = false): boolean {
  const v = c?.[k]; return typeof v === "boolean" ? v : fb;
}
function getNum(c: WidgetNode["content"], k: string, fb = 0): number {
  const v = c?.[k]; return typeof v === "number" ? v : fb;
}

export function PostTitleWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const c = node.content;
  const tag = getStr(c, "tag", "h1");
  const title = pickLocalized(ctx, lang, "title")
    || (lang === "en" ? getStr(c, "fallback_en", "Post title") : getStr(c, "fallback_pl", "Tytuł wpisu"));
  const linkToPost = getBool(c, "linkToPost", false);
  const inner = linkToPost && ctx.slug
    ? <a href={`/${ctx.slug}`} className="hover:text-brand transition">{title}</a>
    : title;
  return createElement(tag, { className: "cms-post-title leading-tight" }, inner);
}

export function PostMetaWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const c = node.content;
  const sep = getStr(c, "separator", " · ");
  const dateFmt = getStr(c, "dateFormat", "long");
  const parts: ReactElement[] = [];
  if (getBool(c, "showAuthor", true) && ctx.author?.name) {
    parts.push(<span key="a" className="inline-flex items-center gap-1.5"><UserIcon className="w-3.5 h-3.5" />{ctx.author.slug ? <a href={`/author/${ctx.author.slug}`} className="hover:text-brand">{ctx.author.name}</a> : ctx.author.name}</span>);
  }
  if (getBool(c, "showCategory", true) && ctx.categories?.[0]) {
    const cat = ctx.categories[0];
    parts.push(<a key="c" href={`/category/${cat.slug}`} className="hover:text-brand uppercase tracking-wider text-[11px] font-bold">{cat.name}</a>);
  }
  if (getBool(c, "showDate", true) && ctx.publishedAt) {
    parts.push(<time key="d" dateTime={ctx.publishedAt}>{fmtDate(ctx.publishedAt, lang, dateFmt)}</time>);
  }
  if (getBool(c, "showReadingTime", true) && ctx.readingTimeMin) {
    parts.push(<span key="r" className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{ctx.readingTimeMin} min</span>);
  }
  if (getBool(c, "showViews", false) && typeof ctx.viewCount === "number") {
    parts.push(<span key="v" className="inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{new Intl.NumberFormat(lang === "en" ? "en-GB" : "pl-PL").format(ctx.viewCount)}</span>);
  }
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-muted-foreground">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center">
          {i > 0 && <span aria-hidden className="mx-1 opacity-60">{sep}</span>}
          {p}
        </span>
      ))}
    </div>
  );
}

function PillList({ items, base }: { items: Array<{ slug: string; name: string }>; base: "tag" | "category" }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
      {items.map((t) => (
        <li key={t.slug}>
          <a href={`/${base}/${t.slug}`} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-muted hover:bg-brand hover:text-brand-foreground transition">
            {t.name}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function PostTagsDynWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const c = node.content;
  const items = ctx.tags ?? [];
  if (items.length === 0) return null;
  const label = getBool(c, "showLabel", true)
    ? (lang === "en" ? getStr(c, "label_en", "Tags:") : getStr(c, "label_pl", "Tagi:"))
    : null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {label && <span className="text-sm font-semibold text-muted-foreground">{label}</span>}
      <PillList items={items} base="tag" />
    </div>
  );
}

export function PostCategoriesDynWidget({ node }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const limit = getNum(node.content, "limit", 0);
  const items = (ctx.categories ?? []).slice(0, limit > 0 ? limit : undefined);
  if (items.length === 0) return null;
  return <PillList items={items} base="category" />;
}

export function PostAuthorCardWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const a = ctx.author;
  if (!a) return null;
  const c = node.content;
  const bio = lang === "en" ? a.bio_en : a.bio_pl;
  return (
    <aside className="flex items-start gap-4 p-5 rounded-xl bg-muted/40 border border-border">
      {getBool(c, "showAvatar", true) && (
        <div className="shrink-0 w-16 h-16 rounded-full overflow-hidden bg-muted ring-2 ring-background">
          {a.avatarUrl ? <img src={safeUrl(a.avatarUrl)} alt={a.name ?? ""} className="w-full h-full object-cover" /> : <UserIcon className="w-full h-full p-3 text-muted-foreground" />}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{lang === "en" ? "Author" : "Autor"}</div>
        <div className="cms-post-title">
          {a.slug ? <a href={`/author/${a.slug}`} className="hover:text-brand">{a.name}</a> : a.name}
        </div>
        {getBool(c, "showBio", true) && bio && <p className="text-sm text-muted-foreground mt-1.5">{bio}</p>}
      </div>
    </aside>
  );
}

export function PostBreadcrumbsWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const c = node.content;
  const sep = getStr(c, "separator", "/");
  const items = ctx.breadcrumbs ?? [];
  if (items.length === 0) return null;
  const list = getBool(c, "showHome", true)
    ? [{ label: lang === "en" ? getStr(c, "home_en", "Home") : getStr(c, "home_pl", "Start"), href: "/" }, ...items.filter((b) => b.href !== "/")]
    : items;
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5 list-none p-0 m-0">
        {list.map((b, i) => {
          const isLast = i === list.length - 1;
          return (
            <li key={`${i}-${b.label}`} className="inline-flex items-center gap-1.5">
              {i > 0 && (sep === "/" ? <span aria-hidden className="opacity-60">/</span> : <ChevronRight className="w-3.5 h-3.5 opacity-60" />)}
              {b.href && !isLast ? <a href={b.href} className="hover:text-brand transition">{b.label}</a> : <span aria-current={isLast ? "page" : undefined} className={isLast ? "text-foreground font-medium" : ""}>{b.label}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PostCoverWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const c = node.content;
  if (!ctx.coverUrl) return null;
  const aspect = getStr(c, "aspect", "16/9");
  const rounded = getBool(c, "rounded", true);
  return (
    <figure className={`relative overflow-hidden ${rounded ? "rounded-xl" : ""} bg-muted`} style={{ aspectRatio: aspect.replace("/", " / ") }}>
      <img src={safeUrl(ctx.coverUrl)} alt={pickLocalized(ctx, lang, "title")} className="absolute inset-0 w-full h-full object-cover" />
    </figure>
  );
}

export function PostExcerptWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const max = getNum(node.content, "maxChars", 240);
  const raw = pickLocalized(ctx, lang, "excerpt");
  if (!raw) return null;
  const text = max > 0 && raw.length > max ? raw.slice(0, max).trimEnd() + "…" : raw;
  return <p className="text-base text-muted-foreground leading-relaxed">{text}</p>;
}

export function ArchiveTitleWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const ctx = useCtx();
  const a = ctx.archive ?? {
    type: "category",
    label: lang === "en" ? "Sample archive" : "Przykładowe archiwum",
    description: lang === "en" ? "All posts in this section." : "Wszystkie wpisy w tej sekcji.",
    count: 12,
  };
  const c = node.content;
  const kindLabel: Record<string, { pl: string; en: string }> = {
    author: { pl: "Autor", en: "Author" },
    tag: { pl: "Tag", en: "Tag" },
    category: { pl: "Kategoria", en: "Category" },
    search: { pl: "Wyniki wyszukiwania", en: "Search results" },
  };
  const kind = kindLabel[a.type] ?? kindLabel.category;
  return (
    <header className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-brand font-bold">{lang === "en" ? kind.en : kind.pl}</div>
      <h1 className="cms-post-title leading-tight">{a.label}</h1>
      {getBool(c, "showDescription", true) && a.description && <p className="text-muted-foreground max-w-2xl">{a.description}</p>}
      {getBool(c, "showCount", true) && typeof a.count === "number" && (
        <div className="text-sm text-muted-foreground">{a.count} {lang === "en" ? "posts" : "wpisów"}</div>
      )}
    </header>
  );
}

export function SearchFormWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const c = node.content;
  const action = safeUrl(getStr(c, "action", "/search")) || "/search";
  const placeholder = lang === "en" ? getStr(c, "placeholder_en", "Search...") : getStr(c, "placeholder_pl", "Szukaj...");
  const button = lang === "en" ? getStr(c, "button_en", "Search") : getStr(c, "button_pl", "Szukaj");
  return (
    <form action={action} method="get" role="search" className="flex items-stretch gap-0 w-full max-w-xl">
      <div className="relative flex-1">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="search"
          name="q"
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full h-11 pl-10 pr-3 rounded-l-md border border-r-0 border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>
      <button type="submit" className="h-11 px-5 rounded-r-md bg-brand text-brand-foreground text-sm font-semibold hover:opacity-90 transition">
        {button}
      </button>
    </form>
  );
}

// Helper for the dispatcher in SimpleWidgets.
export function DynamicTagWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  switch (node.type) {
    case "post-title": return <PostTitleWidget node={node} lang={lang} />;
    case "post-meta": return <PostMetaWidget node={node} lang={lang} />;
    case "post-tags-dyn": return <PostTagsDynWidget node={node} lang={lang} />;
    case "post-categories-dyn": return <PostCategoriesDynWidget node={node} lang={lang} />;
    case "post-author-card": return <PostAuthorCardWidget node={node} lang={lang} />;
    case "post-breadcrumbs": return <PostBreadcrumbsWidget node={node} lang={lang} />;
    case "post-cover": return <PostCoverWidget node={node} lang={lang} />;
    case "post-excerpt": return <PostExcerptWidget node={node} lang={lang} />;
    case "archive-title": return <ArchiveTitleWidget node={node} lang={lang} />;
    case "search-form": return <SearchFormWidget node={node} lang={lang} />;
    default: return null;
  }
}

// Avoid an unused import warning if Link tree-shakes out.
export const __keepLink = Link;
// sanitizeHtml is imported for parity with sibling files; suppress unused
export const __keepSanitize = sanitizeHtml;
