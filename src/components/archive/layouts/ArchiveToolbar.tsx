// Sort selector + result count bar above the archive grid.
import type { ArchiveSort } from "@/lib/queries/archives";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SORT_LABEL_PL: Record<ArchiveSort, string> = {
  newest: "Najnowsze",
  oldest: "Najstarsze",
  popular: "Najpopularniejsze",
};
const SORT_LABEL_EN: Record<ArchiveSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  popular: "Most popular",
};

export function ArchiveToolbar({
  lang,
  total,
  page,
  pageSize,
  sort,
  onSortChange,
  isPending,
  disabled,
}: {
  lang: "pl" | "en";
  total: number;
  page: number;
  pageSize: number;
  sort: ArchiveSort;
  onSortChange: (s: ArchiveSort) => void;
  isPending: boolean;
  disabled?: boolean;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const labels = lang === "en" ? SORT_LABEL_EN : SORT_LABEL_PL;
  const countText =
    total === 0
      ? lang === "en"
        ? "No results"
        : "Brak wyników"
      : lang === "en"
        ? `Showing ${from}–${to} of ${total}`
        : `Pokazuję ${from}–${to} z ${total}`;
  const sortLabel = lang === "en" ? "Sort" : "Sortuj";
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="text-sm text-muted-foreground" aria-live="polite">
        {isPending ? (lang === "en" ? "Loading..." : "Ładowanie...") : countText}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground" id="archive-sort-label">
          {sortLabel}:
        </span>
        <Select
          value={sort}
          onValueChange={(v) => onSortChange(v as ArchiveSort)}
          disabled={disabled}
        >
          <SelectTrigger
            aria-labelledby="archive-sort-label"
            aria-label={sortLabel}
            className="h-9 w-48 text-sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["newest", "oldest", "popular"] as ArchiveSort[]).map((s) => (
              <SelectItem key={s} value={s} className="text-sm">
                {labels[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
