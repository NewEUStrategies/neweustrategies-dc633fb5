// Organizm: zakładka „Partnerzy" (`/events/<slug>/partners`) - ściana logotypów
// pogrupowana po poziomie, z oknem instytucji po kliknięciu w kafel.
//
// OSOBNY RYSUNEK ZAKŁADKI, TA SAMA KOLEJNOŚĆ I TEN SAM ROZMIAR. Sekcja
// „Partnerzy" na przeglądzie zostaje przy `EventSponsorsSectionView` (wzorce
// znaczników strony głównej są zamrożone w testach). Zakładka bierze z niej to,
// co jest treścią umowy - kolejność poziomów i szerokość kafla z `logo_size` -
// a zdejmuje z kafla to, co w siatce było szumem: plakietki, opis i odnośnik
// „Strona partnera". Opis, stronę, stoisko, osoby z instytucji i wspierane
// sesje pokazuje okno (`DirectoryCompanyView`), więc kafel niesie tylko znak,
// nazwę i jedną linię roli.
//
// CAŁY KAFEL OTWIERA OKNO, ALE PRZYCISKIEM JEST NAZWA. Wzorzec rozciągniętego
// przycisku (jak karta prelegenta): `::after` nazwy przykrywa kafel, więc klik
// w logotyp trafia w ten sam przycisk, a rola, stoisko i plakietka szkicu
// zostają ZWYKŁYM tekstem pozycji listy - nazwa dostępna przycisku zastąpiłaby
// je dla czytnika ekranu, gdyby stały w jego środku.
//
// POMIAR DLA RAPORTU SPONSORA BEZ ZMIAN W ZNACZENIU. Wyświetlenie liczy każdy
// kafel (`li`) pod `partners_tab`; kliknięcie to nadal wyjście na stronę
// partnera - dziś z okna, które liczy je pod tym samym miejscem
// (`sponsorPlacement` dostawcy). Samo otwarcie okna kliknięciem NIE jest,
// bo raport definiuje klik jako wyjście do partnera, a nie zaciekawienie.
//
// BEZ DOSTAWCY OKIEN (podgląd studia, zanim dostanie własnego) kafel jest
// tekstem bez ruchu przy najechaniu - kafel, który drgnie pod kursorem, obiecuje
// okno, którego nie ma.
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { EventOrgLogo } from "@/components/events/public/atoms/EventOrgLogo";
import {
  DirectoryCompanyTrigger,
  EventDirectoryProvider,
  useEventDirectory,
} from "@/components/events/public/directory/EventDirectoryContext";
import { directoryOrgKey } from "@/lib/events/eventDirectory";
import {
  sponsorRoleKey,
  type PublicSponsor,
  type PublicSponsorTier,
  type SponsorLogoSize,
} from "@/lib/events/sponsorsSurface";
import { useSponsorImpression } from "@/lib/events/sponsorTrackingReact";
import { usePublicEventDirectory } from "@/lib/events/usePublicEventDirectory";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { cn } from "@/lib/utils";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

/**
 * Najwęższy kafel poziomu - „złoty" ma być szerszy niż „brązowy", tak jak
 * w sekcji na przeglądzie. Węższe progi niż tam, bo kafel nie niesie już
 * plakietek: dwa kafle `md` mieszczą się obok siebie na telefonie.
 */
const MIN_TILE: Record<SponsorLogoSize, string> = {
  sm: "8rem",
  md: "10rem",
  lg: "14rem",
};

/** Margines bieli wokół znaku rośnie z kaflem - logotyp nie dotyka ramki na żadnym poziomie. */
const LOGO_PADDING: Record<SponsorLogoSize, string> = {
  sm: "p-4",
  md: "p-5",
  lg: "p-8",
};

/**
 * Znak w kaflu: wspólny `EventOrgLogo` (ten sam znak firmy w oknie i na innych
 * zakładkach) wypełniający ramkę 3:2. Ramkę niesie kafel, a znak bez ramki
 * rośnie o 3% wewnątrz niej - na białej podkładce widać ruch samego logotypu,
 * nie całego pudła.
 *
 * PROPORCJA NA RAMCE, ZNAK `absolute inset-0`. Wysokość z `aspect-ratio` na
 * elemencie siatki nie jest „określona" dla procentów dziecka, więc obraz
 * `size-full` liczył się z własnych proporcji i wypadał pod środek kafla;
 * pozycjonowanie bezwzględne daje mu pudło o znanej wysokości.
 */
const LOGO_CLASS =
  "absolute inset-0 h-full w-full rounded-none border-0 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03] motion-reduce:transition-none";

/**
 * SAM RYSUNEK zakładki - bez zapytania i bez własnego dostawcy okien.
 *
 * Dostawcę daje wołający: zakładka publiczna (`EventPartnersTab`) albo podgląd
 * studia. `draftLabel` = napis plakietki przy przypięciu nieogłoszonym - podaje
 * go tylko podgląd (słownik panelu nie wchodzi do paczki strony publicznej).
 */
export function EventPartnersTabView({
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
    <div className="space-y-12">
      {tiers.map((tier) => (
        <PartnerTier
          key={tier.tierId ?? "no-tier"}
          tier={tier}
          lang={lang}
          draftLabel={draftLabel}
        />
      ))}
    </div>
  );
}

