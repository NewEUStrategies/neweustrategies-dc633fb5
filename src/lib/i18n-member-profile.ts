// Nakładka i18n profilu członka (/people/<slug>) - PL/EN.
import i18n from "./i18n";

export const memberProfilePl = {
  memberProfile: {
    metaTitle: "Profil członka",
    metaDescription: "Profil członka społeczności New European Strategies.",
    breadcrumb: "Osoby",
    gateTitle: "Profil widoczny po zalogowaniu",
    gateBody: "Profile członków społeczności widzą wyłącznie zalogowane osoby.",
    notFoundTitle: "Nie znaleziono profilu",
    notFoundBody: "Ta osoba nie istnieje albo nie udostępnia swojego profilu.",
    backToPeople: "Wróć do katalogu osób",
    loading: "Wczytywanie profilu…",
    error: "Nie udało się wczytać profilu. Spróbuj ponownie.",
    retry: "Spróbuj ponownie",
    verified: "Zweryfikowany profil",
    about: "O mnie",
    specialization: "Specjalizacja",
    links: "Odnośniki",
    website: "Strona internetowa",
    linkedin: "LinkedIn",
    authorProfile: "Zobacz profil autora",
    editProfile: "Edytuj profil",
  },
};

export const memberProfileEn: typeof memberProfilePl = {
  memberProfile: {
    metaTitle: "Member profile",
    metaDescription: "A New European Strategies community member profile.",
    breadcrumb: "People",
    gateTitle: "Profile visible after signing in",
    gateBody: "Community member profiles are visible to signed-in people only.",
    notFoundTitle: "Profile not found",
    notFoundBody: "This person does not exist or does not share their profile.",
    backToPeople: "Back to the people directory",
    loading: "Loading profile…",
    error: "The profile could not be loaded. Please try again.",
    retry: "Try again",
    verified: "Verified profile",
    about: "About",
    specialization: "Specialisation",
    links: "Links",
    website: "Website",
    authorProfile: "View author profile",
    linkedin: "LinkedIn",
    editProfile: "Edit profile",
  },
};

let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", memberProfilePl, true, true);
  i18n.addResourceBundle("en", "translation", memberProfileEn, true, true);
}
ensureI18n();
