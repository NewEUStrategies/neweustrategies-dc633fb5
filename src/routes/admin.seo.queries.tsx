// /admin/seo/queries - rejestr fraz: co ludzie wpisali w Google, zanim zobaczyli
// nasz tekst, i który tytuł przez to nie zbiera kliknięć.
//
// CZYM TO SIĘ RÓŻNI OD ZAKŁADKI SEARCH CONSOLE. Tamta pokazuje dwie listy
// obok siebie - 25 najlepszych fraz i 25 najlepszych stron - posortowane po
// kliknięciach, czyli po tym, co JUŻ działa. Z takiej pary nie wynika żadna
// czynność: nie wiadomo, która fraza należy do której strony, a strony, które
// zbierają wyświetlenia bez kliknięć, w ogóle się tam nie pokazują, bo
// sortowanie po kliknięciach wypycha je na koniec.
//
// Ten ekran pyta Google o OBA wymiary naraz (`dimensions: ["page", "query"]`),
// dopina wynik do artykułu w CMS-ie po slugu i kończy przyciskiem „popraw
// tytuł i opis". Sortuje po kliknięciach MOŻLIWYCH DO ODZYSKANIA, nie po
// zebranych - lista zadań ma pokazywać, co jest do zrobienia, a nie co już
// zrobione.
//
// Cała arytmetyka i wszystkie orzeczenia mieszkają w `@/lib/seo/queryRegistry`.
// Tu zostaje pobranie danych i rysowanie.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listGscSites, queryGscAnalytics } from "@/lib/analytics/gsc.functions";
import { ensureI18n } from "@/lib/i18n-admin-seo-hub";
import { SEO_FIELDS_SELECT } from "@/lib/seo/fields";
import { QueryRegistryTable } from "@/components/admin/seo/QueryRegistryTable";
import {
  MIN_IMPRESSIONS_FOR_VERDICT,
  flattenQueries,
  groupByPage,
  rankOpportunities,
  summarizeRegistry,
  type GscPageQueryRow,
  type RegistryPage,
} from "@/lib/seo/queryRegistry";

export const Route = createFileRoute("/admin/seo/queries")({
  component: SeoQueryRegistry,
  head: () => ({ meta: [{ title: "SEO - Frazy" }] }),
});

type RangeKey = "7d" | "28d" | "90d";
type ViewKey = "pages" | "queries";

/** Search Console publikuje z ok. dwudniowym opóźnieniem - pytanie o wczoraj zwraca pustkę. */
const GSC_LAG_DAYS = 2;
const RANGE_DAYS: Record<RangeKey, number> = { "7d": 9, "28d": 30, "90d": 92 };

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

interface ContentRow {
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  seo_title_pl?: string | null;
  seo_title_en?: string | null;
  seo_description_pl?: string | null;
  seo_description_en?: string | null;
}

const CONTENT_SELECT = `slug, title_pl, title_en, ${SEO_FIELDS_SELECT}`;

/** Tytuł i opis widoczne w wyniku - to z nimi porównujemy frazy. */
export interface ContentText {
  readonly kind: "post" | "page";
  readonly title: string;
  readonly description: string;
}

function toContentText(row: ContentRow, kind: "post" | "page"): ContentText {
  return {
    kind,
    title: [row.seo_title_pl, row.seo_title_en, row.title_pl, row.title_en]
      .map((value) => (value ?? "").trim())
      .filter(Boolean)
      .join(" "),
    description: [row.seo_description_pl, row.seo_description_en]
      .map((value) => (value ?? "").trim())
      .filter(Boolean)
      .join(" "),
  };
}

