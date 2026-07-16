// SiteMenu - widget renderujący strukturę menu z admin/appearance/menu.
// Pobiera pozycje z publicznego query `menuWithItemsQueryOptions` (auto-sync).
// Wspiera:
//   - top-level jako linki lub triggery dropdown (gdy mają dzieci albo mega),
//   - zwykły dropdown (płaska lista dzieci),
//   - mega-panel (item.mega_enabled + mega_config.columns),
//   - wariant mobilny (accordion na <details>).
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, ChevronRight } from "@/lib/lucide-shim";
import { AppLink } from "@/components/atoms/AppLink";
import { safeUrl } from "@/lib/sanitize";
import { menuWithItemsQueryOptions } from "@/lib/menus/queries";
import { megaFeaturedPostQueryOptions } from "@/lib/menus/megaFeatured";
import type { MenuItemRow } from "@/lib/menus/types";

export type SiteMenuLang = "pl" | "en";

interface Props {
  menuKey: string;
  lang: SiteMenuLang;
  mobile?: boolean;
}

interface TreeNode extends MenuItemRow {
  children: TreeNode[];
}

function pickLabel(item: MenuItemRow, lang: SiteMenuLang): string {
  const primary = lang === "en" ? item.label_en : item.label_pl;
  return (primary || item.label_pl || item.label_en || "").trim();
}

