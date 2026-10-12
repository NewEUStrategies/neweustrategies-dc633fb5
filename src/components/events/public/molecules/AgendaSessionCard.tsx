// Molekuła: jeden BLOK sesji programu w układzie ekranu wzorcowego.
//
// TYTUŁ, CZAS, OBSADA - W TEJ KOLEJNOŚCI. Wzorzec stawia u góry pogrubiony
// tytuł, pod nim ikonę zegara z przedziałem („27 lis 2024, 10:00 do 11:45”),
// a pod spodem rząd prelegentów - miniatura zdjęcia plus nazwisko i organizacja.
// Poprzedni układ prowadził godziną w osobnej kolumnie po lewej; zmiana jest
// PREZENTACYJNA, dane i reguła zapisu zostają te same.
//
// BLOK, NIE KARTA. Sesje rozdziela cienka linia rysowana przez listę (`divide-y`),
// więc blok nie ma własnej ramki - inaczej program byłby stosem prostokątów
// w prostokącie. Kolor nurtu zostaje jako trzypikselowy AKCENT po lewej, a wcięcie
// jest STAŁE (także bez nurtu), żeby tytuły w jednej liście trzymały jedną linię.
//
// PRZEDZIAŁ LICZY SIĘ W STREFIE WYDARZENIA. Uczestnik z Brukseli czyta „10:00”
// inaczej niż organizator w Warszawie i przychodzi o złej porze - dlatego godziny
// idą przez `formatEventDateTime` ze strefą sesji, a nie przez `Date` przeglądarki.
// Sesja przechodząca przez północ dostaje w końcówce PEŁNĄ datę: samo „01:30”
// obok „23:00” czyta się jak literówka, a nie jak nocny panel.
//
// PUSTY RZĄD TO USZKODZONE DANE. Sesja bez obsady nie zostawia nagłówka „Prelegenci”
// nad niczym, a prelegent bez nazwy do wyświetlenia nie dostaje wiersza z pogrubioną
// pustką - takie miejsca czytają się jak awaria strony, a nie jak brak informacji.
//
// OBSADA STOI OBOK STANU SESJI, NIE POD PRZYCISKAMI. Prelegenci mają własną
// kolumnę po prawej stronie plakietek, formatu i „Pokaż szczegóły" - tam, gdzie
// wzorzec zostawiał pustą przestrzeń - więc zdjęcia osób są widoczne od razu,
// bez przewijania pod zapis. Opis sesji po rozwinięciu idzie na PEŁNĄ
// szerokość pod obiema kolumnami: tekst w wąskiej kolumnie plakietek czytałby
// się jak przypis.
//
// ŚCIEŻKI PRELEGENTA SĄ WYPROWADZONE. Po rozwinięciu szczegółów przy każdym
// nazwisku stają ścieżki, w których ta osoba występuje - policzone z tej samej
// listy sesji, którą rysuje program (`agendaSpeakerTracks`). Przypisanie do
// sesji w ścieżce dopisuje ścieżkę samo; nie ma drugiego rejestru do
// rozjechania.
//
// KONTROLKA POCHODZI Z REGUŁY, NIE Z `if`-ów. `agendaSignupControl` decyduje,
// czy przycisk jest, co na nim pisze i jak wygląda - ten sam rachunek obsługuje
// „moją agendę", więc obie powierzchnie nie mogą się rozjechać.
//
// OSOBA I PARTNER OTWIERAJĄ OKNO - TYLKO NA ZAKŁADCE „AGENDA". Pod dostawcą
// okien (`EventDirectoryProvider`) wiersz prelegenta otwiera jego profil
// (biogram, instytucja, wszystkie jego sesje), a znaczek partnera - okno
// instytucji. Przycisk obejmuje nazwisko, a jego `::after` rozciąga się na cały
// wiersz (wzorzec „rozciągniętego przycisku"): rola, organizacja i ścieżki
// zostają zwykłym tekstem, więc czytnik ekranu dalej je czyta, a w przycisku nie
// ma zagnieżdżonych elementów interaktywnych. Bez dostawcy (strona główna)
// wyzwalacz jest zwykłym tekstem o tym samym wyglądzie - bez kursora i bez
// reakcji na najechanie, bo przycisk, który niczego nie otwiera, byłby atrapą.
//
// KARTA JEST `memo`. Wpisanie litery w wyszukiwarkę albo zapis na JEDNĄ sesję
// przerysowywały wcześniej każdy blok dnia (kilkanaście formatowań `Intl` na
// blok). Rodzic podaje stabilne uchwyty i `pending` jako wartość logiczną, więc
// blok rysuje się ponownie tylko wtedy, gdy zmieniło się coś, co w nim widać.
import { memo, useId, useRef, useState } from "react";
import { ChevronDown, Clock, DoorOpen, Landmark, Loader2, Radio, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { uiLang, type UiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import {
  eventDayKey,
  formatEventDate,
  formatEventDateTime,
  formatEventTime,
} from "@/lib/events/timezone";
import {
  agendaFormatKey,
  agendaSeatsLeft,
  agendaSessionAnchor,
  agendaSessionTitle,
  agendaSignupControl,
  type AgendaSession,
  type AgendaSpeaker,
} from "@/lib/events/agendaSurface";
import { hasNamedSpeakerTrack, type SpeakerTrack } from "@/lib/events/speakerCard";
import { SessionStateBadge } from "@/components/events/public/atoms/SessionStateBadge";
import {
  DirectoryCompanyTrigger,
  DirectoryPersonTrigger,
  useEventDirectory,
} from "@/components/events/public/directory/EventDirectoryContext";
import { directoryOrgKey } from "@/lib/events/eventDirectory";
import { SpeakerAvatar } from "@/components/events/SpeakerAvatar";
import { SpeakerTrackChips } from "@/components/events/SpeakerTrackChips";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
import { mediaRenderUrl } from "@/lib/media/publicUrl";
import { useSponsorImpression } from "@/lib/events/sponsorTrackingReact";

ensureEventFrontI18n();

/**
 * Wiersz prelegenta w bloku sesji: okrągła miniatura zdjęcia (u nas promień 6px -
 * spec zdjęć profilowych zostaje) plus dwie linie tekstu.
 *
 * ORGANIZACJA POCHODZI Z `headline`, BO AGENDA NIE ODDAJE FIRMY. `event_agenda`
 * buduje obsadę z `speaker_profiles.headline_pl/en`; osobnej kolumny z organizacją
 * w tym RPC nie ma, a dołożenie jej to zmiana kontraktu bazy, nie widoku.
 */
function speakerRoleLabelKey(role: string | null): string {
  if (role === "moderator") return "eventFront.agenda.speakerRole.moderator";
  if (role === "panelist") return "eventFront.agenda.speakerRole.panelist";
  if (role === "host") return "eventFront.agenda.speakerRole.host";
  return "eventFront.agenda.speakerRole.speaker";
}

function sponsorRoleKey(role: string | null): string | null {
  if (role === "sponsor") return "eventFront.sponsors.roles.sponsor";
  if (role === "partner") return "eventFront.sponsors.roles.partner";
  if (role === "media_partner") return "eventFront.sponsors.roles.mediaPartner";
  if (role === "exhibitor") return "eventFront.sponsors.roles.exhibitor";
  return null;
}

/**
 * Reakcja na najechanie - wyłącznie pod dostawcą okien. Zdjęcie przybliża się
 * o 3 % krzywą „ease-out-expo" (ten sam ruch, co portrety na zakładce
 * prelegentów), nazwisko dostaje cienkie podkreślenie w przygaszonym kolorze
 * akcji (marka tylko tam, gdzie coś można kliknąć); nic nie skacze ani nie
 * zmienia koloru tła, a `prefers-reduced-motion` zostawia samą linię.
 * Wyłącznie klasy, które arkusz już ma - budżet CSS nie ma zapasu.
 */
const AVATAR_HOVER_CLASS =
  "transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03] motion-reduce:transition-none";
const NAME_HOVER_CLASS = "underline-offset-4 decoration-primary/40 group-hover:underline";
/** Rozciągnięty przycisk: `::after` liczony od najbliższego `relative` (wiersz, znaczek). */
const STRETCHED_CLASS = "rounded-[4px] after:absolute after:inset-0";

function AgendaSpeakerRow({
  speaker,
  lang,
  tracks,
  showTracks,
  interactive,
}: {
  speaker: AgendaSpeaker;
  lang: UiLang;
  tracks: readonly SpeakerTrack[];
  /** Ścieżki stają przy nazwisku dopiero po rozwinięciu szczegółów sesji. */
  showTracks: boolean;
  /** Pod dostawcą okien wiersz otwiera profil osoby. */
  interactive: boolean;
}) {
  const { t } = useTranslation();
  const headline = pickLocalized(
    { headline_pl: speaker.headlinePl, headline_en: speaker.headlineEn },
    "headline",
    lang,
  );
  return (
    <li className={cn("flex min-w-0 items-start gap-2.5", interactive && "group relative")}>
      <SpeakerAvatar
        name={speaker.displayName}
        photoUrl={speaker.avatarUrl}
        size="md"
        className={interactive ? AVATAR_HOVER_CLASS : undefined}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {/* Klucz osoby to SUROWY identyfikator z obsady (konto albo kartoteka
              osoby bez konta) - katalog rozwiązuje go przez aliasy także wtedy,
              gdy wiersz listy prelegentów nadał tej osobie inny klucz. */}
          <DirectoryPersonTrigger
            personKey={speaker.userId}
            label={t("eventFront.directory.openPerson", { name: speaker.displayName })}
            // Rozciągnięty przycisk przykrywa `title` uciętej organizacji niżej.
            title={headline === "" ? speaker.displayName : `${speaker.displayName} · ${headline}`}
            className={cn(
              "truncate text-sm font-semibold leading-tight text-foreground",
              interactive && cn(STRETCHED_CLASS, NAME_HOVER_CLASS),
            )}
          >
            {speaker.displayName}
          </DirectoryPersonTrigger>
          <span className="rounded-[4px] border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            {t(speakerRoleLabelKey(speaker.role))}
          </span>
        </span>
        {headline !== "" && (
          // Ucięta nazwa organizacji zostaje w `title` - w trzech kolumnach
          // wielokropek jest właściwy dla układu, ale strata informacji nie.
          <span
            className="block truncate text-xs leading-tight text-muted-foreground"
            title={headline}
          >
            {headline}
          </span>
        )}
        {showTracks && tracks.length > 0 && (
          <SpeakerTrackChips
            tracks={tracks}
            lang={lang}
            label={t("eventFront.agenda.speakerTracksLabel")}
            className="mt-1.5"
          />
        )}
      </span>
    </li>
  );
}

/**
 * Znaczek sponsora sesji albo ścieżki. Dla raportu sponsora liczy WYŁĄCZNIE
 * wyświetlenie (znaczek nie jest odnośnikiem): pod miejscem `agenda_session`,
 * gdy sponsor jest przypięty do sesji, a `agenda_track`, gdy dziedziczy go
 * ze ścieżki. Pomiar działa tylko pod dostawcą publicznej powłoki - w
 * podglądzie studia ten sam znaczek niczego nie wysyła.
 */
function AgendaSponsorBadge({
  sponsorId,
  name,
  logoUrl,
  roleLabel,
  placement,
  interactive,
}: {
  sponsorId: string;
  name: string;
  logoUrl: string | null;
  roleLabel: string;
  placement: "agenda_session" | "agenda_track";
  /** Pod dostawcą okien znaczek otwiera okno instytucji. */
  interactive: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  // Pomiar wyświetlenia zostaje na OBUDOWIE: otwarcie okna nie jest kliknięciem
  // w partnera (agenda przyjmuje w raporcie wyłącznie `view`), a obudowa jest
  // tym, co uczestnik widzi - także wtedy, gdy przycisku nie ma.
  useSponsorImpression(ref, { sponsorId, placement });
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-[6px] border border-border bg-muted/30 p-3",
        interactive && "group relative transition-colors duration-300 hover:border-foreground/25",
      )}
    >
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{roleLabel}</p>
      <div className="mt-2 flex items-center gap-2">
        {logoUrl !== null && (
          <img
            src={mediaRenderUrl(logoUrl)}
            alt=""
            loading="lazy"
            className="h-8 w-12 rounded-[4px] object-contain"
          />
        )}
        <DirectoryCompanyTrigger
          orgKey={directoryOrgKey(name)}
          name={name}
          logoUrl={logoUrl}
          label={t("eventFront.directory.openCompany", { name })}
          title={name}
          className={cn(
            "min-w-0 truncate text-sm font-semibold text-foreground",
            interactive && cn(STRETCHED_CLASS, NAME_HOVER_CLASS),
          )}
        >
          {/* Ucięta nazwa zostaje w `title` - wąska kolumna znaczka tnie długie
              nazwy instytucji wielokropkiem. Pod dostawcą okien niesie ją sam
              przycisk (podpowiedź dziecka spod warstwy przycisku nie wyskoczy). */}
          <span title={name}>{name}</span>
        </DirectoryCompanyTrigger>
      </div>
    </div>
  );
}

