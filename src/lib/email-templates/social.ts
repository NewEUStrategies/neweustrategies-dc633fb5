// Profile social media NES używane w stopce maili systemowych.
//
// Trzymamy je w jednym module (zamiast rozsypanych literałów w szablonach),
// żeby zmiana adresu profilu była jedną edycją dla wszystkich maili -
// autoryzacyjnych i transakcyjnych.
import type { EmailIconName } from "./icons";

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
    href: "https://www.linkedin.com/company/new-european-strategies",
    icon: "social-linkedin",
  },
  {
    key: "facebook",
    label: "Facebook",
    href: "https://www.facebook.com/neweuropeanstrategies",
    icon: "social-facebook",
  },
  {
    key: "x",
    label: "X",
    href: "https://x.com/NEStrategies",
    icon: "social-x",
  },
] as const;

/** Dane kontaktowe fundacji pokazywane w stopce maili. */
export const NES_CONTACT = {
  email: "office@neweuropeanstrategies.com",
  phone: "+48 784 880 318",
  addressPl: "ul. Tytusa Chałubińskiego 8, 00-613 Warszawa",
  addressEn: "8 Tytusa Chałubińskiego St., 00-613 Warsaw, Poland",
} as const;
