// Mega menu - desktop hover/click dropdown panel + mobile accordion.
// Used by the builder widget "mega-menu". Fully i18n (pl/en), keyboard-
// accessible, theme-aware (semantic tokens only).
// Supports two column kinds (Foxiz parity):
//   - "links"    : title + list of links + optional featured banner
//   - "category" : recent posts from a category with thumbnails (AJAX-style)
import { memo, useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "@/lib/lucide-shim";
import { safeUrl, safeImageUrl } from "@/lib/sanitize";
import { AppLink } from "@/components/atoms/AppLink";
import { megaMenuCategoryQueryOptions } from "@/lib/queries/megaMenu";

export type MegaMenuLang = "pl" | "en";

export interface MegaMenuLink {
  label_pl?: string;
  label_en?: string;
  href?: string;
  desc_pl?: string;
  desc_en?: string;
}

export type FeaturedAspectRatio = "16/10" | "16/9" | "4/3" | "1/1" | "3/4";

export interface MegaMenuFeatured {
  image?: string;
  title_pl?: string;
  title_en?: string;
  excerpt_pl?: string;
  excerpt_en?: string;
  href?: string;
  cta_pl?: string;
  cta_en?: string;
  /** Focal point X (0-100). Default 50. */
  focalX?: number;
  /** Focal point Y (0-100). Default 50. */
  focalY?: number;
  /** Aspect ratio of the image frame. Default 16/10. */
  aspectRatio?: FeaturedAspectRatio;
  /** Placeholder background tint while the image loads (CSS color). */
  placeholderColor?: string;
}

export type MegaMenuColumnKind = "links" | "category";

export interface MegaMenuColumn {
  kind?: MegaMenuColumnKind;
  title_pl?: string;
  title_en?: string;
  links?: MegaMenuLink[];
  featured?: MegaMenuFeatured | null;
  /** When kind === "category": slug of the category to show recent posts from. */
  categorySlug?: string;
  /** When kind === "category": number of posts (1-8). Default 4. */
  postCount?: number;
  /** When kind === "category": URL of the "See all" link (defaults to /category/<slug>). */
  viewAllHref?: string;
}

export interface MegaMenuConfig {
  trigger_pl?: string;
  trigger_en?: string;
  href?: string;
  triggerOn?: "hover" | "click";
  width?: "container" | "fluid" | "fixed";
  widthPx?: number;
  columns?: MegaMenuColumn[];
}

interface Props {
  config: MegaMenuConfig;
  lang: MegaMenuLang;
  /** Render mobile-style accordion instead of dropdown panel. */
  mobile?: boolean;
}

const pickLang = (a?: string, b?: string): string => (a && a.length ? a : (b ?? ""));

export const MegaMenu = memo(function MegaMenu({ config, lang, mobile = false }: Props) {
  const trigger =
    pickLang(lang === "pl" ? config.trigger_pl : config.trigger_en, config.trigger_pl) ||
    (lang === "pl" ? "Menu" : "Menu");
  const triggerHref = safeUrl(config.href ?? "", "");
  const columns = Array.isArray(config.columns) ? config.columns : [];
  const triggerOn = config.triggerOn ?? "hover";
  const panelId = useId();

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  // Click-outside + ESC for click-trigger.
  useEffect(() => {
    if (!open || triggerOn !== "click" || mobile) return;
    const onDoc = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, triggerOn, mobile]);

  // Mobile: native disclosure.
  if (mobile) {
    return (
      <details className="group/mega border-b border-border last:border-0 w-full">
        <summary className="flex items-center justify-between gap-2 py-3 cursor-pointer list-none select-none text-sm font-bold tracking-wider uppercase">
          {triggerHref ? (
            <AppLink href={triggerHref} className="hover:text-brand transition flex-1">
              {trigger}
            </AppLink>
          ) : (
            <span className="flex-1">{trigger}</span>
          )}
          <ChevronDown className="w-4 h-4 transition-transform group-open/mega:rotate-180" />
        </summary>
        <div className="pb-4 space-y-4">
          {columns.map((col, i) => (
            <MobileColumn key={i} col={col} lang={lang} />
          ))}
        </div>
      </details>
    );
  }

  // Desktop: hover OR click trigger.
  const onMouseEnter = (): void => {
    if (triggerOn !== "hover") return;
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const onMouseLeave = (): void => {
    if (triggerOn !== "hover") return;
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  const widthCls =
    config.width === "fluid"
      ? "left-0 right-0 w-screen max-w-[100vw]"
      : config.width === "fixed"
        ? ""
        : "left-1/2 -translate-x-1/2 w-[min(1140px,calc(100vw-32px))]";
  const widthStyle =
    config.width === "fixed" && config.widthPx && config.widthPx > 200
      ? { width: `${config.widthPx}px`, left: "50%", transform: "translateX(-50%)" }
      : undefined;

  return (
    <div
      ref={wrapRef}
      className="relative inline-flex items-stretch"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {triggerHref && triggerOn !== "click" ? (
        <AppLink
          href={triggerHref}
          className="inline-flex items-center gap-1.5 h-10 px-1 text-xs font-bold tracking-wider uppercase leading-none text-foreground hover:opacity-80 transition"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={panelId}
        >
          {trigger}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </AppLink>
      ) : (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-10 px-1 text-xs font-bold tracking-wider uppercase leading-none text-foreground hover:opacity-80 transition"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            if (triggerOn === "click") setOpen((v) => !v);
          }}
        >
          {trigger}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}

      {open && columns.length > 0 && (
        <div
          id={panelId}
          role="menu"
          className={`absolute top-full mt-2 z-50 ${widthCls} bg-background border border-border rounded-xl shadow-xl p-6`}
          style={widthStyle}
        >
          <div
            className="grid gap-6"
            style={{
              gridTemplateColumns: `repeat(${Math.min(Math.max(columns.length, 1), 5)}, minmax(0, 1fr))`,
            }}
          >
            {columns.map((col, i) => (
              <DesktopColumn key={i} col={col} lang={lang} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
MegaMenu.displayName = "MegaMenu";

function DesktopColumn({ col, lang }: { col: MegaMenuColumn; lang: MegaMenuLang }) {
  if ((col.kind ?? "links") === "category") {
    return <CategoryColumn col={col} lang={lang} />;
  }
  const title = pickLang(lang === "pl" ? col.title_pl : col.title_en, col.title_pl);
  const links = Array.isArray(col.links) ? col.links : [];
  const featured = col.featured;
  return (
    <div className="min-w-0 space-y-3">
      {title && (
        <h4 className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground">
          {title}
        </h4>
      )}
      {links.length > 0 && (
        <ul className="space-y-1.5">
          {links.map((l, i) => {
            const label = pickLang(lang === "pl" ? l.label_pl : l.label_en, l.label_pl);
            const desc = pickLang(lang === "pl" ? l.desc_pl : l.desc_en, l.desc_pl);
            const href = safeUrl(l.href ?? "#");
            if (!label) return null;
            return (
              <li key={i}>
                <AppLink
                  href={href}
                  className="block rounded-md px-2 py-1.5 -mx-2 hover:bg-muted transition"
                >
                  <span className="block text-sm font-medium text-foreground leading-tight">
                    {label}
                  </span>
                  {desc && (
                    <span className="block text-xs text-muted-foreground mt-0.5">{desc}</span>
                  )}
                </AppLink>
              </li>
            );
          })}
        </ul>
      )}
      {featured && (featured.image || featured.title_pl || featured.title_en) && (
        <FeaturedCard featured={featured} lang={lang} />
      )}
    </div>
  );
}

/**
 * Category column: Foxiz-style "Category Mega Menu" - fetches recent posts
 * from the chosen category and renders a 2-column thumbnail grid with title.
 */
function CategoryColumn({ col, lang }: { col: MegaMenuColumn; lang: MegaMenuLang }) {
  const slug = (col.categorySlug ?? "").trim();
  const limit = Math.min(Math.max(Number(col.postCount) || 4, 1), 8);
  const title = pickLang(lang === "pl" ? col.title_pl : col.title_en, col.title_pl);
  const viewAll = safeUrl(col.viewAllHref || (slug ? `/category/${slug}` : "#"));

  const { data, isLoading } = useQuery(megaMenuCategoryQueryOptions(slug, limit, lang));

  const heading = title || data?.catName || "";

  return (
    <div className="min-w-0 space-y-3">
      {heading && (
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground">
            {heading}
          </h4>
          {slug && (
            <AppLink
              href={viewAll}
              className="text-[10px] font-semibold text-brand hover:underline uppercase tracking-wider"
            >
              {lang === "pl" ? "Zobacz" : "View all"} →
            </AppLink>
          )}
        </div>
      )}
      {isLoading && (
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: limit }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="aspect-[4/3] rounded-md bg-muted animate-pulse" />
              <div className="h-3 rounded bg-muted animate-pulse" />
              <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      )}
      {!isLoading && data && data.posts.length > 0 && (
        <ul className="grid grid-cols-2 gap-3">
          {data.posts.map((p) => (
            <li key={p.id}>
              <AppLink href={p.href} className="group block space-y-1.5">
                <div className="aspect-[4/3] rounded-md overflow-hidden bg-muted">
                  {p.cover ? (
                    <img
                      src={safeImageUrl(p.cover)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : null}
                </div>
                <div className="text-xs font-semibold text-foreground leading-snug line-clamp-3 group-hover:text-brand transition">
                  {p.title}
                </div>
              </AppLink>
            </li>
          ))}
        </ul>
      )}
      {!isLoading && data && data.posts.length === 0 && slug && (
        <div className="text-xs text-muted-foreground italic">
          {lang === "pl" ? "Brak wpisów w kategorii." : "No posts in this category."}
        </div>
      )}
      {!slug && (
        <div className="text-xs text-muted-foreground italic">
          {lang === "pl" ? "Wybierz kategorię w edytorze." : "Pick a category in the editor."}
        </div>
      )}
    </div>
  );
}

interface PostCard {
  id: string;
  slug: string;
  title: string;
  cover: string;
  href: string;
}

/** Allowed aspect ratios; used for legacy normalization. */
const ALLOWED_RATIOS: ReadonlyArray<FeaturedAspectRatio> = ["16/10", "16/9", "4/3", "1/1", "3/4"];

/**
 * Normalize a (possibly legacy / partial / malformed) MegaMenuFeatured into a
 * safe shape with focalX/focalY/aspectRatio/placeholderColor defaults applied.
 * Accepts numeric strings (e.g. "50") and clamps out-of-range values.
 */
export function normalizeFeatured(
  raw: MegaMenuFeatured | null | undefined,
): Required<Pick<MegaMenuFeatured, "focalX" | "focalY" | "aspectRatio">> & MegaMenuFeatured {
  const src: MegaMenuFeatured = raw ?? {};
  const fx = clamp01(toNum(src.focalX, 50));
  const fy = clamp01(toNum(src.focalY, 50));
  const ratio: FeaturedAspectRatio =
    src.aspectRatio && ALLOWED_RATIOS.includes(src.aspectRatio) ? src.aspectRatio : "16/10";
  const placeholderColor =
    typeof src.placeholderColor === "string" && src.placeholderColor.trim()
      ? src.placeholderColor
      : undefined;
  return { ...src, focalX: fx, focalY: fy, aspectRatio: ratio, placeholderColor };
}

function FeaturedCard({ featured, lang }: { featured: MegaMenuFeatured; lang: MegaMenuLang }) {
  const f = normalizeFeatured(featured);
  const title = pickLang(lang === "pl" ? f.title_pl : f.title_en, f.title_pl);
  const excerpt = pickLang(lang === "pl" ? f.excerpt_pl : f.excerpt_en, f.excerpt_pl);
  const cta = pickLang(lang === "pl" ? f.cta_pl : f.cta_en, f.cta_pl);
  const href = safeUrl(f.href ?? "#");
  const img = safeImageUrl(f.image ?? "");
  const aspectCls =
    f.aspectRatio === "16/9"
      ? "aspect-[16/9]"
      : f.aspectRatio === "4/3"
        ? "aspect-[4/3]"
        : f.aspectRatio === "1/1"
          ? "aspect-square"
          : f.aspectRatio === "3/4"
            ? "aspect-[3/4]"
            : "aspect-[16/10]";
  const placeholderStyle = f.placeholderColor ? { background: f.placeholderColor } : undefined;
  return (
    <AppLink
      href={href}
      className="block group rounded-lg overflow-hidden border border-border hover:border-brand transition"
    >
      {img && (
        <div className={`${aspectCls} overflow-hidden bg-muted relative`} style={placeholderStyle}>
          <img
            src={img}
            alt=""
            loading="lazy"
            decoding="async"
            sizes="(max-width: 768px) 90vw, 320px"
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            style={{ objectPosition: `${f.focalX}% ${f.focalY}%` }}
          />
        </div>
      )}
      <div className="p-3 space-y-1">
        {title && <div className="text-sm font-bold text-foreground leading-tight">{title}</div>}
        {excerpt && <div className="text-xs text-muted-foreground line-clamp-2">{excerpt}</div>}
        {cta && <div className="text-xs font-semibold text-brand pt-1">{cta} →</div>}
      </div>
    </AppLink>
  );
}

function toNum(v: unknown, fallback: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 50;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function MobileColumn({ col, lang }: { col: MegaMenuColumn; lang: MegaMenuLang }) {
  const title = pickLang(lang === "pl" ? col.title_pl : col.title_en, col.title_pl);
  const links = Array.isArray(col.links) ? col.links : [];
  return (
    <div className="space-y-1.5">
      {title && (
        <h4 className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground">
          {title}
        </h4>
      )}
      <ul className="space-y-0.5">
        {links.map((l, i) => {
          const label = pickLang(lang === "pl" ? l.label_pl : l.label_en, l.label_pl);
          const href = safeUrl(l.href ?? "#");
          if (!label) return null;
          return (
            <li key={i}>
              <AppLink
                href={href}
                className="block py-2 text-sm text-foreground hover:text-brand transition"
              >
                {label}
              </AppLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
