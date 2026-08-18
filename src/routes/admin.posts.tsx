import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Undo2, X, AlertTriangle, Copy } from "@/lib/lucide-shim";
import { CalendarDays } from "lucide-react";
import {
  deletePost,
  duplicatePost,
  bulkDeletePosts,
  bulkUpdatePosts,
  restorePosts,
  purgePosts,
} from "@/lib/content.functions";
import { bulkMigratePostsToBlocks } from "@/lib/posts-migrate.functions";
import { toastBulkResult } from "@/lib/admin/bulkToast";
import { toast } from "sonner";
import { BulkActionsBar, type BulkStatus } from "@/components/admin/BulkActionsBar";
import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import {
  AdminListToolbar,
  type StatusFilter,
  type LangFilter,
} from "@/components/admin/molecules/AdminListToolbar";
import { LangCoverageBadges } from "@/components/admin/atoms/LangCoverageBadges";
import { StatusBadge } from "@/components/admin/atoms/StatusBadge";
import { useTenantAuthors, authorLabel } from "@/components/admin/hooks/useTenantAuthors";
import { AdminPagination } from "@/components/admin/molecules/AdminPagination";
import {
  POSTS_LIST_COLUMNS,
  POSTS_LIST_INVALIDATE_KEYS,
  PARITY_GAP_FILTERS,
  applyDeletedScope,
  applyMissingEnCountFilters,
  applyPostsListFilters,
  authorMapOf,
  authorOf,
  bulkStatusesFor,
  coverageOf,
  dialogTitleOf,
  emptyStateKey,
  filtersSignature,
  postsListQueryKey,
  rowTitleOf,
  selectAllState,
  shouldShowParityGap,
  toggleAllSelected,
  toggleSelected,
  viewLangFor,
  type PostsListFilters,
  type PostsListView,
} from "@/components/admin/post-editor/lib/postsListQuery";
import {
  confirmPurgeMany,
  confirmPurgeOne,
  confirmRestoreMany,
  confirmRestoreOne,
  confirmTrashMany,
  confirmTrashOne,
} from "@/components/admin/post-editor/lib/postsListDialogs";

export const Route = createFileRoute("/admin/posts")({
  component: PostsLayout,
});

function PostsLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (path !== "/admin/posts") return <Outlet />;
  return <PostsList />;
}

