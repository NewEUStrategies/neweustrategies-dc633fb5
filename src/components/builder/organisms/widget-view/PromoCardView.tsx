// Widget "promo-card" - karta promocyjna z okładką na całym tle, nakładką,
// tytułem, podtytułem i przyciskiem CTA.
//
// Warstwa organizmu: treść widgetu -> propsy molekuły, i18n PL/EN, sanityzacja
// adresów i kolorów, rozwiązanie CTA. Molekuła: @/components/ui/promo-card.
//
// DWA TRYBY CTA:
//   * `link`  - adres wpisany ręcznie,
//   * `event` - wydarzenie z WEWNĘTRZNEGO kreatora wydarzeń. Wtedy karta bierze
//     z bazy adres strony wydarzenia, a puste pola treści uzupełnia danymi
//     wydarzenia (tytuł, okładka, data i miejsce). Redakcja podpina kartę raz,
//     a zmiana terminu w module wydarzeń przechodzi na stronę sama.
//
// SSR I HYDRATACJA. Wydarzenie czytamy przez `eventByIdQueryOptions`, czyli te
// same `queryOptions`, które `lib/builder/prefetch.ts` rozgrzewa na SERWERZE dla
// tego typu widgetu. Serwer renderuje więc kartę z realnymi danymi, a klient
// startuje z tego samego, zdehydratowanego cache - pierwszy render klienta jest
// bajtowo tym samym drzewem co HTML z serwera.
//
// Dlatego renderer NIE MA PRAWA czytać tutaj zegara ani `window`: wszystko, co
// rysuje, jest funkcją treści widgetu i wiersza z bazy. Data wydarzenia jest
// formatowana w STREFIE WYDARZENIA (`formatEventDateTime`), a nie w strefie
// maszyny - inaczej serwer w UTC i przeglądarka w Warszawie wypisałyby dwie
// różne daty dla tego samego wieczoru i React wyrzuciłby całe drzewo.
import { useQuery } from "@tanstack/react-query";
import type { WidgetContent } from "@/lib/builder/types";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import { safeWidgetColor } from "@/lib/builder/cssColor";
import { asNumInRange, asOneOf, pickI18n } from "@/lib/content-model/contentValue";
import { AppLink } from "@/components/atoms/AppLink";
import { eventByIdQueryOptions } from "@/lib/builder/eventsQuery";
import { formatEventDateTime } from "@/lib/events/timezone";
import { useBuilderMode } from "@/lib/content-model/editorCanvas";
import { promoCardCoverSizes } from "@/lib/builder/widgetImageSizes";
import {
  PROMO_CARD_ALIGNS,
  PROMO_CARD_DEFAULTS,
  PROMO_CARD_ENTRANCES,
  PROMO_CARD_FITS,
  PROMO_CARD_HOVERS,
  PROMO_CARD_MODES,
  PROMO_CARD_POSITIONS,
  promoCardCtaHref,
  promoCardCtaLabel,
  promoCardRatio,
  type PromoCardAlign,
  type PromoCardEntrance,
  type PromoCardFit,
  type PromoCardHover,
  type PromoCardMode,
  type PromoCardPosition,
} from "@/lib/builder/promoCard";
import { PromoCard } from "@/components/ui/promo-card";
import { getBool, getStr, type Lang } from "./frame";

