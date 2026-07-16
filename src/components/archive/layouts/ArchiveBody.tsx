// Shared body composition: grid + optional sidebar + load-more + extras.
import { Button } from "@/components/ui/button";
import { ArchivePosts } from "./ArchivePosts";
import { ArchiveSidebar } from "./ArchiveSidebar";
import type { ArchiveLayoutProps } from "./types";

export function ArchiveBody(props: ArchiveLayoutProps) {
  const {
    settings,
    posts,
    lang,
    taxonomy,
    kind,
    canLoadMore,
    isPending,
    onLoadMore,
    emptyText,
    loadingText,
    loadMoreText,
    extraBelow,
  } = props;

  const withSidebar = settings.show_sidebar;
  const sidebarLeft = settings.sidebar_position === "left";

  const grid = (
    <div className="min-w-0 flex-1">
      <ArchivePosts posts={posts} lang={lang} settings={settings} emptyText={emptyText} />
      {canLoadMore && (
        <div className="flex justify-center pt-6">
          <Button variant="outline" disabled={isPending} onClick={onLoadMore}>
            {isPending ? loadingText : loadMoreText}
          </Button>
        </div>
      )}
      {extraBelow}
    </div>
  );

  const sidebar = withSidebar ? (
    <div className="w-full lg:w-[320px] shrink-0">
      <ArchiveSidebar
        widgets={settings.sidebar_widgets}
        lang={lang}
        taxonomyId={taxonomy.id}
        kind={kind}
        posts={posts}
      />
    </div>
  ) : null;

  if (!withSidebar) return grid;
  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {sidebarLeft ? sidebar : null}
      {grid}
      {sidebarLeft ? null : sidebar}
    </div>
  );
}
