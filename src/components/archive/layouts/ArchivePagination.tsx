// Numeric pagination bar with ellipsis and prev/next controls.
import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "@/lib/lucide-shim";

function buildRange(page: number, totalPages: number): Array<number | "ellipsis"> {
  const out: Array<number | "ellipsis"> = [];
  const push = (v: number | "ellipsis") => out.push(v);
  const window = 1;
  const first = 1;
  const last = totalPages;
  const start = Math.max(first + 1, page - window);
  const end = Math.min(last - 1, page + window);
  push(first);
  if (start > first + 1) push("ellipsis");
  for (let i = start; i <= end; i++) push(i);
  if (end < last - 1) push("ellipsis");
  if (last > first) push(last);
  return out;
}

export function ArchivePagination({
  page,
  totalPages,
  onPageChange,
  isPending,
  lang,
  disabled,
  t,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  isPending: boolean;
  lang: "pl" | "en";
  disabled?: boolean;
  t: TFunction;
}) {
  const items = buildRange(page, totalPages);
  const prevLabel = t("archive.prev", {
    defaultValue: lang === "en" ? "Previous page" : "Poprzednia strona",
  });
  const nextLabel = t("archive.next", {
    defaultValue: lang === "en" ? "Next page" : "Następna strona",
  });
  const pageLabel = t("archive.pageLabel", {
    defaultValue: lang === "en" ? "Page" : "Strona",
  });
  const busy = isPending || disabled;
  return (
    <nav
      aria-label={lang === "en" ? "Pagination" : "Paginacja"}
      className="flex flex-wrap items-center justify-center gap-1"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy || page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label={prevLabel}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {items.map((it, i) =>
        it === "ellipsis" ? (
          <span
            key={`e-${i}`}
            className="px-2 text-muted-foreground select-none"
            aria-hidden
          >
            …
          </span>
        ) : (
          <Button
            key={it}
            type="button"
            size="sm"
            variant={it === page ? "default" : "outline"}
            disabled={busy}
            onClick={() => onPageChange(it)}
            aria-current={it === page ? "page" : undefined}
            aria-label={`${pageLabel} ${it}`}
            className="min-w-9"
          >
            {it}
          </Button>
        ),
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label={nextLabel}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </nav>
  );
}
