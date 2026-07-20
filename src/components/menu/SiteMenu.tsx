// SiteMenu - widget renderujący strukturę menu z admin/appearance/menu.
// Pobiera pozycje z publicznego query `menuWithItemsQueryOptions` (auto-sync).
// Wspiera:
//   - top-level jako linki lub triggery dropdown (gdy mają dzieci albo mega),
//   - zwykły dropdown (płaska lista dzieci),
//   - mega-panel (item.mega_enabled + mega_config.columns),
//   - wariant mobilny (accordion na <details>).
import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "@/lib/lucide-shim";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { AppLink } from "@/components/atoms/AppLink";
import { safeUrl } from "@/lib/sanitize";
import { menuWithItemsQueryOptions } from "@/lib/menus/queries";
import { megaFeaturedPostQueryOptions } from "@/lib/menus/megaFeatured";
import { MegaPanelView } from "@/components/menu/MegaPanelView";
import type { MegaColumn } from "@/lib/menus/types";
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
  const parentLabel = pickLabel(node, lang);
  const eyebrow = lang === "en" ? "In section" : "W sekcji";
  const sectionHome = lang === "en" ? "Section home" : "Strona sekcji";
  return (
    <div
      role="menu"
      className="menu-card overflow-hidden rounded-md border border-border/50 bg-popover text-popover-foreground shadow-2xl ring-1 ring-black/5"
      style={{ width: "min(320px, calc(100vw - 32px))" }}
      onMouseLeave={onRequestClose}
    >
      {parentLabel ? (
        <AppLink
          href={itemHref(node)}
          target={itemTarget(node)}
          rel={itemTarget(node) === "_blank" ? "noopener noreferrer" : undefined}
          className="group flex items-center gap-2 border-b border-border/50 bg-muted/30 px-4 py-2.5 transition-colors hover:bg-muted/50"
        >
          <span
            aria-hidden
            className="inline-block h-3.5 w-[3px] rounded-sm"
            style={{ background: "var(--brand)" }}
          />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
            {eyebrow}
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/80 transition-colors group-hover:text-brand">
            {parentLabel}
          </span>
          <ChevronRight
            size={12}
            aria-hidden
            className="ml-auto text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
          />
        </AppLink>
      ) : null}
      <ul className="menu-card-list flex flex-col gap-1 p-2">
        {parentLabel ? (
          <li>
            <AppLink
              href={itemHref(node)}
              target={itemTarget(node)}
              rel={itemTarget(node) === "_blank" ? "noopener noreferrer" : undefined}
              className="menu-card-item menu-card-item--primary group"
              role="menuitem"
            >
              <span aria-hidden className="menu-card-item__icon menu-card-item__icon--primary">
                <ChevronRight size={13} strokeWidth={2} />
              </span>
              <span className="menu-card-item__label">{parentLabel}</span>
              <span className="menu-card-item__badge">{sectionHome}</span>
            </AppLink>
          </li>
        ) : null}

        {node.children.map((child) => (
          <SubmenuItem key={child.id} node={child} lang={lang} />
        ))}
      </ul>
    </div>
  );
}


