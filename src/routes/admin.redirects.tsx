// Redirect manager (/admin/redirects) - the WP-migration control room:
// full CRUD over the `redirects` table (matched server-side by the request
// middleware), CSV import/export for bulk permalink maps, hit statistics and
// the 404 monitor with one-click "create redirect". Follows the admin CRUD
// conventions (dense table, Dialog editor, ConfirmDialog, sonner toasts).
//
// The rules this screen carries (query shape, filtering, form validation, the
// save payload, CSV export and the labels) live in the pure module
// `@/components/admin/post-editor/lib/redirectsAdmin` - this file is their
// composition with react-query, i18n and Radix.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import {
  AlertTriangle,
  ArrowRight,
  Download,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "@/lib/lucide-shim";
import {
  deleteRedirects,
  dismissSeo404,
  importRedirectsCsv,
  toggleRedirects,
  upsertRedirect,
} from "@/lib/redirects.functions";
import {
  EMPTY_REDIRECT_EDITOR,
  HITS_404_COLUMNS,
  REDIRECTS_INVALIDATE_KEYS,
  REDIRECTS_LIST_COLUMNS,
  applyHits404Query,
  applyRedirectsListQuery,
  editorStateFromHit,
  editorStateFromRow,
  filterRedirects,
  formatRedirectStamp,
  importSkippedSuffix,
  isGoneCode,
  normalizationHint,
  redirectDraftValidity,
  redirectSourceLabel,
  redirectUpsertInput,
  redirectsCsvDownload,
  redirectsEmptyStateKey,
  showsTargetField,
  statusFilterFromSelect,
  tenantDomainsOf,
  withStatusCode,
  type RedirectEditorState,
  type RedirectRow,
  type RedirectsListFilter,
  type Seo404Row,
} from "@/components/admin/post-editor/lib/redirectsAdmin";

export const Route = createFileRoute("/admin/redirects")({
  component: RedirectsAdmin,
  head: () => ({ meta: [{ title: "Przekierowania - Admin" }] }),
});

