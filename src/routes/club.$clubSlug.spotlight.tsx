// /club/$clubSlug/spotlight - "Poznaj członka" z archiwum i redakcją.
//
// `noindex` bezwarunkowo: strona jest w całości opisem konkretnej osoby wraz
// z jej dziedzinami i notką redakcyjną - ta sama doktryna, co przy składzie.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import { ClubSpotlightScreen } from "@/components/clubs/organisms/ClubSpotlightScreen";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/api";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/spotlight")({
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
      fallbackPath: `/club/${params.clubSlug}/spotlight`,
      club: loaderData?.club ?? null,
      forceNoindex: true,
    }),
  component: ClubSpotlightRoute,
});

function ClubSpotlightRoute() {
  ensureClubI18n();
  const { t } = useTranslation();
  const { clubSlug } = Route.useParams();

  return (
    <ClubWorkspaceLayout
      clubSlug={clubSlug}
      title={t("club.network.spotlight.title")}
      lead={t("club.network.spotlight.lead")}
    >
      {(club) => <ClubSpotlightScreen clubId={club.id} canModerate={club.can_moderate === true} />}
    </ClubWorkspaceLayout>
  );
}
