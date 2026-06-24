// Mega menu - desktop hover/click dropdown panel + mobile accordion.
// Used by the builder widget "mega-menu". Fully i18n (pl/en), keyboard-
// accessible, theme-aware (semantic tokens only).
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "@/lib/lucide-shim";
import { safeUrl, safeImageUrl } from "@/lib/sanitize";

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

export interface MegaMenuColumn {
  title_pl?: string;
  title_en?: string;
  links?: MegaMenuLink[];
  featured?: MegaMenuFeatured | null;
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

export function MegaMenu({ config, lang, mobile = false }: Props) {
  const trigger = pickLang(
    lang === "pl" ? config.trigger_pl : config.trigger_en,
    config.trigger_pl,
  ) || (lang === "pl" ? "Menu" : "Menu");
  const triggerHref = safeUrl(config.href ?? "");
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
            <a href={triggerHref} className="hover:text-brand transition flex-1">{trigger}</a>
          ) : (
            <span className="flex-1">{trigger}</span>
          )}
          <ChevronDown className="w-4 h-4 transition-transform group-open/mega:rotate-180" />
        </summary>
        <div className="pb-4 space-y-4">
          {columns.map((col, i) => <MobileColumn key={i} col={col} lang={lang} />)}
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
    config.width === "fluid" ? "left-0 right-0 w-screen max-w-[100vw]"
    : config.width === "fixed" ? ""
    : "left-1/2 -translate-x-1/2 w-[min(1140px,calc(100vw-32px))]";
  const widthStyle = config.width === "fixed" && config.widthPx && config.widthPx > 200
    ? { width: `${config.widthPx}px`, left: "50%", transform: "translateX(-50%)" }
    : undefined;

  return (
    <div
      ref={wrapRef}
      className="relative inline-flex items-stretch"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1.5 h-10 px-1 text-xs font-bold tracking-wider uppercase leading-none text-foreground hover:opacity-80 transition"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (triggerOn === "click") setOpen((v) => !v);
          else if (triggerHref) window.location.assign(triggerHref);
        }}
      >
        {trigger}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && columns.length > 0 && (
        <div
          id={panelId}
          role="menu"
          className={`absolute top-full mt-2 z-50 ${widthCls} bg-background border border-border rounded-xl shadow-xl p-6`}
          style={widthStyle}
        >
          <div
            className="grid gap-6"
            style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(columns.length, 1), 5)}, minmax(0, 1fr))` }}
          >
            {columns.map((col, i) => <DesktopColumn key={i} col={col} lang={lang} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function DesktopColumn({ col, lang }: { col: MegaMenuColumn; lang: MegaMenuLang }) {
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
                <a
                  href={href}
                  className="block rounded-md px-2 py-1.5 -mx-2 hover:bg-muted transition"
                >
                  <span className="block text-sm font-medium text-foreground leading-tight">{label}</span>
                  {desc && (
                    <span className="block text-xs text-muted-foreground mt-0.5">{desc}</span>
                  )}
                </a>
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

function FeaturedCard({ featured, lang }: { featured: MegaMenuFeatured; lang: MegaMenuLang }) {
  const title = pickLang(lang === "pl" ? featured.title_pl : featured.title_en, featured.title_pl);
  const excerpt = pickLang(lang === "pl" ? featured.excerpt_pl : featured.excerpt_en, featured.excerpt_pl);
  const cta = pickLang(lang === "pl" ? featured.cta_pl : featured.cta_en, featured.cta_pl);
  const href = safeUrl(featured.href ?? "#");
  const img = safeImageUrl(featured.image ?? "");
  return (
    <a href={href} className="block group rounded-lg overflow-hidden border border-border hover:border-brand transition">
      {img && (
        <div className="aspect-[16/10] overflow-hidden bg-muted">
          {/* Decorative; copy carries semantics. */}
          <img src={img} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        </div>
      )}
      <div className="p-3 space-y-1">
        {title && <div className="text-sm font-bold text-foreground leading-tight">{title}</div>}
        {excerpt && <div className="text-xs text-muted-foreground line-clamp-2">{excerpt}</div>}
        {cta && (
          <div className="text-xs font-semibold text-brand pt-1">
            {cta} →
          </div>
        )}
      </div>
    </a>
  );
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
              <a href={href} className="block py-2 text-sm text-foreground hover:text-brand transition">
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
