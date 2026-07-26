// Table of Contents widget (3 warianty: list / grid / sidebar).
// Autoscan H2/H3 z bieżącej strony (data-cms-content lub main/article)
// z fallbackiem do manualnych pozycji zdefiniowanych w builderze.
// Responsywne: mobile = collapsible; desktop = pełny układ zgodny z wariantem.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, LayoutGrid, PanelLeft, ChevronDown, Menu as MenuIcon } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import type { WidgetContent } from "@/lib/builder/types";
import { getStr, getStrArr, type Lang } from "./frame";

type Variant = "list" | "grid" | "sidebar";

interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

interface Props {
  content: WidgetContent;
  lang: Lang;
}

const slugify = (input: string): string =>
  input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "section";

function ensureHeadingIds(container: HTMLElement, skipText: string): TocItem[] {
  const seen = new Set<string>();
  const nodes = container.querySelectorAll<HTMLElement>("h2, h3");
  const out: TocItem[] = [];
  const skip = skipText.trim().toLowerCase();
  nodes.forEach((node) => {
    if (node.closest("[data-widget-toc]")) return;
    const text = node.textContent?.trim() ?? "";
    if (!text) return;
    // Skip a duplicate "Spis treści" heading that mirrors the widget title.
    if (skip && text.toLowerCase() === skip) return;
    let id = node.id?.trim();
    if (!id) {
      id = slugify(text);
      let n = 1;
      while (seen.has(id) || document.getElementById(id)) {
        id = `${slugify(text)}-${++n}`;
      }
      node.id = id;
    }
    seen.add(id);
    out.push({ id, text, level: node.tagName === "H3" ? 3 : 2 });
  });
  return out;
}

