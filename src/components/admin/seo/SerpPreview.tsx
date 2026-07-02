// Molecule: live Google-result preview. Renders exactly what the public
// head() will emit (same resolution chain + pixel truncation), so editors see
// the real snippet, not an approximation of the form state.
import { Globe } from "@/lib/lucide-shim";
import { truncateToPx, SERP_DESCRIPTION_LIMIT_PX, SERP_TITLE_LIMIT_PX } from "@/lib/seo/serp";
import { SITE_NAME } from "@/lib/seo/meta";

interface SerpPreviewProps {
  /** Final, resolved document title (with suffix when applicable). */
  title: string;
  /** Final, resolved description. */
  description: string;
  /** Host shown in the URL line (falls back to the current origin). */
  host?: string;
  /** Path segments after the host ("blog/moj-wpis"). */
  path: string;
  noindex?: boolean;
}

export function SerpPreview({ title, description, host, path, noindex }: SerpPreviewProps) {
  const displayHost =
    host ?? (typeof window !== "undefined" ? window.location.host : "example.com");
  const crumbs = path.split("/").filter(Boolean);
  return (
    <div className="rounded-lg border border-border bg-background p-4 relative overflow-hidden">
      {noindex && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background/85 backdrop-blur-[1px]">
          <span className="text-xs font-medium text-destructive border border-destructive/40 rounded-full px-3 py-1">
            noindex
          </span>
        </div>
      )}
      <div className="font-[Arial,sans-serif]">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-7 h-7 rounded-full bg-muted border border-border">
            <Globe className="w-3.5 h-3.5 text-muted-foreground" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] leading-4 text-foreground">{SITE_NAME}</span>
            <span className="block text-xs leading-4 text-muted-foreground truncate">
              {displayHost}
              {crumbs.map((c) => ` › ${c}`).join("")}
            </span>
          </span>
        </div>
        <p className="mt-1.5 text-xl leading-6 text-[#1a0dab] dark:text-[#8ab4f8] truncate">
          {truncateToPx(title, 20, SERP_TITLE_LIMIT_PX)}
        </p>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {truncateToPx(description, 14, SERP_DESCRIPTION_LIMIT_PX)}
        </p>
      </div>
    </div>
  );
}
