// Chipy odznak profilowych - sygnały zaufania w katalogu osób i na profilach.
// Czysto prezentacyjne; dane dostarcza lib/profile/badges.
import { useTranslation } from "react-i18next";
import { BadgeCheck, Award, PenLine, Shield } from "lucide-react";
import { badgeLabel, type ProfileBadgeKind } from "@/lib/profile/badges";
import { cn } from "@/lib/utils";

const BADGE_ICONS: Record<ProfileBadgeKind, typeof BadgeCheck> = {
  verified: BadgeCheck,
  expert: Award,
  contributor: PenLine,
  staff: Shield,
};

const BADGE_STYLES: Record<ProfileBadgeKind, string> = {
  verified: "bg-primary/10 text-primary",
  expert: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  contributor: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  staff: "bg-muted text-muted-foreground",
};

export function ProfileBadges({
  badges,
  size = "sm",
  className,
}: {
  badges: ProfileBadgeKind[] | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  if (!badges || badges.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {badges.map((badge) => {
        const Icon = BADGE_ICONS[badge];
        return (
          <span
            key={badge}
            className={cn(
              "inline-flex items-center gap-1 rounded-full font-medium",
              size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
              BADGE_STYLES[badge],
            )}
            title={badgeLabel(badge, lang)}
          >
            <Icon aria-hidden="true" className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
            {badgeLabel(badge, lang)}
          </span>
        );
      })}
    </span>
  );
}
