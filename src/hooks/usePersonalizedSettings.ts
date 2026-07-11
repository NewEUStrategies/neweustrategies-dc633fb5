import { useSiteSetting } from "@/lib/useSiteSetting";

export interface PersonalizedSectionConfig {
  enabled: boolean;
  heading: string;
  description: string;
  columns: number;
  postsPerPage?: number;
}

// NOTE: `userExpirationDays` was removed from this shape. Signed-in users'
// saves live server-side (user_bookmarks / user_follows) where the client has
// no retention mechanism to enforce - keeping a dead knob in the admin form
// only suggested a behaviour that never existed. Old site_settings rows may
// still carry the key; deepMerge simply ignores it.
export interface PersonalizedSettings {
  enabled: boolean;
  allowGuests: boolean;
  /**
   * TTL (in days) for the GUEST personalization stored on the device -
   * currently the localStorage reading list ("lovable:saved-articles").
   * Entries older than this are dropped on read (useSaveArticle) and are
   * neither shown as saved nor merged into the account at sign-in
   * (anonMerge). 0 or less = never expire.
   */
  guestExpirationDays: number;
  popupNotification: boolean;
  restrictedTitle: string;
  restrictedDescription: string;
  followInCategoryHeader: boolean;
  followInTagHeader: boolean;
  followInAuthorHeader: boolean;
  /**
   * Where "reading list" UI links point (e.g. the toast action shown after
   * saving an article). The /reading-list ROUTE itself stays where it is -
   * this only retargets links, e.g. at a custom page embedding the list.
   */
  readingListPath: string;
  sections: {
    saved: PersonalizedSectionConfig;
    followed: PersonalizedSectionConfig;
    recommended: PersonalizedSectionConfig;
  };
}

export const PERSONALIZED_SETTINGS_KEY = "personalized_system";

export const DEFAULT_PERSONALIZED_SETTINGS: PersonalizedSettings = {
  enabled: true,
  allowGuests: false,
  guestExpirationDays: 14,
  popupNotification: true,
  restrictedTitle: "Dołącz do społeczności",
  restrictedDescription:
    "Załóż konto, aby zapisywać ulubione artykuły i wracać do nich w dowolnym momencie.",
  followInCategoryHeader: true,
  followInTagHeader: false,
  followInAuthorHeader: true,
  readingListPath: "/reading-list",
  sections: {
    saved: {
      enabled: true,
      heading: "Twoja lista do przeczytania",
      description: "Tutaj znajdziesz wszystkie zapisane artykuły.",
      columns: 3,
    },
    followed: {
      enabled: true,
      heading: "Obserwowane",
      description: "Kategorie i autorzy, których obserwujesz.",
      columns: 3,
    },
    recommended: {
      enabled: true,
      heading: "Rekomendowane dla Ciebie",
      description: "Wybrane na podstawie Twoich zainteresowań i historii czytania.",
      columns: 3,
      postsPerPage: 9,
    },
  },
};

/** Resolve `readingListPath` to a safe internal path (fallback: /reading-list). */
export function safeReadingListPath(settings: PersonalizedSettings): string {
  const p = settings.readingListPath.trim();
  return p.startsWith("/") && !p.startsWith("//") ? p : "/reading-list";
}

export function usePersonalizedSettings(): PersonalizedSettings {
  return useSiteSetting<PersonalizedSettings>(
    PERSONALIZED_SETTINGS_KEY,
    DEFAULT_PERSONALIZED_SETTINGS,
  );
}
