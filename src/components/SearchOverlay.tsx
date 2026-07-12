import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Search, X, Loader2, ArrowRight, Clock } from "@/lib/lucide-shim";
import "@/lib/i18n-public";
import { supabase } from "@/integrations/supabase/client";
import { AppLink } from "@/components/atoms/AppLink";
import { addRecentSearch, getRecentSearches } from "@/lib/search/recentSearches";
import { useFocusTrap } from "@/lib/a11y/useFocusTrap";

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
  // The fullscreen variant locks body scroll (below) and is effectively modal,
  // so it gets a focus trap; the input already holds focus on open.
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
      // The same ranked FTS engine as /search (unaccent, prefix matching,
      // indexes blocks/builder content) - previously the overlay ran a plain
      // ILIKE on the title, so the two surfaces returned different results
      // for the same phrase.
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

  const placeholder = heading || t("searchOverlay.placeholder");
  const hasQuery = q.trim().length >= 2;
  const showEmpty = liveResults && hasQuery && !loading && results.length === 0;
  const showResults = liveResults && hasQuery && results.length > 0;

  const isDropdown = mode === "dropdown";

  if (isDropdown) {
    return (
      <div className="absolute right-4 top-14 w-[min(92vw,440px)] bg-background/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
        <SearchBar
          inputRef={inputRef}
          q={q}
          setQ={setQ}
          loading={loading}
          onClose={onClose}
          placeholder={placeholder}
          compact
          listboxId={listboxId}
          activeOptionId={showResults ? optionId(active) : undefined}
          expanded={showResults}
        />
        {(showResults || showEmpty) && (
          <ResultsList
            results={results}
            active={active}
            setActive={setActive}
            onSelect={() => selectAndClose(q)}
            empty={showEmpty}
            compact
            listboxId={listboxId}
            optionId={optionId}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-background/70 backdrop-blur-xl animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-x-0 top-0 flex justify-center px-4 pt-[12vh] pb-8 max-h-screen overflow-y-auto">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("searchOverlay.dialogLabel")}
          className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-top-4 duration-300"
          onClick={(e) => e.stopPropagation()}
        >
          <SearchBar
            inputRef={inputRef}
            q={q}
            setQ={setQ}
            loading={loading}
            onClose={onClose}
            placeholder={placeholder}
            listboxId={listboxId}
            activeOptionId={showResults ? optionId(active) : undefined}
            expanded={showResults}
          />
          {showResults || showEmpty ? (
            <>
              <ResultsList
                results={results}
                active={active}
                setActive={setActive}
                onSelect={() => selectAndClose(q)}
                empty={showEmpty}
                listboxId={listboxId}
                optionId={optionId}
              />
              {hasQuery && (
                <AppLink
                  href={`/search?q=${encodeURIComponent(q.trim())}`}
                  onClick={() => selectAndClose(q)}
                  className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 text-sm font-medium text-brand-ink transition hover:bg-muted/40"
                >
                  <span>
                    {t("searchOverlay.viewAllFor")}
                    <span className="font-semibold">„{q.trim()}"</span>
                  </span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </AppLink>
              )}
            </>
          ) : (
            <div className="px-6 py-10 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                <Search className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">{t("searchOverlay.startTyping")}</p>
              {recent.length > 0 && (
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {recent.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => setQ(term)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-foreground transition hover:bg-muted"
                    >
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      {term}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <Footer />
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
      className={`flex items-center gap-3 border-b border-border ${compact ? "px-3 py-2.5" : "px-5 py-4"}`}
    >
      <Search className={`text-muted-foreground shrink-0 ${compact ? "w-4 h-4" : "w-5 h-5"}`} />
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
        className={`flex-1 bg-transparent border-0 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 shadow-none placeholder:text-muted-foreground/60 text-foreground ${compact ? "text-sm" : "text-base"}`}
        style={{ boxShadow: "none", WebkitTapHighlightColor: "transparent" }}
      />
      {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      {q && !loading && (
        <button
          onClick={() => setQ("")}
          className="text-xs text-muted-foreground hover:text-foreground transition px-2 py-0.5 rounded hover:bg-muted"
        >
          {t("searchOverlay.clear")}
        </button>
      )}
      <button
        onClick={onClose}
        aria-label={t("searchOverlay.close")}
        className="shrink-0 inline-flex items-center justify-center w-9 h-9 pointer-coarse:w-11 pointer-coarse:h-11 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function ResultsList({
  results,
  active,
  setActive,
  onSelect,
  empty,
  compact,
  listboxId,
  optionId,
}: {
  results: Result[];
  active: number;
  setActive: (i: number) => void;
  onSelect: () => void;
  empty: boolean;
  compact?: boolean;
  listboxId: string;
  optionId: (i: number) => string;
}) {
  const { t } = useTranslation();
  if (empty) {
    return (
      <div
        role="status"
        className={`text-center text-sm text-muted-foreground ${compact ? "px-4 py-8" : "px-6 py-12"}`}
      >
        {t("searchOverlay.noResults")}
      </div>
    );
  }
  return (
    <ul
      id={listboxId}
      role="listbox"
      aria-label={t("searchOverlay.resultsLabel")}
      className={`overflow-y-auto divide-y divide-border/60 ${compact ? "max-h-[60vh]" : "max-h-[52vh]"}`}
    >
      {results.map((r, i) => {
        const isActive = i === active;
        // Wzorzec listbox/option: rolę option nosi SAM link (tabIndex=-1,
        // fokus zostaje w combobox i jest ogłaszany przez aria-activedescendant).
        // option nie może zawierać zagnieżdżonych elementów interaktywnych
        // (axe: nested-interactive), więc <li> jest czysto prezentacyjne.
        return (
          <li key={r.id} role="presentation">
            <AppLink
              href={`/post/${r.slug}`}
              id={optionId(i)}
              role="option"
              aria-selected={isActive}
              tabIndex={-1}
              onClick={onSelect}
              onMouseEnter={() => setActive(i)}
              className={`group flex items-start gap-3 px-5 py-3.5 transition ${
                isActive ? "bg-muted/70" : "hover:bg-muted/40"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground line-clamp-1">{r.title}</div>
                {r.excerpt && (
                  <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {r.excerpt}
                  </div>
                )}
              </div>
              <ArrowRight
                className={`w-4 h-4 mt-0.5 shrink-0 transition ${
                  isActive
                    ? "text-foreground translate-x-0.5"
                    : "text-muted-foreground/40 group-hover:text-muted-foreground"
                }`}
              />
            </AppLink>
          </li>
        );
      })}
    </ul>
  );
}

function Footer() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-2.5 border-t border-border bg-muted/30 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border border-border bg-background font-mono text-[10px]">
            ↑
          </kbd>
          <kbd className="px-1.5 py-0.5 rounded border border-border bg-background font-mono text-[10px]">
            ↓
          </kbd>
          {t("searchOverlay.footerNavigate")}
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border border-border bg-background font-mono text-[10px]">
            ↵
          </kbd>
          {t("searchOverlay.footerOpen")}
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border border-border bg-background font-mono text-[10px]">
            esc
          </kbd>
          {t("searchOverlay.footerClose")}
        </span>
      </div>
    </div>
  );
}
