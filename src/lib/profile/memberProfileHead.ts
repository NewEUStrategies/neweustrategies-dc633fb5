// SEO karty profilu członka (/people/<slug>) - stała mapa PL/EN, a nie słownik i18n.
//
// DLACZEGO OSOBNY PLIK. `head()` trasy biegnie poza drzewem Reacta (język bierzemy
// z adresu, nie z singletona i18next) i zostaje w shellu trasy - a shelle tras
// są eager w chunku wejściowym każdego czytelnika. Do 2026-10-02 `head()` czytał
// `memberProfilePl`/`memberProfileEn` wprost z `i18n-member-profile`, więc do
// `index-*.js` trafiał CAŁY słownik profilu członka razem z rejestracją
// nakładki - zmierzone na buildzie tego HEAD-a: tekst bramki „Profile członków
// społeczności widzą wyłącznie zalogowane osoby." stał w chunku wejściowym,
// choć czyta go wyłącznie komponent zalogowanej trasy. Ten sam mechanizm i ta
// sama naprawa co `lib/clubs/applyHead.ts`; regresję łapie `check:entry-purity`.
import type { Lang } from "@/lib/seo/meta";

export interface MemberProfileHeadCopy {
  readonly title: string;
  readonly description: string;
}

/** Teksty przeniesione 1:1 z `memberProfile.metaTitle`/`metaDescription` -
 *  zmiana jest neutralna dla wyszukiwarki i podglądu linku. */
export const MEMBER_PROFILE_HEAD: Readonly<Record<Lang, MemberProfileHeadCopy>> = {
  pl: {
    title: "Profil członka",
    description: "Profil członka społeczności New European Strategies.",
  },
  en: {
    title: "Member profile",
    description: "A New European Strategies community member profile.",
  },
};
