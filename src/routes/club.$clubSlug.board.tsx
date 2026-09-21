// /club/$clubSlug/board - tablica ogłoszeń "Szukam / Oferuję".
//
// `noindex` BEZWARUNKOWO, także w klubie `public`. Ogłoszenia członków są
// prośbami skierowanymi do wnętrza klubu ("szukam kontaktu w MON") i mają
// jedną cechę, której nie ma żadna inna powierzchnia tego modułu: wskazują
// KONKRETNĄ osobę razem z tym, czego jej brakuje. Wypuszczenie tego do
// wyszukiwarki zamienia mechanizm sieciujący w źródło leadów dla obcych -
// ta sama doktryna, co przy składzie klubu i /people.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import { ClubBoardScreen } from "@/components/clubs/organisms/ClubBoardScreen";
import { useAuth } from "@/hooks/useAuth";
import { buildClubHead, clubHeadLoader } from "@/lib/clubs/clubHead";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/board")({
  // Kartę klubu czyta RAZ loader UKŁADU `/club/$clubSlug`; tutaj zostaje sam
  // odczyt z cache'u na potrzeby nagłówka - zero round-tripów (F09).
  loader: ({ context, params, parentMatchPromise }) =>
    clubHeadLoader(context.queryClient, params.clubSlug, parentMatchPromise),
  head: ({ loaderData, params }) =>
    buildClubHead({
      fallbackPath: `/club/${params.clubSlug}/board`,
      club: loaderData?.club ?? null,
      forceNoindex: true,
    }),
  component: ClubBoardRoute,
});

function ClubBoardRoute() {
  ensureClubI18n();
  const { t } = useTranslation();
  const { clubSlug } = Route.useParams();
  const { session } = useAuth();

  return (
    <ClubWorkspaceLayout
      clubSlug={clubSlug}
      title={t("club.network.board.title")}
      lead={t("club.network.board.lead")}
    >
      {(club) => <ClubBoardScreen clubId={club.id} canPost={session !== null && club.can_reply} />}
    </ClubWorkspaceLayout>
  );
}
