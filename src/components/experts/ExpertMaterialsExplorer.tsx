// Eksplorator materiałów eksperta: filtry po formacie, temacie, regionie,
// programie i roku (AND) + siatka kart. Stan strony i filtrów żyje w URL
// (?page/kind/topic/region/program/year), a stronę wycina baza - RPC
// get_expert_materials liczy total i zwraca tylko bieżące okno (paginacja
// serwerowa jak w archiwach taksonomii, nie kliencka na pobranym komplecie).
// Deep-linki i przycisk wstecz działają, SSR renderuje dokładnie stronę N.
// Fasety (typy/tematy/regiony/programy/lata) pochodzą z ładunku huba - są
// zawężone w SQL do wartości, które coś zwrócą.
import { useEffect, useMemo, useRef, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { getRouteApi } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, RotateCcw, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArchivePagination } from "@/components/archive/layouts/ArchivePagination";
import { ExpertMaterialCard } from "./ExpertMaterialCard";
import { availableYears, kindCounts } from "@/lib/experts/filter";
import { expertMaterialsQueryOptions } from "@/lib/experts/materials";
import { EXPERT_MATERIALS_PAGE_SIZE, materialsTotalPages } from "@/lib/experts/materialsPage";
import {
  filtersFromAuthorHubSearch,
  hasActiveMaterialFilters,
  type AuthorHubSearch,
} from "@/lib/experts/materialsSearch";
import type { ExpertHubData, MaterialKind } from "@/lib/experts/types";

const ALL = "__all__";
const KIND_ORDER: MaterialKind[] = ["article", "report", "video", "podcast", "event"];

// Typowany dostęp do search params trasy bez prop-drillingu - eksplorator
// jest organizmem strony /author/$slug i to jej URL jest źródłem prawdy.
const routeApi = getRouteApi("/author/$slug");

function FacetSelect({
  value,
  onChange,
  options,
  allLabel,
  ariaLabel,
  alwaysShow = false,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  options: { value: string; label: string; count?: number }[];
  allLabel: string;
  ariaLabel: string;
  alwaysShow?: boolean;
}) {
  if (options.length === 0 && !alwaysShow) return null;
  return (
    <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? null : next)}>
      <SelectTrigger
        aria-label={ariaLabel}
        className="h-9 w-auto min-w-[150px] max-w-[240px] rounded-[6px] bg-muted/30 text-xs"
      >
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
            {typeof opt.count === "number" ? ` (${opt.count})` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Szkielet karty na czas pierwszego ładowania strony wyników (bez SSR-seedu). */
function MaterialCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[8px] border border-border/60" aria-hidden>
      <div className="aspect-[16/9] animate-pulse bg-muted/50" />
      <div className="space-y-2 p-4">
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted/50" />
        <div className="h-4 w-full animate-pulse rounded bg-muted/50" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted/50" />
      </div>
    </div>
  );
}

