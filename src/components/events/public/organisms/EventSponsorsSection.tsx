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
//
// ZAPYTANIE I RYSUNEK SĄ ROZDZIELONE (`EventSponsorsSectionView`, a dla
// wczytywania i awarii `EventSponsorsSectionPending` / `...Error`), tak jak
// w pasie poziomów (`EventSponsorTiersView`). Publiczne `event_sponsors_public`
// odmawia szkicowi (`AND e.status = 'published'`), a podgląd w studiu ma
// narysować sekcję „Partnerzy" z wierszy RPC panelu - TYM SAMYM rysunkiem,
// nie kopią. Plakietka „nieogłoszony" wchodzi WYŁĄCZNIE napisem od
// wywołującego (`draftLabel`): słownik panelu nie trafia do paczki strony
// publicznej, a strona, która napisu nie podaje, rysuje się bajt w bajt tak
// samo jak przed rozdzieleniem.
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
  const sponsorsQuery = usePublicEventSponsors(slug, enabled);

  if (sponsorsQuery.isPending) return <EventSponsorsSectionPending />;

  if (sponsorsQuery.isError) {
    return <EventSponsorsSectionError message={publicEventErrorMessage(sponsorsQuery.error)} />;
  }

  // Po odsianiu wczytywania i błędu zostaje sukces - `data` jest już listą.
  return <EventSponsorsSectionView tiers={sponsorsQuery.data} />;
}

/**
 * Szkielet sekcji na czas wczytywania - bez zapytania.
 *
 * WYDZIELONY DLA PODGLĄDU STUDIA. Podgląd czeka na INNE zapytanie (RPC panelu),
 * a ma pokazać TEN SAM szkielet: własny zastępnik w panelu byłby drugim
 * rysunkiem tej samej chwili, a zdanie „nie ma partnerów" na czas wczytywania -
 * nieprawdą.
 */
export function EventSponsorsSectionPending() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" aria-busy="true" aria-label={t("eventFront.sponsors.loading")}>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/**
 * Zdanie o awarii zapytania - bez zapytania. NAPIS PODAJE WOŁAJĄCY, bo każde
 * źródło ma swoją mapę odmów: strona - `publicEventErrorMessage`, podgląd
 * studia - odmowy RPC panelu. Awaria NIE MOŻE wyglądać jak „ten kongres nie ma
 * partnerów", więc ma własny rysunek, a nie pustą listę.
 */
export function EventSponsorsSectionError({ message }: { message: string }) {
  return (
    <p className="rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      {message}
    </p>
  );
}

/**
 * SAM RYSUNEK sekcji „Partnerzy" - bez zapytania.
 *
 * `draftLabel` = napis plakietki przy przypięciu nieogłoszonym (`isDraft`).
 * Podaje go tylko podgląd studia; bez napisu plakietki nie ma, nawet gdyby
 * wiersz niósł znacznik.
 */
export function EventSponsorsSectionView({
  tiers,
  draftLabel,
}: {
  tiers: readonly PublicSponsorTier[];
  draftLabel?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  if (tiers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("eventFront.sections.sponsors.empty")}</p>
    );
  }

  return (
    <div className="space-y-8">
      {tiers.map((tier) => (
        <SponsorTierGroup
          key={tier.tierId ?? "no-tier"}
          tier={tier}
          lang={lang}
          draftLabel={draftLabel}
        />
      ))}
    </div>
  );
}

function SponsorTierGroup({
  tier,
  lang,
  draftLabel,
}: {
  tier: PublicSponsorTier;
  lang: "pl" | "en";
  draftLabel: string | undefined;
}) {
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
          // Plakietka tylko przy OBU warunkach: wiersz jest nieogłoszony i ktoś
          // podał napis. Strona publiczna napisu nie podaje - jej kafel się nie
          // zmienia, nawet gdyby znacznik kiedyś przyjechał z sieci.
          const draft = sponsor.isDraft === true && draftLabel !== undefined;
          const body = (
            <>
              {/* LOGOTYP JEST OZDOBĄ, PODPIS JEST TREŚCIĄ. `SponsorLogo` bez adresu
                  degraduje do NAZWY firmy, a nazwa stoi już w podpisie kafla - bez
                  `aria-hidden` partner bez logotypu byłby czytany dwa razy pod rząd.
                  Ta sama reguła co w pasie na stronie głównej (`SponsorTierLogo`). */}
              <span aria-hidden="true" className="contents">
                <SponsorLogo
                  name={sponsor.name}
                  logoUrl={sponsor.logoUrl}
                  size={tier.logoSize}
                  className={draft ? "opacity-60" : undefined}
                />
              </span>
              <span className="mt-3 block text-sm font-medium text-foreground">{sponsor.name}</span>
              <span className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
                <Badge variant="secondary">{t(sponsorRoleKey(sponsor.role))}</Badge>
                {sponsor.boothLabel !== null && (
                  <Badge variant="outline">
                    {t("eventFront.sponsors.boothLabel", { label: sponsor.boothLabel })}
                  </Badge>
                )}
                {/* Napis plakietki jest TEKSTEM kafla, nie `aria-label` - czytnik
                    ekranu słyszy „nieogłoszony" tak samo, jak widzący go widzi. */}
                {draft && <Badge variant="outline">{draftLabel}</Badge>}
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
