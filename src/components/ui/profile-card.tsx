// Karta profilu autora/eksperta - JEDNA prezentacja dla obu edytorów.
//
// Ten sam komponent renderuje wariant „profile" bloku `author-bio`
// (block editor / Gutenberg) oraz widget `author-profile-card` (builder
// Elementor-like) i stronę publiczną. Dzięki temu podgląd w edytorze nie może
// obiecać innego wyglądu niż produkcja.
//
// ODWZOROWANIE WZORCA: duży kwadratowy portret, karta nachodząca na zdjęcie od
// prawej, mocny cień, wypełnione przyciski social (ikona w kontrze), wejście
// animowane; na mobile zdjęcie nad wyśrodkowaną treścią. Wszystkie te wymiary
// są ustawieniami panelu (patrz `ProfileCardStyle`), a nie stałymi w kodzie.
//
// Świadome odstępstwa od wklejonego wzorca:
//   * `next/image` + `next/link` -> `<img>` i `AppLink` (projekt to TanStack
//     Start, nie Next.js - `next` nie jest i nie będzie zależnością),
//   * `framer-motion` -> klasy CSS `.pc-rise-*` (biblioteki nie ma w projekcie,
//     a jedyny ruch we wzorcu to wejście karty, które CSS robi bez kosztu JS
//     i z poszanowaniem `prefers-reduced-motion`),
//   * `rounded-3xl` -> platformowe **6 px** na zdjęciu, karcie i przyciskach
//     social (jedno zaokrąglenie w całym systemie),
//   * ikona Twittera -> logotyp **X** (dostarcza wywołujący),
//   * kolory wyłącznie z tokenów semantycznych - `bg-gray-900 dark:bg-gray-100`
//     i `text-white dark:text-gray-900` ze wzorca to dokładnie para
//     `foreground`/`background`, więc dark mode działa bez dodatkowej pracy.
import type { ComponentType, CSSProperties, ReactNode, SVGProps } from "react";
import { User } from "@/lib/lucide-shim";
import { AppLink } from "@/components/atoms/AppLink";
import { cn } from "@/lib/utils";

export interface ProfileCardSocial {
  key: string;
  href: string;
  label: string;
  /** Ikona wektorowa (lucide / własny logotyp X). Pomijana, gdy podano `iconUrl`. */
  Icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Ikona wgrana przez redakcję (własna platforma). */
  iconUrl?: string;
}

export type ProfileCardShadow = "none" | "sm" | "md" | "lg" | "xl";
export type ProfileCardSocialStyle = "solid" | "outline";
export type ProfileCardAlign = "left" | "center";

/** Ustawienia prezentacji - te same klucze wystawiają oba buildery. */
export interface ProfileCardStyle {
  /** Bok kwadratowego portretu na desktopie (px). */
  imageSize?: number;
  /** O ile karta nachodzi na zdjęcie (px). 0 = brak nakładki. */
  overlap?: number;
  /** Maksymalna szerokość całego układu (px). */
  maxWidth?: number;
  /** Wyrównanie treści na mobile (desktop zawsze do lewej). */
  align?: ProfileCardAlign;
  /** Wypełniony przycisk (wzorzec) albo obrys. */
  socialStyle?: ProfileCardSocialStyle;
  /** Bok przycisku social (px). */
  socialSize?: number;
  /** Cień karty. */
  shadow?: ProfileCardShadow;
  /** Animacja wejścia karty (wyłączana też przez `prefers-reduced-motion`). */
  animate?: boolean;
}

export interface ProfileCardProps extends ProfileCardStyle {
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

/** Platformowe zaokrąglenie. Świadomie NIE jest ustawieniem panelu. */
const RADIUS = "rounded-[6px]";

export const PROFILE_CARD_DEFAULTS = {
  imageSize: 470,
  overlap: 80,
  maxWidth: 1024,
  align: "center" as ProfileCardAlign,
  socialStyle: "solid" as ProfileCardSocialStyle,
  socialSize: 48,
  shadow: "xl" as ProfileCardShadow,
  animate: true,
} as const;

const SHADOW_CLASS: Record<ProfileCardShadow, string> = {
  none: "",
  sm: "shadow-sm",
  md: "shadow-md",
  lg: "shadow-lg",
  xl: "shadow-2xl",
};

/** Zakresy = te same, które panel wystawia w polach liczbowych. */
const clampNum = (v: number | undefined, fallback: number, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
};

function Avatar({ name, imageUrl }: { name: string; imageUrl?: string }) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted" aria-hidden>
      <User className="h-1/3 w-1/3 text-muted-foreground" />
    </div>
  );
}

