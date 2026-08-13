// SearchOverlay - powierzchnia "quick search" (dropdown / fullscreen) używana
// z ikony lupki w headerze. Używa DOKŁADNIE tych samych atomów wizualnych
// (SuggestListShell / SuggestGroupHeader / SuggestRow / RecentSearchesList)
// co header mega-box widget i /search autosuggest - jeden spójny UX.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Clock,
  FileText,
  Loader2,
  MessagesSquare,
  Search,
  SlidersHorizontal,
  Tags,
  User,
  Users,
  X,
} from "@/lib/lucide-shim";
import "@/lib/i18n-public";
import { AppLink } from "@/components/atoms/AppLink";
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
} from "@/lib/search/recentSearches";
import {
  OVERLAY_TABS,
  emptyOverlayResults,
  firstNonEmptyTab,
  overlaySearchQueryOptions,
  type OverlayTab,
} from "@/lib/search/overlayTabs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useFocusTrap } from "@/lib/a11y/useFocusTrap";
import { trackSearch } from "@/lib/analytics/track";
import {
  SuggestGroupHeader,
  SuggestListShell,
  SuggestRow,
} from "@/components/search/SuggestListView";

type Mode = "standalone" | "dropdown" | "fullscreen";

const TAB_ICON: Record<OverlayTab, typeof FileText> = {
  posts: FileText,
  topics: Tags,
  clubs: MessagesSquare,
  people: Users,
  experts: User,
};

type Props = {
  open: boolean;
  onClose: () => void;
  mode: Mode;
  heading: string;
  liveResults: boolean;
  limit: number;
  lang: "pl" | "en";
};

const OPERATORS: Array<{ op: string; ins: string; caret?: number }> = [
  { op: '"fraza"', ins: '"" ', caret: 1 },
  { op: "AND", ins: " AND " },
  { op: "OR", ins: " OR " },
  { op: "NOT", ins: " NOT " },
  { op: "-słowo", ins: " -" },
];

