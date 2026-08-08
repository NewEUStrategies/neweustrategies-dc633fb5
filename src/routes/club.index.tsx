// /club - strona główna klubów dyskusyjnych.
//
// PRZEMODELOWANIE (08.2026). Poprzedni układ był poprawną listą modułów, ale
// miał trzy wady strukturalne, które audyt nazwał po imieniu:
//
//   1. TWARDA BRAMKA NA ANONIMIE. Cała strona kończyła się dla wylogowanego
//      kartą "zaloguj się". Klub `public` miał być według specyfikacji (V1 §5.1)
//      JEDYNĄ powierzchnią modułu, która dowozi ruch z wyszukiwarek i pracuje
//      jako lejek pozyskania - a nie dało się go zobaczyć bez konta. Bramka
//      jest teraz MIĘKKA: anonim widzi katalog klubów publicznych i wie, co
//      dostanie po zalogowaniu, zamiast patrzeć w ścianę.
//   2. AWARIA WYGLĄDAŁA JAK PUSTKA. `clubsQ.data ?? []` przy padniętym RPC
//      dawało "Nie należysz jeszcze do żadnego klubu" - komunikat fałszywy.
//   3. LICZNIK NIEPRZECZYTANYCH NIE MIAŁ ŹRÓDŁA. Panel członkostw pokazywał
//      kropkę liczoną z `last_activity_at`, a od A18 istnieje policzony przez
//      bazę `club_unread` - i akcja "oznacz jako przeczytane".
//
// UKŁAD. Moduły w kolejności "co jest pilne" -> "co jest moje" -> "co się
// dzieje" -> "co mogę dołączyć" -> "jak to działa". Ta kolejność się broni
// i została:
//
//   1. Nagłówek ze stanem dostępu (i zaproszeniem do planu, gdy go brak).
//   2. Zaproszenia - jedyny moduł z terminem, więc stoi najwyżej.
//   3. Liczniki - liczone z już pobranej listy, bez drugiego zapytania.
//   4. Moje kluby (panel skrótów z licznikiem nieprzeczytanych).
//   5. Wyszukiwanie ponad klubami + nawigacja po obszarach polityki.
//   6. Strumień aktywności PONAD klubami (albo wyniki wyszukiwania).
//   7. Katalog: moje / odkryj.
//   8. Jak to działa - trzy reguły, których nie widać z interfejsu.
//
// FILTR TEMATYCZNY dotyczy jednocześnie strumienia i siatki "odkryj", bo
// inaczej wybór obszaru zawężałby połowę ekranu, a drugą zostawiał - i nikt
// nie wiedziałby, którą.
//
// `noindex` dla tej strony zostaje, mimo punktu 1: to jest LISTA, która miesza
// kluby publiczne z members-only, więc jej zaindeksowanie wyciekałoby nazwy
// klubów zamkniętych. Indeksowalna jest strona KLUBU (patrz lib/clubs/clubHead),
// i to ona jest wejściem z wyszukiwarki.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LogIn, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentTier } from "@/lib/billing/tiers";
import {
  useClubActivityFeed,
  useClubList,
  useClubSearch,
  useMarkClubRead,
  useMyClubInvitations,
  useMyClubMemberships,
  useRespondClubInvitation,
} from "@/lib/clubs/useClubs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { resolveClubHubAccess } from "@/lib/clubs/hubAccess";
import { toClubSaveError, type ClubActivitySort } from "@/lib/clubs/types";
import { ClubHubHero } from "@/components/clubs/organisms/ClubHubHero";
import { ClubInvitationInbox } from "@/components/clubs/organisms/ClubInvitationInbox";
import { ClubActivityFeed } from "@/components/clubs/organisms/ClubActivityFeed";
import { ClubDirectory } from "@/components/clubs/organisms/ClubDirectory";
import { ClubHowItWorks } from "@/components/clubs/organisms/ClubHowItWorks";
import { ClubMembershipPanel } from "@/components/clubs/organisms/ClubMembershipPanel";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import {
  ClubGlobalSearchInput,
  ClubGlobalSearchResults,
} from "@/components/clubs/organisms/ClubGlobalSearch";
import { ClubStatStrip } from "@/components/clubs/molecules/ClubStatStrip";
import {
  ClubHubLayoutSwitch,
  useClubHubLayout,
} from "@/components/clubs/molecules/ClubHubLayoutSwitch";
import { ClubTopicNav } from "@/components/clubs/molecules/ClubTopicNav";
import { buildClubHead } from "@/lib/clubs/clubHead";
import { ensureClubI18n } from "@/lib/i18n-club";

/** Rozmiar porcji katalogu klubów na hubie. */
const CATALOG_PAGE = 100;

