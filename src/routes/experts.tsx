// Publiczny katalog ekspertów. Karty z funkcją, obszarami i liczbą publikacji,
// filtrowane po obszarze ekspertyzy i programie (deep-link przez ?area=slug
// z profilu). Każda karta prowadzi do huba eksperta (/author/$slug).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { expertsDirectoryQueryOptions } from "@/lib/experts/directory";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import "@/lib/i18n-experts";

interface ExpertsSearch {
  area?: string;
  program?: string;
}

const ALL = "__all__";

export const Route = createFileRoute("/experts")({
  validateSearch: (s: Record<string, unknown>): ExpertsSearch => ({
    area: typeof s.area === "string" ? s.area : undefined,
    program: typeof s.program === "string" ? s.program : undefined,
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(expertsDirectoryQueryOptions());
    return null;
  },
  head: () => {
    const url = getRequestUrl() || "/experts";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: lang === "en" ? "Experts - New European Strategies" : "Eksperci - New European Strategies",
      description:
        lang === "en"
          ? "The New European Strategies analytical team: profiles, programs and areas of expertise."
          : "Zespół analityczny New European Strategies: profile, programy i obszary ekspertyzy.",
    });
  },
  component: ExpertsDirectoryPage,
  pendingComponent: () => <ArchiveSkeleton />,
  errorComponent: (props) => (
    <RouteErrorFallback
      {...props}
      title={activeLang() === "en" ? "Failed to load experts" : "Nie udało się załadować ekspertów"}
    />
  ),
});

function ExpertsDirectoryPage() {
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data } = useSuspenseQuery(expertsDirectoryQueryOptions());
  const [programFilter, setProgramFilter] = useState<string | null>(null);

  const areaSlug = search.area ?? null;
  const areaId = useMemo(
    () => data.facets.areas.find((a) => a.slug === areaSlug)?.id ?? null,
    [data.facets.areas, areaSlug],
  );

  const filtered = useMemo(() => {
    return data.experts.filter((e) => {
      if (areaId && !e.areas.some((a) => a.id === areaId)) return false;
      if (programFilter && !e.programs.some((p) => p.id === programFilter)) return false;
      return true;
    });
  }, [data.experts, areaId, programFilter]);

  const hasActiveFilters = areaSlug !== null || programFilter !== null;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 lg:px-8">
      <Breadcrumbs items={[{ label: t("expert.directoryTitle") }]} />
      <header className="mb-6">
        <h1 className="font-display text-3xl lg:text-4xl">{t("expert.directoryTitle")}</h1>
        <p className="mt-1 text-muted-foreground">{t("expert.directorySubtitle")}</p>
      </header>

      {(data.facets.areas.length > 0 || data.facets.programs.length > 0) && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {data.facets.areas.length > 0 && (
            <Select
              value={areaSlug ?? ALL}
              onValueChange={(next) =>
                navigate({
                  search: (prev: ExpertsSearch) => ({ ...prev, area: next === ALL ? undefined : next }),
                })
              }
            >
              <SelectTrigger
                aria-label={t("expert.filterArea")}
                className="h-9 w-auto min-w-[160px] max-w-[240px] rounded-[6px] bg-muted/30 text-xs"
              >
                <SelectValue placeholder={t("expert.allAreas")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("expert.allAreas")}</SelectItem>
                {data.facets.areas.map((a) => (
                  <SelectItem key={a.id} value={a.slug}>
                    {lang === "en" ? a.name_en : a.name_pl}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {data.facets.programs.length > 0 && (
            <Select
              value={programFilter ?? ALL}
              onValueChange={(next) => setProgramFilter(next === ALL ? null : next)}
            >
              <SelectTrigger
                aria-label={t("expert.filterProgram")}
                className="h-9 w-auto min-w-[160px] max-w-[240px] rounded-[6px] bg-muted/30 text-xs"
              >
                <SelectValue placeholder={t("expert.allPrograms")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("expert.allPrograms")}</SelectItem>
                {data.facets.programs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {lang === "en" ? p.name_en : p.name_pl}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 text-xs"
              onClick={() => {
                setProgramFilter(null);
                navigate({ search: (prev: ExpertsSearch) => ({ ...prev, area: undefined }) });
              }}
            >
              {t("expert.clearFilters")}
            </Button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[8px] border border-dashed border-border/70 p-12 text-center">
          <Users className="h-6 w-6 text-muted-foreground/50" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {hasActiveFilters ? t("expert.directoryEmptyFiltered") : t("expert.directoryEmpty")}
          </p>
        </div>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => {
            const target = e.slug ?? e.id;
            const role = [e.job_title, e.company].filter(Boolean).join(" · ");
            return (
              <li
                key={e.id}
                className="flex flex-col gap-3 rounded-[10px] border border-border/60 bg-card p-4 transition-colors hover:border-border"
              >
                <Link
                  to="/author/$slug"
                  params={{ slug: target }}
                  className="flex items-center gap-3 rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {e.avatar_url ? (
                    <img
                      src={e.avatar_url}
                      alt=""
                      className="h-14 w-14 rounded-full object-cover"
                    />
                  ) : (
                    <div className="grid h-14 w-14 place-items-center rounded-full bg-muted text-sm text-muted-foreground">
                      {(e.display_name ?? "?").slice(0, 1)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate font-semibold">
                      {e.display_name}
                      {e.verified_at && (
                        <BadgeCheck
                          className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400"
                          aria-hidden
                        />
                      )}
                    </p>
                    {role && <p className="truncate text-xs text-muted-foreground">{role}</p>}
                  </div>
                </Link>

                {e.areas.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {e.areas.slice(0, 3).map((a) => (
                      <span
                        key={a.id}
                        className="rounded-full border border-[var(--brand)]/25 bg-[var(--brand)]/5 px-2 py-0.5 text-[11px] text-foreground/80"
                      >
                        {lang === "en" ? a.name_en : a.name_pl}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-auto flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    {t("expert.publicationsCount", { count: e.postCount })}
                  </span>
                  <Link
                    to="/author/$slug"
                    params={{ slug: target }}
                    className="text-xs font-medium text-brand hover:underline"
                  >
                    {t("expert.viewProfile")} →
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
