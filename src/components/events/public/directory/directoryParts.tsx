// Części okna profilu - wspólne dla widoku osoby i widoku instytucji.
//
// TYPOGRAFIA ZAMIAST DEKORACJI. Okno nie ma gradientów, poświat ani kafli
// z ikonami: hierarchię niosą wersaliki z rozstrzałem (nadtytuł sekcji),
// włosowe linie między sekcjami i liczby o stałej szerokości w godzinach.
// Kolor marki pojawia się tylko tam, gdzie coś można kliknąć.
//
// RUCH TYLKO PO KLIKNIĘCIU I TYLKO DLA TYCH, KTÓRZY GO CHCĄ. Sekcje wchodzą
// z opóźnieniem 40 ms jedna po drugiej (`motion-safe:animate-in`), więc okno
// nie „wyskakuje" całym blokiem - a przy `prefers-reduced-motion` stoi od
// razu. Okno otwiera klik, więc ruch nie wchodzi w ślad wczytania strony
// (Speed Index), inaczej niż animacja przy montażu.
//
// WYŁĄCZNIE KLASY, KTÓRE ARKUSZ JUŻ MA. Budżet CSS nie ma zapasu (komentarz
// bloku „ZAKŁADKI MODUŁOWE WYDARZENIA" w `src/styles.css`), więc ruch, stany
// najechania i siatki wierszy składamy z istniejących narzędzi - nowa wartość
// arbitralna to nowa reguła w arkuszu każdej strony.
import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AppLink } from "@/components/atoms/AppLink";
import { SpeakerAvatar } from "@/components/events/SpeakerAvatar";
import { buildTransformedImageUrl } from "@/lib/cropSizes";
import type { DirectoryPerson, DirectorySession } from "@/lib/events/eventDirectory";
import { formatEventDate, formatEventTime } from "@/lib/events/timezone";
import { agendaSessionAnchor } from "@/lib/events/agendaSurface";
import { ArrowRight } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";

/** Klasa wejścia sekcji - opóźnienie podaje `revealStyle(index)`. */
export const REVEAL_CLASS =
  "motion-safe:animate-in motion-safe:fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-500";

export function revealStyle(index: number): CSSProperties {
  return { animationDelay: `${Math.min(index, 8) * 40}ms` };
}

