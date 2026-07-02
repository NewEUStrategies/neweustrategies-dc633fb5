import { Link } from "@tanstack/react-router";
import { ChevronRight } from "@/lib/lucide-shim";
import { type BreadcrumbItem } from "@/lib/breadcrumbs";

// BreadcrumbList JSON-LD is emitted from the route head() (src/routes/$.tsx),
// where it renders during SSR with absolute, localized URLs. Emitting it here
// was hydration-only (items arrive via useEffect), so crawlers never saw it.
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="breadcrumb" className="text-sm text-muted-foreground mb-4">
      <ol className="flex flex-wrap items-center gap-1">
        <li>
          <Link to="/" className="hover:text-foreground">
            Start
          </Link>
        </li>
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1">
            <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            {it.href ? (
              <Link to={it.href} className="hover:text-foreground">
                {it.label}
              </Link>
            ) : (
              <span className="text-foreground" aria-current="page">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
