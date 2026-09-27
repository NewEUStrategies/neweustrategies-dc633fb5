// Molekula: KARTA PRELEGENTA rozwijana kliknieciem w zdjecie - wierne
// odwzorowanie naglowka profilu z 21st.dev (`TelegramHeader`) z nagrania
// wlasciciela.
//
// ZWINIETA (tak wyglada siatka domyslnie): wysrodkowane OKRAGLE zdjecie,
// pod nim wysrodkowane imie i nazwisko, pod nim szary podpis „rola •
// organizacja", a w prawym gornym rogu napis akcji w kolorze marki (we wzorcu
// niebieskie „Edit"). Zdjecie jest widoczne od razu.
//
// ROZWINIETA (po kliknieciu w zdjecie): kolo rosnie do KWADRATU NA CALA
// SZEROKOSC KARTY, od krawedzi do krawedzi i bez zaokraglen, podpis zjezdza do
// lewego dolnego rogu i bieleje na gradiencie, a napis akcji staje sie
// wypelnionym przyciskiem w prawym gornym rogu. Pod zdjeciem otwieraja sie
// SZCZEGOLY - w jakich sciezkach osoba wystepuje (wyprowadzone z obsady sesji,
// nie wpisywane) i plakietka eksperta. Drugie klikniecie zwija karte.
//
// KARTA REAGUJE WYLACZNIE NA KLIKNIECIE (i klawiature): zadnego hover-lift,
// zadnego zoomu na najezdzie. Najazd tylko rozgrzewa duze zdjecie w tle.
//
// SWIADOME ODSTEPSTWA OD WKLEJONEGO WZORCA
//   * `framer-motion` (`layoutId`, `MotionConfig`) -> USUNIETE. Ruch to FLIP na
//     Web Animations API (`lib/events/speakerCardMotion.ts`), ta sama sprezyna
//     sprobkowana do `linear()`; zadnej nowej zaleznosci.
//   * `next/image` -> `<img>` z adresem transformacji magazynu (jak
//     `SpeakerAvatar`), bo to aplikacja TanStack Start, nie Next.js.
//   * DWA elementy o tym samym `layoutId` -> JEDEN przycisk, ktory zmienia
//     rozmiar i promien. Fokus zostaje na tym samym wezle po rozwinieciu
//     i zwinieciu - przy dwoch elementach klawiatura gubilaby miejsce.
//   * telefon i nazwa uzytkownika -> rola i organizacja (organizacja znika,
//     gdy tylko powtarza role - `speakerOrganizationLine`).
//   * przycisk „Edit" -> akcja z panelu (link) albo otwarcie profilu; gdy nie
//     ma czego otworzyc, przycisku nie ma wcale.
//   * tresc pod naglowkiem (we wzorcu atrapa wierszy) -> szczegoly karty:
//     sciezki i plakietka eksperta, widoczne dopiero po kliknieciu.
//
// KARTA BEZ ZDJECIA. Nie ma czego powiekszac, wiec zostaje kolo z inicjalami
// - ale szczegoly nadal otwiera klikniecie w nie, zeby siatka zachowywala sie
// jednakowo. Bez zdjecia i bez szczegolow karta nie ma przycisku wcale.
//
// SZCZEGOLY SA W DRZEWIE TAKZE ZWINIETE (`hidden`), a nie doklejane po
// kliknieciu: serwer oddaje pelny zestaw faktow o osobie (bramka parytetu
// faktow liczy `textContent`), przycisk wskazuje je przez `aria-controls`,
// a rozwiniecie nie czeka na zadne dane.
//
// JEZYK KARTY TO PROPS `lang`, NIE INSTANCJA I18N. Tresc (rola, sciezki, napis
// przycisku) i napisy samej karty („Profil", „Rozwin karte") ida w TYM
// SAMYM jezyku - ta sama decyzja, co w `SpeakerExpertBadge`. Na stronie to
// jezyk interfejsu; w podgladzie panelu redaktor przelacza PL/EN i widzi karte
// dokladnie tak, jak zobaczy ja uczestnik w danej wersji jezykowej.
//
// HYDRATACJA I CORE WEB VITALS
//   * serwer i pierwszy render klienta rysuja karte ZWINIETA - stan zalezy
//     tylko od klikniecia, a `matchMedia` i pomiary czyta obsluga zdarzenia
//     oraz `useLayoutEffect`, nigdy render; `useId` daje ten sam identyfikator
//     szczegolow na serwerze i w kliencie;
//   * zwinieta karta ma stala geometrie (kolo 80 px i dwie linie podpisu),
//     wiec nic nie skacze po zaladowaniu (CLS);
//   * duzy kadr (800 px) nie jest pobierany, dopoki ktos nie wyrazi zamiaru
//     (najazd, fokus, dotyk) - siatka nie placi transferem za zdjecia, ktorych
//     nikt nie otworzy, a pod duzym kadrem od razu lezy miniatura z cache;
//   * ruch to `transform`/`opacity` jednej karty + jej wysokosc, odgrywane PO
//     malowaniu nowego stanu (INP), i wylaczone przy `prefers-reduced-motion`.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
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
  hasNamedSpeakerTrack,
  hexColorOrNull,
  readableInkOn,
  speakerCardAction,
  speakerCardPhoto,
  speakerOrganizationLine,
} from "@/lib/events/speakerCard";
import {
  SPEAKER_CARD_ROUND,
  SPEAKER_CARD_SETTLE,
  SPEAKER_CARD_SQUARE,
  boxOf,
  flipFadeKeyframes,
  flipHeightKeyframes,
  flipMediaKeyframes,
  flipShiftKeyframes,
  playKeyframes,
  preloadImage,
  prefersReducedMotion,
  revealKeyframes,
  speakerCardEasing,
  type FlipBox,
} from "@/lib/events/speakerCardMotion";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

