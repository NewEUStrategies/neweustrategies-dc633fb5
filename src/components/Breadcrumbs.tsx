import { Link } from "@tanstack/react-router";
import { ChevronRight, Home } from "@/lib/lucide-shim";
import { type BreadcrumbItem } from "@/lib/breadcrumbs";
import { currentLang } from "@/lib/i18n/localeRuntime";
import { homeLabel } from "@/lib/i18n/commonLabels";
import { cn } from "@/lib/utils";

/**
 * Globalny wygląd breadcrumbs: "outline pill" oparty wyłącznie na tokenach
 * semantycznych (border / bg-card / muted-foreground), więc dark i light mode
 * dziedziczą motyw bez żadnych nadpisań. Klasy współdzieli widget buildera
 * (BreadcrumbsView), aby preview i strona publiczna wyglądały identycznie.
 */
export const CRUMB_PILL_CLASS =
  "inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-[6px] border border-border bg-card/60 px-3 py-1 text-xs leading-5 text-muted-foreground";
export const CRUMB_LINK_CLASS =
  "inline-flex items-center gap-1.5 rounded-[6px] transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export const CRUMB_CURRENT_CLASS = "min-w-0 truncate font-medium text-foreground";
export const CRUMB_SEPARATOR_CLASS = "size-3.5 shrink-0 text-muted-foreground/60";

// BreadcrumbList JSON-LD is emitted from the route head() (src/routes/$.tsx),
// where it renders during SSR with absolute, localized URLs.
export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  if (items.length === 0) return null;
  const lang = currentLang();
  const home = homeLabel(lang);
  return (
    <nav aria-label="breadcrumb" className={cn("mb-4 min-w-0", className)}>
      <ol className={CRUMB_PILL_CLASS}>
        <li className="inline-flex items-center gap-1.5">
          <Link to="/" className={CRUMB_LINK_CLASS} title={home}>
            <Home className="size-4 shrink-0" aria-hidden="true" />
            <span className="sr-only">{home}</span>
          </Link>
        </li>
        {items.map((it, i) => {
          const isLast = i === items.length - 1;
          return (
            <li
              key={i}
              className="inline-flex min-w-0 items-center gap-1.5"
              {...(isLast ? { "aria-current": "page" as const } : {})}
            >
              <ChevronRight className={CRUMB_SEPARATOR_CLASS} aria-hidden="true" />
              {it.href && !isLast ? (
                <Link to={it.href} className={cn(CRUMB_LINK_CLASS, "min-w-0 truncate")}>
                  {it.label}
                </Link>
              ) : (
                <span className={CRUMB_CURRENT_CLASS}>{it.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
