import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Home, Undo2, X } from "@/lib/lucide-shim";
import {
  deletePage,
  bulkDeletePages,
  bulkUpdatePages,
  restorePages,
  purgePages,
} from "@/lib/content.functions";
import { toast } from "sonner";
import { BulkActionsBar, type BulkStatus } from "@/components/admin/BulkActionsBar";
import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { useSettings } from "@/lib/admin/useSettings";
import {
  AdminListToolbar,
  type StatusFilter,
  type LangFilter,
} from "@/components/admin/molecules/AdminListToolbar";
import { LangCoverageBadges } from "@/components/admin/atoms/LangCoverageBadges";
import { useTenantAuthors, authorLabel } from "@/components/admin/hooks/useTenantAuthors";

type Reading = {
  posts_per_page: number;
  homepage_mode: "latest_posts" | "static_page";
  homepage_page_slug: string;
  search_engine_visibility: boolean;
};
const READING_DEFAULTS: Reading = {
  posts_per_page: 10,
  homepage_mode: "latest_posts",
  homepage_page_slug: "",
  search_engine_visibility: true,
};

export const Route = createFileRoute("/admin/pages")({
  component: PagesLayout,
});

function PagesLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (path !== "/admin/pages") return <Outlet />;
  return <PagesList />;
}

type View = "active" | "trash";

