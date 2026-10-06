// Powłoka karty strumienia huba - wspólny szkielet wszystkich rodzajów wpisu.
//
// UKŁAD JEST UKŁADEM SIECI ZAWODOWEJ, NIE LISTY. Do tej pory pozycja
// strumienia była wierszem dossier: grzbiet rodzaju, pasek meta, tytuł,
// metryki w prawej kolumnie. To działało jak spis treści, ale nie jak
// rozmowa - autor był jednym z dziesięciu elementów paska meta, a reakcje
// i przejście do dyskusji kryły się pod przyciemnionym paskiem akcji.
// Karta czyta się teraz tak, jak czyta się wpis w serwisie społecznościowym
// dla profesjonalistów, w stałej kolejności pięciu stref:
//
//   1. KONTEKST  - jedna cienka linia nad kartą: CO to jest i GDZIE (rodzaj,
//                  dział, obszar, status, przypięcie). Oddzielona włosem.
//   2. AUTOR     - twarz 48 px, nazwisko z firmą, stanowisko, czas względny.
//   3. TREŚĆ     - tytuł i trzy linie tekstu z „…więcej"; media od krawędzi
//                  do krawędzi karty (`ClubFeedMedia`), bo to one niosą treść.
//   4. LICZNIKI  - kto i ile zareagował po lewej, odpowiedzi po prawej.
//   5. AKCJE     - równe kolumny: zareaguj, komentuj, udostępnij.
//
// Strefy są OPCJONALNE (termin nie ma autora, etap nie ma liczników), ale
// kolejność i odstępy są wspólne - dzięki temu kolumna kart różnych rodzajów
// ma jeden rytm, a oko uczy się, gdzie szukać autora i gdzie akcji.
//
// RUCH. Karta wchodzi krótkim uniesieniem (`club-feed-card-in`, kaskada po
// indeksie), krawędź przy najeździe przyjmuje kolor rodzaju - jak dawny
// wiersz dossier - a `prefers-reduced-motion` wyłącza wszystko poza kolorem.
import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HUB_SURFACE } from "@/components/clubs/atoms/ClubHubPrimitives";
import {
  clubDossierIconBoxClass,
  clubDossierToneColor,
  type ClubDossierTone,
} from "@/components/clubs/atoms/ClubDossierRow";
import { relTime } from "@/lib/notifications/notificationText";
import {
  feedClockServerSnapshot,
  feedClockSnapshot,
  subscribeFeedClock,
} from "@/lib/clubs/feedClock";
import { formatDateShort, formatDateTime, type UiLang } from "@/lib/i18n/format";

/** Poziomy oddech wszystkich stref - jedna wartość, żeby krawędzie się zgadzały. */
export const CLUB_FEED_PAD = "px-3.5 sm:px-4";

/** Kaskada wejścia urywa się po kilku kartach - dalsze nie mają czekać. */
const STAGGER_CAP = 6;

export function ClubFeedCard({
  tone,
  index = 0,
  testId,
  postId,
  unread = false,
  pinned = false,
  className,
  children,
}: {
  /** Rodzaj wpisu - kolor krawędzi przy najeździe i etykiety rodzaju. */
  tone: ClubDossierTone;
  /** Pozycja w strumieniu - opóźnienie wejścia. */
  index?: number;
  testId?: string;
  postId?: string;
  unread?: boolean;
  pinned?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const style = {
    "--dossier-tone": clubDossierToneColor(tone),
    "--feed-i": Math.min(Math.max(index, 0), STAGGER_CAP),
  } as CSSProperties;

  return (
    <article
      data-testid={testId}
      data-tone={tone}
      data-post-id={postId}
      data-unread={unread ? "" : undefined}
      style={style}
      className={cn(
        HUB_SURFACE,
        "club-feed-card-in relative",
        "transition-colors duration-300 ease-out",
        "hover:border-[color-mix(in_oklab,var(--dossier-tone)_40%,transparent)]",
        "focus-within:border-[color-mix(in_oklab,var(--dossier-tone)_40%,transparent)]",
        pinned && "border-primary/40",
        className,
      )}
    >
      {children}
    </article>
  );
}

/**
 * Linia kontekstu nad kartą: rodzaj, miejsce, statusy. Po prawej drobne
 * sygnały (przypięcie, dynamika). Włos pod spodem jest wcięty jak treść.
 */
export function ClubFeedContext({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className={CLUB_FEED_PAD}>
      <div
        className="flex min-h-10 items-center gap-2 border-b border-border/50 py-2 text-xs text-muted-foreground"
        data-feed-zone="context"
      >
        {/* Na telefonie linia kontekstu zostaje JEDNĄ linią (przewijaną w bok),
            zamiast rozlewać rodzaj, dział i temat na trzy rzędy nad autorem. */}
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-x-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*:not([data-feed-shrink])]:shrink-0",
            "sm:flex-wrap sm:gap-y-1 sm:overflow-visible",
          )}
        >
          {children}
        </div>
        {trailing !== undefined ? (
          <div className="flex shrink-0 items-center gap-2.5">{trailing}</div>
        ) : null}
      </div>
    </div>
  );
}

