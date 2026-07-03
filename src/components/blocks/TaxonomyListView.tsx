// Publiczny renderer: lista taksonomii (kategorie/tagi/archiwa miesięczne).
// Dane przez react-query (blocks.ts) - prefetch SSR w loaderze $.tsx sprawia,
// że crawler widzi pełną listę, nie szkielet.

import { useQuery } from "@tanstack/react-query";
import {
  blockArchivesQueryOptions,
  blockCategoriesQueryOptions,
  blockTagsQueryOptions,
  type TaxonomyItem,
} from "@/lib/queries/blocks";
import { AppLink } from "@/components/atoms/AppLink";

type Kind = "categories" | "tags" | "archives";

interface Props {
  kind: Kind;
  lang: "pl" | "en";
  showCount: boolean;
  layout: "list" | "dropdown";
  /** Tag cloud: maksymalna liczba pozycji. */
  limit?: number;
}

function useTaxonomyItems(kind: Kind, lang: "pl" | "en", limit?: number) {
  const categories = useQuery({
    ...blockCategoriesQueryOptions(lang),
    enabled: kind === "categories",
  });
  const archives = useQuery({
    ...blockArchivesQueryOptions(lang),
    enabled: kind === "archives",
  });
  const tags = useQuery({
    ...blockTagsQueryOptions(limit ?? 200),
    enabled: kind === "tags",
  });
  if (kind === "categories") return categories;
  if (kind === "archives") return archives;
  return {
    ...tags,
    data: tags.data?.map(
      (t): TaxonomyItem => ({ label: t.name, href: `/tag/${t.slug}`, count: 0 }),
    ),
  };
}

export function TaxonomyListView({ kind, lang, showCount, layout, limit }: Props) {
  const { data, isPending } = useTaxonomyItems(kind, lang, limit);
  const items: TaxonomyItem[] = data ?? [];

  if (isPending) return <div className="text-sm text-muted-foreground py-2">…</div>;
  if (items.length === 0) return null;

  if (layout === "dropdown") {
    return (
      <select
        className="not-prose bg-background border border-border rounded px-3 py-2 text-sm"
        onChange={(e) => {
          if (e.target.value && typeof window !== "undefined")
            window.location.href = e.target.value;
        }}
        defaultValue=""
      >
        <option value="" disabled>
          {lang === "en" ? "Choose…" : "Wybierz…"}
        </option>
        {items.map((it) => (
          <option key={it.href} value={it.href}>
            {it.label}
            {showCount && it.count ? ` (${it.count})` : ""}
          </option>
        ))}
      </select>
    );
  }

  return (
    <ul className="not-prose m-0 p-0 list-none space-y-1">
      {items.map((it) => (
        <li key={it.href} className="flex items-center justify-between gap-2">
          <AppLink href={it.href} className="text-foreground hover:text-primary text-sm">
            {it.label}
          </AppLink>
          {showCount && it.count > 0 && (
            <span className="text-xs text-muted-foreground">({it.count})</span>
          )}
        </li>
      ))}
    </ul>
  );
}
