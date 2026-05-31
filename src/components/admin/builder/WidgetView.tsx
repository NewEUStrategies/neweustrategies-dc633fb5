// Renders a widget (read-only). Used in the live preview inside the builder
// canvas and on public pages. All user-authored strings (custom CSS, ids,
// classes, html, urls) go through src/lib/sanitize.ts.
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetNode, CommonStyle, AdvancedSettings, Device } from "@/lib/builder/types";
import * as LucideIcons from "@/lib/lucide-shim";
import {
  sanitizeHtml,
  sanitizeHtmlId,
  sanitizeCssClass,
  scopeCustomCss,
  safeUrl,
  safeImageUrl,
} from "@/lib/sanitize";

type Lang = "pl" | "en";

const pick = <T,>(
  rv: { desktop?: T; tablet?: T; mobile?: T } | undefined,
  device: Device,
): T | undefined => {
  if (!rv) return undefined;
  return rv[device] ?? rv.desktop ?? rv.tablet ?? rv.mobile;
};

export const styleToCSS = (
  s: CommonStyle | undefined,
  device: Device,
): CSSProperties => {
  if (!s) return {};
  const css: CSSProperties = {};
  if (s.bgColor) css.background = s.bgColor;
  if (s.textColor) css.color = s.textColor;
  const padding = pick(s.padding, device);
  if (padding) css.padding = padding;
  const margin = pick(s.margin, device);
  if (margin) css.margin = margin;
  const align = pick(s.align, device);
  if (align) css.textAlign = align;
  if (s.borderRadius) css.borderRadius = s.borderRadius;
  if (s.maxWidth) css.maxWidth = s.maxWidth;
  return css;
};

export const hiddenOnDevice = (a: AdvancedSettings | undefined, device: Device): boolean =>
  Boolean(a?.hideOn?.[device]);

interface ViewProps {
  node: WidgetNode;
  lang: Lang;
  device: Device;
}

