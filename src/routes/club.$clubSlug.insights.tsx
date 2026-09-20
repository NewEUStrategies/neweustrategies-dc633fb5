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
import { buildClubHead, clubHeadLoader } from "@/lib/clubs/clubHead";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/insights")({
  // Kartę klubu czyta RAZ loader UKŁADU `/club/$clubSlug`; tutaj zostaje sam
  // odczyt z cache'u na potrzeby nagłówka - zero round-tripów (F09).
  loader: ({ context, params, parentMatchPromise }) =>
    clubHeadLoader(context.queryClient, params.clubSlug, parentMatchPromise),
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
