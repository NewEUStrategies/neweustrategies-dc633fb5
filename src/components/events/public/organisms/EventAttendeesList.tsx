// Organizm: UCZESTNICY - jedna z pięciu zawsze obecnych pozycji menu
// wydarzenia. Lista osób, które zgodziły się być widoczne, plus przełącznik
// WŁASNEJ widoczności.
//
// WZORZEC: docs/zrzuty/swapcard-2026-08-23/39-preview-speakers-grid.png, lewa
// kolumna - karta „Moja widoczność / Jesteś widoczny dla innych uczestników”
// stoi OBOK listy, nie w ustawieniach konta. Człowiek podejmuje tę decyzję
// dokładnie wtedy, gdy widzi, co ona znaczy: patrząc na listę, na której sam
// się znajduje.
//
// TEN KOMPONENT NIE FILTRUJE LISTY I NIE MOŻE ZACZĄĆ.
// Kto wychodzi z `event_attendees`, decyduje SQL: zgoda platformowa
// (`profiles.discoverable`), decyzja osoby na tym wydarzeniu
// (`event_registrations.directory_opt_out`), zapis wołającego i reguła Chatham
// House. Każdy z tych warunków dopisany tutaj dałby się obejść jednym
// `supabase.rpc()` z konsoli przeglądarki - a przy Chatham House to jest cała
// stawka, nie szczegół. Dlatego w tym pliku nie ma ANI JEDNEGO `if`
// o widoczności cudzych danych; są tylko `if`-y o tym, CO NAPISAĆ.
//
// TRZY RÓŻNE „NIE MA LISTY”, TRZY RÓŻNE ZDANIA:
//   * gość            -> „zaloguj się” (RPC ma REVOKE dla `anon`, więc nawet
//                        nie pytamy bazy - hook stoi na `enabled`),
//   * niezapisany     -> „zapisz się na wydarzenie”,
//   * Chatham House   -> „nazwisk nie będzie”, ale POKAZUJEMY liczbę i grupy,
//                        bo to jedyna rzecz, którą reguła pozwala powiedzieć.
// Komunikat bez następnego kroku zamienia bramkę członkostwa w awarię strony.
//
// NAZWA NIE SKŁADA SIĘ TUTAJ. `event_attendees` oddaje gotowe `name` (nazwa
// wyświetlana profilu -> imię i nazwisko profilu -> kartoteka wydarzenia), więc
// front nie ma tu żadnej gałęzi do pomylenia z tą w bazie.
//
// KARTA JEST WIZYTÓWKĄ, OKNO JEST PROFILEM. Siatka niesie tylko to, po czym
// człowieka rozpoznaje się na sali: twarz, nazwisko, stanowisko, instytucję,
// przepustkę i to, czy występuje. Biogram, „szukam / oferuję", sieci, panele
// i akcje (kontakt, wiadomość) są w oknie profilu (`directory/`), które
// otwiera klik w kartę - to samo okno, co na zakładkach prelegentów, partnerów,
// agendy i dyskusji, więc osoba wygląda tak samo, skądkolwiek ją otworzyć.
// Przy okazji przyciski sieci i spotkań wyjechały z chunka zakładki do chunka
// okna: płaci za nie ten, kto okno otwiera, a nie każdy, kto wchodzi na listę.
import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { uiLang } from "@/lib/i18n/format";
import { directoryOrgKey } from "@/lib/events/eventDirectory";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import {
  EMPTY_ATTENDEE_DIRECTORY,
  type AttendeeDirectory,
  type AttendeeEntry,
  type AttendeeGroupCount,
} from "@/lib/events/publicEventApi";
import { useEventAttendees, useEventAttendeeVisibility } from "@/lib/events/usePublicEvent";
import { usePublicEventDirectory } from "@/lib/events/usePublicEventDirectory";
import {
  fetchEventSpeakerSessions,
  type SpeakerSessionEntry,
} from "@/lib/events/participantTicketsApi";
import { cn } from "@/lib/utils";
import { SpeakerAvatar } from "@/components/events/SpeakerAvatar";
import {
  EventGroupTags,
  eventGroupName,
} from "@/components/events/participant/atoms/EventGroupTags";
import { EventOrgLogo } from "@/components/events/public/atoms/EventOrgLogo";
import {
  DirectoryCompanyTrigger,
  DirectoryPersonTrigger,
  EventDirectoryProvider,
  useEventDirectory,
} from "@/components/events/public/directory/EventDirectoryContext";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

