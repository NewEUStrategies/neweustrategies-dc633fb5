// SearchOverlay - powierzchnia "quick search" (dropdown / fullscreen) używana
// z ikony lupki w headerze. Używa DOKŁADNIE tych samych atomów wizualnych
// (SuggestListShell / SuggestGroupHeader / SuggestRow / RecentSearchesList)
// co header mega-box widget i /search autosuggest - jeden spójny UX.
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Clock, FileText, Loader2, Search, SlidersHorizontal, X } from "@/lib/lucide-shim";
import "@/lib/i18n-public";
import { supabase } from "@/integrations/supabase/client";
import { AppLink } from "@/components/atoms/AppLink";
import { addRecentSearch, clearRecentSearches, getRecentSearches } from "@/lib/search/recentSearches";
import { useFocusTrap } from "@/lib/a11y/useFocusTrap";
import { trackSearch } from "@/lib/analytics/track";
import {
  SuggestGroupHeader,
  SuggestListShell,
  SuggestRow,
} from "@/components/search/SuggestListView";

type Mode = "standalone" | "dropdown" | "fullscreen";
type Result = { id: string; slug: string; title: string; excerpt: string | null };

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
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
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

  useEffect(() => {
    if (open) {
      setQ("");
      setResults([]);
      setActive(0);
      setRecent(getRecentSearches());
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !liveResults || q.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      const { data } = await supabase.rpc("search_posts", {
        _q: q.trim(),
        _limit: Math.max(1, Math.min(limit, 20)),
      });
      if (cancelled) return;
      setResults(
        (data ?? []).map((r) => ({
          id: r.id,
          slug: r.slug,
          title: (lang === "pl" ? r.title_pl : r.title_en) || r.title_pl || "",
          excerpt: (lang === "pl" ? r.excerpt_pl : r.excerpt_en) || null,
        })),
      );
      setActive(0);
      setLoading(false);
      trackSearch(q.trim(), { results: (data ?? []).length, source: "overlay", mode, lang });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, open, liveResults, limit, lang]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const r = results[active];
        if (r) {
          addRecentSearch(q);
          onClose();
          void router.navigate({ href: `/post/${r.slug}` } as never);
        } else if (q.trim().length >= 2) {
          addRecentSearch(q);
          onClose();
          void router.navigate({ href: `/search?q=${encodeURIComponent(q.trim())}` } as never);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, results, active, router, q]);

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
  const showEmpty = liveResults && hasQuery && !loading && results.length === 0;
  const showResults = liveResults && hasQuery && results.length > 0;

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
        <div
          id={listboxId}
          role="listbox"
          aria-label={t("searchOverlay.resultsLabel") as string}
          className={`overflow-y-auto py-1 ${mode === "dropdown" ? "max-h-[60vh]" : "max-h-[52vh]"}`}
        >
          <SuggestGroupHeader
            icon={FileText}
            label={t("searchOverlay.resultsLabel") as string}
            count={results.length}
          />
          <ul role="presentation">
            {results.map((r, i) => (
              <li key={r.id} role="presentation">
                <SuggestRow
                  id={optionId(i)}
                  href={`/post/${r.slug}`}
                  label={r.title}
                  meta={r.excerpt ?? undefined}
                  icon={FileText}
                  active={i === active}
                  onSelect={() => selectAndClose(q)}
                  onHover={() => setActive(i)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : showEmpty ? (
        <div role="status" className="px-4 py-8 text-center text-[12px] text-muted-foreground">
          {t("searchOverlay.noResults")}
        </div>
      ) : recent.length > 0 ? (
        <div className="py-1">
          <div className="flex items-center justify-between px-3 pt-2 pb-1">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden />
              {t("search.recent", { defaultValue: "Ostatnie wyszukiwania" }) as string}
            </span>
            <button
              type="button"
              onClick={() => {
                clearRecentSearches();
                setRecent([]);
              }}
              className="text-[10px] font-medium text-muted-foreground transition-colors hover:text-[var(--brand)]"
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
        <div className="px-5 py-8 text-center">
          <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-muted/50">
            <Search className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-[12px] text-muted-foreground">{t("searchOverlay.startTyping")}</p>
        </div>
      )}

      {hasQuery && (
        <AppLink
          href={`/search?q=${encodeURIComponent(trimmed)}`}
          onClick={() => selectAndClose(q)}
          className="group flex w-full items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-[12px] font-semibold leading-none transition-colors hover:bg-[color-mix(in_oklab,var(--brand)_6%,transparent)]"
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
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-border/60 bg-muted/40 px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {t("search.widget.operators", { defaultValue: "Operatory" }) as string}
        </span>
        {OPERATORS.map(({ op, ins, caret }) => (
          <button
            key={op}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              insertOperator(ins, caret);
            }}
            className="inline-flex items-center rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[9px] font-semibold leading-[1.4] text-foreground shadow-[0_1px_0_rgba(0,0,0,0.04)] transition-all hover:-translate-y-px hover:border-[var(--brand)] hover:text-[var(--brand)]"
          >
            {op}
          </button>
        ))}
      </div>
      <div className="hidden items-center gap-2 text-[9px] text-muted-foreground md:flex">
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[9px] leading-none text-foreground/80">↑</kbd>
          <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[9px] leading-none text-foreground/80">↓</kbd>
          {t("search.widget.kbd_navigate", { defaultValue: "nawiguj" }) as string}
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[9px] leading-none text-foreground/80">↵</kbd>
          {t("search.widget.kbd_select", { defaultValue: "wybierz" }) as string}
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[9px] leading-none text-foreground/80">esc</kbd>
          {t("search.widget.kbd_close", { defaultValue: "zamknij" }) as string}
        </span>
      </div>
      <AppLink
        href={hasQuery ? `/search?q=${encodeURIComponent(trimmed)}&adv=1` : "/search?adv=1"}
        onClick={() => selectAndClose(q)}
        className="inline-flex items-center gap-1 text-[10px] font-semibold hover:underline"
        style={{ color: "var(--brand)" }}
      >
        <SlidersHorizontal className="h-3 w-3 shrink-0" aria-hidden />
        {t("search.widget.advanced", { defaultValue: "Zaawansowane" }) as string}
      </AppLink>
    </div>
  );

  if (mode === "dropdown") {
    return (
      <SuggestListShell
        className="absolute right-4 top-14 z-50 w-[min(92vw,440px)] animate-in fade-in slide-in-from-top-2 duration-200"
      >
        {bar}
        {body}
        {footer}
      </SuggestListShell>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-background sm:bg-background/70 sm:backdrop-blur-xl animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-x-0 top-0 flex h-full max-h-screen justify-center overflow-y-auto px-0 pt-0 pb-0 sm:h-auto sm:px-4 sm:pt-[12vh] sm:pb-8">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("searchOverlay.dialogLabel") as string}
          className="flex h-full w-full max-w-xl flex-col animate-in slide-in-from-top-4 duration-300 sm:h-auto sm:zoom-in-95"
          onClick={(e) => e.stopPropagation()}
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <SuggestListShell className="flex flex-col overflow-hidden rounded-none sm:rounded-[10px]">
            {bar}
            <div className="min-h-0 flex-1 overflow-y-auto sm:flex-none sm:overflow-visible">
              {body}
            </div>
            {footer}
          </SuggestListShell>
        </div>
      </div>
    </div>
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
      className={`flex items-center gap-2 border-b border-border/60 ${compact ? "px-3 py-2" : "px-3.5 py-2.5"}`}
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
        className="flex-1 border-0 bg-transparent text-[13px] text-foreground shadow-none outline-none placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
        style={{ boxShadow: "none", WebkitTapHighlightColor: "transparent" }}
      />
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {q && !loading && (
        <button
          onClick={() => setQ("")}
          className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          {t("searchOverlay.clear") as string}
        </button>
      )}
      <button
        onClick={onClose}
        aria-label={t("searchOverlay.close") as string}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground pointer-coarse:h-9 pointer-coarse:w-9"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
