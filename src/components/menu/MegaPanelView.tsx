// Wspólny widok panelu mega-menu (editorial layout).
// Używany na froncie (SiteMenu) i w podglądzie admina (MenuManager), żeby
// oba miejsca wyglądały 1:1 - jeden komponent, jeden design system.
import { ArrowRight } from "@/lib/lucide-shim";
import { AppLink } from "@/components/atoms/AppLink";
import { safeUrl } from "@/lib/sanitize";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import type { MegaColumn } from "@/lib/menus/types";
import type { MegaFeaturedPost } from "@/lib/menus/megaFeatured";

export type MegaViewLang = "pl" | "en";

function pickLocalized(
  pl: string | null | undefined,
  en: string | null | undefined,
  lang: MegaViewLang,
): string {
  return ((lang === "en" ? en : pl) || pl || en || "").trim();
}

interface Props {
  cols: MegaColumn[];
  lang: MegaViewLang;
  parentLabel?: string;
  parentHref?: string;
  featured?: MegaFeaturedPost | null;
  /** "live" - anchored panel on the site; "preview" - inline card in admin. */
  variant?: "live" | "preview";
  onMouseLeave?: () => void;
}

export function MegaPanelView({
  cols,
  lang,
  parentLabel,
  parentHref,
  featured,
  variant = "live",
  onMouseLeave,
}: Props) {
  const showFeatured = cols.length <= 2 && !!featured;
  const gridCols = showFeatured ? 12 : Math.max(1, Math.min(cols.length, 4));

  if (cols.length === 0) return null;

  const eyebrowFallback = lang === "en" ? "Featured" : "Wyróżniony wpis";
  const readMore = lang === "en" ? "Read more" : "Czytaj więcej";
  const browseAll = lang === "en" ? "Browse all" : "Przejdź do sekcji";
  const goToPage = lang === "en" ? "Go to page" : "Przejdź do strony";
  const featuredTitle = featured ? pickLocalized(featured.title_pl, featured.title_en, lang) : "";
  const featuredExcerpt = featured
    ? pickLocalized(featured.excerpt_pl, featured.excerpt_en, lang)
    : "";
  const featuredEyebrow = featured?.post_format ? featured.post_format.toString() : eyebrowFallback;

  const authorLabel = lang === "en" ? "By" : "Autor";
  const unknownAuthor = lang === "en" ? "Unknown author" : "Nieznany autor";
  const authorName = (f: MegaFeaturedPost): string =>
    (f.author_display_name || "").trim() || unknownAuthor;
  const authorInitials = (name: string): string => {
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return (first + last).toUpperCase() || "?";
  };

  const containerClass =
    variant === "live"
      ? "overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-2xl ring-1 ring-black/5 border border-border/40 mx-auto"
      : "overflow-hidden rounded-lg bg-background text-foreground ring-1 ring-border/60";

  return (
    <div
      role="menu"
      className={containerClass}
      style={variant === "live" ? { width: "min(1120px, calc(100vw - 32px))" } : undefined}
      onMouseLeave={onMouseLeave}
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
        {/* Nav columns */}
        <div
          className="p-8 sm:p-10 grid gap-10 sm:gap-12"
          style={
            showFeatured
              ? {
                  gridTemplateColumns: `repeat(${Math.min(cols.length || 1, 2)}, minmax(0, 1fr))`,
                  gridColumn: "span 8 / span 8",
                }
              : { gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`, gridColumn: "1 / -1" }
          }
        >
          {parentLabel && parentHref ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <AppLink
                href={safeUrl(parentHref) || "#"}
                className="group inline-flex items-center gap-2 text-xs font-bold text-brand hover:opacity-80"
              >
                <span className="text-muted-foreground">{goToPage}:</span>
                <span className="font-black uppercase tracking-[0.12em]">{parentLabel}</span>
                <ArrowRight
                  size={14}
                  className="transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </AppLink>
            </div>
          ) : null}
          {cols.map((col, i) => {
            const title = pickLocalized(col.title_pl, col.title_en, lang);
            return (
              <div key={i} className="flex min-w-0 flex-col">
                <div className="mb-6 flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-5 w-1 rounded-sm"
                    style={{ background: "var(--brand)" }}
                  />
                  {title ? (
                    col.href ? (
                      <AppLink
                        href={safeUrl(col.href) || "#"}
                        className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {title}
                      </AppLink>
                    ) : (
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                        {title}
                      </span>
                    )
                  ) : null}
                </div>
                <ul className="flex flex-col gap-4">
                  {(col.links ?? []).map((lnk, j) => {
                    const label = pickLocalized(lnk.label_pl, lnk.label_en, lang);
                    if (!label) return null;
                    return (
                      <li key={j}>
                        <AppLink
                          href={safeUrl(lnk.href) || "#"}
                          className="group flex items-center gap-3"
                          role="menuitem"
                        >
                          {lnk.icon ? (
                            <span
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground ring-1 ring-border/60 transition-colors group-hover:bg-brand/10 group-hover:text-brand group-hover:ring-brand/30"
                              aria-hidden
                            >
                              <DynamicIcon name={lnk.icon} size={16} strokeWidth={1.75} />
                            </span>
                          ) : null}
                          <span className="block text-[15px] font-normal leading-tight text-foreground transition-colors group-hover:text-brand">
                            {label}
                          </span>
                        </AppLink>
                      </li>
                    );
                  })}
                </ul>
                {col.href ? (
                  <div className="mt-8 border-t border-border/60 pt-5">
                    <AppLink
                      href={safeUrl(col.href) || "#"}
                      className="group inline-flex items-center gap-1.5 text-xs font-bold text-brand hover:opacity-80"
                    >
                      {browseAll}
                      <ArrowRight
                        size={14}
                        className="transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </AppLink>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Featured column */}
        {showFeatured && featured ? (
          <div
            className="border-l border-border/60 bg-muted/40 p-8 sm:p-10"
            style={{ gridColumn: "span 4 / span 4" }}
          >
            <div className="mb-4">
              <span className="inline-block bg-brand px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-white">
                {eyebrowFallback}
              </span>
            </div>
            <AppLink
              href={safeUrl(`/${featured.slug}`) || "#"}
              className="group block"
              role="menuitem"
            >
              {featured.cover_image_url ? (
                <div className="mb-5 aspect-[16/9] w-full overflow-hidden rounded-sm ring-1 ring-border/60 shadow-sm">
                  <img
                    src={featured.cover_image_url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                </div>
              ) : null}
              {featuredTitle ? (
                <h4 className="mb-1 text-[17px] font-black leading-tight text-foreground transition-colors group-hover:text-brand">
                  {featuredTitle}
                </h4>
              ) : null}
            </AppLink>
            {featured.author_id
              ? (() => {
                  const name = authorName(featured);
                  const href = featured.author_slug
                    ? safeUrl(`/author/${featured.author_slug}`)
                    : null;
                  const avatarNode = featured.author_avatar_url ? (
                    <img
                      src={featured.author_avatar_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-7 w-7 rounded-[6px] object-cover ring-1 ring-border/60"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-muted text-[10px] font-black uppercase tracking-wider text-muted-foreground ring-1 ring-border/60"
                    >
                      {authorInitials(name)}
                    </span>
                  );
                  const textNode = (
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground">
                        {authorLabel}
                      </span>
                      <span className="truncate text-[13px] font-bold text-foreground">{name}</span>
                    </span>
                  );
                  return href ? (
                    <AppLink
                      href={href}
                      className="mt-3 flex items-center gap-2.5 group/author"
                      role="menuitem"
                    >
                      {avatarNode}
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground">
                          {authorLabel}
                        </span>
                        <span className="truncate text-[13px] font-bold text-foreground transition-colors group-hover/author:text-brand">
                          {name}
                        </span>
                      </span>
                    </AppLink>
                  ) : (
                    <div className="mt-3 flex items-center gap-2.5">
                      {avatarNode}
                      {textNode}
                    </div>
                  );
                })()
              : null}
            <AppLink href={safeUrl(`/${featured.slug}`) || "#"} className="group block">
              {featuredExcerpt ? (
                <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                  {featuredExcerpt}
                </p>
              ) : null}
              <div className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.15em]">
                <span className="text-brand">{featuredEyebrow}</span>
                <span className="opacity-30">|</span>
                <span className="text-muted-foreground">{readMore}</span>
                <ArrowRight
                  size={12}
                  className="text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </div>
            </AppLink>
          </div>
        ) : null}
      </div>
      {parentLabel && parentHref ? (
        <div className="border-t border-border/60 bg-muted/30 px-6 py-3.5 sm:px-8 sm:py-4">
          <AppLink
            href={safeUrl(parentHref) || "#"}
            className="group inline-flex items-center gap-2 text-xs font-bold text-brand hover:opacity-80"
          >
            <span className="text-muted-foreground">{goToPage}:</span>
            <span className="font-black uppercase tracking-[0.12em]">{parentLabel}</span>
            <ArrowRight
              size={14}
              className="transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </AppLink>
        </div>
      ) : null}
    </div>
  );
}
