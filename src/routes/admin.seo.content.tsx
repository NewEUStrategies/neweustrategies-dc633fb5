// Tabela SEO WSZYSTKICH treści (/admin/seo/content): każdy wpis i każda strona
// ze swoim stanem SEO - opisy per język, źródło obrazka społecznościowego,
// nadpisania, noindex i wynik 0-100.
//
// Ekran przyjechał tu z `/admin/seo`, gdy ta trasa stała się układem zakładek
// (patrz nagłówek `admin.seo.tsx`). Treść jest niezmieniona: logika oceny
// mieszka w czystym module `@/lib/seo/contentStatus`, a ten ekran wyłącznie
// pobiera wiersze i renderuje. Tytuł strony i podtytuł kokpitu rysuje układ,
// więc zostaje tu sam podtytuł opisujący TĘ zakładkę.
//
// CZTERY STANY LISTY, nie dwa: ładowanie, AWARIA ODCZYTU (komunikat
// + „Spróbuj ponownie"), pusta baza i brak trafień filtra. Do 2026-10 padnięty
// odczyt zostawiał `rows` puste i tabela mówiła „ładowanie" w nieskończoność -
// redakcja nie miała jak się dowiedzieć, że przegląd SEO nie działa.
// Odczyt (zapytanie, limity, liczność) dzieli z kokpitem `@/lib/seo/seoContentQuery`.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
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
import {
  ContentCoverageNotice,
  ContentReadError,
  PartialTag,
} from "@/components/admin/seo/ContentCoverageNotice";
import { Check, File, Newspaper, X } from "@/lib/lucide-shim";
import { ensureI18n } from "@/lib/i18n-admin-seo-hub";
import {
  seoContentStatus,
  summarizeSeoStatuses,
  type SeoContentStatus,
} from "@/lib/seo/contentStatus";
import {
  seoContentCoverage,
  seoContentQueryOptions,
  type SeoContentRow,
} from "@/lib/seo/seoContentQuery";

export const Route = createFileRoute("/admin/seo/content")({
  component: SeoContentOverview,
  head: () => ({ meta: [{ title: "SEO - Przegląd treści" }] }),
});

interface OverviewRow {
  kind: "post" | "page";
  row: SeoContentRow;
  status: SeoContentStatus;
}

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

