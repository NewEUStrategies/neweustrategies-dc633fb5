// Table of Contents widget (3 warianty: list / grid / sidebar).
// Autoscan H2/H3 z bieżącej strony (data-cms-content lub main/article)
// z fallbackiem do manualnych pozycji zdefiniowanych w builderze.
// Responsywne: mobile = collapsible; desktop = pełny układ zgodny z wariantem.
//
// Kotwice: ZERO własnego slugify. Skan DOM deleguje do lib/content/anchorScan,
// pozycje ręczne do lib/toc/manualItems - oba liczą kotwice kanonicznym
// `slugifyAnchor` (jedno źródło + test parytetu międzysilnikowego), więc
// `href="#…"` widgetu zawsze trafia w `id` wyemitowane przez silniki treści,
// również dla liter atomowych (`ł`), które dawna kopia NFKD-only gubiła.
//
// Odczyt treści: wyłącznie przez lib/content-model/contentValue (asBool / asOneOf /
// pickI18n) oraz lib/toc/manualItems. Ręczne `getStr(...) !== "0"` cicho
// odwracało nowe, prawdziwie booleanowe zapisy przełączników, a lista pozycji
// czytana wprost z `items_pl` gubiła treść zapisaną pod bezjęzykowym `items`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, LayoutGrid, PanelLeft, ChevronDown, Menu as MenuIcon } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import type { WidgetContent } from "@/lib/builder/types";
import { asBool, asOneOf, pickI18n } from "@/lib/content-model/contentValue";
import { scanHeadings, type ScannedHeading } from "@/lib/content/anchorScan";
import { parseManualTocItems, readManualTocLines, type ManualTocItem } from "@/lib/toc/manualItems";
import { type Lang } from "./frame";

type Variant = "list" | "grid" | "sidebar";

type TocItem = ManualTocItem;

interface Props {
  content: WidgetContent;
  lang: Lang;
}

const VARIANTS = ["list", "grid", "sidebar"] as const;

const isTocLevel = (h: ScannedHeading): h is ScannedHeading & { level: 2 | 3 } =>
  h.level === 2 || h.level === 3;

/** Korzeń skanu widgetu - od najbardziej do najmniej jawnego kontenera treści. */
function getScanRoot(): HTMLElement {
  return (
    document.querySelector<HTMLElement>("[data-cms-content]") ||
    document.querySelector<HTMLElement>("main article") ||
    document.querySelector<HTMLElement>("main") ||
    document.body
  );
}

const sameItems = (a: readonly TocItem[], b: readonly TocItem[]): boolean =>
  a.length === b.length &&
  a.every((x, i) => x.id === b[i].id && x.text === b[i].text && x.level === b[i].level);