function PagesList() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language ?? "pl";
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const del$ = useServerFn(deletePage);
  const bulkDel$ = useServerFn(bulkDeletePages);
  const bulkUpd$ = useServerFn(bulkUpdatePages);
  const restore$ = useServerFn(restorePages);
  const purge$ = useServerFn(purgePages);
  const [view, setView] = useState<View>("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [trashSearch, setTrashSearch] = useState("");
  const [trashFrom, setTrashFrom] = useState("");
  const [trashTo, setTrashTo] = useState("");

  const { data: pages, isLoading } = useQuery({
    enabled: !!tenantId,
    queryKey: ["admin-pages", tenantId, view],
    queryFn: async () => {
      let q = supabase
        .from("pages")
        .select("id, slug, title_pl, title_en, status, updated_at, deleted_at")
        .eq("tenant_id", tenantId!)
        .order(view === "trash" ? "deleted_at" : "updated_at", { ascending: false });
      q = view === "trash" ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const { data: trashCount } = useQuery({
    enabled: !!tenantId,
    queryKey: ["admin-pages-trash-count", tenantId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("pages")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .not("deleted_at", "is", null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const reading = useSettings<Reading>("reading", READING_DEFAULTS);
  const currentHome =
    reading.query.data?.homepage_mode === "static_page"
      ? reading.query.data?.homepage_page_slug ?? ""
      : "";

  const setAsHome = async (slug: string, title: string) => {
    const next: Reading = {
      ...(reading.query.data ?? READING_DEFAULTS),
      homepage_mode: "static_page",
      homepage_page_slug: slug,
    };
    try {
      await reading.save.mutateAsync(next);
      toast.success(`Ustawiono "${title || slug}" jako stronę główną`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const isTrash = view === "trash";

  const filteredPages = useMemo(() => {
    if (!pages) return [];
    if (!isTrash) return pages;
    const q = trashSearch.trim().toLowerCase();
    const fromTs = trashFrom ? new Date(trashFrom).getTime() : null;
    const toTs = trashTo ? new Date(trashTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    return pages.filter((p) => {
      if (q) {
        const t1 = (p.title_pl ?? "").toLowerCase();
        const t2 = (p.title_en ?? "").toLowerCase();
        const s = (p.slug ?? "").toLowerCase();
        if (!t1.includes(q) && !t2.includes(q) && !s.includes(q)) return false;
      }
      if (fromTs !== null || toTs !== null) {
        const d = p.deleted_at ? new Date(p.deleted_at).getTime() : 0;
        if (fromTs !== null && d < fromTs) return false;
        if (toTs !== null && d > toTs) return false;
      }
      return true;
    });
  }, [pages, isTrash, trashSearch, trashFrom, trashTo]);

  const allIds = useMemo(() => filteredPages.map((p) => p.id), [filteredPages]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allIds));
  const clear = () => setSelected(new Set());

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-pages"] });
    qc.invalidateQueries({ queryKey: ["admin-pages-trash-count"] });
  };

  const del = (id: string, title: string) => {
    setConfirmState({
      title: "Przenieść do kosza?",
      description: `Strona "${title}" zostanie przeniesiona do kosza. Możesz ją później przywrócić.`,
      confirmLabel: "Przenieś do kosza",
      destructive: true,
      onConfirm: async () => {
        try {
          await del$({ data: { id } });
          toast.success("Przeniesiono do kosza");
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
      title: `Przenieść do kosza ${ids.length} stron?`,
      description: "Zaznaczone strony zostaną przeniesione do kosza.",
      confirmLabel: "Przenieś do kosza",
      destructive: true,
      onConfirm: async () => {
        try {
          await bulkDel$({ data: { ids } });
          toast.success(`Przeniesiono do kosza: ${ids.length}`);
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
      await bulkUpd$({ data: { ids, status } });
      toast.success(`Zaktualizowano ${ids.length}`);
      clear();
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const restoreOne = (id: string, title: string) => {
    setConfirmState({
      title: "Przywrócić stronę?",
      description: `"${title}" zostanie przywrócona z kosza.`,
      confirmLabel: "Przywróć",
      onConfirm: async () => {
        try {
          await restore$({ data: { ids: [id] } });
          toast.success("Przywrócono");
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };
  const purgeOne = (id: string, title: string) => {
    setConfirmState({
      title: "Usunąć trwale?",
      description: `"${title}" zostanie nieodwracalnie usunięta. Tej operacji nie można cofnąć.`,
      confirmLabel: "Usuń trwale",
      destructive: true,
      onConfirm: async () => {
        try {
          await purge$({ data: { ids: [id] } });
          toast.success("Usunięto trwale");
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
      title: `Przywrócić ${ids.length} stron?`,
      description: "Zaznaczone strony zostaną przywrócone z kosza.",
      confirmLabel: "Przywróć",
      onConfirm: async () => {
        try {
          await restore$({ data: { ids } });
          toast.success(`Przywrócono: ${ids.length}`);
          clear();
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };
  const onBulkPurge = () => {
    const ids = [...selected];
    setConfirmState({
      title: `Usunąć trwale ${ids.length} stron?`,
      description: "Zaznaczone strony zostaną nieodwracalnie usunięte. Tej operacji nie można cofnąć.",
      confirmLabel: "Usuń trwale",
      destructive: true,
      onConfirm: async () => {
        try {
          await purge$({ data: { ids } });
          toast.success(`Usunięto trwale: ${ids.length}`);
          clear();
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const titleOf = (p: { title_pl: string | null; title_en: string | null; slug: string }) =>
    (lang === "en" ? p.title_en : p.title_pl) || p.slug;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold">{t("admin.pages.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{filteredPages.length} {t("admin.pages.count")}</p>
        </div>
        <Link to="/admin/pages/new">
          <Button><Plus className="w-4 h-4 mr-2" /> {t("admin.pages.new")}</Button>
        </Link>
      </div>

      <Tabs value={view} onValueChange={(v) => { setView(v as View); clear(); }} className="mb-4">
        <TabsList>
          <TabsTrigger value="active">Wszystkie</TabsTrigger>
          <TabsTrigger value="trash">
            Kosz{typeof trashCount === "number" && trashCount > 0 ? ` (${trashCount})` : ""}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isTrash && (
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Szukaj po tytule lub slugu…"
              value={trashSearch}
              onChange={(e) => setTrashSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-muted-foreground mb-1">Usunięto od</label>
            <Input type="date" value={trashFrom} onChange={(e) => setTrashFrom(e.target.value)} />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-muted-foreground mb-1">Usunięto do</label>
            <Input type="date" value={trashTo} onChange={(e) => setTrashTo(e.target.value)} />
          </div>
          {(trashSearch || trashFrom || trashTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setTrashSearch(""); setTrashFrom(""); setTrashTo(""); }}>
              <X className="w-4 h-4 mr-1" /> Wyczyść
            </Button>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {isTrash ? (
          selected.size > 0 ? (
            <div className="flex items-center gap-2 p-2 border-b border-border bg-muted/30 text-sm">
              <span className="px-2">Zaznaczono: {selected.size}</span>
              <Button size="sm" variant="outline" onClick={onBulkRestore}>
                <Undo2 className="w-4 h-4 mr-2" /> Przywróć
              </Button>
              <Button size="sm" variant="destructive" onClick={onBulkPurge}>
                <Trash2 className="w-4 h-4 mr-2" /> Usuń trwale
              </Button>
              <Button size="sm" variant="ghost" onClick={clear} className="ml-auto">
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : null
        ) : (
          <BulkActionsBar
            count={selected.size}
            onClear={clear}
            onApplyStatus={onBulkStatus}
            onDelete={onBulkDelete}
          />
        )}
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">...</div>
        ) : !filteredPages.length ? (
          <div className="p-12 text-center text-muted-foreground">
            {isTrash ? (pages?.length ? "Brak wyników dla filtrów" : "Kosz jest pusty") : t("admin.pages.empty")}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3 w-8">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    aria-label="Zaznacz wszystkie"
                  />
                </th>
                <th className="text-left p-3">{t("admin.posts.titleCol")}</th>
                <th className="text-left p-3">{t("admin.posts.status")}</th>
                <th className="text-left p-3 hidden md:table-cell">
                  {isTrash ? "Usunięto" : t("admin.posts.updated")}
                </th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filteredPages.map((p) => (
                <tr key={p.id} className={`border-t border-border hover:bg-muted/20 ${selected.has(p.id) ? "bg-muted/30" : ""}`}>
                  <td className="p-3">
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggleOne(p.id)}
                      aria-label="Zaznacz"
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{(lang === "en" ? p.title_en : p.title_pl) || <span className="italic text-muted-foreground">- bez tytułu -</span>}</div>
                      {!isTrash && currentHome === p.slug && (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <Home className="w-3 h-3" /> Strona główna
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">/{p.slug}</div>
                  </td>
                  <td className="p-3">
                    <Badge variant={p.status === "published" ? "default" : p.status === "draft" ? "secondary" : "outline"}>
                      {t(`admin.status.${p.status}`)}
                    </Badge>
                  </td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground text-xs">
                    {new Date((isTrash && p.deleted_at) ? p.deleted_at : p.updated_at).toLocaleString(lang)}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-1">
                      {isTrash ? (
                        <>
                          <Button size="sm" variant="ghost" title="Przywróć" onClick={() => restoreOne(p.id, titleOf(p))}>
                            <Undo2 className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Usuń trwale" onClick={() => purgeOne(p.id, titleOf(p))}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={currentHome === p.slug || reading.save.isPending || p.status !== "published"}
                            title={
                              p.status !== "published"
                                ? "Opublikuj stronę, aby ustawić ją jako główną"
                                : currentHome === p.slug
                                  ? "Już ustawiona jako strona główna"
                                  : "Ustaw jako stronę główną"
                            }
                            onClick={() => setAsHome(p.slug, (lang === "en" ? p.title_en : p.title_pl) ?? p.slug)}
                          >
                            <Home className={`w-4 h-4 ${currentHome === p.slug ? "text-primary" : ""}`} />
                          </Button>
                          <Link to="/admin/pages/$slug" params={{ slug: p.slug }}>
                            <Button size="sm" variant="ghost"><Pencil className="w-4 h-4" /></Button>
                          </Link>
                          <Button size="sm" variant="ghost" title="Do kosza" onClick={() => del(p.id, titleOf(p))}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog state={confirmState} onOpenChange={(o) => { if (!o) setConfirmState(null); }} />
    </div>
  );
}
