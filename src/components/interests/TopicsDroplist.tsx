// Wspólna droplista tematów (zainteresowań) dla WSZYSTKICH widgetów
// newslettera - "Dołącz do nas", widget "Newsletter", popup zapisu.
// Zawiera: pigułki wybranych, przycisk z placeholderem, portalowany popup z
// zakładkami grup, licznikiem i stopką (Wyczyść / Gotowe) oraz alternatywny
// tryb "chips". Jedno źródło prawdy = identyczny wygląd i teksty wszędzie.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useInterestCatalog, type InterestItem } from "@/hooks/useInterests";
import { topicLabel, topicsTriggerText } from "@/lib/newsletter/newsletterFieldLabels";

export interface InterestGroup {
  key: string;
  title: string;
  items: InterestItem[];
  parentSlug: string | null;
}

/**
 * Katalog zainteresowań pogrupowany po obszarach: kategorie-dzieci trafiają pod
 * etykietę rodzica (Region, Specjalizacja...), top-level pod "Obszary", a tagi
 * do grupy "Tematy". Ta sama struktura zasila droplistę i chipsy.
 */
export function useInterestGroups(lang: "pl" | "en", interestSlugs?: string[] | null) {
  const catalog = useInterestCatalog(lang);

  const allItems = useMemo<InterestItem[]>(() => {
    const cats = catalog.data?.categories ?? [];
    const tags = catalog.data?.tags ?? [];
    const all = [...cats, ...tags];
    const allow = (interestSlugs ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!allow.length) return all;
    const set = new Set(allow);
    return all.filter((it) => set.has(it.slug.toLowerCase()));
  }, [catalog.data, interestSlugs]);

  const groups = useMemo<InterestGroup[]>(() => {
    const topLevelAreaTitle = topicLabel("areas", lang);
    const topicsTitle = topicLabel("topics", lang);

    const allCats = catalog.data?.categories ?? [];
    const catById = new Map<string, InterestItem>();
    for (const c of allCats) catById.set(c.id, c);
    const rootOf = (id: string): { id: string; slug: string; label: string } | null => {
      let cur = catById.get(id);
      if (!cur) return null;
      while (cur.parentId) {
        const p = catById.get(cur.parentId);
        if (!p) break;
        cur = p;
      }
      return { id: cur.id, slug: cur.slug, label: cur.label };
    };

    const byRoot = new Map<string, InterestGroup>();
    const orderedKeys: string[] = [];
    const tagItems: InterestItem[] = [];
    for (const it of allItems) {
      if (it.type === "tag") {
        tagItems.push(it);
        continue;
      }
      const root = rootOf(it.id);
      if (!root || root.id === it.id) {
        const key = "top";
        if (!byRoot.has(key)) {
          byRoot.set(key, { key, title: topLevelAreaTitle, items: [], parentSlug: null });
          orderedKeys.push(key);
        }
        byRoot.get(key)!.items.push(it);
        continue;
      }
      const key = `root:${root.slug}`;
      if (!byRoot.has(key)) {
        byRoot.set(key, { key, title: root.label, items: [], parentSlug: root.slug });
        orderedKeys.push(key);
      }
      byRoot.get(key)!.items.push(it);
    }
    const out: InterestGroup[] = [];
    for (const key of orderedKeys) {
      const g = byRoot.get(key)!;
      if (g.items.length > 0) out.push(g);
    }
    if (tagItems.length > 0) {
      out.push({ key: "tags", title: topicsTitle, items: tagItems, parentSlug: null });
    }
    return out;
  }, [allItems, catalog.data, lang]);

  return { catalog, allItems, groups };
}

