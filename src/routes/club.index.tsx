// /club - hub klubów dyskusyjnych.
//
// PRZEMODELOWANIE KOMPAKTOWE (08.2026). Poprzedni hub był stroną o module:
// duży nagłówek, pasek liczników w trzech kartach, panel członkostw, strumień
// aktywności, dwie siatki katalogu i sekcja „jak to działa". Pierwszy klub
// pojawiał się poniżej pierwszego ekranu, a ta sama nazwa klubu potrafiła
// wystąpić trzy razy (panel członkostw, strumień, katalog).
//
// Hub jest KATALOGIEM KLUBÓW - jedyną treścią jest lista klubów, a wątki
// dyskusyjne mieszkają w klubie, jedno kliknięcie dalej. Stąd układ:
//
//   1. Pas nagłówka: czym to jest, stan dostępu, liczniki w jednej linii,
//      wyszukiwarka (zalogowany) albo wejście do rejestracji (anonim).
//   2. Zaproszenia - jedyny moduł z terminem, więc zostaje i stoi wysoko.
//   3. Pasek sterowania: obszary polityki + przełącznik układu.
//   4. Katalog: „Moje kluby" (gdy są) i „Odkryj" / „Kluby otwarte".
//
// `noindex` zostaje: lista miesza kluby publiczne z members-only, więc jej
// zaindeksowanie wyciekałoby nazwy klubów zamkniętych. Indeksowalna jest
// strona KLUBU (lib/clubs/clubHead) i to ona jest wejściem z wyszukiwarki.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LogIn } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useCurrentTier } from "@/lib/billing/tiers";
import {
  useClubList,
  useClubSearch,
  useMyClubInvitations,
  useRespondClubInvitation,
} from "@/lib/clubs/useClubs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { resolveClubHubAccess } from "@/lib/clubs/hubAccess";
import { toClubSaveError } from "@/lib/clubs/types";
import { ClubHubHero } from "@/components/clubs/organisms/ClubHubHero";
import { ClubInvitationInbox } from "@/components/clubs/organisms/ClubInvitationInbox";
import { ClubDirectory } from "@/components/clubs/organisms/ClubDirectory";
import { MyClubsTabs } from "@/components/clubs/organisms/MyClubsTabs";
import { ClubSpecializationGrid } from "@/components/clubs/organisms/ClubSpecializationGrid";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import {
  ClubGlobalSearchInput,
  ClubGlobalSearchResults,
} from "@/components/clubs/organisms/ClubGlobalSearch";
import {
  ClubHubLayoutSwitch,
  useClubHubLayout,
} from "@/components/clubs/molecules/ClubHubLayoutSwitch";
import { ClubTopicNav } from "@/components/clubs/molecules/ClubTopicNav";
import { rankClubs } from "@/lib/clubs/clubMatch";
import { topicLabel } from "@/lib/clubs/topicCatalog";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import { buildClubHead } from "@/lib/clubs/clubHead";
import { ensureClubI18n } from "@/lib/i18n-club";

/** Rozmiar porcji katalogu klubów na hubie. */
const CATALOG_PAGE = 100;

