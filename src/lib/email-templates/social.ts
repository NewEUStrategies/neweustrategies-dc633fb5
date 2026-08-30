// Profile social media NES używane w stopce maili systemowych.
//
// Trzymamy je w jednym module (zamiast rozsypanych literałów w szablonach),
// żeby zmiana adresu profilu była jedną edycją dla wszystkich maili -
// autoryzacyjnych i transakcyjnych.
//
// SAME ADRESY MIESZKAJĄ PIĘTRO WYŻEJ, w `lib/social/nesProfiles`. Ten moduł
// odpowiada wyłącznie za to, KTÓRE platformy i z jaką ikoną wchodzą do stopki
// maila (zestaw ikon `EmailIconName` jest mniejszy niż zestaw platform
// widgetu), a nie za to, POD JAKIM adresem stoi profil. Rozdział jest tu
// dlatego, że stopka maila niosła `x.com/NEStrategies`, a strona /kontakt -
// `x.com/NewEUStrategies`: dwie odpowiedzi na jedno pytanie, w dwóch plikach,
// żadnej bramki między nimi.
import type { EmailIconName } from "./icons";
import { NES_CONTACT_EMAIL, NES_PROFILE_URLS } from "@/lib/social/nesProfiles";

export interface EmailSocialLink {
  key: string;
  label: string;
  href: string;
  icon: EmailIconName;
}

export const NES_SOCIAL_LINKS: readonly EmailSocialLink[] = [
  {
    key: "linkedin",
    label: "LinkedIn",
    href: NES_PROFILE_URLS.linkedin,
    icon: "social-linkedin",
  },
  {
    key: "facebook",
    label: "Facebook",
    href: NES_PROFILE_URLS.facebook,
    icon: "social-facebook",
  },
  {
    key: "x",
    label: "X",
    href: NES_PROFILE_URLS.x,
    icon: "social-x",
  },
] as const;

/** Dane kontaktowe fundacji pokazywane w stopce maili. */
export const NES_CONTACT = {
  email: NES_CONTACT_EMAIL,
  phone: "+48 784 880 318",
  addressPl: "ul. Tytusa Chałubińskiego 8, 00-613 Warszawa",
  addressEn: "8 Tytusa Chałubińskiego St., 00-613 Warsaw, Poland",
} as const;