export const Route = createFileRoute("/club/")({
  // Tytuł jechał tu polskim literałem, także pod /en/ - a `/club` NIE jest na
  // liście tras nielokalizowanych, więc wersja angielska realnie istnieje.
  // `buildClubHead` bez klubu daje zlokalizowany tytuł modułu i `noindex`.
  head: () => buildClubHead({ fallbackPath: "/club", club: null, forceNoindex: true }),
  component: ClubHub,
});

function ClubHub() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const { session, isStaff } = useAuth();
  const signedIn = Boolean(session);

  const [topic, setTopic] = useState<string | null>(null);
  const [sort, setSort] = useState<ClubActivitySort>("new");
  const [query, setQuery] = useState("");
  // Układ katalogu jest decyzją CZYTELNIKA, więc mieszka w localStorage, a nie
  // w bazie - w odróżnieniu od `clubs.layout`, którym rządzi administrator.
  const [hubLayout, setHubLayout] = useClubHubLayout();

  // `club_list` jest nadane roli `anon` i samo odsiewa wiersze: dla wołającego
  // bez sesji zwraca WYŁĄCZNIE kluby `public` o statusie `active`. Wołamy je
  // więc także dla anonima - bramka jest w bazie, nie w tym pliku.
  // Katalog rósł do stu klubów i tam się kończył - `club_list` zwraca
  // `total_count` w każdym wierszu, a klient go odrzucał. Sto pierwszy klub
  // istniał w bazie i nie istniał na hubie: bez komunikatu, bez licznika, bez
  // sposobu, żeby to zauważyć. "Pokaż więcej" zamiast paginacji, bo hub jest
  // powierzchnią PRZEGLĄDANIA, a nie tabelą - numer strony byłby tu pytaniem,
  // na które nikt nie umie odpowiedzieć.
  const [catalogLimit, setCatalogLimit] = useState(CATALOG_PAGE);
  const clubsQ = useClubList(true, catalogLimit);
  const membershipsQ = useMyClubMemberships(signedIn);
  const invitationsQ = useMyClubInvitations(signedIn);
  const tierQ = useCurrentTier();
  const respondM = useRespondClubInvitation();
  const markReadM = useMarkClubRead();

  const clubs = useMemo(() => clubsQ.data?.rows ?? [], [clubsQ.data]);
  const clubsTotal = clubsQ.data?.total ?? 0;
  const invitations = invitationsQ.data ?? [];

  // Wyszukiwanie ZASTĘPUJE strumień, nie stoi obok niego. Próg dwóch znaków
  // i debounce siedzą w hooku - tutaj tylko decyzja, który moduł rysować.
  const debouncedQuery = useDebouncedValue(query, 250);
  const searching = debouncedQuery.trim().length >= 2;
  const searchQ = useClubSearch({
    query: debouncedQuery,
    // `null` = szukaj po WSZYSTKICH klubach. RPC umiał to od A6, tylko nikt
    // go tak nie wołał: strona klubu zawsze podawała swoje id.
    clubId: null,
    enabled: searching && signedIn,
  });

  // Strumień pyta o treść klubów, więc dla wylogowanego nie ma czego pokazać -
  // `club_activity_feed` jest nadane wyłącznie roli `authenticated`. Podczas
  // szukania też nie: jego wynik i tak nie trafiłby na ekran.
  const activityQ = useClubActivityFeed({
    sort,
    policyArea: topic,
    limit: 12,
    enabled: signedIn && !searching,
  });

  const access = resolveClubHubAccess({
    tierRank: tierQ.data?.rank ?? null,
    activeMemberships: clubs.filter((c) => c.my_status === "active").length,
    pendingInvitations: invitations.length,
    isStaff,
  });

  const mine = clubs.filter((c) => c.my_status === "active");
  const discover = clubs.filter(
    (c) => c.my_status !== "active" && (topic === null || c.policy_area === topic),
  );

  const respond = (invitationId: string, accept: boolean) =>
    respondM.mutate(
      { invitationId, accept },
      {
        onSuccess: () =>
          toast.success(accept ? t("club.invitationAccepted") : t("club.invitationDeclined")),
        onError: (error) => toast.error(t(`adminClubs.create.error.${toClubSaveError(error)}`)),
      },
    );

  // Awaria listy klubów to jedyny stan, w którym strona nie ma z czego zbudować
  // ŻADNEGO modułu - reszta (strumień, wyszukiwarka) zgłasza się sama.
  if (clubsQ.isError) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <ClubErrorNotice onRetry={() => void clubsQ.refetch()} />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      {signedIn ? (
        <>
          <ClubHubHero access={access} />

          <ClubInvitationInbox
            invitations={invitations}
            isPl={isPl}
            pendingId={respondM.isPending ? (respondM.variables?.invitationId ?? null) : null}
            onRespond={respond}
          />
        </>
      ) : (
        <AnonymousIntro publicClubCount={clubs.length} />
      )}

      {clubs.length > 0 ? (
        <div className="mb-6">
          <ClubStatStrip clubs={clubs} />
        </div>
      ) : null}

      {signedIn ? (
        <ClubMembershipPanel
          memberships={membershipsQ.data ?? []}
          isPl={isPl}
          loading={membershipsQ.isPending}
          failed={membershipsQ.isError}
          markingClubId={markReadM.isPending ? (markReadM.variables ?? null) : null}
          onMarkRead={(clubId) =>
            markReadM.mutate(clubId, {
              onError: () => toast.error(t("adminClubs.saveFailed")),
            })
          }
        />
      ) : null}

      <div className="mb-8 space-y-5">
        {/* Wyszukiwarka wymaga sesji: `club_search` liczy widoczność per wiersz
            przez club_capabilities, a dla anonima ten filtr przepuszcza tylko
            kluby publiczne - czyli dokładnie to, co i tak widać w katalogu
            niżej. Pole, które nie ma czego dodać, jest gorsze niż jego brak. */}
        {signedIn ? <ClubGlobalSearchInput value={query} onChange={setQuery} /> : null}

        {/* Filtr tematyczny znika w trybie wyszukiwania: chipsy, które nie mają
            na co działać (RPC wyszukiwania nie przyjmuje obszaru), są gorsze
            niż ich brak. */}
        {searching ? null : (
          <ClubTopicNav clubs={clubs} value={topic} onChange={setTopic} isPl={isPl} />
        )}

        {!signedIn ? null : searching ? (
          <ClubGlobalSearchResults
            hits={searchQ.data ?? []}
            pending={searchQ.isPending}
            failed={searchQ.isError}
            query={debouncedQuery}
            isPl={isPl}
            onRetry={() => void searchQ.refetch()}
          />
        ) : (
          <ClubActivityFeed
            rows={activityQ.data ?? []}
            sort={sort}
            onSortChange={setSort}
            pending={activityQ.isPending}
            failed={activityQ.isError}
            isPl={isPl}
            onRetry={() => void activityQ.refetch()}
          />
        )}
      </div>

      {signedIn ? (
        <ClubDirectory
          title={t("club.myClubs")}
          empty={t("club.empty")}
          clubs={mine}
          isPl={isPl}
          loading={clubsQ.isPending}
          layout={hubLayout}
          action={<ClubHubLayoutSwitch value={hubLayout} onChange={setHubLayout} />}
        />
      ) : null}

      <ClubDirectory
        title={signedIn ? t("club.discover") : t("club.hub.publicCatalog")}
        empty={topic === null ? t("club.emptyDiscover") : t("club.hub.emptyTopic")}
        clubs={discover}
        isPl={isPl}
        loading={clubsQ.isPending}
        layout={hubLayout}
        action={
          signedIn ? undefined : <ClubHubLayoutSwitch value={hubLayout} onChange={setHubLayout} />
        }
      />

      {/* Ucięcie katalogu mówi się WPROST i daje następny krok. Milcząca
          różnica między "to wszystkie kluby" a "to pierwsze sto" jest tym
          rodzajem braku, którego nie da się zauważyć od środka. */}
      {clubsTotal > clubs.length ? (
        <div className="mb-10 -mt-6 text-center">
          <Button variant="outline" onClick={() => setCatalogLimit((n) => n + CATALOG_PAGE)}>
            {t("club.hub.showMore", { shown: clubs.length, total: clubsTotal })}
          </Button>
        </div>
      ) : null}

      <ClubHowItWorks />
    </div>
  );
}

/**
 * Wejście dla wylogowanego. NIE jest ścianą: mówi, co ta powierzchnia robi,
 * ile klubów publicznych da się przejrzeć bez konta i co dokładnie odblokowuje
 * zalogowanie. Poprzednia wersja kończyła stronę na "zaloguj się", więc klub
 * publiczny - jedyna powierzchnia modułu pomyślana jako lejek pozyskania - nie
 * miał żadnej drogi wejścia dla kogoś, kto trafił tu z wyszukiwarki.
 */
function AnonymousIntro({ publicClubCount }: { publicClubCount: number }) {
  const { t } = useTranslation();

  return (
    <Card className="mb-6 overflow-hidden border-primary/30">
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <MessagesSquare className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            {t("club.title")}
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">{t("club.hub.anonLead")}</p>
          <p className="text-sm text-muted-foreground">
            {publicClubCount > 0
              ? t("club.hub.anonOpenCount", { count: publicClubCount })
              : t("club.hub.anonNoPublic")}
          </p>
        </div>
        <Button asChild className="shrink-0">
          <Link to="/membership-registration">
            <LogIn className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("club.signIn")}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
