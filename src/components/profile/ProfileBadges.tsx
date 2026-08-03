// Grupa odznak profilowych. Pojedynczy element jest atomem ProfileBadge.
import { useTranslation } from "react-i18next";
import { ProfileBadge } from "@/components/atoms/ProfileBadge";
import {
  badgeLocale,
  normalizeProfileBadges,
  type ProfileBadgeKind,
} from "@/lib/profile/badgeCatalog";
import { cn } from "@/lib/utils";

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
  const language = badgeLocale(i18n.language ?? "pl");
  const normalized = normalizeProfileBadges(badges ?? []);
  if (normalized.length === 0) return null;

  return (
    <span
      role="list"
      aria-label={language === "pl" ? "Odznaki profilowe" : "Profile badges"}
      className={cn("inline-flex flex-wrap items-center gap-1", className)}
    >
      {normalized.map((badge) => (
        <ProfileBadge key={badge} badge={badge} language={language} size={size} />
      ))}
    </span>
  );
}
