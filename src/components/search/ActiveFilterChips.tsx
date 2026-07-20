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
    if (sel.dim === "match") return t(`search.adv.match.${sel.value}`, { defaultValue: sel.value });
    if (sel.dim === "scope") return t(`search.adv.scope.${sel.value}`, { defaultValue: sel.value });
    if (sel.dim === "format" || sel.dim === "lang" || sel.dim === "access") {
      return t(`search.${sel.dim}.${sel.value}`, { defaultValue: sel.value });
    }
    if (sel.dim === "year") return sel.value;
    // Taksonomia / autor: faseta po id → cache → surowa wartość.
    const f = byId.get(sel.value);
    if (f) return facetLabel(f, lang, t);
    return labelCache[sel.value] ?? sel.value;
  };

  const prefixFor = (sel: ActiveSelection): string => {
    if (sel.dim === "date") return t("search.date");
    if (sel.dim === "match") return t("search.adv.chip_match");
    if (sel.dim === "scope") return t("search.adv.chip_scope");
    return t(`search.dim.${sel.dim}`, { defaultValue: "" });
  };

  // Multi-select: łatka chipa zdejmuje pojedynczą wartość wymiaru (nie cały
  // wymiar) - activeSelections buduje ją per wartość.
  const clear = (sel: ActiveSelection) => onChange(sel.patch);

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
          aria-label={`${t("search.remove_filter")}: ${prefixFor(sel)} ${labelFor(sel)}`.trim()}
        >
          <span className="text-muted-foreground">{prefixFor(sel)}:</span>
          <span className="font-medium">{labelFor(sel)}</span>
          <X className="w-3 h-3 text-muted-foreground group-hover:text-foreground" />
        </button>
      ))}
    </div>
  );
}
