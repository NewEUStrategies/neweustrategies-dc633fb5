// Badge „Preferowane źródło w Google" - kieruje do panelu Google Preferred
// Sources dla naszej domeny. Renderowany obok „Udostępnij pełny artykuł".
// Docs: https://blog.google/products-and-platforms/products/search/preferred-sources/
import { useTranslation } from "react-i18next";
import googleG from "@/assets/google-g.png.asset.json";
import { SITE_NAME } from "@/lib/seo/meta";
import { cn } from "@/lib/utils";
import "@/lib/i18n-googleSource";

/** Domena serwisu użyta jako parametr `q` panelu preferowanych źródeł. */
export const GOOGLE_PREFERRED_SOURCE_DOMAIN = "neweuropeanstrategies.com";

export const googlePreferredSourceUrl = (domain = GOOGLE_PREFERRED_SOURCE_DOMAIN) =>
  `https://google.com/preferences/source?q=${encodeURIComponent(domain)}`;

export interface GooglePreferredSourceBadgeProps {
  /** Nadpisanie domeny (np. inny tenant / środowisko testowe). */
  domain?: string;
  /** `compact` = sam sygnet + krótki tekst (mobile / paski akcji). */
  variant?: "default" | "compact";
  className?: string;
}

export function GooglePreferredSourceBadge({
  domain,
  variant = "default",
  className,
}: GooglePreferredSourceBadgeProps) {
  const { t } = useTranslation();
  const label = t("googleSource.badgeLabel", { site: SITE_NAME });
  const compact = variant === "compact";

  return (
    <a
      href={googlePreferredSourceUrl(domain)}
      target="_blank"
      rel="noopener noreferrer"
      data-google-preferred-source
      aria-label={label}
      title={label}
      className={cn(
        "no-print inline-flex items-center gap-2 h-8 px-3 rounded-[5px]",
        "border border-border bg-background text-foreground",
        "text-[12px] font-semibold tracking-tight whitespace-nowrap",
        "hover:bg-muted hover:text-brand transition-colors active:scale-[0.98]",
        className,
      )}
    >
      <img
        src={googleG.url}
        alt=""
        aria-hidden
        width={14}
        height={14}
        loading="lazy"
        decoding="async"
        className="size-[14px] shrink-0 object-contain"
      />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="truncate">{t("googleSource.badgeTitle")}</span>
        {!compact && (
          <span className="mt-0.5 truncate text-[10px] font-medium text-muted-foreground">
            {t("googleSource.badgeSub")}
          </span>
        )}
      </span>
    </a>
  );
}
