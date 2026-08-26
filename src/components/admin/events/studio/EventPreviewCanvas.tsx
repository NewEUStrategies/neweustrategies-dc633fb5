// Podglad strony wydarzenia - to, co zobaczy uczestnik po publikacji.
//
// DLACZEGO RYSUJEMY, A NIE OSADZAMY `<iframe>` STRONY PUBLICZNEJ. Podglad ma
// pokazywac WERSJE ROBOCZA - tytul, ktory redaktor wlasnie wpisuje, i kolor,
// ktory wlasnie wybral. Ramka z adresem publicznym pokazuje stan ZAPISANY
// i odswieza sie dopiero po zapisie, czyli odpowiada na pytanie, ktorego nikt
// nie zadaje. Rysunek z tego samego szkicu, ktory karmi formularz, jest jedynym
// sposobem, zeby podglad byl „na zywo”.
//
// TEN PLIK MONTUJE PRAWDZIWE KOMPONENTY PUBLICZNE, NIE ICH KOPIE. Poprzednia
// wersja rysowala wlasny pasek nawigacji, wlasne kafle podstron i wlasna karte
// informacji - czyli w repozytorium stal DRUGI SILNIK STRONY WYDARZENIA
// (ryzyko nr 1 z `docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` §9.1)
// i NIC nie pilnowalo, zeby oba rysunki mowily to samo. Kazda zmiana na
// stronie publicznej cicho rozjezdzala podglad, a rozjazd bylo widac dopiero
// po publikacji. Teraz strone rysuja `EventBrandingStyle`, `EventVideoHeader`
// i `EventPageSections` z `components/events/public/`, a przed powrotem do
// kopii stoi bramka `eventPreviewPublicParity.gate.test.tsx`.
//
// BRANDING JEDZIE PRAWDZIWYM MECHANIZMEM, nie druga paleta. Kolory wchodza tak
// samo jak na stronie publicznej: `EventBrandingStyle` sklada zmienne CSS,
// a atrybut `eventBrandingScopeProps` zamyka je w tym jednym drzewie. Dlatego
// PUSTY SLOT dziedziczy motyw dokladnie tak, jak odziedziczy go uczestnik -
// wlasna tablica wartosci zapasowych klamalaby przy pierwszej zmianie motywu.
//
// CZEGO NIE DA SIE ZAMONTOWAC I DLACZEGO. Cztery powierzchnie strony publicznej
// same wolaja baze albo tozsamosc, wiec w szkicu formularza nie maja z czego
// sie wyrenderowac:
//   * `EventMenuNav` - `useEventMenu(slug)`, a pozycje szkicu nie maja jeszcze
//     ani identyfikatora w bazie, ani sciezki, z ktorej sklada sie odnosnik,
//   * `EventAgendaSection`, `EventSponsorsSection`, `EventMaterialsSection` -
//     wlasne zapytania po slugu, a program i partnerzy nie sa czescia szkicu,
//   * `EventBookmarkButton` - `useAuth` i mutacja zakladki (akcja konta,
//     nie tresc strony),
//   * `SectionLockCard` - zamki liczy baza dla WOLAJACEGO; redaktor studia
//     widzi wlasne wydarzenie w calosci, wiec zamku nie ma czego pokazac.
// Podstrony zostaja wiec szkicem (jedyny szkic w tym pliku), a lista sekcji
// przekazywanych do `EventPageSections` konczy sie na tych, ktorych tresc niesie
// szkic - `PREVIEW_SECTION_KEYS`. Reszta odpada w bramce jako swiadomy wyjatek.
//
// KANWA MA STALA SZEROKOSC WIRTUALNA, a skaluje ja rodzic (`transform: scale`).
// Dzieki temu proporcje typografii i odstepow sa takie jak na prawdziwym
// ekranie - podglad rysowany „responsywnie” w waskim panelu pokazywalby uklad
// mobilny i klamalby o wygladzie na komputerze.
//
// OGRANICZENIE PUNKTOW ZALAMANIA. Klasy `sm:` i `lg:` komponentow publicznych
// czytaja szerokosc OKNA, a nie szerokosc kanwy, wiec widok telefonu pokazuje
// wierne przelamania tekstu, ale siatki zostaja w ukladzie z komputera.
// Naprawa nalezy do strony publicznej (przejscie na zapytania kontenerowe),
// nie do podgladu - druga siatka liczona tutaj to znowu drugi silnik.
import { useTranslation } from "react-i18next";
import { ArrowLeft, CalendarDays, MapPin } from "@/lib/lucide-shim";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { eventBrandingPayload } from "@/lib/events/eventBrandingDraft";
import { eventBrandingScopeProps } from "@/lib/events/eventBrandingCss";
import {
  EVENT_SECTION_KEYS,
  type EventSection,
  type EventSectionKey,
} from "@/lib/events/eventSections";
import { EVENT_PRACTICAL_SECTIONS, type EventPracticalInfo } from "@/lib/events/eventPractical";
import { formatEventDateTime, eventTimeZoneLabel } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import { EventBrandingStyle } from "@/components/events/public/atoms/EventBrandingStyle";
import { EventVideoHeader } from "@/components/events/public/molecules/EventVideoHeader";
import { EventPageSections } from "@/components/events/public/organisms/EventPageSections";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
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
}: {
  model: EventPreviewModel;
  device: PreviewDevice;
}) {
  ensureAdminEventsI18n();
  ensureCommunityI18n();
  ensureEventFrontI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  const title =
    (lang === "en" ? model.titleEn || model.titlePl : model.titlePl || model.titleEn) ||
    t("adminEvents.studio.preview.untitled");
  const description =
    lang === "en"
      ? model.descriptionEn || model.descriptionPl
      : model.descriptionPl || model.descriptionEn;
  const dateLabel = formatEventDateTime(model.startsAt, model.timezone, lang);
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
    // Zakres brandingu obejmuje CALA kanwe, nie samo opakowanie tresci: tlo
    // strony (`--background`) widac takze w marginesach obok kolumny tekstu.
    <div
      {...eventBrandingScopeProps}
      style={{ width: PREVIEW_WIDTHS[device] }}
      className="bg-background font-sans text-foreground"
      data-testid="event-preview-canvas"
    >
      <EventBrandingStyle branding={eventBrandingPayload(model.branding)} />
      {page === null ? null : (
        <article className="container mx-auto max-w-3xl px-4 py-12 md:py-16" data-testid="event-preview-page">
          <span className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {title}
          </span>
          <h1 className="text-4xl font-bold tracking-tight">{page.label}</h1>
          <p className="mt-2 font-sans text-xs text-muted-foreground">/{page.path}</p>
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
        </article>
      )}
      {page !== null ? null : (
      <article className="container mx-auto max-w-3xl px-4 py-12 md:py-16">

        {/* Powrot do katalogu jest NAPISEM, nie odnosnikiem: klik w podgladzie
            wyprowadzalby redaktora ze studia w trakcie edycji. */}
        <span className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("community.events.backToList")}
        </span>

        <EventVideoHeader
          title={title}
          coverUrl={model.coverUrl}
          videoPlatform={model.videoPlatform}
          videoId={model.videoId}
        />

        <h1 className="mt-3 text-4xl font-bold tracking-tight">{title}</h1>

        <dl className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2">
          <PreviewMetaRow
            icon={<CalendarDays className="h-4 w-4" />}
            label={t("community.events.whenLabel")}
          >
            {dateLabel === "" ? t("adminEvents.studio.preview.noDate") : dateLabel}
            {zoneLabel === "" ? null : ` (${zoneLabel})`}
          </PreviewMetaRow>
          {model.locationName === "" ? null : (
            <PreviewMetaRow
              icon={<MapPin className="h-4 w-4" />}
              label={t("community.events.location")}
            >
              {model.locationName}
            </PreviewMetaRow>
          )}
        </dl>

        {/* JEDYNY SZKIC W TYM PLIKU - patrz naglowek: `EventMenuNav` wola menu
            z bazy, a pozycje szkicu nie maja jeszcze sciezki. Znaczniki i klasy
            sa przepisane z tamtego komponentu, zeby rozjazd bylo widac na
            pierwszy rzut oka. */}
        {model.menu.length === 0 ? null : (
          <nav aria-label={t("eventFront.menu.label")} className="mt-8">
            <ul
              className={cn(
                isGrid ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3" : "flex flex-col gap-2",
              )}
            >
              {model.menu.map((item) => (
                <li key={item.key}>
                  <span
                    className={cn(
                      "flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground",
                      isGrid && "h-full",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
                      style={item.color === "" ? undefined : { backgroundColor: item.color }}
                    >
                      <DynamicIcon name={item.icon} size={18} />
                    </span>
                    <span className="min-w-0 flex-1">{item.label}</span>
                  </span>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {description === "" ? null : (
          <div className="prose prose-neutral mt-8 max-w-none whitespace-pre-line dark:prose-invert">
            {description}
          </div>
        )}

        {/* Dojazd i kontakt rysuje TEN SAM organizm, co strona publiczna -
            razem z naglowkami, kolejnoscia i odsiewaniem pustych sekcji. */}
        <EventPageSections
          slug={model.slug}
          sections={PREVIEW_SECTION_KEYS.map(previewSection)}
          practical={practical}
        />

        {/* Kontrolka zapisu jest ATRAPA WYGLADU, a nie wariantem reguly:
            `EventRegistrationSurface` dostaje zdanie policzone z dostepu
            wolajacego (warstwa, okno zapisow, komplet miejsc), a szkic
            niepublikowanego wydarzenia takiego dostepu nie ma. Zamiast fabrykowac
            decyzje reguly, podglad pokazuje sam przycisk w kolorze akcji -
            i dlatego jest `span`, ktory nie zabiera skupienia z formularza. */}
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <span className={buttonVariants()}>{t("adminEvents.studio.preview.register")}</span>
        </div>
      </article>
    </div>
  );
}

/**
 * Wiersz karty informacji. Znaczniki przepisane z trasy `events.$slug` - `MetaRow`
 * jest tam funkcja lokalna, wiec nie ma czego zaimportowac.
 */
function PreviewMetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}
