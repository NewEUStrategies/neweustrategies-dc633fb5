// Post grid renderer respecting settings (columns, list_style).
import { Fragment } from "react";
import { PostListCard } from "@/components/molecules/PostListCard";
import { Newspaper } from "@/lib/lucide-shim";
import type { BlogListItem } from "@/lib/queries/public";
import type { ArchiveLayoutSettings } from "@/lib/archive-layout-settings";

const COL_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
};

export function ArchivePosts({
  posts,
  lang,
  settings,
  emptyText,
  renderAfterCard,
}: {
  posts: readonly BlogListItem[];
  lang: "pl" | "en";
  settings: ArchiveLayoutSettings;
  emptyText: string;
  /** In-feed insert po karcie o danym indeksie (reklamy "co N kart"). */
  renderAfterCard?: (index: number) => React.ReactNode;
}) {
  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
        <Newspaper className="h-8 w-8 text-muted-foreground/70" aria-hidden />
        <p className="text-sm text-muted-foreground max-w-sm">{emptyText}</p>
      </div>
    );
  }
  if (settings.list_style === "list") {
    return (
      <ul className="divide-y divide-border rounded-xl border border-border bg-card/40 overflow-hidden">
        {posts.map((p, idx) => {
          const after = renderAfterCard?.(idx);
          return (
            <Fragment key={p.id}>
              <li className="p-4 hover:bg-muted/30 transition">
                <PostListCard post={p} href={p.href} lang={lang} viewTransitionId={p.id} />
              </li>
              {after && <li className="p-4 flex justify-center bg-muted/10">{after}</li>}
            </Fragment>
          );
        })}
      </ul>
    );
  }
  if (settings.list_style === "masonry") {
    return (
      <div className="columns-1 md:columns-2 lg:columns-3 gap-6 [column-fill:_balance]">
        {posts.map((p, idx) => {
          const after = renderAfterCard?.(idx);
          return (
            <Fragment key={p.id}>
              <div className="break-inside-avoid mb-6">
                <PostListCard post={p} href={p.href} lang={lang} viewTransitionId={p.id} />
              </div>
              {after && <div className="break-inside-avoid mb-6 flex justify-center">{after}</div>}
            </Fragment>
          );
        })}
      </div>
    );
  }
  return (
    <div className={`grid gap-6 ${COL_CLASS[settings.columns]}`}>
      {posts.map((p, idx) => {
        const after = renderAfterCard?.(idx);
        return (
          <Fragment key={p.id}>
            <PostListCard post={p} href={p.href} lang={lang} viewTransitionId={p.id} />
            {after && <div className="col-span-full flex justify-center py-2">{after}</div>}
          </Fragment>
        );
      })}
    </div>
  );
}
