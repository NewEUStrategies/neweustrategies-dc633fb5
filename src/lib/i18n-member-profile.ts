// Nakładka i18n profilu członka (/people/<slug>) - PL/EN.
//
// Teksty `head()` (tytuł karty i opis) NIE mieszkają tutaj, tylko
// w `lib/profile/memberProfileHead.ts`: import tego słownika z `head()` wciągał
// go do chunku wejściowego każdego czytelnika.
import i18n from "./i18n";

export const memberProfilePl = {
  memberProfile: {
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
