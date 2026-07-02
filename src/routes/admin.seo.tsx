// SEO content overview (/admin/seo) - "odrębna strona dla wszystkich stron i
// wpisów": one tenant-scoped table of every post and page with its SEO health
// (per-language descriptions, social image source, overrides, noindex, 0-100
// score), summary tiles and filters. Assessment logic lives in the pure
// @/lib/seo/contentStatus module; this screen only fetches rows and renders.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/admin/atoms/StatusBadge";
import { SeoScorePill } from "@/components/admin/seo/SeoScorePill";
import { Check, File, Newspaper, Search, X } from "@/lib/lucide-shim";
import { SEO_FIELDS_SELECT } from "@/lib/seo/fields";
import {
  seoContentStatus,
  summarizeSeoStatuses,
  type SeoContentStatus,
  type SeoStatusInput,
} from "@/lib/seo/contentStatus";

export const Route = createFileRoute("/admin/seo")({
  component: SeoOverview,
  head: () => ({ meta: [{ title: "SEO - Przegląd treści" }] }),
});

interface ContentRow extends SeoStatusInput {
  id: string;
  slug: string;
  status: string;
}

interface OverviewRow {
  kind: "post" | "page";
  row: ContentRow;
  status: SeoContentStatus;
}

const CONTENT_SELECT = `id, slug, status, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, ${SEO_FIELDS_SELECT}`;

type KindFilter = "all" | "post" | "page";
type SeoFilter = "all" | "missing_description" | "default_image" | "noindex" | "overrides";

function DescriptionMark({ source }: { source: SeoContentStatus["description"]["pl"] }) {
  if (source === "missing") return <X className="w-3.5 h-3.5 text-destructive inline" />;
  return (
    <Check
      className={`w-3.5 h-3.5 inline ${source === "override" ? "text-emerald-500" : "text-muted-foreground"}`}
    />
  );
}

