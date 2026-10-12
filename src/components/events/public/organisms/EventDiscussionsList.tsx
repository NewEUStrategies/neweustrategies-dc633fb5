// Organizm: DYSKUSJE - piąta z zawsze obecnych pozycji menu wydarzenia.
// Wątki grupy klubu dyskusyjnego przypiętej do wydarzenia w studiu.
//
// TO JEST ZAJAWKA KLUBU, NIE DRUGI SILNIK DYSKUSJI. Odpowiadanie, moderacja,
// reakcje, powiadomienia i archiwum żyją w module klubów - najbogatszym
// silniku w tym repozytorium - a projekt wprost odrzuca budowanie drugiego
// (docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md:641-643). Dlatego każdy
// wiersz jest ODNOŚNIKIEM do wątku w klubie (`/club/$clubSlug/t/$threadSlug`),
// a nie miejscem, w którym można cokolwiek napisać. Formularz odpowiedzi tutaj
// znaczyłby drugi zestaw reguł moderacji do utrzymania.
//
// WYDARZENIE BEZ PRZYPIĘTEJ GRUPY DOSTAJE JEDNO ZDANIE, NIE PUSTĄ RAMKĘ.
// `state = 'not_configured'` to normalny stan wydarzenia, które dyskusji nie
// prowadzi - i wtedy strona mówi „dyskusje otwieramy w dniu wydarzenia”.
// Ramka z nagłówkiem i niczym pod nim wygląda jak awaria, a atrapa z przykładową
// rozmową kłamie.
//
// DOSTĘPU NIE LICZYMY TUTAJ. `event_discussions` woła `club_capabilities` -
// JEDNO źródło prawdy o dostępie do grupy klubu - i oddaje jego `reason`
// wprost. Ten komponent zamienia kod na zdanie i na tym kończy się jego rola;
// druga, równoległa reguła widoczności rozjechałaby się z klubem przy pierwszej
// zmianie polityki grupy.
//
// NAZWISKO AUTORA MOŻE NIE PRZYJŚĆ I TO NIE JEST BRAK DANYCH. W trybie Chatham
// House (kaskada wątek -> grupa -> klub) baza NIE ODDAJE autora, a `isAnonymous`
// mówi, że tak ma być - dlatego rysujemy etykietę „Uczestnik”, a nie puste
// miejsce po nazwisku. Taki autor nie jest też przyciskiem: okno profilu osoby,
// której nazwiska reguła nie pozwala podać, byłoby wyciekiem albo atrapą.
//
// WIERSZ, NIE KARTA. Wątki to lista do czytania, więc stoją pod sobą między
// włosowymi liniami, a hierarchię niesie typografia (rodzaj wątku, tytuł,
// zajawka, metryka). Cały wiersz otwiera wątek - tytuł jest rozciągniętym
// odnośnikiem (`after:absolute after:inset-0`) - a autor leży NAD nim
// (`relative z-10`) jako osobny przycisk okna profilu. Przycisk w odnośniku
// byłby zagnieżdżeniem elementów interaktywnych, którego czytnik ekranu nie
// umie ogłosić.
import { useCallback, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Pin } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, uiLang, type UiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import type { DirectoryPerson } from "@/lib/events/eventDirectory";
import {
  EMPTY_EVENT_DISCUSSIONS,
  type DiscussionClub,
  type DiscussionThread,
} from "@/lib/events/publicEventApi";
import { useEventDiscussions } from "@/lib/events/usePublicEvent";
import { usePublicEventDirectory } from "@/lib/events/usePublicEventDirectory";
import { SpeakerAvatar } from "@/components/events/SpeakerAvatar";
import {
  DirectoryPersonTrigger,
  EventDirectoryProvider,
} from "@/components/events/public/directory/EventDirectoryContext";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
import { cn } from "@/lib/utils";

ensureEventFrontI18n();

// Sześć wartości `club_threads.kind` domkniętych CHECK-iem w bazie. Lista stoi
// tutaj, żeby nieznana wartość (dopisana w bazie bez tłumaczenia) nie wyszła na
// stronę surowym kluczem - wtedy nadtytułu rodzaju po prostu nie ma.
const THREAD_KINDS = [
  "discussion",
  "question",
  "position",
  "resource",
  "announcement",
  "poll",
] as const;

/** „11 paź 2026" / „11 Oct 2026" - w strefie serwisu (`formatDate`), więc bez rozjazdu dnia. */
const ACTIVITY_DATE: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

