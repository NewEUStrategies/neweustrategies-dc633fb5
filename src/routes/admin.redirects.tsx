// Redirect manager (/admin/redirects) - the WP-migration control room:
// full CRUD over the `redirects` table (matched server-side by the request
// middleware), CSV import/export for bulk permalink maps, hit statistics and
// the 404 monitor with one-click "create redirect". Follows the admin CRUD
// conventions (dense table, Dialog editor, ConfirmDialog, sonner toasts).
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
  normalizeSourcePath,
  normalizeTargetPath,
  serializeRedirectsCsv,
  REDIRECT_STATUS_CODES,
  type RedirectStatusCode,
} from "@/lib/seo/redirects";

export const Route = createFileRoute("/admin/redirects")({
  component: RedirectsAdmin,
  head: () => ({ meta: [{ title: "Przekierowania - Admin" }] }),
});

interface RedirectRow {
  id: string;
  source_path: string;
  target_path: string;
  status_code: number;
  is_enabled: boolean;
  source: string;
  note: string | null;
  hit_count: number;
  last_hit_at: string | null;
  created_at: string;
}

interface Hit404Row {
  path: string;
  hits: number;
  first_seen: string;
  last_seen: string;
  last_referrer: string | null;
}

interface EditorState {
  id: string | null;
  source_path: string;
  target_path: string;
  status_code: RedirectStatusCode;
  is_enabled: boolean;
  note: string;
}

const EMPTY_EDITOR: EditorState = {
  id: null,
  source_path: "",
  target_path: "",
  status_code: 301,
  is_enabled: true,
  note: "",
};

