// Eksplorator wymiarów wyszukiwarki: zakładki "Rodzaje treści" i "Tematyka"
// pokazują pasujące wartości wymiarów (typ publikacji, format, temat, region…)
// jako premium karty z licznikami. Wybór wartości nakłada filtr i wraca do
// sekcji "Wszystko". Prezentacyjny - liczniki pochodzą z search_facets.
import { useTranslation } from "react-i18next";
import { ArrowRight } from "@/lib/lucide-shim";
import type { FacetDim, FacetValue } from "@/lib/queries/archives";
import { TAXONOMY_DIMS } from "@/lib/queries/archives";
import {
  DIM_PARAM,
  facetLabel,
  groupFacets,
  orderTree,
  type SearchUrl,
} from "@/lib/search/facetModel";

interface Props {
  facets: FacetValue[];
  /** Wymiary tej zakładki, w kolejności wyświetlania. */
  dims: readonly FacetDim[];
  lang: "pl" | "en";
  onChange: (patch: Partial<SearchUrl>) => void;
}

/** Łatka filtrująca dla wartości wymiaru + powrót do sekcji "Wszystko". */
function patchFor(value: FacetValue): Partial<SearchUrl> {
  const base: Partial<SearchUrl> = { tab: undefined };
  const dim = value.dim;
  if ((TAXONOMY_DIMS as readonly string[]).includes(dim)) {
    const key = DIM_PARAM[dim as (typeof TAXONOMY_DIMS)[number]];
    return { ...base, [key]: value.id ?? value.slug };
  }
  if (dim === "author") return { ...base, author: value.id ?? value.slug };
  if (dim === "format") return { ...base, format: value.slug };
  if (dim === "lang") return { ...base, lang: value.slug as SearchUrl["lang"] };
  if (dim === "access") return { ...base, access: value.slug };
  if (dim === "year") return { ...base, year: value.slug, from: undefined, to: undefined };
  return base;
}

export function TermExplorer({ facets, dims, lang, onChange }: Props) {
  const { t } = useTranslation();
  const byDim = groupFacets(facets);
  const groups = dims
    .map((dim) => ({ dim, values: byDim.get(dim) ?? [] }))
    .filter((g) => g.values.length > 0);

  if (groups.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {t("search.explore.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {groups.map(({ dim, values }) => {
        const ordered =
          dim === "region" ? orderTree(values) : values.map((value) => ({ value, depth: 0 }));
        return (
          <section key={dim} aria-label={t(`search.dim.${dim}`, { defaultValue: dim })}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              {t(`search.dim.${dim}`, { defaultValue: dim })}
              <span className="ml-2 tabular-nums text-muted-foreground/70">{values.length}</span>
            </h3>
            <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {ordered.map(({ value, depth }) => (
                <li key={value.id ?? `${value.dim}:${value.slug}`}>
                  <button
                    type="button"
                    onClick={() => onChange(patchFor(value))}
                    className="group flex w-full items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-left transition-colors hover:border-brand"
                    style={depth > 0 ? { marginLeft: `${depth * 0.85}rem` } : undefined}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-display font-semibold text-foreground group-hover:text-brand-ink transition-colors">
                        {facetLabel(value, lang, t)}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                        {t("search.results_count", { count: value.count })}
                      </span>
                    </span>
                    <ArrowRight
                      className="w-4 h-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand-ink"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