/** Nagłówek autora: twarz, nazwisko, stanowisko, czas - i menu w rogu. */
export function ClubFeedActor({
  avatar,
  name,
  headline,
  meta,
  trailing,
}: {
  avatar: ReactNode;
  name: ReactNode;
  headline?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <header className={cn("flex items-start gap-3 pt-3", CLUB_FEED_PAD)} data-feed-zone="actor">
      <div className="shrink-0">{avatar}</div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">{name}</div>
        {headline !== undefined && headline !== null && headline !== "" ? (
          <p className="mt-0.5 truncate text-xs leading-4 text-muted-foreground">{headline}</p>
        ) : null}
        {meta !== undefined ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-4 text-muted-foreground">
            {meta}
          </div>
        ) : null}
      </div>
      {trailing !== undefined ? <div className="-mr-1.5 -mt-1 shrink-0">{trailing}</div> : null}
    </header>
  );
}

/**
 * Twarz karty bez autora (termin, etap, materiały): kwadrat rodzaju w tym
 * samym rozmiarze co awatar, więc nagłówki wszystkich kart stoją w jednej linii.
 */
export function ClubFeedKindAvatar({
  tone,
  children,
}: {
  tone: ClubDossierTone;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-12 w-12 place-items-center rounded-lg border [&_svg]:h-5 [&_svg]:w-5",
        clubDossierIconBoxClass(tone),
      )}
    >
      {children}
    </span>
  );
}

/**
 * Czas publikacji. Na serwerze i w pierwszym renderze klienta - data (ten sam
 * tekst po obu stronach, zero rozjazdu hydracji); po hydracji - czas względny
 * („2 dni temu"), który w strumieniu czyta się szybciej niż data i który
 * odświeża się ze wspólnego zegara strumienia (`feedClock`).
 */
export function ClubFeedTime({ iso, lang }: { iso: string; lang: UiLang }) {
  const now = useSyncExternalStore(subscribeFeedClock, feedClockSnapshot, feedClockServerSnapshot);
  return (
    <time dateTime={iso} title={formatDateTime(iso, lang)}>
      {/* Zegar tyka co 30 s, a wpis może być świeższy niż ostatnie tyknięcie
          (albo zegar klienta spóźnia się względem serwera) - punkt odniesienia
          nigdy nie jest wcześniejszy niż sam wpis, więc nie ma „za 20 sekund". */}
      {now === 0 ? formatDateShort(iso, lang) : relTime(iso, lang, Math.max(now, Date.parse(iso)))}
    </time>
  );
}

/** Pas liczników: reakcje po lewej, rozmowa po prawej. Pusty - nie istnieje. */
export function ClubFeedSocialRow({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const hasLeft = left !== undefined && left !== null && left !== false;
  const hasRight = right !== undefined && right !== null && right !== false;
  if (!hasLeft && !hasRight) return null;
  return (
    <div
      className={cn(
        "flex min-h-9 items-center justify-between gap-3 pt-2.5 text-xs text-muted-foreground",
        CLUB_FEED_PAD,
      )}
      data-feed-zone="social"
    >
      <div className="flex min-w-0 items-center gap-1.5">{hasLeft ? left : null}</div>
      <div className="flex shrink-0 items-center gap-1.5">{hasRight ? right : null}</div>
    </div>
  );
}

/** Pas akcji: włos wcięty jak treść, pod nim równe kolumny przycisków. */
export function ClubFeedActionBar({
  children,
  label,
  testId,
}: {
  children: ReactNode;
  /** Nazwa grupy dla czytnika ekranu. */
  label?: string;
  testId?: string;
}) {
  return (
    <div className="pt-2" data-feed-zone="actions" data-testid={testId}>
      <div className={CLUB_FEED_PAD}>
        <div className="border-t border-border/60" />
      </div>
      <div role="group" aria-label={label} className="flex items-stretch gap-1 px-1.5 py-1 sm:px-2">
        {children}
      </div>
    </div>
  );
}

/**
 * Geometria jednej akcji. Wspólna dla `<button>` i `<Link>`, bo reakcja
 * zostaje na miejscu, a komentarz prowadzi do wątku - a obie mają wyglądać
 * i reagować tak samo. Na telefonie piktogram stoi nad podpisem, żeby trzy
 * akcje zmieściły się bez ucinania słów.
 */
export function clubFeedActionClass(options?: { className?: string }): string {
  return cn(
    "group/feed-act relative inline-flex min-h-11 min-w-0 flex-1 select-none flex-col items-center justify-center gap-0.5 rounded-lg px-2",
    "text-[11px] font-semibold text-muted-foreground sm:min-h-10 sm:flex-row sm:gap-2 sm:text-sm",
    "transition-[background-color,color,scale] duration-150 ease-out",
    "hover:bg-muted/70 hover:text-foreground active:scale-[0.97] motion-reduce:active:scale-100",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    options?.className,
  );
}

/** Piktogram akcji - jeden rozmiar dla wszystkich kolumn. */
export const CLUB_FEED_ACTION_ICON = "h-[18px] w-[18px] shrink-0";

/**
 * Pas mediów od krawędzi do krawędzi karty. Bez wcięcia - zdjęcie, wykres
 * i podgląd linku są treścią, nie ozdobą, i dostają pełną szerokość.
 */
export function ClubFeedMedia({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-3", className)} data-feed-zone="media">
      {children}
    </div>
  );
}
