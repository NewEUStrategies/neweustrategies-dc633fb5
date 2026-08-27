// Organizm: DYSKUSJE - piąta z zawsze obecnych pozycji menu wydarzenia.
// Wątki grupy klubu dyskusyjnego przypiętej do wydarzenia w studiu.
//
// TO JEST ZAJAWKA KLUBU, NIE DRUGI SILNIK DYSKUSJI. Odpowiadanie, moderacja,
// reakcje, powiadomienia i archiwum żyją w module klubów - najbogatszym
// silniku w tym repozytorium - a projekt wprost odrzuca budowanie drugiego
// (docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md:641-643). Dlatego każda
// karta jest ODNOŚNIKIEM do wątku w klubie (`/club/$clubSlug/t/$threadSlug`),
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
// miejsce po nazwisku.
import { Link } from "@tanstack/react-router";
import { MessageSquare, MessagesSquare, Pin } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import {
  EMPTY_EVENT_DISCUSSIONS,
  type DiscussionClub,
  type DiscussionThread,
} from "@/lib/events/publicEventApi";
import { useEventDiscussions } from "@/lib/events/usePublicEvent";
import { SpeakerAvatar } from "@/components/events/SpeakerAvatar";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

// Sześć wartości `club_threads.kind` domkniętych CHECK-iem w bazie. Lista stoi
// tutaj, żeby nieznana wartość (dopisana w bazie bez tłumaczenia) nie wyszła na
// stronę surowym kluczem - wtedy plakietki po prostu nie ma.
const THREAD_KINDS = [
  "discussion",
  "question",
  "position",
  "resource",
  "announcement",
  "poll",
] as const;

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
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
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
            <ul className="space-y-2" aria-label={t("eventFront.discussions.listLabel")}>
              {data.threads.map((thread) => (
                <li key={thread.id}>
                  <ThreadCard thread={thread} club={data.club} />
                </li>
              ))}
            </ul>
          )}

          {data.club !== null && (
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link to="/club/$clubSlug" params={{ clubSlug: data.club.slug }}>
                  <MessagesSquare className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("eventFront.discussions.openInClub", { club: clubName })}
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

function ThreadCard({ thread, club }: { thread: DiscussionThread; club: DiscussionClub | null }) {
  const { t } = useTranslation();
  const authorName = thread.isAnonymous
    ? t("eventFront.discussions.anonymousAuthor")
    : (thread.authorName ?? t("eventFront.discussions.anonymousAuthor"));
  const kind = THREAD_KINDS.find((value) => value === thread.kind) ?? null;

  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {thread.pinnedAt !== null && (
          <Pin className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        )}
        {kind !== null && (
          <Badge variant="outline" className="text-[11px]">
            {t(`eventFront.discussions.kind.${kind}`)}
          </Badge>
        )}
      </div>
      <p className="mt-1 font-medium leading-snug text-foreground">{thread.title}</p>
      {thread.excerpt !== null && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{thread.excerpt}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <SpeakerAvatar name={authorName} photoUrl={thread.authorAvatar} size="sm" />
          {authorName}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
          {t("eventFront.discussions.replies", { count: thread.replyCount })}
        </span>
      </div>
    </>
  );

  // Wątek bez klubu nie ma jak zostać otwarty - a karta bez odnośnika jest
  // atrapą. Taki stan jest niemożliwy przy `state = 'ok'` (RPC oddaje klub
  // razem z wątkami), więc to jest domknięcie typu, nie druga ścieżka widoku.
  if (club === null) {
    return <div className="rounded-lg border border-border/60 bg-card p-3">{body}</div>;
  }

  return (
    <Link
      to="/club/$clubSlug/t/$threadSlug"
      params={{ clubSlug: club.slug, threadSlug: thread.slug }}
      className="block rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </Link>
  );
}

/**
 * `not_open_yet` -> `notOpenYet`. Klucze stanu są w słowniku w camelCase, a baza
 * mówi snake_case - zamiana stoi w jednym miejscu, żeby nie było dwóch list
 * nazw tego samego zbioru stanów.
 */
function stateKey(state: string): string {
  return state.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}
