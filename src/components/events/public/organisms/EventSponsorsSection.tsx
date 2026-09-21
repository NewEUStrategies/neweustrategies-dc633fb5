// Organizm: PUBLICZNA lista partnerów wydarzenia, pogrupowana po poziomie.
//
// POZIOM RZĄDZI ROZMIAREM I KOLEJNOŚCIĄ. To nie jest ozdoba, tylko treść umowy:
// „złoty" ma być większy i wyżej niż „brązowy" na każdej stronie, na której się
// pojawi. Rozmiar bierze się z kolumny poziomu (`logo_size`), a nie z tego,
// ile logotypów akurat zmieściło się w wierszu.
//
// SIATKA JEST PŁYNNA, NIE STOPNIOWANA. `auto-fit` z `minmax` daje jeden rząd
// dla trzech partnerów i cztery rzędy dla trzydziestu, bez czterech
// breakpointów robiących to samo.
//
// KARTOTEKA NIE WCHODZI NA STRONĘ. Wszystko poniżej to migawka z chwili
// przypięcia (`snapshot_*`) - dlatego nie ma tu ani jednego pola z `crm_companies`.
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import {
  sponsorRoleKey,
  type PublicSponsorTier,
  type SponsorLogoSize,
} from "@/lib/events/sponsorsSurface";
import { usePublicEventSponsors } from "@/lib/events/usePublicEvent";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import { SponsorLogo } from "@/components/events/public/atoms/SponsorLogo";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

/** Szerokość kafla rośnie razem z logotypem - inaczej „złoty" ginie w siatce. */
const MIN_TILE: Record<SponsorLogoSize, string> = {
  sm: "9rem",
  md: "12rem",
  lg: "16rem",
};

export function EventSponsorsSection({
  slug,
  enabled = true,
}: {
  slug: string;
  enabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const sponsorsQuery = usePublicEventSponsors(slug, enabled);

  if (sponsorsQuery.isPending) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label={t("eventFront.sponsors.loading")}>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (sponsorsQuery.isError) {
    return (
      <p className="rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {publicEventErrorMessage(sponsorsQuery.error)}
      </p>
    );
  }

  const tiers = sponsorsQuery.data ?? [];
  if (tiers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("eventFront.sections.sponsors.empty")}</p>
    );
  }

  return (
    <div className="space-y-8">
      {tiers.map((tier) => (
        <SponsorTierGroup key={tier.tierId ?? "no-tier"} tier={tier} lang={lang} />
      ))}
    </div>
  );
}

function SponsorTierGroup({ tier, lang }: { tier: PublicSponsorTier; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const tierName = pickLocalized(
    { name_pl: tier.namePl, name_en: tier.nameEn },
    "name",
    lang,
    t("eventFront.sponsors.noTier"),
  );
  const tierDescription = pickLocalized(
    { description_pl: tier.descriptionPl, description_en: tier.descriptionEn },
    "description",
    lang,
  );

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h3
          className="text-sm font-semibold uppercase tracking-wide text-foreground"
          style={tier.accentColor === null ? undefined : { color: tier.accentColor }}
        >
          {tierName}
        </h3>
        {tierDescription !== "" && (
          <p className="text-sm text-muted-foreground">{tierDescription}</p>
        )}
        {tier.benefits.length > 0 && (
          <ul className="flex flex-wrap gap-2 pt-1">
            <li className="sr-only">{t("eventFront.sponsors.benefitsLabel")}</li>
            {tier.benefits.map((benefit) => (
              <li key={benefit.id}>
                <Badge variant="outline">
                  {pickLocalized(
                    { label_pl: benefit.labelPl, label_en: benefit.labelEn },
                    "label",
                    lang,
                  )}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </header>

      <ul
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${MIN_TILE[tier.logoSize]}, 1fr))` }}
      >
        {tier.sponsors.map((sponsor) => {
          const description = pickLocalized(
            { description_pl: sponsor.descriptionPl, description_en: sponsor.descriptionEn },
            "description",
            lang,
          );
          const body = (
            <>
              {/* LOGOTYP JEST OZDOBĄ, PODPIS JEST TREŚCIĄ. `SponsorLogo` bez adresu
                  degraduje do NAZWY firmy, a nazwa stoi już w podpisie kafla - bez
                  `aria-hidden` partner bez logotypu byłby czytany dwa razy pod rząd.
                  Ta sama reguła co w pasie na stronie głównej (`SponsorTierLogo`). */}
              <span aria-hidden="true" className="contents">
                <SponsorLogo name={sponsor.name} logoUrl={sponsor.logoUrl} size={tier.logoSize} />
              </span>
              <span className="mt-3 block text-sm font-medium text-foreground">{sponsor.name}</span>
              <span className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
                <Badge variant="secondary">{t(sponsorRoleKey(sponsor.role))}</Badge>
                {sponsor.boothLabel !== null && (
                  <Badge variant="outline">
                    {t("eventFront.sponsors.boothLabel", { label: sponsor.boothLabel })}
                  </Badge>
                )}
              </span>
              {description !== "" && (
                <span className="mt-2 block text-xs text-muted-foreground">{description}</span>
              )}
            </>
          );

          return (
            <li key={sponsor.id}>
              {sponsor.websiteUrl === null ? (
                <div className="flex h-full flex-col items-center rounded-[6px] border border-border bg-card p-4 text-center">
                  {body}
                </div>
              ) : (
                <a
                  href={sponsor.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex h-full flex-col items-center rounded-[6px] border border-border bg-card p-4 text-center transition-colors hover:border-primary/50"
                >
                  {body}
                  <span className="mt-2 inline-flex items-center gap-1 text-xs text-primary">
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    {t("eventFront.sponsors.visitSite")}
                  </span>
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