/** Bok duzego kadru w px - 2x szerokosci karty w trzech kolumnach (~375 px). */
export const SPEAKER_CARD_LARGE_PX = 800;

/** Znacznik podgladu builderu/panelu - wewnatrz niego linki nie nawiguja. */
const PREVIEW_MARKER = '[data-builder-renderer="widget-props-preview"]';

/**
 * ZWINIETA: napis akcji nie wchodzi na zdjecie. Kolo stoi na srodku karty,
 * wiec napis ma do dyspozycji pol karty minus pol kola (2,5 rem) i odstep.
 * Dluzszy napis (do 40 znakow) konczy sie wielokropkiem, a pelna nazwe niesie
 * `aria-label` i `title`. Granica w stylu, nie w klasie - arkusz publiczny nie
 * dostaje nowej klasy.
 */
const COLLAPSED_ACTION_MAX_WIDTH = "calc(50% - 3.25rem)";

/**
 * ROZWINIETA: pigulka na zdjeciu nie wychodzi poza karte - od prawej stoi
 * `right-3`, wiec z lewej zostaje ten sam odstep. Bez granicy dlugi napis
 * (`truncate` = jedna linia) rozpychalby pigulke za lewa krawedz karty, gdzie
 * `overflow-hidden` ucinalby jego poczatek zamiast postawic wielokropek.
 */
const EXPANDED_ACTION_MAX_WIDTH = "calc(100% - 1.5rem)";

/**
 * Obwodka fokusu na pelnym kadrze: kolor marki na zewnatrz i jasny pasek pod
 * nim. Sama biel ginela na jasnym zdjeciu, sama marka - na ciemnym; para jest
 * widoczna na kazdym. Styl w obiekcie, nie w klasie - arkusz publiczny nie
 * dostaje nowej klasy (przezroczystosc steruje `group-focus-visible`).
 */
const FULL_BLEED_FOCUS_RING: CSSProperties = {
  boxShadow: "inset 0 0 0 3px var(--brand), inset 0 0 0 5px rgb(255 255 255 / 0.9)",
};

const CARD_CLASS =
  "relative flex h-full w-full flex-col overflow-hidden border-b border-r border-border bg-background text-left";

const textOrNull = (value: string | null | undefined): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** Pudelko liczone od PRAWEJ krawedzi - dla elementu kotwiczonego z prawej. */
const rightEdge = (box: FlipBox): FlipBox => ({ ...box, left: box.left + box.width });

