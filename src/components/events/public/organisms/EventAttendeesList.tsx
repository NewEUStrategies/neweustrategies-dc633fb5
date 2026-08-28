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
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, Search, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import {
  EMPTY_ATTENDEE_DIRECTORY,
  type AttendeeEntry,
  type AttendeeGroupCount,
  type AttendeeGroupTag,
} from "@/lib/events/publicEventApi";
import { useEventAttendees, useEventAttendeeVisibility } from "@/lib/events/usePublicEvent";
import {
  fetchEventSpeakerSessions,
  type SpeakerSessionEntry,
} from "@/lib/events/participantTicketsApi";
import { SpeakerAvatar } from "@/components/events/SpeakerAvatar";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

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

  const data = attendees.data ?? EMPTY_ATTENDEE_DIRECTORY;

  return (
    // Bez własnego nagłówka sekcja NIE dostaje `aria-labelledby` wskazującego
    // na nieistniejący węzeł - zostaje zwykłym blokiem pod nagłówkiem, który
    // narysował ktoś nad nią.
    <section
      className="space-y-4"
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
      ) : attendees.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : attendees.isError ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
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
                  <p className="text-xs text-muted-foreground">
                    {t("eventFront.attendees.count", { count: data.totalCount })}
                  </p>
                  <ul
                    className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                    aria-label={t("eventFront.attendees.listLabel")}
                  >
                    {data.rows.map((entry) => (
                      <li key={entry.registrationId} className="flex">
                        <AttendeeCard
                          entry={entry}
                          lang={lang}
                          sessions={speakerSessions.data?.get(entry.registrationId) ?? null}
                        />
                      </li>
                    ))}
                  </ul>

                  {data.totalCount > PAGE_SIZE && (
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={offset === 0}
                        onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
                      >
                        {t("eventFront.attendees.prevPage")}
                      </Button>
                      <span className="text-xs text-muted-foreground">
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
  );
}

/** Karta z jednym zdaniem i następnym krokiem - trzy odmowy, jeden układ. */
function NoticeCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-4 py-3">
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
      <div className="rounded-md border border-border bg-card px-3 py-2.5">
        <p className="text-sm text-foreground">{t("eventFront.attendees.profileHiddenLabel")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("eventFront.attendees.profileHiddenHint")}
        </p>
      </div>
    );
  }

  return (
    <label className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
      <Switch checked={listed} disabled={pending} onCheckedChange={onChange} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-foreground">
          {t("eventFront.attendees.listedLabel")}
        </span>
        <span className="block text-xs text-muted-foreground">
          {t("eventFront.attendees.listedHint")}
        </span>
      </span>
      <Badge variant={listed ? "secondary" : "outline"}>
        {listed ? t("eventFront.attendees.listedOn") : t("eventFront.attendees.listedOff")}
      </Badge>
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
    <div className="space-y-2">
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
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
        <Users className="h-4 w-4" aria-hidden="true" />
        {t("eventFront.attendees.groupsHeading")}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("eventFront.attendees.count", { count: total })}
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {groups.map((group) => (
          <li key={group.id}>
            <Badge
              variant="outline"
              style={group.color === null ? undefined : { borderColor: group.color }}
            >
              {groupName(group, lang)}
              {" · "}
              {t("eventFront.attendees.groupCount", { count: group.count })}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttendeeCard({ entry, lang }: { entry: AttendeeEntry; lang: "pl" | "en" }) {
  const { t } = useTranslation();

  const body = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <SpeakerAvatar name={entry.name} photoUrl={entry.avatarUrl} size="md" />
        <div className="min-w-0">
          <p title={entry.name} className="truncate text-sm font-semibold text-foreground">
            {entry.name}
          </p>
          {/* Linia podpisu ISTNIEJE TYLKO GDY MA TREŚĆ - pusta czyta się
              w siatce jak uszkodzone dane, nie jak brak danych. */}
          {entry.jobTitle !== null && (
            <p title={entry.jobTitle} className="truncate text-xs text-muted-foreground">
              {entry.jobTitle}
            </p>
          )}
          {entry.company !== null && (
            <p title={entry.company} className="truncate text-xs text-foreground/80">
              {entry.company}
            </p>
          )}
        </div>
      </div>
      {entry.groups.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {entry.groups.map((group) => (
            <Badge
              key={group.id}
              variant="outline"
              style={group.color === null ? undefined : { borderColor: group.color }}
            >
              {groupName(group, lang)}
            </Badge>
          ))}
        </div>
      )}
    </>
  );

  // ODNOŚNIK TYLKO DO ISTNIEJĄCEGO PROFILU. Osoba na tej liście ma konto (inaczej
  // nie miałaby czym włączyć widoczności), ale publicznego adresu profilu mieć
  // nie musi - a odnośnik bez sluga prowadziłby w nikąd. Trasa `/author/$slug`
  // jest tą samą, której używa karta autora w klubach: jeden adres profilu
  // w całym serwisie, nie drugi na potrzeby wydarzeń.
  if (entry.profileSlug === null) {
    return <div className="w-full rounded-md border border-border bg-card p-4">{body}</div>;
  }

  return (
    <Link
      to="/author/$slug"
      params={{ slug: entry.profileSlug }}
      className="w-full rounded-md border border-border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
      <span className="sr-only">{t("eventFront.attendees.profileLink", { name: entry.name })}</span>
    </Link>
  );
}

function groupName(group: AttendeeGroupTag, lang: "pl" | "en"): string {
  return pickLocalized({ name_pl: group.namePl, name_en: group.nameEn }, "name", lang);
}
