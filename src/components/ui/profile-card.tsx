// Karta profilu autora/eksperta - JEDNA prezentacja dla obu edytorów.
//
// Ten sam komponent renderuje wariant „profile" bloku `author-bio`
// (block editor / Gutenberg) oraz widget `author-profile-card` (builder
// Elementor-like) i stronę publiczną. Dzięki temu podgląd w edytorze nie może
// obiecać innego wyglądu niż produkcja.
//
// Świadome odstępstwa od wklejonego wzorca:
//   * `next/image` + `next/link` -> `<img>` i `AppLink` (projekt to TanStack
//     Start, nie Next.js - `next` nie jest i nie będzie zależnością),
//   * `framer-motion` -> przejścia CSS (biblioteki nie ma w projekcie, a jedyny
//     ruch w tym wzorcu to hover, który CSS obsługuje bez kosztu JS),
//   * kolory wyłącznie z tokenów semantycznych (dark/light bez dodatkowej
//     pracy), zaokrąglenie 6 px zgodnie z systemem.
import type { ComponentType, ReactNode, SVGProps } from "react";
import { User } from "@/lib/lucide-shim";
import { AppLink } from "@/components/atoms/AppLink";
import { cn } from "@/lib/utils";

export interface ProfileCardSocial {
  key: string;
  href: string;
  label: string;
  /** Ikona wektorowa (lucide). Pomijana, gdy podano `iconUrl`. */
  Icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Ikona wgrana przez redakcję (własna platforma). */
  iconUrl?: string;
}

export interface ProfileCardProps {
  name: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  socials?: ProfileCardSocial[];
  /** Link do profilu publicznego. Brak = nazwisko bez odnośnika. */
  profileHref?: string | null;
  /** Dodatkowa treść pod opisem (np. licznik publikacji). */
  meta?: ReactNode;
  /** Etykieta nad nazwiskiem (i18n po stronie wywołującego). */
  eyebrow?: string;
  /** Dostępna nazwa listy linków (i18n po stronie wywołującego). */
  socialsLabel?: string;
  className?: string;
}

const RADIUS = "rounded-[6px]";

function Avatar({ name, imageUrl }: { name: string; imageUrl?: string }) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        loading="lazy"
        decoding="async"
        className={cn("h-full w-full object-cover", RADIUS)}
      />
    );
  }
  return (
    <div
      className={cn("flex h-full w-full items-center justify-center bg-muted", RADIUS)}
      aria-hidden
    >
      <User className="h-1/3 w-1/3 text-muted-foreground" />
    </div>
  );
}

function SocialRow({ socials, label }: { socials: ProfileCardSocial[]; label?: string }) {
  if (socials.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-2 p-0" aria-label={label}>
      {socials.map(({ key, href, label: itemLabel, Icon, iconUrl }) => {
        const internal = href.startsWith("mailto:") || href.startsWith("tel:");
        return (
          <li key={key}>
            <a
              href={href}
              target={internal ? undefined : "_blank"}
              rel={internal ? undefined : "noreferrer noopener"}
              aria-label={itemLabel}
              title={itemLabel}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center overflow-hidden border border-border text-muted-foreground transition-colors",
                "hover:border-foreground/40 hover:bg-muted hover:text-foreground",
                RADIUS,
              )}
            >
              {iconUrl ? (
                <img src={iconUrl} alt="" width={14} height={14} className="object-contain" />
              ) : Icon ? (
                <Icon width={14} height={14} aria-hidden />
              ) : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function ProfileCard({
  name,
  title,
  description,
  imageUrl,
  socials = [],
  profileHref,
  meta,
  eyebrow,
  socialsLabel,
  className,
}: ProfileCardProps) {
  const nameEl = profileHref ? (
    <AppLink href={profileHref} className="transition-colors hover:text-primary">
      {name}
    </AppLink>
  ) : (
    <>{name}</>
  );

  const body = (
    <>
      {eyebrow && (
        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {eyebrow}
        </div>
      )}
      <h3
        className="m-0 text-xl font-bold leading-tight text-foreground md:text-2xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {nameEl}
      </h3>
      {title && <p className="m-0 text-sm text-muted-foreground">{title}</p>}
      {description && (
        <p className="m-0 text-sm leading-relaxed text-foreground/80">{description}</p>
      )}
      {meta && <div className="text-[11px] text-muted-foreground">{meta}</div>}
      <SocialRow socials={socials} label={socialsLabel} />
    </>
  );

  return (
    <aside className={cn("not-prose", className)} data-profile-card>
      {/* Desktop: kwadratowe zdjęcie + karta nachodząca na nie od dołu-prawej. */}
      <div className="hidden md:grid md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:items-center">
        <div className={cn("aspect-square w-full overflow-hidden", RADIUS)}>
          <Avatar name={name} imageUrl={imageUrl} />
        </div>
        <div
          className={cn(
            "-ml-10 space-y-3 border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md",
            RADIUS,
          )}
        >
          {body}
        </div>
      </div>

      {/* Mobile: zdjęcie nad kartą, ta sama treść i te same tokeny. */}
      <div className="md:hidden">
        <div className={cn("aspect-square w-full overflow-hidden", RADIUS)}>
          <Avatar name={name} imageUrl={imageUrl} />
        </div>
        <div className={cn("mt-3 space-y-3 border border-border bg-card p-5 shadow-sm", RADIUS)}>
          {body}
        </div>
      </div>
    </aside>
  );
}