/**
 * Czy napis zajmuje wiecej niz jedna linie. Wolane tylko z efektu ukladu
 * (pomiar), nigdy z renderu. Silnik bez stylu wyliczonego (np. test bez
 * ukladu) daje `NaN`, czyli „jedna linia".
 */
function wrapsLines(element: Element | null, box: FlipBox): boolean {
  if (element === null || typeof getComputedStyle !== "function") return false;
  const line = Number.parseFloat(getComputedStyle(element).lineHeight);
  return Number.isFinite(line) && line > 0 && box.height > line * 1.5;
}

interface FlipSnapshot {
  card: FlipBox | null;
  media: FlipBox | null;
  parts: (FlipBox | null)[];
  action: FlipBox | null;
  /** Promien zdjecia na starcie i na koncu ruchu (kolo <-> kwadrat). */
  radius: readonly [string, string];
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
  const detailsId = useId();
  const [expandedState, setExpanded] = useState(false);
  // STAN DUZEGO KADRU JEST PRZYPISANY DO ADRESU, a nie do karty. Podglad
  // w panelu zmienia adres, gdy redaktor pisze - blad posredniego napisu
  // („https://exa") nie moze zgasic kadru, ktory przyjdzie po nim.
  const [failedLargeUrl, setFailedLargeUrl] = useState<string | null>(null);
  // Miniatura tak samo: nieaktualny adres zdjecia osoby daje inicjaly, a nie
  // puste szare kolo.
  const [failedThumbUrl, setFailedThumbUrl] = useState<string | null>(null);

  const cardRef = useRef<HTMLElement | null>(null);
  const mediaRef = useRef<HTMLButtonElement | null>(null);
  const nameRef = useRef<HTMLSpanElement | null>(null);
  const subtitleRef = useRef<HTMLSpanElement | null>(null);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const actionRef = useRef<HTMLElement | null>(null);
  const pending = useRef<FlipSnapshot | null>(null);
  const running = useRef<(Animation | null | undefined)[]>([]);
  const warmedUrl = useRef<string | null>(null);

  const name = speaker.display_name ?? "";
  // Rola: ta sama kolejnosc, co wszedzie indziej - `headline` w jezyku
  // interfejsu, a w jego braku stanowisko z profilu.
  const role = pickLocalized(speaker, "headline", lang, speaker.job_title ?? "");
  // Organizacja, ktora tylko powtarza role, nie jest drugim faktem.
  const organization = speakerOrganizationLine(role, speaker.company) ?? "";
  const tracks = speaker.tracks ?? [];
  const hasTracks = hasNamedSpeakerTrack(tracks, lang);
  const hasDetails = hasTracks || speaker.is_expert;

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
  const hasPhoto = largeUrl !== null;
  // Karta rozwija sie, gdy ma co pokazac: pelny kadr albo szczegoly.
  const expandable = hasPhoto || hasDetails;
  // ROZWINIECIE WYNIKA ZE STANU I Z DANYCH. Zdjecie i sciezki moga zniknac pod
  // otwarta karta (podglad w panelu, gdy redaktor czysci pole; odswiezenie
  // danych na stronie). Sam stan zostawilby wtedy bialy podpis na bialym tle
  // i zadnego przycisku do zwiniecia - dlatego rysunek bierze iloczyn, a efekt
  // nizej sprowadza stan do zwinietego, zeby powrot danych nie rozwinal karty.
  const expanded = expandedState && expandable;
  const fullBleed = expanded && hasPhoto;
  useEffect(() => {
    if (!expandable) setExpanded(false);
  }, [expandable]);

  const action = speakerCardAction(
    speaker,
    lang,
    onSelect !== undefined && speakerHasProfileToShow(speaker),
  );
  const accent = hexColorOrNull(speaker.card_cta_color);

