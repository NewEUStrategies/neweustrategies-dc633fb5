// Badge „Preferowane źródło w Google" - kieruje do panelu Google Preferred
// Sources. Renderowany obok „Udostępnij pełny artykuł".
// Włącznik, adresy PL/EN, logo (jasne/ciemne) oraz zachowanie na desktopie i
// mobile pochodzą z Admin → Ustawienia → Preferowane źródło Google.
// Docs: https://blog.google/products-and-platforms/products/search/preferred-sources/
import { useTranslation } from "react-i18next";
import googleG from "@/assets/google-g.png.asset.json";
import { SITE_NAME } from "@/lib/seo/meta";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";
import {
  alignClass,
  clampLogoSize,
  isBadgeVisible,
  placementStyle,
  resolveBadgeHref,
  resolveBadgeLogo,
  useGoogleSourceBadgeConfig,
  type GoogleSourceBadgeConfig,
  type GoogleSourceBadgeDevice,
} from "@/lib/seo/googleSourceBadge";
import { trackGoogleSourceBadgeClick } from "@/lib/seo/googleSourceBadgeAnalytics";
import "@/lib/i18n-googleSource";

export {
  GOOGLE_PREFERRED_SOURCE_DOMAIN,
  googlePreferredSourceUrl,
} from "@/lib/seo/googleSourceBadge";

export interface GooglePreferredSourceBadgeProps {
  /** Breakpoint, dla którego czytamy ustawienia wariantu i marginesów. */
  device?: GoogleSourceBadgeDevice;
  /** Podgląd w adminie - niezapisany szkic konfiguracji. */
  configOverride?: GoogleSourceBadgeConfig;
  /** Wymuszenie motywu logotypu (podgląd w adminie). */
  themeOverride?: "light" | "dark";
  /** Kontekst analityczny (np. id wpisu). */
  entityId?: string | null;
  className?: string;
}

export function GooglePreferredSourceBadge({
  device = "desktop",
  configOverride,
  themeOverride,
  entityId,
  className,
}: GooglePreferredSourceBadgeProps) {
  const { t, i18n } = useTranslation();
  const stored = useGoogleSourceBadgeConfig();
  const { theme } = useTheme();
  const config = configOverride ?? stored;

  if (!isBadgeVisible(config, device)) return null;

  const placement = config[device];
  const lang = i18n.language || "pl";
  const href = resolveBadgeHref(config, lang);
  const label = t("googleSource.badgeLabel", { site: SITE_NAME });
  const logoSize = clampLogoSize(config.logo.size);
  const customLogo = resolveBadgeLogo(config.logo, themeOverride ?? theme);
  const iconOnly = placement.variant === "icon";
  const compact = placement.variant === "compact";

  return (
    <span
      className={cn(
        "no-print inline-flex w-full self-stretch items-stretch",
        alignClass(placement.align),
        className,
      )}
      style={placementStyle(placement)}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        data-google-preferred-source
        data-device={device}
        data-variant={placement.variant}
        aria-label={label}
        title={label}
        onClick={() =>
          trackGoogleSourceBadgeClick({
            href,
            device,
            variant: placement.variant,
            lang,
            entityId: entityId ?? null,
          })
        }
        className={cn(
          "inline-flex items-center gap-2 rounded-[5px]",
          // Dwuwierszowe zdanie potrzebuje oddechu w pionie - stała wysokość
          // tylko dla wariantów jednoliniowych, poza tym min-h + padding.
          iconOnly ? "h-8 w-8 justify-center px-0" : "min-h-8 self-stretch px-3 py-1.5",
          compact && "h-8 py-0",
          "border border-border bg-background text-foreground",
          "tracking-[-0.01em] whitespace-nowrap",
          "hover:bg-muted hover:text-brand transition-colors active:scale-[0.98]",
        )}
      >
        <img
          src={customLogo ?? googleG.url}
          alt=""
          aria-hidden
          width={logoSize}
          height={logoSize}
          loading="lazy"
          decoding="async"
          style={{ width: logoSize, height: logoSize }}
          className="shrink-0 object-contain"
        />
        {!iconOnly && (
          <span className="flex min-w-0 flex-col text-[11.5px] leading-[1.25]">
            {/* Wariant kompaktowy mieści całe zdanie w jednej linii. */}
            <span className="whitespace-nowrap font-medium text-muted-foreground">
              {compact
                ? `${t("googleSource.badgeTitle")} ${t("googleSource.badgeSub")}`
                : t("googleSource.badgeTitle")}
            </span>
            {!compact && (
              <span className="whitespace-nowrap font-semibold text-foreground">
                {t("googleSource.badgeSub")}
              </span>
            )}
          </span>
        )}
      </a>
    </span>
  );
}
