// /club/$clubSlug/insights - dynamika klubu.
//
// `noindex` BEZWARUNKOWO, także w klubie `public` - ta sama doktryna, co przy
// składzie klubu i /people. Liczby o tym, ile osób realnie pisze i jak szybko
// przychodzi pierwsza odpowiedź, są narzędziem pracy prowadzenia, a nie
// treścią, która ma dowozić ruch z wyszukiwarki. Klub o słabym miesiącu nie
// zasługuje na to, żeby jego martwy okres był tym, co Google pokazuje jako
// wizytówkę.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import { ClubInsights } from "@/components/clubs/organisms/ClubInsights";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/api";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/insights")({
  loader: async ({ context, params }) => {
    const club = await context.queryClient
      .ensureQueryData({
        queryKey: clubKeys.bySlug(params.clubSlug),
        queryFn: () => fetchClubBySlug(params.clubSlug),
      })
      .catch(() => null);
    return { club: toClubHeadSource(club) };
  },
  head: ({ loaderData, params }) =>
    buildClubHead({
      fallbackPath: `/club/${params.clubSlug}/insights`,
      club: loaderData?.club ?? null,
      forceNoindex: true,
    }),
  component: ClubInsightsRoute,
});

function ClubInsightsRoute() {
  ensureClubI18n();
  const { t } = useTranslation();
  const { clubSlug } = Route.useParams();

  return (
    <ClubWorkspaceLayout
      clubSlug={clubSlug}
      title={t("club.insights.title")}
      lead={t("club.insights.lead")}
    >
      {(club) => <ClubInsights clubId={club.id} />}
    </ClubWorkspaceLayout>
  );
}
