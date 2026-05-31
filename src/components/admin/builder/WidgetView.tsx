// Renders a widget (read-only by default; opt-in inline editing in the builder
// canvas via `editable` + `onContentChange`). Used in the live preview inside
// the builder canvas and on public pages. All user-authored strings (custom
// CSS, ids, classes, html, urls) go through src/lib/sanitize.ts.
import { useEffect, useRef, useState, type CSSProperties, type ElementType, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetNode, WidgetContent, CommonStyle, AdvancedSettings, Device } from "@/lib/builder/types";
import * as LucideIcons from "@/lib/lucide-shim";
import {
  sanitizeHtml,
  sanitizeHtmlId,
  sanitizeCssClass,
  scopeCustomCss,
  safeUrl,
  safeImageUrl,
} from "@/lib/sanitize";
import { useInView } from "@/hooks/use-in-view";
import { hoverCss } from "@/lib/builder/hoverCss";

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
  if (s.minHeight) css.minHeight = s.minHeight;
  if (s.borderStyle && s.borderStyle !== "none") {
    css.borderStyle = s.borderStyle;
    css.borderWidth = s.borderWidth || "1px";
    if (s.borderColor) css.borderColor = s.borderColor;
  }
  if (s.boxShadow) css.boxShadow = s.boxShadow;
  if (typeof s.opacity === "number") css.opacity = s.opacity;
  const t = s.typography;
  if (t) {
    if (t.fontFamily) css.fontFamily = t.fontFamily;
    const size = pick(t.fontSize, device);
    if (size) css.fontSize = size;
    if (t.fontWeight) css.fontWeight = t.fontWeight;
    if (t.fontStyle) css.fontStyle = t.fontStyle;
    if (t.lineHeight) css.lineHeight = t.lineHeight;
    if (t.letterSpacing) css.letterSpacing = t.letterSpacing;
    if (t.textTransform) css.textTransform = t.textTransform;
    if (t.textDecoration) css.textDecoration = t.textDecoration;
  }
  return css;
};

export const hiddenOnDevice = (a: AdvancedSettings | undefined, device: Device): boolean =>
  Boolean(a?.hideOn?.[device]);

interface ViewProps {
  node: WidgetNode;
  lang: Lang;
  device: Device;
  /** When true, click-to-edit text fields are enabled in canvas. */
  editable?: boolean;
  /** Commit a single content field. Called on blur / Enter. */
  onContentChange?: (key: string, value: string) => void;
}

/** Inline-editable text node. Plain text by default; pass `html` to allow rich content. */
function Editable({
  as: As = "span",
  value,
  onCommit,
  className,
  style,
  html = false,
  multiline = false,
  placeholder,
}: {
  as?: ElementType;
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  style?: CSSProperties;
  html?: boolean;
  multiline?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  // Sync DOM with prop only when not focused, so caret position is preserved.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (html) {
      if (el.innerHTML !== value) el.innerHTML = value;
    } else if (el.textContent !== value) {
      el.textContent = value;
    }
  }, [value, html]);
  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const next = html ? sanitizeHtml(el.innerHTML) : (el.textContent ?? "");
    if (next !== value) onCommit(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" && !multiline && !e.shiftKey) {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      const el = ref.current;
      if (el) {
        if (html) el.innerHTML = value;
        else el.textContent = value;
      }
      (e.target as HTMLElement).blur();
    }
  };
  return (
    <As
      ref={ref as never}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
      className={`${className ?? ""} outline-none focus:ring-2 focus:ring-brand/40 focus:rounded empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/50`}
      style={style}
    />
  );
}

