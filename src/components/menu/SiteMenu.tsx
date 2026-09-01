// SiteMenu - widget renderujący strukturę menu z admin/appearance/menu.
// Pobiera pozycje z publicznego query `menuWithItemsQueryOptions` (auto-sync).
// Wspiera:
//   - top-level jako linki lub triggery dropdown (gdy mają dzieci albo mega),
//   - zwykły dropdown (płaska lista dzieci),
//   - mega-panel (item.mega_enabled + mega_config.columns),
//   - wariant mobilny (accordion na <details>).
import { memo, useEffect, useId, useRef, useState } from "react";
import { useIsomorphicLayoutEffect } from "@/lib/react/useIsomorphicLayoutEffect";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "@/lib/lucide-shim";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { AppLink } from "@/components/atoms/AppLink";
import { useAuth } from "@/hooks/useAuth";
import { menuWithItemsQueryOptions } from "@/lib/menus/queries";
import { megaFeaturedPostQueryOptions } from "@/lib/menus/megaFeatured";
import { MegaPanelView } from "@/components/menu/MegaPanelView";
// Reguły menu (drzewo, etykiety, wariant panelu, źródło kolumn, geometria
// panelu) mieszkają w `lib/menus/siteMenu.ts` i mają tam własne asercje -
// ten plik jest kompozycją nagłówka, nie miejscem na logikę.
import {
  buildPublicMenuTree,
  filterMenuItemsForViewer,
  hasPanel,
  megaColumnsFor,
  megaPanelHasContent,
  menuItemHref as itemHref,
  menuItemRel,
  menuItemTarget as itemTarget,
  mobileMegaLinks,
  panelGeometry,
  panelKindFor,
  pickMenuLabel as pickLabel,
  type SiteMenuLang,
  type SiteMenuNode as TreeNode,
} from "@/lib/menus/siteMenu";

export type { SiteMenuLang };

