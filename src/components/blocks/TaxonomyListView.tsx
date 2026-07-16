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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";


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
    const placeholder = lang === "en" ? "Choose…" : "Wybierz…";
    return (
      <Select
        onValueChange={(v) => {
          if (v && typeof window !== "undefined") window.location.href = v;
        }}
      >
        <SelectTrigger className="not-prose h-10 text-sm w-full max-w-sm" aria-label={placeholder}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {items.map((it) => (
            <SelectItem key={it.href} value={it.href} className="text-sm">
              {it.label}
              {showCount && it.count ? ` (${it.count})` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
