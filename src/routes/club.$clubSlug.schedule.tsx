// /club/$clubSlug/schedule - harmonogram prac klubu.
//
// Indeksowalność warunkowa (patrz `buildClubHead`). Harmonogram klubu `public`
// mówi, czym ten klub się zajmuje i w jakim rytmie - to jest dokładnie ta
// treść, która ma dowozić ruch.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import { ClubSchedule } from "@/components/clubs/organisms/ClubSchedule";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/api";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/schedule")({
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
      fallbackPath: `/club/${params.clubSlug}/schedule`,
      club: loaderData?.club ?? null,
    }),
  component: ClubScheduleRoute,
});

function ClubScheduleRoute() {
  ensureClubI18n();
  const { t } = useTranslation();
  const { clubSlug } = Route.useParams();

  return (
    <ClubWorkspaceLayout
      clubSlug={clubSlug}
      title={t("club.schedule.title")}
      lead={t("club.schedule.lead")}
    >
      {(club) => <ClubSchedule clubId={club.id} clubSlug={clubSlug} />}
    </ClubWorkspaceLayout>
  );
}
