// Shared body composition: sort/pagination bar + grid + optional sidebar + extras.
import { useTranslation } from "react-i18next";
import { ArchivePosts } from "./ArchivePosts";
import { ArchiveSidebar } from "./ArchiveSidebar";
import { ArchiveToolbar } from "./ArchiveToolbar";
import { ArchivePagination } from "./ArchivePagination";
import type { ArchiveLayoutProps } from "./types";

export function ArchiveBody(props: ArchiveLayoutProps) {
  const {
    settings,
    posts,
    lang,
    taxonomy,
    kind,
    page,
    pageSize,
    total,
    sort,
    onPageChange,
    onSortChange,
    isPending,
    emptyText,
    extraBelow,
    previewMode,
  } = props;
  const { t } = useTranslation();
  const withSidebar = settings.show_sidebar;
  const sidebarLeft = settings.sidebar_position === "left";
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const grid = (
    <div className="min-w-0 flex-1">
      <ArchiveToolbar
        lang={lang}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        onSortChange={onSortChange}
        isPending={isPending}
        disabled={!!previewMode}
      />
      <ArchivePosts posts={posts} lang={lang} settings={settings} emptyText={emptyText} />
      {totalPages > 1 && (
        <div className="pt-8">
          <ArchivePagination
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
            isPending={isPending}
            lang={lang}
            disabled={!!previewMode}
            t={t}
          />
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
