// /club/$clubSlug/schedule - harmonogram prac klubu.
//
// Indeksowalność warunkowa (patrz `buildClubHead`). Harmonogram klubu `public`
// mówi, czym ten klub się zajmuje i w jakim rytmie - to jest dokładnie ta
// treść, która ma dowozić ruch.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import { ClubSchedule } from "@/components/clubs/organisms/ClubSchedule";
import { buildClubHead, clubHeadLoader } from "@/lib/clubs/clubHead";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/schedule")({
  // Kartę klubu czyta RAZ loader UKŁADU `/club/$clubSlug`; tutaj zostaje sam
  // odczyt z cache'u na potrzeby nagłówka - zero round-tripów (F09).
  loader: ({ context, params, parentMatchPromise }) =>
    clubHeadLoader(context.queryClient, params.clubSlug, parentMatchPromise),
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
