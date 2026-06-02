import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, AlertTriangle, Check } from "@/lib/lucide-shim";
import { Download } from "lucide-react";
import {
  listWpComSites,
  previewWpComPosts,
  importWpComPosts,
} from "@/lib/wordpress-import.functions";

export const Route = createFileRoute("/admin/import-wordpress")({
  component: ImportWordpressPage,
  head: () => ({ meta: [{ title: "Import z WordPress.com" }] }),
});

interface SiteOption { id: number; name: string; url: string }
interface PreviewPost {
  id: number; slug: string; title: string; excerpt: string;
  date: string; status: string; url: string; featured_image: string | null;
}

function ImportWordpressPage() {
  const { t, i18n } = useTranslation();
  const isPL = i18n.language.startsWith("pl");

  const [site, setSite] = useState("");
  const [number, setNumber] = useState(20);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<"publish" | "draft" | "any">("publish");
  const [language, setLanguage] = useState<"pl" | "en">("pl");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const callListSites = useServerFn(listWpComSites);
  const callPreview = useServerFn(previewWpComPosts);
  const callImport = useServerFn(importWpComPosts);

  const sites = useMutation({
    mutationFn: async () => {
      const r = await callListSites();
      return r.sites as SiteOption[];
    },
  });

  const preview = useMutation({
    mutationFn: async () => {
      if (!site.trim()) throw new Error(isPL ? "Podaj domenę witryny" : "Enter a site domain");
      setSelected(new Set());
      return callPreview({ data: { site: site.trim(), number, offset, status } });
    },
  });

  const importer = useMutation({
    mutationFn: async () => {
      const only_ids = selected.size > 0 ? Array.from(selected) : undefined;
      return callImport({ data: { site: site.trim(), number, offset, status, language, only_ids } });
    },
  });

  const posts = (preview.data?.posts ?? []) as PreviewPost[];
  const allSelected = posts.length > 0 && posts.every((p) => selected.has(p.id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(posts.map((p) => p.id)));
  };
  const toggleOne = (id: number) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link to="/admin/posts" className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft className="w-3 h-3" /> {isPL ? "Wpisy" : "Posts"}
            </Link>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {isPL ? "Import z WordPress.com" : "Import from WordPress.com"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isPL
              ? "Pobiera wpisy przez bezpieczny connector. Treść Gutenberga jest mapowana na bloki, nieznane elementy zachowywane bez utraty."
              : "Fetches posts via the secure connector. Gutenberg content is mapped to blocks; unknown elements are preserved losslessly."}
          </p>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-3 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <div className="md:col-span-5">
            <Label className="text-[11px] text-muted-foreground">
              {isPL ? "Witryna (domena lub ID)" : "Site (domain or ID)"}
            </Label>
            <div className="flex gap-2">
              <Input
                value={site}
                onChange={(e) => setSite(e.target.value)}
                placeholder="example.wordpress.com"
                className="h-8 text-xs"
              />
              <Button
                type="button" variant="outline" size="sm"
                className="h-8 text-xs whitespace-nowrap"
                onClick={() => sites.mutate()}
                disabled={sites.isPending}
              >
                {sites.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : (isPL ? "Moje witryny" : "My sites")}
              </Button>
            </div>
            {sites.data && sites.data.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {sites.data.map((s) => (
                  <Button
                    key={s.id} type="button" variant="ghost" size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setSite(new URL(s.url).host)}
                  >
                    {s.name || new URL(s.url).host}
                  </Button>
                ))}
              </div>
            )}
            {sites.error && (
              <p className="mt-1 text-[11px] text-destructive">{String(sites.error)}</p>
            )}
          </div>
          <div className="md:col-span-2">
            <Label className="text-[11px] text-muted-foreground">{isPL ? "Ilość" : "Count"}</Label>
            <Input type="number" min={1} max={100} value={number}
              onChange={(e) => setNumber(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              className="h-8 text-xs"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-[11px] text-muted-foreground">{isPL ? "Pomiń" : "Offset"}</Label>
            <Input type="number" min={0} value={offset}
              onChange={(e) => setOffset(Math.max(0, Number(e.target.value) || 0))}
              className="h-8 text-xs"
            />
          </div>
          <div className="md:col-span-1.5">
            <Label className="text-[11px] text-muted-foreground">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="publish">{isPL ? "Opublikowane" : "Published"}</SelectItem>
                <SelectItem value="draft">{isPL ? "Szkice" : "Drafts"}</SelectItem>
                <SelectItem value="any">{isPL ? "Wszystkie" : "Any"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-1.5">
            <Label className="text-[11px] text-muted-foreground">{isPL ? "Język" : "Language"}</Label>
            <Select value={language} onValueChange={(v) => setLanguage(v as "pl" | "en")}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pl">PL</SelectItem>
                <SelectItem value="en">EN</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => preview.mutate()} disabled={preview.isPending || !site.trim()}>
            {preview.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            {isPL ? "Podgląd" : "Preview"}
          </Button>
          <Button type="button" size="sm" className="h-8 text-xs"
            onClick={() => importer.mutate()}
            disabled={importer.isPending || !preview.data}>
            {importer.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Download className="w-3 h-3 mr-1" />}
            {isPL
              ? selected.size > 0 ? `Importuj zaznaczone (${selected.size})` : "Importuj wszystkie"
              : selected.size > 0 ? `Import selected (${selected.size})` : "Import all"}
          </Button>
          {preview.error && (
            <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
              <AlertCircle className="w-3 h-3" /> {String(preview.error)}
            </span>
          )}
        </div>
      </div>

      {importer.data && (
        <div className="rounded-md border border-border bg-card p-3 text-xs">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <strong>{isPL ? "Wynik importu" : "Import result"}</strong>
          </div>
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <li><span className="text-muted-foreground">{isPL ? "Pobranych" : "Attempted"}: </span>{importer.data.attempted}</li>
            <li><span className="text-muted-foreground">{isPL ? "Zaimportowanych" : "Imported"}: </span>{importer.data.imported}</li>
            <li><span className="text-muted-foreground">{isPL ? "Pominiętych" : "Skipped"}: </span>{importer.data.skipped_existing}</li>
            <li><span className="text-muted-foreground">{isPL ? "Błędów" : "Errors"}: </span>{importer.data.errors.length}</li>
          </ul>
          {importer.data.errors.length > 0 && (
            <ul className="mt-2 space-y-1">
              {importer.data.errors.map((e) => (
                <li key={e.id} className="text-destructive">#{e.id}: {e.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {posts.length > 0 && (
        <div className="rounded-md border border-border bg-card overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="w-8 p-2 text-left">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th className="p-2 text-left">{isPL ? "Tytuł" : "Title"}</th>
                <th className="p-2 text-left w-32">{isPL ? "Data" : "Date"}</th>
                <th className="p-2 text-left w-24">Status</th>
                <th className="p-2 text-left w-24">Slug</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/20">
                  <td className="p-2">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} />
                  </td>
                  <td className="p-2">
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {p.title || `#${p.id}`}
                    </a>
                    {p.excerpt && <div className="text-[11px] text-muted-foreground truncate max-w-xl">{p.excerpt}</div>}
                  </td>
                  <td className="p-2 text-muted-foreground">{p.date?.slice(0, 10)}</td>
                  <td className="p-2 text-muted-foreground">{p.status}</td>
                  <td className="p-2 text-muted-foreground truncate max-w-[200px]">{p.slug}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.data?.found ? (
            <div className="p-2 text-[11px] text-muted-foreground border-t border-border">
              {isPL ? "Znaleziono" : "Found"}: {preview.data.found}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
