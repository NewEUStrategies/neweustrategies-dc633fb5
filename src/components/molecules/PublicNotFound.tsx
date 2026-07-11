// Unified public 404 surface. Single source of bilingual copy (errorCopy) plus
// a Home link, shared by the dynamic page renderer ($) and the taxonomy/author
// archives so "not found" never diverges in wording or styling across routes.
// Renders a plain container (NOT a <main>) - SiteChrome already provides the
// page's <main id="main-content"> landmark.
import { Link } from "@tanstack/react-router";
import { errorCopy } from "@/lib/errorCopy";

export function PublicNotFound() {
  const copy = errorCopy();
  return (
    <div className="flex flex-1 min-h-[60vh] items-center justify-center px-4 py-20">
      <div className="text-center">
        <h1 className="font-display text-3xl">404 &middot; {copy.notFoundTitle}</h1>
        <p className="text-sm text-muted-foreground mt-2">{copy.notFoundBody}</p>
        <Link
          to="/"
          className="inline-block mt-6 bg-brand text-brand-foreground px-4 py-2 rounded text-sm"
        >
          {copy.goHome}
        </Link>
      </div>
    </div>
  );
}
