import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, AlertTriangle, Check, X } from "@/lib/lucide-shim";
import { Download } from "lucide-react";
import {
  listWpComSites,
  previewWpComPosts,
  createWpImportJob,
  runWpImportJob,
  getWpImportJob,
  cancelWpImportJob,
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

interface LogEntry { ts: string; level: "info" | "warn" | "error"; msg: string; wp_id?: number }

function ImportWordpressPage() {
  const { i18n } = useTranslation();
  const isPL = i18n.language.startsWith("pl");

  const [site, setSite] = useState("");
  const [number, setNumber] = useState(20);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<"publish" | "draft" | "any">("publish");
  const [language, setLanguage] = useState<"pl" | "en">("pl");
  const [syncExisting, setSyncExisting] = useState(false);
  const [importMedia, setImportMedia] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [jobId, setJobId] = useState<string | null>(null);

  const callListSites = useServerFn(listWpComSites);
  const callPreview = useServerFn(previewWpComPosts);
  const callCreate = useServerFn(createWpImportJob);
  const callRun = useServerFn(runWpImportJob);
  const callGet = useServerFn(getWpImportJob);
  const callCancel = useServerFn(cancelWpImportJob);

  const sites = useMutation({
    mutationFn: async () => (await callListSites()).sites as SiteOption[],
  });

  const cancel = useMutation({
    mutationFn: async () => {
      if (!jobId) return null;
      return callCancel({ data: { jobId } });
    },
  });

  const preview = useMutation({
    mutationFn: async () => {
      if (!site.trim()) throw new Error(isPL ? "Podaj domenę witryny" : "Enter a site domain");
      setSelected(new Set());
      return callPreview({ data: { site: site.trim(), number, offset, status } });
    },
  });

  // Poll the job while it's running.
  const job = useQuery({
    queryKey: ["wp-import-job", jobId],
    enabled: !!jobId,
    queryFn: () => callGet({ data: { jobId: jobId! } }),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "running" || s === undefined ? 1000 : false;
    },
  });

  const importer = useMutation({
    mutationFn: async () => {
      const only_ids = selected.size > 0 ? Array.from(selected) : undefined;
      const input = {
        site: site.trim(), number, offset, status, language, only_ids,
        sync_existing: syncExisting, import_media: importMedia,
      };
      const { jobId: id } = await callCreate({ data: input });
      setJobId(id);
      // Fire-and-track: run in parallel; UI is driven by the polling query.
      void callRun({ data: { ...input, jobId: id } }).catch(() => { /* surfaced via job row */ });
      return id;
    },
  });

  const posts = (preview.data?.posts ?? []) as PreviewPost[];
  const allSelected = posts.length > 0 && posts.every((p) => selected.has(p.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(posts.map((p) => p.id)));
  const toggleOne = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const jobData = job.data;
  const isRunning = jobData?.status === "running";
  const pct = jobData && jobData.total > 0
    ? Math.round((jobData.processed / jobData.total) * 100)
    : 0;

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
              ? "Pobiera wpisy w tle przez bezpieczny connector. Treść Gutenberga jest mapowana na bloki, nieznane elementy zachowywane bez utraty."
              : "Fetches posts in the background via the secure connector. Gutenberg content is mapped to blocks; unknown elements preserved losslessly."}
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

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-[11px] cursor-pointer">
            <input type="checkbox" checked={syncExisting} onChange={(e) => setSyncExisting(e.target.checked)} />
            <span>{isPL ? "Synchronizuj istniejące (po slug)" : "Sync existing (by slug)"}</span>
          </label>
          <label className="inline-flex items-center gap-1.5 text-[11px] cursor-pointer">
            <input type="checkbox" checked={importMedia} onChange={(e) => setImportMedia(e.target.checked)} />
            <span>{isPL ? "Importuj media (obrazy, cover)" : "Import media (images, cover)"}</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => preview.mutate()} disabled={preview.isPending || !site.trim()}>
            {preview.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            {isPL ? "Podgląd" : "Preview"}
          </Button>
          <Button type="button" size="sm" className="h-8 text-xs"
            onClick={() => importer.mutate()}
            disabled={importer.isPending || isRunning || !preview.data}>
            {importer.isPending || isRunning ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Download className="w-3 h-3 mr-1" />}
            {isPL
              ? selected.size > 0 ? `Importuj zaznaczone (${selected.size})` : "Importuj wszystkie"
              : selected.size > 0 ? `Import selected (${selected.size})` : "Import all"}
          </Button>
          {preview.error && (
            <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
              <AlertTriangle className="w-3 h-3" /> {String(preview.error)}
            </span>
          )}
        </div>
      </div>

      {jobData && (
        <JobPanel
          data={jobData}
          pct={pct}
          isPL={isPL}
          canCancel={isRunning}
          onCancel={() => cancel.mutate()}
          cancelPending={cancel.isPending}
        />
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

interface JobShape {
  status: string;
  total: number; processed: number; imported: number; updated_count: number;
  skipped: number; failed: number; media_imported: number;
  log: unknown; error: string | null; finished_at: string | null;
}

function JobPanel({ data, pct, isPL }: { data: JobShape; pct: number; isPL: boolean }) {
  const log: LogEntry[] = Array.isArray(data.log) ? (data.log as LogEntry[]) : [];
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log.length]);

  const done = data.status === "completed";
  const failed = data.status === "failed";

  return (
    <div className="rounded-md border border-border bg-card p-3 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {done && <Check className="w-4 h-4 text-emerald-600" />}
          {failed && <AlertTriangle className="w-4 h-4 text-destructive" />}
          {!done && !failed && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <strong>
            {done
              ? (isPL ? "Import zakończony" : "Import completed")
              : failed
                ? (isPL ? "Import nieudany" : "Import failed")
                : (isPL ? "Importowanie w tle…" : "Importing in background…")}
          </strong>
        </div>
        <span className="text-muted-foreground">
          {data.processed}/{data.total} ({pct}%)
        </span>
      </div>

      <div className="h-1.5 w-full rounded bg-muted overflow-hidden">
        <div
          className={`h-full transition-all ${failed ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-1">
        <li><span className="text-muted-foreground">{isPL ? "Nowe" : "Imported"}: </span>{data.imported}</li>
        <li><span className="text-muted-foreground">{isPL ? "Zaktualizowane" : "Updated"}: </span>{data.updated_count}</li>
        <li><span className="text-muted-foreground">{isPL ? "Pominięte" : "Skipped"}: </span>{data.skipped}</li>
        <li><span className="text-muted-foreground">{isPL ? "Błędy" : "Errors"}: </span>{data.failed}</li>
        <li><span className="text-muted-foreground">{isPL ? "Media" : "Media"}: </span>{data.media_imported}</li>
      </ul>

      {data.error && (
        <p className="text-destructive">{data.error}</p>
      )}

      <div
        ref={logRef}
        className="mt-2 max-h-56 overflow-y-auto rounded bg-muted/30 border border-border font-mono text-[11px] leading-snug p-2 space-y-0.5"
      >
        {log.length === 0 && (
          <div className="text-muted-foreground">{isPL ? "Brak zdarzeń" : "No events yet"}</div>
        )}
        {log.map((e, i) => (
          <div
            key={i}
            className={
              e.level === "error" ? "text-destructive"
              : e.level === "warn" ? "text-amber-600 dark:text-amber-400"
              : "text-foreground/80"
            }
          >
            <span className="text-muted-foreground">{e.ts.slice(11, 19)}</span>
            {e.wp_id ? <span className="text-muted-foreground"> #{e.wp_id}</span> : null}
            {" "}{e.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
