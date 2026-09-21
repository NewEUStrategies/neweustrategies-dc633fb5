// /club/$clubSlug/calendar - terminy i spotkania klubu.
//
// Indeksowalność warunkowa (patrz `buildClubHead`): kalendarz klubu `public`
// jest zapowiedzią wydarzeń, kalendarz klubu zamkniętego - rozkładem zajęć
// grona, które nie zgodziło się na publiczność.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import { ClubCalendar } from "@/components/clubs/organisms/ClubCalendar";
import { buildClubHead, clubHeadLoader } from "@/lib/clubs/clubHead";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/calendar")({
  // Kartę klubu czyta RAZ loader UKŁADU `/club/$clubSlug`; tutaj zostaje sam
  // odczyt z cache'u na potrzeby nagłówka - zero round-tripów (F09).
  loader: ({ context, params, parentMatchPromise }) =>
    clubHeadLoader(context.queryClient, params.clubSlug, parentMatchPromise),
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
