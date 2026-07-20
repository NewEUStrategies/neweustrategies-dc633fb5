// Panel fasetowy /search: grupy wymiarów z licznikami (wzorzec think-tank/RUSI).
// Wymiary taksonomii są MULTI-SELECT (OR wewnątrz wymiaru, AND między
// wymiarami - standard Algolii); autor/format/język/dostęp/rok pozostają
// pojedynczego wyboru. Region renderowany hierarchicznie (region → państwo).
// Stan wyszukiwarki żyje w URL - panel emituje tylko łatki (patche).
import { useTranslation } from "react-i18next";
import { Check } from "@/lib/lucide-shim";
import type { FacetValue, FacetDim } from "@/lib/queries/archives";
import { TAXONOMY_DIMS } from "@/lib/queries/archives";
import {
  DIM_PARAM,
  FACET_ORDER,
  groupFacets,
  joinDimValues,
  orderTree,
  facetLabel,
  splitDimValues,
  type SearchUrl,
} from "@/lib/search/facetModel";

interface Props {
  facets: FacetValue[];
  url: SearchUrl;
  lang: "pl" | "en";
  onChange: (patch: Partial<SearchUrl>) => void;
}

function FacetRow({
  label,
  count,
  active,
  depth,
  multi,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  depth: number;
  /** Wymiar wielokrotnego wyboru: wiersz dostaje afordancję checkboxa. */
  multi?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role={multi ? "checkbox" : undefined}
        aria-checked={multi ? active : undefined}
        aria-pressed={multi ? undefined : active}
        onClick={onClick}
        style={depth > 0 ? { paddingLeft: `${0.5 + depth * 0.85}rem` } : undefined}
        className={`w-full text-left flex justify-between items-center gap-2 px-2 py-1 rounded text-sm transition ${
          active ? "bg-brand/10 text-brand-ink font-medium" : "hover:bg-muted"
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {multi && (
            <span
              aria-hidden
              className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border transition-colors ${
                active
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border bg-background"
              }`}
            >
              {active && <Check className="h-2.5 w-2.5" />}
            </span>
          )}
          <span className="truncate">{label}</span>
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      </button>
    </li>
  );
}

export function SearchFacetPanel({ facets, url, lang, onChange }: Props) {
  const { t } = useTranslation();
  const grouped = groupFacets(facets);

  // Renderuje jedną grupę wymiaru; zwraca null, gdy brak wartości.
  const renderGroup = (dim: FacetDim) => {
    const values = grouped.get(dim);
    if (!values || values.length === 0) return null;

    // Wymiary taksonomii: wielokrotny wybór (lista CSV w parametrze URL).
    // Autor/format/język/dostęp/rok: pojedynczy wybór jak dotąd.
    const taxParam = (TAXONOMY_DIMS as readonly FacetDim[]).includes(dim)
      ? DIM_PARAM[dim as (typeof TAXONOMY_DIMS)[number]]
      : undefined;
    const selectedValues: string[] = taxParam
      ? splitDimValues(url[taxParam] as string | undefined)
      : dim === "author"
        ? url.author
          ? [url.author]
          : []
        : dim === "format"
          ? url.format
            ? [url.format]
            : []
          : dim === "lang"
            ? url.lang
              ? [url.lang]
              : []
            : dim === "access"
              ? url.access
                ? [url.access]
                : []
              : dim === "year"
                ? url.year
                  ? [url.year]
                  : []
                : [];

    // Wartość identyfikująca wybór: taksonomia i autor po id, reszta po slugu.
    const idOf = (f: FacetValue) => (dim === "author" || taxParam ? (f.id ?? f.slug) : f.slug);

    const singlePatchFor = (value: string | undefined): Partial<SearchUrl> => {
      if (dim === "author") return { author: value };
      if (dim === "format") return { format: value };
      if (dim === "lang") return { lang: value as SearchUrl["lang"] };
      if (dim === "access") return { access: value };
      if (dim === "year") return { year: value, from: undefined, to: undefined };
      return {};
    };

    const toggle = (f: FacetValue) => {
      const id = idOf(f);
      if (taxParam) {
        // Multi-select: klik dokłada/zdejmuje wartość z listy wymiaru.
        const next = selectedValues.includes(id)
          ? selectedValues.filter((v) => v !== id)
          : [...selectedValues, id];
        onChange({ [taxParam]: joinDimValues(next) } as Partial<SearchUrl>);
        return;
      }
      onChange(singlePatchFor(selectedValues.includes(id) ? undefined : id));
    };

    const rows =
      dim === "region" ? orderTree(values) : values.map((value) => ({ value, depth: 0 }));

    return (
      <div key={dim}>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
          {t(`search.dim.${dim}`, { defaultValue: dim })}
        </h3>
        <ul className="space-y-0.5" role={taxParam ? "group" : undefined}>
          {rows.map(({ value, depth }) => {
            const id = idOf(value);
            return (
              <FacetRow
                key={`${value.id ?? ""}${value.slug}`}
                label={facetLabel(value, lang, t)}
                count={value.count}
                active={selectedValues.includes(id)}
                depth={depth}
                multi={!!taxParam}
                onClick={() => toggle(value)}
              />
            );
          })}
        </ul>
      </div>
    );
  };

  const groups = FACET_ORDER.map(renderGroup).filter(Boolean);
  if (groups.length === 0) return null;

  return <div className="space-y-5">{groups}</div>;
}