export const Route = createFileRoute("/club/")({
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
  const { topics: topicCatalog } = useClubTopics();
  const [query, setQuery] = useState("");
  // Układ katalogu jest decyzją CZYTELNIKA, więc mieszka w localStorage, a nie
  // w bazie - w odróżnieniu od `clubs.layout`, którym rządzi administrator.
  const [hubLayout, setHubLayout] = useClubHubLayout();

  // `club_list` jest nadane roli `anon` i samo odsiewa wiersze: dla wołającego
  // bez sesji zwraca WYŁĄCZNIE kluby `public` o statusie `active`.
  const [catalogLimit, setCatalogLimit] = useState(CATALOG_PAGE);
  const clubsQ = useClubList(true, catalogLimit);
  const invitationsQ = useMyClubInvitations(signedIn);
  const tierQ = useCurrentTier();
  const respondM = useRespondClubInvitation();

  const clubs = useMemo(() => clubsQ.data?.rows ?? [], [clubsQ.data]);
  const clubsTotal = clubsQ.data?.total ?? 0;
  const invitations = invitationsQ.data ?? [];

  // Wyszukiwanie ZASTĘPUJE katalog, nie stoi obok niego.
  const debouncedQuery = useDebouncedValue(query, 250);
  const searching = debouncedQuery.trim().length >= 2;
  const searchQ = useClubSearch({
    query: debouncedQuery,
    clubId: null,
    enabled: searching && signedIn,
  });

  // Wyszukiwanie serwerowe szuka w WĄTKACH. Nazwa klubu wpisana we fragmentach
  // ("bezp srodkowo") nie trafiała więc w nic - katalog mamy w pamięci, więc
  // dokładamy do wyników dopasowanie nazw posortowane po trafności.
  const clubHits = useMemo(
    () =>
      searching
        ? rankClubs(clubs, debouncedQuery, {
            isPl,
            topicLabel: (club) =>
              club.policy_area === null
                ? null
                : topicLabel(club.policy_area, isPl ? "pl" : "en", topicCatalog),
          })
        : [],
    [searching, clubs, debouncedQuery, isPl, topicCatalog],
  );

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

  const stats = useMemo(
    () => ({
      clubs: clubs.length,
      threads: clubs.reduce((sum, c) => sum + c.thread_count, 0),
      seats: clubs.reduce((sum, c) => sum + c.member_count, 0),
      mine: mine.length,
    }),
    [clubs, mine.length],
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

  // Awaria listy klubów to jedyny stan, w którym hub nie ma z czego zbudować
  // ŻADNEGO modułu - katalog JEST tą stroną.
  if (clubsQ.isError) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-12">
        <ClubErrorNotice onRetry={() => void clubsQ.refetch()} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-6">
      <ClubHubHero access={signedIn ? access : null} signedIn={signedIn} stats={stats}>
        {signedIn ? (
          <ClubGlobalSearchInput value={query} onChange={setQuery} />
        ) : (
          <Button
            asChild
            className="w-full border-0 sm:w-auto"
            style={{ background: "var(--cp-gold)", color: "var(--cp-gold-ink)" }}
          >
            <Link to="/membership-registration">
              <LogIn className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("club.signIn")}
            </Link>
          </Button>
        )}
      </ClubHubHero>

      {signedIn && invitations.length > 0 ? (
        <ClubInvitationInbox
          invitations={invitations}
          isPl={isPl}
          pendingId={respondM.isPending ? (respondM.variables?.invitationId ?? null) : null}
          onRespond={respond}
        />
      ) : null}

      {searching ? (
        <>
          {clubHits.length > 0 ? (
            <ClubDirectory
              title={t("club.hub.clubMatches")}
              empty={t("club.emptyDiscover")}
              clubs={clubHits}
              isPl={isPl}
              loading={false}
              layout={hubLayout}
            />
          ) : null}
          <ClubGlobalSearchResults
            hits={searchQ.data ?? []}
            pending={searchQ.isPending}
            failed={searchQ.isError}
            query={debouncedQuery}
            isPl={isPl}
            onRetry={() => void searchQ.refetch()}
          />
        </>
      ) : (
        <>
          {signedIn ? (
            <>
              {/* Pasek sterowania katalogiem: obszary polityki po lewej, układ
                  po prawej. Jeden wiersz zamiast dwóch osobnych bloków. */}
              <div className="mb-4 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <ClubTopicNav clubs={clubs} value={topic} onChange={setTopic} isPl={isPl} />
                </div>
                <ClubHubLayoutSwitch value={hubLayout} onChange={setHubLayout} />
              </div>

              {mine.length > 0 ? (
                <MyClubsTabs
                  clubs={mine}
                  isPl={isPl}
                  loading={clubsQ.isPending}
                  layout={hubLayout}
                />
              ) : null}

              {/* Katalog nie stoi juz plasko na hubie: zalogowany wybiera
                  najpierw specjalizacje, a kluby wypisuje jej strona. */}
              <ClubSpecializationGrid signedIn />

              {topic === null ? null : (
                <div id="club-discover" className="scroll-mt-28">
                  <ClubDirectory
                    title={t("club.discover")}
                    empty={t("club.hub.emptyTopic")}
                    clubs={discover}
                    isPl={isPl}
                    loading={clubsQ.isPending}
                    layout={hubLayout}
                  />
                </div>
              )}
            </>
          ) : (
            /* Anonim nie dostaje pustego katalogu "Kluby otwarte", tylko mapę
               ośmiu specjalizacji i drogę do formularza zgłoszenia. */
            <ClubSpecializationGrid />
          )}

          {/* Ucięcie katalogu mówi się WPROST i daje następny krok. */}
          {signedIn && clubsTotal > clubs.length ? (
            <div className="-mt-2 mb-8 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCatalogLimit((n) => n + CATALOG_PAGE)}
              >
                {t("club.hub.showMore", { shown: clubs.length, total: clubsTotal })}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
