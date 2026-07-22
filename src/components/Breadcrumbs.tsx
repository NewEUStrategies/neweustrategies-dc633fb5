import { Link } from "@tanstack/react-router";
import { ChevronRight, Home } from "@/lib/lucide-shim";
import { type BreadcrumbItem } from "@/lib/breadcrumbs";
import { currentLang } from "@/lib/i18n/localeRuntime";
import { homeLabel } from "@/lib/i18n/commonLabels";
import { cn } from "@/lib/utils";

// BreadcrumbList JSON-LD is emitted from the route head() (src/routes/$.tsx),
// where it renders during SSR with absolute, localized URLs.
export function Breadcrumbs({
  items,
  className,
}: {
  items: BreadcrumbItem[];
  className?: string;
}) {
  if (items.length === 0) return null;
  const lang = currentLang();
  const home = homeLabel(lang);
  return (
    <nav aria-label="breadcrumb" className={cn("mb-4", className)}>
      <ol className="flex flex-wrap items-center whitespace-nowrap">
        <li className="inline-flex items-center">
          <Link
            to="/"
            className="flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:text-foreground"
          >
            <Home className="shrink-0 me-2 size-4" aria-hidden="true" />
            {home}
          </Link>
          <ChevronRight
            className="shrink-0 mx-2 size-4 text-muted-foreground/70"
            aria-hidden="true"
          />
        </li>
        {items.map((it, i) => {
          const isLast = i === items.length - 1;
          return (
            <li
              key={i}
              className={cn(
                "inline-flex items-center",
                isLast && "text-sm font-semibold text-foreground truncate",
              )}
              {...(isLast ? { "aria-current": "page" as const } : {})}
            >
              {it.href && !isLast ? (
                <>
                  <Link
                    to={it.href}
                    className="flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:text-foreground"
                  >
                    {it.label}
                  </Link>
                  <ChevronRight
                    className="shrink-0 mx-2 size-4 text-muted-foreground/70"
                    aria-hidden="true"
                  />
                </>
              ) : (
                <span className="truncate">{it.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