/** Nadtytuł: wersaliki z rozstrzałem - ten sam rysunek, co sekcje okna profilu. */
const OVERLINE_CLASS = "text-[11px] font-semibold uppercase tracking-[0.14em]";

// Tyle, ile mieści się w dwóch rzędach siatki trójkolumnowej - strona nie rośnie
// w nieskończoność, a kongres z tysiącem zapisanych nie wciąga tysiąca wierszy
// do jednego zapytania.
const PAGE_SIZE = 24;

export function EventAttendeesList({
  slug,
  enabled = true,
  heading = true,
}: {
  slug: string;
  enabled?: boolean;
  /**
   * `false` = nagłówek i podtytuł rysuje ktoś nad nami.
   *
   * PO CO TO ISTNIEJE. Na trasie zakładki `/events/<slug>/participants` nad tą
   * listą stoi DOKUMENT STRONY CMS z własnym `h1` („Uczestnicy”) i zdaniem
   * wstępu redagowanym w studiu. Własny nagłówek dałby wtedy „Uczestnicy” dwa
   * razy pod sobą. Domyślne `true` zachowuje zachowanie wszędzie indziej -
   * tam, gdzie ta lista stoi sama, nagłówek jest jej jedynym punktem
   * orientacyjnym dla czytnika ekranu.
   */
  heading?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { user } = useAuth();
  const signedIn = user !== null;

  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  // Wpisywanie w wyszukiwarkę nie może wysyłać zapytania na każdy znak: baza
  // liczy dla każdego wiersza przecięcie grup uczestnika.
  const debounced = useDebouncedValue(query, 300);

  const attendees = useEventAttendees(
    slug,
    { q: debounced.trim(), groupId, offset, limit: PAGE_SIZE },
    enabled && signedIn,
  );
  const visibility = useEventAttendeeVisibility(slug);
  // „W jakim panelu ta osoba występuje" - osobne, RZADKO zmienne zapytanie
  // (jedna mapa na całe wydarzenie), a nie kolumna w wynikach katalogu:
  // program bywa publikowany później niż lista i nie może wymusić
  // przeładowania stronicowanej listy uczestników.
  const speakerSessions = useQuery({
    queryKey: ["event", slug, "speaker-sessions"],
    queryFn: () => fetchEventSpeakerSessions(slug),
    enabled: enabled && signedIn,
    staleTime: 5 * 60 * 1000,
  });

  // OSTATNIA ODPOWIEDŹ ZOSTAJE NA EKRANIE, DOPÓKI NIE PRZYJDZIE NASTĘPNA.
  // Każda nowa fraza i każde nowe okno to NOWY klucz cache, a nowy klucz nie ma
  // danych - bez zapamiętanej poprzedniej odpowiedzi całe ciało sekcji (razem
  // z `Filters`, czyli z polem wyszukiwania) znikałoby na czas rundy po sieci,
  // a pole wracałoby jako NOWY węzeł DOM. Uczestnik piszący dłużej niż 300 ms
  // debouncingu traciłby wtedy kursor po każdej pauzie w pisaniu. To ta sama
  // reguła, co `placeholderData: keepPreviousData` w innych listach modułu.
  const kept = useRef<AttendeeDirectory | null>(null);
  if (attendees.data !== undefined) kept.current = attendees.data;
  const data = kept.current ?? EMPTY_ATTENDEE_DIRECTORY;

  // Panele osoby z mapy wystąpień - JEDNA funkcja dla karty i dla katalogu
  // okien. Stabilna między renderami, bo katalog składa się w `useMemo`
  // zależnym od niej: nowa funkcja co render przebudowywałaby go przy każdym
  // znaku wpisanym w wyszukiwarkę.
  const speakerSessionsData = speakerSessions.data;
  const sessionsOf = useCallback(
    (entry: AttendeeEntry) => speakerSessionsData?.get(entry.registrationId) ?? null,
    [speakerSessionsData],
  );

  // OKNO PROFILU SKŁADA FAKTY Z TEGO, CO LISTA JUŻ MA. Wiersze bieżącej strony
  // i mapa paneli wystarczają na okno uczestnika od pierwszego kliknięcia;
  // prelegenci, program i partnerzy (biogram prelegenta, godziny sesji, opis
  // instytucji) dojeżdżają dopiero na pierwszy sygnał zamiaru (`onActivate`),
  // więc wejście na listę nie kosztuje ani jednego dodatkowego zapytania.
  const [enrich, setEnrich] = useState(false);
  const activateDirectory = useCallback(() => setEnrich(true), []);
  const { directory, eventId } = usePublicEventDirectory({
    slug,
    lang,
    enrich,
    own: { attendees: data.rows, attendeeSessions: sessionsOf },
  });

  return (
    <EventDirectoryProvider
      directory={directory}
      slug={slug}
      eventId={eventId}
      onActivate={activateDirectory}
    >
      {/* Bez własnego nagłówka sekcja NIE dostaje `aria-labelledby` wskazującego
          na nieistniejący węzeł - zostaje zwykłym blokiem pod nagłówkiem, który
          narysował ktoś nad nią. */}
      <section
        className="space-y-5"
        aria-labelledby={heading ? "event-attendees-heading" : undefined}
      >
        {heading && (
          <header className="space-y-1">
            {/* NAGŁÓWEK JEST TUTAJ, inaczej niż w `EventSpeakersGrid`: tam siatka
                jest sekcją POD nagłówkiem z bazy, a to jest cała treść podstrony
                „Uczestnicy” - bez własnego nagłówka nie miałaby punktu
                orientacyjnego dla czytnika ekranu. */}
            <h2 id="event-attendees-heading" className="text-base font-semibold text-foreground">
              {t("eventFront.attendees.heading")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("eventFront.attendees.subtitle")}</p>
          </header>
        )}

        {!signedIn ? (
          <NoticeCard
            title={t("eventFront.attendees.signInTitle")}
            body={t("eventFront.attendees.signInBody")}
          />
        ) : attendees.isLoading && kept.current === null ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : attendees.isError ? (
          <p className="rounded-[6px] border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {publicEventErrorMessage(attendees.error)}
          </p>
        ) : data.blocked === "requester_not_participating" ? (
          <NoticeCard
            title={t("eventFront.attendees.notRegisteredTitle")}
            body={t("eventFront.attendees.notRegisteredBody")}
          />
        ) : (
          <>
            {/* WŁASNA WIDOCZNOŚĆ STOI PRZED LISTĄ i wraca także przy Chatham
                House: karta musi umieć powiedzieć „jesteś na liście”, nawet gdy
                tej listy nikt nie zobaczy. */}
            <VisibilityCard
              listed={data.myListed}
              discoverable={data.myDiscoverable}
              pending={visibility.isPending}
              onChange={(next) =>
                visibility.mutate(next, {
                  onError: (error) => toast.error(publicEventErrorMessage(error)),
                })
              }
            />

            {data.blocked === "chatham_house" ? (
              <>
                <NoticeCard
                  title={t("eventFront.attendees.chathamTitle")}
                  body={t("eventFront.attendees.chathamBody")}
                />
                <GroupCounts groups={data.groups} total={data.totalCount} lang={lang} />
              </>
            ) : (
              <>
                <Filters
                  query={query}
                  groups={data.groups}
                  groupId={groupId}
                  lang={lang}
                  onQuery={(next) => {
                    setQuery(next);
                    setOffset(0);
                  }}
                  onGroup={(next) => {
                    setGroupId(next);
                    setOffset(0);
                  }}
                />

                {data.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {debounced.trim() === "" && groupId === null
                      ? t("eventFront.attendees.empty")
                      : t("eventFront.attendees.emptyFiltered")}
                  </p>
                ) : (
                  <>
                    <p className={cn(OVERLINE_CLASS, "tabular-nums text-muted-foreground")}>
                      {t("eventFront.attendees.count", { count: data.totalCount })}
                    </p>
                    <EventAttendeesGridView
                      entries={data.rows}
                      lang={lang}
                      sessionsOf={sessionsOf}
                    />

                    {data.totalCount > PAGE_SIZE && (
                      <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-4">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={offset === 0}
                          onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
                        >
                          {t("eventFront.attendees.prevPage")}
                        </Button>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {t("eventFront.attendees.pageRange", {
                            from: offset + 1,
                            to: Math.min(offset + data.rows.length, data.totalCount),
                            total: data.totalCount,
                          })}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={offset + PAGE_SIZE >= data.totalCount}
                          onClick={() => setOffset(offset + PAGE_SIZE)}
                        >
                          {t("eventFront.attendees.nextPage")}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {attendees.isFetching && (
              <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                {t("eventFront.attendees.loading")}
              </p>
            )}
          </>
        )}
      </section>
    </EventDirectoryProvider>
  );
}

/**
 * SAM RYSUNEK katalogu - bez zapytania, filtrow i stronicowania.
 *
 * PO CO OSOBNO: podglad studia sklada liste z RPC panelu (`event_attendees`
 * wymaga, zeby WOLAJACY byl zapisany), a mimo to ma rysowac TE SAME karty, co
 * strona - inaczej w repozytorium stoi druga siatka uczestnikow.
 *
 * DOSTAWCY OKIEN TU NIE MA I NIE MOŻE BYĆ. Strona publiczna stawia go
 * w `EventAttendeesList` (katalog z zapytań publicznych), podgląd studia - nad
 * tym widokiem (katalog z RPC panelu, odnośniki wychodzące jako tekst). Bez
 * dostawcy karty są samym tekstem.
 */
export function EventAttendeesGridView({
  entries,
  lang,
  sessionsOf,
}: {
  entries: readonly AttendeeEntry[];
  lang: "pl" | "en";
  sessionsOf?: (entry: AttendeeEntry) => SpeakerSessionEntry[] | null;
}) {
  const { t } = useTranslation();
  return (
    <ul
      className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3"
      aria-label={t("eventFront.attendees.listLabel")}
    >
      {entries.map((entry) => (
        <li key={entry.registrationId} className="flex">
          <AttendeeCard
            entry={entry}
            lang={lang}
            sessions={sessionsOf === undefined ? null : sessionsOf(entry)}
          />
        </li>
      ))}
    </ul>
  );
}

/** Karta z jednym zdaniem i następnym krokiem - trzy odmowy, jeden układ. */
function NoticeCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[6px] border border-border/70 bg-muted/30 px-4 py-3">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

/**
 * Przełącznik własnej obecności na liście.
 *
 * DWIE DŹWIGNIE, JEDEN PRZEŁĄCZNIK - i to jest świadome. Ten przełącznik
 * ustawia decyzję PER WYDARZENIE (`directory_opt_out`). Zgoda platformowa
 * (`profiles.discoverable`) zapadła w profilu i strona wydarzenia nie ma prawa
 * jej rozszerzać za człowieka: gdy jest wyłączona, przełącznik jest wyłączony
 * i podpisany zdaniem, które mówi, gdzie to zmienić. Cichy przełącznik bez
 * efektu byłby gorszy od jego braku.
 */
function VisibilityCard({
  listed,
  discoverable,
  pending,
  onChange,
}: {
  listed: boolean;
  discoverable: boolean;
  pending: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();

  if (!discoverable) {
    return (
      <div className="rounded-[6px] border border-border/70 bg-card px-4 py-3">
        <p className="text-sm font-medium text-foreground">
          {t("eventFront.attendees.profileHiddenLabel")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("eventFront.attendees.profileHiddenHint")}
        </p>
      </div>
    );
  }

  return (
    <label className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[6px] border border-border/70 bg-card px-4 py-3">
      <Switch checked={listed} disabled={pending} onCheckedChange={onChange} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          {t("eventFront.attendees.listedLabel")}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {t("eventFront.attendees.listedHint")}
        </span>
      </span>
      {/* Stan słowem, nie plakietką: obok przełącznika plakietka byłaby drugą
          kontrolką do kliknięcia, a to jest tylko podpis. */}
      <span className={cn(OVERLINE_CLASS, listed ? "text-brand-ink" : "text-muted-foreground")}>
        {listed ? t("eventFront.attendees.listedOn") : t("eventFront.attendees.listedOff")}
      </span>
    </label>
  );
}

function Filters({
  query,
  groups,
  groupId,
  lang,
  onQuery,
  onGroup,
}: {
  query: string;
  groups: readonly AttendeeGroupCount[];
  groupId: string | null;
  lang: "pl" | "en";
  onQuery: (next: string) => void;
  onGroup: (next: string | null) => void;
}) {
  const { t } = useTranslation();
  // Grupy z zerem osób NIE SĄ filtrem: kliknięcie w nie daje pustą listę i nic
  // więcej. Zostają na liczniku przy Chatham House, gdzie mówią o składzie sali.
  const usable = groups.filter((group) => group.count > 0);

  return (
    <div className="space-y-3">
      <div className="relative min-w-0">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t("eventFront.attendees.searchPlaceholder")}
          aria-label={t("eventFront.attendees.searchLabel")}
          className="pl-9"
        />
      </div>

      {usable.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={groupId === null ? "secondary" : "ghost"}
            aria-pressed={groupId === null}
            onClick={() => onGroup(null)}
          >
            {t("eventFront.attendees.allGroups")}
          </Button>
          {usable.map((group) => (
            <Button
              key={group.id}
              type="button"
              size="sm"
              variant={groupId === group.id ? "secondary" : "ghost"}
              aria-pressed={groupId === group.id}
              onClick={() => onGroup(group.id)}
            >
              {groupName(group, lang)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Skład sali bez nazwisk - jedyna treść, którą reguła Chatham House przepuszcza.
 * Grupy z zerem osób zostają: „Partnerzy 0” to informacja o wydarzeniu.
 */
function GroupCounts({
  groups,
  total,
  lang,
}: {
  groups: readonly AttendeeGroupCount[];
  total: number;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  if (groups.length === 0) return null;

  return (
    <div className="rounded-[6px] border border-border/70 bg-card px-4 py-4">
      <p className={cn(OVERLINE_CLASS, "text-muted-foreground")}>
        {t("eventFront.attendees.groupsHeading")}
      </p>
      <p className="mt-1.5 font-display text-lg font-semibold tabular-nums text-foreground">
        {t("eventFront.attendees.count", { count: total })}
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-border/70 pt-3 text-sm tabular-nums text-foreground/80">
        {groups.map((group) => (
          <li key={group.id} className="inline-flex items-center gap-2">
            {/* Kolor grupy z panelu - ta sama barwa, co obrys plakietki na karcie. */}
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-border"
              style={group.color === null ? undefined : { backgroundColor: group.color }}
            />
            {groupName(group, lang)}
            {" · "}
            {t("eventFront.attendees.groupCount", { count: group.count })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Wizytówka uczestnika - patrz „KARTA JEST WIZYTÓWKĄ” w nagłówku pliku.
 *
 * CAŁA KARTA JEST PRZYCISKIEM PROFILU, A INSTYTUCJA - OSOBNYM. Przycisk osoby
 * siedzi na nazwisku i rozciąga pole kliku na kartę (`after:inset-0`), więc
 * czytnik ekranu słyszy jeden przycisk z nazwiskiem, a palec trafia wszędzie.
 * Nazwa firmy leży NAD tym polem (`relative z-10`) i otwiera okno instytucji -
 * dwa przyciski obok siebie, nigdy jeden w drugim.
 */
function AttendeeCard({
  entry,
  lang,
  sessions,
}: {
  entry: AttendeeEntry;
  lang: "pl" | "en";
  /** Panele, w których ta osoba występuje - `null`, gdy nie jest prelegentem. */
  sessions: SpeakerSessionEntry[] | null;
}) {
  const { t } = useTranslation();
  // Bez dostawcy okien (podgląd bez katalogu) karta jest samym tekstem, więc
  // nie obiecuje niczego, czego klik nie zrobi: bez obwódki przy najechaniu,
  // bez „Zobacz profil” i bez podkreślenia firmy.
  const interactive = useEventDirectory() !== null;
  const sessionCount = sessions?.length ?? 0;
  const company = entry.company;

  return (
    <article
      className={cn(
        "group relative flex w-full flex-col rounded-[6px] border border-border bg-card p-4 sm:p-5",
        interactive && "transition-colors duration-300 hover:border-foreground/25",
      )}
    >
      <div className="flex flex-1 items-start gap-3.5">
        <SpeakerAvatar name={entry.name} photoUrl={entry.avatarUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[15px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
            <DirectoryPersonTrigger
              personKey={entry.registrationId}
              label={t("eventFront.directory.openPerson", { name: entry.name })}
              className={cn("rounded-[4px]", interactive && "after:absolute after:inset-0")}
            >
              <span className="line-clamp-2 [overflow-wrap:anywhere]">{entry.name}</span>
            </DirectoryPersonTrigger>
          </h3>
          {/* Linia podpisu ISTNIEJE TYLKO GDY MA TREŚĆ - pusta czyta się
              w siatce jak uszkodzone dane, nie jak brak danych. */}
          {entry.jobTitle !== null && (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{entry.jobTitle}</p>
          )}
          {company !== null && (
            <DirectoryCompanyTrigger
              orgKey={directoryOrgKey(company)}
              name={company}
              logoUrl={entry.companyLogoUrl}
              label={t("eventFront.directory.openCompany", { name: company })}
              className="relative z-10 mt-2.5 flex max-w-full items-center gap-2 rounded-[4px] text-sm text-foreground/80"
            >
              <EventOrgLogo name={company} logoUrl={entry.companyLogoUrl} size="xs" />
              <span
                className={cn(
                  "truncate",
                  interactive && "border-b border-border transition-colors hover:border-primary/40",
                )}
              >
                {company}
              </span>
            </DirectoryCompanyTrigger>
          )}
        </div>
      </div>

      {interactive || sessionCount > 0 || entry.groups.length > 0 ? (
        <div className="mt-4 flex items-end justify-between gap-3 border-t border-border/70 pt-3">
          <div className="min-w-0 space-y-2">
            {/* PRELEGENT MA BYĆ WIDOCZNY W SIATCE, a jego panele - w oknie:
                tytuły i godziny zamieniają kartę w decyzję, ale na karcie
                rozpychałyby siatkę do wysokości najbardziej zajętej osoby. */}
            {sessionCount > 0 && (
              <p className={cn(OVERLINE_CLASS, "tabular-nums text-brand-ink")}>
                {t("eventFront.directory.kind.speaker")}
                {" · "}
                {t("eventFront.directory.sessionsCount", { count: sessionCount })}
              </p>
            )}
            {/* Ten sam atom, co w podglądzie „Mój profil" - jedna plakietka grupy
                na cały moduł, żeby przepustka nie miała dwóch rysunków. */}
            <EventGroupTags groups={entry.groups} lang={lang} />
          </div>
          {/* Podpis, nie drugi przycisk: nazwę dostępną niesie przycisk osoby. */}
          {interactive && (
            <span
              aria-hidden="true"
              className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground"
            >
              {t("eventFront.directory.viewProfile")}
              <ArrowRight
                strokeWidth={1.5}
                className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none"
              />
            </span>
          )}
        </div>
      ) : null}
    </article>
  );
}

const groupName = eventGroupName;
