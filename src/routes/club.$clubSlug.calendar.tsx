// /club/$clubSlug/calendar - terminy i spotkania klubu.
//
// Indeksowalność warunkowa (patrz `buildClubHead`): kalendarz klubu `public`
// jest zapowiedzią wydarzeń, kalendarz klubu zamkniętego - rozkładem zajęć
// grona, które nie zgodziło się na publiczność.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import { ClubCalendar } from "@/components/clubs/organisms/ClubCalendar";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/publicClub";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/calendar")({
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
      fallbackPath: `/club/${params.clubSlug}/calendar`,
      club: loaderData?.club ?? null,
    }),
  component: ClubCalendarRoute,
});

function ClubCalendarRoute() {
  ensureClubI18n();
  const { t } = useTranslation();
  const { clubSlug } = Route.useParams();

  return (
    <ClubWorkspaceLayout
      clubSlug={clubSlug}
      title={t("club.calendar.title")}
      lead={t("club.calendar.lead")}
    >
      {(club) => <ClubCalendar clubId={club.id} clubSlug={clubSlug} canManage={club.can_manage} />}
    </ClubWorkspaceLayout>
  );
}
