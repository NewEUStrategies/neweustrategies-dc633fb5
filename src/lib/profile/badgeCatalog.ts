// Kanoniczny kontrakt odznak profilowych. Ta lista odpowiada ograniczeniu
// CHECK public.profile_badges_badge_check w bazie i jest jedynym katalogiem
// używanym przez warstwę publiczną oraz panel administracyjny.

export const PROFILE_BADGE_KINDS = ["verified", "expert", "staff", "contributor"] as const;

export type ProfileBadgeKind = (typeof PROFILE_BADGE_KINDS)[number];

export type BadgeLocale = "pl" | "en";

export interface ProfileBadgeDefinition {
  key: ProfileBadgeKind;
  label: Record<BadgeLocale, string>;
  description: Record<BadgeLocale, string>;
  grantMode: "manual" | "hybrid";
}

export const PROFILE_BADGE_CATALOG: Readonly<Record<ProfileBadgeKind, ProfileBadgeDefinition>> = {
  verified: {
    key: "verified",
    label: { pl: "Zweryfikowany", en: "Verified" },
    description: {
      pl: "Tożsamość lub afiliacja zawodowa potwierdzona przez administrację.",
      en: "Identity or professional affiliation confirmed by an administrator.",
    },
    grantMode: "manual",
  },
  expert: {
    key: "expert",
    label: { pl: "Ekspert", en: "Expert" },
    description: {
      pl: "Ekspert publikujący analizy lub prowadzący sesje merytoryczne.",
      en: "An expert publishing analysis or leading substantive sessions.",
    },
    grantMode: "manual",
  },
  staff: {
    key: "staff",
    label: { pl: "Redakcja", en: "Staff" },
    description: {
      pl: "Członek zespołu redakcyjnego lub organizacyjnego.",
      en: "A member of the editorial or operations team.",
    },
    grantMode: "manual",
  },
  contributor: {
    key: "contributor",
    label: { pl: "Autor gościnny", en: "Contributor" },
    description: {
      pl: "Autor zaakceptowanego materiału lub aktywny współtwórca społeczności.",
      en: "An author of accepted work or an active community contributor.",
    },
    grantMode: "hybrid",
  },
};

export const BADGE_ORDER: readonly ProfileBadgeKind[] = PROFILE_BADGE_KINDS;

export const BADGE_DEFINITIONS: readonly ProfileBadgeDefinition[] = PROFILE_BADGE_KINDS.map(
  (key) => PROFILE_BADGE_CATALOG[key],
);

export function isProfileBadgeKind(value: unknown): value is ProfileBadgeKind {
  return typeof value === "string" && (PROFILE_BADGE_KINDS as readonly string[]).includes(value);
}

export function normalizeProfileBadges(values: readonly unknown[]): ProfileBadgeKind[] {
  const present = new Set(values.filter(isProfileBadgeKind));
  return PROFILE_BADGE_KINDS.filter((badge) => present.has(badge));
}

export function badgeLocale(language: string): BadgeLocale {
  return language.toLowerCase().startsWith("en") ? "en" : "pl";
}

export function badgeLabel(badge: ProfileBadgeKind, language: string): string {
  return PROFILE_BADGE_CATALOG[badge].label[badgeLocale(language)];
}