function buildTree(items: MenuItemRow[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const it of items) byId.set(it.id, { ...it, children: [] });
  const roots: TreeNode[] = [];
  for (const it of items) {
    const node = byId.get(it.id);
    if (!node) continue;
    if (it.parent_id && byId.has(it.parent_id)) {
      byId.get(it.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (arr: TreeNode[]) => {
    arr.sort((a, b) => a.position - b.position);
    for (const n of arr) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

function itemHref(item: MenuItemRow): string {
  return safeUrl(item.href || "#") || "#";
}

function itemTarget(item: MenuItemRow): "_self" | "_blank" {
  return item.target === "_blank" ? "_blank" : "_self";
}

/* -------------------------------- Desktop -------------------------------- */

function DropdownPanel({
  node,
  lang,
  onRequestClose,
}: {
  node: TreeNode;
  lang: SiteMenuLang;
  onRequestClose: () => void;
}) {
  // Auto-promote nested menus (top-level item whose children have their own
  // children) to the editorial mega layout, even if the admin did not tick
  // `mega_enabled`. A flat single-level dropdown keeps the compact list style.
  const hasNestedChildren =
    node.children.length > 0 && node.children.some((c) => c.children.length > 0);
  const useMega = node.mega_enabled || hasNestedChildren;
  if (useMega) {
    return <MegaPanel node={node} lang={lang} onRequestClose={onRequestClose} />;
  }
  return (
    <ul
      role="menu"
      className="min-w-[240px] rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
      onMouseLeave={onRequestClose}
    >
      {node.children.map((child) => (
        <SubmenuItem key={child.id} node={child} lang={lang} />
      ))}
    </ul>
  );
}

/* ------------------------------- Mega panel ------------------------------ */
// Redesigned editorial mega menu: wide white panel with 2 nav columns
// (uppercase eyebrow + accent bar, bold links, description subtitle) plus a
// featured/promoted column with the latest published post (cover, title,
// excerpt, eyebrow). Data-driven: admin-configured columns remain the source
// of truth; column count auto-adapts (2 nav cols + featured; ≥3 cols = full
// grid without featured).

interface MegaCol {
  title_pl: string;
  title_en: string;
  href: string;
  links: {
    label_pl: string;
    label_en: string;
    href: string;
  }[];
}

function pickLocalized(pl: string | null | undefined, en: string | null | undefined, lang: SiteMenuLang): string {
  return ((lang === "en" ? en : pl) || pl || en || "").trim();
}

function MegaPanel({
  node,
  lang,
  onRequestClose,
}: {
  node: TreeNode;
  lang: SiteMenuLang;
  onRequestClose: () => void;
}) {
  const cfg = node.mega_config;
  const configuredCols = cfg.columns ?? [];
  const cols: MegaCol[] =
    configuredCols.length > 0
      ? configuredCols.map((col) => ({
          title_pl: col.title_pl,
          title_en: col.title_en,
          href: col.href,
          links: col.links ?? [],
        }))
      : node.children.map((child) => ({
          title_pl: child.label_pl,
          title_en: child.label_en,
          href: child.href,
          links: child.children.map((gc) => ({
            label_pl: gc.label_pl,
            label_en: gc.label_en,
            href: gc.href,
          })),
        }));

  const featuredQuery = useQuery(megaFeaturedPostQueryOptions);
  const featured = featuredQuery.data ?? null;

  const showFeatured = cols.length <= 2 && !!featured;
  const gridCols = showFeatured ? 12 : Math.max(1, Math.min(cols.length, 4));

  if (cols.length === 0 && node.children.length === 0) return null;

  const eyebrowFallback = lang === "en" ? "Latest report" : "Najnowszy wpis";
  const readMore = lang === "en" ? "Read more" : "Czytaj więcej";
  const browseAll = lang === "en" ? "Browse all" : "Przejdź do sekcji";
  const parentLabel = pickLabel(node, lang);
  const featuredTitle = featured ? pickLocalized(featured.title_pl, featured.title_en, lang) : "";
  const featuredExcerpt = featured ? pickLocalized(featured.excerpt_pl, featured.excerpt_en, lang) : "";
  const featuredEyebrow = featured?.post_format
    ? featured.post_format.toString()
    : eyebrowFallback;

  return (
    <div
      role="menu"
      className="overflow-hidden rounded-md bg-popover text-popover-foreground shadow-2xl ring-1 ring-black/5 border border-border/40"
      style={{ width: "min(1120px, calc(100vw - 32px))" }}
      onMouseLeave={onRequestClose}
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
      >
        {/* Nav columns */}
        <div
          className={
            showFeatured
              ? "col-span-8 p-8 sm:p-10 grid gap-10 sm:gap-12"
              : "p-8 sm:p-10 grid gap-10 sm:gap-12"
          }
          style={
            showFeatured
              ? { gridTemplateColumns: `repeat(${Math.min(cols.length || 1, 2)}, minmax(0, 1fr))`, gridColumn: "span 8 / span 8" }
              : { gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`, gridColumn: `1 / -1` }
          }
        >
          {cols.map((col, i) => {
            const title = pickLocalized(col.title_pl, col.title_en, lang);
            return (
              <div key={i} className="flex min-w-0 flex-col">
                <div className="mb-6 flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-5 w-1 rounded-sm"
                    style={{ background: "var(--brand, var(--primary))" }}
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
                <ul className="flex flex-col gap-5">
                  {(col.links ?? []).map((lnk, j) => {
                    const label = pickLocalized(lnk.label_pl, lnk.label_en, lang);
                    if (!label) return null;
                    return (
                      <li key={j}>
                        <AppLink
                          href={safeUrl(lnk.href) || "#"}
                          className="group block"
                          role="menuitem"
                        >
                          <span
                            className="block text-[15px] font-bold leading-tight text-foreground transition-colors group-hover:text-[var(--brand, var(--primary))]"
                          >
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
                      className="group inline-flex items-center gap-1.5 text-xs font-bold text-[var(--brand, var(--primary))] hover:opacity-80"
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
            className="col-span-4 border-l border-border/60 bg-muted/40 p-8 sm:p-10"
            style={{ gridColumn: "span 4 / span 4" }}
          >
            <div className="mb-4">
              <span className="inline-block bg-[var(--brand, var(--primary))] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-white">
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
                <h4 className="mb-3 text-[17px] font-black leading-tight text-foreground transition-colors group-hover:text-[var(--brand, var(--primary))]">
                  {featuredTitle}
                </h4>
              ) : null}
              {featuredExcerpt ? (
                <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                  {featuredExcerpt}
                </p>
              ) : null}
              <div className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.15em]">
                <span className="text-[var(--brand, var(--primary))]">{featuredEyebrow}</span>
                <span className="opacity-30">|</span>
                <span className="text-muted-foreground">{readMore}</span>
                <ArrowRight
                  size={12}
                  className="text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </div>
            </AppLink>
            {parentLabel ? (
              <div className="mt-6 border-t border-border/60 pt-4">
                <AppLink
                  href={itemHref(node)}
                  className="group inline-flex items-center gap-1.5 text-xs font-bold text-[var(--brand, var(--primary))] hover:opacity-80"
                >
                  {lang === "en" ? `All in ${parentLabel}` : `Wszystko w: ${parentLabel}`}
                  <ArrowRight
                    size={14}
                    className="transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </AppLink>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// silence unused import warning when useMemo isn't referenced (kept for future extensions)
void useMemo;

function SubmenuItem({ node, lang }: { node: TreeNode; lang: SiteMenuLang }) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;
  const label = pickLabel(node, lang);
  if (!label) return null;

  if (!hasChildren) {
    return (
      <li>
        <AppLink
          href={itemHref(node)}
          target={itemTarget(node)}
          rel={itemTarget(node) === "_blank" ? "noopener noreferrer" : undefined}
          className="block rounded px-3 py-2 text-sm hover:bg-muted"
          role="menuitem"
        >
          {label}
        </AppLink>
      </li>
    );
  }

  return (
    <li
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div className="flex items-center justify-between rounded px-3 py-2 text-sm hover:bg-muted">
        <AppLink
          href={itemHref(node)}
          target={itemTarget(node)}
          rel={itemTarget(node) === "_blank" ? "noopener noreferrer" : undefined}
          className="flex-1"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {label}
        </AppLink>
        <ChevronRight size={14} aria-hidden className="text-muted-foreground" />
      </div>
      {open ? (
        <ul
          role="menu"
          className="absolute left-full top-0 z-50 ml-1 min-w-[220px] rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {node.children.map((child) => (
            <SubmenuItem key={child.id} node={child} lang={lang} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function DesktopItem({ node, lang }: { node: TreeNode; lang: SiteMenuLang }) {
  const hasPanel = node.mega_enabled || node.children.length > 0;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLLIElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScrollOrResize = () => updateAnchor();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updateAnchor = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchor({ top: r.bottom, left: r.left, width: r.width });
  };

  useLayoutEffect(() => {
    if (open) updateAnchor();
  }, [open]);

  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const label = pickLabel(node, lang);
  if (!label) return null;

  if (!hasPanel) {
    return (
      <li className={node.css_class || undefined}>
        <AppLink
          href={itemHref(node)}
          target={itemTarget(node)}
          rel={itemTarget(node) === "_blank" ? "noopener noreferrer" : undefined}
          className="inline-flex items-center gap-1 rounded px-3 py-2 text-sm font-medium text-foreground/90 hover:text-foreground"
        >
          {label}
        </AppLink>
      </li>
    );
  }

  return (
    <li
      ref={wrapRef}
      className={`relative ${node.css_class ?? ""}`}
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded px-3 py-2 text-sm font-medium text-foreground/90 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <ChevronDown
          size={14}
          aria-hidden
          className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {mounted && open && anchor
        ? createPortal(
            (() => {
              // Mega panels are wide (~1120px). Clamp the panel horizontally so
              // it never overflows the viewport regardless of which top-level
              // item was hovered.
              const hasNested =
                node.children.length > 0 && node.children.some((c) => c.children.length > 0);
              const isMega = node.mega_enabled || hasNested;
              const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
              const panelWidth = isMega ? Math.min(1120, vw - 32) : 260;
              const rawLeft = anchor.left;
              const clampedLeft = Math.max(
                16,
                Math.min(rawLeft, vw - panelWidth - 16),
              );
              return (
                <div
                  ref={panelRef}
                  id={panelId}
                  onMouseEnter={cancelClose}
                  onMouseLeave={scheduleClose}
                  style={{
                    position: "fixed",
                    top: anchor.top + 8,
                    left: clampedLeft,
                    zIndex: 60,
                    opacity: visible ? 1 : 0,
                    transform: visible ? "translateY(0)" : "translateY(-6px)",
                    transition: "opacity 180ms ease-out, transform 180ms ease-out",
                    pointerEvents: visible ? "auto" : "none",
                    willChange: "opacity, transform",
                  }}
                  aria-hidden={!open}
                >
                  <DropdownPanel node={node} lang={lang} onRequestClose={scheduleClose} />
                </div>
              );
            })(),
            document.body,
          )
        : null}
    </li>
  );
}

/* --------------------------------- Mobile -------------------------------- */

function MobileItem({ node, lang }: { node: TreeNode; lang: SiteMenuLang }) {
  const label = pickLabel(node, lang);
  if (!label) return null;
  const hasChildren = node.children.length > 0;
  const megaLinks =
    node.mega_enabled && (node.mega_config.columns ?? []).length > 0
      ? (node.mega_config.columns ?? []).flatMap((col) =>
          (col.links ?? []).map((lnk) => ({
            label:
              (lang === "en" ? lnk.label_en : lnk.label_pl) ||
              lnk.label_pl ||
              "",
            href: safeUrl(lnk.href) || "#",
          })),
        )
      : [];
  const hasMega = megaLinks.length > 0;

  if (!hasChildren && !hasMega) {
    return (
      <li>
        <AppLink
          href={itemHref(node)}
          target={itemTarget(node)}
          className="block px-3 py-2 text-sm font-medium"
        >
          {label}
        </AppLink>
      </li>
    );
  }
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium">
          {label}
          <ChevronDown
            size={14}
            className="transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <ul className="pl-4">
          {node.children.map((child) => (
            <MobileItem key={child.id} node={child} lang={lang} />
          ))}
          {megaLinks.map((lnk, i) =>
            lnk.label ? (
              <li key={`m-${i}`}>
                <AppLink href={lnk.href} className="block px-3 py-2 text-sm text-foreground/80">
                  {lnk.label}
                </AppLink>
              </li>
            ) : null,
          )}
        </ul>
      </details>
    </li>
  );
}

/* -------------------------------- Component ------------------------------ */

function SiteMenuImpl({ menuKey, lang, mobile }: Props) {
  const { data } = useQuery(menuWithItemsQueryOptions(menuKey || "main"));
  const items = data?.items ?? [];
  const tree = buildTree(items);

  if (tree.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        {lang === "en"
          ? "Menu is empty. Configure it in Admin → Appearance → Menu."
          : "Menu jest puste. Skonfiguruj je w Admin → Wygląd → Menu."}
      </div>
    );
  }

  if (mobile) {
    return (
      <nav aria-label={lang === "en" ? "Primary navigation" : "Nawigacja główna"}>
        <ul className="flex flex-col">
          {tree.map((n) => (
            <MobileItem key={n.id} node={n} lang={lang} />
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label={lang === "en" ? "Primary navigation" : "Nawigacja główna"}>
      <ul className="flex flex-wrap items-center gap-1">
        {tree.map((n) => (
          <DesktopItem key={n.id} node={n} lang={lang} />
        ))}
      </ul>
    </nav>
  );
}

export const SiteMenu = memo(SiteMenuImpl);
