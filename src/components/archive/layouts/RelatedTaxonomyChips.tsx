// Chipy „Powiązane kategorie / tagi" - wspólny render sekcji pod listą
// archiwum i widżetu sidebara (wcześniej dwie kopie tego samego znacznika).
import { Link } from "@tanstack/react-router";
import type { RelatedTaxonomy } from "@/lib/queries/relatedTaxonomies";
import type { TaxonomyKind } from "@/lib/queries/taxonomyPivot";

export function RelatedTaxonomyChips({
  items,
  kind,
  lang,
  previewMode,
}: {
  items: readonly RelatedTaxonomy[];
  kind: TaxonomyKind;
  lang: "pl" | "en";
  previewMode: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) =>
        // Podgląd admina: atrapy nie prowadzą donikąd, więc nie są linkami.
        previewMode ? (
          <span
            key={it.id}
            className="px-3 py-1 rounded-full border border-border text-xs bg-card/60"
          >
            {lang === "en" ? it.name_en || it.name_pl : it.name_pl || it.name_en}
          </span>
        ) : (
          <Link
            key={it.id}
            to={kind === "category" ? "/category/$slug" : "/tag/$slug"}
            params={{ slug: it.slug }}
            className="px-3 py-1 rounded-full border border-border text-xs hover:bg-muted transition"
          >
            {lang === "en" ? it.name_en || it.name_pl : it.name_pl || it.name_en}
          </Link>
        ),
      )}
    </div>
  );
}
