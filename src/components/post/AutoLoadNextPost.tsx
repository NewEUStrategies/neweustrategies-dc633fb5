// AutoLoadNextPost - obserwuje koniec aktualnego artykułu i ładuje
// kolejny opublikowany wpis (chronologicznie wstecz) w obrębie tej
// samej strony nadrzędnej. Po dołączeniu - aktualizuje URL przez
// history.replaceState aby zachować shareability i poprawnie zliczać
// analitykę kolejnych odsłon. SSR-safe (cała logika w useEffect).
import { useEffect, useRef, useState } from "react";
import { fetchNextPost, type NextPostSummary } from "@/lib/queries/nextPost";
import { sanitizeMarkdownHtml } from "@/lib/sanitize";
import { AppLink } from "@/components/atoms/AppLink";

interface Props {
  currentPostId: string;
  parentPageId: string;
  currentPublishedAt: string | null;
  lang: "pl" | "en";
  /** Ile sekwencyjnych „kolejnych wpisów" pozwolić załadować. */
  maxChain?: number;
}

interface Loaded {
  post: NextPostSummary;
  appendedAt: number;
}

const LABELS = {
  pl: {
    loading: "Ładuję następny wpis...",
    end: "To już wszystkie wpisy.",
    next: "Następny artykuł",
  },
  en: { loading: "Loading next article...", end: "No more articles.", next: "Next article" },
} as const;

export function AutoLoadNextPost({
  currentPostId,
  parentPageId,
  currentPublishedAt,
  lang,
  maxChain = 5,
}: Props) {
  const L = LABELS[lang] ?? LABELS.pl;
  const [chain, setChain] = useState<Loaded[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestedRef = useRef(false);

  // current "cursor" = last loaded post or starting point
  const cursor =
    chain.length > 0
      ? {
          id: chain[chain.length - 1].post.id,
          publishedAt: chain[chain.length - 1].post.published_at,
        }
      : { id: currentPostId, publishedAt: currentPublishedAt };

  useEffect(() => {
    if (done || chain.length >= maxChain) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      async (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        if (requestedRef.current || loading) return;
        requestedRef.current = true;
        setLoading(true);
        try {
          const next = await fetchNextPost({
            currentPostId: cursor.id,
            parentPageId,
            currentPublishedAt: cursor.publishedAt,
          });
          if (!next) {
            setDone(true);
            return;
          }
          setChain((prev) => [...prev, { post: next, appendedAt: Date.now() }]);
        } finally {
          setLoading(false);
          requestedRef.current = false;
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor.id, cursor.publishedAt, parentPageId, done, loading, chain.length, maxChain]);

  // Update URL when the newest loaded post crosses the viewport top.
  useEffect(() => {
    if (chain.length === 0) return;
    const last = chain[chain.length - 1];
    const headingId = `nextpost-${last.post.id}`;
    const heading = typeof document !== "undefined" ? document.getElementById(headingId) : null;
    if (!heading) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && typeof window !== "undefined") {
            window.history.replaceState({}, "", last.post.href);
            document.title =
              lang === "en"
                ? last.post.title_en || last.post.title_pl
                : last.post.title_pl || last.post.title_en;
          }
        }
      },
      { threshold: 0.2 },
    );
    io.observe(heading);
    return () => io.disconnect();
  }, [chain, lang]);

  return (
    <div className="auto-load-next-post mt-12">
      {chain.map((c) => {
        const title =
          lang === "en" ? c.post.title_en || c.post.title_pl : c.post.title_pl || c.post.title_en;
        const html =
          lang === "en"
            ? c.post.content_en || c.post.content_pl
            : c.post.content_pl || c.post.content_en;
        return (
          <article key={c.post.id} className="border-t-2 border-border pt-10 mt-10">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{L.next}</p>
            <h2 id={`nextpost-${c.post.id}`} className="font-display text-3xl lg:text-4xl mb-4">
              <AppLink href={c.post.href} className="hover:text-primary">
                {title}
              </AppLink>
            </h2>
            {c.post.cover_image_url && (
              <img
                src={c.post.cover_image_url}
                alt={title}
                loading="lazy"
                className="w-full rounded-lg mb-6 max-h-[420px] object-cover"
              />
            )}
            {html && (
              <div
                className="single-post-content prose prose-lg dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: sanitizeMarkdownHtml(html) }}
              />
            )}
          </article>
        );
      })}

      <div ref={sentinelRef} aria-hidden className="h-px w-full" />

      {loading && (
        <p
          role="status"
          aria-live="polite"
          className="text-center text-sm text-muted-foreground py-6"
        >
          {L.loading}
        </p>
      )}
      {done && <p className="text-center text-xs text-muted-foreground py-6">{L.end}</p>}
    </div>
  );
}
