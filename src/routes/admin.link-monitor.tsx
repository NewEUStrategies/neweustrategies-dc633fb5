// Monitor linków wychodzących (B7): /admin/link-monitor - zepsute linki
// zewnętrzne w opublikowanych wpisach (rotacyjny skan w jobs-tick + skan
// ręczny). Odwrotność monitora 404: tam ruch przychodzący, tu przypisy.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Link2Off, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { runLinkScanNow } from "@/lib/content/linkMonitor.functions";
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
        .select("id, url, status_code, error, checked_at, posts(slug, title_pl, title_en)")
        .eq("ok", false)
        .order("checked_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as BrokenRow[];
    },
  });

  const scanNow = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const result = await scan$({ data: { posts: 10 } });
      toast.success(
        t("admin.linkMonitor.scanDone", {
          defaultValue: "Przeskanowano {{posts}} wpisów, {{links}} linków, zepsutych: {{broken}}",
          posts: result.postsScanned,
          links: result.linksChecked,
          broken: result.broken,
        }),
      );
      void qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  return (
    <AdminShell>
      <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-xl inline-flex items-center gap-2">
            <Link2Off className="w-5 h-5 text-brand" aria-hidden="true" />
            {t("admin.linkMonitor.title", { defaultValue: "Monitor linków wychodzących" })}
          </h1>
          <Button size="sm" disabled={scanning} onClick={() => void scanNow()}>
            {scanning ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden="true" />
            )}
            {t("admin.linkMonitor.scanNow", { defaultValue: "Skanuj teraz (10 wpisów)" })}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground -mt-2">
          {t("admin.linkMonitor.hint", {
            defaultValue:
              "Tło sprawdza rotacyjnie linki zewnętrzne opublikowanych wpisów (re-skan co 7 dni). Poniżej wyłącznie zepsute.",
          })}
        </p>

        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">
                  {t("admin.linkMonitor.colUrl", { defaultValue: "Link" })}
                </th>
                <th className="px-3 py-2">
                  {t("admin.linkMonitor.colStatus", { defaultValue: "Status" })}
                </th>
                <th className="px-3 py-2">
                  {t("admin.linkMonitor.colPost", { defaultValue: "Wpis" })}
                </th>
                <th className="px-3 py-2">
                  {t("admin.linkMonitor.colChecked", { defaultValue: "Sprawdzono" })}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(broken ?? []).map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 max-w-[360px]">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-brand hover:underline"
                      title={row.url}
                    >
                      {row.url}
                    </a>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-destructive">
                    {row.status_code ?? row.error ?? "-"}
                  </td>
                  <td className="px-3 py-2 max-w-[280px]">
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
              ))}
              {(broken ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {t("admin.linkMonitor.empty", {
                      defaultValue: "Brak zepsutych linków - wszystko działa.",
                    })}
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
