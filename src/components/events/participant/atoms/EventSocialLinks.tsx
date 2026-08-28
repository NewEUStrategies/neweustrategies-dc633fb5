// Atom: ikony mediów społecznościowych uczestnika w tym samym języku wizualnym,
// co pasek social w nagłówku strony - kwadratowy kafelek 6px, ikona w tonie
// tekstu, a po najechaniu (i przy focusie z klawiatury) kolor marki.
//
// Kolory bierzemy z jednego źródła prawdy (`SOCIAL_OFFICIAL_COLORS`), więc gdy
// header zmieni paletę, karta uczestnika zmienia się razem z nim.
import type { ComponentType, CSSProperties, SVGProps } from "react";
import { useTranslation } from "react-i18next";

import { Facebook, Globe, Instagram, Linkedin, Youtube } from "@/lib/lucide-shim";
import { XIcon } from "@/components/atoms/XIcon";
import { SOCIAL_OFFICIAL_COLORS } from "@/components/builder/organisms/widget-view/socialHover";
import { SOCIAL_KEYS, type SocialKey } from "@/lib/events/myEventProfileApi";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: string | number }>;

const SOCIAL_ICON: Record<SocialKey, IconComponent> = {
  linkedin: Linkedin,
  x: XIcon,
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
  website: Globe,
};

/** Kolor marki kafelka; „strona www" dostaje ton firmowy platformy. */
function brandColor(key: SocialKey): string {
  return SOCIAL_OFFICIAL_COLORS[key] ?? "hsl(var(--brand, 25 95% 63%))";
}

export interface EventSocialLinksProps {
  links: Partial<Record<SocialKey, string | null>>;
  className?: string;
  /** Rozmiar kafelka w px (domyślnie 36 - jak w nagłówku). */
  size?: number;
}

export function EventSocialLinks({ links, className, size = 36 }: EventSocialLinksProps) {
  const { t } = useTranslation();
  const present = SOCIAL_KEYS.filter((key) => (links[key] ?? "").trim() !== "");
  if (present.length === 0) return null;

  return (
    <ul className={cn("flex flex-wrap items-center gap-2", className)}>
      {present.map((key) => {
        const Icon = SOCIAL_ICON[key];
        const href = (links[key] ?? "").trim();
        const style: CSSProperties & Record<"--tile-brand", string> = {
          width: size,
          height: size,
          "--tile-brand": brandColor(key),
        };
        return (
          <li key={key}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={t(`eventMe.social.${key}`)}
              title={t(`eventMe.social.${key}`)}
              style={style}
              className="inline-flex items-center justify-center rounded-[6px] border border-border bg-card text-foreground transition-colors duration-150 hover:border-[var(--tile-brand)] hover:bg-[var(--tile-brand)] hover:text-primary-foreground focus-visible:border-[var(--tile-brand)] focus-visible:bg-[var(--tile-brand)] focus-visible:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