/** Wiersz meta wydarzenia: data w strefie wydarzenia + miejsce. */
function eventMetaLine(
  startsAt: string,
  timezone: string | null,
  location: string,
  lang: Lang,
): string {
  const date = formatEventDateTime(startsAt, timezone, lang, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return [date, location.trim()].filter(Boolean).join(" · ");
}

export function PromoCardView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const d = PROMO_CARD_DEFAULTS;
  const inBuilder = useBuilderMode() !== null;

  // Każde ustawienie schematu czytane BEZWARUNKOWO - bramka wierności ustawień
  // porównuje zbiór kluczy panelu ze zbiorem kluczy odczytanych przy renderze.
  const mode = asOneOf<PromoCardMode>(c.mode, PROMO_CARD_MODES, d.mode);
  const eventId = getStr(c, "eventId");
  const manualHref = safeUrl(getStr(c, "href"), "");
  const newTab = getBool(c, "newTab", false);
  const showEventMeta = getBool(c, "showEventMeta", true);

  const ratio = promoCardRatio(c.ratio);
  const heightPx = asNumInRange(c.heightPx, d.heightPx, 80, 1200);
  const maxWidth = asNumInRange(c.maxWidth, d.maxWidth, 0, 1600);
  const fit = asOneOf<PromoCardFit>(c.fit, PROMO_CARD_FITS, d.fit);
  const imagePosition = asOneOf<PromoCardPosition>(
    c.imagePosition,
    PROMO_CARD_POSITIONS,
    d.imagePosition,
  );

  const align = asOneOf<PromoCardAlign>(c.align, PROMO_CARD_ALIGNS, d.align);
  const hover = asOneOf<PromoCardHover>(c.hover, PROMO_CARD_HOVERS, d.hover);
  const entrance = asOneOf<PromoCardEntrance>(c.entrance, PROMO_CARD_ENTRANCES, d.entrance);
  const overlayColor = safeWidgetColor(c.overlayColor);
  const overlayAlphaTop = asNumInRange(c.overlayAlphaTop, d.overlayAlphaTop, 0, 1);
  const overlayAlphaBottom = asNumInRange(c.overlayAlphaBottom, d.overlayAlphaBottom, 0, 1);
  const radius = asNumInRange(c.radius, d.radius, 0, 48);
  const textColor = safeWidgetColor(c.textColor);
  const buttonBg = safeWidgetColor(c.buttonBg);
  const buttonTextColor = safeWidgetColor(c.buttonTextColor);

  const manualImage = safeImageUrl(getStr(c, "image"));
  const manualTitle = pickI18n(c, "title", lang);
  const manualSubtitle = pickI18n(c, "subtitle", lang);
  const imageAlt = pickI18n(c, "imageAlt", lang);
  const manualLabel = pickI18n(c, "buttonText", lang);

  // Zapytanie startuje TYLKO w trybie wydarzenia i tylko z wybranym id -
  // inaczej karta z ręcznym adresem płaciłaby za zapytanie, którego nie użyje.
  const eventQ = useQuery({
    ...eventByIdQueryOptions(eventId),
    enabled: mode === "event" && !!eventId,
  });
  const eventRow = mode === "event" ? (eventQ.data ?? null) : null;

  const eventTitle = eventRow
    ? lang === "pl"
      ? eventRow.title_pl || eventRow.title_en
      : eventRow.title_en || eventRow.title_pl
    : "";
  const title = manualTitle || eventTitle;
  const image = manualImage || safeImageUrl(eventRow?.cover_url ?? "");
  const subtitle = manualSubtitle;
  const meta =
    showEventMeta && eventRow
      ? eventMetaLine(eventRow.starts_at, eventRow.timezone, eventRow.location ?? "", lang)
      : "";

  const href = promoCardCtaHref(mode, manualHref, eventRow?.slug ?? "");
  const ctaLabel = manualLabel || promoCardCtaLabel(mode, lang);

  // Karta bez tytułu i bez okładki nie niesie żadnej treści. Publicznie znika
  // (pusty prostokąt to defekt, nie projekt), a w kanwie mówi redakcji, czego
  // brakuje - inaczej widget wstawiony z palety wygląda na zepsuty.
  if (!title && !image) {
    if (!inBuilder) return null;
    return (
      <section className="cms-promo-card">
        <p className="rounded-[6px] border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
          {lang === "pl"
            ? "Dodaj okładkę i tytuł karty (lub wybierz wydarzenie) w panelu widgetu."
            : "Add a cover and a title (or pick an event) in the widget panel."}
        </p>
      </section>
    );
  }

  return (
    <PromoCard
      title={title}
      subtitle={subtitle}
      meta={meta}
      imageUrl={image}
      imageAlt={imageAlt}
      imageSizes={promoCardCoverSizes(maxWidth)}
      ratio={ratio}
      heightPx={heightPx}
      maxWidth={maxWidth}
      fit={fit}
      imagePosition={imagePosition}
      overlayColor={overlayColor}
      overlayAlphaTop={overlayAlphaTop}
      overlayAlphaBottom={overlayAlphaBottom}
      radius={radius}
      align={align}
      hover={hover}
      entrance={entrance}
      textColor={textColor}
      className="cms-promo-card"
      cta={
        href ? (
          <AppLink
            href={href}
            // `noopener` przy nowej karcie jest OBOWIĄZKOWY: bez niego otwarta
            // strona dostaje `window.opener` i może przestawić naszą zakładkę.
            target={newTab ? "_blank" : undefined}
            rel={newTab ? "noopener noreferrer" : undefined}
            style={{
              ...(buttonBg ? { background: buttonBg } : null),
              ...(buttonTextColor ? { color: buttonTextColor } : null),
            }}
            className={
              "inline-flex items-center justify-center rounded-[6px] px-5 py-2.5 text-sm font-semibold " +
              "bg-[color:var(--brand)] text-[color:var(--brand-foreground,white)] shadow-sm " +
              "transition-opacity duration-200 hover:opacity-90 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            }
          >
            {ctaLabel}
          </AppLink>
        ) : null
      }
    />
  );
}
