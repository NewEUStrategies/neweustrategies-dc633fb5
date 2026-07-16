// Dialog importu stron z WordPress.com.
// v2: podgląd konwersji, sparowanie PL/EN, nadpisywanie istniejących stron,
// auto-mirror mediów, ręczne nadpisanie sluga. Strona /main zawsze pominięta.
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Download, RefreshCw, Eye } from "lucide-react";
import { wpListPages, wpImportPages, listExistingPages } from "@/lib/wp-import.functions";
import { WordPressPreviewDialog } from "./WordPressPreviewDialog";
import { WxrUploadPanel } from "./WxrUploadPanel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface WpPage {
  ID: number;
  title: string;
  slug: string;
  status: string;
  URL: string;
  modified: string;
}

interface RowConfig {
  lang: "pl" | "en";
  pairedWith?: number; // wpId partnerskiej wersji językowej
  targetPageId?: string; // UUID w bazie do nadpisania
  slugOverride?: string;
}

function inferLang(slug: string, title: string): "pl" | "en" {
  const s = `${slug} ${title}`.toLowerCase();
  if (/-en$|^en-|\/en\/|\ben\b/.test(s)) return "en";
  return "pl";
}

export function WordPressImportDialog({ trigger }: { trigger: React.ReactNode }) {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();
  const listFn = useServerFn(wpListPages);
  const importFn = useServerFn(wpImportPages);
  const existingFn = useServerFn(listExistingPages);

  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("wp_import_domain") ?? "";
  });
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<WpPage[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rows, setRows] = useState<Record<number, RowConfig>>({});
  const [targetStatus, setTargetStatus] = useState<"draft" | "published">("draft");
  const [mirrorMedia, setMirrorMedia] = useState(true);
  const [includeExternal, setIncludeExternal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{ wpId: number; wpIdEn?: number } | null>(null);

  const { data: existingPagesResp } = useQuery({
    queryKey: ["wp-import-existing-pages"],
    enabled: open,
    queryFn: () => existingFn({ data: {} }),
    staleTime: 60_000,
  });
  const existingPages = existingPagesResp?.pages ?? [];

  useEffect(() => {
    // Auto-detect languages when pages first load.
    if (pages.length > 0 && Object.keys(rows).length === 0) {
      const next: Record<number, RowConfig> = {};
      for (const p of pages) next[p.ID] = { lang: inferLang(p.slug, p.title) };
      setRows(next);
    }
  }, [pages, rows]);

  const selectableCount = pages.filter((p) => p.slug !== "main").length;
  const summary = useMemo(() => {
    let create = 0;
    let overwrite = 0;
    let paired = 0;
    const seenPaired = new Set<number>();
    for (const id of selected) {
      const row = rows[id];
      if (!row) continue;
      if (row.pairedWith && !seenPaired.has(id) && !seenPaired.has(row.pairedWith)) {
        paired++;
        seenPaired.add(id);
        seenPaired.add(row.pairedWith);
      }
      if (row.targetPageId) overwrite++;
      else create++;
    }
    return { create, overwrite, paired };
  }, [selected, rows]);

  const fetchList = async () => {
    if (!/^[a-z0-9._-]+$/i.test(domain)) {
      toast.error(
        lang === "pl"
          ? "Podaj domenę WordPress.com (np. mojasite.wordpress.com)"
          : "Enter a WordPress.com domain (e.g. mysite.wordpress.com)",
      );
      return;
    }
    setLoading(true);
    setSelected(new Set());
    setRows({});
    try {
      window.localStorage.setItem("wp_import_domain", domain);
      const { pages: got } = await listFn({ data: { siteDomain: domain } });
      setPages(got);
      if (got.length === 0) {
        toast.info(lang === "pl" ? "Brak stron w tej witrynie." : "No pages found.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setRow = (id: number, patch: Partial<RowConfig>) =>
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { lang: "pl" }), ...patch } }));

  const runImport = async () => {
    if (selected.size === 0) return;
    // Zbudowanie itemów: sparowane PL/EN idą jako jeden item z plId+enId;
    // pojedyncze wybrane EN bez pary => jako item z plId=enId (traktowane jak PL).
    const items: Array<{
      plId: number;
      enId?: number;
      targetPageId?: string;
      slugOverride?: string;
    }> = [];
    const consumed = new Set<number>();
    for (const id of selected) {
      if (consumed.has(id)) continue;
      const row = rows[id];
      if (!row) continue;
      let plId = id;
      let enId: number | undefined;
      if (row.pairedWith && selected.has(row.pairedWith)) {
        const partner = rows[row.pairedWith];
        if (row.lang === "pl") {
          plId = id;
          enId = row.pairedWith;
        } else {
          plId = row.pairedWith;
          enId = id;
        }
        consumed.add(row.pairedWith);
      }
      consumed.add(id);
      const base = rows[plId] ?? row;
      items.push({
        plId,
        ...(enId ? { enId } : {}),
        ...(base.targetPageId ? { targetPageId: base.targetPageId } : {}),
        ...(base.slugOverride ? { slugOverride: base.slugOverride } : {}),
      });
    }

    setImporting(true);
    try {
      const { results } = await importFn({
        data: {
          siteDomain: domain,
          items,
          targetStatus,
          mirrorMedia,
          includeExternalMedia: includeExternal,
        },
      });
      const okCount = results.filter(
        (r) => r.status === "imported" || r.status === "overwritten",
      ).length;
      const overCount = results.filter((r) => r.status === "overwritten").length;
      const skippedCount = results.filter((r) => r.status === "skipped").length;
      const errCount = results.filter((r) => r.status === "error").length;
      const parts = [
        `${okCount} ${lang === "pl" ? "zaimportowanych" : "imported"}`,
        overCount > 0 ? `${overCount} ${lang === "pl" ? "nadpisań" : "overwrites"}` : "",
        skippedCount > 0 ? `${skippedCount} ${lang === "pl" ? "pominiętych" : "skipped"}` : "",
        errCount > 0 ? `${errCount} ${lang === "pl" ? "błędów" : "errors"}` : "",
      ].filter(Boolean);
      if (okCount > 0) toast.success(parts.join(" · "));
      else toast.warning(parts.join(" · "));
      for (const e of results.filter((r) => r.status === "error").slice(0, 3)) {
        toast.error(`WP #${e.wpId}: ${e.message ?? "unknown error"}`);
      }
      if (okCount > 0) {
        qc.invalidateQueries({ queryKey: ["admin-pages"] });
        qc.invalidateQueries({ queryKey: ["wp-import-existing-pages"] });
        setOpen(false);
        setSelected(new Set());
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {lang === "pl" ? "Import z WordPressa" : "Import from WordPress"}
            </DialogTitle>
            <DialogDescription>
              {lang === "pl"
                ? "Pobiera strony z WordPress.com, konwertuje (Elementor / Gutenberg / plain HTML) na widgety, opcjonalnie mirrorując media. Strona /main jest zawsze pomijana."
                : "Fetches pages from WordPress.com, converts (Elementor / Gutenberg / plain HTML) into widgets, optionally mirroring media. /main is always skipped."}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="connector">
            <TabsList className="mb-2">
              <TabsTrigger value="connector">
                {lang === "pl" ? "Konektor WordPress.com" : "WordPress.com connector"}
              </TabsTrigger>
              <TabsTrigger value="wxr">
                {lang === "pl" ? "Wgraj plik WXR (XML)" : "Upload WXR (XML)"}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="wxr">
              <WxrUploadPanel
                existingPages={existingPages}
                onImported={() => qc.invalidateQueries({ queryKey: ["admin-pages"] })}
                onClose={() => setOpen(false)}
              />
            </TabsContent>
            <TabsContent value="connector">
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label>{lang === "pl" ? "Domena WordPress.com" : "WordPress.com domain"}</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="mysite.wordpress.com"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value.trim())}
                      onKeyDown={(e) => e.key === "Enter" && fetchList()}
                    />
                    <Button onClick={fetchList} disabled={loading}>
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      <span className="ml-1">{lang === "pl" ? "Wczytaj" : "Load"}</span>
                    </Button>
                  </div>
                </div>

                {pages.length > 0 && (
                  <>
                    <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                      <span>
                        {lang === "pl"
                          ? `Wybrane: ${selected.size} / ${selectableCount}`
                          : `Selected: ${selected.size} / ${selectableCount}`}
                      </span>
                      <span className="text-emerald-700 dark:text-emerald-300">
                        {lang === "pl" ? `Nowe: ${summary.create}` : `New: ${summary.create}`}
                      </span>
                      <span className="text-sky-700 dark:text-sky-300">
                        {lang === "pl"
                          ? `Nadpisania: ${summary.overwrite}`
                          : `Overwrites: ${summary.overwrite}`}
                      </span>
                      <span className="text-amber-700 dark:text-amber-300">
                        {lang === "pl"
                          ? `Pary PL/EN: ${summary.paired}`
                          : `PL/EN pairs: ${summary.paired}`}
                      </span>
                      <div className="ml-auto flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={mirrorMedia}
                            onCheckedChange={setMirrorMedia}
                            id="mirror"
                          />
                          <Label htmlFor="mirror" className="cursor-pointer text-xs">
                            {lang === "pl" ? "Ściągaj media" : "Mirror media"}
                          </Label>
                        </div>
                        {mirrorMedia && (
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={includeExternal}
                              onCheckedChange={setIncludeExternal}
                              id="ext"
                            />
                            <Label htmlFor="ext" className="cursor-pointer text-xs">
                              {lang === "pl" ? "Także zewnętrzne CDN" : "Also external CDNs"}
                            </Label>
                          </div>
                        )}
                        <Select
                          value={targetStatus}
                          onValueChange={(v) => setTargetStatus(v as "draft" | "published")}
                        >
                          <SelectTrigger className="h-8 w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">draft</SelectItem>
                            <SelectItem value="published">published</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="max-h-[52vh] overflow-auto rounded-md border border-border">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted/60 text-xs uppercase text-muted-foreground">
                          <tr>
                            <th className="w-8 px-2 py-2"></th>
                            <th className="px-2 py-2 text-left">
                              {lang === "pl" ? "Strona" : "Page"}
                            </th>
                            <th className="w-20 px-2 py-2 text-left">
                              {lang === "pl" ? "Język" : "Lang"}
                            </th>
                            <th className="px-2 py-2 text-left">
                              {lang === "pl" ? "Sparuj z" : "Pair with"}
                            </th>
                            <th className="px-2 py-2 text-left">
                              {lang === "pl" ? "Nadpisz stronę" : "Overwrite"}
                            </th>
                            <th className="px-2 py-2 text-left">
                              {lang === "pl" ? "Slug" : "Slug"}
                            </th>
                            <th className="w-16 px-2 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {pages.map((p) => {
                            const isMain = p.slug === "main";
                            const row = rows[p.ID] ?? { lang: "pl" as const };
                            const otherLangPages = pages.filter(
                              (x) =>
                                x.ID !== p.ID &&
                                x.slug !== "main" &&
                                (rows[x.ID]?.lang ?? inferLang(x.slug, x.title)) !== row.lang,
                            );
                            return (
                              <tr
                                key={p.ID}
                                className={isMain ? "opacity-50" : "hover:bg-muted/20"}
                              >
                                <td className="px-2 py-1.5">
                                  <Checkbox
                                    checked={selected.has(p.ID)}
                                    disabled={isMain}
                                    onCheckedChange={() => toggle(p.ID)}
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <div
                                    className="max-w-[220px] truncate font-medium"
                                    title={p.title}
                                  >
                                    {p.title || `#${p.ID}`}
                                  </div>
                                  <div className="truncate text-xs text-muted-foreground">
                                    /{p.slug}
                                  </div>
                                </td>
                                <td className="px-2 py-1.5">
                                  <Select
                                    value={row.lang}
                                    onValueChange={(v) => setRow(p.ID, { lang: v as "pl" | "en" })}
                                    disabled={isMain}
                                  >
                                    <SelectTrigger className="h-7 w-16 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="pl">PL</SelectItem>
                                      <SelectItem value="en">EN</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="px-2 py-1.5">
                                  <Select
                                    value={row.pairedWith ? String(row.pairedWith) : "__none__"}
                                    onValueChange={(v) =>
                                      setRow(p.ID, {
                                        pairedWith: v === "__none__" ? undefined : Number(v),
                                      })
                                    }
                                    disabled={isMain || otherLangPages.length === 0}
                                  >
                                    <SelectTrigger className="h-7 w-full max-w-[200px] text-xs">
                                      <SelectValue
                                        placeholder={
                                          lang === "pl" ? "— bez pary —" : "— unpaired —"
                                        }
                                      />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">
                                        {lang === "pl" ? "— bez pary —" : "— unpaired —"}
                                      </SelectItem>
                                      {otherLangPages.map((op) => (
                                        <SelectItem key={op.ID} value={String(op.ID)}>
                                          {op.title || `#${op.ID}`}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="px-2 py-1.5">
                                  <Select
                                    value={row.targetPageId ?? "__new__"}
                                    onValueChange={(v) =>
                                      setRow(p.ID, {
                                        targetPageId: v === "__new__" ? undefined : v,
                                      })
                                    }
                                    disabled={isMain}
                                  >
                                    <SelectTrigger className="h-7 w-full max-w-[220px] text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__new__">
                                        {lang === "pl" ? "+ Nowa strona" : "+ New page"}
                                      </SelectItem>
                                      {existingPages.map((ep) => (
                                        <SelectItem key={ep.id} value={ep.id}>
                                          {ep.title_pl || ep.title_en || ep.slug}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="px-2 py-1.5">
                                  <Input
                                    placeholder={p.slug}
                                    value={row.slugOverride ?? ""}
                                    onChange={(e) =>
                                      setRow(p.ID, {
                                        slugOverride: e.target.value.trim() || undefined,
                                      })
                                    }
                                    className="h-7 w-32 text-xs"
                                    disabled={isMain}
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={isMain}
                                    onClick={() =>
                                      setPreview({
                                        wpId: p.ID,
                                        wpIdEn:
                                          row.pairedWith && row.lang === "pl"
                                            ? row.pairedWith
                                            : undefined,
                                      })
                                    }
                                    title={
                                      lang === "pl" ? "Podgląd konwersji" : "Preview conversion"
                                    }
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {lang === "pl" ? "Anuluj" : "Cancel"}
                </Button>
                <Button onClick={runImport} disabled={selected.size === 0 || importing}>
                  {importing ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-1 h-4 w-4" />
                  )}
                  {lang === "pl" ? `Importuj (${selected.size})` : `Import (${selected.size})`}
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <WordPressPreviewDialog
        open={preview !== null}
        onOpenChange={(o) => !o && setPreview(null)}
        siteDomain={domain}
        wpId={preview?.wpId ?? null}
        wpIdEn={preview?.wpIdEn}
      />
    </>
  );
}
