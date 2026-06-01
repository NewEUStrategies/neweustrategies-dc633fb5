import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2 } from "@/lib/lucide-shim";
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !liveResults || q.trim().length < 2) {
      setResults([]);
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
      setLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, open, liveResults, limit, lang]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isFullscreen = mode === "fullscreen";
  const isDropdown = mode === "dropdown";

  const body = (
    <div className={isDropdown
      ? "absolute right-4 top-14 w-[min(92vw,420px)] bg-background border border-border rounded-lg shadow-lg z-50"
      : "w-full max-w-2xl"}>
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={heading || (lang === "pl" ? "Szukaj…" : "Search…")}
          className="flex-1 bg-transparent outline-none text-sm"
        />
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-muted">
          <X className="w-4 h-4" />
        </button>
      </div>
      {liveResults && q.trim().length >= 2 && (
        <ul className="max-h-[60vh] overflow-y-auto divide-y divide-border">
          {results.length === 0 && !loading && (
            <li className="px-4 py-6 text-sm text-muted-foreground text-center">
              {lang === "pl" ? "Brak wyników" : "No results"}
            </li>
          )}
          {results.map((r) => (
            <li key={r.id}>
              <a href={`/posts/${r.slug}`} onClick={onClose} className="block px-4 py-3 hover:bg-muted transition">
                <div className="text-sm font-semibold">{r.title}</div>
                {r.excerpt && <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{r.excerpt}</div>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (isDropdown) return body;

  return (
    <div
      className={`fixed inset-0 z-[60] flex ${isFullscreen ? "items-stretch" : "items-start pt-24"} justify-center bg-background/90 backdrop-blur-md p-4`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {isFullscreen ? (
        <div className="w-full max-w-3xl mx-auto pt-20">{body}</div>
      ) : body}
    </div>
  );
}