function getStr(c: WidgetContent, k: string): string {
  const v = c[k];
  return typeof v === "string" ? v : "";
}
function getNum(c: WidgetContent, k: string, dflt: number): number {
  const v = c[k];
  return typeof v === "number" ? v : dflt;
}
function getStrArr(c: WidgetContent, k: string): string[] {
  const v = c[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

const MOTION_INITIAL: Record<string, CSSProperties> = {
  fade:         { opacity: 0 },
  "slide-up":   { opacity: 0, transform: "translateY(24px)" },
  "slide-down": { opacity: 0, transform: "translateY(-24px)" },
  "slide-left": { opacity: 0, transform: "translateX(24px)" },
  "slide-right":{ opacity: 0, transform: "translateX(-24px)" },
  zoom:         { opacity: 0, transform: "scale(0.92)" },
  "zoom-out":   { opacity: 0, transform: "scale(1.08)" },
  bounce:       { opacity: 0, transform: "translateY(24px) scale(0.96)" },
};
const MOTION_FINAL: CSSProperties = { opacity: 1, transform: "translate(0,0) scale(1)" };

export function WidgetView({ node, lang, device, editable = false, onContentChange }: ViewProps) {
  const baseStyle = styleToCSS(node.style, device);
  const cls = sanitizeCssClass(node.advanced?.cssClass) ?? "";
  const htmlId = sanitizeHtmlId(node.advanced?.htmlId);
  const motion = node.advanced?.animation && node.advanced.animation !== "none"
    ? node.advanced.animation : undefined;

  const { ref: motionRef, inView } = useInView<HTMLDivElement>({
    once: node.advanced?.animationOnce !== false,
  });

  const motionStyle: CSSProperties = motion
    ? {
        ...(inView ? MOTION_FINAL : (MOTION_INITIAL[motion] ?? {})),
        transition: `opacity ${node.advanced?.animationDuration ?? 600}ms ease-out ${node.advanced?.animationDelay ?? 0}ms, transform ${node.advanced?.animationDuration ?? 600}ms ease-out ${node.advanced?.animationDelay ?? 0}ms`,
        willChange: "opacity, transform",
      }
    : {};

  const scopedCss = scopeCustomCss(node.advanced?.customCss, node.id);
  const hover = hoverCss(node.id, node.style, device);

  const wrap = (children: React.ReactNode) => (
    <div
      id={htmlId}
      data-w-id={node.id}
      ref={motion ? motionRef : undefined}
      className={`${cls}`.trim()}
      style={{ ...baseStyle, ...motionStyle }}
    >
      {children}
      {hover && <style dangerouslySetInnerHTML={{ __html: hover }} />}
      {scopedCss && <style dangerouslySetInnerHTML={{ __html: scopedCss }} />}
    </div>
  );

  const c = node.content;
  const canEdit = editable && !!onContentChange;
  const commit = (k: string, v: string) => onContentChange?.(k, v);

  switch (node.type) {
    case "heading": {
      const key = `text_${lang}`;
      const text = getStr(c, key) || getStr(c, "text_pl");
      const tag = (getStr(c, "tag") || "h2") as "h1"|"h2"|"h3"|"h4";
      if (canEdit) {
        return wrap(<Editable as={tag} value={text} onCommit={(v) => commit(key, v)} className="font-display text-3xl" placeholder="Nagłówek…" />);
      }
      const Tag = tag;
      return wrap(<Tag className="font-display text-3xl">{text}</Tag>);
    }
    case "text": {
      const key = `html_${lang}`;
      const html = getStr(c, key) || getStr(c, "html_pl");
      if (canEdit) {
        return wrap(<Editable as="div" html multiline value={html} onCommit={(v) => commit(key, v)} className="prose prose-sm max-w-none dark:prose-invert" placeholder="Wpisz tekst…" />);
      }
      return wrap(<div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />);
    }
    case "image": {
      const src = safeImageUrl(getStr(c, "src"));
      const srcDark = safeImageUrl(getStr(c, "srcDark"));
      const alt = getStr(c, `alt_${lang}`) || getStr(c, "alt_pl");
      if (!src && !srcDark) return wrap(<div className="bg-muted rounded h-32 flex items-center justify-center text-xs text-muted-foreground">brak obrazka</div>);
      if (srcDark && src && srcDark !== src) {
        return wrap(
          <picture>
            <source srcSet={srcDark} media="(prefers-color-scheme: dark)" />
            <img src={src} alt={alt} className="max-w-full h-auto rounded" loading="lazy" />
          </picture>,
        );
      }
      return wrap(<img src={src || srcDark} alt={alt} className="max-w-full h-auto rounded" loading="lazy" />);
    }
    case "button": {
      const key = `label_${lang}`;
      const label = getStr(c, key) || getStr(c, "label_pl");
      const href = safeUrl(getStr(c, "href"));
      const variant = getStr(c, "variant") || "primary";
      const variantCls = variant === "outline"
        ? "border border-border hover:bg-muted"
        : variant === "ghost"
        ? "hover:bg-muted"
        : "bg-brand text-brand-foreground hover:opacity-90";
      const cls = `inline-flex items-center px-5 py-2.5 rounded-md text-sm font-medium transition ${variantCls}`;
      if (canEdit) {
        return wrap(<Editable as="span" value={label} onCommit={(v) => commit(key, v)} className={cls} placeholder="Etykieta…" />);
      }
      return wrap(<a href={href} rel={href.startsWith("http") ? "noopener noreferrer" : undefined} className={cls}>{label}</a>);
    }
    case "nav-link": {
      const key = `label_${lang}`;
      const label = getStr(c, key) || getStr(c, "label_pl");
      const href = safeUrl(getStr(c, "href"));
      const target = getStr(c, "target") === "blank" ? "_blank" : undefined;
      const variant = getStr(c, "variant") || "text";
      const iconName = getStr(c, "iconName");
      const variantCls =
        variant === "primary" ? "inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-brand text-brand-foreground hover:opacity-90"
        : variant === "outline" ? "inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-border hover:bg-muted"
        : variant === "pill" ? "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted hover:bg-muted/70"
        : variant === "underline" ? "inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
        : "inline-flex items-center gap-1.5 hover:text-brand";
      const cls = `text-xs font-bold tracking-wider transition ${variantCls}`;
      const reg: Record<string, React.ComponentType<{ size?: number }> | undefined> =
        LucideIcons as Record<string, React.ComponentType<{ size?: number }> | undefined>;
      const Cmp = iconName ? (reg[iconName] ?? null) : null;
      if (canEdit) {
        return wrap(
          <span className={cls}>
            {Cmp ? <Cmp size={14} /> : null}
            <Editable as="span" value={label} onCommit={(v) => commit(key, v)} placeholder="Etykieta…" />
          </span>,
        );
      }
      return wrap(
        <a
          href={href}
          target={target}
          rel={target === "_blank" || href.startsWith("http") ? "noopener noreferrer" : undefined}
          className={cls}
        >
          {Cmp ? <Cmp size={14} /> : null}
          {label}
        </a>,
      );
    }
    case "divider":
      return wrap(<hr className="border-border" />);
    case "spacer":
      return wrap(<div style={{ height: `${getNum(c, "height", 32)}px` }} />);
    case "social-icons": {
      const size = getNum(c, "size", 16);
      const items: Array<{ k: string; Cmp: LucideIcons.LucideIcon; label: string; href?: string }> = [
        { k: "facebook",  Cmp: LucideIcons.Facebook,  label: "Facebook" },
        { k: "twitter",   Cmp: LucideIcons.Twitter,   label: "X" },
        { k: "youtube",   Cmp: LucideIcons.Youtube,   label: "YouTube" },
        { k: "instagram", Cmp: LucideIcons.Instagram, label: "Instagram" },
        { k: "linkedin",  Cmp: LucideIcons.Linkedin,  label: "LinkedIn" },
      ];
      const email = getStr(c, "email");
      return wrap(
        <div className="flex items-center gap-3 text-muted-foreground">
          {items.map(({ k, Cmp, label }) => {
            const href = getStr(c, k);
            if (!href) return null;
            return <a key={k} href={safeUrl(href)} aria-label={label} className="hover:text-brand"><Cmp size={size} /></a>;
          })}
          {email && <a href={`mailto:${email}`} aria-label="Email" className="hover:text-brand"><LucideIcons.Mail size={size} /></a>}
        </div>,
      );
    }
    case "lang-switcher": {
      const showLabel = c.showLabel !== false;
      const label = getStr(c, `label_${lang}`) || getStr(c, "label_pl") || "Zmień język";
      return wrap(
        <div className="inline-flex items-center gap-3 text-xs">
          {showLabel && <span className="hidden md:inline text-muted-foreground">{label}</span>}
          <button type="button" aria-label="English" className="text-base leading-none opacity-60 hover:opacity-100">🇬🇧</button>
          <button type="button" aria-label="Polski" className="text-base leading-none opacity-60 hover:opacity-100">🇵🇱</button>
        </div>,
      );
    }
    case "theme-toggle": {
      return wrap(
        <button type="button" aria-label="Toggle theme" className="p-2 rounded-full hover:bg-muted transition">
          <LucideIcons.Moon className="w-4 h-4" />
        </button>,
      );
    }
    case "account-link": {
      const signin = getStr(c, `signin_${lang}`) || getStr(c, "signin_pl") || "Zaloguj";
      const signup = getStr(c, `signup_${lang}`) || getStr(c, "signup_pl") || "Zarejestruj";
      return wrap(
        <span className="inline-flex items-center gap-2 text-xs">
          <a href="/login" className="inline-flex items-center gap-1 font-semibold text-muted-foreground hover:text-brand">
            <LucideIcons.LogIn className="w-3.5 h-3.5" /> {signin}
          </a>
          <span className="text-muted-foreground/40">|</span>
          <a href="/login?mode=signup" className="font-semibold text-brand hover:underline">{signup}</a>
        </span>,
      );
    }
    case "search-button": {
      const label = getStr(c, `label_${lang}`) || getStr(c, "label_pl") || "Szukaj";
      return wrap(
        <button type="button" aria-label="Search" className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition">
          <LucideIcons.Search className="w-4 h-4" />
          <span className="hidden sm:inline">{label}</span>
        </button>,
      );
    }
    case "copyright": {
      const txt = getStr(c, `text_${lang}`) || getStr(c, "text_pl");
      const showYear = c.showYear !== false;
      const brand = getStr(c, "brand");
      return wrap(
        <div className="text-xs text-muted-foreground text-center">
          {showYear && `© ${new Date().getFullYear()} `}{brand}{brand && txt ? ". " : ""}{txt}{txt && "."}
        </div>,
      );
    }
    case "video": {
      const url = getStr(c, "url");
      if (!url) return wrap(<div className="bg-muted rounded aspect-video flex items-center justify-center text-xs text-muted-foreground">brak wideo</div>);
      const ytMatch = url.match(/(?:youtube\.com\/.*v=|youtu\.be\/)([\w-]+)/);
      if (ytMatch) {
        return wrap(<div className="aspect-video"><iframe src={`https://www.youtube.com/embed/${ytMatch[1]}`} title="video" className="w-full h-full rounded" allowFullScreen /></div>);
      }
      const safe = safeImageUrl(url) || (url.startsWith("https://") ? url : "");
      if (!safe) return wrap(<div className="bg-muted rounded aspect-video flex items-center justify-center text-xs text-muted-foreground">niedozwolony URL</div>);
      return wrap(<video src={safe} controls className="w-full rounded" />);
    }
    case "gallery": {
      const imgs = getStrArr(c, "images").map(safeImageUrl).filter(Boolean);
      const cols = getNum(c, "columns", 3);
      return wrap(<div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {imgs.length === 0 && <div className="col-span-full bg-muted rounded h-24 flex items-center justify-center text-xs text-muted-foreground">brak zdjęć</div>}
        {imgs.map((src, i) => <img key={i} src={src} alt="" className="w-full h-32 object-cover rounded" loading="lazy" />)}
      </div>);
    }
    case "icon": {
      const name = getStr(c, "name") || "Star";
      const size = getNum(c, "size", 32);
      const reg: Record<string, React.ComponentType<{ size?: number }> | undefined> =
        LucideIcons as Record<string, React.ComponentType<{ size?: number }> | undefined>;
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
      const tKey = `title_${lang}`;
      const title = getStr(c, tKey) || getStr(c, "title_pl") || "Newsletter";
      const MailIcon = (LucideIcons as Record<string, React.ComponentType<{ className?: string }>>).Mail;
      return wrap(
        <div className="inline-flex items-center gap-2 text-foreground/80 hover:text-brand transition-colors cursor-pointer" title={title}>
          {MailIcon ? <MailIcon className="w-5 h-5" /> : <span>✉</span>}
          <span className="text-sm font-medium">{title}</span>
        </div>,
      );
    }

    case "contact": {
      return wrap(<form className="space-y-3"><input placeholder="Imię" className="w-full bg-background border border-border rounded px-3 py-2 text-sm" /><input placeholder="Email" className="w-full bg-background border border-border rounded px-3 py-2 text-sm" /><textarea placeholder="Wiadomość" rows={4} className="w-full bg-background border border-border rounded px-3 py-2 text-sm" /><button type="button" className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm">Wyślij</button></form>);
    }
    case "cta": {
      const tKey = `title_${lang}`;
      const cKey = `cta_${lang}`;
      const title = getStr(c, tKey) || getStr(c, "title_pl");
      const cta = getStr(c, cKey) || getStr(c, "cta_pl");
      const href = safeUrl(getStr(c, "href"));
      return wrap(
        <div className="bg-brand text-brand-foreground rounded-lg p-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          {canEdit
            ? <Editable as="h3" value={title} onCommit={(v) => commit(tKey, v)} className="font-display text-2xl" placeholder="Nagłówek CTA…" />
            : <h3 className="font-display text-2xl">{title}</h3>}
          {canEdit
            ? <Editable as="span" value={cta} onCommit={(v) => commit(cKey, v)} className="bg-brand-foreground text-brand px-5 py-2.5 rounded font-medium" placeholder="Etykieta…" />
            : <a href={href} className="bg-brand-foreground text-brand px-5 py-2.5 rounded font-medium">{cta}</a>}
        </div>,
      );
    }
    case "accordion": {
      const items = Array.isArray(c.items) ? c.items as Array<Record<string, string>> : [];
      return wrap(
        <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
          {items.map((it, i) => (
            <details key={i} className="group">
              <summary className="cursor-pointer list-none px-4 py-3 flex justify-between items-center hover:bg-muted/30 font-medium text-sm">
                <span>{it[`q_${lang}`] || it.q_pl}</span>
                <span className="text-muted-foreground group-open:rotate-180 transition">▾</span>
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: sanitizeHtml(it[`a_${lang}`] || it.a_pl || "") }} />
            </details>
          ))}
        </div>
      );
    }
    case "tabs": {
      const tabs = Array.isArray(c.tabs) ? c.tabs as Array<Record<string, string>> : [];
      return wrap(<TabsBlock tabs={tabs} lang={lang} nodeId={node.id} />);
    }
    case "testimonial": {
      const quote = getStr(c, `quote_${lang}`) || getStr(c, "quote_pl");
      const author = getStr(c, "author");
      const role = getStr(c, `role_${lang}`) || getStr(c, "role_pl");
      const avatar = safeImageUrl(getStr(c, "avatar"));
      return wrap(
        <figure className="bg-muted/30 rounded-lg p-6 space-y-4">
          <blockquote className="text-base italic leading-relaxed">"{quote}"</blockquote>
          <figcaption className="flex items-center gap-3">
            {avatar && <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover" />}
            <div>
              <div className="font-medium text-sm">{author}</div>
              {role && <div className="text-xs text-muted-foreground">{role}</div>}
            </div>
          </figcaption>
        </figure>
      );
    }
    case "pricing": {
      const plans = Array.isArray(c.plans) ? c.plans as Array<Record<string, unknown>> : [];
      return wrap(
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((p, i) => {
            const name = (p[`name_${lang}`] || p.name_pl) as string;
            const price = (p.price ?? "") as string;
            const currency = (p.currency ?? "") as string;
            const period = (p[`period_${lang}`] || p.period_pl || "") as string;
            const featuresRaw = (p[`features_${lang}`] || p.features_pl || []) as unknown;
            const features = Array.isArray(featuresRaw) ? featuresRaw.filter((x): x is string => typeof x === "string") : [];
            const cta = (p[`cta_${lang}`] || p.cta_pl || "Wybierz") as string;
            const href = safeUrl(typeof p.href === "string" ? p.href : "#");
            const featured = !!p.featured;
            return (
              <div key={i} className={`rounded-lg border p-6 flex flex-col ${featured ? "border-brand bg-brand/5 shadow-lg" : "border-border bg-card"}`}>
                <h3 className="font-display text-xl mb-2">{name}</h3>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-bold">{price}</span>
                  <span className="text-sm text-muted-foreground">{currency}{period}</span>
                </div>
                <ul className="space-y-2 mb-6 flex-1 text-sm">
                  {features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2"><span className="text-brand mt-0.5">✓</span>{f}</li>
                  ))}
                </ul>
                <a href={href} className={`text-center px-4 py-2 rounded font-medium text-sm ${featured ? "bg-brand text-brand-foreground" : "border border-border hover:bg-muted"}`}>{cta}</a>
              </div>
            );
          })}
        </div>
      );
    }
    default:
      return null;
  }
}

function PostListView({ c, lang, carousel = false }: { c: WidgetContent; lang: Lang; carousel?: boolean }) {
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
        <a key={p.id} href={`/post/${p.slug}`} className={`bg-card border border-border rounded-lg overflow-hidden hover:border-brand transition ${carousel ? "min-w-[260px] snap-start" : ""}`}>
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

function TabsBlock({ tabs, lang, nodeId }: { tabs: Array<Record<string, string>>; lang: Lang; nodeId: string }) {
  const [active, setActive] = useState(0);
  if (!tabs.length) return <div className="text-xs text-muted-foreground">Brak zakładek</div>;
  const safe = Math.min(active, tabs.length - 1);
  const cur = tabs[safe];
  return (
    <div role="tablist" aria-label="Tabs" className="space-y-3">
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((t, i) => (
          <button
            key={`${nodeId}-${i}`}
            role="tab"
            aria-selected={i === safe}
            type="button"
            onClick={() => setActive(i)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              i === safe ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t[`label_${lang}`] || t.label_pl}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="prose prose-sm max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(cur[`html_${lang}`] || cur.html_pl || "") }} />
    </div>
  );
}
