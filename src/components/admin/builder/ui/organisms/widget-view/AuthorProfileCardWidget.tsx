// Widget "Karta profilu autora" (builder Elementor-like).
//
// Prezentacja jest współdzielona z wariantem `profile` bloku `author-bio`
// (block editor / Gutenberg) - obie ścieżki renderują `ProfileCard`, więc
// podgląd w edytorze nie może obiecać innego wyglądu niż strona publiczna.
// Dane pochodzą z treści widgetu (hydratowanej z profilu eksperta w panelu),
// więc renderer nie wykonuje żadnych zapytań sieciowych.
import type { WidgetNode, WidgetContent } from "@/lib/builder/types";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import { ProfileCard, type ProfileCardSocial } from "@/components/ui/profile-card";
import { readProfileCardStyle } from "@/lib/content-model/profileCardStyle";
import { XIcon } from "@/components/atoms/XIcon";
import { Facebook, Linkedin, Globe, Instagram, Youtube, Mail } from "@/lib/lucide-shim";
import { getStr, type Lang } from "./frame";

type SocialKey = "x" | "facebook" | "linkedin" | "instagram" | "youtube" | "website";

const SOCIAL_ICON: Record<SocialKey, ProfileCardSocial["Icon"]> = {
  x: XIcon,
  facebook: Facebook,
  linkedin: Linkedin,
  instagram: Instagram,
  youtube: Youtube,
  website: Globe,
};

const SOCIAL_LABEL: Record<SocialKey, string> = {
  x: "X",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  youtube: "YouTube",
  website: "Website",
};

const SOCIAL_ORDER: readonly SocialKey[] = [
  "x",
  "linkedin",
  "facebook",
  "instagram",
  "youtube",
  "website",
];

function localized(c: Record<string, unknown>, key: string, lang: Lang): string {
  const v =
    (c[`${key}_${lang}`] as unknown) ??
    (c[`${key}_pl`] as unknown) ??
    (c[`${key}_en`] as unknown) ??
    c[key];
  return typeof v === "string" ? v : "";
}

export function AuthorProfileCardWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const c = (node.content ?? {}) as WidgetContent;
  const cRaw = c as unknown as Record<string, unknown>;
  const pl = lang === "pl";

  const name = getStr(c, "name") || (pl ? "Imię i nazwisko" : "Full name");
  const photo = safeImageUrl(getStr(c, "photo"));
  const position = localized(cRaw, "position", lang);
  const description = localized(cRaw, "description", lang);
  const eyebrow = localized(cRaw, "eyebrow", lang);
  const authorSlug = getStr(c, "authorSlug");
  const showSocials = cRaw.showSocials !== false;
  const showProfileLink = cRaw.showProfileLink !== false;
  const email = getStr(c, "email").trim();

  const socials: ProfileCardSocial[] = [];
  if (showSocials) {
    for (const key of SOCIAL_ORDER) {
      const raw = getStr(c, key).trim();
      if (!raw) continue;
      const href = safeUrl(raw, "");
      if (!href || href === "#") continue;
      socials.push({ key, href, label: SOCIAL_LABEL[key], Icon: SOCIAL_ICON[key] });
    }
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      socials.push({ key: "email", href: `mailto:${email}`, label: "Email", Icon: Mail });
    }
  }

  return (
    <ProfileCard
      name={name}
      title={position || undefined}
      description={description || undefined}
      imageUrl={photo || undefined}
      eyebrow={eyebrow || undefined}
      socials={socials}
      profileHref={showProfileLink && authorSlug ? `/author/${authorSlug}` : null}
      socialsLabel={pl ? "Media społecznościowe" : "Social media"}
      {...readProfileCardStyle(cRaw)}
    />
  );
}
