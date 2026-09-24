// Molekula: KARTA PRELEGENTA rozwijana kliknieciem w zdjecie.
//
// WZORZEC: naglowek profilu z 21st.dev (`TelegramHeader`) - male zdjecie
// z podpisem, a po kliknieciu zdjecie rosnie do pelnego kadru, podpis ląduje
// na gradiencie u dolu zdjecia, a przycisk akcji z napisu staje sie
// wypelnionym przyciskiem. Drugie klikniecie zwija karte.
//
// DOMYSLNIE KARTA WYGLADA JAK DOTAD. Zwinieta karta to ten sam uklad, ktory
// siatka miala przed zmiana (kwadrat 80 px, nazwisko, rola, instytucja) -
// wlasciciel cofnal juz raz „duze portrety na starcie" i ruch na najezdzie.
// Karta reaguje WYLACZNIE na klikniecie (i klawiature): zadnego hover-lift,
// zadnego zoomu na najezdzie. Najazd tylko rozgrzewa duze zdjecie w tle.
//
// SWIADOME ODSTEPSTWA OD WKLEJONEGO WZORCA
//   * `framer-motion` (`layoutId`, `MotionConfig`) -> USUNIETE. Ruch to FLIP na
//     Web Animations API (`lib/events/speakerCardMotion.ts`), ta sama sprezyna
//     sprobkowana do `linear()`; zadnej nowej zaleznosci.
//   * `next/image` -> `<img>` z adresem transformacji magazynu (jak
//     `SpeakerAvatar`), bo to aplikacja TanStack Start, nie Next.js.
//   * `rounded-full`/`borderRadius: 34` i pelny kadr bez zaokraglen -> 6 px na
//     zdjeciu, przyciskach i chipach (spec zdjec platformy).
//   * DWA elementy o tym samym `layoutId` -> JEDEN przycisk, ktory zmienia
//     rozmiar. Fokus zostaje na tym samym wezle po rozwinieciu i zwinieciu -
//     przy dwoch elementach klawiatura gubila by miejsce.
//   * telefon i nazwa uzytkownika -> rola, instytucja i SCIEZKI prelegenta
//     (wyprowadzone z obsady sesji, nie wpisywane).
//   * przycisk „Edit" -> akcja z panelu (link) albo otwarcie profilu; gdy nie
//     ma czego otworzyc, przycisku nie ma wcale.
//
// JEZYK KARTY TO PROPS `lang`, NIE INSTANCJA I18N. Tresc (rola, sciezki, napis
// przycisku) i napisy samej karty („Profil", „Powieksz zdjecie") ida w TYM
// SAMYM jezyku - ta sama decyzja, co w `SpeakerExpertBadge`. Na stronie to
// jezyk interfejsu; w podgladzie panelu redaktor przelacza PL/EN i widzi karte
// dokladnie tak, jak zobaczy ja uczestnik w danej wersji jezykowej.
//
// HYDRATACJA I CORE WEB VITALS
//   * serwer i pierwszy render klienta rysuja karte ZWINIETA - stan zalezy
//     tylko od klikniecia, a `matchMedia` i pomiary czyta obsluga zdarzenia
//     oraz `useLayoutEffect`, nigdy render;
//   * zwinieta karta ma stala geometrie (kwadrat 80 px), wiec nic nie skacze
//     po zaladowaniu (CLS);
//   * duzy kadr (800 px) nie jest pobierany, dopoki ktos nie wyrazi zamiaru
//     (najazd, fokus, dotyk) - siatka nie placi transferem za zdjecia, ktorych
//     nikt nie otworzy, a pod duzym kadrem od razu lezy miniatura z cache;
//   * ruch to `transform` jednej karty + jej wysokosc, odgrywane PO malowaniu
//     nowego stanu (INP), i wylaczone przy `prefers-reduced-motion`.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { AppLink } from "@/components/atoms/AppLink";
import { SpeakerAvatar } from "@/components/events/SpeakerAvatar";
import { SpeakerExpertBadge } from "@/components/events/SpeakerExpertBadge";
import { SpeakerTrackChips } from "@/components/events/SpeakerTrackChips";
import { PX_BY_SIZE } from "@/components/events/speakerAvatarSizes";
import { cn } from "@/lib/utils";
import { buildTransformedImageUrl } from "@/lib/cropSizes";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import { speakerHasProfileToShow } from "@/lib/builder/speakerRow";
import {
  hexColorOrNull,
  readableInkOn,
  speakerCardAction,
  speakerCardPhoto,
} from "@/lib/events/speakerCard";
import {
  boxOf,
  flipHeightKeyframes,
  flipMediaKeyframes,
  flipShiftKeyframes,
  playKeyframes,
  preloadImage,
  prefersReducedMotion,
  speakerCardEasing,
  type FlipBox,
} from "@/lib/events/speakerCardMotion";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

