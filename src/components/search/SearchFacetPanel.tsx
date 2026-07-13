// Panel fasetowy /search: grupy wymiarów z licznikami (wzorzec CSIS/RUSI).
// Pojedynczy wybór na wymiar; region renderowany hierarchicznie (region →
// państwo). Stan wyszukiwarki żyje w URL - panel emituje tylko łatki (patche).
import { useTranslation } from "react-i18next";
import type { FacetValue, FacetDim } from "@/lib/queries/archives";
import { TAXONOMY_DIMS } from "@/lib/queries/archives";
import {
  DIM_PARAM,
  FACET_ORDER,
  groupFacets,
  orderTree,
  facetLabel,
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
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  depth: number;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        style={depth > 0 ? { paddingLeft: `${0.5 + depth * 0.85}rem` } : undefined}
        className={`w-full text-left flex justify-between items-center gap-2 px-2 py-1 rounded text-sm transition ${
          active ? "bg-brand/10 text-brand-ink font-medium" : "hover:bg-muted"
        }`}
      >
        <span className="truncate">{label}</span>
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

    // Aktualnie wybrana wartość tego wymiaru (pojedynczy wybór).
    const taxParam = (TAXONOMY_DIMS as readonly FacetDim[]).includes(dim)
      ? DIM_PARAM[dim as (typeof TAXONOMY_DIMS)[number]]
      : undefined;
    const selected: string | undefined =
      dim === "author"
        ? url.author
        : dim === "format"
          ? url.format
          : dim === "lang"
            ? url.lang
            : dim === "access"
              ? url.access
              : dim === "year"
                ? url.year
                : taxParam
                  ? (url[taxParam] as string | undefined)
                  : undefined;

    // Wartość identyfikująca wybór: taksonomia i autor po id, reszta po slugu.
    const idOf = (f: FacetValue) => (dim === "author" || taxParam ? (f.id ?? f.slug) : f.slug);

    const patchFor = (value: string | undefined): Partial<SearchUrl> => {
      if (dim === "author") return { author: value };
      if (dim === "format") return { format: value };
      if (dim === "lang") return { lang: value as SearchUrl["lang"] };
      if (dim === "access") return { access: value };
      if (dim === "year") return { year: value, from: undefined, to: undefined };
      if (taxParam) return { [taxParam]: value } as Partial<SearchUrl>;
      return {};
    };

    const toggle = (f: FacetValue) => {
      const id = idOf(f);
      onChange(patchFor(selected === id ? undefined : id));
    };

    const rows =
      dim === "region" ? orderTree(values) : values.map((value) => ({ value, depth: 0 }));

    return (
      <div key={dim}>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
          {t(`search.dim.${dim}`, { defaultValue: dim })}
        </h3>
        <ul className="space-y-0.5">
          {rows.map(({ value, depth }) => {
            const id = idOf(value);
            return (
              <FacetRow
                key={`${value.id ?? ""}${value.slug}`}
                label={facetLabel(value, lang, t)}
                count={value.count}
                active={selected === id}
                depth={depth}
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
