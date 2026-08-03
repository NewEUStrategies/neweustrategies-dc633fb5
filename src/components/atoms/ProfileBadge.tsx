import { Award, BadgeCheck, PenLine, Shield, type LucideIcon } from "lucide-react";
import { badgeLabel, type ProfileBadgeKind } from "@/lib/profile/badgeCatalog";
import { cn } from "@/lib/utils";

const BADGE_ICONS: Readonly<Record<ProfileBadgeKind, LucideIcon>> = {
  verified: BadgeCheck,
  expert: Award,
  staff: Shield,
  contributor: PenLine,
};

const BADGE_STYLES: Readonly<Record<ProfileBadgeKind, string>> = {
  verified: "bg-primary/10 text-primary ring-primary/15",
  expert: "bg-amber-500/15 text-amber-700 ring-amber-500/20 dark:text-amber-400",
  staff: "bg-muted text-muted-foreground ring-border",
  contributor: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
};

export interface ProfileBadgeProps {
  badge: ProfileBadgeKind;
  language: string;
  size?: "sm" | "md";
  className?: string;
}

export function ProfileBadge({ badge, language, size = "sm", className }: ProfileBadgeProps) {
  const Icon = BADGE_ICONS[badge];
  const label = badgeLabel(badge, language);

  return (
    <span
      role="listitem"
      className={cn(
        "inline-flex items-center gap-1 rounded-[6px] font-medium ring-1 ring-inset",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        BADGE_STYLES[badge],
        className,
      )}
      title={label}
    >
      <Icon aria-hidden="true" className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      <span>{label}</span>
    </span>
  );
}
