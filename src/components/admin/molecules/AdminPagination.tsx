// Reusable pagination control for admin lists (client-side and server-side).
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "@/lib/lucide-shim";

/**
 * Gorna granica droplisty NUMERU strony. Powyzej niej lista pozycji przestaje
 * byc nawigacja i staje sie tasma do przewijania - w popoverze z czterystoma
 * numerami trafia sie gorzej niz dwiema strzalkami. Limit 100 wypada tam, gdzie
 * konczy sie klawiaturowe „wpisz numer i skacz” Radiksa: przy setce pozycji
 * lista jeszcze reaguje, przy tysiacu montuje sie zauwazalnie dluzej.
 * Ponad limitem zostaje sam odczyt „3 / 412”, a skrotem do dalekiej strony robi
 * sie SASIEDNIA dropka rozmiaru: wieksza strona zbija liczbe stron pod limit.
 */
const MAX_PAGE_OPTIONS = 100;

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
  // Etykiety „Na stronę” i „Strona” sa NAPISAMI, nie elementami <label> -
  // wyzwalacz Radiksa nie jest kontrolka formularza, wiec htmlFor go nie wiaze.
  // Stad wlasne identyfikatory i aria-labelledby, inaczej czytnik oglasza dwie
  // bezimienne listy z golymi liczbami.
  const labelIdBase = useId();
  const perPageLabelId = `${labelIdBase}-per-page`;
  const pageLabelId = `${labelIdBase}-page`;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);
  const smallestPageSize = pageSizeOptions.length ? Math.min(...pageSizeOptions) : pageSize;

  // Lista, ktora miesci sie na jednej stronie, nie dostaje stopki: „1 - 2 z 2”
  // i dwie martwe strzalki to szum, nie informacja. Drugi warunek pilnuje drogi
  // powrotu - gdyby liczyla sie sama liczba stron, uzytkownik po przelaczeniu na
  // 200 na strone tracilby razem ze stopka jedyna kontrolke, ktora wraca na 20.
  // Dlatego stopka znika tylko wtedy, gdy zbior jest za maly na stronicowanie
  // przy KAZDYM oferowanym rozmiarze.
  if (pageCount <= 1 && total <= smallestPageSize) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 px-3 py-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span id={perPageLabelId}>{t("admin.pagination.perPage")}</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger
            aria-labelledby={perPageLabelId}
            className="h-8 w-[72px] text-xs text-foreground"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((n) => (
              <SelectItem key={n} value={String(n)} className="text-xs">
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span id={pageLabelId}>{t("admin.pagination.page")}</span>
        {pageCount <= MAX_PAGE_OPTIONS ? (
          <Select value={String(safePage)} onValueChange={(v) => onPageChange(Number(v))}>
            <SelectTrigger
              aria-labelledby={pageLabelId}
              className="h-8 w-[72px] text-xs text-foreground"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((n) => (
                <SelectItem key={n} value={String(n)} className="text-xs">
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="tabular-nums text-foreground">
            {t("admin.pagination.pageOf", { page: safePage, count: pageCount })}
          </span>
        )}
      </div>

      <span className="tabular-nums">
        {t("admin.pagination.range", {
          start,
          end,
          total,
        })}
      </span>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          aria-label={t("admin.pagination.prev")}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={safePage >= pageCount}
          onClick={() => onPageChange(safePage + 1)}
          aria-label={t("admin.pagination.next")}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
