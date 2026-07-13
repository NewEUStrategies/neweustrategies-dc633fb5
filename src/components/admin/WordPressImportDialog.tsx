// Dialog importu stron z WordPress.com (konwersja Gutenberg / Elementor
// / zwykły HTML -> nasz BuilderDocument z widgetem rich-text). Strona
// o slug="main" jest zawsze pomijana.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Download, RefreshCw } from "lucide-react";
import { wpListPages, wpImportPages } from "@/lib/wp-import.functions";

interface WpPage {
  ID: number;
  title: string;
  slug: string;
  status: string;
  URL: string;
  modified: string;
}

export function WordPressImportDialog({ trigger }: { trigger: React.ReactNode }) {
  const { t: _t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();
  const listFn = useServerFn(wpListPages);
  const importFn = useServerFn(wpImportPages);

  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("wp_import_domain") ?? "";
  });
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<WpPage[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [targetStatus, setTargetStatus] = useState<"draft" | "published">("draft");
  const [importing, setImporting] = useState(false);

  const skippedMain = pages.filter((p) => p.slug === "main");
  const selectableCount = pages.filter((p) => p.slug !== "main").length;

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
    try {
      window.localStorage.setItem("wp_import_domain", domain);
      const { pages: got } = await listFn({ data: { siteDomain: domain } });
      setPages(got);
      if (got.length === 0) {
        toast.info(
          lang === "pl" ? "Brak stron w tej witrynie." : "No pages found on this site.",
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const selectable = pages.filter((p) => p.slug !== "main");
    if (selected.size === selectable.length) setSelected(new Set());
    else setSelected(new Set(selectable.map((p) => p.ID)));
  };

  const runImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      const { results } = await importFn({
        data: {
          siteDomain: domain,
          pageIds: Array.from(selected),
          targetStatus,
        },
      });
      const okCount = results.filter((r) => r.status === "imported").length;
      const skippedCount = results.filter((r) => r.status === "skipped").length;
      const errCount = results.filter((r) => r.status === "error").length;
      const parts = [
        `${okCount} ${lang === "pl" ? "zaimportowanych" : "imported"}`,
        skippedCount > 0
          ? `${skippedCount} ${lang === "pl" ? "pominiętych" : "skipped"}`
          : "",
        errCount > 0 ? `${errCount} ${lang === "pl" ? "błędów" : "errors"}` : "",
      ].filter(Boolean);
      if (okCount > 0) toast.success(parts.join(" · "));
      else toast.warning(parts.join(" · "));
      const errors = results.filter((r) => r.status === "error");
      for (const e of errors.slice(0, 3)) {
        toast.error(`WP #${e.wpId}: ${e.message ?? "unknown error"}`);
      }
      if (okCount > 0) {
        qc.invalidateQueries({ queryKey: ["admin-pages"] });
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {lang === "pl" ? "Import z WordPressa" : "Import from WordPress"}
          </DialogTitle>
          <DialogDescription>
            {lang === "pl"
              ? "Pobiera strony z witryny WordPress.com powiązanej przez konektor i konwertuje treść (Gutenberg / Elementor / plain HTML) na widgety buildera. Strona /main jest zawsze pomijana."
              : "Fetches pages from the linked WordPress.com site and converts content (Gutenberg / Elementor / plain HTML) into builder widgets. The /main page is always skipped."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>
              {lang === "pl" ? "Domena WordPress.com" : "WordPress.com domain"}
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder="mysite.wordpress.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value.trim())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") fetchList();
                }}
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
            <p className="text-xs text-muted-foreground">
              {lang === "pl"
                ? "Wpisz pełną domenę bez schematu (bez https://)."
                : "Enter the full domain without scheme (no https://)."}
            </p>
          </div>

          {pages.length > 0 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selected.size === selectableCount && selectableCount > 0}
                    onCheckedChange={toggleAll}
                  />
                  <span>
                    {lang === "pl"
                      ? `Zaznacz wszystkie (${selectableCount})`
                      : `Select all (${selectableCount})`}
                  </span>
                </div>
                <span className="text-muted-foreground">
                  {lang === "pl"
                    ? `${selected.size} wybranych`
                    : `${selected.size} selected`}
                  {skippedMain.length > 0 && (
                    <>
                      {" · "}
                      {lang === "pl"
                        ? `${skippedMain.length} pominiętych (main)`
                        : `${skippedMain.length} skipped (main)`}
                    </>
                  )}
                </span>
              </div>

              <ul className="max-h-[46vh] divide-y divide-border overflow-auto rounded-md border border-border">
                {pages.map((p) => {
                  const isMain = p.slug === "main";
                  return (
                    <li
                      key={p.ID}
                      className={
                        "flex items-center gap-3 px-3 py-2 text-sm " +
                        (isMain ? "opacity-50" : "hover:bg-muted/30")
                      }
                    >
                      <Checkbox
                        checked={selected.has(p.ID)}
                        disabled={isMain}
                        onCheckedChange={() => toggle(p.ID)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{p.title || `#${p.ID}`}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          /{p.slug}
                          {isMain && (
                            <span className="ml-2 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                              {lang === "pl" ? "pominięta" : "skipped"}
                            </span>
                          )}
                        </p>
                      </div>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase">
                        {p.status}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Label className="text-xs">
                    {lang === "pl" ? "Status po imporcie" : "Status after import"}
                  </Label>
                  <Select
                    value={targetStatus}
                    onValueChange={(v) => setTargetStatus(v as "draft" | "published")}
                  >
                    <SelectTrigger className="h-8 w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">draft</SelectItem>
                      <SelectItem value="published">published</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {lang === "pl" ? "Anuluj" : "Cancel"}
          </Button>
          <Button
            onClick={runImport}
            disabled={selected.size === 0 || importing}
          >
            {importing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1 h-4 w-4" />
            )}
            {lang === "pl"
              ? `Importuj (${selected.size})`
              : `Import (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