  // Kolo -> kwadrat pelnego kadru i z powrotem; karta bez zdjecia zostaje
  // kolem (pudelko sie nie zmienia, wiec klatek i tak nie bedzie). Kierunek
  // liczy `toggle` ze stanu PRZED zmiana i zapisuje go w pomiarze.
  const radiusFor = (fromExpanded: boolean): readonly [string, string] =>
    !hasPhoto
      ? [SPEAKER_CARD_ROUND, SPEAKER_CARD_ROUND]
      : fromExpanded
        ? [SPEAKER_CARD_SQUARE, SPEAKER_CARD_ROUND]
        : [SPEAKER_CARD_ROUND, SPEAKER_CARD_SQUARE];

  const snapshot = (radius: readonly [string, string]): FlipSnapshot => ({
    card: boxOf(cardRef.current),
    media: boxOf(mediaRef.current),
    parts: [nameRef, subtitleRef].map((ref) => boxOf(ref.current)),
    action: boxOf(actionRef.current),
    radius,
  });

  const warm = (): void => {
    if (largeUrl === null || warmedUrl.current === largeUrl) return;
    warmedUrl.current = largeUrl;
    preloadImage(largeUrl);
  };

  // ZWROT W TRAKCIE RUCHU zaczyna od promienia, ktory JEST na ekranie. Staly
  // poczatek (kwadrat albo kolo) dalby skok rogow przy szybkim podwojnym
  // kliknieciu. Promien trwajacej animacji jest w procentach, wiec nie zalezy
  // od skali. Czytamy go tylko wtedy, gdy NASZA animacja zdjecia jeszcze
  // trwa - w spoczynku `rounded-full` liczy sie do ogromnej wartosci w px.
  const liveMediaRadius = (): string | null => {
    const media = mediaRef.current;
    if (media === null || typeof getComputedStyle !== "function") return null;
    const live = running.current.some(
      (animation) =>
        animation != null &&
        animation.playState === "running" &&
        (animation.effect as KeyframeEffect | null)?.target === media,
    );
    if (!live) return null;
    const radius = getComputedStyle(media).borderTopLeftRadius;
    return radius === "" ? null : radius;
  };