/** Wspólna pusta lista - osoba bez ścieżek nie dostaje nowej tablicy na render. */
const NO_TRACKS: readonly SpeakerTrack[] = [];

/** Ścieżka samej sesji - gdy program nie podał indeksu całej agendy. */
function ownTrack(session: AgendaSession): SpeakerTrack[] {
  if (session.track === null) return [];
  return [
    {
      id: session.track.id,
      key: session.track.key,
      namePl: session.track.namePl,
      nameEn: session.track.nameEn,
      accentColor: session.track.accentColor,
      sessionsCount: 1,
    },
  ];
}

export const AgendaSessionCard = memo(function AgendaSessionCard({
  session,
  pending,
  signedIn,
  onSignup,
  onCancel,
  speakerTracks,
}: {
  session: AgendaSession;
  pending: boolean;
  signedIn: boolean;
  onSignup: (session: AgendaSession) => void;
  onCancel: (session: AgendaSession) => void;
  /**
   * Ścieżki prelegentów z CAŁEGO programu (`agendaSpeakerTracks`). Bez indeksu
   * karta zna tylko własną ścieżkę sesji - i tylko ją pokaże.
   */
  speakerTracks?: ReadonlyMap<string, readonly SpeakerTrack[]>;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const interactive = useEventDirectory() !== null;
  const [open, setOpen] = useState(false);
  // `useId` jest stabilny między serwerem a klientem, więc wskazanie regionu
  // opisu nie rozjeżdża hydratacji.
  const detailsId = useId();
  const speakersId = useId();

  // Tytuł idzie przez wspólną regułę, bo ten sam napis pokazuje kolumna
  // „Twój harmonogram” - dwa rachunki rozjechałyby się na sesji wpisanej
  // tylko w jednym języku.
  const title = agendaSessionTitle(session, lang);
  const description = pickLocalized(
    { description_pl: session.descriptionPl, description_en: session.descriptionEn },
    "description",
    lang,
  );
  const trackName =
    session.track === null
      ? ""
      : pickLocalized(
          { name_pl: session.track.namePl, name_en: session.track.nameEn },
          "name",
          lang,
        );

  // Godziny formatujemy RAZ: ta sama godzina stoi w kolumnie akcentu i w
  // przedziale pod tytułem, a każde wywołanie to osobne formatowanie `Intl`.
  const startTime = formatEventTime(session.startsAt, session.timezone, lang);
  const endTime = formatEventTime(session.endsAt, session.timezone, lang);
  const endsSameDay =
    eventDayKey(session.startsAt, session.timezone) ===
    eventDayKey(session.endsAt, session.timezone);
  const timeRange = t("eventFront.agenda.timeRange", {
    date: formatEventDate(session.startsAt, session.timezone, lang),
    start: startTime,
    end: endsSameDay
      ? endTime
      : formatEventDateTime(session.endsAt, session.timezone, lang, {
          dateStyle: "medium",
          timeStyle: "short",
        }),
  });

  const accent = session.track?.accentColor ?? null;
  const control = agendaSignupControl(session);
  const seatsLeft = agendaSeatsLeft(session);
  const cancelled = session.status === "cancelled";
  // Z indeksem programu prawdą jest indeks: osoba, której w nim nie ma,
  // występuje wyłącznie w sesjach odwołanych albo bez ścieżki - i ścieżki nie
  // dostaje. Własna ścieżka sesji to zapas TYLKO dla karty bez indeksu -
  // liczona raz na blok, a ścieżki każdej osoby raz na wiersz (wcześniej
  // dwukrotnie: dla przełącznika i dla wiersza).
  const fallbackTracks = speakerTracks === undefined ? ownTrack(session) : null;
  const speakerRows = session.speakers
    .filter((speaker) => speaker.displayName !== "")
    .map((speaker) => ({
      speaker,
      tracks: fallbackTracks ?? speakerTracks?.get(speaker.userId) ?? NO_TRACKS,
    }));
  // Obsada jest widoczna zawsze - rozwinięcie dokłada przy nazwiskach tylko
  // ŚCIEŻKI. „Pokaż szczegóły" ma więc co pokazać, gdy sesja ma opis albo
  // choć jeden prelegent ma nazwaną ścieżkę; inaczej przycisk przełączałby
  // stan bez żadnej zmiany na ekranie (program bez ścieżek, sesja plenarna).
  const speakersWithTracks = speakerRows.some((row) => hasNamedSpeakerTrack(row.tracks, lang));
  const hasDetails = description !== "" || speakersWithTracks;
  const detailsControls = [
    description !== "" ? detailsId : "",
    speakersWithTracks ? speakersId : "",
  ]
    .filter((id) => id !== "")
    .join(" ");
  const sponsor = session.sponsor ?? session.track?.sponsor ?? null;
  const sponsorRole = sponsorRoleKey(sponsor?.role ?? null);
  const affiliation = pickLocalized(
    { affiliation_pl: session.affiliationPl, affiliation_en: session.affiliationEn },
    "affiliation",
    lang,
  );

  return (
    <article
      id={agendaSessionAnchor(session.id)}
      className={cn("scroll-mt-24 py-6", cancelled && "opacity-70")}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(6.5rem,8rem)_minmax(0,1fr)]">
        <div
          className="space-y-1 border-l-[3px] pl-3"
          style={{ borderLeftColor: accent ?? "transparent" }}
        >
          {/* Cyfry o stałej szerokości: godziny kolejnych bloków stoją w jednej
              kolumnie, a „11:10" nie jest węższe od „10:00". */}
          <time
            dateTime={session.startsAt}
            className="block font-display text-xl font-semibold tabular-nums text-foreground"
          >
            {startTime}
          </time>
          <time
            dateTime={session.endsAt}
            className="block text-xs font-medium tabular-nums text-muted-foreground"
          >
            {endTime}
          </time>
          {trackName !== "" && (
            <p className="pt-2 text-xs font-semibold uppercase text-muted-foreground">
              {trackName}
            </p>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="min-w-0 space-y-2">
              {/* Nagłówek przyjmuje fokus (programowo, poza kolejnością Tab)
                  tylko pod dostawcą okien: klik w sesję w oknie profilu
                  odsłania ten blok i przenosi tu fokus, żeby czytnik ogłosił
                  tytuł, a Tab szedł dalej od tej sesji. */}
              <h3
                tabIndex={interactive ? -1 : undefined}
                className="font-display text-xl font-semibold leading-snug text-foreground outline-none md:text-2xl"
              >
                {title}
              </h3>

              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                <time dateTime={session.startsAt}>{timeRange}</time>
              </p>

              {affiliation !== "" && (
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <Landmark className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="sr-only">{t("eventFront.agenda.affiliationLabel")}: </span>
                    {affiliation}
                  </span>
                </p>
              )}
            </div>

            {sponsor !== null && sponsor.name !== null && sponsor.name !== "" && (
              <AgendaSponsorBadge
                sponsorId={sponsor.id}
                name={sponsor.name}
                logoUrl={sponsor.logoUrl}
                roleLabel={
                  sponsorRole === null ? t("eventFront.agenda.sponsorLabel") : t(sponsorRole)
                }
                placement={session.sponsor ? "agenda_session" : "agenda_track"}
                interactive={interactive}
              />
            )}
          </div>

          <div
            className={cn(
              speakerRows.length > 0 &&
                "grid gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]",
            )}
          >
            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <SessionStateBadge state={session.accessState} />
                {session.chathamHouse && (
                  <Badge variant="outline">{t("eventFront.agenda.chathamHouse")}</Badge>
                )}
              </div>

              <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <div className="inline-flex items-center gap-1.5">
                  <dt className="sr-only">{t("eventFront.list.formatLabel")}</dt>
                  <Radio className="h-3.5 w-3.5" aria-hidden="true" />
                  <dd>{t(agendaFormatKey(session.format))}</dd>
                </div>
                {session.room !== null && (
                  <div className="inline-flex items-center gap-1.5">
                    <dt className="sr-only">{t("eventFront.agenda.roomLabel")}</dt>
                    <DoorOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    <dd>
                      {session.room.name ?? ""}
                      {session.room.floor === null ? "" : ` (${session.room.floor})`}
                    </dd>
                  </div>
                )}
                {session.hasStream && (
                  <div className="inline-flex items-center gap-1.5">
                    <dt className="sr-only">{t("eventFront.agenda.streamAvailable")}</dt>
                    <Video className="h-3.5 w-3.5" aria-hidden="true" />
                    <dd>{t("eventFront.agenda.streamAvailable")}</dd>
                  </div>
                )}
              </dl>

              {hasDetails && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={open}
                  aria-controls={detailsControls}
                  onClick={() => setOpen((current) => !current)}
                  className="-ml-2 gap-1.5 text-xs"
                >
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
                    aria-hidden="true"
                  />
                  {open ? t("eventFront.agenda.closeDetails") : t("eventFront.agenda.openDetails")}
                </Button>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {seatsLeft !== null && !cancelled && (
                  <span className="text-xs text-muted-foreground">
                    {t("eventFront.agenda.seatsLeft", { count: seatsLeft })}
                  </span>
                )}
                {seatsLeft === null && session.requiresSignup && !cancelled && (
                  <span className="text-xs text-muted-foreground">
                    {t("eventFront.agenda.seatsUnlimited")}
                  </span>
                )}
                {control !== null && (
                  <Button
                    type="button"
                    size="sm"
                    variant={control.variant}
                    disabled={pending}
                    onClick={() =>
                      control.action === "cancel" ? onCancel(session) : onSignup(session)
                    }
                    className="w-full sm:w-auto"
                  >
                    {pending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    {pending
                      ? t("eventFront.agenda.actions.working")
                      : signedIn
                        ? t(control.labelKey)
                        : t("eventFront.agenda.actions.signIn")}
                  </Button>
                )}
              </div>
            </div>

            {speakerRows.length > 0 && (
              // DWIE KOLUMNY TYLKO WTEDY, GDY LISTA STOI POD PRZYCISKAMI. Od
              // `lg` lista siedzi obok kolumny stanu (15 rem) w tresci ograniczonej
              // do `max-w-5xl`, wiec ma ~290 px - dwie kolumny po ~140 px ucinaly
              // nazwisko i role po kilku literach. Jedna kolumna daje kazdemu
              // prelegentowi cala szerokosc obszaru obok „Pokaz szczegoly".
              <ul
                id={speakersId}
                aria-label={t("eventFront.agenda.speakersLabel")}
                className="grid min-w-0 grid-cols-1 content-start gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-1"
              >
                {speakerRows.map(({ speaker, tracks }) => (
                  <AgendaSpeakerRow
                    key={speaker.userId}
                    speaker={speaker}
                    lang={lang}
                    tracks={tracks}
                    showTracks={open}
                    interactive={interactive}
                  />
                ))}
              </ul>
            )}
          </div>

          {description !== "" && (
            <p
              id={detailsId}
              hidden={!open}
              className="whitespace-pre-line text-sm text-muted-foreground"
            >
              {description}
            </p>
          )}
        </div>
      </div>
    </article>
  );
});
