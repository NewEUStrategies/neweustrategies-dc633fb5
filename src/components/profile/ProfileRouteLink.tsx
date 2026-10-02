// Odnośnik do osoby według pary (trasa, slug) z bazy - albo zwykły element,
// gdy baza nie dała trasy (patrz src/lib/profile/profileLink.ts).
//
// Dwie jawne gałęzie zamiast sklejonego adresu: drzewo tras typuje `to`
// i `params`, więc literówka w ścieżce nie przejdzie `tsc` (tak do
// `/profile/<slug>` trafił martwy link w moderacji klubów).
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import type { ProfileLink } from "@/lib/profile/profileLink";

export interface ProfileRouteLinkProps {
  link: ProfileLink | null;
  /** Klasy wspólne dla odnośnika i elementu zastępczego. */
  className?: string;
  /** Klasy wyłącznie dla odnośnika (np. `hover:underline`). */
  linkClassName?: string;
  /** Element, gdy linku nie ma. */
  fallback?: "span" | "div";
  children: ReactNode;
}

export function ProfileRouteLink({
  link,
  className,
  linkClassName,
  fallback = "span",
  children,
}: ProfileRouteLinkProps) {
  if (link?.route === "author") {
    return (
      <Link
        to="/author/$slug"
        params={{ slug: link.slug }}
        className={cn(className, linkClassName)}
      >
        {children}
      </Link>
    );
  }
  if (link?.route === "people") {
    return (
      <Link
        to="/people/$slug"
        params={{ slug: link.slug }}
        className={cn(className, linkClassName)}
      >
        {children}
      </Link>
    );
  }
  const Fallback = fallback;
  return <Fallback className={className}>{children}</Fallback>;
}