function SeoOverview() {
  const { t, i18n } = useTranslation();
  const isPL = !i18n.language.startsWith("en");
  const tenantId = useRequiredTenant();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [seoFilter, setSeoFilter] = useState<SeoFilter>("all");

  const { data: posts } = useQuery({
    queryKey: ["admin-seo-posts", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<ContentRow[]> => {
      const { data, error } = await supabase
        .from("posts")
        .select(CONTENT_SELECT)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: pages } = useQuery({
    queryKey: ["admin-seo-pages", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<ContentRow[]> => {
      const { data, error } = await supabase
        .from("pages")
        .select(CONTENT_SELECT)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("menu_order")
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo<OverviewRow[]>(() => {
    const assess =
      (kind: "post" | "page") =>
      (row: ContentRow): OverviewRow => ({
        kind,
        row,
        status: seoContentStatus(row),
      });
    return [...(pages ?? []).map(assess("page")), ...(posts ?? []).map(assess("post"))];
  }, [posts, pages]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(({ kind, row, status }) => {
      if (kindFilter !== "all" && kind !== kindFilter) return false;
      if (seoFilter === "missing_description") {
        if (status.description.pl !== "missing" && status.description.en !== "missing")
          return false;
      } else if (seoFilter === "default_image") {
        if (status.socialImage !== "default") return false;
      } else if (seoFilter === "noindex") {
        if (!status.noindex) return false;
      } else if (seoFilter === "overrides") {
        if (
          !status.titleOverride.pl &&
          !status.titleOverride.en &&
          status.description.pl !== "override" &&
          status.description.en !== "override"
        ) {
          return false;
        }
      }
      if (!q) return true;
      return (
        row.title_pl.toLowerCase().includes(q) ||
        row.title_en.toLowerCase().includes(q) ||
        row.slug.toLowerCase().includes(q)
      );
    });
  }, [rows, search, kindFilter, seoFilter]);

  const summary = useMemo(() => summarizeSeoStatuses(rows.map((r) => r.status)), [rows]);

  const tiles = [
    {
      key: "total",
      label: t("admin.seoOverview.tileTotal", { defaultValue: "Treści" }),
      value: summary.total,
      tone: "text-foreground",
    },
    {
      key: "missing",
      label: t("admin.seoOverview.tileMissingDesc", { defaultValue: "Brak opisu" }),
      value: summary.missingDescription,
      tone: summary.missingDescription ? "text-destructive" : "text-emerald-500",
      filter: "missing_description" as const,
    },
    {
      key: "image",
      label: t("admin.seoOverview.tileDefaultImage", { defaultValue: "Domyślny obrazek OG" }),
      value: summary.defaultImage,
      tone: summary.defaultImage ? "text-amber-500" : "text-emerald-500",
      filter: "default_image" as const,
    },
    {
      key: "noindex",
      label: t("admin.seoOverview.tileNoindex", { defaultValue: "Noindex" }),
      value: summary.noindexed,
      tone: "text-muted-foreground",
      filter: "noindex" as const,
    },
    {
      key: "overrides",
      label: t("admin.seoOverview.tileOverrides", { defaultValue: "Z nadpisaniami SEO" }),
      value: summary.withOverrides,
      tone: "text-muted-foreground",
      filter: "overrides" as const,
    },
  ];

  const imageSourceLabel: Record<SeoContentStatus["socialImage"], string> = {
    override: t("admin.seo.og.sourceOverride", { defaultValue: "Własny obrazek" }),
    cover: t("admin.seo.og.sourceCover", { defaultValue: "Okładka wpisu" }),
    card: t("admin.seo.og.sourceCard", { defaultValue: "Wygenerowana karta" }),
    default: t("admin.seo.og.sourceDefault", { defaultValue: "Domyślny obrazek serwisu" }),
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2">
          <Search className="w-6 h-6" />
          {t("admin.seoOverview.title", { defaultValue: "SEO - przegląd treści" })}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("admin.seoOverview.subtitle", {
            defaultValue:
              "Stan SEO każdej strony i wpisu (także z buildera): opisy meta per język, obrazki OG, nadpisania i noindex.",
          })}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            onClick={() =>
              tile.filter && setSeoFilter(seoFilter === tile.filter ? "all" : tile.filter)
            }
            className={`bg-card border rounded-lg p-3 text-left transition-colors ${
              tile.filter && seoFilter === tile.filter
                ? "border-brand"
                : "border-border hover:bg-muted/30"
            } ${tile.filter ? "cursor-pointer" : "cursor-default"}`}
          >
            <div className={`text-2xl font-bold tabular-nums ${tile.tone}`}>{tile.value}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{tile.label}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("admin.seoOverview.searchPlaceholder", {
            defaultValue: "Szukaj po tytule lub slugu…",
          })}
          className="max-w-xs h-8 text-xs"
        />
        <Select
          value={kindFilter}
          onValueChange={(v) =>
            setKindFilter(v === "post" ? "post" : v === "page" ? "page" : "all")
          }
        >
          <SelectTrigger className="w-[130px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("admin.seoOverview.kindAll", { defaultValue: "Wszystko" })}
            </SelectItem>
            <SelectItem value="post">{t("admin.nav.posts")}</SelectItem>
            <SelectItem value="page">{t("admin.nav.pages")}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {filtered.length} / {rows.length}
        </span>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground tracking-wide">
            <tr>
              <th className="p-2 text-left">
                {t("admin.seoOverview.colTitle", { defaultValue: "Tytuł" })}
              </th>
              <th className="p-2 text-left w-16">
                {t("admin.seoOverview.colKind", { defaultValue: "Typ" })}
              </th>
              <th className="p-2 text-left w-24">
                {t("admin.seoOverview.colStatus", { defaultValue: "Status" })}
              </th>
              <th className="p-2 text-center w-20">
                {t("admin.seoOverview.colDesc", { defaultValue: "Opis PL / EN" })}
              </th>
              <th className="p-2 text-left w-32">
                {t("admin.seoOverview.colImage", { defaultValue: "Obrazek OG" })}
              </th>
              <th className="p-2 text-center w-16">noindex</th>
              <th className="p-2 text-left w-28">
                {t("admin.seoOverview.colScore", { defaultValue: "Kompletność" })}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(({ kind, row, status }) => (
              <tr key={`${kind}-${row.id}`} className="hover:bg-muted/20">
                <td className="p-2 max-w-[280px]">
                  <Link
                    to={kind === "post" ? "/admin/posts/$slug" : "/admin/pages/$slug"}
                    params={{ slug: row.slug }}
                    className="font-medium hover:text-brand hover:underline block truncate"
                    title={row.title_pl || row.title_en}
                  >
                    {row.title_pl || row.title_en || row.slug}
                  </Link>
                  <span className="text-[10px] text-muted-foreground font-mono">/{row.slug}</span>
                </td>
                <td className="p-2 text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    {kind === "post" ? (
                      <Newspaper className="w-3 h-3" />
                    ) : (
                      <File className="w-3 h-3" />
                    )}
                    {kind === "post"
                      ? t("admin.seoOverview.kindPost", { defaultValue: "Wpis" })
                      : t("admin.seoOverview.kindPage", { defaultValue: "Strona" })}
                  </span>
                </td>
                <td className="p-2">
                  <StatusBadge
                    status={row.status}
                    label={t(`admin.status.${row.status}`, { defaultValue: row.status })}
                  />
                </td>
                <td className="p-2 text-center whitespace-nowrap">
                  <span title={isPL ? "Opis PL" : "PL description"}>
                    <DescriptionMark source={status.description.pl} />
                  </span>
                  <span className="text-muted-foreground mx-1">/</span>
                  <span title={isPL ? "Opis EN" : "EN description"}>
                    <DescriptionMark source={status.description.en} />
                  </span>
                </td>
                <td className="p-2 text-muted-foreground">
                  {imageSourceLabel[status.socialImage]}
                </td>
                <td className="p-2 text-center">
                  {status.noindex ? (
                    <span className="text-[10px] font-medium text-destructive border border-destructive/40 rounded-full px-2 py-0.5">
                      noindex
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td className="p-2">
                  <SeoScorePill score={status.score} grade={status.grade} />
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  {rows.length
                    ? t("admin.list.noResults", { defaultValue: "Brak wyników dla filtrów" })
                    : t("admin.loading")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("admin.seoOverview.scoreHint", {
          defaultValue:
            "Kompletność: opisy PL i EN po 25 pkt, obrazek OG inny niż domyślny 20 pkt, tytuł SEO 15 pkt, indeksowalność 15 pkt.",
        })}
      </p>
    </div>
  );
}
