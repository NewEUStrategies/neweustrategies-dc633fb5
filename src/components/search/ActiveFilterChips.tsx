// Aktywne filtry jako usuwalne etykiety (chipy). Klik na "x" czyści właściwe
// parametry URL. Etykiety termów rozwiązywane z faset + cache'a (odporne na
// zerową liczność bieżącego zbioru).
import { useTranslation } from "react-i18next";
import { X } from "@/lib/lucide-shim";
import type { FacetValue } from "@/lib/queries/archives";
import {
  activeSelections,
  facetLabel,
  type SearchUrl,
  type ActiveSelection,
} from "@/lib/search/facetModel";

interface Props {
  url: SearchUrl;
  facets: FacetValue[];
  /** Cache id→etykieta (i `dim:slug`→etykieta) zbierany między renderami. */
  labelCache: Record<string, string>;
  lang: "pl" | "en";
  onChange: (patch: Partial<SearchUrl>) => void;
}

export function ActiveFilterChips({ url, facets, labelCache, lang, onChange }: Props) {
  const { t } = useTranslation();
  const selections = activeSelections(url);
  if (selections.length === 0) return null;

  // Szybkie mapy z bieżących faset (pierwszeństwo przed cache).
  const byId = new Map<string, FacetValue>();
  const bySlug = new Map<string, FacetValue>();
  for (const f of facets) {
    if (f.id) byId.set(f.id, f);
    bySlug.set(`${f.dim}:${f.slug}`, f);
  }

  const labelFor = (sel: ActiveSelection): string => {
    if (sel.dim === "date") return sel.value;
    if (sel.dim === "format" || sel.dim === "lang" || sel.dim === "access") {
      return t(`search.${sel.dim}.${sel.value}`, { defaultValue: sel.value });
    }
    if (sel.dim === "year") return sel.value;
    // Taksonomia / autor: faseta po id → cache → surowa wartość.
    const f = byId.get(sel.value);
    if (f) return facetLabel(f, lang, t);
    return labelCache[sel.value] ?? sel.value;
  };

  const clear = (sel: ActiveSelection) => {
    const patch: Partial<SearchUrl> = {};
    for (const k of sel.keys) patch[k] = undefined as never;
    onChange(patch);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={t("search.active_filters")}>
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {t("search.active_filters")}
      </span>
      {selections.map((sel) => (
        <button
          key={`${sel.dim}:${sel.keys.join(",")}:${sel.value}`}
          type="button"
          onClick={() => clear(sel)}
          className="group inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 pl-3 pr-2 py-1 text-xs text-foreground transition hover:bg-muted"
          aria-label={`${t("search.remove_filter")}: ${t(`search.dim.${sel.dim === "date" ? "year" : sel.dim}`, { defaultValue: "" })} ${labelFor(sel)}`.trim()}
        >
          <span className="text-muted-foreground">
            {sel.dim === "date"
              ? t("search.date")
              : t(`search.dim.${sel.dim}`, { defaultValue: "" })}
            :
          </span>
          <span className="font-medium">{labelFor(sel)}</span>
          <X className="w-3 h-3 text-muted-foreground group-hover:text-foreground" />
        </button>
      ))}
    </div>
  );
}
