// MAPY WITRYN W GOOGLE - karta zakładki Search Console.
//
// Kokpit SEO (karta fundamentów) mówi, czy NASZE pliki mapy odpowiadają
// i przechodzą walidację. Ta karta mówi, co z nimi zrobił GOOGLE: kiedy je
// ostatnio pobrał, czy znalazł błędy, ile adresów odczytał - plik po pliku,
// także pliki wskazane przez indeks. I daje jedyną akcję, której redakcja
// potrzebuje po naprawie mapy: „Prześlij do Google" (`sitemaps.submit`), czyli
// ten sam przycisk, co „Prześlij ponownie" w Search Console. Bez niego raport
// GSC trzymał błędy naprawionych plików, dopóki Google sam nie wrócił.
//
// UPRAWNIENIA. Przesłanie idzie kontem konektora wspólnym dla wdrożenia, więc
// serwer wymaga roli `admin` (`requireAnalyticsAdmin`) i związania właściwości
// oraz pliku z najemcą. Interfejs pokazuje przyciski wyłącznie adminowi -
// nie oferuje akcji, którą serwer odrzuci (bramka
// `adminRouteAuthority.gate.test.ts`, „akcje zewnętrzne SEO").
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { toastError } from "@/lib/toastError";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentTenantId } from "@/lib/tenant";
import { useTenantPublicOriginState } from "@/lib/seo/useTenantPublicOrigin";
import { ExternalLink, Loader2, RefreshCw } from "@/lib/lucide-shim";
import {
  listGscSitemaps,
  submitGscSitemap,
  type GscSitemap,
  type GscSubmitResult,
} from "@/lib/analytics/gsc.functions";
import { analyticsGscSitemapsKey } from "@/lib/analytics/queryKeys";
// Karta woła klucze `adminSeoHub.*` - nakładka musi być w chunku razem z nią.
import "@/lib/i18n-admin-seo-hub";

type SitemapState = "ok" | "errors" | "warnings" | "pending" | "never";

/** Stan pliku tak, jak go czyta redakcja - ta sama kolejność ważności co w GSC. */
function gscSitemapState(sitemap: GscSitemap): SitemapState {
  if (sitemap.errors > 0) return "errors";
  if (sitemap.warnings > 0) return "warnings";
  if (sitemap.isPending) return "pending";
  if (!sitemap.lastDownloaded) return "never";
  return "ok";
}

const STATE_TONE: Record<SitemapState, string> = {
  ok: "text-emerald-500",
  errors: "text-destructive",
  warnings: "text-brand",
  pending: "text-muted-foreground",
  never: "text-muted-foreground",
};

/** Adres raportu map w Search Console dla wybranej właściwości. */
function gscSitemapsReportUrl(siteUrl: string): string {
  return `https://search.google.com/search-console/sitemaps?resource_id=${encodeURIComponent(siteUrl)}`;
}

/** Ścieżka adresu mapy - pełny URL jest w podpowiedzi. */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function urlCount(sitemap: GscSitemap): number {
  return sitemap.contents.reduce((sum, content) => sum + content.submitted, 0);
}

