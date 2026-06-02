import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2, ArrowRight, CornerDownLeft } from "@/lib/lucide-shim";
import { supabase } from "@/integrations/supabase/client";

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
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setResults([]);
      setActive(0);
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
      const titleCol = lang === "pl" ? "title_pl" : "title_en";
      const excerptCol = lang === "pl" ? "excerpt_pl" : "excerpt_en";
      const { data } = await supabase
        .from("posts")
        .select(`id, slug, ${titleCol}, ${excerptCol}`)
        .eq("status", "published")
        .is("deleted_at", null)
        .ilike(titleCol, `%${q.trim()}%`)
        .limit(Math.max(1, Math.min(limit, 20)));
      if (cancelled) return;
      setResults(
        (data ?? []).map((r: any) => ({
          id: r.id,
          slug: r.slug,
          title: r[titleCol] || "",
          excerpt: r[excerptCol] || null,
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
        if (r) window.location.href = `/posts/${r.slug}`;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, results, active]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const placeholder = heading || (lang === "pl" ? "Czego dzisiaj szukasz?" : "What are you looking for today?");
  const hasQuery = q.trim().length >= 2;
  const showEmpty = liveResults && hasQuery && !loading && results.length === 0;
  const showResults = liveResults && hasQuery && results.length > 0;

  const isDropdown = mode === "dropdown";

  if (isDropdown) {
    return (
      <div className="absolute right-4 top-14 w-[min(92vw,440px)] bg-background/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
        <SearchBar
          inputRef={inputRef} q={q} setQ={setQ} loading={loading}
          onClose={onClose} placeholder={placeholder} compact
        />
        {(showResults || showEmpty) && (
          <ResultsList
            results={results} active={active} setActive={setActive}
            onClose={onClose} lang={lang} empty={showEmpty} compact
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
          className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-top-4 duration-300"
          onClick={(e) => e.stopPropagation()}
        >
          <SearchBar
            inputRef={inputRef} q={q} setQ={setQ} loading={loading}
            onClose={onClose} placeholder={placeholder}
          />
          {(showResults || showEmpty) ? (
            <ResultsList
              results={results} active={active} setActive={setActive}
              onClose={onClose} lang={lang} empty={showEmpty}
            />
          ) : (
            <div className="px-6 py-10 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                <Search className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {lang === "pl" ? "Zacznij pisać, aby wyszukać artykuły" : "Start typing to search articles"}
              </p>
            </div>
          )}
          <Footer lang={lang} />
        </div>
      </div>
    </div>
  );
}

function SearchBar({
  inputRef, q, setQ, loading, onClose, placeholder, compact,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  q: string; setQ: (v: string) => void; loading: boolean;
  onClose: () => void; placeholder: string; compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 border-b border-border ${compact ? "px-3 py-2.5" : "px-5 py-4"}`}>
      <Search className={`text-muted-foreground shrink-0 ${compact ? "w-4 h-4" : "w-5 h-5"}`} />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className={`flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60 ${compact ? "text-sm" : "text-base"}`}
      />
      {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      {q && !loading && (
        <button
          onClick={() => setQ("")}
          className="text-xs text-muted-foreground hover:text-foreground transition px-2 py-0.5 rounded hover:bg-muted"
        >
          Clear
        </button>
      )}
      <button
        onClick={onClose}
        aria-label="Close"
        className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function ResultsList({
  results, active, setActive, onClose, lang, empty, compact,
}: {
  results: Result[]; active: number; setActive: (i: number) => void;
  onClose: () => void; lang: "pl" | "en"; empty: boolean; compact?: boolean;
}) {
  if (empty) {
    return (
      <div className={`text-center text-sm text-muted-foreground ${compact ? "px-4 py-8" : "px-6 py-12"}`}>
        {lang === "pl" ? "Brak wyników" : "No results"}
      </div>
    );
  }
  return (
    <ul className={`overflow-y-auto divide-y divide-border/60 ${compact ? "max-h-[60vh]" : "max-h-[52vh]"}`}>
      {results.map((r, i) => {
        const isActive = i === active;
        return (
          <li key={r.id}>
            <a
              href={`/posts/${r.slug}`}
              onClick={onClose}
              onMouseEnter={() => setActive(i)}
              className={`group flex items-start gap-3 px-5 py-3.5 transition ${
                isActive ? "bg-muted/70" : "hover:bg-muted/40"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground line-clamp-1">{r.title}</div>
                {r.excerpt && (
                  <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{r.excerpt}</div>
                )}
              </div>
              <ArrowRight className={`w-4 h-4 mt-0.5 shrink-0 transition ${
                isActive ? "text-foreground translate-x-0.5" : "text-muted-foreground/40 group-hover:text-muted-foreground"
              }`} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function Footer({ lang }: { lang: "pl" | "en" }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-2.5 border-t border-border bg-muted/30 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border border-border bg-background font-mono text-[10px]">↑</kbd>
          <kbd className="px-1.5 py-0.5 rounded border border-border bg-background font-mono text-[10px]">↓</kbd>
          {lang === "pl" ? "nawiguj" : "navigate"}
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border border-border bg-background font-mono text-[10px] inline-flex items-center">
            <CornerDownLeft className="w-2.5 h-2.5" />
          </kbd>
          {lang === "pl" ? "otwórz" : "open"}
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border border-border bg-background font-mono text-[10px]">esc</kbd>
          {lang === "pl" ? "zamknij" : "close"}
        </span>
      </div>
    </div>
  );
}