function getStr(c: Record<string, unknown>, k: string): string {
  const v = c[k];
  return typeof v === "string" ? v : "";
}
function getNum(c: Record<string, unknown>, k: string, dflt: number): number {
  const v = c[k];
  return typeof v === "number" ? v : dflt;
}
function getStrArr(c: Record<string, unknown>, k: string): string[] {
  const v = c[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function WidgetView({ node, lang, device }: ViewProps) {
  const baseStyle = styleToCSS(node.style, device);
  const cls = node.advanced?.cssClass ?? "";
  const animClass =
    node.advanced?.animation === "fade" ? "animate-in fade-in duration-500"
    : node.advanced?.animation === "slide-up" ? "animate-in slide-in-from-bottom-4 duration-500"
    : node.advanced?.animation === "zoom" ? "animate-in zoom-in-95 duration-500"
    : "";

  const wrap = (children: React.ReactNode) => (
    <div id={node.advanced?.htmlId} className={`${cls} ${animClass}`.trim()} style={baseStyle}>
      {children}
      {node.advanced?.customCss && <style>{node.advanced.customCss}</style>}
    </div>
  );

  const c = node.content;

  switch (node.type) {
    case "heading": {
      const text = getStr(c, `text_${lang}`) || getStr(c, "text_pl");
      const tag = (getStr(c, "tag") || "h2") as "h1"|"h2"|"h3"|"h4";
      const Tag = tag;
      return wrap(<Tag className="font-display text-3xl">{text}</Tag>);
    }
    case "text": {
      const html = getStr(c, `html_${lang}`) || getStr(c, "html_pl");
      return wrap(<div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: html }} />);
    }
    case "image": {
      const src = getStr(c, "src");
      const alt = getStr(c, `alt_${lang}`);
      if (!src) return wrap(<div className="bg-muted rounded h-32 flex items-center justify-center text-xs text-muted-foreground">brak obrazka</div>);
      return wrap(<img src={src} alt={alt} className="max-w-full h-auto rounded" />);
    }
    case "button": {
      const label = getStr(c, `label_${lang}`) || getStr(c, "label_pl");
      const href = getStr(c, "href") || "#";
      const variant = getStr(c, "variant") || "primary";
      const variantCls = variant === "outline"
        ? "border border-border hover:bg-muted"
        : variant === "ghost"
        ? "hover:bg-muted"
        : "bg-brand text-brand-foreground hover:opacity-90";
      return wrap(<a href={href} className={`inline-flex items-center px-5 py-2.5 rounded-md text-sm font-medium transition ${variantCls}`}>{label}</a>);
    }
    case "divider":
      return wrap(<hr className="border-border" />);
    case "spacer":
      return wrap(<div style={{ height: `${getNum(c, "height", 32)}px` }} />);
    case "video": {
      const url = getStr(c, "url");
      if (!url) return wrap(<div className="bg-muted rounded aspect-video flex items-center justify-center text-xs text-muted-foreground">brak wideo</div>);
      const ytMatch = url.match(/(?:youtube\.com\/.*v=|youtu\.be\/)([\w-]+)/);
      if (ytMatch) {
        return wrap(<div className="aspect-video"><iframe src={`https://www.youtube.com/embed/${ytMatch[1]}`} title="video" className="w-full h-full rounded" allowFullScreen /></div>);
      }
      return wrap(<video src={url} controls className="w-full rounded" />);
    }
    case "gallery": {
      const imgs = getStrArr(c, "images");
      const cols = getNum(c, "columns", 3);
      return wrap(<div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {imgs.length === 0 && <div className="col-span-full bg-muted rounded h-24 flex items-center justify-center text-xs text-muted-foreground">brak zdjęć</div>}
        {imgs.map((src, i) => <img key={i} src={src} alt="" className="w-full h-32 object-cover rounded" />)}
      </div>);
    }
    case "icon": {
      const name = getStr(c, "name") || "Star";
      const size = getNum(c, "size", 32);
      const reg = LucideIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>;
      const Cmp = reg[name] ?? LucideIcons.Star;
      return wrap(<Cmp size={size} />);
    }
    case "map": {
      const q = getStr(c, "query") || "Warszawa";
      const src = `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
      return wrap(<div className="aspect-video"><iframe src={src} title="map" className="w-full h-full rounded border-0" /></div>);
    }
    case "post-list":
      return wrap(<PostListView c={c} lang={lang} />);
    case "carousel":
      return wrap(<PostListView c={c} lang={lang} carousel />);
    case "categories":
      return wrap(<CategoriesView lang={lang} />);
    case "tags":
      return wrap(<TagsView />);
    case "newsletter": {
      const title = getStr(c, `title_${lang}`) || getStr(c, "title_pl");
      return wrap(<form className="bg-muted/30 rounded-lg p-6 space-y-3"><h3 className="font-display text-xl">{title}</h3><div className="flex gap-2"><input type="email" placeholder="email@example.com" className="flex-1 bg-background border border-border rounded px-3 py-2 text-sm" /><button type="button" className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm">OK</button></div></form>);
    }
    case "contact": {
      return wrap(<form className="space-y-3"><input placeholder="Imię" className="w-full bg-background border border-border rounded px-3 py-2 text-sm" /><input placeholder="Email" className="w-full bg-background border border-border rounded px-3 py-2 text-sm" /><textarea placeholder="Wiadomość" rows={4} className="w-full bg-background border border-border rounded px-3 py-2 text-sm" /><button type="button" className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm">Wyślij</button></form>);
    }
    case "cta": {
      const title = getStr(c, `title_${lang}`) || getStr(c, "title_pl");
      const cta = getStr(c, `cta_${lang}`) || getStr(c, "cta_pl");
      const href = getStr(c, "href") || "#";
      return wrap(<div className="bg-brand text-brand-foreground rounded-lg p-8 flex flex-col sm:flex-row items-center justify-between gap-4"><h3 className="font-display text-2xl">{title}</h3><a href={href} className="bg-brand-foreground text-brand px-5 py-2.5 rounded font-medium">{cta}</a></div>);
    }
    default:
      return null;
  }
}

function PostListView({ c, lang, carousel = false }: { c: Record<string, unknown>; lang: Lang; carousel?: boolean }) {
  const limit = getNum(c, "limit", 6);
  const cols = getNum(c, "columns", 3);
  const { data } = useQuery({
    queryKey: ["builder-post-list", limit],
    queryFn: async () => {
      const { data } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(limit);
      return data ?? [];
    },
  });
  const cls = carousel ? "flex gap-4 overflow-x-auto pb-2 snap-x" : "grid gap-4";
  const style = carousel ? undefined : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };
  return (
    <div className={cls} style={style}>
      {(data ?? []).map((p) => (
        <a key={p.id} href={`/blog/${p.slug}`} className={`bg-card border border-border rounded-lg overflow-hidden hover:border-brand transition ${carousel ? "min-w-[260px] snap-start" : ""}`}>
          {p.cover_image_url && <img src={p.cover_image_url} alt="" className="w-full h-40 object-cover" />}
          <div className="p-4">
            <h4 className="font-display text-lg mb-1 line-clamp-2">{lang === "pl" ? p.title_pl : p.title_en}</h4>
            <p className="text-sm text-muted-foreground line-clamp-2">{lang === "pl" ? p.excerpt_pl : p.excerpt_en}</p>
          </div>
        </a>
      ))}
    </div>
  );
}

function CategoriesView({ lang }: { lang: Lang }) {
  const { data } = useQuery({
    queryKey: ["builder-cats"],
    queryFn: async () => (await supabase.from("categories").select("id, slug, name_pl, name_en")).data ?? [],
  });
  return <div className="flex flex-wrap gap-2">{(data ?? []).map((c) => (
    <span key={c.id} className="px-3 py-1 rounded-full border border-border text-sm">{lang === "pl" ? c.name_pl : c.name_en}</span>
  ))}</div>;
}

function TagsView() {
  const { data } = useQuery({
    queryKey: ["builder-tags"],
    queryFn: async () => (await supabase.from("tags").select("id, slug, name")).data ?? [],
  });
  return <div className="flex flex-wrap gap-1.5">{(data ?? []).map((t) => (
    <span key={t.id} className="px-2 py-0.5 rounded bg-muted text-xs">#{t.name}</span>
  ))}</div>;
}
