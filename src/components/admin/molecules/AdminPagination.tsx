// Reusable pagination control for admin lists (client-side slicing).
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "@/lib/lucide-shim";

export interface AdminPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
}

export function AdminPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [20, 50, 100, 200],
}: AdminPaginationProps) {
  const { t } = useTranslation();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-border bg-muted/20 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>
          {t("admin.pagination.range", {
            defaultValue: "{{start}}-{{end}} z {{total}}",
            start, end, total,
          })}
        </span>
        <span className="hidden sm:inline">·</span>
        <div className="flex items-center gap-1.5">
          <span className="hidden sm:inline">{t("admin.pagination.perPage", { defaultValue: "Na stronę" })}:</span>
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger className="h-7 w-[72px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((n) => (
                <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={safePage <= 1}
          onClick={() => onPageChange(1)} aria-label={t("admin.pagination.first", { defaultValue: "Pierwsza" })}>
          <ChevronsLeft className="w-3.5 h-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)} aria-label={t("admin.pagination.prev", { defaultValue: "Poprzednia" })}>
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <span className="px-2 tabular-nums">
          {t("admin.pagination.pageOf", { defaultValue: "{{page}} / {{count}}", page: safePage, count: pageCount })}
        </span>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={safePage >= pageCount}
          onClick={() => onPageChange(safePage + 1)} aria-label={t("admin.pagination.next", { defaultValue: "Następna" })}>
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={safePage >= pageCount}
          onClick={() => onPageChange(pageCount)} aria-label={t("admin.pagination.last", { defaultValue: "Ostatnia" })}>
          <ChevronsRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