/* ------------------------------- Mega panel ------------------------------ */
// Redesigned editorial mega menu (see MegaPanelView). Ten wrapper wybiera
// źródło kolumn (admin lub auto-derived z drzewa dzieci), pobiera featured
// wpis (per-config lub najnowszy) i przekazuje do wspólnego widoku.

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
  const cols: MegaColumn[] =
    configuredCols.length > 0
      ? configuredCols.map((col) => ({
          title_pl: col.title_pl,
          title_en: col.title_en,
          href: col.href,
          links: (col.links ?? []).map((l) => ({
            label_pl: l.label_pl,
            label_en: l.label_en,
            href: l.href,
            icon: l.icon ?? "",
          })),
        }))
      : node.children.map((child) => ({
          title_pl: child.label_pl,
          title_en: child.label_en,
          href: child.href,
          links: child.children.map((gc) => ({
            label_pl: gc.label_pl,
            label_en: gc.label_en,
            href: gc.href,
            icon: "",
          })),
        }));

  const featuredQuery = useQuery(megaFeaturedPostQueryOptions(cfg.featured_post_id ?? null));
  const featured = featuredQuery.data ?? null;

  if (cols.length === 0 && node.children.length === 0) return null;

  return (
    <MegaPanelView
      cols={cols}
      lang={lang}
      parentLabel={pickLabel(node, lang)}
      parentHref={itemHref(node)}
      featured={featured}
      variant="live"
      onMouseLeave={onRequestClose}
    />
  );
}

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
          className="menu-card-item group"
          role="menuitem"
        >
          <span aria-hidden className="menu-card-item__icon">
            {node.icon ? (
              <DynamicIcon name={node.icon} size={14} strokeWidth={1.75} />
            ) : (
              <ChevronRight size={13} strokeWidth={2} />
            )}
          </span>
          <span className="menu-card-item__label">{label}</span>
          <ChevronRight
            size={13}
            aria-hidden
            className="menu-card-item__chevron"
          />
        </AppLink>
      </li>
    );
  }


  return (
    <li className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <AppLink
        href={itemHref(node)}
        target={itemTarget(node)}
        rel={itemTarget(node) === "_blank" ? "noopener noreferrer" : undefined}
        className="menu-card-item group"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span aria-hidden className="menu-card-item__icon">
          {node.icon ? (
            <DynamicIcon name={node.icon} size={14} strokeWidth={1.75} />
          ) : (
            <ChevronRight size={13} strokeWidth={2} />
          )}
        </span>
        <span className="menu-card-item__label">{label}</span>
        <ChevronRight size={13} aria-hidden className="menu-card-item__chevron" />
      </AppLink>
      {open ? (
        <ul
          role="menu"
          className="menu-card-list absolute left-full top-0 z-50 ml-2 flex min-w-[240px] flex-col gap-1 rounded-md border border-border/50 bg-popover p-2 text-popover-foreground shadow-2xl ring-1 ring-black/5"
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
          className="inline-flex items-center gap-1.5 rounded px-3 py-2 text-sm font-medium text-foreground/90 hover:text-foreground"
        >
          {node.icon ? (
            <DynamicIcon name={node.icon} size={14} strokeWidth={1.75} aria-hidden />
          ) : null}
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
        className="inline-flex items-center gap-1.5 rounded px-3 py-2 text-sm font-medium text-foreground/90 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {node.icon ? (
          <DynamicIcon name={node.icon} size={14} strokeWidth={1.75} aria-hidden />
        ) : null}
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
              // Mega panels: wyśrodkuj poziomo względem viewportu.
              // Zwykłe dropdowny: dokotwicz do triggera z clampem do krawędzi.
              const hasNested =
                node.children.length > 0 && node.children.some((c) => c.children.length > 0);
              const isMega = node.mega_enabled || hasNested;
              const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
              const panelWidth = isMega ? Math.min(1120, vw - 32) : Math.min(360, vw - 32);
              const clampedLeft = isMega
                ? Math.round((vw - panelWidth) / 2)
                : Math.max(16, Math.min(anchor.left, vw - panelWidth - 16));
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
  const goToPage = lang === "en" ? "Go to page" : "Przejdź do strony";
  if (!label) return null;
  const hasChildren = node.children.length > 0;
  const megaLinks =
    node.mega_enabled && (node.mega_config.columns ?? []).length > 0
      ? (node.mega_config.columns ?? []).flatMap((col) =>
          (col.links ?? []).map((lnk) => ({
            label: (lang === "en" ? lnk.label_en : lnk.label_pl) || lnk.label_pl || "",
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
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium"
        >
          {node.icon ? (
            <DynamicIcon name={node.icon} size={14} strokeWidth={1.75} aria-hidden />
          ) : null}
          {label}
        </AppLink>
      </li>
    );
  }
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium">
          <span className="flex items-center gap-2">
            {node.icon ? (
              <DynamicIcon name={node.icon} size={14} strokeWidth={1.75} aria-hidden />
            ) : null}
            {label}
          </span>
          <ChevronDown
            size={14}
            className="transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <ul className="pl-4">
          <li>
            <AppLink
              href={itemHref(node)}
              target={itemTarget(node)}
              rel={itemTarget(node) === "_blank" ? "noopener noreferrer" : undefined}
              className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:text-brand"
            >
              {node.icon ? (
                <DynamicIcon name={node.icon} size={14} strokeWidth={1.75} aria-hidden />
              ) : null}
              {label}
            </AppLink>
          </li>
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
          <li className="border-t border-border/40 pt-1">
            <AppLink
              href={itemHref(node)}
              target={itemTarget(node)}
              rel={itemTarget(node) === "_blank" ? "noopener noreferrer" : undefined}
              className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-brand"
            >
              {goToPage}: <span className="font-black uppercase tracking-[0.08em]">{label}</span>
              <ChevronRight size={14} aria-hidden />
            </AppLink>
          </li>
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
