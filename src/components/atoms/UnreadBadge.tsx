// Atom: compact unread counter for notification and chat surfaces.
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type UnreadBadgeSize = "sm" | "md" | "lg";
export type UnreadBadgeVariant = "primary" | "alert";

/**
 * Klucze etykiety dostępności, jakie ta odznaka umie wyrenderować - JAWNA UNIA,
 * nie `string`.
 *
 * PO CO UNIA ZAMIAST `string`. Dopóki prop był `string`, klucz docierał tu jako
 * wartość runtime'owa, więc bramka rozjazdu kod<->słownik nie miała czego
 * sprawdzić i wywołanie nosiło polski `defaultValue` „na wszelki wypadek" -
 * czyli angielski czytnik ekranu dostawał polskie zdanie, gdyby klucz zniknął.
 * Unia zamienia to na błąd kompilacji: każdy z tych kluczy MUSI istnieć w obu
 * słownikach (w formach mnogich), a literały z tej listy widzi już skaner
 * `scanKeyReferences`. Nowa powierzchnia dopisuje tu swój klucz i tym samym
 * deklaruje go do tłumaczenia.
 */
export type UnreadBadgeLabelKey =
  | "notifications.unread"
  | "chat.unread"
  | "mobileBottomBar.unreadNotifications"
  | "mobileBottomBar.unreadClubs"
  | "mobileBottomBar.unreadChat"
  | "mobileBottomBar.unreadNetwork";

interface UnreadBadgeProps {
  count: number;
  size?: UnreadBadgeSize;
  /** Precyzyjny rozmiar cyfr dla szczególnie kompaktowych powierzchni. */
  fontSizePx?: number;
  /** primary = neutralne (panele), alert = czerwona pigułka dla headera. */
  variant?: UnreadBadgeVariant;
  pulse?: boolean;
  className?: string;
  /** Klucz etykiety dostępności - musi istnieć w PL i EN (formy mnogie). */
  labelKey?: UnreadBadgeLabelKey;
  labelNamespace?: string;
}

const SIZE_CLASSES: Record<UnreadBadgeSize, string> = {
  sm: "h-[15px] min-w-[15px] px-[4px]",
  md: "h-[17px] min-w-[17px] px-[4px]",
  lg: "h-[19px] min-w-[19px] px-[5px]",
};

const SIZE_FONT_PX: Record<UnreadBadgeSize, number> = {
  sm: 6,
  md: 7,
  lg: 8,
};

const VARIANT_CLASSES: Record<UnreadBadgeVariant, string> = {
  primary: "bg-primary text-primary-foreground ring-1 ring-background shadow-sm",
  alert: "bg-destructive text-destructive-foreground ring-1 ring-background shadow-sm",
};

export function UnreadBadge({
  count,
  size = "md",
  fontSizePx,
  variant = "primary",
  pulse = false,
  className,
  labelKey = "notifications.unread",
  labelNamespace = "translation",
}: UnreadBadgeProps) {
  const { t } = useTranslation(labelNamespace);
  if (count <= 0) return null;

  const display = count > 99 ? "99+" : String(count);

  return (
    <span
      data-unread-badge=""
      data-typography-exempt=""
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[5px] font-display font-bold leading-none tabular-nums whitespace-nowrap",
        "isolate z-[100] overflow-visible pointer-events-none select-none",
        "motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-200",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        pulse && "motion-safe:animate-pulse",
        className,
      )}
      style={
        {
          ["--unread-badge-fs" as string]: `${fontSizePx ?? SIZE_FONT_PX[size]}px`,
        } as CSSProperties
      }
      aria-label={t(labelKey, { count })}
      aria-live="polite"
    >
      {display}
    </span>
  );
}
