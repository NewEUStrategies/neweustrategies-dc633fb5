// /club/$clubSlug/minisite - kuratorski widok treści klubu.
//
// `noindex` bez wyjątków, także dla klubu `public`: minisite pokazuje
// FRAGMENTY wypowiedzi, a nie sam katalog tytułów. W klubie z regułą Chatham
// House to jest dokładnie ta treść, której nie wolno wystawić robotowi.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MessagesSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentTier } from "@/lib/billing/tiers";
import { useClubBySlug, useClubThreads, useMyClubInvitations } from "@/lib/clubs/useClubs";
import { resolveClubMinisiteAccess } from "@/lib/clubs/minisiteAccess";
import { ClubMinisite } from "@/components/clubs/organisms/ClubMinisite";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/api";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/minisite")({
  loader: async ({ context, params }) => {
    const club = await context.queryClient
      .ensureQueryData({
        queryKey: clubKeys.bySlug(params.clubSlug),
        queryFn: () => fetchClubBySlug(params.clubSlug),
      })
      .catch(() => null);
    return { club: toClubHeadSource(club) };
  },
  // `forceNoindex` bez wyjątków, także dla klubu `public` - powód w nagłówku
  // pliku. Tytuł i tak niesie nazwę klubu: zakładka przeglądarki nie należy do
  // indeksu, a "Klub - minisite" po polsku było jedyną etykietą także dla /en/.
  head: ({ loaderData, params }) =>
    buildClubHead({
      fallbackPath: `/club/${params.clubSlug}/minisite`,
      club: loaderData?.club ?? null,
      forceNoindex: true,
    }),
  component: ClubMinisiteRoute,
});

function ClubMinisiteRoute() {
  ensureClubI18n();
  const { t } = useTranslation();
  const { clubSlug } = Route.useParams();
  const { session, isStaff } = useAuth();

  const clubQ = useClubBySlug(clubSlug);
  const tierQ = useCurrentTier();
  const invitationsQ = useMyClubInvitations(Boolean(session));
  const club = clubQ.data ?? null;

  // Wątki bierzemy w porządku "hot": minisite ma pokazać, o czym ten klub
  // jest, a nie co wpadło ostatnie.
  const threadsQ = useClubThreads({ clubId: club?.id, sort: "hot" });
  const threads = (threadsQ.data?.pages ?? []).flatMap((page) => page.rows).slice(0, 7);

  if (!session) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-12">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <MessagesSquare className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h1 className="text-xl font-semibold">{t("club.membersOnlyTitle")}</h1>
            <p className="max-w-md text-sm text-muted-foreground">{t("club.membersOnlyBody")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (clubQ.isPending) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-8" aria-busy="true">
        <div className="mb-5 aspect-[4/1] animate-pulse rounded-xl bg-muted/50" />
        <div className="h-8 w-1/2 animate-pulse rounded bg-muted/50" />
      </div>
    );
  }

  if (club === null) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-12">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <h1 className="text-xl font-semibold">{t("club.notFoundTitle")}</h1>
            <Button asChild variant="outline" size="sm">
              <Link to="/club">{t("club.backToHub")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const access = resolveClubMinisiteAccess({
    canRead: club.can_read,
    myStatus: club.my_status,
    hasInvitation: (invitationsQ.data ?? []).some((inv) => inv.club_id === club.id),
    tierRank: tierQ.data?.rank ?? null,
    isStaff,
  });

  return (
    <ClubMinisite club={club} threads={threads} loading={threadsQ.isPending} access={access} />
  );
}
