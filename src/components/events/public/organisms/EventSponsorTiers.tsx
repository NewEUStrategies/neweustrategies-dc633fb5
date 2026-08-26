// Organizm: POZIOMY PARTNERÓW na stronie głównej wydarzenia - nazwa poziomu
// i pod nią rząd wyśrodkowanych logotypów.
//
// WZORZEC: docs/zrzuty/swapcard-2026-08-23/38-preview-event-home-desktop.png,
// pas pod spisem sekcji („Premium Partner”, „Silver Partner”, „Bronze
// Partner”). Na wzorcu w rzędzie stoją SAME LOGOTYPY - bez kart, bez nazw pod
// spodem, bez plakietek roli i stoiska.
//
// CZEGO TU CELOWO NIE MA, BO JUŻ ISTNIEJE:
//   * grupowanie po poziomach, ranga poziomu i kolejność przypięć -
//     `parseSponsorTiers` w `src/lib/events/sponsorsSurface.ts`
//     (grupa bez poziomu zawsze na końcu),
//   * sam logotyp: rozmiar wg poziomu i degradacja do NAZWY firmy, gdy migawka
//     nie ma adresu albo obrazek się nie wczyta - atom `SponsorLogo`,
//   * pobranie i cache - `usePublicEventSponsors` (jeden klucz, więc ten pas
//     i sekcja „Partnerzy” na tej samej stronie NIE robią dwóch zapytań).
// Ten plik dokłada WYŁĄCZNIE układ: nagłówek poziomu + rozłożony rząd
// logotypów. `EventSponsorsSection` rysuje ten sam zbiór jako kafle z nazwą,
// opisem, plakietkami i odnośnikiem do strony partnera - to jest widok sekcji
// „Partnerzy”, nie pas na stronie głównej, więc żaden z nich nie zastępuje
// drugiego i żaden nie kopiuje kodu drugiego.
//
// KOMPONENT NIE ZAKŁADA ZALOGOWANEGO: `event_sponsors_public` ma GRANT dla
// `anon`, a migawka partnerów nie zależy od tego, kto patrzy.
import { useTranslation } from "react-i18next";

import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { usePublicEventSponsors } from "@/lib/events/usePublicEvent";
import { SponsorLogo } from "@/components/events/public/atoms/SponsorLogo";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
import type { PublicSponsor, PublicSponsorTier } from "@/lib/events/sponsorsSurface";

ensureEventFrontI18n();

export function EventSponsorTiers({ slug, enabled = true }: { slug: string; enabled?: boolean }) {
  const { i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const sponsorsQuery = usePublicEventSponsors(slug, enabled);
  const tiers = sponsorsQuery.data ?? [];

  // WCZYTYWANIE, BŁĄD I BRAK PARTNERÓW WYCHODZĄ TĄ SAMĄ FURTKĄ - nic w DOM-ie.
  // Pas partnerów nie ma własnego nagłówka, więc nie ma do czego przypiąć ani
  // szkieletu, ani komunikatu o błędzie; a ten sam klucz zapytania rysuje
  // sekcja „Partnerzy”, która nagłówek MA i tam awaria jest widoczna raz,
  // zamiast dwa razy na jednej stronie.
  if (tiers.length === 0) return null;

  return (
    <div className="mt-8 space-y-8">
      {tiers.map((tier) => (
        <SponsorTierRow key={tier.tierId ?? "no-tier"} tier={tier} lang={lang} />
      ))}
    </div>
  );
}

function SponsorTierRow({ tier, lang }: { tier: PublicSponsorTier; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const tierName = pickLocalized(
    { name_pl: tier.namePl, name_en: tier.nameEn },
    "name",
    lang,
    t("eventFront.sponsors.noTier"),
  );

  return (
    <section className="space-y-4">
      {/* Nagłówek poziomu NIE bierze `tier.accentColor`, choć kolumna go ma:
          tutaj to napis na tle strony, więc obu stron kontrastu nie kontrolujemy
          (przy krążku ikony kontrolujemy oba). Kafle w sekcji „Partnerzy” mogą
          sobie na akcent pozwolić, bo tam nagłówek jest wewnątrz karty i to
          jedyne miejsce, gdzie ten kolor niesie treść umowy. */}
      <h3 className="text-sm font-semibold text-foreground">{tierName}</h3>
      <ul className="flex flex-wrap items-center justify-around gap-x-8 gap-y-6">
        {tier.sponsors.map((sponsor) => (
          <li key={sponsor.id} className="flex items-center justify-center">
            <SponsorTierLogo sponsor={sponsor} tier={tier} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SponsorTierLogo({ sponsor, tier }: { sponsor: PublicSponsor; tier: PublicSponsorTier }) {
  const { t } = useTranslation();

  // NAZWA FIRMY WCHODZI OSOBNO, BO W RZĘDZIE JEJ NIE WIDAĆ. `SponsorLogo`
  // celowo daje obrazkowi pusty `alt` (w kaflu nazwa stoi obok w tekście), więc
  // w tym układzie sam logotyp byłby dla czytnika ekranu pustym miejscem.
  // Role rozdajemy więc odwrotnie niż w kaflu: logotyp - razem z jego tekstową
  // degradacją - idzie pod `aria-hidden`, a nazwa leci raz, tekstem dla czytnika.
  // Bez tego pozycja bez logotypu przeczytałaby nazwę dwa razy.
  const logo = (
    <span aria-hidden="true" className="flex items-center justify-center">
      <SponsorLogo name={sponsor.name} logoUrl={sponsor.logoUrl} size={tier.logoSize} />
    </span>
  );

  if (sponsor.websiteUrl === null) {
    return (
      <span className="flex items-center justify-center px-2">
        {logo}
        <span className="sr-only">{sponsor.name}</span>
      </span>
    );
  }

  return (
    <a
      href={sponsor.websiteUrl}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="flex items-center justify-center rounded-[6px] px-2 py-1 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {logo}
      {/* Nazwa odnośnika mówi, GDZIE prowadzi - „New European Strategies” bez
          reszty zdania brzmi w czytniku jak nagłówek, nie jak wyjście na zewnątrz. */}
      <span className="sr-only">
        {t("eventFront.sponsorTiers.partnerSite", { name: sponsor.name })}
      </span>
    </a>
  );
}
