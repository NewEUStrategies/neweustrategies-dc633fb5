// Monitor linków wychodzących (B7): /admin/link-monitor - zepsute linki
// zewnętrzne w opublikowanych wpisach (rotacyjny skan w jobs-tick + skan
// ręczny). Odwrotność monitora 404: tam ruch przychodzący, tu przypisy.
//
// Panel nie jest już samym RAPORTEM. Do 2026-08-03 pokazywał listę martwych
// odnośników i na tym kończył - redaktor musiał sam zdecydować, co z nimi
// zrobić, i sam wklejać adresy do Wayback Machine. Teraz:
//   * każdy zepsuty link ma gotową SUGESTIĘ ZAMIANY na migawkę Internet Archive
//     (konkretna migawka z datą, gdy skaner ją znalazł; uniwersalny adres
//     "najbliższa migawka" w pozostałych przypadkach),
//   * po przekroczeniu progu widać ALERT - ten sam, który skaner wysyła
//     powiadomieniem do adminów, więc problem nie czeka na przypadkową wizytę.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Archive, Copy, Link2Off, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { runLinkScanNow } from "@/lib/content/linkMonitor.functions";
import {
  BROKEN_LINK_ALERT_THRESHOLD,
  waybackSearchUrl,
  waybackTimestampToIso,
} from "@/lib/content/brokenLinkPolicy";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/link-monitor")({
  component: LinkMonitor,
});

interface BrokenRow {
  id: string;
  url: string;
  status_code: number | null;
  error: string | null;
  checked_at: string;
  archive_url: string | null;
  archive_timestamp: string | null;
  posts: { slug: string; title_pl: string; title_en: string } | null;
}

function LinkMonitor() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language ?? "pl";
  const qc = useQueryClient();
  const scan$ = useServerFn(runLinkScanNow);
  const [scanning, setScanning] = useState(false);

  const queryKey = ["admin", "broken-links"] as const;
  const { data: broken } = useQuery({
    queryKey,
    queryFn: async (): Promise<BrokenRow[]> => {
      const { data, error } = await supabase
        .from("outbound_link_checks")
        .select(
          "id, url, status_code, error, checked_at, archive_url, archive_timestamp, posts(slug, title_pl, title_en)",
        )
        .eq("ok", false)
        .order("checked_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as BrokenRow[];
    },
  });

  const rows = broken ?? [];
  // Ten sam próg, na którym skaner wysyła powiadomienie - panel nie może
  // pokazywać innego stanu niż ten, o którym redakcja dostała maila/push.
  const overThreshold = rows.length >= BROKEN_LINK_ALERT_THRESHOLD;

  const scanNow = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const result = await scan$({ data: { posts: 10 } });
      toast.success(
        t("admin.linkMonitor.scanDone", {
          posts: result.postsScanned,
          links: result.linksChecked,
          broken: result.broken,
          archived: result.archived,
        }),
      );
      void qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const copyArchive = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("admin.linkMonitor.archiveCopied"));
    } catch {
      toast.error(t("admin.linkMonitor.archiveCopyFailed"));
    }
  };

  return (
    <AdminShell>
      <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-xl inline-flex items-center gap-2">
            <Link2Off className="w-5 h-5 text-brand" aria-hidden="true" />
            {t("admin.linkMonitor.title")}
          </h1>
          <Button size="sm" disabled={scanning} onClick={() => void scanNow()}>
            {scanning ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden="true" />
            )}
            {t("admin.linkMonitor.scanNow")}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground -mt-2">{t("admin.linkMonitor.hint")}</p>

        {overThreshold && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <AlertTriangle
              className="w-5 h-5 shrink-0 text-destructive mt-0.5"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium">
                {t("admin.linkMonitor.alertTitle", {
                  count: rows.length,
                  threshold: BROKEN_LINK_ALERT_THRESHOLD,
                })}
              </p>
              <p className="text-muted-foreground">{t("admin.linkMonitor.alertBody")}</p>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">{t("admin.linkMonitor.colUrl")}</th>
                <th className="px-3 py-2">{t("admin.linkMonitor.colStatus")}</th>
                <th className="px-3 py-2">{t("admin.linkMonitor.colSuggestion")}</th>
                <th className="px-3 py-2">{t("admin.linkMonitor.colPost")}</th>
                <th className="px-3 py-2">{t("admin.linkMonitor.colChecked")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                // Konkretna migawka, gdy skaner ją znalazł; w przeciwnym razie
                // uniwersalny adres "znajdź najbliższą" - zawsze jest CO podać.
                const archiveHref = row.archive_url || waybackSearchUrl(row.url);
                const snapshotIso = waybackTimestampToIso(row.archive_timestamp);
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2 max-w-[320px]">
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="block truncate text-brand hover:underline"
                        title={row.url}
                      >
                        {row.url}
                      </a>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-destructive">
                      {row.status_code ?? row.error ?? "-"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <a
                          href={archiveHref}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="inline-flex items-center gap-1 text-brand hover:underline"
                        >
                          <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                          {row.archive_url
                            ? snapshotIso
                              ? new Date(snapshotIso).toLocaleDateString(
                                  lang === "en" ? "en-GB" : "pl-PL",
                                )
                              : t("admin.linkMonitor.archiveSnapshot")
                            : t("admin.linkMonitor.archiveSearch")}
                        </a>
                        <button
                          type="button"
                          onClick={() => void copyArchive(archiveHref)}
                          className="text-muted-foreground hover:text-foreground"
                          title={t("admin.linkMonitor.archiveCopy")}
                          aria-label={t("admin.linkMonitor.archiveCopy")}
                        >
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 max-w-[240px]">
                      {row.posts ? (
                        <Link
                          to="/admin/posts/$slug"
                          params={{ slug: row.posts.slug }}
                          className="block truncate hover:underline"
                        >
                          {(lang === "en"
                            ? row.posts.title_en || row.posts.title_pl
                            : row.posts.title_pl) || row.posts.slug}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {new Date(row.checked_at).toLocaleString(lang === "en" ? "en-GB" : "pl-PL")}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {t("admin.linkMonitor.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
