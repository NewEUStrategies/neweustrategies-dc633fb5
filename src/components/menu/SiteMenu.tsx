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
import { AppLink } from "@/components/atoms/AppLink";
import { safeUrl } from "@/lib/sanitize";
import { menuWithItemsQueryOptions } from "@/lib/menus/queries";
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
  if (node.mega_enabled) {
    const cfg = node.mega_config;
    const configuredCols = cfg.columns ?? [];
    // Fallback: gdy admin włączył mega ale nie skonfigurował kolumn,
    // budujemy je z dzieci elementu (każde dziecko = kolumna, wnuki = linki).
    const cols =
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
    if (cols.length === 0 && node.children.length === 0) return null;
    const width = cfg.width === "full" ? "100vw" : "min(1140px, calc(100vw - 32px))";
    const cpr = Math.max(1, Math.min(cfg.columns_per_row ?? Math.min(cols.length || 1, 4), 6));
    return (
      <div
        role="menu"
        className="rounded-md border bg-popover p-4 text-popover-foreground shadow-lg"
        style={{ width }}
        onMouseLeave={onRequestClose}
      >
        <div
          className="grid gap-6"
          style={{ gridTemplateColumns: `repeat(${cpr}, minmax(0, 1fr))` }}
        >
          {cols.map((col, i) => {
            const title = (lang === "en" ? col.title_en : col.title_pl) || col.title_pl;
            return (
              <div key={i} className="flex flex-col gap-2">
                {title ? (
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {col.href ? (
                      <AppLink href={safeUrl(col.href) || "#"} className="hover:text-foreground">
                        {title}
                      </AppLink>
                    ) : (
                      title
                    )}
                  </div>
                ) : null}
                <ul className="flex flex-col gap-1.5">
                  {(col.links ?? []).map((lnk, j) => {
                    const label =
                      (lang === "en" ? lnk.label_en : lnk.label_pl) || lnk.label_pl;
                    if (!label) return null;
                    return (
                      <li key={j}>
                        <AppLink
                          href={safeUrl(lnk.href) || "#"}
                          className="text-sm text-foreground/80 hover:text-foreground"
                          role="menuitem"
                        >
                          {label}
                        </AppLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    );
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
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLLIElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
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
      <div
        id={panelId}
        onMouseEnter={cancelClose}
        className={`transition-[opacity,margin] duration-150 ease-in-out ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!open}
      >
        {open ? (
          <DropdownPanel node={node} lang={lang} onRequestClose={scheduleClose} />
        ) : null}
      </div>
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