/** Bok duzego kadru w px - 2x szerokosci karty w trzech kolumnach (~375 px). */
export const SPEAKER_CARD_LARGE_PX = 800;

/** Znacznik podgladu builderu/panelu - wewnatrz niego linki nie nawiguja. */
const PREVIEW_MARKER = '[data-builder-renderer="widget-props-preview"]';

/** Lewa granica zwinietego przycisku: miniatura 80 px (5rem) + odstep. */
const COLLAPSED_ACTION_LEFT = "5.75rem";

const CARD_CLASS =
  "flex h-full w-full flex-col items-start overflow-hidden border-b border-r border-border bg-background p-5 text-left";

const textOrNull = (value: string | null | undefined): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

interface FlipSnapshot {
  card: FlipBox | null;
  media: FlipBox | null;
  parts: (FlipBox | null)[];
  action: FlipBox | null;
}

export function SpeakerProfileCard({
  speaker,
  lang,
  onSelect,
}: {
  speaker: PublicSpeakerRow;
  lang: "pl" | "en";
  /** Otwarcie profilu (dialog). Bez niego przycisk profilu sie nie pojawia. */
  onSelect?: (speaker: PublicSpeakerRow) => void;
}) {
  const { t } = useTranslation();
  const [expandedState, setExpanded] = useState(false);
  // STAN DUZEGO KADRU JEST PRZYPISANY DO ADRESU, a nie do karty. Podglad
  // w panelu zmienia adres, gdy redaktor pisze - blad posredniego napisu
  // („https://exa") nie moze zgasic kadru, ktory przyjdzie po nim.
  const [failedLargeUrl, setFailedLargeUrl] = useState<string | null>(null);

  const cardRef = useRef<HTMLElement | null>(null);
  const mediaRef = useRef<HTMLButtonElement | null>(null);
  const nameRef = useRef<HTMLSpanElement | null>(null);
  const roleRef = useRef<HTMLSpanElement | null>(null);
  const orgRef = useRef<HTMLSpanElement | null>(null);
  const extrasRef = useRef<HTMLSpanElement | null>(null);
  const actionRef = useRef<HTMLElement | null>(null);
  const pending = useRef<FlipSnapshot | null>(null);
  const running = useRef<(Animation | null | undefined)[]>([]);
  const warmedUrl = useRef<string | null>(null);

  const name = speaker.display_name ?? "";
  // Rola: ta sama kolejnosc, co wszedzie indziej - `headline` w jezyku
  // interfejsu, a w jego braku stanowisko z profilu.
  const role = pickLocalized(speaker, "headline", lang, speaker.job_title ?? "");
  const organization = speaker.company ?? "";
  const tracks = speaker.tracks ?? [];

  // Miniatura to ten sam adres, ktory rysuje `SpeakerAvatar` (kwadrat 2x) -
  // lezy juz w cache przegladarki, wiec pod duzym kadrem jest od pierwszej
  // klatki. Duzy kadr: zdjecie karty od redakcji, a w jego braku zdjecie osoby.
  const thumbSource = textOrNull(speaker.avatar_url) ?? textOrNull(speaker.card_photo_url);
  const largeSource = speakerCardPhoto(speaker);
  const thumbUrl =
    thumbSource === null
      ? null
      : buildTransformedImageUrl(thumbSource, {
          width: PX_BY_SIZE.xl * 2,
          height: PX_BY_SIZE.xl * 2,
          resize: "cover",
        });
  const largeUrl =
    largeSource === null
      ? null
      : buildTransformedImageUrl(largeSource, {
          width: SPEAKER_CARD_LARGE_PX,
          height: SPEAKER_CARD_LARGE_PX,
          resize: "cover",
        });
  // Karta bez zdjecia sie nie rozwija: kwadrat inicjalow na cala szerokosc nie
  // pokazuje niczego, czego nie ma w zwinietej karcie.
  const expandable = largeUrl !== null;
  // ROZWINIECIE WYNIKA ZE STANU I ZE ZDJECIA. Zdjecie moze zniknac pod otwarta
  // karta (podglad w panelu, gdy redaktor czysci pole; odswiezenie danych na
  // stronie). Sam stan zostawilby wtedy bialy podpis na bialym tle i zadnego
  // przycisku do zwiniecia - dlatego rysunek bierze iloczyn, a efekt nizej
  // sprowadza stan do zwinietego, zeby powrot zdjecia nie rozwinal karty sam.
  const expanded = expandedState && expandable;
  useEffect(() => {
    if (!expandable) setExpanded(false);
  }, [expandable]);

  const action = speakerCardAction(
    speaker,
    lang,
    onSelect !== undefined && speakerHasProfileToShow(speaker),
  );
  const accent = hexColorOrNull(speaker.card_cta_color);

  const snapshot = (): FlipSnapshot => ({
    card: boxOf(cardRef.current),
    media: boxOf(mediaRef.current),
    parts: [nameRef, roleRef, orgRef, extrasRef].map((ref) => boxOf(ref.current)),
    action: boxOf(actionRef.current),
  });

  const warm = (): void => {
    if (largeUrl === null || warmedUrl.current === largeUrl) return;
    warmedUrl.current = largeUrl;
    preloadImage(largeUrl);
  };

  const toggle = (): void => {
    if (!expandable) return;
    warm();
    pending.current = prefersReducedMotion() ? null : snapshot();
    setExpanded((current) => !current);
  };

  // FLIP: pomiar PRZED zmiana jest w `toggle`, pomiar PO - tutaj, zanim
  // przegladarka pomaluje nowy uklad. Odwrocenie roznicy i odegranie jej do
  // zera daje ruch bez jednej klatki „skoku".
  //
  // KLIKNIECIE W TRAKCIE RUCHU. Pomiar „przed" w `toggle` lapie stan WIDOCZNY
  // (z biezaca animacja) - i tak ma byc, bo z niego rusza odwrocenie. Pomiar
  // „po" musi juz byc bez niej: animacja wysokosci i transformacji z
  // poprzedniego klikniecia zawyzylaby nowy uklad, a zwrot startowal z
  // krzywej geometrii. Dlatego trwajace animacje sa kasowane PRZED pomiarem -
  // w tej samej klatce, wiec bez migniecia.
  useLayoutEffect(() => {
    running.current.forEach((animation) => animation?.cancel());
    running.current = [];
    const first = pending.current;
    pending.current = null;
    if (first === null) return;
    const last = snapshot();
    const easing = speakerCardEasing();
    const play = (element: Element | null, keyframes: Keyframe[] | null): void => {
      running.current.push(playKeyframes(element, keyframes, easing));
    };
    if (first.card !== null && last.card !== null) {
      play(cardRef.current, flipHeightKeyframes(first.card, last.card));
    }
    if (first.media !== null && last.media !== null) {
      play(mediaRef.current, flipMediaKeyframes(first.media, last.media));
    }
    [nameRef, roleRef, orgRef, extrasRef].forEach((ref, index) => {
      const from = first.parts[index] ?? null;
      const to = last.parts[index] ?? null;
      if (from !== null && to !== null) play(ref.current, flipShiftKeyframes(from, to));
    });
    if (first.action !== null && last.action !== null) {
      play(actionRef.current, flipShiftKeyframes(first.action, last.action));
    }
    // `snapshot` czyta wylacznie refy - efekt reaguje tylko na zmiane stanu.
  }, [expanded]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Escape" && expanded) {
      event.stopPropagation();
      toggle();
      mediaRef.current?.focus();
    }
  };

  const textTone = expanded ? "text-white" : "text-foreground";
  const mutedTone = expanded ? "text-white/85" : "text-muted-foreground";

  const caption = (
    <span
      className={cn(
        "flex w-full flex-col items-start",
        expanded ? "pointer-events-none absolute inset-x-0 bottom-0 z-10 p-4" : "mt-5",
      )}
    >
      {name !== "" && (
        <span
          ref={nameRef}
          title={name}
          className={cn(
            "block w-full text-lg font-semibold leading-tight transition-colors duration-300",
            textTone,
          )}
        >
          {name}
        </span>
      )}
      {role !== "" && (
        <span
          ref={roleRef}
          title={role}
          className={cn(
            "mt-2 block w-full text-sm leading-snug transition-colors duration-300",
            mutedTone,
          )}
        >
          {role}
        </span>
      )}
      {organization !== "" && (
        <span
          ref={orgRef}
          title={organization}
          className={cn(
            "mt-1 block w-full text-xs font-semibold uppercase leading-tight transition-colors duration-300",
            expanded ? "text-white/90" : "text-foreground/80",
          )}
        >
          {organization}
        </span>
      )}
      {(tracks.length > 0 || speaker.is_expert) && (
        <span ref={extrasRef} className="mt-2 flex w-full flex-col items-start gap-1.5">
          {/* Plakietka eksperta pod podpisem, nie w wierszu nazwiska - jej
              rysunek jest wspolny z zapowiedzia na przegladzie. */}
          {speaker.is_expert && <SpeakerExpertBadge />}
          <SpeakerTrackChips tracks={tracks} lang={lang} inverse={expanded} />
        </span>
      )}
    </span>
  );

  const actionLabel =
    action === null
      ? ""
      : (action.label ??
        (action.kind === "link"
          ? t("eventFront.speakers.card.linkAction", { lng: lang })
          : t("eventFront.speakers.card.profileAction", { lng: lang })));
  const actionName = t("eventFront.speakers.card.actionFor", {
    label: actionLabel,
    name,
    lng: lang,
  });
  const actionClass = cn(
    "absolute z-20 inline-flex items-center rounded-[6px] text-sm font-semibold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]/60",
    expanded
      ? cn(
          "right-3 top-3 px-3 py-1.5 shadow-sm",
          accent === null && "bg-brand text-brand-foreground",
        )
      : "right-0 top-0 justify-end px-2 py-1 text-right text-brand-ink hover:underline",
  );
  // ZWINIETA: napis nie wchodzi na zdjecie. Bez lewej granicy dlugi napis
  // (do 40 znakow) rozlewa sie w lewo nad miniature i przejmuje jej klikniecie.
  // Granica w stylu, nie w klasie - arkusz publiczny nie dostaje nowej klasy.
  const actionStyle =
    expanded && accent !== null
      ? { backgroundColor: accent, color: readableInkOn(accent) }
      : expanded
        ? undefined
        : { left: COLLAPSED_ACTION_LEFT };

  let actionNode: ReactNode = null;
  if (action !== null && action.kind === "link") {
    actionNode = action.external ? (
      <a
        ref={(node) => {
          actionRef.current = node;
        }}
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        // Ta sama bramka podgladu, co w `AppLink`: w podgladzie panelu klik
        // nie otwiera obcej strony (redaktor sprawdza wyglad, nie cel).
        onClick={(event) => {
          if (event.currentTarget.closest(PREVIEW_MARKER)) event.preventDefault();
        }}
        aria-label={`${actionName} ${t("eventFront.speakers.card.opensInNewTab", { lng: lang })}`}
        className={actionClass}
        style={actionStyle}
      >
        {actionLabel}
      </a>
    ) : (
      <AppLink
        ref={(node: HTMLAnchorElement | null) => {
          actionRef.current = node;
        }}
        href={action.href}
        aria-label={actionName}
        className={actionClass}
        style={actionStyle}
      >
        {actionLabel}
      </AppLink>
    );
  } else if (action !== null && onSelect !== undefined) {
    actionNode = (
      <button
        ref={(node) => {
          actionRef.current = node;
        }}
        type="button"
        aria-label={actionName}
        onClick={() => onSelect(speaker)}
        className={actionClass}
        style={actionStyle}
      >
        {actionLabel}
      </button>
    );
  }

  return (
    <article
      ref={(node) => {
        cardRef.current = node;
      }}
      data-state={expanded ? "expanded" : "collapsed"}
      onKeyDown={onKeyDown}
      className={CARD_CLASS}
    >
      <div className="relative w-full">
        {expandable ? (
          <button
            ref={mediaRef}
            type="button"
            aria-expanded={expanded}
            aria-label={t(
              expanded ? "eventFront.speakers.card.collapse" : "eventFront.speakers.card.expand",
              { name, lng: lang },
            )}
            onClick={toggle}
            onPointerEnter={warm}
            onFocus={warm}
            onTouchStart={warm}
            className={cn(
              "relative block shrink-0 overflow-hidden rounded-[6px] bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]/60 focus-visible:ring-offset-2",
              expanded ? "aspect-square w-full cursor-pointer" : "h-20 w-20 cursor-zoom-in",
            )}
          >
            {expanded ? (
              <>
                {thumbUrl !== null && (
                  <img
                    src={thumbUrl}
                    alt=""
                    aria-hidden="true"
                    decoding="async"
                    className="absolute inset-0 size-full object-cover"
                  />
                )}
                {largeUrl !== null && failedLargeUrl !== largeUrl && (
                  <img
                    key={largeUrl}
                    src={largeUrl}
                    alt=""
                    decoding="async"
                    onError={() => setFailedLargeUrl(largeUrl)}
                    className="oi-fade-in absolute inset-0 size-full object-cover"
                  />
                )}
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/40 to-transparent"
                />
              </>
            ) : (
              <SpeakerAvatar name={name} photoUrl={thumbSource} size="xl" />
            )}
          </button>
        ) : (
          <SpeakerAvatar name={name} photoUrl={thumbSource} size="xl" />
        )}
        {caption}
        {actionNode}
      </div>
    </article>
  );
}
