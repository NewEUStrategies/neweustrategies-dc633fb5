// Chip poziomu reputacji - atom prezentacyjny (tablica kontrybutorów, profil).
// Progi i nazwy poziomów: lib/community/reputation (jedno źródło prawdy).
import { useTranslation } from "react-i18next";
import { Award, Landmark, Megaphone, Sprout, Users } from "lucide-react";
import { levelForPoints, levelName, type ReputationLevelKey } from "@/lib/community/reputation";
import { cn } from "@/lib/utils";

const LEVEL_ICONS: Record<ReputationLevelKey, typeof Sprout> = {
  observer: Sprout,
  participant: Users,
  voice: Megaphone,
  expert: Award,
  pillar: Landmark,
};

const LEVEL_STYLES: Record<ReputationLevelKey, string> = {
  observer: "bg-muted text-muted-foreground",
  participant: "bg-primary/10 text-primary",
  voice: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  expert: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  pillar: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

export function ReputationLevelChip({
  points,
  size = "sm",
  className,
}: {
  points: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const { i18n } = useTranslation();
  const lang = i18n.language.startsWith("en") ? "en" : "pl";
  const level = levelForPoints(points);
  const Icon = LEVEL_ICONS[level.key];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        LEVEL_STYLES[level.key],
        className,
      )}
      title={levelName(level, lang)}
    >
      <Icon aria-hidden="true" className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {levelName(level, lang)}
    </span>
  );
}