export function GscSitemapsCard({ siteUrl }: { siteUrl: string }) {
  const { t, i18n } = useTranslation();
  const { isAdmin } = useAuth();
  const tenantId = useCurrentTenantId();
  const { origin } = useTenantPublicOriginState();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listGscSitemaps);
  const submitFn = useServerFn(submitGscSitemap);
  const queryKey = analyticsGscSitemapsKey(tenantId ?? "", siteUrl);

  const sitemapsQuery = useQuery({
    queryKey,
    enabled: Boolean(tenantId) && Boolean(siteUrl),
    staleTime: 60_000,
    queryFn: () => listFn({ data: { siteUrl } }),
  });

  const submit = useMutation({
    mutationFn: (feedpath: string): Promise<GscSubmitResult> =>
      submitFn({ data: { siteUrl, feedpath } }),
    onSuccess: (result, feedpath) => {
      if (result.ok) {
        toast.success(t("adminSeoHub.gscSubmitted", { value: pathOf(feedpath) }));
        void queryClient.invalidateQueries({ queryKey });
        return;
      }
      toast.error(t(`adminSeoHub.gscSubmit_${result.reason}`));
    },
    onError: (error) => toastError(error),
  });

  const formatDate = (value: string | null): string => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(i18n.language === "en" ? "en-GB" : "pl-PL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const indexUrl = origin ? `${origin}/sitemap.xml` : null;
  const sitemaps = sitemapsQuery.data?.sitemaps ?? [];
  const indexKnown = sitemaps.some((s) => indexUrl !== null && s.path === indexUrl);
  const pendingPath = submit.isPending ? submit.variables : null;

  const submitButton = (feedpath: string, label: string) => (
    <button
      type="button"
      onClick={() => submit.mutate(feedpath)}
      disabled={submit.isPending}
      data-gsc-submit={pathOf(feedpath)}
      className="inline-flex items-center gap-1.5 rounded-[6px] border border-border px-2.5 py-1 text-xs font-medium text-brand hover:bg-muted disabled:opacity-60"
    >
      {pendingPath === feedpath ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
      {pendingPath === feedpath ? t("adminSeoHub.gscSubmitting") : label}
    </button>
  );

  const row = (sitemap: GscSitemap, child: boolean) => {
    const state = gscSitemapState(sitemap);
    return (
      <tr
        key={`${child ? "c" : "t"}:${sitemap.path}`}
        data-gsc-sitemap={pathOf(sitemap.path)}
        data-state={state}
        className="border-b border-border last:border-0"
      >
        <td className={`px-3 py-2 align-top ${child ? "pl-7" : ""}`}>
          <a
            href={sitemap.path}
            target="_blank"
            rel="noopener noreferrer"
            title={sitemap.path}
            className="break-all font-mono text-xs text-brand hover:underline"
          >
            {pathOf(sitemap.path)}
          </a>
          {sitemap.isSitemapsIndex ? (
            <div className="text-[11px] text-muted-foreground">
              {t("adminSeoHub.gscIndexLabel")}
            </div>
          ) : null}
        </td>
        <td className="px-3 py-2 align-top text-xs tabular-nums text-muted-foreground">
          {formatDate(sitemap.lastDownloaded)}
        </td>
        <td className={`px-3 py-2 align-top text-xs font-medium ${STATE_TONE[state]}`}>
          {t(`adminSeoHub.gscState_${state}`, {
            n: state === "errors" ? sitemap.errors : sitemap.warnings,
          })}
        </td>
        <td className="px-3 py-2 text-right align-top text-xs tabular-nums text-muted-foreground">
          {urlCount(sitemap)}
        </td>
        <td className="px-3 py-2 text-right align-top">
          {isAdmin && !child ? submitButton(sitemap.path, t("adminSeoHub.gscResubmit")) : null}
        </td>
      </tr>
    );
  };

  return (
    <section className="space-y-3 rounded-[6px] border border-border bg-card p-4" data-gsc-sitemaps>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-sm font-semibold">
            {t("adminSeoHub.gscSitemapsTitle")}
          </h2>
          <p className="max-w-prose text-xs text-muted-foreground">
            {t("adminSeoHub.gscSitemapsIntro")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && indexUrl ? submitButton(indexUrl, t("adminSeoHub.gscSubmitIndex")) : null}
          <a
            href={gscSitemapsReportUrl(siteUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
          >
            {t("adminSeoHub.gscOpenReport")}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        </div>
      </div>

      {sitemapsQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">{t("admin.loading")}</p>
      ) : sitemapsQuery.isError ? (
        <p className="text-xs text-destructive">{t("adminSeoHub.gscSitemapsLoadFailed")}</p>
      ) : sitemapsQuery.data && !sitemapsQuery.data.configured ? (
        <p className="text-xs text-muted-foreground">{t("adminSeoHub.gscSubmit_notConfigured")}</p>
      ) : (
        <>
          {!indexKnown && indexUrl ? (
            <p className="text-xs text-brand" data-gsc-index-missing>
              {t("adminSeoHub.gscIndexMissing", { value: pathOf(indexUrl) })}
            </p>
          ) : null}
          {sitemaps.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t("adminSeoHub.gscColSitemap")}</th>
                    <th className="w-32 px-3 py-2 font-medium">{t("adminSeoHub.gscColRead")}</th>
                    <th className="w-32 px-3 py-2 font-medium">{t("adminSeoHub.gscColState")}</th>
                    <th className="w-24 px-3 py-2 text-right font-medium">
                      {t("adminSeoHub.gscColUrls")}
                    </th>
                    <th className="w-40 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {sitemaps.flatMap((sitemap) => [
                    row(sitemap, false),
                    ...sitemap.children.map((childSitemap) => row(childSitemap, true)),
                  ])}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("adminSeoHub.gscNoSitemaps")}</p>
          )}
          <p className="text-[11px] text-muted-foreground">{t("adminSeoHub.gscSubmitNote")}</p>
        </>
      )}
    </section>
  );
}
