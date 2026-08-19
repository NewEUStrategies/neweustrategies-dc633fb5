// Numeric pagination bar with ellipsis and prev/next controls.
//
// SEO: when `hrefFor` is provided, every enabled item renders as a REAL
// <a href> (crawlers only follow anchors - onClick buttons hide paginated
// archives from indexing). A plain left-click is intercepted and routed
// through `onPageChange` (SPA navigation with transitions); modified clicks
// (new tab, copy link) keep the native browser behavior. Without `hrefFor`
// (admin live preview) items stay plain buttons, exactly as before.
import { Fragment, type MouseEvent, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "@/lib/lucide-shim";

/**
 * Numery stron do pokazania: pierwsza, okno wokół bieżącej, ostatnia, a między
 * nimi wielokropki. Eksport jest po to, żeby GRANICE (jedna strona, dwie, skok
 * z początku na koniec) dało się sprawdzić bez renderowania paska - to one
 * decydują, czy crawler dostanie komplet linków do stron wyników.
 */
export function buildRange(page: number, totalPages: number): Array<number | "ellipsis"> {
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
  hrefFor,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  isPending: boolean;
  lang: "pl" | "en";
  disabled?: boolean;
  t: TFunction;
  /** Kanoniczny URL strony wyników (z prefiksem języka). Obecność włącza
   *  linkowy wariant elementów - podstawa indeksowalnej paginacji. */
  hrefFor?: (page: number) => string;
}) {
  const items = buildRange(page, totalPages);
  const prevLabel = t("archive.prev");
  const nextLabel = t("archive.next");
  const pageLabel = t("archive.pageLabel");
  const busy = isPending || disabled;

  const interceptClick = (event: MouseEvent<HTMLAnchorElement>, target: number) => {
    // Zachowaj natywne zachowania przeglądarki: środkowy przycisk, nowa karta
    // (Ctrl/Cmd), nowe okno (Shift) i menu kontekstowe idą po href.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    if (!busy) onPageChange(target);
  };

  const renderItem = (opts: {
    target: number;
    label: string;
    children: ReactNode;
    current?: boolean;
    unavailable?: boolean;
    rel?: string;
    className?: string;
  }) => {
    const variant = opts.current ? "default" : "outline";
    // Strona bieżąca i krańce zakresu nie są linkami (nie ma dokąd prowadzić);
    // <button disabled> niesie poprawną semantykę, której <a> nie ma.
    if (!hrefFor || opts.unavailable || opts.current) {
      return (
        <Button
          type="button"
          size="sm"
          variant={variant}
          disabled={busy || opts.unavailable}
          onClick={() => onPageChange(opts.target)}
          aria-current={opts.current ? "page" : undefined}
          aria-label={opts.label}
          className={opts.className}
        >
          {opts.children}
        </Button>
      );
    }
    return (
      <Button asChild size="sm" variant={variant}>
        <a
          href={hrefFor(opts.target)}
          rel={opts.rel}
          aria-label={opts.label}
          aria-disabled={busy || undefined}
          onClick={(event) => interceptClick(event, opts.target)}
          className={cn(opts.className, busy && "pointer-events-none opacity-50")}
        >
          {opts.children}
        </a>
      </Button>
    );
  };

  return (
    <nav
      aria-label={lang === "en" ? "Pagination" : "Paginacja"}
      className="flex flex-wrap items-center justify-center gap-1"
    >
      {renderItem({
        target: page - 1,
        label: prevLabel,
        unavailable: page <= 1,
        rel: "prev",
        children: <ChevronLeft className="h-4 w-4" />,
      })}
      {items.map((it, i) =>
        it === "ellipsis" ? (
          <span key={`e-${i}`} className="px-2 text-muted-foreground select-none" aria-hidden>
            …
          </span>
        ) : (
          <Fragment key={it}>
            {renderItem({
              target: it,
              label: `${pageLabel} ${it}`,
              current: it === page,
              className: "min-w-9",
              children: it,
            })}
          </Fragment>
        ),
      )}
      {renderItem({
        target: page + 1,
        label: nextLabel,
        unavailable: page >= totalPages,
        rel: "next",
        children: <ChevronRight className="h-4 w-4" />,
      })}
    </nav>
  );
}