function SeoQueryRegistry() {
  ensureI18n();
  const { t } = useTranslation();
  const tenantId = useRequiredTenant();
  const [range, setRange] = useState<RangeKey>("28d");
  const [view, setView] = useState<ViewKey>("pages");
  const [siteUrl, setSiteUrl] = useState("");

  const listSites = useServerFn(listGscSites);
  const runQuery = useServerFn(queryGscAnalytics);

  const sitesQuery = useQuery({
    queryKey: ["gsc-sites"],
    queryFn: () => listSites(),
    staleTime: 5 * 60_000,
  });

  const effectiveSite = siteUrl || sitesQuery.data?.sites?.[0]?.siteUrl || "";
  const endDate = useMemo(() => isoDaysAgo(GSC_LAG_DAYS), []);
  const startDate = useMemo(() => isoDaysAgo(RANGE_DAYS[range]), [range]);

  const registryQuery = useQuery({
    queryKey: ["gsc-page-query", effectiveSite, startDate, endDate],
    enabled: !!effectiveSite,
    queryFn: () =>
      runQuery({
        data: {
          siteUrl: effectiveSite,
          startDate,
          endDate,
          dimensions: ["page", "query"],
          rowLimit: 1000,
        },
      }),
  });

  const { data: posts } = useQuery({
    queryKey: ["seo-queries-posts", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<ContentRow[]> => {
      const { data, error } = await supabase
        .from("posts")
        .select(CONTENT_SELECT)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: pages } = useQuery({
    queryKey: ["seo-queries-pages", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<ContentRow[]> => {
      const { data, error } = await supabase
        .from("pages")
        .select(CONTENT_SELECT)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  /** Slug -> tekst widoczny w wyniku. Wpisy wygrywają ze stronami: ten sam slug
   *  w obu tabelach jest nietypowy, a wpis jest tym, co się realnie pozycjonuje. */
  const bySlug = useMemo(() => {
    const map = new Map<string, ContentText>();
    for (const page of pages ?? []) map.set(page.slug, toContentText(page, "page"));
    for (const post of posts ?? []) map.set(post.slug, toContentText(post, "post"));
    return map;
  }, [posts, pages]);

  const registry = useMemo<RegistryPage[]>(
    () => groupByPage((registryQuery.data?.rows ?? []) as GscPageQueryRow[]),
    [registryQuery.data],
  );
  const totals = useMemo(() => summarizeRegistry(registry), [registry]);
  const opportunities = useMemo(() => rankOpportunities(registry), [registry]);
  const flatQueries = useMemo(() => flattenQueries(registry), [registry]);

  const notConnected = sitesQuery.data?.configured === false;
  const noData = !!effectiveSite && registryQuery.isSuccess && registry.length === 0;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("adminSeoHub.queriesIntro")}</p>

      {notConnected && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          {t("adminSeoHub.queriesNotConnected")}
        </div>
      )}

      {!!sitesQuery.data?.sites?.length && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={effectiveSite} onValueChange={setSiteUrl}>
            <SelectTrigger
              className="h-9 w-[320px] text-xs"
              aria-label={t("adminSeoHub.queriesSiteLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sitesQuery.data.sites.map((site) => (
                <SelectItem key={site.siteUrl} value={site.siteUrl}>
                  {site.siteUrl}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={(value) => setRange(value as RangeKey)}>
            <SelectTrigger
              className="h-9 w-[140px] text-xs"
              aria-label={t("adminSeoHub.queriesRangeLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">{t("adminSeoHub.queriesRange7d")}</SelectItem>
              <SelectItem value="28d">{t("adminSeoHub.queriesRange28d")}</SelectItem>
              <SelectItem value="90d">{t("adminSeoHub.queriesRange90d")}</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground">
            {startDate} → {endDate}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t("adminSeoHub.queriesColImpressions")} value={totals.impressions} />
        <Tile label={t("adminSeoHub.queriesColClicks")} value={totals.clicks} />
        <Tile label={t("adminSeoHub.queriesTotalPages")} value={totals.pages} />
        <Tile label={t("adminSeoHub.queriesTotalQueries")} value={totals.queries} />
      </div>

      {noData && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          {t("adminSeoHub.queriesNoData")}
        </div>
      )}

      {registry.length > 0 && (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t("adminSeoHub.queriesOpportunities")}</h2>
            {opportunities.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("adminSeoHub.queriesOpportunitiesEmpty")}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("adminSeoHub.queriesMissedClicksHint")}
              </p>
            )}
          </section>

          <div className="flex gap-2" role="tablist">
            <ViewTab
              active={view === "pages"}
              label={t("adminSeoHub.queriesViewPages")}
              onSelect={() => setView("pages")}
            />
            <ViewTab
              active={view === "queries"}
              label={t("adminSeoHub.queriesViewQueries")}
              onSelect={() => setView("queries")}
            />
          </div>

          <QueryRegistryTable
            view={view}
            pages={opportunities.length > 0 ? opportunities : registry}
            queries={flatQueries}
            contentBySlug={bySlug}
            minImpressions={MIN_IMPRESSIONS_FOR_VERDICT}
          />
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value.toLocaleString("pl-PL")}</div>
    </div>
  );
}

function ViewTab({
  active,
  label,
  onSelect,
}: {
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-brand bg-brand/10 text-brand"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
