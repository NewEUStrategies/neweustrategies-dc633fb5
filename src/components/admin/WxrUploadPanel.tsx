// Panel WXR (upload eksportu XML z WordPress).
// Cel: gdy konektor WP.com nie widzi domeny (self-hosted / Cloudflare / brak
// Jetpacka), user wgrywa plik Tools -> Export -> Pages i importuje 1:1 przez
// ten sam pipeline co konektor.

import { useCallback, useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { Loader2, Download, Upload } from "lucide-react";
import { parseWxr, fallbackHtmlFromElementorJson, type WxrPage } from "@/lib/wp-import/wxr";
import { wpImportFromWxr } from "@/lib/wp-import.functions";

interface ExistingPage {
  id: string;
  title_pl: string;
  title_en: string;
  slug: string;
  status: string;
}

interface RowConfig {
  lang: "pl" | "en";
  pairedWith?: number;
  targetPageId?: string;
  slugOverride?: string;
}

function inferLang(slug: string, title: string, meta: string | null): "pl" | "en" {
  if (meta === "en") return "en";
  if (meta === "pl") return "pl";
  const s = `${slug} ${title}`.toLowerCase();
  if (/(^|[-/_])en([-/_]|$)/.test(s)) return "en";
  return "pl";
}

interface Props {
  existingPages: ExistingPage[];
  onImported: () => void;
  onClose: () => void;
}

export function WxrUploadPanel({ existingPages, onImported, onClose }: Props) {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();
  const importFn = useServerFn(wpImportFromWxr);

  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [pages, setPages] = useState<WxrPage[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rows, setRows] = useState<Record<number, RowConfig>>({});
  const [targetStatus, setTargetStatus] = useState<"draft" | "published">("draft");
  const [mirrorMedia, setMirrorMedia] = useState(true);
  const [includeExternal, setIncludeExternal] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (pages.length > 0 && Object.keys(rows).length === 0) {
      const next: Record<number, RowConfig> = {};
      for (const p of pages) next[p.wpId] = { lang: inferLang(p.slug, p.title, p.language) };
      setRows(next);
    }
  }, [pages, rows]);

  const parseFile = useCallback(async (f: File) => {
    setParsing(true);
    setPages([]);
    setSelected(new Set());
    setRows({});
    try {
      const text = await f.text();
      const { pages: parsed, warnings } = parseWxr(text);
      // Elementor fallback: gdy content:encoded pusty a mamy JSON, syntezujemy prostą treść.
      const enriched = parsed.map((p) => {
        if ((!p.contentHtml || p.contentHtml.length < 4) && p.elementorData) {
          const fh = fallbackHtmlFromElementorJson(p.elementorData);
          if (fh) return { ...p, contentHtml: fh };
        }
        return p;
      });
      setPages(enriched);
      if (warnings.length > 0) {
        toast.warning(
          lang === "pl"
            ? `${warnings.length} ostrzeżeń przy parsowaniu (pierwsze: ${warnings[0]})`
            : `${warnings.length} parse warnings (first: ${warnings[0]})`,
        );
      }
      if (enriched.length === 0) {
        toast.info(lang === "pl" ? "Brak stron w eksporcie." : "No pages in export.");
      } else {
        toast.success(
          lang === "pl" ? `Znaleziono ${enriched.length} stron.` : `Found ${enriched.length} pages.`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }, [lang]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    void parseFile(f);
  };

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
    const byId = new Map<number, WxrPage>(pages.map((p) => [p.wpId, p]));
    const items: Array<{
      clientId: number;
      slug: string;
      slugOverride?: string;
      targetPageId?: string;
      title_pl: string;
      content_pl_html: string;
      excerpt_pl: string;
      cover_image_url?: string | null;
      title_en?: string;
      content_en_html?: string;
      excerpt_en?: string;
    }> = [];
    const consumed = new Set<number>();
    for (const id of selected) {
      if (consumed.has(id)) continue;
      const row = rows[id];
      const page = byId.get(id);
      if (!row || !page) continue;
      let plId = id;
      let enId: number | undefined;
      if (row.pairedWith && selected.has(row.pairedWith)) {
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
      const pl = byId.get(plId);
      const en = enId ? byId.get(enId) : undefined;
      if (!pl) continue;
      const base = rows[plId] ?? row;
      items.push({
        clientId: plId,
        slug: pl.slug,
        ...(base.slugOverride ? { slugOverride: base.slugOverride } : {}),
        ...(base.targetPageId ? { targetPageId: base.targetPageId } : {}),
        title_pl: pl.title,
        content_pl_html: pl.contentHtml,
        excerpt_pl: pl.excerptHtml,
        cover_image_url: pl.featuredImageUrl,
        ...(en
          ? {
              title_en: en.title,
              content_en_html: en.contentHtml,
              excerpt_en: en.excerptHtml,
            }
          : {}),
      });
    }

    setImporting(true);
    try {
      const { results } = await importFn({
        data: {
          items,
          targetStatus,
          mirrorMedia,
          includeExternalMedia: includeExternal,
        },
      });
      const okCount = results.filter((r) => r.status === "imported" || r.status === "overwritten").length;
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
        toast.error(`#${e.clientId}: ${e.message ?? "unknown error"}`);
      }
      if (okCount > 0) {
        qc.invalidateQueries({ queryKey: ["admin-pages"] });
        qc.invalidateQueries({ queryKey: ["wp-import-existing-pages"] });
        onImported();
        onClose();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const selectAll = () => {
    setSelected(new Set(pages.filter((p) => p.slug !== "main").map((p) => p.wpId)));
  };
  const selectNone = () => setSelected(new Set());

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label>{lang === "pl" ? "Plik WXR (.xml)" : "WXR file (.xml)"}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="file"
            accept=".xml,text/xml,application/xml"
            onChange={onFileChange}
            className="max-w-md"
          />
          {file && (
            <span className="text-xs text-muted-foreground">
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </span>
          )}
          {parsing && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
        <p className="text-xs text-muted-foreground">
          {lang === "pl"
            ? "W wp-admin: Tools → Export → wybierz „Pages", pobierz XML i wgraj tutaj. Media są ściągane automatycznie z URL-i w treści (jeżeli publicznie dostępne)."
            : "In wp-admin: Tools → Export → select \"Pages\", download the XML and upload here. Media is fetched automatically from URLs in the content (if publicly reachable)."}
        </p>
      </div>

      {pages.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
            <span>
              {lang === "pl"
                ? `Wybrane: ${selected.size} / ${selectableCount}`
                : `Selected: ${selected.size} / ${selectableCount}`}
            </span>
            <Button size="sm" variant="ghost" onClick={selectAll} className="h-6 px-2 text-xs">
              {lang === "pl" ? "Wszystkie" : "All"}
            </Button>
            <Button size="sm" variant="ghost" onClick={selectNone} className="h-6 px-2 text-xs">
              {lang === "pl" ? "Żadne" : "None"}
            </Button>
            <span className="text-emerald-700 dark:text-emerald-300">
              {lang === "pl" ? `Nowe: ${summary.create}` : `New: ${summary.create}`}
            </span>
            <span className="text-sky-700 dark:text-sky-300">
              {lang === "pl" ? `Nadpisania: ${summary.overwrite}` : `Overwrites: ${summary.overwrite}`}
            </span>
            <span className="text-amber-700 dark:text-amber-300">
              {lang === "pl" ? `Pary PL/EN: ${summary.paired}` : `PL/EN pairs: ${summary.paired}`}
            </span>
            <div className="ml-auto flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch checked={mirrorMedia} onCheckedChange={setMirrorMedia} id="wxr-mirror" />
                <Label htmlFor="wxr-mirror" className="cursor-pointer text-xs">
                  {lang === "pl" ? "Ściągaj media" : "Mirror media"}
                </Label>
              </div>
              {mirrorMedia && (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={includeExternal}
                    onCheckedChange={setIncludeExternal}
                    id="wxr-ext"
                  />
                  <Label htmlFor="wxr-ext" className="cursor-pointer text-xs">
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
                  <th className="px-2 py-2 text-left">{lang === "pl" ? "Strona" : "Page"}</th>
                  <th className="w-20 px-2 py-2 text-left">{lang === "pl" ? "Język" : "Lang"}</th>
                  <th className="px-2 py-2 text-left">{lang === "pl" ? "Sparuj z" : "Pair with"}</th>
                  <th className="px-2 py-2 text-left">{lang === "pl" ? "Nadpisz stronę" : "Overwrite"}</th>
                  <th className="px-2 py-2 text-left">{lang === "pl" ? "Slug" : "Slug"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pages.map((p) => {
                  const isMain = p.slug === "main";
                  const row = rows[p.wpId] ?? { lang: "pl" as const };
                  const otherLangPages = pages.filter(
                    (x) =>
                      x.wpId !== p.wpId &&
                      x.slug !== "main" &&
                      (rows[x.wpId]?.lang ?? inferLang(x.slug, x.title, x.language)) !== row.lang,
                  );
                  return (
                    <tr key={p.wpId} className={isMain ? "opacity-50" : "hover:bg-muted/20"}>
                      <td className="px-2 py-1.5">
                        <Checkbox
                          checked={selected.has(p.wpId)}
                          disabled={isMain}
                          onCheckedChange={() => toggle(p.wpId)}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="max-w-[240px] truncate font-medium" title={p.title}>
                          {p.title || `#${p.wpId}`}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          /{p.slug} · {p.status}
                          {p.elementorData ? " · Elementor" : ""}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <Select
                          value={row.lang}
                          onValueChange={(v) => setRow(p.wpId, { lang: v as "pl" | "en" })}
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
                            setRow(p.wpId, {
                              pairedWith: v === "__none__" ? undefined : Number(v),
                            })
                          }
                          disabled={isMain || otherLangPages.length === 0}
                        >
                          <SelectTrigger className="h-7 w-full max-w-[200px] text-xs">
                            <SelectValue
                              placeholder={lang === "pl" ? "— bez pary —" : "— unpaired —"}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              {lang === "pl" ? "— bez pary —" : "— unpaired —"}
                            </SelectItem>
                            {otherLangPages.map((op) => (
                              <SelectItem key={op.wpId} value={String(op.wpId)}>
                                {op.title || `#${op.wpId}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Select
                          value={row.targetPageId ?? "__new__"}
                          onValueChange={(v) =>
                            setRow(p.wpId, { targetPageId: v === "__new__" ? undefined : v })
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
                            {existingPages
                              .filter((ep) => ep.slug === p.slug)
                              .concat(
                                existingPages.filter((ep) => ep.slug !== p.slug).slice(0, 200),
                              )
                              .map((ep) => (
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
                            setRow(p.wpId, { slugOverride: e.target.value.trim() || undefined })
                          }
                          className="h-7 w-32 text-xs"
                          disabled={isMain}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {lang === "pl" ? "Anuluj" : "Cancel"}
        </Button>
        <Button onClick={runImport} disabled={selected.size === 0 || importing}>
          {importing ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1 h-4 w-4" />
          )}
          {lang === "pl" ? `Importuj (${selected.size})` : `Import (${selected.size})`}
          {!importing && <Upload className="ml-1 h-4 w-4 opacity-60" />}
        </Button>
      </div>
    </div>
  );
}