/** Nadtytuł: wersaliki z rozstrzałem - ta sama skala, co nadtytuły okna profilu. */
const OVERLINE_CLASS =
  "text-[11px] font-semibold uppercase leading-4 tracking-[0.14em] text-muted-foreground";

export function EventDiscussionsList({
  slug,
  enabled = true,
  heading = true,
}: {
  slug: string;
  enabled?: boolean;
  /**
   * `false` = nagłówek i podtytuł rysuje ktoś nad nami - na trasie zakładki
   * `/events/<slug>/discussions` robi to dokument strony CMS (własny `h1`
   * i zdanie wstępu redagowane w studiu). Domyślne `true` zachowuje zachowanie
   * w każdym innym miejscu.
   */
  heading?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const discussions = useEventDiscussions(slug, enabled);
  const data = discussions.data ?? EMPTY_EVENT_DISCUSSIONS;
  const clubName =
    data.club === null
      ? ""
      : pickLocalized({ name_pl: data.club.namePl, name_en: data.club.nameEn }, "name", lang);
  const groupName =
    data.group === null
      ? ""
      : pickLocalized({ name_pl: data.group.namePl, name_en: data.group.nameEn }, "name", lang);

  return (
    <section
      className="space-y-4"
      aria-labelledby={heading ? "event-discussions-heading" : undefined}
    >
      {heading && (
        <header className="space-y-1">
          <h2 id="event-discussions-heading" className="text-base font-semibold text-foreground">
            {t("eventFront.discussions.heading")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("eventFront.discussions.subtitle")}</p>
        </header>
      )}

      {discussions.isLoading ? (
        // Szkielet ma geometrię wiersza (nadtytuł, tytuł, zajawka między
        // liniami), więc lista po wczytaniu nie przesuwa strony.
        <div className="divide-y divide-border/60 border-y border-border/70" aria-busy="true">
          {[0, 1].map((row) => (
            <div key={row} className="space-y-2 px-4 py-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      ) : discussions.isError ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {publicEventErrorMessage(discussions.error)}
        </p>
      ) : data.state === "not_configured" ? (
        // JEDNO ZDANIE ZAPROSZENIA - patrz nagłówek pliku.
        <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
          {t("eventFront.discussions.invite")}
        </p>
      ) : data.state !== "ok" ? (
        <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
          {t(`eventFront.discussions.state.${stateKey(data.state)}`)}
        </p>
      ) : (
        <>
          {/* REGUŁA CHATHAM HOUSE MÓWI SIĘ WPROST, ZANIM KTOŚ NAPISZE. Grupa
              w tym trybie pseudonimizuje wszystkich - uczestnik ma to wiedzieć
              przed kliknięciem „rozpocznij wątek”, nie po. */}
          {data.attribution === "chatham" && (
            <p className="rounded-md border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
              {t("eventFront.discussions.chathamNote")}
            </p>
          )}

          {data.threads.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("eventFront.discussions.empty")}</p>
          ) : (
            <div className="space-y-3">
              {/* Podpis listy: skąd są wątki i ILE ICH JEST W KLUBIE. RPC oddaje
                  najwyżej 20 wierszy, a `totalCount` liczy wszystkie widoczne -
                  bez tej liczby czytelnik nie wie, że w klubie czeka więcej. */}
              <div className="flex items-baseline justify-between gap-4">
                <p className={cn(OVERLINE_CLASS, "min-w-0 truncate")}>
                  {[clubName, groupName].filter((part) => part !== "").join(" · ")}
                </p>
                <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {t("eventFront.directory.threadsCount", {
                    count: Math.max(data.totalCount, data.threads.length),
                  })}
                </p>
              </div>
              <DiscussionThreads slug={slug} lang={lang} threads={data.threads} club={data.club} />
            </div>
          )}

          {data.club !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="outline" className="group">
                <Link to="/club/$clubSlug" params={{ clubSlug: data.club.slug }}>
                  {t("eventFront.discussions.openInClub", { club: clubName })}
                  <ArrowRight
                    aria-hidden="true"
                    strokeWidth={1.5}
                    className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none"
                  />
                </Link>
              </Button>
              {/* Przycisk zakładania wątku prowadzi do KLUBU, bo tam stoi
                  formularz z regułami moderacji tej grupy. `canPost` liczy
                  `club_capabilities` - bez niego przycisk obiecywałby prawo,
                  którego baza zaraz odmówi. */}
              {data.canPost && (
                <Button asChild size="sm" variant="secondary">
                  <Link to="/club/$clubSlug/new" params={{ clubSlug: data.club.slug }}>
                    {t("eventFront.discussions.startThread")}
                  </Link>
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Lista wątków pod dostawcą okien profilu.
 *
 * DOSTAWCA DOPIERO TUTAJ, NIE NAD CAŁĄ SEKCJĄ. Katalog ma sens tylko wtedy, gdy
 * są wątki z autorami - stan zaproszenia, odmowy i pustej grupy nie montuje
 * więc ani katalogu, ani jego zapytań. Źródła wzbogacające (prelegenci,
 * program, partnerzy) śpią do pierwszego sygnału zamiaru na autorze
 * (`onActivate`): dzięki nim firma z profilu autora otwiera okno partnera
 * z opisem i osobami, jeśli ta instytucja stoi na wydarzeniu.
 */
function DiscussionThreads({
  slug,
  lang,
  threads,
  club,
}: {
  slug: string;
  lang: UiLang;
  threads: readonly DiscussionThread[];
  club: DiscussionClub | null;
}) {
  const { t } = useTranslation();
  const [enrich, setEnrich] = useState(false);
  // Stała referencja: dostawca trzyma `prime` w `useCallback` po `onActivate`,
  // a nowa funkcja co render przerysowywałaby każdy wiersz listy.
  const activate = useCallback(() => setEnrich(true), []);
  // Wątki to dane zapytania (stała referencja między renderami), więc katalog
  // przebudowuje się dopiero z nową odpowiedzią, nie przy każdym renderze.
  const extraPeople = useMemo(() => threadAuthorPeople(threads), [threads]);
  const { directory, eventId } = usePublicEventDirectory({
    slug,
    lang,
    enrich,
    own: { extraPeople },
  });

  return (
    <EventDirectoryProvider
      directory={directory}
      slug={slug}
      eventId={eventId}
      onActivate={activate}
    >
      <ul
        className="divide-y divide-border/60 border-y border-border/70"
        aria-label={t("eventFront.discussions.listLabel")}
      >
        {threads.map((thread) => (
          <ThreadRow key={thread.id} thread={thread} club={club} lang={lang} />
        ))}
      </ul>
    </EventDirectoryProvider>
  );
}

function ThreadRow({
  thread,
  club,
  lang,
}: {
  thread: DiscussionThread;
  club: DiscussionClub | null;
  lang: UiLang;
}) {
  const { t } = useTranslation();
  const kind = THREAD_KINDS.find((value) => value === thread.kind) ?? null;
  const pinned = thread.pinnedAt !== null;
  const activityAt = thread.lastReplyAt ?? thread.createdAt;
  const activity = activityAt === null ? "" : formatDate(activityAt, lang, ACTIVITY_DATE);
  // Wątek bez klubu nie ma jak zostać otwarty - a wiersz, który udaje
  // odnośnik, jest atrapą. Taki stan jest niemożliwy przy `state = 'ok'` (RPC
  // oddaje klub razem z wątkami), więc to jest domknięcie typu, nie druga
  // ścieżka widoku.
  const interactive = club !== null;

  return (
    <li
      className={cn(
        "group relative flex items-center gap-4 px-4 py-5",
        interactive && "transition-colors duration-300 hover:bg-muted/40",
      )}
    >
      <div className="min-w-0 flex-1">
        {kind !== null || pinned ? (
          <p className={cn(OVERLINE_CLASS, "mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1")}>
            {kind !== null && <span>{t(`eventFront.discussions.kind.${kind}`)}</span>}
            {pinned && (
              <span className="inline-flex items-center gap-1 text-foreground/70">
                <Pin aria-hidden="true" strokeWidth={1.5} className="h-3 w-3" />
                {t("eventFront.directory.pinned")}
              </span>
            )}
          </p>
        ) : null}
        <h3 className="font-display text-lg font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere]">
          {club === null ? (
            thread.title
          ) : (
            <Link
              to="/club/$clubSlug/t/$threadSlug"
              params={{ clubSlug: club.slug, threadSlug: thread.slug }}
              className="rounded-[4px] after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {thread.title}
            </Link>
          )}
        </h3>
        {thread.excerpt !== null && (
          <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{thread.excerpt}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <ThreadAuthor thread={thread} />
          <span className="tabular-nums">
            {t("eventFront.discussions.replies", { count: thread.replyCount })}
          </span>
          {thread.participantCount > 0 && (
            <span className="tabular-nums">
              {t("eventFront.directory.participantsCount", { count: thread.participantCount })}
            </span>
          )}
          {activityAt !== null && activity !== "" && (
            <time dateTime={activityAt} className="tabular-nums">
              {t("eventFront.directory.lastActivity", { date: activity })}
            </time>
          )}
        </div>
      </div>
      {interactive && (
        <ArrowRight
          aria-hidden="true"
          strokeWidth={1.5}
          className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
        />
      )}
    </li>
  );
}

/**
 * Podpis autora wątku: przycisk okna profilu albo sam tekst.
 *
 * Przycisk leży NAD rozciągniętym odnośnikiem wiersza (`relative z-10`); autor
 * bez okna zostaje POD nim, więc klik w jego nazwisko nadal otwiera wątek.
 * Stałe, jasne podkreślenie nazwiska to ta sama para klas, co firma na karcie
 * uczestnika - osobny cel kliknięcia w klikalnym wierszu, zero nowych reguł
 * w arkuszu.
 */
function ThreadAuthor({ thread }: { thread: DiscussionThread }) {
  const { t } = useTranslation();
  const author = attributableAuthor(thread);
  const name = thread.isAnonymous ? "" : (thread.authorName?.trim() ?? "");
  if (name === "") return <span>{t("eventFront.discussions.anonymousAuthor")}</span>;

  return (
    <DirectoryPersonTrigger
      personKey={author?.key ?? null}
      label={t("eventFront.directory.openPerson", { name })}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-2 rounded-[6px] text-sm font-medium text-foreground/80",
        author !== null &&
          "relative z-10 transition-colors hover:text-foreground pointer-coarse:min-h-11",
      )}
    >
      <SpeakerAvatar name={name} photoUrl={thread.authorAvatar} size="sm" />
      <span
        className={cn(
          "truncate",
          author !== null && "border-b border-border transition-colors hover:border-primary/40",
        )}
      >
        {name}
      </span>
    </DirectoryPersonTrigger>
  );
}

/**
 * Autor, którego wolno pokazać w oknie profilu - albo `null`.
 *
 * KLUCZ `m:<slug profilu>`, NIE KONTO. RPC nie oddaje identyfikatora autora
 * (tylko nazwę, zdjęcie i slug profilu), więc autor nie skleja się z wierszem
 * prelegenta ani uczestnika (`u:<uuid>`) - i nie udaje, że się skleja. Wątki
 * pod regułą Chatham House nie niosą ani nazwiska, ani slugu, więc z definicji
 * nie trafiają do katalogu.
 */
function attributableAuthor(
  thread: DiscussionThread,
): { key: string; name: string; slug: string } | null {
  if (thread.isAnonymous) return null;
  const name = thread.authorName?.trim() ?? "";
  const slug = thread.authorSlug?.trim() ?? "";
  if (name === "" || slug === "") return null;
  return { key: `m:${slug}`, name, slug };
}

/**
 * Autorzy wątków jako osoby katalogu okien (`extraPeople`).
 *
 * Lista niesie tylko nazwisko, zdjęcie i slug - stanowisko i firmę dociąga
 * okno z profilu członka (`memberSlug`) dopiero po kliknięciu, więc wejście na
 * zakładkę nie płaci za profile autorów, których nikt nie otworzy. Ten sam
 * autor kilku wątków to JEDNA osoba katalogu.
 */
function threadAuthorPeople(threads: readonly DiscussionThread[]): DirectoryPerson[] {
  const people = new Map<string, DirectoryPerson>();
  for (const thread of threads) {
    const author = attributableAuthor(thread);
    if (author === null || people.has(author.key)) continue;
    people.set(author.key, {
      key: author.key,
      name: author.name,
      avatarUrl: thread.authorAvatar,
      position: "",
      orgKey: null,
      orgName: "",
      orgLogoUrl: null,
      bio: "",
      topics: [],
      languages: [],
      socials: {},
      isSpeaker: false,
      isExpert: false,
      profileHref: `/people/${author.slug}`,
      sessions: [],
      speakerRow: null,
      attendee: null,
      memberSlug: author.slug,
    });
  }
  return [...people.values()];
}

/**
 * `not_open_yet` -> `notOpenYet`. Klucze stanu są w słowniku w camelCase, a baza
 * mówi snake_case - zamiana stoi w jednym miejscu, żeby nie było dwóch list
 * nazw tego samego zbioru stanów.
 */
function stateKey(state: string): string {
  return state.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}