function RedirectsAdmin() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const upsert$ = useServerFn(upsertRedirect);
  const delete$ = useServerFn(deleteRedirects);
  const toggle$ = useServerFn(toggleRedirects);
  const importCsv$ = useServerFn(importRedirectsCsv);
  const dismiss404$ = useServerFn(dismissSeo404);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RedirectsListFilter["status"]>("all");
  const [editor, setEditor] = useState<RedirectEditorState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: redirects } = useQuery({
    queryKey: ["admin-redirects"],
    queryFn: async (): Promise<RedirectRow[]> => {
      const { data, error } = await applyRedirectsListQuery(
        supabase.from("redirects").select(REDIRECTS_LIST_COLUMNS),
      );
      if (error) throw error;
      return data ?? [];
    },
  });

  // Own tenant domains - the only hosts an absolute target may point at
  // (mirrors the server-side allowlist, so the live preview and the actual
  // validation in upsertRedirect always agree).
  const { data: tenantDomains } = useQuery({
    queryKey: ["admin-tenant-domains"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data } = await supabase.from("tenants").select("domain");
      return tenantDomainsOf(data);
    },
  });

  const { data: hits404 } = useQuery({
    queryKey: ["admin-seo-404"],
    queryFn: async (): Promise<Seo404Row[]> => {
      const { data, error } = await applyHits404Query(
        supabase.from("seo_404_hits").select(HITS_404_COLUMNS),
      );
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(
    () => filterRedirects(redirects, { search, status: statusFilter }),
    [redirects, search, statusFilter],
  );

  const invalidate = () => {
    for (const queryKey of REDIRECTS_INVALIDATE_KEYS) qc.invalidateQueries({ queryKey });
  };

  const save = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      await upsert$({ data: redirectUpsertInput(editor) });
      toast.success(t("admin.saved"));
      setEditor(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const del = (row: RedirectRow) => {
    setConfirmState({
      title: t("admin.redirects.confirmDelete"),
      description: `${row.source_path} → ${row.target_path}`,
      confirmLabel: t("admin.delete"),
      destructive: true,
      onConfirm: async () => {
        try {
          await delete$({ data: { ids: [row.id] } });
          toast.success(t("admin.deleted"));
          invalidate();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const toggle = async (row: RedirectRow, next: boolean) => {
    try {
      await toggle$({ data: { ids: [row.id], is_enabled: next } });
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const exportCsv = () => {
    const file = redirectsCsvDownload(redirects ?? []);
    const blob = new Blob([file.content], { type: file.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (file: File) => {
    setImporting(true);
    try {
      const csv = await file.text();
      const result = await importCsv$({ data: { csv } });
      toast.success(
        t("admin.redirects.imported", { count: result.imported }) +
          importSkippedSuffix(result.issues.length, i18n.language),
      );
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const dismiss404 = async (hit: Seo404Row) => {
    try {
      await dismiss404$({ data: { paths: [hit.path] } });
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const draft = redirectDraftValidity(editor, tenantDomains ?? []);
  const sourceHint = normalizationHint(editor?.source_path ?? "", draft.source);
  const targetHint = normalizationHint(editor?.target_path ?? "", draft.target);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2">
            <LinkIcon className="w-6 h-6" />
            {t("admin.redirects.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("admin.redirects.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            {importing ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-1.5" />
            )}
            {t("admin.redirects.importCsv")}
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!redirects?.length}>
            <Download className="w-4 h-4 mr-1.5" />
            {t("admin.redirects.exportCsv")}
          </Button>
          <Button size="sm" onClick={() => setEditor({ ...EMPTY_REDIRECT_EDITOR })}>
            <Plus className="w-4 h-4 mr-1.5" />
            {t("admin.new")}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">
            {t("admin.redirects.tabRules")}
            <span className="ml-1.5 text-[10px] text-muted-foreground">
              ({redirects?.length ?? 0})
            </span>
          </TabsTrigger>
          <TabsTrigger value="404s">
            <AlertTriangle className="w-3.5 h-3.5 mr-1" />
            {t("admin.redirects.tab404")}
            <span className="ml-1.5 text-[10px] text-muted-foreground">
              ({hits404?.length ?? 0})
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("admin.redirects.searchPlaceholder")}
              className="max-w-xs h-8 text-xs"
            />
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(statusFilterFromSelect(v))}
            >
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("admin.redirects.filterAll")}</SelectItem>
                <SelectItem value="enabled">{t("admin.redirects.filterEnabled")}</SelectItem>
                <SelectItem value="disabled">{t("admin.redirects.filterDisabled")}</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {filtered.length} / {redirects?.length ?? 0}
            </span>
          </div>

          <div className="bg-card border border-border rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground tracking-wide">
                <tr>
                  <th className="p-2 text-left">{t("admin.redirects.colSource")}</th>
                  <th className="p-2 text-left">{t("admin.redirects.colTarget")}</th>
                  <th className="p-2 text-center w-14">{t("admin.redirects.colCode")}</th>
                  <th className="p-2 text-left w-24">{t("admin.redirects.colOrigin")}</th>
                  <th className="p-2 text-right w-16">{t("admin.redirects.colHits")}</th>
                  <th className="p-2 text-left w-28">{t("admin.redirects.colLastHit")}</th>
                  <th className="p-2 text-center w-14">{t("admin.redirects.colActive")}</th>
                  <th className="p-2 text-right w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/20">
                    <td className="p-2 font-mono max-w-[260px] truncate" title={row.source_path}>
                      {row.source_path}
                    </td>
                    <td className="p-2 font-mono max-w-[260px] truncate" title={row.target_path}>
                      <span className="inline-flex items-center gap-1">
                        <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        {isGoneCode(row.status_code) ? (
                          <span className="text-destructive">410 Gone</span>
                        ) : (
                          row.target_path
                        )}
                      </span>
                    </td>
                    <td className="p-2 text-center">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${isGoneCode(row.status_code) ? "bg-destructive/10 text-destructive" : "bg-muted"}`}
                      >
                        {row.status_code}
                      </span>
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {redirectSourceLabel(row.source, i18n.language)}
                    </td>
                    <td className="p-2 text-right tabular-nums">{row.hit_count}</td>
                    <td className="p-2 text-muted-foreground">
                      {formatRedirectStamp(row.last_hit_at)}
                    </td>
                    <td className="p-2 text-center">
                      <Switch
                        checked={row.is_enabled}
                        onCheckedChange={(v) => void toggle(row, v)}
                      />
                    </td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => setEditor(editorStateFromRow(row))}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => del(row)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-muted-foreground">
                      {t(redirectsEmptyStateKey(redirects?.length ?? 0))}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("admin.redirects.wildcardHint")}</p>
        </TabsContent>

        <TabsContent value="404s" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">{t("admin.redirects.hint404")}</p>
          <div className="bg-card border border-border rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground tracking-wide">
                <tr>
                  <th className="p-2 text-left">{t("admin.redirects.colPath")}</th>
                  <th className="p-2 text-right w-16">{t("admin.redirects.colHits")}</th>
                  <th className="p-2 text-left w-28">{t("admin.redirects.colLastSeen")}</th>
                  <th className="p-2 text-left max-w-[200px]">
                    {t("admin.redirects.colReferrer")}
                  </th>
                  <th className="p-2 text-right w-44" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(hits404 ?? []).map((hit) => (
                  <tr key={hit.path} className="hover:bg-muted/20">
                    <td className="p-2 font-mono max-w-[300px] truncate" title={hit.path}>
                      {hit.path}
                    </td>
                    <td className="p-2 text-right tabular-nums">{hit.hits}</td>
                    <td className="p-2 text-muted-foreground">
                      {formatRedirectStamp(hit.last_seen)}
                    </td>
                    <td
                      className="p-2 text-muted-foreground max-w-[200px] truncate"
                      title={hit.last_referrer ?? ""}
                    >
                      {hit.last_referrer ?? "-"}
                    </td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        onClick={() => setEditor(editorStateFromHit(hit))}
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        {t("admin.redirects.create")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 ml-1"
                        onClick={() => void dismiss404(hit)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {!hits404?.length && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-muted-foreground">
                      {t("admin.redirects.empty404")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editor?.id ? t("admin.redirects.editTitle") : t("admin.redirects.newTitle")}
            </DialogTitle>
          </DialogHeader>
          {editor && (
            <div className="space-y-3">
              <div>
                <Label>{t("admin.redirects.fieldSource")}</Label>
                <Input
                  value={editor.source_path}
                  onChange={(e) => setEditor({ ...editor, source_path: e.target.value })}
                  placeholder="/2023/05/stary-wpis/ lub /stara-sekcja/*"
                  className="font-mono"
                />
                {sourceHint.kind !== "none" && (
                  <p className="text-[10px] mt-1 text-muted-foreground">
                    {sourceHint.kind === "normalized"
                      ? sourceHint.text
                      : t("admin.redirects.invalidSource")}
                  </p>
                )}
              </div>
              {showsTargetField(editor.status_code) && (
                <div>
                  <Label>{t("admin.redirects.fieldTarget")}</Label>
                  <Input
                    value={editor.target_path}
                    onChange={(e) => setEditor({ ...editor, target_path: e.target.value })}
                    placeholder="/nowa-sekcja/nowy-wpis lub https://…"
                    className="font-mono"
                  />
                  {targetHint.kind !== "none" && (
                    <p className="text-[10px] mt-1 text-muted-foreground">
                      {targetHint.kind === "normalized"
                        ? targetHint.text
                        : t("admin.redirects.invalidTarget")}
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("admin.redirects.fieldCode")}</Label>
                  <Select
                    value={String(editor.status_code)}
                    onValueChange={(v) => setEditor(withStatusCode(editor, v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="301">301 - {t("admin.redirects.code301")}</SelectItem>
                      <SelectItem value="302">302 - {t("admin.redirects.code302")}</SelectItem>
                      <SelectItem value="307">307 - {t("admin.redirects.code307")}</SelectItem>
                      <SelectItem value="308">308 - {t("admin.redirects.code308")}</SelectItem>
                      <SelectItem value="410">410 - {t("admin.redirects.code410")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-between gap-2 pb-1">
                  <Label>{t("admin.redirects.colActive")}</Label>
                  <Switch
                    checked={editor.is_enabled}
                    onCheckedChange={(v) => setEditor({ ...editor, is_enabled: v })}
                  />
                </div>
              </div>
              <div>
                <Label>{t("admin.redirects.fieldNote")}</Label>
                <Textarea
                  value={editor.note}
                  onChange={(e) => setEditor({ ...editor, note: e.target.value })}
                  rows={2}
                  maxLength={500}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>
              {t("admin.cancel")}
            </Button>
            <Button onClick={save} disabled={saving || !draft.canSave}>
              {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
              {t("admin.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        state={confirmState}
        onOpenChange={(open) => {
          if (!open) setConfirmState(null);
        }}
      />
    </div>
  );
}
