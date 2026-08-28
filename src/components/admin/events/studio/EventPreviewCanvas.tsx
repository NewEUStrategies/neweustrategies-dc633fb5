// Podglad strony wydarzenia - to, co zobaczy uczestnik po publikacji.
//
// DLACZEGO RYSUJEMY, A NIE OSADZAMY `<iframe>` STRONY PUBLICZNEJ. Podglad ma
// pokazywac WERSJE ROBOCZA - tytul, ktory redaktor wlasnie wpisuje, i kolor,
// ktory wlasnie wybral. Ramka z adresem publicznym pokazuje stan ZAPISANY
// i odswieza sie dopiero po zapisie, czyli odpowiada na pytanie, ktorego nikt
// nie zadaje. Rysunek z tego samego szkicu, ktory karmi formularz, jest jedynym
// sposobem, zeby podglad byl „na zywo”.
//
// TEN PLIK NIE MA WLASNEGO UKLADU I NIE MOZE GO ODZYSKAC. Poprzednia wersja
// deklarowala, ze „montuje prawdziwe komponenty publiczne”, i faktycznie
// montowala trzy (`EventBrandingStyle`, `EventVideoHeader`, `EventPageSections`)
// - a UKLAD rysowala sama: jedna kolumna `max-w-3xl`, wlasny `<h1>` (`text-4xl`
// przy `text-3xl` na stronie), wlasna karta `<dl>` w dwoch kolumnach (strona ma
// jedna), wlasna kopia kafli podstron i ZERO paska zakladek. Wlasciciel zobaczyl
// wiec w studiu „stary layout”, mimo ze nowy byl na `main` - bo w repozytorium
// staly DWA niezalezne rysunki tej samej strony (ryzyko nr 1 z
// `docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` §9.1), a bramka parytetu
// porownywala tylko LISTE IMPORTOW, czyli swiecila na zielono przy rozjechanym
// ukladzie. Teraz uklad wnosza:
//   * `EventPortalShell` - zakres brandingu, powrot, nazwa, slot paska zakladek,
//   * `EventTabsBar` - listwa paska zakladek,
//   * `EventOverviewLayout` - siatka 1 : 2 : 1 razem z `EventOverviewTitle`
//     i `EventOverviewDescription`,
//   * `EventMetaCard` / `EventMetaRow` - karta „kiedy, gdzie”,
//   * `EventMenuTiles` - kafle podstron w trybie `grid`,
//   * `EventSectionLinks` - wiersze sekcji strony glownej w trybie `list`
//     (krazek z ikona, etykieta, szewron) - to jest tresc wzorca ze zrzutu 38,
//   * `EventViewerCard` - karta profilu zalogowanego widza w lewej kolumnie,
//   * `EventPortalContent` - miara kolumny tresci podstrony.
// Bramka `eventPreviewPublicParity.gate.test.tsx` RENDERUJE oba miejsca
// i asertuje te same znaczniki powloki i siatki, a dodatkowo czerwieni sie na
// samym ZRODLE tego pliku, jesli wroci do niego wlasny `max-w-3xl`, `grid-cols-`,
// `<h1` albo lokalny wiersz karty meta.
//
// BRANDING JEDZIE PRAWDZIWYM MECHANIZMEM, nie druga paleta. Kolory wchodza tak
// samo jak na stronie publicznej: `EventPortalShell` zamyka je atrybutem zakresu
// i sklada zmienne przez `EventBrandingStyle`. Dlatego PUSTY SLOT dziedziczy
// motyw dokladnie tak, jak odziedziczy go uczestnik - wlasna tablica wartosci
// zapasowych klamalaby przy pierwszej zmianie motywu.
//
// CO W PODGLADZIE JEST INNE NIZ NA STRONIE - I DLACZEGO KAZDA ROZNICA JEST
// MECHANICZNA, A NIE GUSTOWA:
//   * POWROT, NAZWA I POZYCJE PASKA SA NAPISAMI, nie odnosnikami: klik
//     wyprowadzilby redaktora ze studia w trakcie edycji, a `<Link>` bez
//     `RouterProvider` po prostu rzuca (podglad zyje poza drzewem tras);
//   * KONTROLKA ZAPISU jest atrapa wygladu: `EventRegistrationSurface` dostaje
//     zdanie policzone z dostepu WOLAJACEGO (warstwa, okno zapisow, komplet
//     miejsc), a szkic niepublikowanego wydarzenia takiego dostepu nie ma.
//     Zamiast fabrykowac decyzje reguly, podglad pokazuje sam przycisk
//     w kolorze akcji - i dlatego jest `span`, ktory nie zabiera skupienia
//     z formularza;
//   * POZYCJE PASKA I SPISU SEKCJI ida z `admin_event_pages_list`, nie
//     z `event_menu`: publiczne RPC ma w ciele `AND e.status = 'published'`,
//     wiec na szkicu oddaloby pustke. RPC panelu czyta te same wiersze
//     `event_pages` (te same ikony i te same kolory - z `_event_default_pages()`)
//     i DOSIEWA brakujace strony modulowe na wejsciu, wiec podglad dostaje
//     PRAWDZIWA piatke, a nie jej kopie wpisana na sztywno w kliencie. Model
//     wypelnia rama studia (`EventStudioShell`), nie ta kanwa - kanwa nie ma
//     prawa odpalic zapytania.
//   * WIDZ WCHODZI PROPEM `viewer`, nie modelem: model to szkic WYDARZENIA,
//     a tozsamosc ogladajacego nalezy do sesji. Czyta ja nakladka podgladu
//     (`EventStudioPreview`) tym samym hookiem, co strona publiczna.
//
// CZEGO NIE DA SIE ZAMONTOWAC I DLACZEGO - lista z powodami stoi w bramce
// (`COMPONENT_EXCEPTIONS`), bo tam jest egzekwowana. W skrocie: powierzchnie,
// ktore same wolaja baze albo tozsamosc wolajacego, na szkicu nie maja z czego
// sie wyrenderowac. Lista sekcji przekazywanych do `EventPageSections` konczy
// sie wiec na tych, ktorych tresc niesie szkic - `PREVIEW_SECTION_KEYS`.
//
// KANWA MA STALA SZEROKOSC WIRTUALNA, a skaluje ja rodzic (`transform: scale`).
// Dzieki temu proporcje typografii i odstepow sa takie jak na prawdziwym
// ekranie - podglad rysowany „responsywnie” w waskim panelu pokazywalby uklad
// mobilny i klamalby o wygladzie na komputerze. Szerokosc i tlo jada na TYM
// SAMYM elemencie, co zakres brandingu (`EventPortalShell` przyjmuje `style`
// i `className`), bo tlo narysowane poza zakresem brakloby kolorow wydarzenia.
//
// OGRANICZENIE PUNKTOW ZALAMANIA. Klasy `sm:` i `lg:` komponentow publicznych
// czytaja szerokosc OKNA, a nie szerokosc kanwy, wiec widok telefonu pokazuje
// wierne przelamania tekstu, ale siatki zostaja w ukladzie z komputera.
// Naprawa nalezy do strony publicznej (przejscie na zapytania kontenerowe),
// nie do podgladu - druga siatka liczona tutaj to znowu drugi silnik.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CalendarDays, Clock, Globe, MapPin } from "@/lib/lucide-shim";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { eventBrandingPayload } from "@/lib/events/eventBrandingDraft";
import {
  EVENT_SECTION_KEYS,
  type EventSection,
  type EventSectionKey,
} from "@/lib/events/eventSections";
import { EVENT_PRACTICAL_SECTIONS, type EventPracticalInfo } from "@/lib/events/eventPractical";
import { formatEventDateTime, eventTimeZoneLabel } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import type { PublicSponsorTier } from "@/lib/events/sponsorsSurface";
import { EventPortalContent } from "@/components/events/public/atoms/EventPortalContent";
import { EventMetaCard, EventMetaRow } from "@/components/events/public/molecules/EventMetaCard";
import {
  EventMenuTileBody,
  EventMenuTiles,
  eventMenuTileClass,
} from "@/components/events/public/molecules/EventMenuTiles";
import {
  EventSectionLinkBody,
  EventSectionLinks,
  EVENT_SECTION_LINK_CLASS,
} from "@/components/events/public/molecules/EventSectionLinks";
import { EventViewerCard } from "@/components/events/public/molecules/EventViewerCard";
import {
  EventTabsBar,
  EVENT_TAB_ACTIVE_CLASS,
  EVENT_TAB_CLASS,
  EVENT_TAB_INACTIVE_CLASS,
} from "@/components/events/public/molecules/EventTabsBar";
import { EventVideoHeader } from "@/components/events/public/molecules/EventVideoHeader";
import {
  EventOverviewDescription,
  EventOverviewLayout,
  EventOverviewTitle,
} from "@/components/events/public/organisms/EventOverviewLayout";
import { EventPageSections } from "@/components/events/public/organisms/EventPageSections";
import { EventPortalShell } from "@/components/events/public/organisms/EventPortalShell";
import { EventSponsorTiersView } from "@/components/events/public/organisms/EventSponsorTiers";
import { BuilderRenderer } from "@/components/builder/organisms/BuilderRenderer";
import {
  EventPreviewLiveModule,
  EMPTY_PREVIEW_LIVE_DATA,
  type EventPreviewLiveData,
} from "@/components/admin/events/studio/EventPreviewLiveModule";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
import { ensureI18n as ensureEventMeI18n } from "@/lib/i18n-cart";
import { PreviewMePanel } from "@/components/admin/events/studio/PreviewMePanel";
import type { ViewerCardFacts } from "@/lib/profile/useViewerCard";
import type { EventPreviewModel } from "@/components/admin/events/studio/EventStudioPreviewContext";

