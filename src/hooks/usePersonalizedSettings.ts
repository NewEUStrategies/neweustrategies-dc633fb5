import { useSiteSetting } from "@/lib/useSiteSetting";

export interface PersonalizedSectionConfig {
  enabled: boolean;
  heading: string;
  description: string;
  columns: number;
  postsPerPage?: number;
}

export interface PersonalizedSettings {
  enabled: boolean;
  allowGuests: boolean;
  guestExpirationDays: number;
  userExpirationDays: number;
  popupNotification: boolean;
  restrictedTitle: string;
  restrictedDescription: string;
  followInCategoryHeader: boolean;
  followInTagHeader: boolean;
  followInAuthorHeader: boolean;
  readingListPath: string;
  sections: {
    saved: PersonalizedSectionConfig;
    followed: PersonalizedSectionConfig;
    recommended: PersonalizedSectionConfig;
  };
}

export const DEFAULT_PERSONALIZED_SETTINGS: PersonalizedSettings = {
  enabled: true,
  allowGuests: false,
  guestExpirationDays: 14,
  userExpirationDays: 60,
  popupNotification: true,
  restrictedTitle: "Dołącz do społeczności",
  restrictedDescription: "Załóż konto, aby zapisywać ulubione artykuły i wracać do nich w dowolnym momencie.",
  followInCategoryHeader: true,
  followInTagHeader: false,
  followInAuthorHeader: true,
  readingListPath: "/reading-list",
  sections: {
    saved: { enabled: true, heading: "Twoja lista do przeczytania", description: "Tutaj znajdziesz wszystkie zapisane artykuły.", columns: 3 },
    followed: { enabled: true, heading: "Obserwowane", description: "Kategorie i autorzy, których obserwujesz.", columns: 3 },
    recommended: { enabled: true, heading: "Rekomendowane dla Ciebie", description: "Wybrane na podstawie Twoich zainteresowań i historii czytania.", columns: 3, postsPerPage: 9 },
  },
};

export function usePersonalizedSettings(): PersonalizedSettings {
  return useSiteSetting<PersonalizedSettings>("personalized_system", DEFAULT_PERSONALIZED_SETTINGS);
}