interface Props {
  menuKey: string;
  lang: SiteMenuLang;
  mobile?: boolean;
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
  // Wariant panelu (link / dropdown / mega, razem z auto-promocją menu
  // zagnieżdżonego) rozstrzyga `panelKindFor` - patrz lib/menus/siteMenu.ts.
  if (panelKindFor(node) === "mega") {
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
          rel={menuItemRel(node)}
          className="group flex items-center gap-2 border-b border-border/50 bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/50"
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
      <ul className="menu-card-list flex flex-col gap-1 p-1.5">
        {parentLabel ? (
          <li>
            <AppLink
              href={itemHref(node)}
              target={itemTarget(node)}
              rel={menuItemRel(node)}
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
  const cols = megaColumnsFor(node);
  const featuredQuery = useQuery(
    megaFeaturedPostQueryOptions(node.mega_config.featured_post_id ?? null),
  );
  const featured = featuredQuery.data ?? null;

  if (!megaPanelHasContent(node)) return null;

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

/**
 * Pozycja płaskiej listy dropdownu.
 *
 * NIE MA tu gałęzi „pozycja z własnymi dziećmi" i nie może jej być: dropdown
 * renderuje się wyłącznie wtedy, gdy ŻADNE dziecko nie ma dzieci - inaczej
 * `panelKindFor` promuje całą pozycję do panelu redakcyjnego (mega), który
 * pokazuje drugi poziom jako kolumny. Do 18.08.2026 mieszkał tu drugi,
 * nieosiągalny wariant z własnym `useState` i zagnieżdżonym `<ul role="menu">`
 * wysuwanym w bok - martwy kod w chunku wejściowym KAŻDEJ strony.
 * Inwariant pilnuje `lib/menus/__tests__/siteMenu.test.ts`.
 */
function SubmenuItem({ node, lang }: { node: TreeNode; lang: SiteMenuLang }) {
  const label = pickLabel(node, lang);
  if (!label) return null;

  return (
    <li>
      <AppLink
        href={itemHref(node)}
        target={itemTarget(node)}
        rel={menuItemRel(node)}
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
        <ChevronRight size={13} aria-hidden className="menu-card-item__chevron" />
      </AppLink>
    </li>
  );
}

function DesktopItem({ node, lang }: { node: TreeNode; lang: SiteMenuLang }) {
  const withPanel = hasPanel(node);
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
  }, [open]);

  const updateAnchor = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchor({ top: r.bottom, left: r.left, width: r.width });
  };

  // Pomiar kotwicy zostaje w gałęzi LAYOUTOWEJ na kliencie (panel dostaje
  // współrzędne przed malowaniem, więc nie mruga w lewym górnym rogu), a w
  // renderze serwerowym schodzi do `useEffect`. Menu jedzie w SSR na każdej
  // stronie; `open` jest tam `false`, więc ciało i tak byłoby puste - ale
  // `getBoundingClientRect()` w efekcie layoutowym nie ma prawa zależeć od tego,
  // że React nie odpala efektów na serwerze. Wybór gałęzi jest tu NAPISANY.
  useIsomorphicLayoutEffect(() => {
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

  if (!withPanel) {
    return (
      <li className={node.css_class || undefined}>
        <AppLink
          href={itemHref(node)}
          target={itemTarget(node)}
          rel={menuItemRel(node)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded px-4 py-2.5 text-sm font-medium text-foreground/90 hover:text-foreground"
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
        className="inline-flex min-h-11 items-center gap-1.5 rounded px-4 py-2.5 text-sm font-medium text-foreground/90 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              // Arytmetyka siedzi w `panelGeometry` (lib/menus/siteMenu.ts).
              const { left: clampedLeft } = panelGeometry({
                isMega: panelKindFor(node) === "mega",
                anchorLeft: anchor.left,
                viewportWidth: typeof window !== "undefined" ? window.innerWidth : 1440,
              });
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
  const megaLinks = mobileMegaLinks(node, lang);
  const hasMega = megaLinks.length > 0;

  if (!hasChildren && !hasMega) {
    return (
      <li>
        <AppLink
          href={itemHref(node)}
          target={itemTarget(node)}
          className="flex min-h-11 items-center gap-2 px-3 py-2.5 text-sm font-medium"
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
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-medium">
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
              rel={menuItemRel(node)}
              className="flex min-h-11 items-center gap-2 px-3 py-2.5 text-sm font-semibold text-foreground transition-colors hover:text-brand"
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
                <AppLink
                  href={lnk.href}
                  className="block min-h-10 px-3 py-2.5 text-sm text-foreground/80"
                >
                  {lnk.label}
                </AppLink>
              </li>
            ) : null,
          )}
          <li className="border-t border-border/40 pt-1">
            <AppLink
              href={itemHref(node)}
              target={itemTarget(node)}
              rel={menuItemRel(node)}
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
  const { data, isPending } = useQuery(menuWithItemsQueryOptions(menuKey || "main"));
  // Widoczność per stan zalogowania (np. „Zarejestruj się" tylko dla gości).
  // Sesja na SSR i w PIERWSZYM renderze klienta jest `null`, więc znacznik
  // serwera zgadza się z hydratacją, a pozycje tylko-dla-zalogowanych
  // pojawiają się po rozwiązaniu sesji.
  const { session } = useAuth();
  const items = filterMenuItemsForViewer(data?.items ?? [], Boolean(session));
  const tree = buildPublicMenuTree(items);

  if (tree.length === 0) {
    // Dopóki zapytanie trwa (brak SSR-owego warm-upu, np. w podglądzie
    // buildera), pokazujemy szkielet o wysokości paska nawigacji zamiast
    // komunikatu "Menu jest puste" - ten pojawiał się na ułamek sekundy przy
    // każdym zimnym renderze i wyglądał jak błąd konfiguracji.
    if (isPending) {
      return (
        <div
          aria-hidden
          className={
            mobile
              ? "flex flex-col gap-2 px-3 py-2"
              : "flex flex-wrap items-center gap-2 px-1 py-2.5"
          }
        >
          {[72, 96, 64, 88, 80].map((w, i) => (
            <span
              key={i}
              className="block h-4 animate-pulse rounded bg-muted/60"
              style={{ width: mobile ? "100%" : w }}
            />
          ))}
        </div>
      );
    }
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
