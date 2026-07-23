// Atom: readable unread counter badge for notification/chat bells.
// - High-contrast primary surface, bold typography, crisp shadow/ring.
// - i18n-ready aria-label; caps at "99+".
// - Sizes tuned for header icon triggers (md) and panel headings (lg).
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
  sm: "h-3 min-w-[14px] px-0.5 text-[5px]",
  md: "h-3.5 min-w-[16px] px-1 text-[6px]",
  lg: "h-4 min-w-[18px] px-1 text-[7px]",
};

const VARIANT_CLASSES: Record<UnreadBadgeVariant, string> = {
  primary: "bg-primary text-primary-foreground ring-2 ring-background shadow-md",
  // Czerwona pigułka w headerze - czytelna w light i dark, biały kontur odcina
  // ją od ikony pod spodem.
  alert:
    "bg-[hsl(0_84%_55%)] text-white ring-2 ring-background shadow-[0_2px_6px_-1px_hsl(0_84%_55%/0.5)]",
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
      className={cn(
        "inline-flex items-center justify-center rounded-[5px] font-bold leading-none whitespace-nowrap",
        "z-[100] overflow-visible",
        "motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-200",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        pulse && "motion-safe:animate-pulse",
        className,
      )}
      aria-label={t(labelKey, { count, defaultValue: `${count} nieprzeczytanych` })}
      aria-live="polite"
    >
      {display}
    </span>
  );
}

