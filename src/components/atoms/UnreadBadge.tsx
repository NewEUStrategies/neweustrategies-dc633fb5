// Atom: compact unread counter for notification and chat surfaces.
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type UnreadBadgeSize = "sm" | "md" | "lg";
export type UnreadBadgeVariant = "primary" | "alert";

interface UnreadBadgeProps {
  count: number;
  size?: UnreadBadgeSize;
  /** primary = neutralne (panele), alert = czerwona pigułka dla headera. */
  variant?: UnreadBadgeVariant;
  pulse?: boolean;
  className?: string;
  /** Optional override for the aria label; defaults to i18n "notifications.unread" / "chat.unread". */
  labelKey?: string;
  labelNamespace?: string;
}

const SIZE_CLASSES: Record<UnreadBadgeSize, string> = {
  sm: "h-[13px] min-w-[13px] px-[3px]",
  md: "h-[15px] min-w-[15px] px-[3px]",
  lg: "h-[17px] min-w-[17px] px-1",
};

const SIZE_FONT_PX: Record<UnreadBadgeSize, number> = {
  sm: 6,
  md: 6,
  lg: 7,
};

const VARIANT_CLASSES: Record<UnreadBadgeVariant, string> = {
  primary: "bg-primary text-primary-foreground ring-1 ring-background shadow-sm",
  alert: "bg-destructive text-destructive-foreground ring-1 ring-background shadow-sm",
};

export function UnreadBadge({
  count,
  size = "md",
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
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[5px] font-display font-bold leading-none tabular-nums whitespace-nowrap",
        "isolate z-[100] overflow-visible pointer-events-none select-none",
        "motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-200",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        pulse && "motion-safe:animate-pulse",
        className,
      )}
      style={{ ["--unread-badge-fs" as string]: `${SIZE_FONT_PX[size]}px` } as React.CSSProperties}
      aria-label={t(labelKey, { count, defaultValue: `${count} nieprzeczytanych` })}
      aria-live="polite"
    >
      {display}
    </span>
  );
}