export function ExpertMaterialsExplorer({
  data,
  lang,
}: {
  data: ExpertHubData;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  const { slug } = routeApi.useParams();
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const [isPending, startTransition] = useTransition();
  const sectionRef = useRef<HTMLDivElement | null>(null);

  const { materials, facets } = data;
  const filters = useMemo(() => filtersFromAuthorHubSearch(search), [search]);
  const page = search.page ?? 1;

  // Strona wyników z paginacji serwerowej; loader trasy zasiał cache dla SSR,
  // a keepPreviousData trzyma poprzednie okno w trakcie zmiany strony/filtra.
  const pageQ = useQuery(expertMaterialsQueryOptions(slug, { page, filters }));

  // Fasety liczone z kompletu materiałów huba (etykiety z licznościami).
  const counts = useMemo(() => kindCounts(materials), [materials]);
  const years = useMemo(() => availableYears(materials), [materials]);

  const total = pageQ.data?.total ?? 0;
  const totalPages = materialsTotalPages(total, EXPERT_MATERIALS_PAGE_SIZE);
  const currentPage = Math.min(page, totalPages);
  const pageMaterials = pageQ.data?.materials ?? [];
  const hasActiveFilters = hasActiveMaterialFilters(search);
  const busy = isPending || pageQ.isFetching;

  const applySearch = (
    updater: (prev: AuthorHubSearch) => AuthorHubSearch,
    replace = false,
  ): void => {
    startTransition(() => {
      // resetScroll: false - kotwicą widoku pozostaje sekcja materiałów,
      // globalny scroll-to-top wyrzucałby czytelnika do hero profilu.
      void navigate({ to: ".", search: updater, replace, resetScroll: false });
    });
  };

  /** Zmiana filtra wraca na stronę 1 (klucze puste = czysty, kanoniczny URL). */
  const setFilter = (patch: Partial<AuthorHubSearch>): void => {
    applySearch((prev) => ({ ...prev, ...patch, page: undefined }));
  };

  const goToPage = (nextPage: number): void => {
    applySearch((prev) => ({ ...prev, page: nextPage <= 1 ? undefined : nextPage }));
  };

  // URL poza zakresem (stary bookmark, skasowane materiały): po nadejściu
  // totalu przepisz go na ostatnią realną stronę - `replace`, bez śmiecenia
  // historii. RPC dla takiej strony zwraca pustą listę i prawdziwy total.
  useEffect(() => {
    if (!pageQ.data || pageQ.data.total === 0 || page <= totalPages) return;
    applySearch((prev) => ({ ...prev, page: totalPages <= 1 ? undefined : totalPages }), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageQ.data, page, totalPages]);

  // Zmiana strony przewija do początku sekcji (użytkownik klika paginację pod
  // siatką); filtry nie przewijają - pasek filtrów jest już w widoku.
  const prevPageRef = useRef(page);
  useEffect(() => {
    if (prevPageRef.current === page) return;
    prevPageRef.current = page;
    const el = sectionRef.current;
    if (!el || typeof window === "undefined") return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }, [page]);

  const kindOptions = KIND_ORDER.filter((k) => counts[k] > 0).map((k) => ({
    value: k,
    label: t(`expert.kindPlural.${k}`),
    count: counts[k],
  }));

  const heading = (
    <h2 className="mb-4 flex items-center gap-2 font-display text-lg">
      <span style={{ color: "var(--pv-accent)" }}>
        <BookOpen className="h-4 w-4" aria-hidden />
      </span>
      {t("expert.publicationsHeading")}
    </h2>
  );

  if (materials.length === 0) {
    return (
      <div>
        {heading}
        <p className="rounded-[8px] border border-dashed border-border/70 px-6 py-10 text-center text-sm text-muted-foreground">
          {t("expert.noMaterials")}
        </p>
      </div>
    );
  }

  return (
    <div ref={sectionRef} className="scroll-mt-24">
      {heading}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FacetSelect
          value={filters.kind}
          onChange={(next) => setFilter({ kind: (next as MaterialKind | null) ?? undefined })}
          options={kindOptions}
          allLabel={t("expert.allFormats")}
          ariaLabel={t("expert.filterFormat")}
        />
        <FacetSelect
          value={filters.topic}
          onChange={(next) => setFilter({ topic: next ?? undefined })}
          options={facets.tags.map((tag) => ({
            value: tag.slug,
            label: tag.name,
          }))}
          allLabel={t("expert.allTopics")}
          ariaLabel={t("expert.filterTopic")}
          alwaysShow
        />
        <FacetSelect
          value={filters.region}
          onChange={(next) => setFilter({ region: next ?? undefined })}
          options={facets.regions.map((r) => ({
            value: r.slug,
            label: lang === "en" ? r.name_en : r.name_pl,
          }))}
          allLabel={t("expert.allRegions")}
          ariaLabel={t("expert.filterRegion")}
          alwaysShow
        />
        {facets.programs.length > 0 && (
          <FacetSelect
            value={filters.program}
            onChange={(next) => setFilter({ program: next ?? undefined })}
            options={facets.programs.map((p) => ({
              value: p.slug,
              label: lang === "en" ? p.name_en : p.name_pl,
            }))}
            allLabel={t("expert.allPrograms")}
            ariaLabel={t("expert.filterProgram")}
          />
        )}
        {years.length > 1 && (
          <FacetSelect
            value={filters.year !== null ? String(filters.year) : null}
            onChange={(next) => setFilter({ year: next ? Number(next) : undefined })}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
            allLabel={t("expert.allYears")}
            ariaLabel={t("expert.filterYear")}
          />
        )}
        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 gap-1 text-xs"
            onClick={() =>
              setFilter({
                kind: undefined,
                topic: undefined,
                region: undefined,
                program: undefined,
                year: undefined,
              })
            }
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            {t("expert.clearFilters")}
          </Button>
        )}
      </div>

      <p className="mb-3 text-xs text-muted-foreground" aria-live="polite">
        {t("expert.resultsCount", { count: total, total: materials.length })}
        {totalPages > 1 && (
          <span>
            {" · "}
            {t("expert.pageIndicator", {
              page: currentPage,
              pages: totalPages,
            })}
          </span>
        )}
      </p>

      {pageQ.isError ? (
        <div className="rounded-[8px] border border-dashed border-destructive/40 px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("expert.materialsError")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4 gap-1"
            onClick={() => void pageQ.refetch()}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t("expert.retry")}
          </Button>
        </div>
      ) : pageQ.isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <MaterialCardSkeleton key={i} />
          ))}
        </div>
      ) : total === 0 ? (
        <p className="rounded-[8px] border border-dashed border-border/70 px-6 py-10 text-center text-sm text-muted-foreground">
          {t("expert.emptyMaterials")}
        </p>
      ) : (
        <>
          <div
            className={`grid gap-5 transition-opacity sm:grid-cols-2 lg:grid-cols-3 ${
              busy ? "opacity-60" : "opacity-100"
            }`}
            aria-busy={busy}
          >
            {pageMaterials.map((m) => (
              <ExpertMaterialCard key={`${m.kind}-${m.id}`} material={m} lang={lang} t={t} />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="mt-6">
              <ArchivePagination
                page={currentPage}
                totalPages={totalPages}
                onPageChange={goToPage}
                isPending={busy}
                lang={lang}
                t={t}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