/**
 * Zakładka publiczna: dostawca okien wokół rysunku.
 *
 * KATALOG DOSTAJE LISTĘ, KTÓRĄ ZAKŁADKA JUŻ MA (`own.sponsorTiers`), więc hook
 * nie pyta o partnerów drugi raz. Prelegenci i program (osoby z instytucji,
 * wspierane sesje) śpią do pierwszego sygnału zamiaru - najechania albo fokusu
 * na kaflu.
 */
export function EventPartnersTab({
  slug,
  tiers,
}: {
  slug: string;
  tiers: readonly PublicSponsorTier[];
}) {
  const { i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [enrich, setEnrich] = useState(false);
  // Stała referencja: dostawca trzyma `prime` w `useCallback` po `onActivate`.
  const activate = useCallback(() => setEnrich(true), []);
  const { directory, eventId } = usePublicEventDirectory({
    slug,
    lang,
    enrich,
    own: { sponsorTiers: tiers },
  });
  return (
    <EventDirectoryProvider
      directory={directory}
      slug={slug}
      eventId={eventId}
      sponsorPlacement="partners_tab"
      onActivate={activate}
    >
      <EventPartnersTabView tiers={tiers} />
    </EventDirectoryProvider>
  );
}

function PartnerTier({
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
    <section>
      <header className="mb-6">
        {/* Nadtytuł, włosowa linia, licznik: hierarchię niesie typografia.
            Akcent poziomu zostaje kropką - kolor umowy na całym nagłówku
            krzyczał głośniej niż logotypy, które poziom ma wyróżniać. */}
        <div className="flex items-center gap-4">
          <h2 className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase leading-4 tracking-[0.14em] text-foreground">
            {tier.accentColor === null ? null : (
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: tier.accentColor }}
              />
            )}
            {tierName}
          </h2>
          <span aria-hidden="true" className="h-px flex-1 bg-border/70" />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t("eventFront.directory.partnersCount", { count: tier.sponsors.length })}
          </span>
        </div>
        {tierDescription !== "" && (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {tierDescription}
          </p>
        )}
        {/* Korzyści pakietu to zdanie, nie zestaw przycisków - obramowane
            plakietki wyglądały na filtry, które da się kliknąć. */}
        {tier.benefits.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground">
            <li className="sr-only">{t("eventFront.sponsors.benefitsLabel")}</li>
            {tier.benefits.map((benefit, index) => (
              <li key={benefit.id} className="flex items-center gap-2">
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                {pickLocalized(
                  { label_pl: benefit.labelPl, label_en: benefit.labelEn },
                  "label",
                  lang,
                )}
              </li>
            ))}
          </ul>
        )}
      </header>

      {/* `auto-fill`, nie `auto-fit`: samotny partner poziomu zostaje kaflem
          swojej szerokości, zamiast rozlać się w białą płytę przez całą
          kolumnę. `min(…, 100%)` - kafel nie wychodzi poza wąski ekran. */}
      <ul
        className="grid gap-x-4 gap-y-6 sm:gap-x-6"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(min(${MIN_TILE[tier.logoSize]}, 100%), 1fr))`,
        }}
      >
        {tier.sponsors.map((sponsor) => (
          <PartnerTile
            key={sponsor.id}
            sponsor={sponsor}
            logoSize={tier.logoSize}
            draftLabel={draftLabel}
          />
        ))}
      </ul>
    </section>
  );
}

function PartnerTile({
  sponsor,
  logoSize,
  draftLabel,
}: {
  sponsor: PublicSponsor;
  logoSize: SponsorLogoSize;
  draftLabel: string | undefined;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLLIElement | null>(null);
  useSponsorImpression(ref, { sponsorId: sponsor.id, placement: "partners_tab" });
  const directory = useEventDirectory();
  const orgKey = directory === null ? null : directoryOrgKey(sponsor.name);
  // Plakietka tylko przy OBU warunkach - patrz `EventSponsorsSectionView`.
  const draft = sponsor.isDraft === true && draftLabel !== undefined;
  const meta = [
    t(sponsorRoleKey(sponsor.role)),
    sponsor.boothLabel === null
      ? ""
      : t("eventFront.sponsors.boothLabel", { label: sponsor.boothLabel }),
  ].filter((part) => part !== "");

  return (
    <li ref={ref} className={cn("relative min-w-0", orgKey !== null && "group")}>
      <span className="relative block aspect-[3/2] overflow-hidden rounded-[6px] border border-border bg-white transition-colors duration-300 group-hover:border-brand/60">
        <EventOrgLogo
          name={sponsor.name}
          logoUrl={sponsor.logoUrl}
          size="lg"
          className={cn(LOGO_CLASS, LOGO_PADDING[logoSize], draft && "opacity-60")}
        />
      </span>
      <DirectoryCompanyTrigger
        orgKey={orgKey}
        name={sponsor.name}
        logoUrl={sponsor.logoUrl}
        label={t("eventFront.directory.openCompany", { name: sponsor.name })}
        className={cn(
          "mt-3 block break-words text-sm font-medium leading-snug text-foreground",
          orgKey !== null && "rounded-[6px] after:absolute after:inset-0",
        )}
      >
        {sponsor.name}
      </DirectoryCompanyTrigger>
      <span className="mt-1 block text-xs leading-5 text-muted-foreground">{meta.join(" · ")}</span>
      {/* Napis plakietki jest TEKSTEM pozycji, poza przyciskiem - czytnik
          ekranu słyszy „nieogłoszony" tak samo, jak widzący go widzi. */}
      {draft && (
        <Badge variant="outline" className="mt-2">
          {draftLabel}
        </Badge>
      )}
    </li>
  );
}
