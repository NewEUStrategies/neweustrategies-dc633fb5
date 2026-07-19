// Atom: readable unread counter badge for notification/chat bells.
// - High-contrast primary surface, bold typography, crisp shadow/ring.
// - i18n-ready aria-label; caps at "99+".
// - Sizes tuned for header icon triggers (md) and panel headings (lg).
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type UnreadBadgeSize = "sm" | "md" | "lg";

interface UnreadBadgeProps {
  count: number;
  size?: UnreadBadgeSize;
  pulse?: boolean;
  className?: string;
  /** Optional override for the aria label; defaults to i18n "notifications.unread" / "chat.unread". */
  labelKey?: string;
  labelNamespace?: string;
}

const SIZE_CLASSES: Record<UnreadBadgeSize, string> = {
  sm: "h-4 min-w-[16px] px-1 text-[9px]",
  md: "h-[18px] min-w-[18px] px-1 text-[10px]",
  lg: "h-5 min-w-[20px] px-1.5 text-[11px]",
};

export function UnreadBadge({
  count,
  size = "md",
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
        "absolute -top-0.5 -right-0.5 inline-flex items-center justify-center rounded-full",
        "bg-primary text-primary-foreground font-bold leading-none",
        "ring-2 ring-background shadow-md",
        "motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-200",
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