function useTocItems(manual: TocItem[], skipText: string): TocItem[] {
  const [auto, setAuto] = useState<TocItem[]>([]);
  useEffect(() => {
    if (manual.length > 0) return;
    if (typeof document === "undefined") return;
    const scan = () => {
      const root =
        document.querySelector<HTMLElement>("[data-cms-content]") ||
        document.querySelector<HTMLElement>("main article") ||
        document.querySelector<HTMLElement>("main") ||
        document.body;
      if (!root) return;
      const items = ensureHeadingIds(root, skipText);
      setAuto(items);
    };
    const raf = requestAnimationFrame(scan);
    const t = window.setTimeout(scan, 400);
    const t2 = window.setTimeout(scan, 1200);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, [manual.length, skipText]);
  return manual.length > 0 ? manual : auto;
}

function useActiveHeading(items: TocItem[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (items.length === 0) return;
    const nodes = items
      .map((i) => document.getElementById(i.id))
      .filter((n): n is HTMLElement => !!n);
    if (nodes.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target?.id) setActive(visible.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [items]);
  return active;
}

function useReadingProgress(): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    const update = () => {
      const h = document.documentElement;
      const scrolled = h.scrollTop;
      const max = h.scrollHeight - h.clientHeight;
      setP(max > 0 ? Math.min(1, Math.max(0, scrolled / max)) : 0);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  return p;
}

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 96;
  window.scrollTo({ top, behavior: "smooth" });
  if (history.replaceState) history.replaceState(null, "", `#${id}`);
}

function parseManualItems(raw: string[]): TocItem[] {
  return raw
    .map((line) => {
      const t = line.trim();
      if (!t) return null;
      // Format opcjonalny: "#id | Tekst" lub "-- Tekst" (H3) lub "Tekst"
      const level: 2 | 3 = t.startsWith("--") ? 3 : 2;
      const clean = t.replace(/^--\s*/, "");
      const [maybeId, rest] = clean.split("|").map((s) => s.trim());
      if (rest) return { id: maybeId.replace(/^#/, "") || slugify(rest), text: rest, level };
      return { id: slugify(clean), text: clean, level };
    })
    .filter((x): x is TocItem => x !== null);
}

export function TocWidget({ content, lang }: Props) {
  const variant = (getStr(content, "variant") || "list") as Variant;
  const title =
    getStr(content, `title_${lang}`) ||
    getStr(content, "title_pl") ||
    (lang === "en" ? "Table of contents" : "Spis treści");
  const showNumbers = getStr(content, "showNumbers") !== "0";
  const showProgress = getStr(content, "showProgress") === "1";
  const sticky = getStr(content, "sticky") === "1";
  const manualRaw = getStrArr(content, `items_${lang}`).length
    ? getStrArr(content, `items_${lang}`)
    : getStrArr(content, "items_pl");
  const manual = useMemo(() => parseManualItems(manualRaw), [manualRaw]);
  const items = useTocItems(manual, title);
  const active = useActiveHeading(items);
  const progress = useReadingProgress();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const onClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    scrollToId(id);
    setOpen(false);
  }, []);

  if (items.length === 0) {
    return (
      <div
        data-widget-toc
        className="rounded-[6px] border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground"
      >
        {lang === "en" ? "No headings detected on this page." : "Brak nagłówków na tej stronie."}
      </div>
    );
  }

  const NumberBadge = ({ n, isActive }: { n: number; isActive: boolean }) => (
    <span
      className={cn(
        "flex-none inline-flex items-center justify-center rounded-[4px] w-7 h-7 text-[11px] font-bold tabular-nums shrink-0 transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "bg-primary/5 text-primary group-hover:bg-primary group-hover:text-primary-foreground",
      )}
      aria-hidden
    >
      {String(n).padStart(2, "0")}
    </span>
  );

  const renderList = () => (
    <nav aria-label={title} className="p-2">
      <ul className="flex flex-col gap-0.5">
        {items.map((it, i) => {
          const isActive = active === it.id;
          return (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                onClick={(e) => onClick(e, it.id)}
                className={cn(
                  "group flex items-start gap-3 px-3 py-2.5 text-[13px] leading-snug rounded-[6px] transition-all border-l-2",
                  it.level === 3 && "ml-6",
                  isActive
                    ? "bg-primary/5 text-primary border-primary font-semibold"
                    : "text-foreground border-transparent hover:bg-muted hover:text-primary hover:border-primary/60",
                )}
              >
                {showNumbers && it.level === 2 && (
                  <span className="font-bold text-primary tabular-nums text-[12px] mt-0.5">
                    {String(i + 1).padStart(2, "0")}.
                  </span>
                )}
                <span className={cn("min-w-0 flex-1", it.level === 3 && "text-muted-foreground")}>
                  {it.text}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  const renderGrid = () => (
    <nav
      aria-label={title}
      className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1"
    >
      {items.map((it, i) => {
        const isActive = active === it.id;
        return (
          <a
            key={it.id}
            href={`#${it.id}`}
            onClick={(e) => onClick(e, it.id)}
            className={cn(
              "group flex items-center gap-3 py-2.5 border-b border-transparent transition-all",
              isActive
                ? "border-primary/40 text-primary"
                : "hover:border-primary/20 text-foreground",
              it.level === 3 && "pl-6",
            )}
          >
            {showNumbers && <NumberBadge n={i + 1} isActive={isActive} />}
            <span
              className={cn(
                "text-[14px] font-medium min-w-0 flex-1 group-hover:text-primary transition-colors",
                isActive && "text-primary font-semibold",
                it.level === 3 && "text-muted-foreground text-[13px]",
              )}
            >
              {it.text}
            </span>
          </a>
        );
      })}
    </nav>
  );

  const renderSidebar = () => (
    <nav aria-label={title} className="p-2 max-h-[70vh] overflow-y-auto">
      <ul className="space-y-0.5">
        {items.map((it, i) => {
          const isActive = active === it.id;
          return (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                onClick={(e) => onClick(e, it.id)}
                className={cn(
                  "group flex items-center gap-3 px-3 py-2.5 rounded-[6px] transition-all",
                  isActive
                    ? "bg-primary/5 border border-primary/15"
                    : "border border-transparent hover:bg-muted/60",
                  it.level === 3 && "ml-6",
                )}
              >
                {showNumbers && it.level === 2 && (
                  <span
                    className={cn(
                      "flex-none w-6 text-[11px] font-semibold tabular-nums",
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground group-hover:text-primary",
                    )}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                )}
                <span
                  className={cn(
                    "text-[13px] min-w-0 flex-1 transition-colors",
                    isActive
                      ? "font-bold text-foreground"
                      : "font-medium text-foreground/80 group-hover:text-foreground",
                    it.level === 3 && "text-[12px] text-muted-foreground",
                  )}
                >
                  {it.text}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  const body =
    variant === "grid" ? renderGrid() : variant === "sidebar" ? renderSidebar() : renderList();

  const VariantIcon = variant === "grid" ? LayoutGrid : variant === "sidebar" ? PanelLeft : List;

  return (
    <div
      ref={ref}
      data-widget-toc
      data-variant={variant}
      className={cn(
        "w-full text-foreground",
        sticky && "lg:sticky lg:top-24",
      )}
    >
      {/* Mobile toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="lg:hidden w-full flex items-center justify-between gap-3 px-4 py-3 rounded-[6px] border border-border bg-background hover:bg-muted/60 transition-colors"
        aria-expanded={open}
        aria-controls="toc-body"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <MenuIcon className="w-4 h-4 text-primary" />
          {title}
          <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground bg-muted px-2 py-0.5 rounded-[4px] ml-1">
            {items.length}
          </span>
        </span>
        <ChevronDown
          className={cn("w-4 h-4 transition-transform", open && "rotate-180")}
        />
      </button>

      <div
        id="toc-body"
        className={cn(
          "rounded-[6px] border border-border bg-background overflow-hidden",
          "mt-2 lg:mt-0",
          !open && "hidden lg:block",
        )}
      >
        {/* Desktop header */}
        <div className="hidden lg:flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-1.5 h-6 bg-primary rounded-full shrink-0" aria-hidden />
            <h2 className="text-[15px] font-bold tracking-tight truncate">{title}</h2>
          </div>
          <span
            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-muted px-2 py-1 rounded-[4px] shrink-0"
            title={variant}
          >
            <VariantIcon className="w-3 h-3" />
            {items.length}
          </span>
        </div>

        {showProgress && (
          <div
            className="h-[3px] bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div
              className="h-full bg-primary transition-[width] duration-150 ease-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}

        {body}
      </div>
    </div>
  );
}