const SOURCE_LABELS: Record<string, { pl: string; en: string }> = {
  manual: { pl: "ręczne", en: "manual" },
  slug_change: { pl: "zmiana sluga", en: "slug change" },
  wp_import: { pl: "import WP", en: "WP import" },
  csv_import: { pl: "import CSV", en: "CSV import" },
  quick_404: { pl: "z monitora 404", en: "from 404 monitor" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return iso.slice(0, 16).replace("T", " ");
}

function RedirectsAdmin() {
  const { t, i18n } = useTranslation();
  const isPL = !i18n.language.startsWith("en");
  const qc = useQueryClient();
  const upsert$ = useServerFn(upsertRedirect);
  const delete$ = useServerFn(deleteRedirects);
  const toggle$ = useServerFn(toggleRedirects);
  const importCsv$ = useServerFn(importRedirectsCsv);
  const dismiss404$ = useServerFn(dismissSeo404);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: redirects } = useQuery({
    queryKey: ["admin-redirects"],
    queryFn: async (): Promise<RedirectRow[]> => {
      const { data, error } = await supabase
        .from("redirects")
        .select(
          "id, source_path, target_path, status_code, is_enabled, source, note, hit_count, last_hit_at, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(2000);
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
      return (data ?? []).map((t) => t.domain).filter((d): d is string => !!d);
    },
  });

  const { data: hits404 } = useQuery({
    queryKey: ["admin-seo-404"],
    queryFn: async (): Promise<Hit404Row[]> => {
      const { data, error } = await supabase
        .from("seo_404_hits")
        .select("path, hits, first_seen, last_seen, last_referrer")
        .order("hits", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (redirects ?? []).filter((r) => {
      if (statusFilter === "enabled" && !r.is_enabled) return false;
      if (statusFilter === "disabled" && r.is_enabled) return false;
      if (!q) return true;
      return (
        r.source_path.toLowerCase().includes(q) ||
        r.target_path.toLowerCase().includes(q) ||
        (r.note ?? "").toLowerCase().includes(q)
      );
    });
  }, [redirects, search, statusFilter]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-redirects"] });
    qc.invalidateQueries({ queryKey: ["admin-seo-404"] });
  };

  const save = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      await upsert$({
        data: {
          id: editor.id ?? undefined,
          fields: {
            source_path: editor.source_path,
            target_path: editor.target_path || "/",
            status_code: editor.status_code,
            is_enabled: editor.is_enabled,
            note: editor.note || null,
          },
        },
      });
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
      title: t("admin.redirects.confirmDelete", { defaultValue: "Usunąć przekierowanie?" }),
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
    const csv = serializeRedirectsCsv(redirects ?? []);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "redirects.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (file: File) => {
    setImporting(true);
    try {
      const csv = await file.text();
      const result = await importCsv$({ data: { csv } });
      toast.success(
        t("admin.redirects.imported", {
          defaultValue: "Zaimportowano {{count}} przekierowań",
          count: result.imported,
        }) +
          (result.issues.length
            ? ` (${result.issues.length} ${isPL ? "pominiętych wierszy" : "rows skipped"})`
            : ""),
      );
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const createFrom404 = (hit: Hit404Row) => {
    setEditor({ ...EMPTY_EDITOR, source_path: hit.path });
  };

  const dismiss404 = async (hit: Hit404Row) => {
    try {
      await dismiss404$({ data: { paths: [hit.path] } });
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const normalizedSource = editor ? normalizeSourcePath(editor.source_path) : null;
  const normalizedTarget = editor
    ? normalizeTargetPath(editor.target_path, tenantDomains ?? [])
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2">
            <LinkIcon className="w-6 h-6" />
            {t("admin.redirects.title", { defaultValue: "Przekierowania" })}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("admin.redirects.subtitle", {
              defaultValue:
                "301/302/410, wildcardy i monitor 404 - stare adresy (np. z WordPressa) zawsze trafiają w nowe URL-e.",
            })}
          </p>
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
            {t("admin.redirects.importCsv", { defaultValue: "Import CSV" })}
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!redirects?.length}>
            <Download className="w-4 h-4 mr-1.5" />
            {t("admin.redirects.exportCsv", { defaultValue: "Eksport CSV" })}
          </Button>
          <Button size="sm" onClick={() => setEditor({ ...EMPTY_EDITOR })}>
            <Plus className="w-4 h-4 mr-1.5" />
            {t("admin.new")}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">
            {t("admin.redirects.tabRules", { defaultValue: "Reguły" })}
            <span className="ml-1.5 text-[10px] text-muted-foreground">
              ({redirects?.length ?? 0})
            </span>
          </TabsTrigger>
          <TabsTrigger value="404s">
            <AlertTriangle className="w-3.5 h-3.5 mr-1" />
            {t("admin.redirects.tab404", { defaultValue: "Ostatnie 404" })}
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
              placeholder={t("admin.redirects.searchPlaceholder", {
                defaultValue: "Szukaj po adresie lub notatce…",
              })}
              className="max-w-xs h-8 text-xs"
            />
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter(v === "enabled" ? "enabled" : v === "disabled" ? "disabled" : "all")
              }
            >
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("admin.redirects.filterAll", { defaultValue: "Wszystkie" })}
                </SelectItem>
                <SelectItem value="enabled">
                  {t("admin.redirects.filterEnabled", { defaultValue: "Włączone" })}
                </SelectItem>
                <SelectItem value="disabled">
                  {t("admin.redirects.filterDisabled", { defaultValue: "Wyłączone" })}
                </SelectItem>
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
                  <th className="p-2 text-left">
                    {t("admin.redirects.colSource", { defaultValue: "Stary adres" })}
                  </th>
                  <th className="p-2 text-left">
                    {t("admin.redirects.colTarget", { defaultValue: "Cel" })}
                  </th>
                  <th className="p-2 text-center w-14">
                    {t("admin.redirects.colCode", { defaultValue: "Kod" })}
                  </th>
                  <th className="p-2 text-left w-24">
                    {t("admin.redirects.colOrigin", { defaultValue: "Źródło" })}
                  </th>
                  <th className="p-2 text-right w-16">
                    {t("admin.redirects.colHits", { defaultValue: "Trafienia" })}
                  </th>
                  <th className="p-2 text-left w-28">
                    {t("admin.redirects.colLastHit", { defaultValue: "Ostatnie" })}
                  </th>
                  <th className="p-2 text-center w-14">
                    {t("admin.redirects.colActive", { defaultValue: "Aktywne" })}
                  </th>
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
                        {row.status_code === 410 ? (
                          <span className="text-destructive">410 Gone</span>
                        ) : (
                          row.target_path
                        )}
                      </span>
                    </td>
                    <td className="p-2 text-center">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${row.status_code === 410 ? "bg-destructive/10 text-destructive" : "bg-muted"}`}
                      >
                        {row.status_code}
                      </span>
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {SOURCE_LABELS[row.source]
                        ? isPL
                          ? SOURCE_LABELS[row.source].pl
                          : SOURCE_LABELS[row.source].en
                        : row.source}
                    </td>
                    <td className="p-2 text-right tabular-nums">{row.hit_count}</td>
                    <td className="p-2 text-muted-foreground">{formatDate(row.last_hit_at)}</td>
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
                        onClick={() =>
                          setEditor({
                            id: row.id,
                            source_path: row.source_path,
                            target_path: row.target_path,
                            status_code: (REDIRECT_STATUS_CODES as readonly number[]).includes(
                              row.status_code,
                            )
                              ? (row.status_code as RedirectStatusCode)
                              : 301,
                            is_enabled: row.is_enabled,
                            note: row.note ?? "",
                          })
                        }
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
                      {redirects?.length
                        ? t("admin.list.noResults", { defaultValue: "Brak wyników dla filtrów" })
                        : t("admin.redirects.empty", {
                            defaultValue:
                              "Brak przekierowań - dodaj pierwsze lub zaimportuj CSV z mapą starych adresów.",
                          })}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("admin.redirects.wildcardHint", {
              defaultValue:
                "Wskazówka: końcówka /* tworzy regułę wildcard, np. /stara-sekcja/* → /nowa-sekcja/* przenosi całe drzewo adresów.",
            })}
          </p>
        </TabsContent>

        <TabsContent value="404s" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            {t("admin.redirects.hint404", {
              defaultValue:
                "Adresy, które ostatnio zwróciły 404 - po migracji z WordPressa to najszybszy sposób na wyłapanie utraconych linków.",
            })}
          </p>
          <div className="bg-card border border-border rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground tracking-wide">
                <tr>
                  <th className="p-2 text-left">
                    {t("admin.redirects.colPath", { defaultValue: "Adres" })}
                  </th>
                  <th className="p-2 text-right w-16">
                    {t("admin.redirects.colHits", { defaultValue: "Trafienia" })}
                  </th>
                  <th className="p-2 text-left w-28">
                    {t("admin.redirects.colLastSeen", { defaultValue: "Ostatnio" })}
                  </th>
                  <th className="p-2 text-left max-w-[200px]">
                    {t("admin.redirects.colReferrer", { defaultValue: "Referrer" })}
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
                    <td className="p-2 text-muted-foreground">{formatDate(hit.last_seen)}</td>
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
                        onClick={() => createFrom404(hit)}
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        {t("admin.redirects.create", { defaultValue: "Utwórz przekierowanie" })}
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
                      {t("admin.redirects.empty404", {
                        defaultValue: "Brak zarejestrowanych 404 - to dobrze!",
                      })}
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
              {editor?.id
                ? t("admin.redirects.editTitle", { defaultValue: "Edytuj przekierowanie" })
                : t("admin.redirects.newTitle", { defaultValue: "Nowe przekierowanie" })}
            </DialogTitle>
          </DialogHeader>
          {editor && (
            <div className="space-y-3">
              <div>
                <Label>
                  {t("admin.redirects.fieldSource", { defaultValue: "Stary adres (źródło)" })}
                </Label>
                <Input
                  value={editor.source_path}
                  onChange={(e) => setEditor({ ...editor, source_path: e.target.value })}
                  placeholder="/2023/05/stary-wpis/ lub /stara-sekcja/*"
                  className="font-mono"
                />
                {editor.source_path.trim() && (
                  <p className="text-[10px] mt-1 text-muted-foreground">
                    {normalizedSource
                      ? `→ ${normalizedSource}`
                      : t("admin.redirects.invalidSource", {
                          defaultValue: "Nieprawidłowy adres źródłowy",
                        })}
                  </p>
                )}
              </div>
              {editor.status_code !== 410 && (
                <div>
                  <Label>
                    {t("admin.redirects.fieldTarget", { defaultValue: "Nowy adres (cel)" })}
                  </Label>
                  <Input
                    value={editor.target_path}
                    onChange={(e) => setEditor({ ...editor, target_path: e.target.value })}
                    placeholder="/nowa-sekcja/nowy-wpis lub https://…"
                    className="font-mono"
                  />
                  {editor.target_path.trim() && (
                    <p className="text-[10px] mt-1 text-muted-foreground">
                      {normalizedTarget
                        ? `→ ${normalizedTarget}`
                        : t("admin.redirects.invalidTarget", {
                            defaultValue: "Nieprawidłowy adres docelowy",
                          })}
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("admin.redirects.fieldCode", { defaultValue: "Kod HTTP" })}</Label>
                  <Select
                    value={String(editor.status_code)}
                    onValueChange={(v) => {
                      const code = Number(v);
                      setEditor({
                        ...editor,
                        status_code: (REDIRECT_STATUS_CODES as readonly number[]).includes(code)
                          ? (code as RedirectStatusCode)
                          : 301,
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="301">
                        301 - {t("admin.redirects.code301", { defaultValue: "trwałe (SEO)" })}
                      </SelectItem>
                      <SelectItem value="302">
                        302 - {t("admin.redirects.code302", { defaultValue: "tymczasowe" })}
                      </SelectItem>
                      <SelectItem value="307">
                        307 -{" "}
                        {t("admin.redirects.code307", { defaultValue: "tymczasowe (metoda)" })}
                      </SelectItem>
                      <SelectItem value="308">
                        308 - {t("admin.redirects.code308", { defaultValue: "trwałe (metoda)" })}
                      </SelectItem>
                      <SelectItem value="410">
                        410 - {t("admin.redirects.code410", { defaultValue: "treść usunięta" })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-between gap-2 pb-1">
                  <Label>{t("admin.redirects.colActive", { defaultValue: "Aktywne" })}</Label>
                  <Switch
                    checked={editor.is_enabled}
                    onCheckedChange={(v) => setEditor({ ...editor, is_enabled: v })}
                  />
                </div>
              </div>
              <div>
                <Label>{t("admin.redirects.fieldNote", { defaultValue: "Notatka" })}</Label>
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
            <Button
              onClick={save}
              disabled={
                saving || !normalizedSource || (editor?.status_code !== 410 && !normalizedTarget)
              }
            >
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