  const toggle = (): void => {
    if (!expandable) return;
    warm();
    if (prefersReducedMotion()) {
      pending.current = null;
    } else {
      const [from, to] = radiusFor(expanded);
      pending.current = snapshot([liveMediaRadius() ?? from, to]);
    }
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
    const last = snapshot(first.radius);
    const easing = speakerCardEasing();
    const play = (
      element: Element | null,
      keyframes: Keyframe[] | null,
      curve: string = easing,
    ): void => {
      running.current.push(playKeyframes(element, keyframes, curve));
    };
    // GEOMETRIA BEZ PRZESTRZALU. Wysokosc karty i skala zdjecia jada krzywa,
    // ktora nie wychodzi poza 1: sprezyna wypychalaby zdjecie o kilka px za
    // kwadrat (na linie szczegolow), a przy zwijaniu dol karty stawal nad
    // dolem sasiadow w wierszu siatki. Sprezyna zostaje dla przesuniec.
    if (first.card !== null && last.card !== null) {
      play(cardRef.current, flipHeightKeyframes(first.card, last.card), SPEAKER_CARD_SETTLE);
    }
    if (first.media !== null && last.media !== null) {
      const [from, to] = first.radius;
      play(
        mediaRef.current,
        flipMediaKeyframes(first.media, last.media, from, to),
        SPEAKER_CARD_SETTLE,
      );
    }
    // NAPIS SIE PRZESUWA TYLKO PRZY ROZWIJANIU I TYLKO W JEDNEJ LINII.
    //   * W kilku liniach sie wylania: zwiniety jest wysrodkowany, rozwiniety
    //     - do lewej, a linie w pudelku zmieniaja wyrownanie w pierwszej
    //     klatce, czego przesuniecie pudelka nie zakryje.
    //   * Przy zwijaniu tez sie wylania, juz w ciemnym kolorze, pod malejacym
    //     zdjeciem. Bialy napis zsuwajacy sie ze zdjecia na biala karte byl
    //     przez pierwsze ~100 ms nieczytelny (a na jasnym zdjeciu bez
    //     gradientu - od pierwszej klatki). Kolor zmienia sie wtedy od razu:
    //     przejscie kolorow ma tylko stan na zdjeciu.
    [nameRef, subtitleRef].forEach((ref, index) => {
      const from = first.parts[index] ?? null;
      const to = last.parts[index] ?? null;
      if (from === null || to === null) return;
      const element = ref.current;
      play(
        element,
        !expanded || wrapsLines(element, from) || wrapsLines(element, to)
          ? flipFadeKeyframes()
          : flipShiftKeyframes(from, to),
      );
    });
    // Akcja stoi przy PRAWEJ krawedzi (`right-3`) i zmienia szerokosc
    // (wielokropek -> pelny napis), wiec FLIP wyrownuje prawe krawedzie -
    // inaczej pigulka przelatywalaby przez karte o roznice szerokosci.
    if (first.action !== null && last.action !== null) {
      play(actionRef.current, flipShiftKeyframes(rightEdge(first.action), rightEdge(last.action)));
    }
    if (expanded && detailsRef.current !== null) play(detailsRef.current, revealKeyframes());
    // `snapshot` czyta wylacznie refy - efekt reaguje tylko na zmiane stanu.
  }, [expanded]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Escape" && expanded) {
      event.stopPropagation();
      toggle();
      mediaRef.current?.focus();
    }
  };

  // Podpis stoi W PRZEPLYWIE naglowka, jak we wzorcu: zwiniety - wysrodkowany
  // pod kolem, rozwiniety - w lewym dolnym rogu kwadratu (naglowek ma wtedy
  // proporcje 1:1 i dosuwa tresc do dolu). `w-fit` trzyma pudelko przy
  // napisie, wiec FLIP przesuwa litery, a nie pusta szerokosc karty.
  // Na pelnym kadrze klik w napis nie jest celem - trafia w zdjecie pod nim.
  const caption = (
    <>
      {name !== "" && (
        <span
          ref={nameRef}
          title={name}
          className={cn(
            "block w-fit max-w-full text-xl font-medium leading-tight",
            fullBleed
              ? "pointer-events-none text-white transition-colors duration-300"
              : "mt-3 text-foreground",
          )}
        >
          {name}
        </span>
      )}
      {(role !== "" || organization !== "") && (
        <span
          ref={subtitleRef}
          className={cn(
            "mt-1 block w-fit max-w-full text-xs leading-snug",
            fullBleed
              ? "pointer-events-none text-white/85 transition-colors duration-300"
              : "text-muted-foreground",
          )}
        >
          {role !== "" && <span title={role}>{role}</span>}
          {role !== "" && organization !== "" && <span aria-hidden="true"> • </span>}
          {organization !== "" && <span title={organization}>{organization}</span>}
        </span>
      )}
    </>
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
  // Wypelniony przycisk tylko NA ZDJECIU (jak we wzorcu). Karta bez zdjecia
  // zostaje przy napisie - pigulka na bialym tle bylaby innym elementem.
  // Tlo, kolor, cien i odstepy zmieniaja sie RAZEM, w jednej klatce (jak we
  // wzorcu): przejscie samych kolorow zostawialo na starcie pusty cien.
  const actionClass = cn(
    "absolute right-3 top-3 z-20 block truncate rounded-[6px] text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]/60",
    fullBleed
      ? cn("px-3 py-1.5 shadow-sm", accent === null && "bg-brand text-brand-foreground")
      : "px-2 py-1 text-brand-ink hover:underline",
  );
  const actionStyle: CSSProperties = fullBleed
    ? accent === null
      ? { maxWidth: EXPANDED_ACTION_MAX_WIDTH }
      : {
          maxWidth: EXPANDED_ACTION_MAX_WIDTH,
          backgroundColor: accent,
          color: readableInkOn(accent),
        }
    : { maxWidth: COLLAPSED_ACTION_MAX_WIDTH };

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
        title={actionLabel}
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
        title={actionLabel}
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
        title={actionLabel}
        onClick={() => onSelect(speaker)}
        className={actionClass}
        style={actionStyle}
      >
        {actionLabel}
      </button>
    );
  }

  const toggleLabel = t(
    expanded ? "eventFront.speakers.card.collapse" : "eventFront.speakers.card.expand",
    { name, lng: lang },
  );

  let media: ReactNode;
  if (!expandable) {
    media = (
      <span className="block h-20 w-20 shrink-0 overflow-hidden rounded-full">
        <SpeakerAvatar name={name} photoUrl={thumbSource} size="xl" />
      </span>
    );
  } else {
    media = (
      <button
        ref={mediaRef}
        type="button"
        aria-expanded={expanded}
        aria-controls={hasDetails ? detailsId : undefined}
        aria-label={toggleLabel}
        onClick={toggle}
        onPointerEnter={hasPhoto ? warm : undefined}
        onFocus={hasPhoto ? warm : undefined}
        onTouchStart={hasPhoto ? warm : undefined}
        className={cn(
          "block shrink-0 overflow-hidden bg-muted focus-visible:outline-none",
          fullBleed
            ? "group absolute inset-0 -z-10 cursor-pointer rounded-none"
            : cn(
                "relative h-20 w-20 rounded-full focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]/60 focus-visible:ring-offset-2",
                hasPhoto ? "cursor-zoom-in" : "cursor-pointer",
              ),
        )}
      >
        {/* JEDNA MINIATURA W OBU STANACH, ten sam wezel. Wymiana na inny
            element przy zwijaniu montowala zdjecie od nowa z efektem
            pojawiania sie - pierwsza klatka zwijania byla pustym kwadratem
            z bialym podpisem na jasnym tle. Tu miniatura po prostu maleje. */}
        {thumbUrl !== null && failedThumbUrl !== thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            onError={() => setFailedThumbUrl(thumbUrl)}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <SpeakerAvatar name={name} photoUrl={null} size="xl" />
        )}
        {fullBleed && largeUrl !== null && failedLargeUrl !== largeUrl && (
          <img
            key={largeUrl}
            src={largeUrl}
            alt=""
            decoding="async"
            onError={() => setFailedLargeUrl(largeUrl)}
            className="oi-fade-in absolute inset-0 size-full object-cover"
          />
        )}
        {fullBleed && (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/40 to-transparent"
          />
        )}
        {/* FOKUS NA PELNYM KADRZE rysuje ostatnie dziecko, NAD zdjeciem.
            Obwodka samego przycisku (cien albo obrys) maluje sie pod jego
            pozycjonowanymi dziecmi, wiec zdjecie ja zaslanialo - klawiatura
            nie widziala, gdzie jest fokus (WCAG 2.4.7). */}
        {fullBleed && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-0 group-focus-visible:opacity-100"
            style={FULL_BLEED_FOCUS_RING}
          />
        )}
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
      <div
        className={cn(
          "relative isolate flex w-full flex-col",
          fullBleed
            ? "aspect-square items-start justify-end p-4"
            : "items-center px-5 pb-5 pt-8 text-center",
        )}
      >
        {media}
        {caption}
      </div>
      {/* Akcja PO naglowku w drzewie: kolejnosc Tab to zdjecie, potem
          przycisk - rysunek (prawy gorny rog) ustawia pozycjonowanie. */}
      {actionNode}
      {hasDetails && (
        <div
          ref={detailsRef}
          id={detailsId}
          hidden={!expanded}
          className={cn(
            "w-full flex-col items-start gap-3 border-t border-border px-5 py-4",
            expanded ? "flex" : "hidden",
          )}
        >
          {/* Plakietka z WIDOCZNYM napisem: w szczegolach nie ma nazwiska,
              obok ktorego sama ikona bylaby czytelna. */}
          {speaker.is_expert && <SpeakerExpertBadge withLabel lang={lang} />}
          {hasTracks && (
            <div className="flex w-full flex-col items-start gap-1.5">
              {/* Naglowek dla oka; czytnik ekranu dostaje go z chipow. */}
              <span
                aria-hidden="true"
                className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t("eventFront.speakers.card.tracksLabel", { lng: lang })}
              </span>
              <SpeakerTrackChips tracks={tracks} lang={lang} />
            </div>
          )}
        </div>
      )}
    </article>
  );
}