/** Szerokosci wirtualne kanwy - rzeczywiste punkty zalamania strony publicznej. */
export const PREVIEW_WIDTHS = { desktop: 1240, mobile: 390 } as const;
export type PreviewDevice = keyof typeof PREVIEW_WIDTHS;

/**
 * Sekcje strony publicznej, ktore podglad umie oddac PRAWDZIWYM komponentem.
 *
 * LISTA NIE JEST PISANA RECZNIE. Sekcje praktyczne (`map`, `contact`) sa
 * dokladnie tymi, ktorych tresc siedzi w kolumnach wydarzenia, czyli i w szkicu
 * formularza - reszta wola baze. Wskazanie na `EVENT_PRACTICAL_SECTIONS` znaczy,
 * ze trzecia taka sekcja wejdzie do podgladu razem z dodaniem jej do reguly,
 * a nie po zauwazeniu braku na publikacji.
 */
export const PREVIEW_SECTION_KEYS: readonly EventSectionKey[] = EVENT_PRACTICAL_SECTIONS;

/**
 * Sekcja podgladu w kszalcie modelu strony publicznej.
 *
 * NADPISANIA NAGLOWKA I ZAMKI NALEZA DO BAZY, ktorej szkic nie zna - naglowek
 * bierze sie wiec ze slownika (`headingPl/En = null`), a sekcja jest otwarta.
 * `sortOrder` liczy sie z kolejnosci slownika sekcji, zeby podglad ustawil je
 * tak, jak ustawia je `_event_default_sections()`.
 */