export interface TopicsDroplistProps {
  lang: "pl" | "en";
  /** Nagłówek sekcji tematów (override z konfiguracji widgetu). */
  heading?: string;
  allItems: InterestItem[];
  groups: InterestGroup[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
  display?: "chips" | "droplist";
  labelSize?: number;
  placeholderSize?: number;
  /** Znaczniki edycji rozmiaru czcionek w builderze (opcjonalne). */
  editTargets?: boolean;
  iconStyle?: CSSProperties;
  iconTargetProps?: Record<string, unknown>;
}

export function TopicsDroplist({
  lang,
  heading,
  allItems,
  groups,
  picked,
  onToggle,
  onClear,
  display = "droplist",
  labelSize,
  placeholderSize,
  editTargets = false,
  iconStyle,
  iconTargetProps,
}: TopicsDroplistProps) {
  const uid = useId().replace(/[:]/g, "");
  const pickedCount = picked.size;
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [popupStyle, setPopupStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    if (!dropOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        (dropRef.current && dropRef.current.contains(t)) ||
        (popupRef.current && popupRef.current.contains(t))
      ) {
        return;
      }
      setDropOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [dropOpen]);

  // Pozycjonowanie popupu przez portal - pozwala wyjść poza przycięte kontenery.
  useLayoutEffect(() => {
    if (!dropOpen) {
      setPopupStyle(null);
      return;
    }
    const compute = () => {
      const btn = triggerRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const vh = window.innerHeight;
      const spaceBelow = vh - r.bottom;
      const spaceAbove = r.top;
      const openUp = spaceBelow < 260 && spaceAbove > spaceBelow;
      const maxH = Math.max(180, Math.min(420, openUp ? spaceAbove - 12 : spaceBelow - 12));
      setPopupStyle({
        position: "fixed",
        left: `${r.left}px`,
        width: `${r.width}px`,
        top: openUp ? undefined : `${r.bottom + 4}px`,
        bottom: openUp ? `${vh - r.top + 4}px` : undefined,
        maxHeight: `${maxH}px`,
        zIndex: 1000,
      });
    };
    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [dropOpen]);

  if (!allItems.length) return null;

  const chipStyle = labelSize
    ? ({ fontSize: `${labelSize}px` } satisfies CSSProperties)
    : undefined;
  const triggerStyle = placeholderSize
    ? ({ fontSize: `${placeholderSize}px` } satisfies CSSProperties)
    : undefined;
  const headingText = heading?.trim() || topicLabel("heading", lang);

  return (
    <div>
      <p
        className="mb-2 font-sans font-semibold uppercase tracking-wider text-muted-foreground"
        style={{ fontSize: labelSize ? `${labelSize}px` : "12px" }}
        {...(editTargets ? { "data-edit-target": "labelSize" } : {})}
      >
        {headingText}
      </p>

      {display === "droplist" ? (
        <div className="space-y-2">
          {pickedCount > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allItems
                .filter((it) => picked.has(it.id))
                .map((it) => (
                  <span
                    key={`sel:${it.type}:${it.id}`}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border border-brand bg-brand px-2.5 py-1 text-brand-foreground",
                      !labelSize && "text-xs",
                    )}
                    style={chipStyle}
                  >
                    {it.label}
                    <button
                      type="button"
                      onClick={() => onToggle(it.id)}
                      aria-label={lang === "en" ? `Remove ${it.label}` : `Usuń ${it.label}`}
                      className="inline-flex items-center justify-center rounded-full hover:opacity-80"
                      style={{ width: "1em", height: "1em" }}
                    >
                      <X style={{ width: "0.9em", height: "0.9em" }} aria-hidden />
                    </button>
                  </span>
                ))}
            </div>
          )}

          <div ref={dropRef} className="relative">
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setDropOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={dropOpen}
              className="flex w-full items-center justify-between rounded border border-border bg-background px-3 py-2 text-sm text-left"
              style={triggerStyle}
              {...(editTargets ? { "data-edit-target": "placeholderSize" } : {})}
            >
              <span className={pickedCount ? "text-foreground" : "text-muted-foreground"}>
                {topicsTriggerText(pickedCount, lang)}
              </span>
              <ChevronDown
                className={cn("shrink-0 opacity-60 transition-transform", dropOpen && "rotate-180")}
                style={iconStyle}
                {...(iconTargetProps ?? {})}
                aria-hidden
              />
            </button>

            {dropOpen &&
              popupStyle &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  ref={popupRef}
                  role="listbox"
                  aria-multiselectable="true"
                  style={popupStyle}
                  className="flex flex-col rounded-lg border border-border bg-popover shadow-2xl overflow-hidden"
                >
                  {groups.length > 1 && (
                    <GroupTabs
                      groups={groups}
                      jusId={uid}
                      scrollContainerId={`${uid}-drop-scroll`}
                      ariaLabel={topicLabel("jumpToGroup", lang)}
                      pickedByGroup={Object.fromEntries(
                        groups.map((g) => [
                          g.key,
                          g.items.reduce((n, it) => n + (picked.has(it.id) ? 1 : 0), 0),
                        ]),
                      )}
                    />
                  )}
                  <div id={`${uid}-drop-scroll`} className="flex-1 overflow-auto">
                    {groups.map((g) => {
                      const selectedInGroup = g.items.reduce(
                        (n, it) => n + (picked.has(it.id) ? 1 : 0),
                        0,
                      );
                      return (
                        <section
                          key={`grp:${g.key}`}
                          id={`${uid}-drop-grp-${g.key}`}
                          className="scroll-mt-0"
                        >
                          <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border/60 bg-popover/95 px-3 py-1.5 backdrop-blur">
                            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                              {g.title}
                            </span>
                            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/80">
                              {selectedInGroup > 0
                                ? `${selectedInGroup}/${g.items.length}`
                                : g.items.length}
                            </span>
                          </header>
                          <div className="grid grid-cols-1 gap-0.5 p-1.5 sm:grid-cols-2">
                            {g.items.map((it) => {
                              const active = picked.has(it.id);
                              return (
                                <button
                                  key={`opt:${it.type}:${it.id}`}
                                  type="button"
                                  role="option"
                                  aria-selected={active}
                                  onClick={() => onToggle(it.id)}
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition min-w-0",
                                    active ? "bg-brand/10 text-brand" : "hover:bg-accent",
                                  )}
                                >
                                  <Checkbox
                                    checked={active}
                                    tabIndex={-1}
                                    aria-hidden="true"
                                    className="pointer-events-none h-[16px] w-[16px]"
                                  />
                                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                  <footer className="flex items-center justify-between gap-2 border-t border-border bg-popover px-3 py-2">
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {pickedCount > 0
                        ? topicsTriggerText(pickedCount, lang)
                        : topicLabel("empty", lang)}
                    </span>
                    <div className="flex items-center gap-1">
                      {pickedCount > 0 && (
                        <button
                          type="button"
                          onClick={onClear}
                          className="rounded px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
                        >
                          {topicLabel("clear", lang)}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDropOpen(false)}
                        className="rounded bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition hover:opacity-90"
                      >
                        {topicLabel("done", lang)}
                      </button>
                    </div>
                  </footer>
                </div>,
                document.body,
              )}
          </div>
        </div>
      ) : (
        <div className="max-h-56 space-y-2 overflow-auto pr-1">
          {groups.map((g) => (
            <div key={`chips-grp:${g.key}`}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.title}
                <span className="ml-1 opacity-60">({g.items.length})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((it) => {
                  const active = picked.has(it.id);
                  return (
                    <button
                      key={`${it.type}:${it.id}`}
                      type="button"
                      onClick={() => onToggle(it.id)}
                      aria-pressed={active}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition",
                        active
                          ? "border-brand bg-brand text-brand-foreground"
                          : "border-border bg-background hover:border-brand/60",
                      )}
                      style={chipStyle}
                    >
                      {it.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Poziomy pasek zakładek grup w dropdownie zainteresowań.
 * - drag-to-scroll (pointer events) - działa myszką i palcem
 * - aktywna zakładka podświetlana wg pozycji scrolla listy (IntersectionObserver)
 * - strzałki < > pojawiają się gdy jest gdzie przewinąć
 */
export function GroupTabs({
  groups,
  jusId,
  scrollContainerId,
  ariaLabel,
  pickedByGroup,
}: {
  groups: { key: string; title: string; items: readonly unknown[] }[];
  jusId: string;
  scrollContainerId: string;
  ariaLabel: string;
  pickedByGroup?: Record<string, number>;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [activeKey, setActiveKey] = useState<string>(groups[0]?.key ?? "");
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const dragRef = useRef<{ startX: number; startLeft: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.getElementById(scrollContainerId);
    if (!root) return;
    const targets = groups
      .map((g) => document.getElementById(`${jusId}-drop-grp-${g.key}`))
      .filter((el): el is HTMLElement => !!el);
    if (!targets.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          setActiveKey(visible.target.id.replace(`${jusId}-drop-grp-`, ""));
        }
      },
      { root, threshold: [0, 0.25, 0.6, 1], rootMargin: "0px 0px -60% 0px" },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [groups, jusId, scrollContainerId]);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const el = bar.querySelector<HTMLElement>(`[data-tab-key="${activeKey}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeKey]);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const update = () => {
      setCanLeft(bar.scrollLeft > 4);
      setCanRight(bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 4);
    };
    update();
    bar.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      bar.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [groups]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    if (!bar) return;
    if ((e.target as HTMLElement).closest("[data-tab-nudge]")) return;
    dragRef.current = { startX: e.clientX, startLeft: bar.scrollLeft, moved: false };
    try {
      bar.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    const d = dragRef.current;
    if (!bar || !d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 3) d.moved = true;
    if (d.moved) bar.scrollLeft = d.startLeft - dx;
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    try {
      bar?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* not captured */
    }
    if (dragRef.current?.moved) {
      const stop = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener("click", stop, true);
      };
      window.addEventListener("click", stop, true);
    }
    dragRef.current = null;
  };

  const nudge = (dir: -1 | 1) => {
    const bar = barRef.current;
    if (!bar) return;
    bar.scrollBy({ left: dir * Math.max(160, bar.clientWidth * 0.7), behavior: "smooth" });
  };

  const jumpTo = (key: string) => {
    const el = document.getElementById(`${jusId}-drop-grp-${key}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveKey(key);
  };

  return (
    <div className="relative border-b border-border bg-popover/95">
      <button
        type="button"
        data-tab-nudge
        aria-label="scroll left"
        tabIndex={-1}
        onClick={() => nudge(-1)}
        className={cn(
          "absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center w-6 bg-gradient-to-r from-popover via-popover/80 to-transparent text-muted-foreground hover:text-foreground transition-opacity",
          canLeft ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <ChevronDown className="h-3.5 w-3.5 rotate-90" />
      </button>
      <div
        ref={barRef}
        role="tablist"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex gap-1.5 overflow-x-auto px-2 py-1.5 no-scrollbar cursor-grab active:cursor-grabbing select-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollBehavior: "smooth" }}
      >
        {groups.map((g) => {
          const active = g.key === activeKey;
          const selected = pickedByGroup?.[g.key] ?? 0;
          return (
            <button
              key={`tab:${g.key}`}
              type="button"
              role="tab"
              aria-selected={active}
              data-tab-key={g.key}
              onClick={() => jumpTo(g.key)}
              className={cn(
                "group/tab inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider transition-all border",
                active
                  ? "bg-foreground text-background border-foreground shadow-sm"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span>{g.title}</span>
              <span
                className={cn(
                  "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[9px] tabular-nums transition",
                  selected > 0
                    ? active
                      ? "bg-background/20 text-background"
                      : "bg-brand text-brand-foreground"
                    : active
                      ? "bg-background/15 text-background/80"
                      : "bg-muted text-muted-foreground/80",
                )}
              >
                {selected > 0 ? `${selected}/${g.items.length}` : g.items.length}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        data-tab-nudge
        aria-label="scroll right"
        tabIndex={-1}
        onClick={() => nudge(1)}
        className={cn(
          "absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center w-6 bg-gradient-to-l from-popover via-popover/80 to-transparent text-muted-foreground hover:text-foreground transition-opacity",
          canRight ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
      </button>
    </div>
  );
}
