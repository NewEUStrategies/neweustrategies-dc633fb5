// Live Blog block - public renderer. Subskrybuje Supabase realtime
// (postgres_changes) i pokazuje wpisy posortowane wg occurred_at.
// Initial fetch przez współdzielone liveBlogEntriesBlockQueryOptions
// (SSR-prefetchowalne przez blockQueryOptionsList; realtime nadpisuje ten sam
// cache przez setQueryData na identycznym kluczu), channel posprzątany na
// unmount. To jedyny blok, który utrzymuje websocket dla czytelników - relacja
// na żywo tego wymaga.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sanitizeHtml } from "@/lib/sanitize";
import { supabase } from "@/integrations/supabase/client";
import { liveBlogEntriesBlockQueryOptions, type LiveBlogEntryRow } from "@/lib/queries/blocks";

const LABELS = {
  pl: {
    live: "Na żywo",
    empty: "Brak wpisów na żywo.",
    pinned: "Przypięte",
    refreshing: "Odświeżanie...",
  },
  en: {
    live: "Live",
    empty: "No live entries yet.",
    pinned: "Pinned",
    refreshing: "Refreshing...",
  },
} as const;

/** Public row shape - the single source lives in the shared query module. */
export type LiveBlogEntry = LiveBlogEntryRow;

interface Props {
  postId: string;
  blockId: string;
  lang: "pl" | "en";
  title?: string;
  reverseChronological?: boolean;
  autoRefresh?: boolean;
}

function fmtTime(iso: string, lang: "pl" | "en"): string {
  try {
    return new Date(iso).toLocaleString(lang === "en" ? "en-US" : "pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    });
  } catch {
    return iso;
  }
}

// Relative label ("2 min temu" / "2 min ago"); the absolute time stays in the
// row's title=. `now` is threaded from a 30s tick so labels stay fresh without
// every row owning its own timer.
function fmtRelative(iso: string, lang: "pl" | "en", now: number): string {
  try {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return fmtTime(iso, lang);
    const rtf = new Intl.RelativeTimeFormat(lang === "en" ? "en" : "pl", {
      numeric: "auto",
      style: "short",
    });
    const diffSec = Math.round((then - now) / 1000);
    if (Math.abs(diffSec) < 45) return rtf.format(diffSec, "second");
    const diffMin = Math.round(diffSec / 60);
    if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
    const diffHr = Math.round(diffSec / 3600);
    if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
    return rtf.format(Math.round(diffSec / 86400), "day");
  } catch {
    return fmtTime(iso, lang);
  }
}

export function LiveBlogBlock({
  postId,
  blockId,
  lang,
  title,
  reverseChronological = true,
  autoRefresh = true,
}: Props) {
  const L = LABELS[lang] ?? LABELS.pl;
  const qc = useQueryClient();
  const [pulsing, setPulsing] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Shared query options: the SSR prefetch (blockQueryOptionsList) warms the
  // exact same key, so hydration reads the cache instead of flashing "empty".
  const queryOpts = useMemo(
    () => liveBlogEntriesBlockQueryOptions({ postId, blockId, lang, reverseChronological }),
    [postId, blockId, lang, reverseChronological],
  );
  const { data } = useQuery(queryOpts);
  const entries = useMemo(() => data ?? [], [data]);

  // Refresh relative timestamps every 30s (interval cleared on unmount).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // realtime subscription - merges live changes into the SAME cache entry
  // (queryOpts.queryKey), so refetches never clobber pushes and vice versa.
  useEffect(() => {
    if (!autoRefresh) return;
    const channel = supabase
      .channel(`liveblog:${postId}:${blockId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_blog_entries",
          filter: `post_id=eq.${postId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as LiveBlogEntry | undefined;
          if (!row || row.block_id !== blockId || row.lang !== lang) return;
          setPulsing(true);
          setTimeout(() => setPulsing(false), 800);
          if (payload.eventType === "INSERT") {
            setHighlightId(row.id);
            // Let the new-row highlight fade out shortly after it lands.
            setTimeout(() => setHighlightId((cur) => (cur === row.id ? null : cur)), 2400);
          }
          qc.setQueryData<LiveBlogEntry[]>(queryOpts.queryKey, (prev = []) => {
            if (payload.eventType === "DELETE") return prev.filter((e) => e.id !== row.id);
            const next = prev.filter((e) => e.id !== row.id).concat(payload.new as LiveBlogEntry);
            next.sort((a, b) =>
              reverseChronological
                ? b.occurred_at.localeCompare(a.occurred_at)
                : a.occurred_at.localeCompare(b.occurred_at),
            );
            return next;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId, blockId, lang, reverseChronological, autoRefresh, qc, queryOpts]);

  const sorted = useMemo(() => {
    const pinned = entries.filter((e) => e.pinned);
    const rest = entries.filter((e) => !e.pinned);
    return { pinned, rest };
  }, [entries]);

  return (
    <section
      className="not-prose my-6 rounded-xl border border-border bg-card/50 overflow-hidden"
      aria-live="polite"
      data-block="liveblog"
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          {/* LIVE dot: pulses continuously while mounted; a ping ring bursts on
              each realtime change. */}
          <span className="relative inline-flex h-2.5 w-2.5" aria-hidden>
            {pulsing && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" />
            )}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
          </span>
          <span className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
            {L.live}
          </span>
          {title ? <h3 className="text-sm font-medium text-foreground">{title}</h3> : null}
        </div>
        {pulsing && <span className="text-xs text-muted-foreground">{L.refreshing}</span>}
      </header>

      {entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{L.empty}</p>
      ) : (
        <ol className="divide-y divide-border">
          {sorted.pinned.length > 0 && (
            <li className="px-4 py-2 text-[10px] uppercase tracking-widest text-muted-foreground bg-muted/40">
              {L.pinned}
            </li>
          )}
          {sorted.pinned.map((e) => (
            <LiveEntryRow key={e.id} entry={e} lang={lang} now={now} isNew={e.id === highlightId} />
          ))}
          {sorted.rest.map((e) => (
            <LiveEntryRow key={e.id} entry={e} lang={lang} now={now} isNew={e.id === highlightId} />
          ))}
        </ol>
      )}
    </section>
  );
}

function LiveEntryRow({
  entry,
  lang,
  now,
  isNew,
}: {
  entry: LiveBlogEntry;
  lang: "pl" | "en";
  now: number;
  isNew: boolean;
}) {
  const html = sanitizeHtml(entry.body_html);
  return (
    <li
      className={`px-4 py-3 transition-colors duration-500 ${
        isNew ? "animate-in fade-in slide-in-from-top-2 bg-red-500/10" : ""
      }`}
      id={`lb-${entry.id}`}
    >
      <div className="flex items-baseline gap-3 mb-1">
        <time
          className="text-xs font-mono text-muted-foreground shrink-0"
          dateTime={entry.occurred_at}
          title={fmtTime(entry.occurred_at, lang)}
        >
          {fmtRelative(entry.occurred_at, lang, now)}
        </time>
        {entry.title && <h4 className="text-sm font-semibold text-foreground">{entry.title}</h4>}
      </div>
      <div
        className="prose prose-sm dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </li>
  );
}