function PostsList() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language ?? "pl";
  const qc = useQueryClient();
  const { tenantId, isAdmin } = useAuth();
  const del$ = useServerFn(deletePost);
  const bulkDel$ = useServerFn(bulkDeletePosts);
  const bulkUpd$ = useServerFn(bulkUpdatePosts);
  const restore$ = useServerFn(restorePosts);
  const purge$ = useServerFn(purgePosts);
  const duplicate$ = useServerFn(duplicatePost);
  const navigate = useNavigate();
  const migrate$ = useServerFn(bulkMigratePostsToBlocks);
  const [view, setView] = useState<PostsListView>("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [langFilter, setLangFilter] = useState<LangFilter>("all");
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [trashFrom, setTrashFrom] = useState("");
  const [trashTo, setTrashTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  // Debounce the search box so server-side filtering fires per pause, not per
  // keystroke.
  const [searchDebounced, setSearchDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSearchDebounced(search), 250);
    return () => clearTimeout(id);
  }, [search]);

  const authorsQ = useTenantAuthors(tenantId);
  const authorMap = useMemo(() => authorMapOf(authorsQ.data), [authorsQ.data]);

  // Cały stan filtrów w jednym obiekcie - ten sam kształt czyta klucz cache
  // i budowniczy zapytania, więc nie da się dołożyć filtra bez dołożenia go
  // do klucza (a więc bez odświeżenia listy).
  const filters: PostsListFilters = useMemo(
    () => ({
      view,
      search: searchDebounced,
      status: statusFilter,
      lang: langFilter,
      author: authorFilter,
      trashFrom,
      trashTo,
      page,
      pageSize,
    }),
    [
      view,
      searchDebounced,
      statusFilter,
      langFilter,
      authorFilter,
      trashFrom,
      trashTo,
      page,
      pageSize,
    ],
  );

  const { data: postsResult, isLoading } = useQuery({
    enabled: !!tenantId,
    placeholderData: keepPreviousData,
    queryKey: postsListQueryKey(tenantId, filters),
    queryFn: async () => {
      // Opportunistic tick: flip due scheduled posts to published even when
      // pg_cron is unavailable (local/dev). Harmless no-op otherwise.
      await supabase.rpc("publish_due_posts").then(
        () => undefined,
        () => undefined,
      );
      const q = applyPostsListFilters(
        supabase
          .from("posts")
          .select(POSTS_LIST_COLUMNS, { count: "exact" })
          .eq("tenant_id", tenantId!),
        filters,
      );
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const { data: trashCount } = useQuery({
    enabled: !!tenantId,
    queryKey: ["admin-posts-trash-count", tenantId],
    queryFn: async () => {
      const { count, error } = await applyDeletedScope(
        supabase
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId!),
        "trash",
      );
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Parytet PL/EN: liczba OPUBLIKOWANYCH wpisów bez wersji EN (tytuł pusty).
  // Dwujęzyczność to strategiczny wyróżnik - licznik trzyma dryf parytetu na
  // widoku, a klik przełącza listę na te wpisy (statusFilter + langFilter).
  const { data: missingEnCount } = useQuery({
    enabled: !!tenantId,
    queryKey: ["admin-posts-missing-en-count", tenantId],
    queryFn: async () => {
      const { count, error } = await applyMissingEnCountFilters(
        supabase
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId!),
      );
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Unfiltered row count for the current view — distinguishes "view is empty"
  // from "filters excluded everything" now that the paginated result no longer
  // holds the full set.
  const { data: viewCount } = useQuery({
    enabled: !!tenantId,
    queryKey: ["admin-posts-view-count", tenantId, view],
    queryFn: async () => {
      const { count, error } = await applyDeletedScope(
        supabase
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId!),
        view,
      );
      if (error) throw error;
      return count ?? 0;
    },
  });

  const isTrash = view === "trash";

  // Rows + total now come straight from the server (filtered + paginated).
  const pagedPosts = useMemo(() => postsResult?.rows ?? [], [postsResult]);
  const total = postsResult?.count ?? 0;
  const allIds = useMemo(() => pagedPosts.map((p) => p.id), [pagedPosts]);
  // Zmiana KTÓREGOKOLWIEK filtra cofa listę na stronę 1 - patrz
  // `filtersSignature`. Numer strony świadomie nie wchodzi do podpisu.
  const filtersKey = filtersSignature(filters);
  useEffect(() => {
    setPage(1);
  }, [filtersKey]);
  const toggleOne = (id: string) => setSelected((prev) => toggleSelected(prev, id));
  const toggleAll = () => setSelected((prev) => toggleAllSelected(allIds, prev));
  const clear = () => setSelected(new Set());

  const invalidate = () => {
    for (const queryKey of POSTS_LIST_INVALIDATE_KEYS) qc.invalidateQueries({ queryKey });
  };

  // Widoczny język listy zależy od filtra językowego: gdy użytkownik wybierze
  // "Angielski" / "Tylko EN", tytuły oraz otwierana wersja edytora przełączają
  // się na EN. Analogicznie dla PL. Bez filtra - język UI.
  const viewLang = viewLangFor(langFilter, lang);

  // Duplikat -> szkic-kopia; od razu otwieramy edytor kopii (skraca pętlę
  // "powiel i popraw" dla powtarzalnych formatów).
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const duplicateOne = async (id: string) => {
    if (duplicating) return;
    setDuplicating(id);
    try {
      const created = await duplicate$({ data: { id } });
      toast.success(t("admin.list.duplicated"));
      invalidate();
      void navigate({ to: "/admin/posts/$slug", params: { slug: created.slug } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDuplicating(null);
    }
  };

  const del = (id: string, title: string) => {
    setConfirmState({
      ...confirmTrashOne(title),
      onConfirm: async () => {
        try {
          await del$({ data: { id } });
          toast.success(t("admin.bulkResult.trashedOne"));
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const onBulkDelete = () => {
    const ids = [...selected];
    setConfirmState({
      ...confirmTrashMany(ids.length),
      onConfirm: async () => {
        try {
          const res = await bulkDel$({ data: { ids } });
          toastBulkResult(t, res, "admin.bulkResult.trashed");
          clear();
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const onBulkStatus = async (status: BulkStatus) => {
    try {
      const ids = [...selected];
      const res = await bulkUpd$({ data: { ids, status } });
      toastBulkResult(t, res, "admin.bulkResult.updated");
      clear();
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const restoreOne = (id: string, title: string) => {
    setConfirmState({
      ...confirmRestoreOne(title),
      onConfirm: async () => {
        try {
          const res = await restore$({ data: { ids: [id] } });
          toastBulkResult(t, res, "admin.bulkResult.restoredOne");
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };
  const purgeOne = (id: string, title: string) => {
    setConfirmState({
      ...confirmPurgeOne(title),
      onConfirm: async () => {
        try {
          const res = await purge$({ data: { ids: [id] } });
          toastBulkResult(t, res, "admin.bulkResult.purgedOne");
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };
  const onBulkRestore = () => {
    const ids = [...selected];
    setConfirmState({
      ...confirmRestoreMany(ids.length),
      onConfirm: async () => {
        try {
          const res = await restore$({ data: { ids } });
          toastBulkResult(t, res, "admin.bulkResult.restored");
          clear();
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };
  const onBulkMigrate = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const res = await migrate$({ data: { ids } });
      toast.success(`Skonwertowano: ${res.migrated}/${res.total}`);
      clear();
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const onBulkPurge = () => {
    const ids = [...selected];
    setConfirmState({
      ...confirmPurgeMany(ids.length),
      onConfirm: async () => {
        try {
          const res = await purge$({ data: { ids } });
          toastBulkResult(t, res, "admin.bulkResult.purged");
          clear();
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("admin.posts.title")}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} {t("admin.posts.count")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin/import-wordpress">
            <Button size="sm" variant="outline" className="h-8 text-xs">
              {t("admin.posts.import_wp")}
            </Button>
          </Link>
          <Link to="/admin/posts/calendar">
            <Button size="sm" variant="outline">
              <CalendarDays className="w-4 h-4 mr-1.5" />
              {t("admin.calendar.title")}
            </Button>
          </Link>
          <Link to="/admin/posts/new">
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1.5" /> {t("admin.posts.new")}
            </Button>
          </Link>
        </div>
      </div>

      <Tabs
        value={view}
        onValueChange={(v) => {
          setView(v as PostsListView);
          clear();
        }}
        className="mb-3"
      >
        <TabsList className="h-8">
          <TabsTrigger value="active" className="text-xs h-7">
            {t("admin.list.tabs.all")}
          </TabsTrigger>
          <TabsTrigger value="trash" className="text-xs h-7">
            {t("admin.list.tabs.trash")}
            {typeof trashCount === "number" && trashCount > 0 ? ` (${trashCount})` : ""}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {shouldShowParityGap(view, missingEnCount) && (
        <button
          type="button"
          onClick={() => {
            setStatusFilter(PARITY_GAP_FILTERS.status);
            setLangFilter(PARITY_GAP_FILTERS.lang);
            setPage(PARITY_GAP_FILTERS.page);
          }}
          className="mb-3 inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {t("admin.list.enParityGap", {
              count: missingEnCount,
            })}
          </span>
          <span className="font-medium underline underline-offset-2">
            {t("admin.list.enParityShow")}
          </span>
        </button>
      )}

      <AdminListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder={t("admin.list.searchPosts")}
        status={statusFilter}
        onStatus={setStatusFilter}
        hideStatus={isTrash}
        lang={langFilter}
        onLang={setLangFilter}
        author={authorFilter}
        onAuthor={setAuthorFilter}
        authors={authorsQ.data ?? []}
        resultsCount={total}
        totalCount={viewCount}
      />

      {isTrash && (
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div className="flex flex-col">
            <label className="text-[10px] uppercase text-muted-foreground mb-1">
              {t("admin.list.deletedFrom")}
            </label>
            <Input
              type="date"
              value={trashFrom}
              onChange={(e) => setTrashFrom(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] uppercase text-muted-foreground mb-1">
              {t("admin.list.deletedTo")}
            </label>
            <Input
              type="date"
              value={trashTo}
              onChange={(e) => setTrashTo(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {isTrash ? (
          selected.size > 0 ? (
            <div className="flex items-center gap-2 p-2 border-b border-border bg-muted/30 text-xs">
              <span className="px-2">
                {t("admin.list.selected")}: {selected.size}
              </span>
              <Button size="sm" variant="outline" onClick={onBulkRestore} className="h-7 text-xs">
                <Undo2 className="w-3.5 h-3.5 mr-1.5" /> {t("admin.list.restore")}
              </Button>
              <Button size="sm" variant="destructive" onClick={onBulkPurge} className="h-7 text-xs">
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> {t("admin.list.purge")}
              </Button>
              <Button size="sm" variant="ghost" onClick={clear} className="ml-auto h-7">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : null
        ) : (
          <BulkActionsBar
            count={selected.size}
            onClear={clear}
            onApplyStatus={onBulkStatus}
            onDelete={onBulkDelete}
            onMigrateToBlocks={onBulkMigrate}
            statuses={bulkStatusesFor(isAdmin)}
          />
        )}
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-xs">…</div>
        ) : !total ? (
          <div className="p-10 text-center text-muted-foreground text-sm">
            {t(emptyStateKey(view, viewCount))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground tracking-wide">
                <tr>
                  <th className="p-2 w-8">
                    <Checkbox
                      checked={selectAllState(allIds, selected)}
                      onCheckedChange={toggleAll}
                      aria-label={t("admin.list.selectAll")}
                    />
                  </th>
                  <th className="text-left p-2">{t("admin.posts.titleCol")}</th>
                  <th className="text-left p-2 w-[110px]">{t("admin.list.lang.col")}</th>
                  <th className="text-left p-2 w-[120px]">{t("admin.list.author.col")}</th>
                  <th className="text-left p-2 w-[110px]">{t("admin.posts.status")}</th>
                  <th className="text-left p-2 w-[150px] hidden md:table-cell">
                    {isTrash ? t("admin.list.deletedAt") : t("admin.posts.updated")}
                  </th>
                  <th className="p-2 w-[90px]" />
                </tr>
              </thead>
              <tbody>
                {pagedPosts.map((p) => {
                  const cov = coverageOf(p);
                  const author = authorOf(p, authorMap);
                  return (
                    <tr
                      key={p.id}
                      className={`border-t border-border hover:bg-muted/20 ${selected.has(p.id) ? "bg-muted/30" : ""}`}
                    >
                      <td className="p-2">
                        <Checkbox
                          checked={selected.has(p.id)}
                          onCheckedChange={() => toggleOne(p.id)}
                          aria-label={t("admin.list.select")}
                        />
                      </td>
                      <td className="p-2">
                        {isTrash ? (
                          <>
                            <div className="font-medium text-[13px] truncate max-w-[420px]">
                              {rowTitleOf(p, viewLang) ?? (
                                <span className="italic text-muted-foreground">
                                  - {t("admin.list.untitled")} -
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate max-w-[420px]">
                              /{p.slug}
                            </div>
                          </>
                        ) : (
                          <Link
                            to="/admin/posts/$slug"
                            params={{ slug: p.slug }}
                            search={{ lang: viewLang }}
                            className="block group"
                          >
                            <div className="font-medium text-[13px] truncate max-w-[420px] text-[#231f20] dark:text-[#F8F6F4] group-hover:text-[#FDB078] group-hover:underline underline-offset-2">
                              {rowTitleOf(p, viewLang) ?? (
                                <span className="italic text-muted-foreground">
                                  - {t("admin.list.untitled")} -
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-[#231f20] dark:text-[#F8F6F4] truncate max-w-[420px] group-hover:text-[#FDB078] group-hover:underline">
                              /{p.slug}
                            </div>
                          </Link>
                        )}
                      </td>
                      <td className="p-2">
                        <LangCoverageBadges
                          pl={cov.pl}
                          en={cov.en}
                          missingTitlePl={t("admin.list.lang.missingPl")}
                          missingTitleEn={t("admin.list.lang.missingEn")}
                        />
                      </td>
                      <td
                        className="p-2 text-muted-foreground truncate max-w-[140px]"
                        title={authorLabel(author)}
                      >
                        {authorLabel(author)}
                      </td>
                      <td className="p-2">
                        <StatusBadge
                          status={p.status}
                          label={t(`admin.status.${p.status}`)}
                          title={
                            p.status === "scheduled" && p.publish_at
                              ? t("admin.workflow.scheduledFor", {
                                  date: new Date(p.publish_at).toLocaleString(lang),
                                })
                              : undefined
                          }
                        />
                        {p.status === "scheduled" && p.publish_at ? (
                          <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                            {new Date(p.publish_at).toLocaleString(lang)}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-2 hidden md:table-cell text-muted-foreground text-[11px] tabular-nums">
                        {new Date(
                          isTrash && p.deleted_at ? p.deleted_at : p.updated_at,
                        ).toLocaleString(lang)}
                      </td>
                      <td className="p-2 text-right">
                        <div className="flex justify-end gap-0.5">
                          {isTrash ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                title={t("admin.list.restore")}
                                onClick={() => restoreOne(p.id, dialogTitleOf(p, viewLang))}
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                title={t("admin.list.purge")}
                                onClick={() => purgeOne(p.id, dialogTitleOf(p, viewLang))}
                              >
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Link
                                to="/admin/posts/$slug"
                                params={{ slug: p.slug }}
                                search={{ lang: viewLang }}
                              >
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                              </Link>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                title={t("admin.list.duplicate")}
                                disabled={duplicating === p.id}
                                onClick={() => void duplicateOne(p.id)}
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                title={t("admin.list.toTrash")}
                                onClick={() => del(p.id, dialogTitleOf(p, viewLang))}
                              >
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <AdminPagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        state={confirmState}
        onOpenChange={(o) => {
          if (!o) setConfirmState(null);
        }}
      />
    </div>
  );
}
