// Widget "Podgląd Google Index" - wykorzystuje URL Inspection API (Google Search Console)
// przez connector gateway. Wywołuje server function `inspectGscUrl`, prezentuje status
// indeksowania, pokrycie, mobile-usability i rich-results dla wybranej ścieżki.
// Pełne wsparcie i18n (PL/EN) oraz warstwa fallbackowa dla braku konfiguracji GSC.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { toastError } from "@/lib/toastError";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "@/lib/lucide-shim";
import { inspectGscUrl, listGscSites, type GscSite } from "@/lib/analytics/gsc.functions";
import { analyticsGscSitesKey } from "@/lib/analytics/queryKeys";
import { useCurrentTenantId } from "@/lib/tenant";
// Klucze `admin.seo.*` tego widżetu mieszkają w nakładce `i18n-admin-extras`.
// Bez jawnego importu słownik trafiał tu tylko przypadkiem (kotwica w
// `routes/admin.tsx`) - bramka `check:i18n-overlay-imports`.
import { ensureI18n as ensureAdminExtrasI18n } from "@/lib/i18n-admin-extras";

interface Props {
  /** Ścieżka strony bez slasha wiodącego, np. "analizy/example". */
  path: string;
  /** Kod języka - używany tylko dla parametru languageCode API. */
  lang?: "pl" | "en";
}

interface InspectionResult {
  inspectionResult?: {
    indexStatusResult?: {
      verdict?: string;
      coverageState?: string;
      robotsTxtState?: string;
      indexingState?: string;
      lastCrawlTime?: string;
      pageFetchState?: string;
      googleCanonical?: string;
      userCanonical?: string;
      referringUrls?: string[];
      crawledAs?: string;
    };
    mobileUsabilityResult?: {
      verdict?: string;
      issues?: Array<{ severity?: string; message?: string }>;
    };
    richResultsResult?: {
      verdict?: string;
      detectedItems?: Array<{ richResultType?: string; items?: unknown[] }>;
    };
    inspectionResultLink?: string;
  };
}

function normalizeSiteBase(siteUrl: string): string {
  // Domain property: "sc-domain:example.com" -> "https://example.com/"
  if (siteUrl.startsWith("sc-domain:")) {
    return `https://${siteUrl.slice("sc-domain:".length).replace(/\/$/, "")}/`;
  }
  return siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
}

