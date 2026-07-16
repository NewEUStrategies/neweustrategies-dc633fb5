// Sort selector + result count bar above the archive grid.
import type { ArchiveSort } from "@/lib/queries/archives";

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
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{sortLabel}:</span>
        <select
          value={sort}
          disabled={disabled}
          onChange={(e) => onSortChange(e.target.value as ArchiveSort)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm disabled:opacity-60"
          aria-label={sortLabel}
        >
          {(["newest", "oldest", "popular"] as ArchiveSort[]).map((s) => (
            <option key={s} value={s}>
              {labels[s]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