function SocialRow({
  socials,
  label,
  style,
  size,
  align,
}: {
  socials: ProfileCardSocial[];
  label?: string;
  style: ProfileCardSocialStyle;
  size: number;
  align: "left" | "center";
}) {
  if (socials.length === 0) return null;
  const solid = style === "solid";
  const icon = Math.max(12, Math.round(size * 0.42));
  return (
    <ul
      className={cn(
        "m-0 flex list-none flex-wrap items-center gap-4 p-0",
        align === "center" ? "justify-center" : "justify-start",
      )}
      aria-label={label}
    >
      {socials.map(({ key, href, label: itemLabel, Icon, iconUrl }) => {
        // `mailto:`/`tel:` nie otwierają karty - nowe okno tylko dla http(s).
        const sameContext = href.startsWith("mailto:") || href.startsWith("tel:");
        return (
          <li key={key}>
            <a
              href={href}
              target={sameContext ? undefined : "_blank"}
              rel={sameContext ? undefined : "noreferrer noopener"}
              aria-label={itemLabel}
              title={itemLabel}
              style={{ width: size, height: size }}
              className={cn(
                "inline-flex items-center justify-center overflow-hidden transition-transform duration-200",
                "motion-safe:hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                solid
                  ? "bg-foreground text-background hover:bg-foreground/85"
                  : "border border-border text-muted-foreground hover:border-foreground/40 hover:bg-muted hover:text-foreground",
                RADIUS,
              )}
            >
              {iconUrl ? (
                <img
                  src={iconUrl}
                  alt=""
                  width={icon}
                  height={icon}
                  className={cn("object-contain", solid && "invert dark:invert-0")}
                />
              ) : Icon ? (
                <Icon width={icon} height={icon} aria-hidden />
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
  imageSize,
  overlap,
  maxWidth,
  align,
  socialStyle,
  socialSize,
  shadow,
  animate,
}: ProfileCardProps) {
  const d = PROFILE_CARD_DEFAULTS;
  const img = clampNum(imageSize, d.imageSize, 200, 720);
  const over = clampNum(overlap, d.overlap, 0, 200);
  const width = clampNum(maxWidth, d.maxWidth, 480, 1600);
  const social = clampNum(socialSize, d.socialSize, 28, 72);
  const mobileAlign: ProfileCardAlign = align === "left" ? "left" : d.align;
  const solid: ProfileCardSocialStyle = socialStyle === "outline" ? "outline" : d.socialStyle;
  const shade: ProfileCardShadow = shadow && shadow in SHADOW_CLASS ? shadow : d.shadow;
  const moves = animate !== false;

  const nameEl = profileHref ? (
    <AppLink href={profileHref} className="transition-colors hover:text-primary">
      {name}
    </AppLink>
  ) : (
    <>{name}</>
  );

  const body = (
    <>
      <div className="mb-6">
        {eyebrow && (
          <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <h3
          className="m-0 mb-2 text-xl font-bold leading-tight text-foreground md:text-2xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {nameEl}
        </h3>
        {title && <p className="m-0 text-sm font-medium text-muted-foreground">{title}</p>}
      </div>
      {description && (
        <p className="m-0 mb-8 text-sm leading-relaxed text-foreground md:text-base">
          {description}
        </p>
      )}
      {meta && <div className="mb-6 text-[11px] text-muted-foreground">{meta}</div>}
    </>
  );

  // Zdjęcie kurczy się poniżej zadanego boku, żeby układ nie wypadał z kolumny
  // na węższych ekranach desktopowych (wzorzec miał sztywne 470 px).
  const photoStyle: CSSProperties = { width: img, maxWidth: "46%" };
  const cardStyle: CSSProperties = { marginLeft: -over };

  return (
    <aside
      className={cn("not-prose mx-auto w-full", className)}
      style={{ maxWidth: width }}
      data-profile-card
    >
      {/* Desktop: kwadratowe zdjęcie + karta nachodząca na nie od prawej. */}
      <div className="relative hidden items-center md:flex">
        <div
          className={cn("aspect-square shrink-0 overflow-hidden bg-muted", RADIUS)}
          style={photoStyle}
        >
          <Avatar name={name} imageUrl={imageUrl} />
        </div>
        <div
          className={cn(
            "relative z-10 min-w-0 flex-1 border border-border bg-card p-8",
            SHADOW_CLASS[shade],
            moves && "pc-rise-x",
            RADIUS,
          )}
          style={cardStyle}
        >
          {body}
          <SocialRow
            socials={socials}
            label={socialsLabel}
            style={solid}
            size={social}
            align="left"
          />
        </div>
      </div>

      {/* Mobile: zdjęcie nad kartą, ta sama treść i te same tokeny. */}
      <div
        className={cn(
          "md:hidden",
          mobileAlign === "center" ? "text-center" : "text-left",
          moves && "pc-rise-y",
        )}
      >
        <div className={cn("aspect-square w-full overflow-hidden bg-muted", RADIUS)}>
          <Avatar name={name} imageUrl={imageUrl} />
        </div>
        <div className={cn("mt-6 border border-border bg-card p-6", SHADOW_CLASS[shade], RADIUS)}>
          {body}
          <SocialRow
            socials={socials}
            label={socialsLabel}
            style={solid}
            size={social}
            align={mobileAlign === "center" ? "center" : "left"}
          />
        </div>
      </div>
    </aside>
  );
}