function useTocItems(manual: TocItem[], skipText: string): TocItem[] {
  const [auto, setAuto] = useState<TocItem[]>([]);
  const manualMode = manual.length > 0;
  useEffect(() => {
    if (manualMode) return;
    if (typeof document === "undefined") return;
    let raf = 0;
    const scan = () => {
      // Wspólny skaner nadaje brakujące `id` kanonicznym slugifyAnchor,
      // deduplikuje od bazy i dokłada aliasy legacy dla starych `#kotwic`.
      const items = scanHeadings(getScanRoot(), {
        selector: "h2, h3",
        excludeAncestor: "[data-widget-toc]",
        skipText,
      }).filter(isTocLevel);
      // Stabilna referencja, gdy nic się nie zmieniło - scrollspy nie musi
      // wtedy przepinać listenera scrolla po każdym re-skanie.
      setAuto((prev) => (sameItems(prev, items) ? prev : items));
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(scan);
    };
    schedule();
    // Treść montuje się po widgecie (hydratacja, lazy sekcje), więc zamiast
    // zgadywać opóźnienia timerami re-skanujemy przy realnych mutacjach DOM.
    // Skan jest idempotentny (id i aliasy nie mnożą się), więc kaskada
    // obserwera gaśnie po jednym dodatkowym przebiegu.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [manualMode, skipText]);
  return manualMode ? manual : auto;
}

/**
 * Linia odniesienia scrollspy jako ułamek wysokości okna: aktywny jest
 * nagłówek, którego górna krawędź ostatnia minęła ~20% okna (ta sama linia,
 * co górna granica dawnego `rootMargin: -20%` IntersectionObservera).
 */
const ACTIVE_LINE_RATIO = 0.2;

interface TocScrollState {
  readonly active: string | null;
  readonly progress: number;
}

const INITIAL_SCROLL_STATE: TocScrollState = { active: null, progress: 0 };

/**
 * Aktywny nagłówek z geometrii: spośród nagłówków nad linią odniesienia ten
 * położony najniżej. Pozycje ręczne mogą wskazywać kotwice w dowolnej
 * kolejności, więc decyduje położenie, nie kolejność spisu; przy remisie
 * wygrywa późniejsza pozycja. Nagłówki bez boksu nie biorą udziału.
 */
function activeFromGeometry(items: readonly TocItem[], line: number): string | null {
  let active: string | null = null;
  let best = -Infinity;
  for (const item of items) {
    const node = document.getElementById(item.id);
    if (!node) continue;
    const rect = node.getBoundingClientRect();
    // Nagłówek bez boksu (display:none, zwinięty <details>, kopia responsywna
    // ukryta na tym ekranie, sekcja `data-hide-on-mobile`) ma zerowy
    // prostokąt z `top = 0`, czyli zawsze „nad linią" - wygrywałby z każdym
    // widocznym nagłówkiem, który minął już górną krawędź okna. Dawny
    // IntersectionObserver nie zgłaszał niemalowanych elementów.
    if (rect.width === 0 && rect.height === 0) continue;
    const top = rect.top;
    if (top <= line && top >= best) {
      best = top;
      active = item.id;
    }
  }
  return active;
}

function readingProgress(): number {
  const h = document.documentElement;
  const max = h.scrollHeight - h.clientHeight;
  return max > 0 ? Math.min(1, Math.max(0, h.scrollTop / max)) : 0;
}

/**
 * Aktywna pozycja i postęp czytania z JEDNEGO pasywnego listenera `scroll`,
 * throttlowanego klatką animacji (AGENTS.md). Dawny IntersectionObserver
 * z wąskim pasem obserwacji gubił sekcje przy szybkim przewijaniu: nagłówek,
 * który przeskoczył pas między dwiema klatkami, nigdy nie zgłaszał przecięcia,
 * a postęp liczył osobny listener. Pomiar geometrii raz na klatkę zawsze
 * wskazuje ostatni minięty nagłówek, niezależnie od długości skoku.
 * Bez `trackProgress` postęp stoi na 0 - przewijanie nie renderuje widgetu,
 * dopóki nie zmieni się aktywna pozycja.
 */
function useTocScrollState(items: readonly TocItem[], trackProgress: boolean): TocScrollState {
  const [state, setState] = useState<TocScrollState>(INITIAL_SCROLL_STATE);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (items.length === 0) return;
    let raf = 0;
    // Flaga zamiast identyfikatora klatki: atrapa rAF (testy, polyfill) może
    // wywołać callback synchronicznie, zanim zwróci identyfikator.
    let pending = false;
    const measure = () => {
      pending = false;
      const active = activeFromGeometry(items, window.innerHeight * ACTIVE_LINE_RATIO);
      const progress = trackProgress ? readingProgress() : 0;
      setState((prev) =>
        prev.active === active && prev.progress === progress ? prev : { active, progress },
      );
    };
    const onScroll = () => {
      // Najwyżej jeden pomiar na klatkę: kolejne zdarzenia tej samej klatki
      // dołączają do zleconego pomiaru.
      if (pending) return;
      pending = true;
      raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      pending = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [items, trackProgress]);
  return state;
}

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 96;
  window.scrollTo({ top, behavior: "smooth" });
  // Stan wpisu historii należy do routera (`__TSR_key` - klucz przywracania
  // scrolla, `__TSR_index` - kierunek wstecz/dalej); `null` go kasował.
  // Ta sama naprawa co w `lib/footnotes/navigation.ts`.
  if (history.replaceState) history.replaceState(history.state, "", `#${id}`);
}

export function TocWidget({ content, lang }: Props) {
  const variant: Variant = asOneOf<Variant>(content.variant, VARIANTS, "list");
  const title =
    pickI18n(content, "title", lang) || (lang === "en" ? "Table of contents" : "Spis treści");
  const showNumbers = asBool(content.showNumbers, true);
  const showProgress = asBool(content.showProgress, false);
  const sticky = asBool(content.sticky, false);
  // Klucz tekstowy zamiast referencji tablicy: odczyt tworzy nową tablicę przy
  // każdym renderze, więc memo po referencji przeliczałby się zawsze,
  // a niestabilne `items` przepinałyby listener scrolla scrollspy.
  const manualKey = readManualTocLines(content, lang).join("\n");
  const manual = useMemo(() => parseManualTocItems([manualKey]), [manualKey]);
  const items = useTocItems(manual, title);
  const { active, progress } = useTocScrollState(items, showProgress);
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
        className="cms-widget-label rounded-[6px] border border-dashed border-border/60 p-6 text-center text-muted-foreground"
      >
        {lang === "en" ? "No headings detected on this page." : "Brak nagłówków na tej stronie."}
      </div>
    );
  }

  const NumberBadge = ({ n, isActive }: { n: number; isActive: boolean }) => (
    <span
      className={cn(
        "cms-toc-index flex-none inline-flex items-center justify-center rounded-[4px] w-7 h-7 font-bold tabular-nums shrink-0 transition-colors",
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
                aria-current={isActive ? "location" : undefined}
                className={cn(
                  "cms-toc-item group flex items-start gap-3 px-3 py-2.5 rounded-[6px] transition-all border-l-2",
                  it.level === 3 && "ml-6",
                  isActive
                    ? "bg-primary/5 text-primary border-primary font-semibold"
                    : "text-foreground border-transparent hover:bg-muted hover:text-primary hover:border-primary/60",
                )}
              >
                {showNumbers && it.level === 2 && (
                  <span className="cms-toc-index font-bold text-primary tabular-nums mt-0.5">
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
    <nav aria-label={title} className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
      {items.map((it, i) => {
        const isActive = active === it.id;
        return (
          <a
            key={it.id}
            href={`#${it.id}`}
            onClick={(e) => onClick(e, it.id)}
            aria-current={isActive ? "location" : undefined}
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
                "cms-toc-item font-medium min-w-0 flex-1 group-hover:text-primary transition-colors",
                isActive && "text-primary font-semibold",
                it.level === 3 && "cms-toc-sub text-muted-foreground",
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
                aria-current={isActive ? "location" : undefined}
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
                      "cms-toc-index flex-none w-6 font-semibold tabular-nums",
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-primary",
                    )}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                )}
                <span
                  className={cn(
                    "cms-toc-item min-w-0 flex-1 transition-colors",
                    isActive
                      ? "font-bold text-foreground"
                      : "font-medium text-foreground/80 group-hover:text-foreground",
                    it.level === 3 && "cms-toc-sub text-muted-foreground",
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
      className={cn("w-full text-foreground", sticky && "lg:sticky lg:top-24")}
    >
      {/* Mobile toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="lg:hidden w-full flex items-center justify-between gap-3 px-4 py-3 rounded-[6px] border border-border bg-background hover:bg-muted/60 transition-colors"
        aria-expanded={open}
        aria-controls="toc-body"
      >
        <span className="cms-toc-heading flex items-center gap-2 font-semibold">
          <MenuIcon className="w-4 h-4 text-primary" />
          {title}
          <span className="cms-toc-index font-bold uppercase tracking-widest text-muted-foreground bg-muted px-2 py-0.5 rounded-[4px] ml-1">
            {items.length}
          </span>
        </span>
        <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
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
            <h2 className="cms-toc-heading font-bold tracking-tight truncate">{title}</h2>
          </div>
          <span
            className="cms-toc-index inline-flex items-center gap-1.5 font-bold uppercase tracking-widest text-muted-foreground bg-muted px-2 py-1 rounded-[4px] shrink-0"
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