/** Nadtytuł: wersaliki, rozstrzał, kolor przygaszony. */
export function Overline({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold uppercase leading-4 tracking-[0.14em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Sekcja okna: włosowa linia, nadtytuł, treść. */
export function DirectorySection({
  title,
  index,
  aside,
  children,
}: {
  title: string;
  index: number;
  /** Treść po prawej nadtytułu (licznik, odnośnik). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={cn("border-t border-border/70 pt-5", REVEAL_CLASS)}
      style={revealStyle(index)}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <Overline>
          <span role="heading" aria-level={3}>
            {title}
          </span>
        </Overline>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Akapit opisu - zachowuje podziały wierszy redakcji, czyta się jak tekst, nie etykieta. */
export function DirectoryProse({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-line text-[15px] leading-7 text-foreground/85 [overflow-wrap:anywhere]">
      {text}
    </p>
  );
}

/** Portret w nagłówku widoku osoby - kwadrat 6 px jak każde zdjęcie profilowe. */
export function DirectoryPortrait({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const url =
    photoUrl === null
      ? null
      : buildTransformedImageUrl(photoUrl, { width: 240, height: 240, resize: "cover" });
  if (url === null || failed === url) {
    return (
      <SpeakerAvatar name={name} photoUrl={null} size="xl" className="sm:h-24 sm:w-24 sm:text-xl" />
    );
  }
  return (
    <span className="block h-20 w-20 shrink-0 overflow-hidden rounded-[6px] bg-muted sm:h-24 sm:w-24">
      <img
        src={url}
        alt=""
        width={240}
        height={240}
        decoding="async"
        onError={() => setFailed(url)}
        className="size-full object-cover"
      />
    </span>
  );
}

const ROW_CLASS =
  "group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4 py-3 text-left";

/**
 * Wiersz sesji: godzina i dzień po lewej (cyfry o stałej szerokości), tytuł
 * i rola w obsadzie po prawej. Wiersz jest przyciskiem (agenda odsłania blok
 * sesji), odnośnikiem (inne zakładki prowadzą do agendy) albo tekstem
 * (podgląd studia).
 */
export function DirectorySessionList({
  sessions,
  lang,
  slug,
  live,
  onSessionSelect,
}: {
  sessions: readonly DirectorySession[];
  lang: "pl" | "en";
  slug: string | null;
  live: boolean;
  onSessionSelect?: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y divide-border/60">
      {sessions.map((session) => {
        const time = formatEventTime(session.startsAt, session.timezone, lang);
        const day = formatEventDate(session.startsAt, session.timezone, lang);
        const meta = [
          session.role === null ? "" : t(sessionRoleKey(session.role)),
          session.room ?? "",
          session.cancelled ? t("eventFront.directory.cancelled") : "",
        ].filter((part) => part !== "");
        const body = (
          <>
            <span className="w-20 pt-0.5 text-xs tabular-nums leading-5 text-muted-foreground">
              <span className="block font-semibold text-foreground">{time}</span>
              {day}
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-sm font-medium leading-snug text-foreground [overflow-wrap:anywhere]",
                  session.cancelled && "text-muted-foreground line-through",
                )}
              >
                {session.title}
              </span>
              {meta.length > 0 ? (
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {meta.join(" · ")}
                </span>
              ) : null}
            </span>
            <RowArrow />
          </>
        );
        if (onSessionSelect !== undefined) {
          return (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => onSessionSelect(session.id)}
                className={cn(ROW_CLASS, ROW_INTERACTIVE_CLASS)}
              >
                {body}
              </button>
            </li>
          );
        }
        if (live && slug !== null) {
          return (
            <li key={session.id}>
              <AppLink
                href={`/events/${encodeURIComponent(slug)}/agenda#${agendaSessionAnchor(session.id)}`}
                className={cn(ROW_CLASS, ROW_INTERACTIVE_CLASS)}
              >
                {body}
              </AppLink>
            </li>
          );
        }
        return (
          <li key={session.id} className={ROW_CLASS}>
            {body}
          </li>
        );
      })}
    </ul>
  );
}

// Pole trafienia i tło najechania wystają 8 px poza tekst (`-mx-2` + `px-2`
// przy `box-content`), a linie między wierszami zostają w kolumnie sekcji -
// równo z włosowymi liniami nad nimi.
const ROW_INTERACTIVE_CLASS =
  "-mx-2 box-content rounded-[6px] px-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Włosowa strzałka „↗" odnośnika wychodzącego - przekątna z otwartym
 * narożnikiem, ten sam rysunek co akcja etykiety sekcji (`NorthEastArrow`),
 * tu w kopii: moduł etykiet sekcji to ~1,4 tys. linii buildera, a ta strona
 * potrzebuje z niego jednej ścieżki SVG.
 */
export function NorthEastHairline({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-3 shrink-0", className)}
    >
      <path d="M2.2 7.8 7.8 2.2M3.6 2.2h4.2v4.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Strzałka wiersza: wsuwa się o 2 px przy najechaniu - jedyny ruch wiersza. */
const ARROW_CLASS =
  "mt-1 shrink-0 text-muted-foreground/70 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none";

export function RowArrow({ external = false }: { external?: boolean }) {
  if (external) return <NorthEastHairline className={ARROW_CLASS} />;
  return (
    <ArrowRight aria-hidden="true" strokeWidth={1.5} className={cn(ARROW_CLASS, "size-3.5")} />
  );
}

/** Klucz słownika roli w obsadzie - ten sam, co plakietka w bloku agendy. */
export function sessionRoleKey(role: string): string {
  if (role === "moderator") return "eventFront.agenda.speakerRole.moderator";
  if (role === "panelist") return "eventFront.agenda.speakerRole.panelist";
  if (role === "host") return "eventFront.agenda.speakerRole.host";
  return "eventFront.agenda.speakerRole.speaker";
}

/** Wiersz osoby w oknie instytucji - klik przechodzi do jej profilu. */
export function DirectoryPeopleList({
  people,
  onOpen,
}: {
  people: readonly DirectoryPerson[];
  onOpen: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y divide-border/60">
      {people.map((person) => (
        <li key={person.key}>
          <button
            type="button"
            onClick={() => onOpen(person.key)}
            aria-label={t("eventFront.directory.openPerson", { name: person.name })}
            className={cn(
              "group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 text-left",
              ROW_INTERACTIVE_CLASS,
            )}
          >
            <SpeakerAvatar name={person.name} photoUrl={person.avatarUrl} size="md" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">
                {person.name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {[person.isSpeaker ? t("eventFront.directory.kind.speaker") : "", person.position]
                  .filter((part) => part !== "")
                  .join(" · ")}
              </span>
            </span>
            <RowArrow />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Odnośnik wychodzący w stopce okna - tekstem w podglądzie studia. */
export function DirectoryFooterLink({
  href,
  external,
  live,
  children,
  onClick,
  onAuxClick,
}: {
  href: string;
  external: boolean;
  live: boolean;
  children: ReactNode;
  onClick?: () => void;
  onAuxClick?: (event: MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const className =
    "group inline-flex items-center gap-1.5 rounded-[6px] text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  if (!live) {
    return (
      <span className={className}>
        {children}
        <RowArrow external={external} />
      </span>
    );
  }
  const content = (
    <>
      {children}
      <RowArrow external={external} />
    </>
  );
  if (external) {
    // `nofollow`: wychodzą stąd wyłącznie strony instytucji - partnera
    // (odnośnik opłacony, ta sama reguła co kafel partnera) albo wpisana przez
    // uczestnika. Ani jedna nie dostaje od wydarzenia rankingu.
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={onClick}
        onAuxClick={onAuxClick}
        className={className}
      >
        {content}
        <span className="sr-only"> {t("eventFront.speakers.card.opensInNewTab")}</span>
      </a>
    );
  }
  return (
    <AppLink href={href} className={className}>
      {content}
    </AppLink>
  );
}

/** Domena strony do podpisu - „https://www.cpk.pl/o-nas" -> „cpk.pl". */
export function websiteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