function VerdictBadge({ verdict }: { verdict: string | undefined }) {
  const { t } = useTranslation();
  const v = (verdict ?? "").toUpperCase();
  const cfg = (() => {
    if (v === "PASS")
      return {
        Icon: CheckCircle2,
        cls: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20",
        label: t("admin.seo.gsc.verdict.pass"),
      };
    if (v === "PARTIAL")
      return {
        Icon: AlertTriangle,
        cls: "text-brand-ink bg-brand/10 border-brand/20",
        label: t("admin.seo.gsc.verdict.partial"),
      };
    if (v === "FAIL")
      return {
        Icon: XCircle,
        cls: "text-red-600 bg-red-500/10 border-red-500/20",
        label: t("admin.seo.gsc.verdict.fail"),
      };
    return {
      Icon: AlertTriangle,
      cls: "text-muted-foreground bg-muted border-border",
      label: t("admin.seo.gsc.verdict.neutral"),
    };
  })();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-[11px] font-medium ${cfg.cls}`}
    >
      <cfg.Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

export function UrlInspectionWidget({ path, lang = "pl" }: Props) {
  ensureAdminExtrasI18n();
  const { t } = useTranslation();
  const listSites = useServerFn(listGscSites);
  const inspect = useServerFn(inspectGscUrl);
  // NAJEMCA W KLUCZU (`analyticsGscSitesKey`, wspólny wpis z
  // /admin/seo/search-console i warsztatem GSC). Serwer odsiewa właściwości
  // per najemca, ale do 2026-10 widżet trzymał listę pod `["gsc-sites-widget"]`,
  // więc po przełączeniu obszaru roboczego proponował do inspekcji domenę
  // POPRZEDNIEGO najemcy - prosto z cache'u.
  const tenantId = useCurrentTenantId();

  const sitesQ = useQuery({
    queryKey: analyticsGscSitesKey(tenantId ?? ""),
    enabled: Boolean(tenantId),
    staleTime: 5 * 60_000,
    queryFn: async () => listSites(),
  });

  const sites: GscSite[] = sitesQ.data?.sites ?? [];
  const configured = sitesQ.data?.configured ?? true;
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const activeSite = siteUrl ?? sites[0]?.siteUrl ?? null;

  const inspectionUrl = useMemo(() => {
    if (!activeSite) return null;
    const base = normalizeSiteBase(activeSite);
    const cleanPath = path.replace(/^\//, "");
    const prefix = lang === "en" ? "en/" : "";
    return `${base}${prefix}${cleanPath}`;
  }, [activeSite, path, lang]);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<InspectionResult | null>(null);

  const runInspection = async () => {
    if (!activeSite || !inspectionUrl) return;
    setRunning(true);
    try {
      const res = await inspect({
        data: {
          siteUrl: activeSite,
          inspectionUrl,
          languageCode: lang === "en" ? "en-US" : "pl-PL",
        },
      });
      setResult(JSON.parse(res.raw) as InspectionResult);
      toast.success(t("admin.seo.gsc.inspectDone"));
    } catch (e) {
      toastError(e);
    } finally {
      setRunning(false);
    }
  };

  // `!tenantId` NAJPIERW: wyłączone zapytanie ma `isLoading === false` i brak
  // `data`, a z tego niżej wychodzi `configured = true` i pusta lista - czyli
  // fałszywe „brak zweryfikowanych właściwości", zanim ktokolwiek zapytał.
  if (!tenantId || sitesQ.isLoading) {
    return (
      <div className="rounded-[6px] border border-border p-4 text-xs text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {t("admin.seo.gsc.loading")}
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="rounded-[6px] border border-border p-4 text-xs text-muted-foreground">
        {t("admin.seo.gsc.notConfigured")}
      </div>
    );
  }

  if (sites.length === 0) {
    return (
      <div className="rounded-[6px] border border-border p-4 text-xs text-muted-foreground">
        {t("admin.seo.gsc.noSites")}
      </div>
    );
  }

  const idx = result?.inspectionResult?.indexStatusResult;
  const mob = result?.inspectionResult?.mobileUsabilityResult;
  const rich = result?.inspectionResult?.richResultsResult;

  return (
    <div className="rounded-[6px] border border-border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{t("admin.seo.gsc.widgetTitle")}</h4>
        {result?.inspectionResult?.inspectionResultLink ? (
          <a
            href={result.inspectionResult.inspectionResultLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {t("admin.seo.gsc.openInGsc")}
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : null}
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <Select value={activeSite ?? undefined} onValueChange={(v) => setSiteUrl(v)}>
          {/* Rola `combobox` NIE bierze nazwy z treści (wybranej wartości), więc
              bez etykiety czytnik ogłasza samo „pole listy" - operator nie wie,
              że przełącza właściwość Search Console, i może sprawdzić złą
              domenę. Nazwa = CO wybieramy; wybrana wartość dochodzi z treści. */}
          <SelectTrigger
            className="h-9 rounded-[6px]"
            aria-label={t("admin.seo.gsc.propertyLabel")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sites.map((s) => (
              <SelectItem key={s.siteUrl} value={s.siteUrl}>
                {s.siteUrl}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={runInspection}
          disabled={running || !inspectionUrl}
          className="h-9 rounded-[6px]"
        >
          {running ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          )}
          {t("admin.seo.gsc.inspect")}
        </Button>
      </div>

      {inspectionUrl ? (
        <p className="text-[10px] text-muted-foreground break-all">{inspectionUrl}</p>
      ) : null}

      {result ? (
        <div className="grid gap-2 pt-1">
          <Row
            label={t("admin.seo.gsc.indexing")}
            verdict={idx?.verdict}
            detail={idx?.coverageState}
          />
          <Row
            label={t("admin.seo.gsc.mobile")}
            verdict={mob?.verdict}
            detail={mob?.issues?.[0]?.message}
          />
          <Row
            label={t("admin.seo.gsc.richResults")}
            verdict={rich?.verdict}
            detail={
              rich?.detectedItems
                ?.map((d) => d.richResultType)
                .filter(Boolean)
                .join(", ") || undefined
            }
          />
          {idx?.lastCrawlTime ? (
            <p className="text-[10px] text-muted-foreground">
              {t("admin.seo.gsc.lastCrawl")}:{" "}
              {new Date(idx.lastCrawlTime).toLocaleString(lang === "en" ? "en-GB" : "pl-PL")}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">{t("admin.seo.gsc.hint")}</p>
      )}
    </div>
  );
}

function Row({
  label,
  verdict,
  detail,
}: {
  label: string;
  verdict: string | undefined;
  detail: string | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        {detail ? (
          <span className="truncate text-[11px] text-muted-foreground max-w-[220px]" title={detail}>
            {detail}
          </span>
        ) : null}
        <VerdictBadge verdict={verdict} />
      </div>
    </div>
  );
}