function previewSection(key: EventSectionKey): EventSection {
  return {
    key,
    sortOrder: (EVENT_SECTION_KEYS as readonly string[]).indexOf(key),
    headingPl: null,
    headingEn: null,
    visibility: "public",
    minTierRank: 0,
    isLocked: false,
    lockReason: "none",
    hasContent: null,
  };
}

export function EventPreviewCanvas({
  model,
  device,
  viewer = null,
  sponsorTiers = [],
  onNavigate,
  live = EMPTY_PREVIEW_LIVE_DATA,
}: {
  model: EventPreviewModel;
  device: PreviewDevice;
  /**
   * PARTNERZY WYDARZENIA, poziomami, w kolejnosci strony publicznej.
   *
   * OSOBNY PROP, JAK `viewer`: to nie jest szkic formularza, tylko stan bazy -
   * przypiecia partnerow zapisuje osobny ekran studia. Publiczne
   * `event_sponsors_public` bramkuje `status = 'published'`, wiec szkic
   * dostalby pustke; nakladka wnosi wiec wiersze z RPC panelu przez
   * `sponsorTiersFromAdminRows`. Pusta lista = pas nie wchodzi do DOM,
   * dokladnie jak na stronie bez partnerow.
   */
  sponsorTiers?: readonly PublicSponsorTier[];
  /**
   * Fakty o ZALOGOWANYM REDAKTORZE do karty profilu w lewej kolumnie.
   *
   * OSOBNY PROP, A NIE POLE MODELU, bo to nie jest szkic wydarzenia: model
   * niesie WYLACZNIE to, co redaktor wpisuje w formularzu, a widz jest
   * wlasnoscia sesji. Wnosi go `EventStudioPreview` przez `useViewerCardFacts`
   * - ten sam hook, ktorego uzywa strona publiczna - bo kanwa nie ma prawa
   * odpalic zapytania (rysuje szkic, nie stan bazy).
   *
   * `null` = brak sesji albo wiersz profilu w drodze; karty wtedy nie ma,
   * dokladnie jak dla gosca na stronie publicznej.
   */
  viewer?: ViewerCardFacts | null;
  /**
   * PRZEJSCIE MIEDZY STRONAMI WEWNATRZ PODGLADU.
   *
   * Podglad ma zachowywac sie jak publikacja, wiec pasek zakladek, kafle
   * i wiersze sekcji sa KLIKALNE - tylko celem nie jest trasa routera (klik
   * wyprowadzilby redaktora ze studia i zgubil niezapisany szkic), lecz stan
   * nakladki: `null` = strona glowna, pozycja = jej podstrona. Brak handlera
   * zostawia rysunek statyczny (bramka parytetu renderuje kanwe bez sesji).
   */
  onNavigate?: (target: { key: string; pageId: string } | null) => void;
  /**
   * PRAWDZIWE DANE PODSTRON MODULOWYCH - program, prelegenci, uczestnicy.
   *
   * OSOBNY PROP, JAK `sponsorTiers`: to nie jest szkic formularza, tylko stan
   * bazy, ktorego publiczne projekcje odmawiaja szkicowi (`AND e.status =
   * 'published'`). Wnosi je nakladka RPC panelu, a rysuje `EventPreviewLiveModule`
   * TYMI SAMYMI kartami, co strona publiczna.
   */
  live?: EventPreviewLiveData;
}) {
  ensureAdminEventsI18n();
  ensureCommunityI18n();
  ensureEventFrontI18n();
  ensureEventMeI18n();
  const { t, i18n } = useTranslation();
  // „Moj profil" nie jest podstrona organizatora (`event_menu` jej nie zna),
  // wiec stan tej zakladki zyje TU, obok stanu nakladki - klik w dowolna
  // pozycje z bazy wraca do rysunku strony publicznej.
  const [showMe, setShowMe] = useState(false);
  const lang = uiLang(i18n.language);

  const title =
    (lang === "en" ? model.titleEn || model.titlePl : model.titlePl || model.titleEn) ||
    t("adminEvents.studio.preview.untitled");
  const description =
    lang === "en"
      ? model.descriptionEn || model.descriptionPl
      : model.descriptionPl || model.descriptionEn;
  const dateLabel = formatEventDateTime(model.startsAt, model.timezone, lang);
  const endLabel =
    model.endsAt === "" ? "" : formatEventDateTime(model.endsAt, model.timezone, lang);
  const zoneLabel = eventTimeZoneLabel(model.startsAt, model.timezone, lang);
  const isGrid = model.pagesDisplayMode === "grid";

  // Adres wchodzi JEDNYM CZLONEM, bo szkic niesie go juz zlozonego - sklada go
  // `eventAddressLine`, ta sama funkcja, ktora sklada adres strony publicznej.
  // Rozbijanie napisu z powrotem na kolumny byloby odgadywaniem, a `map` i tak
  // czyta z tych czlonow wylacznie jedna linie.
  const practical: EventPracticalInfo = {
    streetAddress: model.addressLine,
    languages: model.languages,
    socialHashtag: model.hashtag,
    supportEmail: model.supportEmail,
  };

  // PODSTRONA WYGRYWA Z STRONA GLOWNA. Redaktor, ktory kliknal wiersz „Program",
  // pyta o tresc TEJ strony - dopisanie jej pod metadanymi wydarzenia dawaloby
  // rysunek, ktory nie odpowiada zadnemu adresowi publicznemu.
  const page = model.selectedPage;

  return (
    <EventPortalShell
      branding={eventBrandingPayload(model.branding)}
      style={{ width: PREVIEW_WIDTHS[device] }}
      className="bg-background font-sans text-foreground"
      backSlot={
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("community.events.backToList")}
        </span>
      }
      titleSlot={<span className="text-sm font-semibold text-foreground">{title}</span>}
      // PUSTE MENU = ZERO PASKA, tak samo jak `EventTabsNav:60`. Wydarzenie bez
      // ani jednej widocznej podstrony nie dostaje na stronie paska z jedna
      // pozycja („Strona glowna" sama nie jest nawigacja), wiec podglad, ktory
      // by go pokazal, obiecywalby chrome, ktorego po publikacji nie bedzie.
      tabsSlot={
        model.menu.length === 0 ? null : (
          <EventTabsBar label={t("eventFront.header.tabsLabel")}>
            <li>
              {/* WYBOR TROJDZIELNY, a nie `&&`: klasa bazowa nie ma juz koloru
                napisu (patrz `EventTabsBar`), wiec pozycja NIEBIEZACA musi
                dostac `EVENT_TAB_INACTIVE_CLASS` JAWNIE. Napis w podgladzie nie
                jest `Link`-iem, wiec `inactiveProps` routera tu nie dojada -
                tu wybor robi `cn`. Bez tego wiersza podglad rysowalby zakladki
                w kolorze DZIEDZICZONYM i rozjechalby sie ze strona publiczna. */}
              <PreviewNavItem
                className={cn(
                  EVENT_TAB_CLASS,
                  page === null ? EVENT_TAB_ACTIVE_CLASS : EVENT_TAB_INACTIVE_CLASS,
                )}
                onActivate={
                  onNavigate === undefined
                    ? undefined
                    : () => {
                        setShowMe(false);
                        onNavigate(null);
                      }
                }
              >
                {t("eventFront.header.tabs.overview")}
              </PreviewNavItem>
            </li>
            {model.menu.map((item) => (
              <li key={item.key}>
                {/* Pozycje aktywna poznajemy po IDENTYFIKATORZE, nie po etykiecie.
                  Etykieta jest redagowalna i nie jest unikalna, wiec dwie
                  podstrony o tej samej nazwie zaznaczalyby sie obie - patrz
                  `EventPreviewPage.key`. */}
                <PreviewNavItem
                  className={cn(
                    EVENT_TAB_CLASS,
                    page !== null && page.key === item.key
                      ? EVENT_TAB_ACTIVE_CLASS
                      : EVENT_TAB_INACTIVE_CLASS,
                  )}
                  onActivate={
                    onNavigate === undefined
                      ? undefined
                      : () => {
                          setShowMe(false);
                          onNavigate({ key: item.key, pageId: item.pageId });
                        }
                  }
                >
                  {item.label}
                </PreviewNavItem>
              </li>
            ))}
            {/* Prywatna zakladka uczestnika - na stronie publicznej rysuje ja
                `EventTabsNav` dla zalogowanego. W podgladzie stoi zawsze, bo
                organizator ma widziec, ze uczestnik ja dostanie. */}
            <li>
              <PreviewNavItem
                className={cn(
                  EVENT_TAB_CLASS,
                  showMe ? EVENT_TAB_ACTIVE_CLASS : EVENT_TAB_INACTIVE_CLASS,
                )}
                onActivate={() => setShowMe(true)}
              >
                {t("eventMe.tab")}
              </PreviewNavItem>
            </li>
          </EventTabsBar>
        )
      }
    >
      {showMe ? (
        <PreviewMePanel />
      ) : page === null ? (
        <EventOverviewLayout
          main={
            <>
              <EventVideoHeader
                title={title}
                coverUrl={model.coverUrl}
                videoPlatform={model.videoPlatform}
                videoId={model.videoId}
              />

              <EventOverviewTitle>{title}</EventOverviewTitle>

              {description === "" ? null : (
                <EventOverviewDescription>{description}</EventOverviewDescription>
              )}

              {/* TRYB ROZSTRZYGA TEN SAM WARUNEK, CO NA STRONIE PUBLICZNEJ
                  (`events.$slug.index.tsx`: `pages_display_mode === "grid"`).
                  Do tej zmiany podglad rysowal TU KAFLE ZAWSZE, a strona
                  w trybie `list` - czyli domyslnym - rysuje wiersze z krazkami
                  i szewronem (wzorzec, zrzut 38). Redaktor widzial wiec
                  w podgladzie inny spis, niz dostanie uczestnik. Rysunek jest
                  w obu miejscach ten sam: `EventMenuTiles` albo
                  `EventSectionLinks`, roznia sie wylacznie opakowaniem pozycji
                  (`<Link>` na stronie, `<span>` tutaj). */}
              {model.menu.length === 0 ? null : isGrid ? (
                <EventMenuTiles label={t("eventFront.menu.label")} grid>
                  {model.menu.map((item) => (
                    <li key={item.key}>
                      <PreviewNavItem
                        className={eventMenuTileClass(true)}
                        onActivate={
                          onNavigate === undefined
                            ? undefined
                            : () => onNavigate({ key: item.key, pageId: item.pageId })
                        }
                      >
                        <EventMenuTileBody icon={item.icon} color={item.color} label={item.label} />
                      </PreviewNavItem>
                    </li>
                  ))}
                </EventMenuTiles>
              ) : (
                <EventSectionLinks label={t("eventFront.homeSections.label")}>
                  {model.menu.map((item) => (
                    <li key={item.key}>
                      <PreviewNavItem
                        className={EVENT_SECTION_LINK_CLASS}
                        onActivate={
                          onNavigate === undefined
                            ? undefined
                            : () => onNavigate({ key: item.key, pageId: item.pageId })
                        }
                      >
                        <EventSectionLinkBody
                          icon={item.icon}
                          color={item.color}
                          label={item.label}
                        />
                      </PreviewNavItem>
                    </li>
                  ))}
                </EventSectionLinks>
              )}

              {/* Dojazd i kontakt rysuje TEN SAM organizm, co strona publiczna -
                  razem z naglowkami, kolejnoscia i odsiewaniem pustych sekcji. */}
              <EventPageSections
                slug={model.slug}
                sections={PREVIEW_SECTION_KEYS.map(previewSection)}
                practical={practical}
              />

              {/* PAS PARTNEROW - ten sam rysunek, co na stronie publicznej,
                  tylko zrodlem wierszy jest RPC panelu (patrz `sponsorTiers`).
                  Bez tego redaktor ustawial poziomy i logotypy „na slepo". */}
              <EventSponsorTiersView tiers={sponsorTiers} />
            </>
          }
          left={
            <>
              {/* KARTA PROFILU WIDZA STOI NA GORZE LEWEJ KOLUMNY - tak jak na
                  wzorcu (zrzut 38). W studiu widzem jest zalogowany redaktor,
                  wiec to nie jest atrapa: te same fakty, ten sam hook
                  (`useViewerCardFacts`) i ten sam rysunek (`EventViewerCard`),
                  co na stronie publicznej. Rozni sie wylacznie „Edytuj":
                  na stronie `<Link>`, tutaj napis - patrz naglowek pliku. */}
              {viewer === null ? null : (
                <EventViewerCard
                  name={viewer.name}
                  jobTitle={viewer.jobTitle}
                  company={viewer.company}
                  avatarUrl={viewer.avatarUrl}
                  editSlot={
                    <span className="text-muted-foreground">{t("eventFront.viewer.edit")}</span>
                  }
                />
              )}

              {/* KARTA „KIEDY, GDZIE" ZOSTAJE POD PROFILEM, choc wzorzec jej
                  nie ma. Wzorzec pokazuje wydarzenie, ktorego termin niesie
                  grafika baneru - a u nas termin, strefa czasowa i miejsce sa
                  POLAMI, ktore redaktor wpisuje w „Informacjach ogolnych".
                  Zdjecie tej karty zabralo by jedyne miejsce, w ktorym te
                  pola widac, czyli zamienilo by wierny uklad na utracone dane. */}
              <EventMetaCard>
                <EventMetaRow
                  icon={<CalendarDays className="h-4 w-4" />}
                  label={t("community.events.whenLabel")}
                >
                  {dateLabel === "" ? t("adminEvents.studio.preview.noDate") : dateLabel}
                  {zoneLabel === "" ? null : ` (${zoneLabel})`}
                </EventMetaRow>
                {/* KONIEC WCHODZI OSOBNYM WIERSZEM, a nie doklejony do terminu:
                    to jest drugie pole formularza i jedyny sposob, w jaki
                    redaktor sprawdzi, ze wpisal dobra date zakonczenia. Puste
                    pole = brak wiersza, bez zgadywania czasu trwania. */}
                {endLabel === "" ? null : (
                  <EventMetaRow
                    icon={<Clock className="h-4 w-4" />}
                    label={t("adminEvents.studio.preview.endsLabel")}
                  >
                    {endLabel}
                  </EventMetaRow>
                )}
                <EventMetaRow
                  icon={<Globe className="h-4 w-4" />}
                  label={t("adminEvents.studio.preview.formatLabel")}
                >
                  {t(`eventFront.formats.${model.format}`)}
                </EventMetaRow>
                {model.locationName === "" && model.addressLine === "" ? null : (
                  <EventMetaRow
                    icon={<MapPin className="h-4 w-4" />}
                    label={t("community.events.location")}
                  >
                    {/* Nazwa miejsca i adres to DWIE rozne informacje - „Sala
                        Europa" bez ulicy nie prowadzi nikogo pod drzwi. */}
                    {[model.locationName, model.addressLine]
                      .filter((part) => part !== "")
                      .join(", ")}
                  </EventMetaRow>
                )}
              </EventMetaCard>
            </>
          }
          right={
            <span className={buttonVariants()}>{t("adminEvents.studio.preview.register")}</span>
          }
        />
      ) : (
        <EventPortalContent>
          <div data-testid="event-preview-page">
            {/* SCIEZKA PODSTRONY JEST CHROME'M PODGLADU, nie trescia strony:
                mowi redaktorowi, ktory adres publiczny wlasnie oglada. Naglowka
                `h1` tu NIE MA i miec nie moze - na stronie publicznej niesie go
                DOKUMENT strony modulowej (migracja 20260826181500 zasiewa `h1`
                i zdanie wstepu), wiec wlasny naglowek podgladu dawalby dwa
                tytuly jeden pod drugim. */}
            <p className="font-sans text-xs text-muted-foreground">/{page.path}</p>
            <div className="mt-8">
              {page.document === null ? (
                <p className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
                  {t("adminEvents.studio.preview.pageEmpty")}
                </p>
              ) : (
                // TRESC RYSUJE PUBLICZNY RENDERER, nie kopia ukladu sekcji -
                // inaczej podglad podstrony rozjechalby sie z publikacja przy
                // pierwszej zmianie w builderze.
                <BuilderRenderer doc={page.document} lang={lang} device={device} editorPreview />
              )}
            </div>
            {/* PODSTRONA MODULOWA MA TRESC POZA DOKUMENTEM: program, prelegentow
                i uczestnikow sklada baza, a dokument CMS niesie tylko naglowek
                i zdanie wstepu. Bez tego bloku redaktor widzial w podgladzie sam
                naglowek zakladki „Program" mimo wpisanych sesji. */}
            {page.module !== null && (
              <div className="mt-8">
                <EventPreviewLiveModule module={page.module} data={live} />
              </div>
            )}
          </div>
        </EventPortalContent>
      )}
    </EventPortalShell>
  );
}

/**
 * Pozycja nawigacji podgladu: `button` gdy nakladka daje przejscie, `span` gdy
 * kanwa rysuje statycznie (bramka parytetu, zrzut do dokumentacji).
 *
 * JEDEN KOMPONENT, A NIE WARUNEK W PIECIU MIEJSCACH: klasy sa te same, co na
 * stronie publicznej, wiec wybor znacznika nie moze przy okazji zmieniac
 * wygladu. `w-full text-left` wyrownuje `button` do `Link`-a, ktory na stronie
 * jest elementem blokowym.
 */
function PreviewNavItem({
  className,
  onActivate,
  children,
}: {
  className: string;
  onActivate?: () => void;
  children: React.ReactNode;
}) {
  if (onActivate === undefined) return <span className={className}>{children}</span>;
  return (
    <button type="button" onClick={onActivate} className={cn(className, "w-full text-left")}>
      {children}
    </button>
  );
}