function SeoContentOverview() {
  // Nakładka kokpitu SEO, a NIE `i18n-admin-extras`. Komunikat pustki stał
  // wcześniej na `admin.list.noResults` - kluczu z tamtej, dużej nakładki.
  // Wciągnięcie jej tutaj wyłącznie dla jednego napisu dołożyłoby cały słownik
  // panelu do chunku tej zakładki (i realnie wywróciło atrapy testów, bo
  // przyciąga graf serwerowy). Własny klucz w małej nakładce, którą i tak
  // ładuje układ zakładek, kosztuje jedną parę napisów.
  ensureI18n();
  const { t } = useTranslation();
  const tenantId = useRequiredTenant();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [seoFilter, setSeoFilter] = useState<SeoFilter>("all");

  const postsQuery = useQuery(seoContentQueryOptions("posts", tenantId));
  const pagesQuery = useQuery(seoContentQueryOptions("pages", tenantId));
  const posts = postsQuery.data;
  const pages = pagesQuery.data;
  // Awaria KTÓREJKOLWIEK tabeli to awaria przeglądu: połowa listy z kafelkami
  // policzonymi z połowy wyglądałaby jak komplet.
  const readFailed = postsQuery.isError || pagesQuery.isError;
  const loading = !readFailed && (postsQuery.isPending || pagesQuery.isPending);
  const coverage = useMemo(() => seoContentCoverage([posts, pages]), [posts, pages]);
  // Dopisek „częściowe" przy kafelkach tylko po udanym odczycie OBU tabel -
  // w trakcie ładowania „nieznane" byłoby fałszywym alarmem, a awarię
  // komunikuje osobny stan błędu.
  const partial = !loading && !readFailed && coverage.state !== "complete";
  // Ponawiamy WYŁĄCZNIE tabelę, która padła - udany odczyt drugiej zostaje w cache.
  const retryContent = () => {
    if (postsQuery.isError) void postsQuery.refetch();
    if (pagesQuery.isError) void pagesQuery.refetch();
  };

  const rows = useMemo<OverviewRow[]>(() => {
    const assess =
      (kind: "post" | "page") =>
      (row: SeoContentRow): OverviewRow => ({
        kind,
        row,
        status: seoContentStatus(row),
      });
    return [...(pages?.rows ?? []).map(assess("page")), ...(posts?.rows ?? []).map(assess("post"))];
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
      label: t("admin.seoOverview.tileTotal"),
      value: summary.total,
      tone: "text-foreground",
    },
    {
      key: "missing",
      label: t("admin.seoOverview.tileMissingDesc"),
      value: summary.missingDescription,
      tone: summary.missingDescription ? "text-destructive" : "text-emerald-500",
      filter: "missing_description" as const,
    },
    {
      key: "image",
      label: t("admin.seoOverview.tileDefaultImage"),
      value: summary.defaultImage,
      tone: summary.defaultImage ? "text-amber-500" : "text-emerald-500",
      filter: "default_image" as const,
    },
    {
      key: "noindex",
      label: t("admin.seoOverview.tileNoindex"),
      value: summary.noindexed,
      tone: "text-muted-foreground",
      filter: "noindex" as const,
    },
    {
      key: "overrides",
      label: t("admin.seoOverview.tileOverrides"),
      value: summary.withOverrides,
      tone: "text-muted-foreground",
      filter: "overrides" as const,
    },
  ];

  const imageSourceLabel: Record<SeoContentStatus["socialImage"], string> = {
    override: t("admin.seo.og.sourceOverride"),
    cover: t("admin.seo.og.sourceCover"),
    card: t("admin.seo.og.sourceCard"),
    default: t("admin.seo.og.sourceDefault"),
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("admin.seoOverview.subtitle")}</p>

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
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {tile.label}
              {partial ? <PartialTag /> : null}
            </div>
          </button>
        ))}
      </div>

      {readFailed ? (
        <ContentReadError onRetry={retryContent} />
      ) : partial ? (
        <ContentCoverageNotice coverage={coverage} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("admin.seoOverview.searchPlaceholder")}
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
            <SelectItem value="all">{t("admin.seoOverview.kindAll")}</SelectItem>
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
              <th className="p-2 text-left">{t("admin.seoOverview.colTitle")}</th>
              <th className="p-2 text-left w-16">{t("admin.seoOverview.colKind")}</th>
              <th className="p-2 text-left w-24">{t("admin.seoOverview.colStatus")}</th>
              <th className="p-2 text-center w-20">{t("admin.seoOverview.colDesc")}</th>
              <th className="p-2 text-left w-32">{t("admin.seoOverview.colImage")}</th>
              <th className="p-2 text-center w-16">{t("adminSeoHub.noindexLabel")}</th>
              <th className="p-2 text-left w-28">{t("admin.seoOverview.colScore")}</th>
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
                      ? t("admin.seoOverview.kindPost")
                      : t("admin.seoOverview.kindPage")}
                  </span>
                </td>
                <td className="p-2">
                  <StatusBadge
                    status={row.status}
                    label={t(`admin.status.${row.status}`, { defaultValue: row.status })}
                  />
                </td>
                <td className="p-2 text-center whitespace-nowrap">
                  <span title={t("adminSeoHub.colDescPl")}>
                    <DescriptionMark source={status.description.pl} />
                  </span>
                  <span className="text-muted-foreground mx-1">/</span>
                  <span title={t("adminSeoHub.colDescEn")}>
                    <DescriptionMark source={status.description.en} />
                  </span>
                </td>
                <td className="p-2 text-muted-foreground">
                  {imageSourceLabel[status.socialImage]}
                </td>
                <td className="p-2 text-center">
                  {status.noindex ? (
                    <span className="text-[10px] font-medium text-destructive border border-destructive/40 rounded-full px-2 py-0.5">
                      {t("adminSeoHub.noindexLabel")}
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
            {/* Przy awarii bez żadnego wiersza pusta tabela nic nie dopowiada -
                stan mówi komunikat błędu nad nią, nie „ładowanie" ani „pusto". */}
            {!filtered.length && !(readFailed && !rows.length) && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  {rows.length
                    ? t("adminSeoHub.noResults")
                    : loading
                      ? t("admin.loading")
                      : t("adminSeoHub.contentEmpty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("admin.seoOverview.scoreHint")}</p>
    </div>
  );
}
