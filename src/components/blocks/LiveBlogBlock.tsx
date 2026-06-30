// Live Blog block - public renderer. Subskrybuje Supabase realtime
// (postgres_changes) i pokazuje wpisy posortowane wg occurred_at.
// SSR-friendly: pierwszy fetch w useEffect, channel posprzątany na unmount.
import { useEffect, useMemo, useState } from "react";
import { sanitizeHtml } from "@/lib/sanitize";
import { supabase } from "@/integrations/supabase/client";

const LABELS = {
  pl: { live: "Na żywo", empty: "Brak wpisów na żywo.", pinned: "Przypięte", refreshing: "Odświeżanie..." },
  en: { live: "Live", empty: "No live entries yet.", pinned: "Pinned", refreshing: "Refreshing..." },
} as const;

export interface LiveBlogEntry {
  id: string;
  post_id: string;
  block_id: string;
  lang: "pl" | "en";
  title: string | null;
  body_html: string;
  pinned: boolean;
  occurred_at: string;
}

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

export function LiveBlogBlock({
  postId,
  blockId,
  lang,
  title,
  reverseChronological = true,
  autoRefresh = true,
}: Props) {
  const L = LABELS[lang] ?? LABELS.pl;
  const [entries, setEntries] = useState<LiveBlogEntry[]>([]);
  const [pulsing, setPulsing] = useState(false);

  // initial fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("live_blog_entries")
        .select("id, post_id, block_id, lang, title, body_html, pinned, occurred_at")
        .eq("post_id", postId)
        .eq("block_id", blockId)
        .eq("lang", lang)
        .order("occurred_at", { ascending: !reverseChronological })
        .limit(200);
      if (!cancelled && data) setEntries(data as LiveBlogEntry[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [postId, blockId, lang, reverseChronological]);

  // realtime subscription
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
          setPulsing(true);
          setTimeout(() => setPulsing(false), 800);
          setEntries((prev) => {
            const row = (payload.new ?? payload.old) as LiveBlogEntry | undefined;
            if (!row || row.block_id !== blockId || row.lang !== lang) return prev;
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
  }, [postId, blockId, lang, reverseChronological, autoRefresh]);

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
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full bg-red-500 ${pulsing ? "animate-ping" : ""}`}
            aria-hidden
          />
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
            <LiveEntryRow key={e.id} entry={e} lang={lang} />
          ))}
          {sorted.rest.map((e) => (
            <LiveEntryRow key={e.id} entry={e} lang={lang} />
          ))}
        </ol>
      )}
    </section>
  );
}

function LiveEntryRow({ entry, lang }: { entry: LiveBlogEntry; lang: "pl" | "en" }) {
  const html = sanitizeHtml(entry.body_html);
  return (
    <li className="px-4 py-3" id={`lb-${entry.id}`}>
      <div className="flex items-baseline gap-3 mb-1">
        <time className="text-xs font-mono text-muted-foreground shrink-0">
          {fmtTime(entry.occurred_at, lang)}
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
