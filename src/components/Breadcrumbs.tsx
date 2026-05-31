import { Link } from "@tanstack/react-router";
import { ChevronRight } from "@/lib/lucide-shim";
import { breadcrumbJsonLd, type BreadcrumbItem } from "@/lib/breadcrumbs";

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <nav aria-label="breadcrumb" className="text-sm text-muted-foreground mb-4">
      <ol className="flex flex-wrap items-center gap-1">
        <li>
          <Link to="/" className="hover:text-foreground">Start</Link>
        </li>
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1">
            <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            {it.href ? (
              <Link to={it.href} className="hover:text-foreground">{it.label}</Link>
            ) : (
              <span className="text-foreground" aria-current="page">{it.label}</span>
            )}
          </li>
        ))}
      </ol>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd(items, origin) }} />
    </nav>
  );
}
