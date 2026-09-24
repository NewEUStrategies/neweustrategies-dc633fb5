// Karta encji inline (firma / osoba) - czysty widok prezentacyjny.
//
// Wspólny dla publicznej nakładki (`InlineEntityCards`) i podglądu w edytorze,
// więc redakcja widzi kartę dokładnie taką, jaką zobaczy czytelnik. Każdy
// element ma ikonę; etykieta pola jest w `<dt class="sr-only">`, żeby czytnik
// ekranu mówił „Branża: Energetyka", a wzrok widział samą ikonę i wartość.

import { forwardRef, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-public";
import { Building2, ExternalLink, Factory, Globe, MapPin, Target, UserRound } from "lucide-react";
import { Facebook, Instagram, Linkedin, Twitter, Youtube } from "@/lib/lucide-shim";
import { buildAvatarSrc, buildAvatarSrcSet } from "@/lib/cropSizes";
import {
  countryFlagEmoji,
  inlineEntityDisplayName,
  inlineEntityInitials,
  pickLocalized,
  SOCIAL_NETWORKS,
  urlHostLabel,
  type InlineEntity,
  type InlineEntityLang,
  type SocialNetwork,
} from "@/lib/blocks/inlineEntities/model";
import { cn } from "@/lib/utils";

/** Bok zdjęcia / logo w nagłówku karty (CSS px). */
export const CARD_AVATAR_PX = 44;

/** Wspólny kształt ikon z lucide-react i z lucide-shim (marki, pakiet ikon motywu). */
type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;

const SOCIAL_ICONS: Record<SocialNetwork, IconComponent> = {
  linkedin: Linkedin,
  x: Twitter,
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
};

interface Props {
  entity: InlineEntity;
  lang: InlineEntityLang;
  /** Identyfikator elementu (cel `aria-controls` wyzwalacza). */
  id?: string;
  className?: string;
  /** Link do profilu autora w serwisie (np. `/people/anna-nowak`). */
  profileHref?: string | null;
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: IconComponent;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <dt className="sr-only">{label}</dt>
      <Icon aria-hidden="true" className="mt-[3px] size-3.5 shrink-0 text-muted-foreground" />
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </div>
  );
}

function ExternalAnchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1 text-foreground underline decoration-foreground/25 underline-offset-2 hover:decoration-foreground/60 focus-visible:rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate">{children}</span>
      <ExternalLink aria-hidden="true" className="size-3 shrink-0 opacity-60" />
    </a>
  );
}

function CardAvatar({ entity }: { entity: InlineEntity }) {
  const src = entity.image?.src;
  if (!src) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-[6px] bg-muted text-sm font-semibold text-muted-foreground ring-1 ring-foreground/10"
      >
        {inlineEntityInitials(entity)}
      </span>
    );
  }
  const srcSet = buildAvatarSrcSet(src, CARD_AVATAR_PX);
  return (
    <img
      alt=""
      className="size-11 shrink-0 rounded-[6px] object-cover ring-1 ring-foreground/10"
      decoding="async"
      height={CARD_AVATAR_PX}
      src={buildAvatarSrc(src, CARD_AVATAR_PX)}
      srcSet={srcSet || undefined}
      width={CARD_AVATAR_PX}
    />
  );
}

export const InlineEntityCardView = forwardRef<HTMLDivElement, Props>(function InlineEntityCardView(
  { entity, lang, id, className, profileHref },
  ref,
) {
  const { t } = useTranslation();
  const name = inlineEntityDisplayName(entity);
  const isCompany = entity.kind === "company";
  const subtitle = isCompany
    ? pickLocalized(entity.industry, lang)
    : pickLocalized(entity.position, lang);
  const socials = SOCIAL_NETWORKS.filter((network) => Boolean(entity.socials[network]));

  const rows: ReactNode[] = [];
  if (entity.kind === "company") {
    if (entity.country) {
      const flag = countryFlagEmoji(entity.country.code);
      rows.push(
        <Row key="country" icon={MapPin} label={t("inlineEntity.country")}>
          {flag ? (
            <span aria-hidden="true" className="mr-1">
              {flag}
            </span>
          ) : null}
          {entity.country[lang] || entity.country.pl}
        </Row>,
      );
    }
    const industry = pickLocalized(entity.industry, lang);
    if (industry) {
      rows.push(
        <Row key="industry" icon={Factory} label={t("inlineEntity.industry")}>
          {industry}
        </Row>,
      );
    }
    const specialization = pickLocalized(entity.specialization, lang);
    if (specialization) {
      rows.push(
        <Row key="specialization" icon={Target} label={t("inlineEntity.specialization")}>
          {specialization}
        </Row>,
      );
    }
  } else {
    if (entity.company) {
      rows.push(
        <Row key="company" icon={Building2} label={t("inlineEntity.company")}>
          {entity.company}
        </Row>,
      );
    }
  }
  if (entity.website) {
    rows.push(
      <Row
        key="website"
        icon={Globe}
        label={t(isCompany ? "inlineEntity.website" : "inlineEntity.externalPage")}
      >
        <ExternalAnchor href={entity.website}>{urlHostLabel(entity.website)}</ExternalAnchor>
      </Row>,
    );
  }
  if (!isCompany && profileHref) {
    rows.push(
      <Row key="profile" icon={UserRound} label={t("inlineEntity.authorProfile")}>
        <a
          href={profileHref}
          className="text-foreground underline decoration-foreground/25 underline-offset-2 hover:decoration-foreground/60 focus-visible:rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("inlineEntity.authorProfile")}
        </a>
      </Row>,
    );
  }

  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label={t(isCompany ? "inlineEntity.companyCard" : "inlineEntity.personCard", { name })}
      data-nes-ie-card={entity.id}
      className={cn(
        "rounded-[10px] border border-foreground/10 bg-background p-4 text-left text-sm text-foreground not-prose",
        // Światło rozproszone + kierunkowe zamiast jednego płaskiego cienia -
        // karta ma „unosić się" nad akapitem, a nie być na nim odbita.
        "shadow-[0_1px_2px_rgb(0_0_0/0.05),0_14px_32px_-14px_rgb(0_0_0/0.28)]",
        "dark:border-foreground/15 dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),0_14px_32px_-14px_rgb(0_0_0/0.7)]",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <CardAvatar entity={entity} />
        <div className="min-w-0">
          <p className="m-0 truncate font-semibold leading-snug">{name}</p>
          {subtitle ? (
            <p className="m-0 truncate text-xs leading-snug text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {rows.length > 0 ? (
        <dl className="m-0 mt-3 grid gap-1.5 text-[13px] leading-snug text-foreground/85">
          {rows}
        </dl>
      ) : null}
      {socials.length > 0 ? (
        <div className="mt-3 border-t border-foreground/10 pt-3">
          <p className="sr-only">{t("inlineEntity.socials")}</p>
          <ul className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
            {socials.map((network) => {
              const Icon = SOCIAL_ICONS[network];
              const networkName = t(`inlineEntity.networks.${network}`);
              return (
                <li key={network} className="m-0 p-0 before:content-none">
                  <a
                    href={entity.socials[network]}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("inlineEntity.socialLink", { network: networkName, name })}
                    title={networkName}
                    className="inline-flex size-7 items-center justify-center rounded-[6px] border border-foreground/10 text-foreground/75 transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Icon aria-hidden="true" className="size-3.5" />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
});
