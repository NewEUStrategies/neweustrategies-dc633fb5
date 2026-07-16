// Eksplorator materiałów eksperta: filtry po formacie, temacie, regionie,
// programie i roku (AND), plus siatka kart. Filtrowanie jest po stronie
// klienta na komplecie materiałów (patrz lib/experts/queries).
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ExpertMaterialCard } from "./ExpertMaterialCard";
import { applyMaterialFilters, availableYears, kindCounts } from "@/lib/experts/filter";
import {
  EMPTY_MATERIAL_FILTERS,
  type ExpertHubData,
  type MaterialFilters,
  type MaterialKind,
} from "@/lib/experts/types";

const ALL = "__all__";
const KIND_ORDER: MaterialKind[] = ["article", "report", "video", "podcast", "event"];

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

export function ExpertMaterialsExplorer({
  data,
  lang,
}: {
  data: ExpertHubData;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<MaterialFilters>(EMPTY_MATERIAL_FILTERS);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 9;

  const { materials, facets } = data;
  const counts = useMemo(() => kindCounts(materials), [materials]);
  const years = useMemo(() => availableYears(materials), [materials]);
  const filtered = useMemo(() => applyMaterialFilters(materials, filters), [materials, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  );

  useEffect(() => {
    setPage(1);
  }, [filters]);

  const hasActiveFilters =
    filters.kind !== null ||
    filters.programId !== null ||
    filters.regionId !== null ||
    filters.categoryId !== null ||
    filters.tagId !== null ||
    filters.year !== null;

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
      {t("expert.publicationsHeading", {
        defaultValue: lang === "en" ? "Expert publications" : "Publikacje eksperta",
      })}
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
    <div>
      {heading}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FacetSelect
          value={filters.kind}
          onChange={(next) => setFilters((f) => ({ ...f, kind: (next as MaterialKind) ?? null }))}
          options={kindOptions}
          allLabel={t("expert.allFormats")}
          ariaLabel={t("expert.filterFormat")}
        />
        <FacetSelect
          value={filters.tagId}
          onChange={(next) => setFilters((f) => ({ ...f, tagId: next }))}
          options={facets.tags.map((t) => ({
            value: t.id,
            label: t.name,
          }))}
          allLabel={t("expert.allTopics", {
            defaultValue: lang === "en" ? "All topics" : "Wszystkie tematy",
          })}
          ariaLabel={t("expert.filterTopic", {
            defaultValue: lang === "en" ? "Filter by topic" : "Filtruj po tematyce",
          })}
          alwaysShow
        />
        <FacetSelect
          value={filters.regionId}
          onChange={(next) => setFilters((f) => ({ ...f, regionId: next }))}
          options={facets.regions.map((r) => ({
            value: r.id,
            label: lang === "en" ? r.name_en : r.name_pl,
          }))}
          allLabel={t("expert.allRegions", {
            defaultValue: lang === "en" ? "All regions" : "Wszystkie regiony",
          })}
          ariaLabel={t("expert.filterRegion", {
            defaultValue: lang === "en" ? "Filter by region" : "Filtruj po regionie",
          })}
          alwaysShow
        />
        {facets.programs.length > 0 && (
          <FacetSelect
            value={filters.programId}
            onChange={(next) => setFilters((f) => ({ ...f, programId: next }))}
            options={facets.programs.map((p) => ({
              value: p.id,
              label: lang === "en" ? p.name_en : p.name_pl,
            }))}
            allLabel={t("expert.allPrograms")}
            ariaLabel={t("expert.filterProgram")}
          />
        )}
        {years.length > 1 && (
          <FacetSelect
            value={filters.year !== null ? String(filters.year) : null}
            onChange={(next) => setFilters((f) => ({ ...f, year: next ? Number(next) : null }))}
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
            onClick={() => setFilters(EMPTY_MATERIAL_FILTERS)}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            {t("expert.clearFilters")}
          </Button>
        )}
      </div>

      <p className="mb-3 text-xs text-muted-foreground" aria-live="polite">
        {t("expert.resultsCount", { count: filtered.length, total: materials.length })}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-[8px] border border-dashed border-border/70 px-6 py-10 text-center text-sm text-muted-foreground">
          {t("expert.emptyMaterials")}
        </p>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {paged.map((m) => (
              <ExpertMaterialCard key={`${m.kind}-${m.id}`} material={m} lang={lang} t={t} />
            ))}
          </div>
          {totalPages > 1 && (
            <nav
              className="mt-6 flex items-center justify-center gap-1"
              aria-label={lang === "en" ? "Pagination" : "Paginacja"}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                aria-label={lang === "en" ? "Previous page" : "Poprzednia strona"}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant={p === currentPage ? "default" : "ghost"}
                  size="sm"
                  className="h-9 min-w-9 px-3 text-xs"
                  onClick={() => setPage(p)}
                  aria-current={p === currentPage ? "page" : undefined}
                >
                  {p}
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                aria-label={lang === "en" ? "Next page" : "Następna strona"}
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
