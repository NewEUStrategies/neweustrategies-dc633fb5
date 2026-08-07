// /club - strona główna klubów dyskusyjnych (minisite).
//
// `noindex` dla całej powierzchni poza klubami public - ta sama doktryna,
// co /people i /network. Klub public jest indeksowalny i staje się realnym
// lejkiem pozyskania, ale ta STRONA jest listą, a lista miesza kluby publiczne
// z members-only, więc indeksowanie jej wyciekałoby nazwy klubów zamkniętych.
//
// UKŁAD. Strona jest zbudowana z modułów w kolejności "co jest pilne" ->
// "co jest moje" -> "co się dzieje" -> "co mogę dołączyć" -> "jak to działa":
//
//   1. Nagłówek ze stanem dostępu (i zaproszeniem do planu, gdy go brak).
//   2. Zaproszenia - jedyny moduł z terminem, więc stoi najwyżej.
//   3. Liczniki - liczone z już pobranej listy, bez drugiego zapytania.
//   4. Nawigacja po obszarach polityki - to jest wejście "per tematyka".
//   5. Strumień aktywności PONAD klubami.
//   6. Moje kluby / odkryj.
//   7. Jak to działa - trzy reguły, których nie widać z interfejsu.
//
// FILTR TEMATYCZNY dotyczy jednocześnie strumienia i siatki "odkryj", bo
// inaczej wybór obszaru zawężałby połowę ekranu, a drugą zostawiał - i nikt
// nie wiedziałby, którą.
//
// BRAMKA DOSTĘPU JEST MIĘKKA. Rozstrzyga wyłącznie, jaki panel narysować.
// Twardą trzyma `club_capabilities` w bazie - stąd `locked` nie zabiera z listy
// ani jednego wiersza, który RPC już zwróciło.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentTier } from "@/lib/billing/tiers";
import {
  useClubActivityFeed,
  useClubList,
  useClubSearch,
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
import {
  ClubGlobalSearchInput,
  ClubGlobalSearchResults,
} from "@/components/clubs/organisms/ClubGlobalSearch";
import { ClubStatStrip } from "@/components/clubs/molecules/ClubStatStrip";
import { ClubTopicNav } from "@/components/clubs/molecules/ClubTopicNav";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/")({
  head: () => ({
    meta: [{ title: "Kluby dyskusyjne" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: ClubHub,
});

function ClubHub() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const { session, isStaff } = useAuth();

  const [topic, setTopic] = useState<string | null>(null);
  const [sort, setSort] = useState<ClubActivitySort>("new");
  const [query, setQuery] = useState("");

  const clubsQ = useClubList();
  const membershipsQ = useMyClubMemberships(Boolean(session));
  const invitationsQ = useMyClubInvitations(Boolean(session));
  const tierQ = useCurrentTier();
  const respondM = useRespondClubInvitation();

  const clubs = useMemo(() => clubsQ.data?.rows ?? [], [clubsQ.data]);
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
    enabled: searching && Boolean(session),
  });

  // Strumień pyta o treść klubów, więc nie ma po co wołać go dla wylogowanego -
  // ekran dla anonima kończy się na zachęcie do logowania. Podczas szukania
  // też nie: jego wynik i tak nie trafiłby na ekran.
  const activityQ = useClubActivityFeed({
    sort,
    policyArea: topic,
    limit: 12,
    enabled: Boolean(session) && !searching,
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

  if (!session) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <MessagesSquare className="h-8 w-8 text-muted-foreground" />
            <h1 className="text-xl font-semibold">{t("club.membersOnlyTitle")}</h1>
            <p className="max-w-md text-sm text-muted-foreground">{t("club.membersOnlyBody")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <ClubHubHero access={access} />

      <ClubInvitationInbox
        invitations={invitations}
        isPl={isPl}
        pending={respondM.isPending}
        onRespond={respond}
      />

      {clubs.length > 0 ? (
        <div className="mb-6">
          <ClubStatStrip clubs={clubs} />
        </div>
      ) : null}

      <ClubMembershipPanel
        memberships={membershipsQ.data ?? []}
        isPl={isPl}
        loading={membershipsQ.isPending}
      />

      <div className="mb-8 space-y-5">
        <ClubGlobalSearchInput value={query} onChange={setQuery} />

        {/* Filtr tematyczny znika w trybie wyszukiwania: chipsy, które nie mają
            na co działać (RPC wyszukiwania nie przyjmuje obszaru), są gorsze
            niż ich brak. */}
        {searching ? null : (
          <ClubTopicNav clubs={clubs} value={topic} onChange={setTopic} isPl={isPl} />
        )}

        {searching ? (
          <ClubGlobalSearchResults
            hits={searchQ.data ?? []}
            pending={searchQ.isPending}
            query={debouncedQuery}
            isPl={isPl}
          />
        ) : (
          <ClubActivityFeed
            rows={activityQ.data ?? []}
            sort={sort}
            onSortChange={setSort}
            pending={activityQ.isPending}
            isPl={isPl}
          />
        )}
      </div>

      <ClubDirectory
        title={t("club.myClubs")}
        empty={t("club.empty")}
        clubs={mine}
        isPl={isPl}
        loading={clubsQ.isPending}
      />

      <ClubDirectory
        title={t("club.discover")}
        empty={topic === null ? t("club.emptyDiscover") : t("club.hub.emptyTopic")}
        clubs={discover}
        isPl={isPl}
        loading={clubsQ.isPending}
      />

      <ClubHowItWorks />
    </div>
  );
}