export function SearchOverlay({ open, onClose, mode, heading, liveResults, limit, lang }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<OverlayTab>("posts");
  const [tabPinned, setTabPinned] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  useFocusTrap(panelRef, open && mode !== "dropdown");
  const optionId = (i: number): string => `${listboxId}-opt-${i}`;

  const selectAndClose = (query: string) => {
    addRecentSearch(query);
    onClose();
  };

  // Modal na mobile: blokujemy przewijanie tła i wyłączamy je z nawigacji
  // (inert), więc aktywna jest wyłącznie warstwa wyszukiwarki.
  useEffect(() => {
    if (!open || mode === "dropdown" || typeof document === "undefined") return;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevTouch = body.style.touchAction;
    body.style.overflow = "hidden";
    body.style.touchAction = "none";
    const roots = Array.from(body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !el.contains(panelRef.current),
    );
    const restored: Array<[HTMLElement, string | null]> = [];
    for (const el of roots) {
      if (el.dataset["searchOverlayRoot"] === "1") continue;
      restored.push([el, el.getAttribute("aria-hidden")]);
      el.setAttribute("aria-hidden", "true");
      el.setAttribute("inert", "");
    }
    return () => {
      body.style.overflow = prevOverflow;
      body.style.touchAction = prevTouch;
      for (const [el, prev] of restored) {
        el.removeAttribute("inert");
        if (prev === null) el.removeAttribute("aria-hidden");
        else el.setAttribute("aria-hidden", prev);
      }
    };
  }, [open, mode]);

  useEffect(() => {
    if (open) {
      setQ("");
      setTab("posts");
      setTabPinned(false);
      setActive(0);
      setRecent(getRecentSearches());
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Jedno zapytanie na frazę: wszystkie zakładki równolegle, więc liczniki są
  // realne, a przełączanie sekcji nie odpala kolejnych round-tripów.
  const debouncedQ = useDebouncedValue(q.trim(), 220);
  const enabled = open && liveResults && debouncedQ.length >= 2;
  const perTab = Math.max(1, Math.min(limit, 20));
  const grouped = useQuery({
    ...overlaySearchQueryOptions(debouncedQ, lang, perTab),
    enabled,
  });
  const results = useMemo(
    () => (enabled ? (grouped.data ?? emptyOverlayResults()) : emptyOverlayResults()),
    [enabled, grouped.data],
  );
  const loading = enabled && grouped.isPending;
  const totalCount = OVERLAY_TABS.reduce((sum, key) => sum + results[key].length, 0);
  const tabResults = results[tab];

  // Automatyczny wybór pierwszej niepustej zakładki - dopóki użytkownik sam
  // nie kliknie w konkretną sekcję.
  useEffect(() => {
    if (!enabled || tabPinned) return;
    setTab((current) => firstNonEmptyTab(results, current));
    setActive(0);
  }, [enabled, tabPinned, results]);

  useEffect(() => {
    if (!enabled || grouped.isPending) return;
    trackSearch(debouncedQ, { results: totalCount, source: "overlay", mode, lang });
  }, [enabled, grouped.isPending, debouncedQ, totalCount, mode, lang]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(0, tabResults.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const r = tabResults[active];
        if (r) {
          addRecentSearch(q);
          onClose();
          void router.navigate({ href: r.href } as never);
        } else if (q.trim().length >= 2) {
          addRecentSearch(q);
          onClose();
          void router.navigate({ href: `/search?q=${encodeURIComponent(q.trim())}` } as never);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, tabResults, active, router, q]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const placeholder = heading || (t("searchOverlay.placeholder") as string);
  const trimmed = q.trim();
  const hasQuery = trimmed.length >= 2;
  const showEmpty = liveResults && hasQuery && !loading && totalCount === 0;
  const showResults = liveResults && hasQuery && totalCount > 0;

  const insertOperator = (ins: string, caret?: number) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? q.length;
    const end = el.selectionEnd ?? q.length;
    const next = q.slice(0, start) + ins + q.slice(end);
    const pos = start + (caret ?? ins.length);
    setQ(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const bar = (
    <SearchBar
      inputRef={inputRef}
      q={q}
      setQ={setQ}
      loading={loading}
      onClose={onClose}
      placeholder={placeholder}
      compact={mode === "dropdown"}
      listboxId={listboxId}
      activeOptionId={showResults ? optionId(active) : undefined}
      expanded={showResults}
    />
  );

  const body = (
    <>
      {showResults ? (
        <>
          <div
            role="tablist"
            aria-label={t("searchOverlay.tabs.ariaLabel") as string}
            className="flex items-center gap-1 overflow-x-auto border-b border-border/60 px-2 py-1"
          >
            {OVERLAY_TABS.map((key) => {
              const Icon = TAB_ICON[key];
              const isActive = key === tab;
              const count = results[key].length;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  disabled={count === 0}
                  onClick={() => {
                    setTab(key);
                    setTabPinned(true);
                    setActive(0);
                  }}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-[6px] px-2 py-1 text-[10px] font-semibold transition-colors disabled:opacity-40 ${
                    isActive
                      ? "bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] text-[var(--brand)]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3 w-3" aria-hidden />
                  {t(`searchOverlay.tabs.${key}`) as string}
                  <span className="tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
          <div
            id={listboxId}
            role="listbox"
            aria-label={t("searchOverlay.resultsLabel") as string}
            className={`overflow-y-auto py-1 ${mode === "dropdown" ? "max-h-[60vh]" : "max-h-[52vh]"}`}
          >
            <SuggestGroupHeader
              icon={TAB_ICON[tab]}
              label={t(`searchOverlay.tabs.${tab}`) as string}
              count={tabResults.length}
            />
            <ul role="presentation">
              {tabResults.map((r, i) => (
                <li key={r.id} role="presentation">
                  <SuggestRow
                    id={optionId(i)}
                    href={r.href}
                    label={r.label}
                    meta={r.meta ?? undefined}
                    avatarUrl={r.avatarUrl}
                    icon={TAB_ICON[tab]}
                    active={i === active}
                    onSelect={() => selectAndClose(q)}
                    onHover={() => setActive(i)}
                  />
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : showEmpty ? (
        <div role="status" className="px-4 py-8 text-center text-[10px] text-muted-foreground">
          {t("searchOverlay.noResults")}
        </div>
      ) : recent.length > 0 ? (
        <div className="py-1">
          <div className="flex items-center justify-between px-3 pt-2 pb-1">
            <span className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden />
              {t("search.recent", { defaultValue: "Ostatnie wyszukiwania" }) as string}
            </span>
            <button
              type="button"
              onClick={() => {
                clearRecentSearches();
                setRecent([]);
              }}
              className="text-[9px] font-medium text-muted-foreground transition-colors hover:text-[var(--brand)]"
            >
              {t("search.recent_clear", { defaultValue: "Wyczyść" }) as string}
            </button>
          </div>
          <ul role="list">
            {recent.map((term) => (
              <li key={term} role="presentation">
                <SuggestRow
                  href={`/search?q=${encodeURIComponent(term)}`}
                  label={term}
                  icon={Clock}
                  active={false}
                  onSelect={() => selectAndClose(term)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="px-5 py-10 text-center sm:py-8">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/60 sm:mb-2 sm:h-9 sm:w-9 sm:rounded-md">
            <Search className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
          </div>
          <p className="text-[13px] font-medium text-foreground sm:text-[10px] sm:font-normal sm:text-muted-foreground">
            {t("searchOverlay.startTyping")}
          </p>
          <p className="mx-auto mt-1.5 max-w-xs text-[11px] leading-relaxed text-muted-foreground sm:hidden">
            {t("searchOverlay.hint")}
          </p>
        </div>
      )}

      {hasQuery && (
        <AppLink
          href={`/search?q=${encodeURIComponent(trimmed)}`}
          onClick={() => selectAndClose(q)}
          className="group flex w-full items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-[10px] font-semibold leading-none transition-colors hover:bg-[color-mix(in_oklab,var(--brand)_6%,transparent)]"
          style={{ color: "var(--brand)" }}
        >
          <span className="inline-flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5" aria-hidden />
            {t("searchOverlay.viewAllFor")}
            <span className="font-bold">„{trimmed}"</span>
          </span>
          <ArrowRight
            className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </AppLink>
      )}
    </>
  );

  const footer = (
    <div
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-border/60 bg-muted/40 px-3 py-2 sm:py-1.5"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="-mx-1 flex w-full items-center gap-1 overflow-x-auto px-1 sm:w-auto sm:flex-wrap sm:overflow-visible">
        <span
          data-typography-exempt
          style={{ fontFamily: '"Red Hat Display", system-ui, sans-serif' }}
          className="mr-1 shrink-0 !text-[9px] !leading-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground"
        >
          {t("search.widget.operators", { defaultValue: "Operatory" }) as string}
        </span>
        {OPERATORS.map(({ op, ins, caret }) => (
          <button
            data-typography-exempt
            key={op}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              insertOperator(ins, caret);
            }}
            style={{ fontFamily: '"Red Hat Display", system-ui, sans-serif' }}
            className="inline-flex shrink-0 items-center rounded-[6px] border border-border/60 bg-background px-1.5 py-0.5 !text-[10px] !leading-[14px] font-semibold text-foreground shadow-[0_1px_0_rgba(0,0,0,0.04)] transition-all hover:-translate-y-px hover:border-[var(--brand)] hover:text-[var(--brand)] sm:px-1 sm:py-px sm:!text-[9px] sm:!leading-[12px]"
          >
            {op}
          </button>
        ))}
      </div>
      <div className="hidden items-center gap-2 text-[8px] text-muted-foreground md:flex">
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[8px] leading-none text-foreground/80">
            ↑
          </kbd>
          <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[8px] leading-none text-foreground/80">
            ↓
          </kbd>
          {t("search.widget.kbd_navigate", { defaultValue: "nawiguj" }) as string}
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[8px] leading-none text-foreground/80">
            ↵
          </kbd>
          {t("search.widget.kbd_select", { defaultValue: "wybierz" }) as string}
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[8px] leading-none text-foreground/80">
            esc
          </kbd>
          {t("search.widget.kbd_close", { defaultValue: "zamknij" }) as string}
        </span>
      </div>
      <AppLink
        href={hasQuery ? `/search?q=${encodeURIComponent(trimmed)}&adv=1` : "/search?adv=1"}
        onClick={() => selectAndClose(q)}
        className="inline-flex items-center gap-1 text-[10px] font-semibold hover:underline sm:text-[9px]"
        style={{ color: "var(--brand)" }}
      >
        <SlidersHorizontal className="h-3 w-3 shrink-0" aria-hidden />
        {t("search.widget.advanced", { defaultValue: "Zaawansowane" }) as string}
      </AppLink>
    </div>
  );

  if (mode === "dropdown") {
    return (
      <SuggestListShell className="absolute right-4 top-14 z-50 w-[min(92vw,440px)] animate-in fade-in slide-in-from-top-2 duration-200">
        {bar}
        {body}
        {footer}
      </SuggestListShell>
    );
  }

  // Portal do <body>: header ma `contain: layout`, więc bez portalu `position:
  // fixed` liczy się względem nagłówka (kontener zawierania) i nakładka dostaje
  // wysokość 0 - na mobile wyglądało to jakby lupa nic nie robiła.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      data-search-overlay-root="1"
      className="fixed inset-0 z-[10000] bg-background overscroll-contain sm:bg-background/70 sm:backdrop-blur-xl animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-x-0 top-0 flex h-full max-h-full justify-center overflow-y-auto px-0 pt-0 pb-0 sm:h-auto sm:max-h-screen sm:px-4 sm:pt-[12vh] sm:pb-8">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("searchOverlay.dialogLabel") as string}
          className="flex h-full w-full max-w-xl flex-col animate-in slide-in-from-top-4 duration-300 sm:h-auto sm:zoom-in-95"
          onClick={(e) => e.stopPropagation()}
        >
          <SuggestListShell className="flex h-full flex-col overflow-hidden rounded-none sm:h-auto sm:rounded-[10px]">
            {bar}
            <div className="min-h-0 flex-1 overflow-y-auto sm:flex-none sm:overflow-visible">
              {body}
            </div>
            {footer}
          </SuggestListShell>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SearchBar({
  inputRef,
  q,
  setQ,
  loading,
  onClose,
  placeholder,
  compact,
  listboxId,
  activeOptionId,
  expanded,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  q: string;
  setQ: (v: string) => void;
  loading: boolean;
  onClose: () => void;
  placeholder: string;
  compact?: boolean;
  listboxId: string;
  activeOptionId?: string;
  expanded: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex items-center gap-2 border-b border-border/60 ${compact ? "px-3 py-2" : "px-3.5 py-3 sm:py-2.5"}`}
    >
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        role="combobox"
        aria-label={placeholder}
        aria-expanded={expanded}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        enterKeyHint="search"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="flex-1 border-0 bg-transparent text-[16px] text-foreground shadow-none outline-none placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 sm:text-[13px]"
        style={{ boxShadow: "none", WebkitTapHighlightColor: "transparent" }}
      />
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {q && !loading && (
        <button
          onClick={() => setQ("")}
          className="rounded px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground sm:px-1.5 sm:py-0.5 sm:text-[10px]"
        >
          {t("searchOverlay.clear") as string}
        </button>
      )}
      <button
        onClick={onClose}
        aria-label={t("searchOverlay.close") as string}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground sm:h-7 sm:w-7 pointer-coarse:h-9 pointer-coarse:w-9"
      >
        <X className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
      </button>
    </div>
  );
}
